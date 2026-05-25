import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  clearActiveGuestViewProfile,
  getActiveGuestViewProfile,
  setActiveGuestViewProfile,
  type GuestViewProfile,
} from "@/lib/auth/guestViewProfile";

export const GUEST_ID = "guest";
const GUEST_KEY = "guest-mode";
const GUEST_USER = { id: GUEST_ID, email: "guest@local", role: "authenticated" } as unknown as User;

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
    initialSessionPromise = supabase.auth.getSession()
      .then(({ data }) => data.session ?? null)
      .catch(() => null);
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
    if (guestMode) {
      localStorage.removeItem(GUEST_KEY);
      clearActiveGuestViewProfile();
      setGuestProfile(null);
      setGuestMode(false);
      return;
    }
    await supabase.auth.signOut();
  }, [guestMode]);

  const signInAsGuest = useCallback((profileId?: string | null) => {
    if (profileId) {
      setActiveGuestViewProfile(profileId);
    } else {
      clearActiveGuestViewProfile();
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
