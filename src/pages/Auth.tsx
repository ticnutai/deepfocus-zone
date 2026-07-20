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
import { Sparkles, Eye, EyeOff, UserX } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  getActiveGuestViewProfileId,
  hydrateGuestProfilesFromSiteSettings,
  listGuestViewProfiles,
  setActiveGuestViewProfile,
  saveGuestViewProfile,
  type GuestViewProfile,
} from "@/lib/auth/guestViewProfile";
import { loadBundledOfflineLibrary } from "@/lib/study/offlineLibrary";

const LOCAL_OFFLINE_PROFILE_ID = "local-offline";
const LOCAL_OFFLINE_MATRIX = Object.fromEntries(
  ["decks", "cards", "goals", "shas", "analytics", "settings"].flatMap((module) =>
    ["view", "create", "edit", "delete", "manage"].map((action) => [`${module}:${action}`, true]),
  ),
);

async function ensureLocalOfflineProfile(): Promise<GuestViewProfile> {
  const existing = listGuestViewProfiles().find((profile) => profile.id === LOCAL_OFFLINE_PROFILE_ID);
  const bundledLibrary = await loadBundledOfflineLibrary();
  if (existing?.studySeed?.seededAt === bundledLibrary?.seed.seededAt) return existing;
  return saveGuestViewProfile({
    ...existing,
    id: LOCAL_OFFLINE_PROFILE_ID,
    label: "עבודה מקומית (אופליין)",
    // Local mode can fully operate on study data, but intentionally receives
    // no cloud administration permissions (users/roles).
    isAdmin: false,
    roles: [{ id: LOCAL_OFFLINE_PROFILE_ID, name: "local" }],
    matrix: LOCAL_OFFLINE_MATRIX,
    studySeed: bundledLibrary?.seed,
  });
}

const REMEMBER_KEY = "auth-remember";
const EMAIL_KEY = "auth-remember-email";

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
  const [selectedGuestProfileId, setSelectedGuestProfileId] = useState<string>("");
  const [offlineLibraryCount, setOfflineLibraryCount] = useState<number | null>(null);

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
      let localOfflineProfile = await ensureLocalOfflineProfile();
      setOfflineLibraryCount(localOfflineProfile.studySeed?.cards.length ?? 0);
      // Make offline entry available immediately. Cloud profile discovery may
      // replace this selection later when connectivity is available.
      setSelectedGuestProfileId(localOfflineProfile.id);
      try {
        const { profiles, defaultProfileId } = await hydrateGuestProfilesFromSiteSettings();
        if (cancelled) return;
        // Cloud profile hydration replaces the lightweight local catalogue.
        // Re-register the bundled profile so its in-memory seed remains selectable.
        localOfflineProfile = await ensureLocalOfflineProfile();
        const effectiveProfiles = profiles.length > 0 ? profiles : listGuestViewProfiles();
        if (!effectiveProfiles.some((profile) => profile.id === LOCAL_OFFLINE_PROFILE_ID)) {
          effectiveProfiles.push(localOfflineProfile);
        }
        const activeId = defaultProfileId ?? getActiveGuestViewProfileId();
        const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
        const hasActive = !isOffline && !!activeId && effectiveProfiles.some((p) => p.id === activeId);
        const chosen = isOffline
          ? localOfflineProfile
          : hasActive
          ? (effectiveProfiles.find((p) => p.id === activeId) ?? effectiveProfiles[0])
          : effectiveProfiles[0];
        setSelectedGuestProfileId(chosen.id);
      } catch {
        const fallbackProfiles = listGuestViewProfiles();
        if (!fallbackProfiles.some((profile) => profile.id === LOCAL_OFFLINE_PROFILE_ID)) {
          fallbackProfiles.push(localOfflineProfile);
        }
        const activeId = getActiveGuestViewProfileId();
        const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
        const hasActive = !isOffline && !!activeId && fallbackProfiles.some((p) => p.id === activeId);
        const chosen = isOffline
          ? localOfflineProfile
          : hasActive
          ? (fallbackProfiles.find((p) => p.id === activeId) ?? fallbackProfiles[0])
          : fallbackProfiles[0];
        setSelectedGuestProfileId(chosen.id);
      }
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

  const signIn = async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("אין חיבור לאינטרנט. התחברות ראשונה לחשבון דורשת רשת; אפשר להיכנס כעת למצב האופליין.");
      return;
    }
    setBusy(true);
    void import("./Index");
    let loginEmail = email.trim();
    // If user typed a username (no @), look up the matching email
    if (loginEmail && !loginEmail.includes("@")) {
      const { data: resolved } = await supabase.rpc("email_for_username", { p_username: loginEmail });
      if (typeof resolved === "string" && resolved) {
        loginEmail = resolved;
      } else {
        // Fallback: synthetic email convention for username-only accounts
        loginEmail = `${loginEmail.toLowerCase()}@users.local`;
      }
    }
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    persistRemember();
    toast.success("התחברת בהצלחה");
    navigate("/", { replace: true });
  };

  const signUp = async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("הרשמה חדשה דורשת חיבור לאינטרנט. מצב האופליין זמין מיד ואינו דורש הרשמה.");
      return;
    }
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,}$/.test(cleanUsername)) {
      toast.error("שם המשתמש חייב להכיל לפחות 3 תווים באנגלית, מספרים, נקודה או קו תחתון.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${REDIRECT_ORIGIN}/`,
        data: { display_name: name || cleanUsername, username: cleanUsername },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    persistRemember();
    if (data.session) {
      toast.warning("ההרשמה נקלטה וממתינה לאישור מנהל. אימות דוא״ל אינו מופעל כרגע בשרת.");
    } else {
      toast.success("ההרשמה נקלטה וממתינה לאישור מנהל. אם לא התקבל מייל אימות, אישור המנהל יאמת גם את הכתובת ויאפשר כניסה.");
    }
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
      <Card className="gold-frame w-full max-w-md p-8 space-y-6 animate-fade-in">
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
            <Input dir="ltr" placeholder="username (שם משתמש)" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Input dir="ltr" placeholder="email@example.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <PasswordField value={password} onChange={setPassword} show={showPwd} onToggle={() => setShowPwd((v) => !v)} placeholder="סיסמה (לפחות 6 תווים)" />
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
          onClick={() => {
            if (!selectedGuestProfileId) {
              toast.error("לא הוגדר פרופיל אורח קבוע. הגדר אותו במסך ניהול משתמשים.");
              return;
            }
            signInAsGuest(selectedGuestProfileId);
            navigate("/", { replace: true });
          }}
          disabled={!selectedGuestProfileId}
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
      </Card>
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
