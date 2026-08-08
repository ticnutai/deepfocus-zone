import { supabase } from "@/integrations/supabase/client";

const LOGIN_MARK_PREFIX = "activity-login:";
const HEARTBEAT_SECONDS = 60;

async function record(event: "login" | "heartbeat", seconds = 0) {
  if (!navigator.onLine) return;
  const { error } = await supabase.rpc("record_user_activity", {
    p_event: event,
    p_active_seconds: seconds,
  } as never);
  if (error) console.warn("[activity] record failed:", error.message);
}

export function startCloudActivityTracking(userId: string, sessionIdentity: string) {
  const loginMark = `${LOGIN_MARK_PREFIX}${userId}:${sessionIdentity}`;
  try {
    if (sessionStorage.getItem(loginMark) !== "1") {
      sessionStorage.setItem(loginMark, "1");
      void record("login");
    }
  } catch {
    void record("login");
  }

  let lastTick = Date.now();
  const heartbeat = () => {
    const now = Date.now();
    const elapsed = Math.min(HEARTBEAT_SECONDS, Math.max(0, Math.round((now - lastTick) / 1000)));
    lastTick = now;
    if (document.visibilityState === "visible" && elapsed > 0) void record("heartbeat", elapsed);
  };

  const intervalId = window.setInterval(heartbeat, HEARTBEAT_SECONDS * 1000);
  const onVisible = () => { lastTick = Date.now(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);

  return () => {
    window.clearInterval(intervalId);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
  };
}
