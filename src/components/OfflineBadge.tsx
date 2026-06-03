import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small floating badge that appears when the device goes offline.
 * Confirms to the user that the app is still fully usable.
 */
export function OfflineBadge() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    const onOn = () => {
      setOnline(true);
      setJustReconnected(true);
      window.setTimeout(() => setJustReconnected(false), 2500);
    };
    const onOff = () => setOnline(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);
    return () => {
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
    };
  }, []);

  if (online && !justReconnected) return null;

  return (
    <div
      dir="rtl"
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-medium shadow-elegant backdrop-blur-md transition-all duration-300",
        online
          ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
          : "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
      role="status"
      aria-live="polite"
    >
      {online ? (
        <>
          <Wifi className="h-4 w-4" />
          <span>חזרת לרשת — מסנכרן שינויים…</span>
        </>
      ) : (
        <>
          <WifiOff className="h-4 w-4" />
          <span>מצב לא מקוון — האפליקציה פועלת כרגיל</span>
        </>
      )}
    </div>
  );
}
