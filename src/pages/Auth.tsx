import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Sparkles, Eye, EyeOff, UserX, Trash2, UserCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { DesktopUpdateButton } from "@/components/DesktopUpdateButton";
import { DesktopAppDownloadButton } from "@/components/DesktopAppDownloadButton";
import {
  listGuestViewProfiles,
  saveGuestViewProfile,
  LOCAL_OFFLINE_MATRIX,
  LOCAL_OFFLINE_PROFILE_ID,
  type GuestViewProfile,
} from "@/lib/auth/guestViewProfile";
import { loadBundledOfflineLibrary } from "@/lib/study/offlineLibrary";
import {
  createLocalAccount,
  findLocalAccountByCredentials,
  deleteLocalAccount,
  switchLocalAccount,
  listLocalAccounts,
  getActiveUsername,
  syntheticEmailForUsername,
  USERNAME_RE,
  type LocalAccount,
  rememberOnlineAccountForOfflineLogin,
  prepareRegisteredAccountReconnect,
} from "@/lib/auth/localAccount";

async function ensureLocalOfflineProfile(): Promise<GuestViewProfile> {
  const existing = listGuestViewProfiles().find((profile) => profile.id === LOCAL_OFFLINE_PROFILE_ID);
  const bundledLibrary = await loadBundledOfflineLibrary();
  if (existing?.studySeed?.seededAt === bundledLibrary?.seed.seededAt) return existing;
  return saveGuestViewProfile({
    ...existing,
    id: LOCAL_OFFLINE_PROFILE_ID,
    label: "עבודה מקומית (אופליין)",
    roleId: LOCAL_OFFLINE_PROFILE_ID,
    roleName: "local",
    // Local mode can fully operate on study data, but intentionally receives
    // no cloud administration permissions (users/roles).
    isAdmin: false,
    roles: [{ id: LOCAL_OFFLINE_PROFILE_ID, name: "local" }],
    matrix: LOCAL_OFFLINE_MATRIX,
    // Do not retain legacy admin-shaped presentation snapshots. Display is
    // resolved independently from the synthetic local role.
    sidebarConfig: undefined,
    tabConfig: undefined,
    widgetLayout: undefined,
    studySeed: bundledLibrary?.seed,
  });
}

const REMEMBER_KEY = "auth-remember";
const EMAIL_KEY = "auth-remember-email";

// Electron's `navigator.onLine` is unreliable — it reports `true` whenever a
// network adapter is up, even with no real internet. So we never trust it to
// mean "online": we ATTEMPT the server call (with a timeout) and treat any
// network failure/timeout as offline, falling back to the local account.
const NET_TIMEOUT_MS = 6000;

function isNetworkError(e: unknown): boolean {
  if (!e) return false;
  const err = e as { name?: string; message?: string; status?: number };
  const msg = (err.message ?? String(e)).toLowerCase();
  return (
    err.name === "AuthRetryableFetchError" ||
    err.name === "TypeError" ||
    err.status === 0 ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("fetch") ||
    msg.includes("timeout") ||
    msg.includes("load failed")
  );
}

