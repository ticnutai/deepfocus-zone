import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// Last verified status, used only when the server cannot be reached.
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
  const [resolved, setResolved] = useState<{ owner: string; status: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const userId = user?.id;

  useEffect(() => {
    const reconnect = () => { setResolved(null); setRefresh(value => value + 1); };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, []);

  useEffect(() => {
    if (!userId || isGuest) return;
    let cancelled = false;
    const cached = profileStatusCache.get(userId) ?? readCachedStatus(userId);
    const publish = (status: string) => { if (!cancelled) setResolved({ owner: userId, status }); };
    if (!navigator.onLine) { publish(cached ?? "approved"); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { publish(cached ?? "approved"); controller.abort(); }, 8000);
    Promise.resolve(supabase.from("profiles").select("status").eq("id", userId).abortSignal(controller.signal).maybeSingle())
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { publish(cached ?? "approved"); return; }
        const s = data?.status ?? "approved";
        profileStatusCache.set(userId, s);
        writeCachedStatus(userId, s);
        publish(s);
      })
      .catch(() => {
        // A valid cached Supabase session must remain usable offline. Profile
        // status is refreshed when connectivity returns.
        publish(cached ?? "approved");
      }).finally(() => window.clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [userId, isGuest, refresh]);

  const statusLoading = !!userId && !isGuest && resolved?.owner !== userId;
  const status = !isGuest && resolved?.owner === userId ? resolved?.status : null;

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
