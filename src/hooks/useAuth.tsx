import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const GUEST_ID = "guest";
const GUEST_KEY = "guest-mode";
const GUEST_USER = { id: GUEST_ID, email: "guest@local", role: "authenticated" } as unknown as User;

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isGuest: boolean;
  signOut: () => Promise<void>;
  signInAsGuest: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, loading: true, isGuest: false,
  signOut: async () => {}, signInAsGuest: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestMode, setGuestMode] = useState(() => localStorage.getItem(GUEST_KEY) === "1");

  useEffect(() => {
    // Subscribe FIRST, then read existing session.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) setGuestMode(false); // real auth overrides guest mode
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    if (guestMode) {
      localStorage.removeItem(GUEST_KEY);
      setGuestMode(false);
      return;
    }
    await supabase.auth.signOut();
  }, [guestMode]);

  const signInAsGuest = useCallback(() => {
    localStorage.setItem(GUEST_KEY, "1");
    setGuestMode(true);
  }, []);

  const effectiveUser = guestMode ? GUEST_USER : (session?.user ?? null);

  return (
    <Ctx.Provider
      value={{
        session,
        user: effectiveUser,
        loading,
        isGuest: guestMode,
        signOut,
        signInAsGuest,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);