async function withTimeout<T>(p: PromiseLike<T>, ms = NET_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p as Promise<T>,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

// In Electron the renderer is loaded via file://, which breaks OAuth redirect
// flows that assume an http(s) origin. Detect via the preload bridge.
const IS_ELECTRON =
  typeof window !== "undefined" &&
  ((window as unknown as { desktop?: { isElectron?: boolean } }).desktop?.isElectron === true);
const WEB_ORIGIN = "https://pashash.lovable.app";
const REDIRECT_ORIGIN = IS_ELECTRON ? WEB_ORIGIN : (typeof window !== "undefined" ? window.location.origin : WEB_ORIGIN);

export default function Auth() {
  const navigate = useNavigate();
  const { user, loading, signInAsGuest } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [offlineLibraryCount, setOfflineLibraryCount] = useState<number | null>(null);
  // Local (offline) accounts saved on this machine. Several can coexist, each
  // with its own isolated offline workspace; one is "active" at a time.
  const [localAccounts, setLocalAccounts] = useState<LocalAccount[]>(() => listLocalAccounts());
  const [activeUsername, setActiveUsername] = useState<string | null>(() => getActiveUsername());
  const [deleteTarget, setDeleteTarget] = useState<LocalAccount | null>(null);

  const refreshLocalAccounts = () => {
    setLocalAccounts(listLocalAccounts());
    setActiveUsername(getActiveUsername());
  };

  const handleDeleteLocalAccount = async () => {
    const target = deleteTarget;
    if (!target) return;
    await deleteLocalAccount(target.username);
    refreshLocalAccounts();
    setDeleteTarget(null);
    toast.success(`החשבון "${target.displayName || target.username}" נמחק מהמחשב.`);
  };

  // Switch to a local account and enter its offline workspace in one tap. The
  // swap parks the current workspace and loads the target's into the shared
  // slot; entering guest mode then hydrates the study store from it.
  const handleSwitchLocalAccount = (uname: string) => {
    const target = localAccounts.find((a) => a.username === uname);
    setEmail(target?.email || target?.username || uname);
    setPassword("");
    toast.info(`הזן את הסיסמה של "${target?.displayName || uname}" כדי להיכנס.`);
  };

  useEffect(() => { document.title = "התחברות | מעקב למידה"; }, []);

  // restore remembered email
  useEffect(() => {
    const r = localStorage.getItem(REMEMBER_KEY) === "1";
    setRemember(r);
    if (r) {
      const saved = localStorage.getItem(EMAIL_KEY);
      if (saved) setEmail(saved);
    }
  }, []);

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const localOfflineProfile = await ensureLocalOfflineProfile();
      if (cancelled) return;
      setOfflineLibraryCount(localOfflineProfile.studySeed?.cards.length ?? 0);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistRemember = () => {
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, "1");
      localStorage.setItem(EMAIL_KEY, email);
    } else {
      localStorage.removeItem(REMEMBER_KEY);
      localStorage.removeItem(EMAIL_KEY);
    }
  };

  // Sign in to the local offline account and enter the app.
  const enterOfflineFromSignIn = async (): Promise<boolean> => {
    const account = await findLocalAccountByCredentials(email, password);
    if (account) {
      if (!(await switchLocalAccount(account.username))) return false;
      setActiveUsername(account.username);
      // Ensure the bundled study library (22k questions) is loaded into the
      // offline profile BEFORE entering, otherwise the store hydrates with an
      // empty seed and the review system shows nothing.
      await ensureLocalOfflineProfile();
      prepareRegisteredAccountReconnect(account, password);
      signInAsGuest(LOCAL_OFFLINE_PROFILE_ID, "account");
      toast.success("התחברת לחשבון המקומי. הנתונים יסתנכרנו לשרת כשיהיה אינטרנט.");
      navigate("/", { replace: true });
      return true;
    }
    return false;
  };

  const signIn = async () => {
    setBusy(true);
    void import("./Index");

    // Skip the network attempt only when the browser is *certain* it's offline.
    const clearlyOffline = typeof navigator !== "undefined" && !navigator.onLine;
    if (!clearlyOffline) {
      try {
        let loginEmail = email.trim();
        if (loginEmail && !loginEmail.includes("@")) {
          console.log("[auth-debug] signIn: resolving username →", loginEmail);
          const { data: resolved } = await withTimeout(supabase.rpc("email_for_username", { p_username: loginEmail }));
          loginEmail = (typeof resolved === "string" && resolved) ? resolved : syntheticEmailForUsername(loginEmail);
        }
        console.log("[auth-debug] signIn: signInWithPassword →", loginEmail);
        const { data, error } = await withTimeout(supabase.auth.signInWithPassword({ email: loginEmail, password }));
        if (!error) {
          const signedInUser = data.user ?? data.session?.user;
          if (signedInUser) {
            await rememberOnlineAccountForOfflineLogin({
              userId: signedInUser.id,
              email: signedInUser.email || loginEmail,
              username: (signedInUser.user_metadata?.username as string | undefined)
                || (!email.trim().includes("@") ? email.trim() : undefined),
              displayName: (signedInUser.user_metadata?.display_name as string | undefined)
                || (signedInUser.user_metadata?.full_name as string | undefined),
              password,
            });
          }
          setBusy(false);
          persistRemember();
          try { sessionStorage.removeItem("settings-unlocked"); } catch { /* ignore */ }
          toast.success("התחברת בהצלחה");
          navigate("/", { replace: true });
          return;
        }
        // A rejected password/account is authoritative while the server is
        // reachable. Offline fallback is allowed only for a real network
        // failure, never to bypass a password change or blocked account.
        if (isNetworkError(error)) throw error;
        console.error("[auth-debug] signInWithPassword error", { name: error.name, status: (error as { status?: number }).status, message: error.message });
        setBusy(false);
        return toast.error(error.message);
      } catch (err) {
        // Network failure / timeout → fall through to offline sign-in.
        if (!isNetworkError(err)) {
          setBusy(false);
          console.error("[auth-debug] signIn threw (non-network)", err);
          return toast.error("שגיאה בהתחברות: " + (err instanceof Error ? err.message : String(err)));
        }
        console.warn("[auth-debug] signIn network failure → offline fallback");
      }
    }

    // Offline path: verify against the locally-stored account.
    const ok = await enterOfflineFromSignIn();
    setBusy(false);
    if (!ok) {
      toast.error("אין חיבור לשרת ולא נמצא חשבון מקומי תואם במחשב זה. בדוק את הפרטים או הירשם.");
    }
  };

  // Create the local offline account and enter the app. The account registers
  // on the server automatically once connectivity returns (see
  // attemptDeferredRegistration in useAuth).
  const registerOffline = async (): Promise<void> => {
    const result = await createLocalAccount({ username, displayName: name, email, password });
    if (result.ok) {
      // Load the bundled 22k-question library into the offline profile BEFORE
      // entering, so the review system is populated on first load (avoids the
      // race where the store hydrates before the heavy seed finishes loading).
      await ensureLocalOfflineProfile();
      signInAsGuest(LOCAL_OFFLINE_PROFILE_ID, "account");
      toast.success("נרשמת מקומית! החשבון יירשם לשרת אוטומטית ברגע שיהיה חיבור לאינטרנט.");
      navigate("/", { replace: true });
    } else {
      toast.error(result.error ?? "יצירת החשבון נכשלה.");
    }
  };

  const signUp = async () => {
    const cleanUsername = username.trim().toLowerCase();
    if (!USERNAME_RE.test(cleanUsername)) {
      toast.error("שם המשתמש חייב להכיל לפחות 2 תווים (עברית/אנגלית, מספרים, נקודה או קו תחתון) וללא רווחים.");
      return;
    }
    if (!(password ?? "").length) {
      toast.error("יש להזין סיסמה.");
      return;
    }
    setBusy(true);

    const clearlyOffline = typeof navigator !== "undefined" && !navigator.onLine;
    if (!clearlyOffline) {
      try {
        const signupEmail = email.trim() || syntheticEmailForUsername(cleanUsername);
        console.log("[auth-debug] signUp: online attempt →", { signupEmail, isElectron: IS_ELECTRON, supaHost: (() => { try { return new URL(import.meta.env.VITE_SUPABASE_URL).host; } catch { return "INVALID"; } })() });
        const { data, error } = await withTimeout(supabase.auth.signUp({
          email: signupEmail, password,
          options: {
            emailRedirectTo: `${REDIRECT_ORIGIN}/`,
            data: { display_name: name || cleanUsername, username: cleanUsername },
          },
        }));
        if (!error) {
          setBusy(false);
          persistRemember();
          if (data.session) {
            const signedInUser = data.user ?? data.session.user;
            await rememberOnlineAccountForOfflineLogin({
              userId: signedInUser.id,
              email: signedInUser.email || signupEmail,
              username: cleanUsername,
              displayName: name || cleanUsername,
              password,
            });
            try { sessionStorage.removeItem("settings-unlocked"); } catch { /* ignore */ }
            toast.success("נרשמת בהצלחה!");
            navigate("/", { replace: true });
          } else {
            toast.success("ההרשמה נקלטה. אמת את כתובת המייל כדי להתחבר.");
          }
          return;
        }
        if (isNetworkError(error)) throw error;
        // A real server error (e.g. already registered) — surface it.
        console.error("[auth-debug] signUp error", { name: error.name, status: (error as { status?: number }).status, message: error.message });
        setBusy(false);
        return toast.error(error.message);
      } catch (err) {
        if (!isNetworkError(err)) {
          setBusy(false);
          console.error("[auth-debug] signUp threw (non-network)", err);
          return toast.error("שגיאה בהרשמה: " + (err instanceof Error ? err.message : String(err)));
        }
        console.warn("[auth-debug] signUp network failure → offline registration");
      }
    }

    // Offline path: register locally and enter now.
    await registerOffline();
    setBusy(false);
  };

  const signInGoogle = async () => {
    if (IS_ELECTRON) {
      toast.error("התחברות דרך Google אינה נתמכת באפליקציית הדסקטופ. השתמש באימייל וסיסמה.");
      return;
    }
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) return toast.error(result.error.message);
    if (result.redirected) return;
    persistRemember();
    navigate("/", { replace: true });
  };

  return (
    <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="gold-frame relative w-full max-w-md p-8 space-y-6 animate-fade-in">
        <div className="absolute right-4 top-4 flex items-center gap-2" title="עדכוני תוכנה">
          <DesktopUpdateButton />
          <DesktopAppDownloadButton />
        </div>
        <header className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
              <Sparkles className="h-5 w-5 text-navy" />
            </div>
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground">מעקב למידה</h1>
          <p className="text-sm text-muted-foreground">התחברות לסנכרון בין מכשירים</p>
        </header>

        <Tabs defaultValue="signin" className="w-full">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="signin">התחברות</TabsTrigger>
            <TabsTrigger value="signup">הרשמה</TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="space-y-3 mt-4">
            <Input dir="ltr" placeholder="email או שם משתמש" type="text" value={email} onChange={(e) => setEmail(e.target.value)} />
            <PasswordField value={password} onChange={setPassword} show={showPwd} onToggle={() => setShowPwd((v) => !v)} />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox id="remember" checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
                <Label htmlFor="remember" className="text-sm cursor-pointer">זכור אותי</Label>
              </div>
            </div>
            <Button onClick={signIn} disabled={busy} className="w-full bg-gradient-navy text-primary-foreground">התחבר</Button>
          </TabsContent>

          <TabsContent value="signup" className="space-y-3 mt-4">
            <Input placeholder="שם תצוגה" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="שם משתמש (אפשר בעברית)" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Input dir="ltr" placeholder="email@example.com (אופציונלי)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <PasswordField value={password} onChange={setPassword} show={showPwd} onToggle={() => setShowPwd((v) => !v)} placeholder="סיסמה" />
            <div className="flex items-center gap-2">
              <Checkbox id="remember2" checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
              <Label htmlFor="remember2" className="text-sm cursor-pointer">זכור אותי</Label>
            </div>
            <Button onClick={signUp} disabled={busy} className="w-full bg-gradient-navy text-primary-foreground">הירשם</Button>
          </TabsContent>
        </Tabs>

        <div className="relative">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gold/40" /></div>
          <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">או</span></div>
        </div>

        {!IS_ELECTRON && (
          <Button variant="outline" onClick={signInGoogle} className="w-full border-2 border-gold rounded-full gap-2">
            <GoogleIcon />
            המשך עם Google
          </Button>
        )}

        <div className="relative">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gold/30" /></div>
          <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">כניסה אופליין</span></div>
        </div>

        <Button
          variant="outline"
          onClick={async () => {
            // This is an anonymous, machine-local entry point. Never reuse the
            // configurable cloud guest/default profile here: that profile may
            // mirror an administrator and must not grant admin rights offline.
            await ensureLocalOfflineProfile();
            signInAsGuest(LOCAL_OFFLINE_PROFILE_ID);
            navigate("/", { replace: true });
          }}
          className="w-full border-2 border-dashed border-gold/50 rounded-full gap-2 text-muted-foreground hover:text-foreground hover:border-gold"
        >
          <UserX className="h-4 w-4" />
          כניסה למצב אופליין
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          {offlineLibraryCount && offlineLibraryCount > 0
            ? `כולל ${offlineLibraryCount.toLocaleString("he-IL")} שאלות מובנות. ההתקדמות נשמרת במחשב ללא צורך באינטרנט.`
            : "ההתקדמות נשמרת במחשב הזה ללא צורך באינטרנט."}
        </p>

        {localAccounts.length > 0 && (
          <div className="rounded-xl border-2 border-gold/30 bg-card/60 p-3 space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground text-right px-1">
              חשבונות מקומיים במחשב זה
            </div>
            {localAccounts.map((acct) => {
              const isActive = acct.username === activeUsername;
              return (
                <div
                  key={acct.username}
                  className={`flex items-center gap-2 rounded-lg p-2 transition-colors ${
                    isActive ? "bg-gold/10 ring-1 ring-gold/40" : "hover:bg-card"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSwitchLocalAccount(acct.username)}
                    className="flex flex-1 min-w-0 items-center gap-2 text-right disabled:opacity-60"
                    title={isActive ? "כניסה לחשבון הפעיל" : "עבור לחשבון זה והיכנס"}
                  >
                    {isActive
                      ? <UserCircle className="h-5 w-5 text-gold shrink-0" />
                      : <UserX className="h-5 w-5 text-muted-foreground shrink-0" />}
                    <div className="min-w-0 flex-1 text-right">
                      <div className="text-sm font-medium text-foreground break-all">
                        {acct.displayName || acct.username}
                        {isActive && <span className="mr-1 text-[10px] text-gold">· פעיל</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {acct.status === "registered" ? "מסונכרן לשרת" : "ממתין לסנכרון"}
                      </div>
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    title="מחק חשבון מקומי"
                    onClick={() => setDeleteTarget(acct)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground text-right leading-relaxed px-1">
              להוספת חשבון נוסף במחשב זה — עבור ללשונית "הרשמה" וצור חשבון חדש. כל חשבון שומר התקדמות נפרדת.
            </p>
          </div>
        )}
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את החשבון המקומי?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.status === "registered"
                ? `החשבון "${deleteTarget?.displayName || deleteTarget?.username}" יוסר מהמחשב הזה בלבד. הנתונים שכבר סונכרנו לשרת יישארו ותוכל להתחבר אליהם שוב עם אינטרנט.`
                : `החשבון "${deleteTarget?.displayName || deleteTarget?.username}" עדיין לא סונכרן לשרת. מחיקה תסיר אותו לצמיתות מהמחשב.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteLocalAccount}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              מחק חשבון
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PasswordField({ value, onChange, show, onToggle, placeholder = "סיסמה" }: {
  value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; placeholder?: string;
}) {
  return (
    <div className="relative" dir="rtl">
      <Input
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-10 text-right"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? "הסתר סיסמה" : "הצג סיסמה"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.3 0-9.7-3.3-11.3-8L6.2 32.6C9.5 39.4 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2C40.8 35.6 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
