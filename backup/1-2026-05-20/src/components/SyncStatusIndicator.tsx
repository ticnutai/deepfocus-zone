import { useEffect, useState, useCallback } from "react";
import { Cloud, CloudOff, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getCurrentStudyCardsCount, getLastCloudSyncAt, getLastFullSyncAt, getFullRefreshTtlMs, getLastKnownCloudCardsCount } from "@/lib/study/store";
import { isSyncEnabled, subscribeSyncEnabled } from "@/lib/study/syncControl";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STALE_MS = 5 * 60 * 1000; // 5 דקות = "ייתכן שלא מעודכן"
const AUTO_RESYNC_THRESHOLD_MS = 10 * 60 * 1000; // 10 דקות מיושן → ריענון אוטומטי
const AUTO_RESYNC_COOLDOWN_MS = 5 * 60 * 1000; // לא יותר מפעם ב-5 דק'
const AUTO_RESYNC_KEY = "sync-indicator:last-auto-resync-at";
const AUTO_RESYNC_COUNT_KEY = "sync-indicator:auto-resync-count";
const AUTO_RESYNC_MAX_ATTEMPTS = 3; // אחרי 3 ניסיונות רצופים — נעצור עד התערבות ידנית

function formatRelative(ms: number): string {
  if (!ms) return "מעולם לא סונכרן";
  const diff = Date.now() - ms;
  if (diff < 0) return "כרגע";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `לפני ${s} שנ'`;
  const m = Math.floor(s / 60);
  if (m < 60) return `לפני ${m} ד'`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} ש'`;
  const d = Math.floor(h / 24);
  return `לפני ${d} י'`;
}

function formatAbsolute(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("he-IL", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return new Date(ms).toISOString(); }
}

