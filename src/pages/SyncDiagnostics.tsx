import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import {
  useStudy,
  getCurrentStudyCardsCount,
  getLastCloudSyncAt,
  getLastFullSyncAt,
  getFullRefreshTtlMs,
  getLastKnownCloudCardsCount,
} from "@/lib/study/store";
import { isSyncEnabled, subscribeSyncEnabled } from "@/lib/study/syncControl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, ArrowRight } from "lucide-react";

const STALE_MS = 5 * 60 * 1000;
const AUTO_RESYNC_THRESHOLD_MS = 10 * 60 * 1000;

function fmtAbs(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("he-IL", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return new Date(ms).toISOString(); }
}

function fmtRel(ms: number): string {
  if (!ms) return "מעולם";
  const diff = Date.now() - ms;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `לפני ${s} שנ'`;
  const m = Math.floor(s / 60);
  if (m < 60) return `לפני ${m} ד'`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} ש'`;
  return `לפני ${Math.floor(h / 24)} י'`;
}

function fmtMs(ms: number): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} שנ'`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ד'`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} ש'`;
  return `${Math.round(h / 24)} י'`;
}

function Row({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "ok" | "warn" | "bad" }) {
  const toneCls = tone === "ok"
    ? "text-emerald-700 dark:text-emerald-400"
    : tone === "warn"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "bad"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className={`font-mono text-sm whitespace-nowrap ${toneCls}`}>{value}</div>
    </div>
  );
}

export default function SyncDiagnostics() {
  const { user } = useAuth();
  const { requestCloudSyncNow } = useStudy();
  const uid = user?.id ?? null;
  const [, force] = useState(0);
  const [syncOn, setSyncOn] = useState<boolean>(() => isSyncEnabled());
  const [isSyncingNow, setIsSyncingNow] = useState(false);

  useEffect(() => subscribeSyncEnabled(setSyncOn), []);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 2000);
    return () => window.clearInterval(id);
  }, []);

  if (!uid) {
    return (
      <div dir="rtl" className="container max-w-2xl py-10 text-center">
        <p className="text-muted-foreground">יש להתחבר כדי לראות אבחון סנכרון.</p>
      </div>
    );
  }

  const lastSync = getLastCloudSyncAt(uid);
  const lastFull = getLastFullSyncAt(uid);
  const ttl = getFullRefreshTtlMs();
  const localCards = getCurrentStudyCardsCount();
  const cloudCards = getLastKnownCloudCardsCount(uid);
  const ageSync = lastSync ? Date.now() - lastSync : Infinity;
  const ageFull = lastFull ? Date.now() - lastFull : Infinity;
  const mismatch = cloudCards > 0 && localCards !== cloudCards;
  const isStale = !lastSync || ageSync > STALE_MS;
  const isVeryStale = lastFull > 0 && ageFull > ttl;
  const tooOld = lastSync > 0 && ageSync > AUTO_RESYNC_THRESHOLD_MS;
  const autoResyncWillFire = syncOn && (tooOld || mismatch || isVeryStale);

  const handleManualSyncNow = useCallback(async () => {
    if (isSyncingNow) return;
    setIsSyncingNow(true);
    try {
      const result = await requestCloudSyncNow("sync-diagnostics");
      if (result?.ok) {
        toast({
          title: "הסנכרון הושלם",
          description: "הנתונים מול הענן עודכנו בהצלחה.",
        });
      } else {
        toast({
          title: "הסנכרון הושלם חלקית",
          description: `נשארו ${result?.pendingAfter ?? 0} פעולות בתור לנסיון חוזר.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "שגיאה לא ידועה";
      toast({
        title: "סנכרון ידני נכשל",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSyncingNow(false);
      force((n) => n + 1);
    }
  }, [isSyncingNow, requestCloudSyncNow]);

  return (
    <div dir="rtl" className="container max-w-2xl py-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="h-4 w-4" />
          חזרה
        </Link>
        <h1 className="text-xl font-bold">אבחון סנכרון IDB / ענן</h1>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">סטטוס כללי</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          <Row label="סנכרון מופעל" value={syncOn ? "כן" : "לא"} tone={syncOn ? "ok" : "bad"} />
          <Row label="משתמש" value={<span className="text-xs">{uid.slice(0, 8)}…</span>} />
          <Row
            label="צפוי ריענון אוטומטי?"
            value={autoResyncWillFire ? "כן" : "לא"}
            tone={autoResyncWillFire ? "warn" : "ok"}
            hint="מופעל כאשר עברו >10 ד' מהסנכרון, יש פער מונה, או חריגה מ-TTL"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">חותמות זמן</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          <Row
            label="lastSync (delta/bootstrap אחרון)"
            value={fmtAbs(lastSync)}
            hint={fmtRel(lastSync)}
            tone={isStale ? "warn" : "ok"}
          />
          <Row
            label="lastFull (טעינה מלאה אחרונה)"
            value={fmtAbs(lastFull)}
            hint={fmtRel(lastFull)}
            tone={isVeryStale ? "warn" : "ok"}
          />
          <Row
            label="TTL לטעינה מלאה"
            value={fmtMs(ttl)}
            hint={lastFull ? `נשאר: ${fmtMs(Math.max(0, ttl - ageFull))}` : "—"}
          />
          <Row
            label="סף ריענון אוטומטי"
            value={fmtMs(AUTO_RESYNC_THRESHOLD_MS)}
            hint="עברו מהסנכרון האחרון"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">מונה כרטיסים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          <Row label="localCardsCount (IDB)" value={localCards.toLocaleString("he-IL")} />
          <Row
            label="cloudCardsCount (אחרון ידוע)"
            value={cloudCards > 0 ? cloudCards.toLocaleString("he-IL") : "—"}
          />
          <Row
            label="פער"
            value={cloudCards > 0 ? (localCards - cloudCards).toLocaleString("he-IL") : "—"}
            tone={mismatch ? "bad" : "ok"}
            hint={mismatch ? "פער זה יפעיל ריענון אוטומטי" : "תואם"}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleManualSyncNow} size="sm" variant="outline" disabled={isSyncingNow}>
          <RefreshCw className={`h-4 w-4 ml-1 ${isSyncingNow ? "animate-spin" : ""}`} />
          {isSyncingNow ? "מסנכרן..." : "סנכרן עכשיו"}
        </Button>
      </div>
    </div>
  );
}
