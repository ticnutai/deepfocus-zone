import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Activity, TrendingUp, TrendingDown, Minus, Target, AlertTriangle,
  CheckCircle2, Clock, Flame,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useStudy } from "@/lib/study/store";
import type { ReviewLog, Card as CardT, ShasReview, PlanReview } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { PracticeProgress } from "./PracticeProgress";

const DAY = 24 * 60 * 60 * 1000;
const dateKey = (ms: number) => {
  const d = new Date(ms);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"),
        dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const startOfDay = (ms: number) => {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime();
};
const fmtPct = (n: number) => `${Math.round(n)}%`;
const fmtMs = (ms: number) => ms < 1000 ? `${Math.round(ms)}מ״ש` : `${(ms/1000).toFixed(1)}ש`;

type DayStats = {
  date: string;
  weekday: string;
  reviews: number;
  correct: number;
  accuracy: number;
  avgMs: number;
  uniqueCards: number;
};

function aggregateDay(logs: ReviewLog[]): Omit<DayStats, "date" | "weekday"> {
  const reviews = logs.length;
  const correct = logs.filter((l) => l.correct).length;
  const accuracy = reviews ? (correct / reviews) * 100 : 0;
  const avgMs = reviews ? logs.reduce((s, l) => s + (l.durationMs || 0), 0) / reviews : 0;
  const uniqueCards = new Set(logs.map((l) => l.cardId)).size;
  return { reviews, correct, accuracy, avgMs, uniqueCards };
}

const HEB_DAYS = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];

function Delta({ now, prev, kind = "higher-better", suffix = "" }: {
  now: number; prev: number; kind?: "higher-better" | "lower-better"; suffix?: string;
}) {
  if (prev === 0 && now === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const diff = now - prev;
  const pct = prev !== 0 ? (diff / prev) * 100 : 100;
  const isImprovement = kind === "higher-better" ? diff > 0 : diff < 0;
  const isFlat = Math.abs(diff) < 0.001 || (kind === "higher-better" && Math.abs(pct) < 2);
  if (isFlat) return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Minus className="h-3 w-3" /> ללא שינוי
    </span>
  );
  const Icon = isImprovement ? TrendingUp : TrendingDown;
  const cls = isImprovement ? "text-emerald-600" : "text-red-600";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", cls)}>
      <Icon className="h-3 w-3" />
      {diff > 0 ? "+" : ""}{Math.abs(pct) > 999 ? "999+" : Math.round(pct)}%{suffix}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, sub }: { icon: typeof Activity; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="p-4 gold-frame">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="font-display text-2xl font-bold text-navy">{value}</div>
          {sub && <div className="text-xs">{sub}</div>}
        </div>
        <div className="rounded-lg bg-gradient-navy p-2">
          <Icon className="h-4 w-4 text-primary-foreground" />
        </div>
      </div>
    </Card>
  );
}