export function SyncStatusIndicator() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [, force] = useState(0);
  const [syncOn, setSyncOn] = useState<boolean>(() => isSyncEnabled());

  useEffect(() => subscribeSyncEnabled(setSyncOn), []);

  // Tick every 15s so relative time stays fresh and stale detection updates.
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 15_000);
    const onStorage = (e: StorageEvent) => {
      if (e.key && (e.key.startsWith("last-cloud-bootstrap-at:") || e.key.startsWith("last-cloud-full-sync-at:") || e.key.startsWith("last-cloud-cards-count:"))) {
        force((n) => n + 1);
      }
    };
    window.addEventListener("storage", onStorage);
    const onVis = () => { if (document.visibilityState === "visible") force((n) => n + 1); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const handleRefresh = useCallback(() => {
    // ידני → איפוס מונה הניסיונות הרצופים
    try {
      localStorage.removeItem(AUTO_RESYNC_COUNT_KEY);
      localStorage.removeItem(AUTO_RESYNC_KEY);
    } catch { /* ignore */ }
    window.location.reload();
  }, []);

  const lastSync = uid ? getLastCloudSyncAt(uid) : 0;
  const lastFull = uid ? getLastFullSyncAt(uid) : 0;
  const localCardsCount = getCurrentStudyCardsCount();
  const cloudCardsCount = uid ? getLastKnownCloudCardsCount(uid) : 0;
  const ttl = getFullRefreshTtlMs();
  const age = lastSync ? Date.now() - lastSync : Infinity;
  const hasCountMismatch = cloudCardsCount > 0 && localCardsCount !== cloudCardsCount;
  const isStale = !syncOn || !lastSync || age > STALE_MS;
  const isVeryStale = lastFull > 0 && (Date.now() - lastFull) > ttl;

  // איפוס מונה הניסיונות כאשר המצב חזר להיות תקין (לא מיושן ואין פער)
  useEffect(() => {
    if (!uid || !syncOn) return;
    const tooOld = lastSync > 0 && (Date.now() - lastSync) > AUTO_RESYNC_THRESHOLD_MS;
    const needsResync = tooOld || hasCountMismatch || isVeryStale;
    if (!needsResync) {
      try {
        if (localStorage.getItem(AUTO_RESYNC_COUNT_KEY)) {
          localStorage.removeItem(AUTO_RESYNC_COUNT_KEY);
        }
      } catch { /* ignore */ }
    }
  }, [uid, syncOn, lastSync, hasCountMismatch, isVeryStale]);

  // Auto-resync: when stale beyond threshold or count mismatch, refresh the page
  // automatically (with a cooldown so we don't loop). Capped at MAX_ATTEMPTS.
  useEffect(() => {
    if (!uid || !syncOn) return;
    const tooOld = lastSync > 0 && (Date.now() - lastSync) > AUTO_RESYNC_THRESHOLD_MS;
    if (!(tooOld || hasCountMismatch || isVeryStale)) return;

    let last = 0;
    try { last = Number(localStorage.getItem(AUTO_RESYNC_KEY) || "0"); } catch { /* ignore */ }
    if (Date.now() - last < AUTO_RESYNC_COOLDOWN_MS) return;

    let attempts = 0;
    try { attempts = Number(localStorage.getItem(AUTO_RESYNC_COUNT_KEY) || "0"); } catch { /* ignore */ }
    if (attempts >= AUTO_RESYNC_MAX_ATTEMPTS) {
      // הגענו לתקרה — לא מרעננים אוטומטית עד לחיצה ידנית או חזרה למצב תקין
      toast.warning("ריענון אוטומטי הושעה", {
        description: `בוצעו ${attempts} ניסיונות רצופים ללא פתרון הפער. לחץ על מחוון הסנכרון לרענון ידני.`,
        duration: 7000,
        id: "auto-resync-suspended",
      });
      return;
    }

    try {
      localStorage.setItem(AUTO_RESYNC_KEY, String(Date.now()));
      localStorage.setItem(AUTO_RESYNC_COUNT_KEY, String(attempts + 1));
    } catch { /* ignore */ }

    // Build a human-readable reason for the toast
    const reasons: string[] = [];
    if (hasCountMismatch) {
      reasons.push(`פער במונה הכרטיסים (מקומי ${localCardsCount.toLocaleString("he-IL")} מול ענן ${cloudCardsCount.toLocaleString("he-IL")})`);
    }
    if (isVeryStale) {
      reasons.push("חריגה מ-TTL של טעינה מלאה");
    }
    if (tooOld && !hasCountMismatch && !isVeryStale) {
      reasons.push(`הסנכרון האחרון לפני יותר מ-${Math.round(AUTO_RESYNC_THRESHOLD_MS / 60000)} דקות`);
    }
    const reasonText = reasons.join(" · ");

    toast.info(`מתבצע ריענון אוטומטי (${attempts + 1}/${AUTO_RESYNC_MAX_ATTEMPTS})`, {
      description: `${reasonText}\nהדף ייטען מחדש כדי לשלוף נתונים עדכניים.`,
      duration: 5000,
    });

    const t = window.setTimeout(() => { window.location.reload(); }, 1800);
    return () => window.clearTimeout(t);
  }, [uid, syncOn, lastSync, hasCountMismatch, isVeryStale, localCardsCount, cloudCardsCount]);

  if (!uid) return null;

  let status: "off" | "synced" | "stale" | "never";
  if (!syncOn) status = "off";
  else if (!lastSync) status = "never";
  else if (isStale || isVeryStale || hasCountMismatch) status = "stale";
  else status = "synced";

  const palette = {
    synced: { cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", Icon: CheckCircle2, label: "מסונכרן" },
    stale: { cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/40", Icon: AlertTriangle, label: "ייתכן שמיושן" },
    never: { cls: "bg-muted text-muted-foreground border-border", Icon: Cloud, label: "טרם סונכרן" },
    off: { cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: CloudOff, label: "סנכרון כבוי" },
  }[status];

  const Icon = palette.Icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleRefresh}
          dir="rtl"
          className={cn(
            "fixed bottom-3 left-3 z-[60] flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm backdrop-blur transition hover:shadow-md hover:scale-[1.03]",
            palette.cls,
          )}
          aria-label="מצב סנכרון IDB עם הענן"
        >
          <Icon className="h-3.5 w-3.5" />
          <span>{palette.label}</span>
          <span className="opacity-70">·</span>
          <span className="font-mono opacity-90">{formatRelative(lastSync)}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" dir="rtl" className="text-right">
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-1.5 font-semibold">
            <Icon className="h-3.5 w-3.5" />
            {palette.label}
          </div>
          <div>סנכרון אחרון: <span className="font-mono">{formatAbsolute(lastSync)}</span></div>
          <div>טעינה מלאה אחרונה: <span className="font-mono">{formatAbsolute(lastFull)}</span></div>
          {cloudCardsCount > 0 && <div>כרטיסים IDB / ענן: <span className="font-mono">{localCardsCount.toLocaleString("he-IL")} / {cloudCardsCount.toLocaleString("he-IL")}</span></div>}
          {!syncOn && <div className="text-destructive">הסנכרון כבוי בהגדרות</div>}
          {status === "stale" && syncOn && <div className="text-amber-600 dark:text-amber-400">מומלץ לרענן את הדף</div>}
          <div className="flex items-center gap-1 pt-1 text-muted-foreground">
            <RefreshCw className="h-3 w-3" />
            לחיצה תרענן את הדף
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
