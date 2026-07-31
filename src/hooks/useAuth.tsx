import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getActiveGuestViewProfileId,
  listGuestViewProfiles,
  getActiveGuestViewProfile,
  setActiveGuestViewProfile,
  type GuestViewProfile,
} from "@/lib/auth/guestViewProfile";
import { attemptDeferredRegistration, getPendingRegistration } from "@/lib/auth/localAccount";

export const GUEST_ID = "guest";
const GUEST_KEY = "guest-mode";
const GUEST_USER = { id: GUEST_ID, email: "guest@local", role: "authenticated" } as unknown as User;
const SESSION_BOOT_TIMEOUT_MS = 3500;

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isGuest: boolean;
  guestProfile: GuestViewProfile | null;
  signOut: () => Promise<void>;
  signInAsGuest: (profileId?: string | null) => void;
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, loading: true, isGuest: false,
  guestProfile: null,
  signOut: async () => {}, signInAsGuest: () => {},
});

let initialSessionPromise: Promise<Session | null> | null = null;
const getInitialSession = () => {
  if (!initialSessionPromise) {
    initialSessionPromise = Promise.race([
      supabase.auth.getSession().then(({ data }) => data.session ?? null).catch(() => null),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), SESSION_BOOT_TIMEOUT_MS)),
    ]);
  }
  return initialSessionPromise;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestMode, setGuestMode] = useState(() => localStorage.getItem(GUEST_KEY) === "1");
  const [guestProfile, setGuestProfile] = useState<GuestViewProfile | null>(() => getActiveGuestViewProfile());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    let subscription: { unsubscribe: () => void } | null = null;

    // Wait for stored session FIRST, then subscribe to changes.
    // Memoized initial read avoids StrictMode double-mount lock contention.
    getInitialSession().then((initialSession) => {
      if (!mountedRef.current) return;
      setSession(initialSession);
      if (initialSession) setGuestMode(false);
      setLoading(false);

      // Only subscribe after getSession resolves to prevent lock contention.
      const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
        if (!mountedRef.current) return;
        setSession(s);
        if (s) setGuestMode(false);
        setLoading(false);
      });
      subscription = sub.subscription;
    });

    return () => {
      mountedRef.current = false;
      subscription?.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    // The settings-area PIN unlock (sidebar/tabs/widget-layout config) is
    // cached per browser tab for the rest of its life — without clearing it
    // here, unlocking it once as one account (e.g. admin) leaves it unlocked
    // after switching to any other account in the same window, including a
    // local/offline one.
    try { sessionStorage.removeItem("settings-unlocked"); } catch { /* ignore */ }
    if (guestMode) {
      localStorage.removeItem(GUEST_KEY);
      setGuestProfile(null);
      setGuestMode(false);
      return;
    }
    await supabase.auth.signOut();
  }, [guestMode]);

  const signInAsGuest = useCallback((profileId?: string | null) => {
    try { sessionStorage.removeItem("settings-unlocked"); } catch { /* ignore */ }
    const fallbackProfileId = getActiveGuestViewProfileId() ?? listGuestViewProfiles()[0]?.id ?? null;
    const effectiveProfileId = profileId ?? fallbackProfileId;
    if (effectiveProfileId) {
      setActiveGuestViewProfile(effectiveProfileId);
    }
    setGuestProfile(getActiveGuestViewProfile());
    localStorage.setItem(GUEST_KEY, "1");
    setGuestMode(true);
  }, []);

  useEffect(() => {
    if (!guestMode) {
      setGuestProfile(null);
      return;
    }
    setGuestProfile(getActiveGuestViewProfile());
  }, [guestMode]);

  // Deferred offline registration: an account created while offline is
  // registered on the server as soon as connectivity is available — on boot
  // and on every `online` event. Only runs from local mode so it never
  // hijacks an already-authenticated session.
  useEffect(() => {
    if (!guestMode || session) return;
    if (!getPendingRegistration()) return;

    let cancelled = false;
    const run = async () => {
      const result = await attemptDeferredRegistration();
      if (cancelled) return;
      if (result.status === "registered") {
        toast.success("החשבון שנוצר באופליין נרשם לשרת והנתונים מסתנכרנים.");
      } else if (result.status === "failed" && result.message) {
        console.warn("[deferred-registration] failed:", result.message);
      }
    };

    void run();
    window.addEventListener("online", run);
    return () => {
      cancelled = true;
      window.removeEventListener("online", run);
    };
  }, [guestMode, session]);

  const effectiveUser = guestMode ? GUEST_USER : (session?.user ?? null);

  return (
    <Ctx.Provider
      value={{
        session,
        user: effectiveUser,
        loading,
        isGuest: guestMode,
        guestProfile,
        signOut,
        signInAsGuest,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
