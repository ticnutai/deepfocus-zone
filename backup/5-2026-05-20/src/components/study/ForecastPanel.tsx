import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { TrendingUp, Target, Layers } from "lucide-react";
import { useStudy } from "@/lib/study/store";
import {
  forecastReviews,
  trueRetention,
  maturityDistribution,
  filterLogs,
  computeRange,
} from "@/lib/study/analytics";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface Props {
  deckId?: string;
}

export function ForecastPanel({ deckId }: Props) {
  const { state } = useStudy();

  const cards = useMemo(
    () => (deckId ? state.cards.filter((c) => c.deckId === deckId) : state.cards),
    [state.cards, deckId],
  );

  const forecast = useMemo(() => forecastReviews(cards, 30), [cards]);

  // Count pending plan + shas reviews per day in the 30-day window
  const planForecast = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const counts: number[] = new Array(30).fill(0);
    const allScheduled = [
      ...(state.planReviews ?? []),
      ...(state.shasReviews ?? []).filter((r) => !r.isInitial),
    ];
    for (const r of allScheduled) {
      if (r.doneAt) continue;
      const due = new Date(r.dueDate + "T00:00:00");
      const dayOffset = Math.round((due.getTime() - today.getTime()) / 86400000);
      // Put overdue reviews on today (day 0)
      const idx = dayOffset < 0 ? 0 : dayOffset;
      if (idx < 30) counts[idx]++;
    }
    return counts;
  }, [state.planReviews, state.shasReviews]);

  const mergedForecast = useMemo(
    () => forecast.map((p, i) => ({ ...p, planCount: planForecast[i] })),
    [forecast, planForecast],
  );

  const maxCount = useMemo(() => Math.max(1, ...mergedForecast.map((p) => p.count + p.planCount)), [mergedForecast]);
  const totalNext30 = useMemo(() => mergedForecast.reduce((s, p) => s + p.count + p.planCount, 0), [mergedForecast]);
  const avgPerDay = Math.round(totalNext30 / 30);
  const hasPlanReviews = planForecast.some((c) => c > 0);

  const retention = useMemo(() => {
    const range = computeRange("30");
    const logs = filterLogs(state, range, deckId);
    return trueRetention(state, logs);
  }, [state, deckId]);

  const maturity = useMemo(() => maturityDistribution(cards), [cards]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Forecast */}
      <Card className="gold-frame p-5 space-y-4" dir="rtl">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-gold" />
            תחזית חזרות (30 ימים)
          </h3>
          <div className="text-sm text-muted-foreground">
            סה&quot;כ 30 ימים: <span className="font-semibold text-foreground">{totalNext30}</span> · ממוצע <span className="font-semibold text-foreground">{avgPerDay}/יום</span>
          </div>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mergedForecast} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} reversed />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} orientation="right" />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [
                  `${v} חזרות`,
                  name === "count" ? "כרטיסיות" : "תוכניות",
                ]}
                labelFormatter={(l) => `תאריך: ${l}`}
              />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} maxBarSize={20} stackId="a" />
              <Bar dataKey="planCount" fill="hsl(142 65% 42%)" radius={[4, 4, 0, 0]} maxBarSize={20} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {hasPlanReviews && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground justify-end">
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm inline-block" style={{ background: "hsl(var(--primary))" }} />
              כרטיסיות SRS
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm inline-block bg-emerald-600" />
              חזרות תוכנית
            </span>
          </div>
        )}
        {maxCount > avgPerDay * 3 && avgPerDay > 5 && (
          <div className="text-xs text-amber-600 dark:text-amber-400 text-right">
            ⚠ יש ימים עם עומס כפול מהממוצע — שקול להוסיף חזרות מוקדמות.
          </div>
        )}
      </Card>

      {/* True retention */}
      <Card className="gold-frame p-5 space-y-3" dir="rtl">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold flex items-center gap-2">
            <Target className="h-5 w-5 text-gold" />
            שמירה אמיתית (True Retention)
          </h3>
          <div className="text-sm text-muted-foreground">30 הימים האחרונים</div>
        </div>
        {retention.total === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-3">אין מספיק נתונים עדיין</div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <RetentionStat label="סה״כ" value={retention.retention} count={retention.total} />
            <RetentionStat label="צעירים" value={retention.young.retention} count={retention.young.total} />
            <RetentionStat label="בשלים" value={retention.mature.retention} count={retention.mature.total} />
          </div>
        )}
        <p className="text-xs text-muted-foreground text-right">
          יעד מומלץ: 90%. ירידה מתחת 80% מצריכה הקטנת מרווחים או מעבר ל-FSRS.
        </p>
      </Card>

      {/* Maturity */}
      <Card className="gold-frame p-5 space-y-3" dir="rtl">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold flex items-center gap-2">
            <Layers className="h-5 w-5 text-gold" />
            בריאות הספרייה
          </h3>
          <div className="text-sm text-muted-foreground">{cards.length} כרטיסים</div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {maturity.map((b) => (
            <div key={b.label} className="rounded-xl border-2 border-gold/30 p-3 text-center">
              <div className="text-2xl font-display font-bold text-foreground">{b.count}</div>
              <div className="text-xs text-muted-foreground mt-1">{b.label}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RetentionStat({ label, value, count }: { label: string; value: number; count: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 90 ? "text-green-600" : pct >= 80 ? "text-gold" : "text-destructive";
  return (
    <div className="rounded-xl border-2 border-gold/30 p-3 text-center">
      <div className={`text-3xl font-display font-bold ${color}`}>{pct}%</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
      <div className="text-[10px] text-muted-foreground">{count} חזרות</div>
    </div>
  );
}
