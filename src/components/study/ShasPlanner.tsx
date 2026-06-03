/**
 * ShasPlanner — מסך תכנון לסיום הש"ס.
 * מציג מה נשאר לכל סדר/מסכת, מודד את הקצב מהיומן (shasBoardLog),
 * ומחשב יעד יומי / שבועי + תאריך סיום משוער.
 */
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { CalendarClock, Flame, Sparkles, Target, TrendingUp } from "lucide-react";
import { useStudy } from "@/lib/study/store";
import { SHAS_BAVLI, SEDARIM } from "@/lib/study/shasData";
import { computePace, estimateFinishDate } from "@/lib/study/shasBoardLog";

const TOTAL_AMUDIM = SHAS_BAVLI.reduce((s, m) => s + m.pages * 2, 0);

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "long", year: "numeric" });
}
function fmtNum(n: number) { return n.toLocaleString("he-IL"); }

export function ShasPlanner() {
  const { state, setUiPref } = useStudy();
  const progress = ((state.uiPrefs as any)?.shasBoardProgress ?? {}) as Record<string, Record<number, { a?: number; b?: number }>>;
  const log = ((state.uiPrefs as any)?.shasBoardLog ?? {}) as Record<string, number>;
  const customTarget = (state.uiPrefs as any)?.shasBoardDailyTarget as number | undefined;

  const [window, setWindow] = useState<7 | 14 | 30 | 90>(14);

  // Per-masechta + per-seder remaining
  const stats = useMemo(() => {
    const perMasechta = SHAS_BAVLI.map((m) => {
      const mp = progress[m.name] ?? {};
      let learned = 0;
      for (const e of Object.values(mp)) {
        if ((e.a ?? 0) > 0) learned++; if ((e.b ?? 0) > 0) learned++;
      }
      const total = m.pages * 2;
      return { name: m.name, seder: m.seder, total, learned, remaining: total - learned };
    });
    const perSeder: Record<string, { learned: number; total: number; remaining: number; masechtot: number }> = {};
    for (const s of SEDARIM) perSeder[s] = { learned: 0, total: 0, remaining: 0, masechtot: 0 };
    for (const m of perMasechta) {
      perSeder[m.seder].learned += m.learned;
      perSeder[m.seder].total += m.total;
      perSeder[m.seder].remaining += m.remaining;
      perSeder[m.seder].masechtot++;
    }
    const learned = perMasechta.reduce((a, b) => a + b.learned, 0);
    return { perMasechta, perSeder, learned, remaining: TOTAL_AMUDIM - learned };
  }, [progress]);

  const pace = useMemo(() => computePace(log, window), [log, window]);

  // Effective per-day used for projections
  const autoPerDay = pace.avgPerDay;
  const effectivePerDay = customTarget && customTarget > 0 ? customTarget : autoPerDay;

  const finishAuto = estimateFinishDate(stats.remaining, autoPerDay);
  const finishCustom = estimateFinishDate(stats.remaining, effectivePerDay);

  // Suggested targets aimed at various completion horizons
  const horizons = [
    { label: "חצי שנה", days: 182 },
    { label: "שנה", days: 365 },
    { label: "שנתיים", days: 730 },
    { label: "7 שנים (דף יומי)", days: 7 * 365 },
  ];

  return (
    <div className="space-y-4" dir="rtl">
      {/* Pace summary */}
      <Card className="gold-frame p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="gold-icon-circle"><TrendingUp className="h-5 w-5" /></span>
          <h2 className="font-display text-2xl font-bold">תכנון לסיום ש"ס</h2>
          <Badge variant="outline" className="border-gold/60">
            נשארו {fmtNum(stats.remaining)} עמודים
          </Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-muted-foreground">חלון ניתוח קצב:</span>
          {([7, 14, 30, 90] as const).map((w) => (
            <Button
              key={w}
              size="sm"
              variant={window === w ? "default" : "outline"}
              className={window === w ? "bg-gold text-primary-foreground hover:bg-gold/90" : ""}
              onClick={() => setWindow(w)}
            >
              {w} ימים
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="text-center p-3 rounded-md bg-secondary">
            <div className="text-muted-foreground">קצב ממוצע</div>
            <div className="font-bold text-gold text-lg">{pace.avgPerDay.toFixed(1)}</div>
            <div className="text-[10px] text-muted-foreground">עמודים / יום</div>
          </div>
          <div className="text-center p-3 rounded-md bg-secondary">
            <div className="text-muted-foreground">ימי לימוד</div>
            <div className="font-bold text-lg">{pace.activeDays}/{window}</div>
            <div className="text-[10px] text-muted-foreground">בחלון</div>
          </div>
          <div className="text-center p-3 rounded-md bg-secondary">
            <div className="text-muted-foreground flex items-center justify-center gap-1">
              <Flame className="h-3 w-3" /> רצף
            </div>
            <div className="font-bold text-lg">{pace.streak}</div>
            <div className="text-[10px] text-muted-foreground">ימים רצופים</div>
          </div>
          <div className="text-center p-3 rounded-md bg-secondary">
            <div className="text-muted-foreground">שיא יומי</div>
            <div className="font-bold text-lg">{pace.bestDay}</div>
            <div className="text-[10px] text-muted-foreground">בחלון</div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground p-2 rounded-md bg-card border border-gold/30 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-gold shrink-0" />
          {pace.avgPerDay > 0
            ? <>בקצב הנוכחי תסיים ב-<strong className="text-foreground">{fmtDate(finishAuto)}</strong> (≈ {Math.ceil(stats.remaining / autoPerDay)} ימים)</>
            : <>אין מספיק נתונים עדיין — סמן עמודים בלוח כדי למדוד את הקצב.</>}
        </div>
      </Card>

      {/* Daily target setter */}
      <Card className="gold-frame p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle"><Target className="h-5 w-5" /></span>
          <h3 className="font-display text-lg font-bold">יעד יומי מותאם אישית</h3>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            type="number"
            min={0}
            max={50}
            value={customTarget ?? ""}
            placeholder={`אוטומטי (${autoPerDay.toFixed(1)})`}
            onChange={(e) => {
              const v = e.target.value === "" ? undefined : Math.max(0, Number(e.target.value));
              setUiPref("shasBoardDailyTarget", v as any);
            }}
            className="w-32"
          />
          <div className="flex-1 min-w-[180px]">
            <Slider
              value={[customTarget ?? Math.round(autoPerDay)]}
              min={0}
              max={20}
              step={1}
              onValueChange={(v) => setUiPref("shasBoardDailyTarget", (v[0] || 0) as any)}
            />
          </div>
          {customTarget !== undefined && (
            <Button size="sm" variant="ghost" onClick={() => setUiPref("shasBoardDailyTarget", undefined as any)}>
              חזרה לאוטומטי
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="p-3 rounded-md bg-secondary text-center">
            <div className="text-muted-foreground">יעד יומי</div>
            <div className="font-bold text-gold text-lg">{effectivePerDay.toFixed(1)} עמ׳</div>
          </div>
          <div className="p-3 rounded-md bg-secondary text-center">
            <div className="text-muted-foreground">יעד שבועי</div>
            <div className="font-bold text-gold text-lg">{(effectivePerDay * 7).toFixed(0)} עמ׳</div>
          </div>
          <div className="p-3 rounded-md bg-secondary text-center">
            <div className="text-muted-foreground">תאריך סיום</div>
            <div className="font-bold text-sm">{fmtDate(finishCustom)}</div>
          </div>
        </div>
      </Card>

      {/* What-if horizons */}
      <Card className="gold-frame p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle"><Sparkles className="h-5 w-5" /></span>
          <h3 className="font-display text-lg font-bold">מה צריך כדי לסיים בתוך…</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {horizons.map((h) => {
            const perDay = stats.remaining / h.days;
            const perWeek = perDay * 7;
            const reasonable = perDay <= 12;
            return (
              <div key={h.label} className="p-3 rounded-md bg-secondary flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{h.label}</div>
                  <div className="text-[11px] text-muted-foreground">{h.days} ימים</div>
                </div>
                <div className="text-end">
                  <div className={`font-bold text-base ${reasonable ? "text-gold" : "text-destructive"}`}>
                    {perDay.toFixed(1)} עמ׳/יום
                  </div>
                  <div className="text-[11px] text-muted-foreground">{perWeek.toFixed(0)} בשבוע</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setUiPref("shasBoardDailyTarget", Math.ceil(perDay) as any)}
                >
                  קבע
                </Button>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Per-seder breakdown */}
      <Card className="gold-frame p-4 space-y-3">
        <h3 className="font-display text-lg font-bold">סדרים — מה נשאר</h3>
        <div className="space-y-2">
          {SEDARIM.map((s) => {
            const st = stats.perSeder[s];
            const pct = Math.round((st.learned / st.total) * 100);
            const daysToFinish = effectivePerDay > 0 ? Math.ceil(st.remaining / effectivePerDay) : null;
            return (
              <div key={s} className="p-3 rounded-md border border-gold/30 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
                  <div className="font-semibold">סדר {s}</div>
                  <div className="flex gap-1 items-center">
                    <Badge variant="outline" className="border-gold/60 text-[10px]">{fmtNum(st.remaining)} נשארו</Badge>
                    <Badge variant="secondary" className="text-[10px]">{pct}%</Badge>
                  </div>
                </div>
                <Progress value={pct} className="h-1.5" />
                {daysToFinish !== null && st.remaining > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    בקצב {effectivePerDay.toFixed(1)}/יום — {daysToFinish} ימים (≈ {fmtDate(estimateFinishDate(st.remaining, effectivePerDay))})
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Per-masechta remaining list (top remaining first) */}
      <Card className="gold-frame p-4 space-y-3">
        <h3 className="font-display text-lg font-bold">מסכתות — מיון לפי מה שנשאר</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[...stats.perMasechta].sort((a, b) => b.remaining - a.remaining).map((m) => {
            const pct = Math.round((m.learned / m.total) * 100);
            const days = effectivePerDay > 0 && m.remaining > 0 ? Math.ceil(m.remaining / effectivePerDay) : null;
            return (
              <div key={m.name} className="p-3 rounded-md border border-gold/30 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm">{m.name}</span>
                  <Badge variant={m.remaining === 0 ? "default" : "outline"} className={m.remaining === 0 ? "bg-gold text-primary-foreground" : "border-gold/60"}>
                    {m.remaining === 0 ? "הושלם" : `${fmtNum(m.remaining)} נשארו`}
                  </Badge>
                </div>
                <Progress value={pct} className="h-1" />
                <div className="text-[10px] text-muted-foreground">
                  {m.learned}/{m.total} · {m.seder}
                  {days !== null && <> · {days} ימים</>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
