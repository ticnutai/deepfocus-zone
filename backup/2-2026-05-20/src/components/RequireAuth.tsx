import { ReactNode, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// Module-level cache — prevents duplicate fetch on StrictMode double-mount.
const profileStatusCache = new Map<string, string>();

const LS_KEY = (uid: string) => `pashash:ps:${uid}`;

function readCachedStatus(uid: string): string | null {
  try { return localStorage.getItem(LS_KEY(uid)); } catch { return null; }
}

function writeCachedStatus(uid: string, status: string): void {
  try { localStorage.setItem(LS_KEY(uid), status); } catch { /* ignore */ }
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, isGuest, signOut } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const fetchingFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user || isGuest) { setStatus("approved"); return; }
    const cached = profileStatusCache.get(user.id) ?? readCachedStatus(user.id);
    if (cached) {
      // Serve stale immediately — no spinner.
      profileStatusCache.set(user.id, cached);
      setStatus(cached);
    }
    if (fetchingFor.current === user.id) return; // already in-flight
    fetchingFor.current = user.id;
    if (!cached) setStatusLoading(true);
    supabase.from("profiles").select("status").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        const s = data?.status ?? "approved";
        profileStatusCache.set(user.id, s);
        writeCachedStatus(user.id, s);
        setStatus(s);
        setStatusLoading(false);
        fetchingFor.current = null;
      });
  }, [user, isGuest]);

  if (loading || statusLoading) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        טוען…
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  if (status === "pending") {
    return (
      <div dir="rtl" className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <div className="text-4xl">⏳</div>
        <h2 className="text-2xl font-bold text-foreground">ממתין לאישור</h2>
        <p className="text-muted-foreground max-w-sm">החשבון שלך עדיין לא אושר על ידי מנהל המערכת. נסה שוב מאוחר יותר.</p>
        <Button variant="outline" onClick={signOut}>יציאה</Button>
      </div>
    );
  }

  if (status === "blocked") {
    return (
      <div dir="rtl" className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <div className="text-4xl">🚫</div>
        <h2 className="text-2xl font-bold text-destructive">חשבון חסום</h2>
        <p className="text-muted-foreground max-w-sm">הגישה לחשבון זה נחסמה. לבירורים פנה למנהל המערכת.</p>
        <Button variant="outline" onClick={signOut}>יציאה</Button>
      </div>
    );
  }

  return <>{children}</>;
}