export const SummaryDashboard = () => {
  const { state } = useStudy();
  const [tab, setTab] = useState("daily");

  // ─── Day-by-day for last 30 days ────────────────────────────────────────
  const dayStats = useMemo<DayStats[]>(() => {
    const today0 = startOfDay(Date.now());
    const out: DayStats[] = [];
    for (let i = 29; i >= 0; i--) {
      const start = today0 - i * DAY;
      const end = start + DAY;
      const logs = state.logs.filter((l) => l.at >= start && l.at < end);
      const k = dateKey(start);
      out.push({
        date: k,
        weekday: HEB_DAYS[new Date(start).getDay()],
        ...aggregateDay(logs),
      });
    }
    return out;
  }, [state.logs]);

  const today = dayStats[dayStats.length - 1];
  const yesterday = dayStats[dayStats.length - 2];

  // streak: consecutive days with reviews ending today (or yesterday)
  const streak = useMemo(() => {
    let n = 0;
    for (let i = dayStats.length - 1; i >= 0; i--) {
      if (dayStats[i].reviews > 0) n++;
      else if (i === dayStats.length - 1) continue; // allow today empty
      else break;
    }
    return n;
  }, [dayStats]);

  // ─── This week vs last week ─────────────────────────────────────────────
  const weekly = useMemo(() => {
    const last7 = dayStats.slice(-7);
    const prev7 = dayStats.slice(-14, -7);
    const sum = (arr: DayStats[]) => {
      const reviews = arr.reduce((s, d) => s + d.reviews, 0);
      const correct = arr.reduce((s, d) => s + d.correct, 0);
      const totalMs = arr.reduce((s, d) => s + d.avgMs * d.reviews, 0);
      return {
        reviews,
        correct,
        accuracy: reviews ? (correct / reviews) * 100 : 0,
        avgMs: reviews ? totalMs / reviews : 0,
        activeDays: arr.filter((d) => d.reviews > 0).length,
      };
    };
    return { now: sum(last7), prev: sum(prev7) };
  }, [dayStats]);

  // ─── Per-masechet (last 7 vs previous 7) ────────────────────────────────
  const cardById = useMemo(() => {
    const m = new Map<string, CardT>();
    state.cards.forEach((c) => m.set(c.id, c));
    return m;
  }, [state.cards]);

  const perMasechet = useMemo(() => {
    const today0 = startOfDay(Date.now());
    const last7Start = today0 - 6 * DAY;
    const prev7Start = today0 - 13 * DAY;
    const stats = new Map<string, { recent: ReviewLog[]; prior: ReviewLog[] }>();
    for (const log of state.logs) {
      const card = cardById.get(log.cardId);
      if (!card) continue;
      const masechetTag = card.tags?.find((t) => t.startsWith("cat:") && t !== "cat:תלמוד בבלי" && !t.startsWith("cat:דף "));
      if (!masechetTag) continue;
      const masechet = masechetTag.slice(4);
      if (!stats.has(masechet)) stats.set(masechet, { recent: [], prior: [] });
      const bucket = stats.get(masechet)!;
      if (log.at >= last7Start) bucket.recent.push(log);
      else if (log.at >= prev7Start && log.at < last7Start) bucket.prior.push(log);
    }
    return Array.from(stats.entries()).map(([name, { recent, prior }]) => {
      const r = aggregateDay(recent);
      const p = aggregateDay(prior);
      const accDelta = p.reviews ? r.accuracy - p.accuracy : 0;
      const reviewsDelta = p.reviews ? ((r.reviews - p.reviews) / p.reviews) * 100 : (r.reviews ? 100 : 0);
      const regression =
        (p.reviews >= 5 && r.reviews >= 5 && (accDelta <= -10 || reviewsDelta <= -25));
      return {
        name,
        recent: r,
        prior: p,
        accDelta,
        reviewsDelta,
        regression,
      };
    }).sort((a, b) => b.recent.reviews - a.recent.reviews);
  }, [state.logs, cardById]);

  // ─── Schedule adherence ─────────────────────────────────────────────────
  const adherence = useMemo(() => {
    const todayKey = dateKey(Date.now());
    const shasRevs: ShasReview[] = state.shasReviews ?? [];
    const planRevs: PlanReview[] = state.planReviews ?? [];

    const dueByToday = (r: { dueDate: string; doneAt: string | null }) => r.dueDate <= todayKey;
    const onTime = (r: { dueDate: string; doneAt: string | null }) =>
      !!r.doneAt && r.doneAt <= r.dueDate;

    const shasDue = shasRevs.filter((r) => !r.isInitial && dueByToday(r));
    const shasDone = shasDue.filter((r) => !!r.doneAt).length;
    const shasOnTime = shasDue.filter(onTime).length;
    const shasOverdue = shasRevs.filter((r) => !r.isInitial && !r.doneAt && r.dueDate < todayKey).length;

    const planDue = planRevs.filter(dueByToday);
    const planDone = planDue.filter((r) => !!r.doneAt).length;
    const planOnTime = planDue.filter(onTime).length;
    const planOverdue = planRevs.filter((r) => !r.doneAt && r.dueDate < todayKey).length;

    return { shasDue, shasDone, shasOnTime, shasOverdue, planDue, planDone, planOnTime, planOverdue };
  }, [state.shasReviews, state.planReviews]);

  // ─── Regression alerts (combined) ───────────────────────────────────────
  const regressions = useMemo(() => {
    const alerts: { kind: "weekly"|"masechet"|"overdue"; title: string; detail: string }[] = [];
    if (weekly.prev.reviews >= 10) {
      const dropPct = ((weekly.now.reviews - weekly.prev.reviews) / weekly.prev.reviews) * 100;
      if (dropPct <= -20) alerts.push({
        kind: "weekly",
        title: "ירידה משמעותית בפעילות השבועית",
        detail: `${weekly.now.reviews} חזרות השבוע מול ${weekly.prev.reviews} בשבוע הקודם (${Math.round(dropPct)}%)`,
      });
      if (weekly.prev.accuracy - weekly.now.accuracy >= 8) alerts.push({
        kind: "weekly",
        title: "ירידה בדיוק השבועי",
        detail: `${fmtPct(weekly.now.accuracy)} השבוע מול ${fmtPct(weekly.prev.accuracy)} בשבוע הקודם`,
      });
    }
    perMasechet.filter((m) => m.regression).slice(0, 5).forEach((m) =>
      alerts.push({
        kind: "masechet",
        title: `רגרסיה ב${m.name}`,
        detail: `דיוק: ${fmtPct(m.recent.accuracy)} (היה ${fmtPct(m.prior.accuracy)}) · חזרות: ${m.recent.reviews} (היה ${m.prior.reviews})`,
      })
    );
    if (adherence.shasOverdue > 0) alerts.push({
      kind: "overdue",
      title: "חזרות ש״ס באיחור",
      detail: `${adherence.shasOverdue} חזרות עברו את התאריך`,
    });
    if (adherence.planOverdue > 0) alerts.push({
      kind: "overdue",
      title: "חזרות תוכניות באיחור",
      detail: `${adherence.planOverdue} פריטים עברו את התאריך`,
    });
    return alerts;
  }, [weekly, perMasechet, adherence]);

  return (
    <div className="space-y-6" dir="rtl">
      <PracticeProgress />
      {/* ─── KPI strip ─────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={Activity}
          label="חזרות היום"
          value={today.reviews}
          sub={<Delta now={today.reviews} prev={yesterday.reviews} />}
        />
        <KpiCard
          icon={Target}
          label="דיוק היום"
          value={today.reviews ? fmtPct(today.accuracy) : "—"}
          sub={<Delta now={today.accuracy} prev={yesterday.accuracy} />}
        />
        <KpiCard
          icon={Clock}
          label="זמן ממוצע"
          value={today.reviews ? fmtMs(today.avgMs) : "—"}
          sub={<Delta now={today.avgMs} prev={yesterday.avgMs} kind="lower-better" />}
        />
        <KpiCard
          icon={Flame}
          label="רצף ימים"
          value={`${streak} ימים`}
          sub={<span className="text-xs text-muted-foreground">פעילים ברצף</span>}
        />
      </div>

      {/* ─── Regressions / alerts ─────────────────────── */}
      {regressions.length > 0 && (
        <Card className="p-4 border-2 border-red-500/40 bg-red-50/50 dark:bg-red-950/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <h3 className="font-display text-base font-semibold text-red-700 dark:text-red-400">
              התראות והערות חשובות
            </h3>
          </div>
          <ul className="space-y-1.5 text-sm">
            {regressions.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-red-600 mt-0.5">•</span>
                <span><strong>{a.title}</strong> — <span className="text-muted-foreground">{a.detail}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ─── Tabs ──────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl mx-auto">
          <TabsTrigger value="daily">7 ימים</TabsTrigger>
          <TabsTrigger value="weekly">שבוע מול שבוע</TabsTrigger>
          <TabsTrigger value="trend">מגמה 30 ימים</TabsTrigger>
          <TabsTrigger value="masechet">לפי מסכת</TabsTrigger>
        </TabsList>

        {/* Daily comparison */}
        <TabsContent value="daily" className="mt-4">
          <Card className="gold-frame p-4">
            <h3 className="font-display text-lg font-semibold mb-3">השוואת 7 ימים אחרונים</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">תאריך</TableHead>
                    <TableHead className="text-right">יום</TableHead>
                    <TableHead className="text-right">חזרות</TableHead>
                    <TableHead className="text-right">דיוק</TableHead>
                    <TableHead className="text-right">זמן ממ׳</TableHead>
                    <TableHead className="text-right">קלפים שונים</TableHead>
                    <TableHead className="text-right">שינוי דיוק</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayStats.slice(-7).map((d, i, arr) => {
                    const prev = i > 0 ? arr[i-1] : undefined;
                    const accDelta = prev && prev.reviews && d.reviews ? d.accuracy - prev.accuracy : 0;
                    return (
                      <TableRow key={d.date}>
                        <TableCell className="font-mono text-xs">{d.date}</TableCell>
                        <TableCell>{d.weekday}</TableCell>
                        <TableCell className="font-semibold">{d.reviews || "—"}</TableCell>
                        <TableCell>{d.reviews ? fmtPct(d.accuracy) : "—"}</TableCell>
                        <TableCell>{d.reviews ? fmtMs(d.avgMs) : "—"}</TableCell>
                        <TableCell>{d.uniqueCards || "—"}</TableCell>
                        <TableCell>
                          {prev?.reviews && d.reviews ? (
                            <span className={cn(
                              "text-xs font-medium",
                              accDelta > 1 ? "text-emerald-600" : accDelta < -1 ? "text-red-600" : "text-muted-foreground"
                            )}>
                              {accDelta > 0 ? "+" : ""}{accDelta.toFixed(1)} נק׳
                            </span>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Week vs Week */}
        <TabsContent value="weekly" className="mt-4">
          <Card className="gold-frame p-4">
            <h3 className="font-display text-lg font-semibold mb-3">השבוע הזה מול השבוע הקודם</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">מדד</TableHead>
                  <TableHead className="text-right">השבוע</TableHead>
                  <TableHead className="text-right">שבוע קודם</TableHead>
                  <TableHead className="text-right">שינוי</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { label: "סה״כ חזרות", n: weekly.now.reviews, p: weekly.prev.reviews, kind: "higher-better" as const },
                  { label: "תשובות נכונות", n: weekly.now.correct, p: weekly.prev.correct, kind: "higher-better" as const },
                  { label: "אחוז דיוק", n: weekly.now.accuracy, p: weekly.prev.accuracy, kind: "higher-better" as const, fmt: fmtPct },
                  { label: "זמן ממוצע", n: weekly.now.avgMs, p: weekly.prev.avgMs, kind: "lower-better" as const, fmt: (v: number) => v ? fmtMs(v) : "—" },
                  { label: "ימים פעילים", n: weekly.now.activeDays, p: weekly.prev.activeDays, kind: "higher-better" as const, fmt: (v: number) => `${v}/7` },
                ].map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="font-bold text-navy">{row.fmt ? row.fmt(row.n) : Math.round(row.n)}</TableCell>
                    <TableCell className="text-muted-foreground">{row.fmt ? row.fmt(row.p) : Math.round(row.p)}</TableCell>
                    <TableCell><Delta now={row.n} prev={row.p} kind={row.kind} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* 30-day trend */}
        <TabsContent value="trend" className="mt-4">
          <Card className="gold-frame p-4">
            <h3 className="font-display text-lg font-semibold mb-3">מגמת 30 הימים האחרונים</h3>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dayStats} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={3} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === "אחוז דיוק" ? [`${value.toFixed(1)}%`, name] : [value, name]
                    }
                    labelFormatter={(d) => `תאריך: ${d}`}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="reviews" name="חזרות" fill="hsl(220 70% 25%)" />
                  <Line yAxisId="right" type="monotone" dataKey="accuracy" name="אחוז דיוק" stroke="hsl(45 85% 55%)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>

        {/* Per masechet */}
        <TabsContent value="masechet" className="mt-4">
          <Card className="gold-frame p-4">
            <h3 className="font-display text-lg font-semibold mb-3">פילוח לפי מסכת (7 ימים מול שבוע קודם)</h3>
            {perMasechet.length === 0 ? (
              <p className="text-muted-foreground text-sm py-6 text-center">אין נתוני חזרות בתקופה זו</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">מסכת</TableHead>
                      <TableHead className="text-right">חזרות (השבוע)</TableHead>
                      <TableHead className="text-right">דיוק</TableHead>
                      <TableHead className="text-right">שינוי דיוק</TableHead>
                      <TableHead className="text-right">שינוי כמות</TableHead>
                      <TableHead className="text-right">סטטוס</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {perMasechet.slice(0, 20).map((m) => (
                      <TableRow key={m.name} className={m.regression ? "bg-red-50/50 dark:bg-red-950/20" : ""}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell>{m.recent.reviews}{m.prior.reviews > 0 && <span className="text-xs text-muted-foreground"> (היה {m.prior.reviews})</span>}</TableCell>
                        <TableCell>{m.recent.reviews ? fmtPct(m.recent.accuracy) : "—"}</TableCell>
                        <TableCell>
                          {m.prior.reviews >= 3 && m.recent.reviews >= 3 ? (
                            <span className={cn("text-xs font-medium", m.accDelta > 1 ? "text-emerald-600" : m.accDelta < -1 ? "text-red-600" : "text-muted-foreground")}>
                              {m.accDelta > 0 ? "+" : ""}{m.accDelta.toFixed(1)} נק׳
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {m.prior.reviews >= 3 ? <Delta now={m.recent.reviews} prev={m.prior.reviews} /> : "—"}
                        </TableCell>
                        <TableCell>
                          {m.regression ? (
                            <Badge variant="destructive" className="gap-1"><TrendingDown className="h-3 w-3" /> רגרסיה</Badge>
                          ) : m.recent.accuracy >= 80 && m.recent.reviews >= 5 ? (
                            <Badge className="bg-emerald-600 gap-1"><CheckCircle2 className="h-3 w-3" /> טוב</Badge>
                          ) : (
                            <Badge variant="outline">רגיל</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Schedule adherence ────────────────────────── */}
      <Card className="gold-frame p-4">
        <h3 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
          <Target className="h-5 w-5 text-gold" />
          עמידה בלו״ז
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 rounded-lg border-2 border-gold/30 bg-card/50">
            <div className="text-sm font-semibold mb-2">חזרות ש״ס</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">צפוי עד היום:</span>
                <span className="font-mono">{adherence.shasDue.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">בוצע:</span>
                <span className="font-mono">{adherence.shasDone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">בוצע בזמן:</span>
                <span className="font-mono text-emerald-600">{adherence.shasOnTime} ({adherence.shasDue.length ? fmtPct(adherence.shasOnTime / adherence.shasDue.length * 100) : "—"})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">באיחור (לא בוצע):</span>
                <span className={cn("font-mono", adherence.shasOverdue ? "text-red-600 font-bold" : "")}>{adherence.shasOverdue}</span>
              </div>
            </div>
          </div>
          <div className="p-3 rounded-lg border-2 border-gold/30 bg-card/50">
            <div className="text-sm font-semibold mb-2">חזרות תוכניות לימוד</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">צפוי עד היום:</span>
                <span className="font-mono">{adherence.planDue.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">בוצע:</span>
                <span className="font-mono">{adherence.planDone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">בוצע בזמן:</span>
                <span className="font-mono text-emerald-600">{adherence.planOnTime} ({adherence.planDue.length ? fmtPct(adherence.planOnTime / adherence.planDue.length * 100) : "—"})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">באיחור (לא בוצע):</span>
                <span className={cn("font-mono", adherence.planOverdue ? "text-red-600 font-bold" : "")}>{adherence.planOverdue}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default SummaryDashboard;
