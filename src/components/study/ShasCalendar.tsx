/**
 * ShasCalendar — תצוגת לוח שנה ליעדי לימוד ש"ס.
 * מציגה חודש-חודש את היעד היומי לפי הקצב שנקבע (ידני/אוטומטי),
 * סיכומים שבועיים, ותאריכי סיום צפויים פר סדר ופר מסכת.
 */
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, CalendarDays, Flag, Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStudy } from "@/lib/study/store";
import { SHAS_BAVLI, SEDARIM } from "@/lib/study/shasData";
import { computePace } from "@/lib/study/shasBoardLog";

const DOW = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

function isoKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtMonth(d: Date) {
  return d.toLocaleDateString("he-IL", { month: "long", year: "numeric" });
}
function fmtDate(d: Date) {
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "long", year: "numeric" });
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addDays(d: Date, n: number) { const o = new Date(d); o.setDate(o.getDate() + n); return o; }

export function ShasCalendar() {
  const { state } = useStudy();
  const progress = ((state.uiPrefs as any)?.shasBoardProgress ?? {}) as Record<string, Record<number, { a?: number; b?: number }>>;
  const log = ((state.uiPrefs as any)?.shasBoardLog ?? {}) as Record<string, number>;
  const customTarget = (state.uiPrefs as any)?.shasBoardDailyTarget as number | undefined;

  const [cursor, setCursor] = useState<Date>(startOfMonth(new Date()));
  const [filterSedarim, setFilterSedarim] = useState<Set<string>>(new Set());
  const [filterMasechtot, setFilterMasechtot] = useState<Set<string>>(new Set());
  const today = useMemo(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }, []);

  const pace = useMemo(() => computePace(log, 14), [log]);
  const autoPerDay = pace.avgPerDay;
  const perDay = customTarget && customTarget > 0 ? customTarget : autoPerDay;
  const targetSource = customTarget && customTarget > 0 ? "ידני" : "אוטומטי (קצב 14 ימים)";

  const hasFilter = filterSedarim.size > 0 || filterMasechtot.size > 0;
  const matchesFilter = (seder: string, masechta: string) => {
    const sederOk = filterSedarim.size === 0 || filterSedarim.has(seder);
    const masechtaOk = filterMasechtot.size === 0 || filterMasechtot.has(masechta);
    return sederOk && masechtaOk;
  };

  const toggleInSet = (s: Set<string>, val: string) => {
    const next = new Set(s);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  };

  // Build ordered list of remaining amudim across the entire Shas,
  // grouped by masechta/seder, so we can map (day index) -> which units.
  const remainingPlan = useMemo(() => {
    type Unit = { masechta: string; seder: string; daf: number; amud: "a" | "b" };
    const units: Unit[] = [];
    for (const m of SHAS_BAVLI) {
      if (!matchesFilter(m.seder, m.name)) continue;
      const mp = progress[m.name] ?? {};
      for (let d = 2; d <= m.pages + 1; d++) {
        const e = mp[d] ?? {};
        if (!(e.a && e.a > 0)) units.push({ masechta: m.name, seder: m.seder, daf: d, amud: "a" });
        if (!(e.b && e.b > 0)) units.push({ masechta: m.name, seder: m.seder, daf: d, amud: "b" });
      }
    }
    return units;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, filterSedarim, filterMasechtot]);

  const totalRemaining = remainingPlan.length;

  /**
   * For a given date, return how many units fall on it and which seder/masechta
   * boundaries finish on/before it (cumulative model with fractional accumulator).
   */
  const schedule = useMemo(() => {
    // Map date -> { count, finishedMasechtot[], finishedSedarim[] }
    const map = new Map<string, { count: number; cum: number; finishedMasechtot: string[]; finishedSedarim: string[] }>();
    if (perDay <= 0 || totalRemaining === 0) return map;

    // Pre-compute cumulative index where each masechta/seder finishes
    const masechtaFinishIdx = new Map<string, number>();
    const sederFinishIdx = new Map<string, number>();
    remainingPlan.forEach((u, i) => {
      masechtaFinishIdx.set(u.masechta, i); // overwrite -> last index = finish
      sederFinishIdx.set(u.seder, i);
    });

    let frac = 0;
    let consumed = 0;
    let d = new Date(today);
    let safety = 0;
    while (consumed < totalRemaining && safety < 365 * 30) {
      frac += perDay;
      const take = Math.floor(frac);
      frac -= take;
      if (take > 0) {
        const before = consumed;
        const after = Math.min(consumed + take, totalRemaining);
        const finishedM: string[] = [];
        const finishedS: string[] = [];
        for (const [name, idx] of masechtaFinishIdx) {
          if (idx >= before && idx < after) finishedM.push(name);
        }
        for (const [name, idx] of sederFinishIdx) {
          if (idx >= before && idx < after) finishedS.push(name);
        }
        map.set(isoKey(d), { count: after - before, cum: after, finishedMasechtot: finishedM, finishedSedarim: finishedS });
        consumed = after;
      }
      d = addDays(d, 1);
      safety++;
    }
    return map;
  }, [perDay, remainingPlan, totalRemaining, today]);

  // Per-masechta + per-seder expected finish date
  const finishes = useMemo(() => {
    const perMasechta: Record<string, string | null> = {};
    const perSeder: Record<string, string | null> = {};
    for (const [iso, info] of schedule) {
      for (const m of info.finishedMasechtot) perMasechta[m] = iso;
      for (const s of info.finishedSedarim) perSeder[s] = iso;
    }
    return { perMasechta, perSeder };
  }, [schedule]);

  // Calendar grid (6 weeks, Sunday-start which matches Hebrew week)
  const monthStart = startOfMonth(cursor);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let i = 0; i < 7; i++) row.push(addDays(gridStart, w * 7 + i));
    weeks.push(row);
  }

  const monthTotal = weeks.flat().filter(d => d.getMonth() === cursor.getMonth())
    .reduce((s, d) => s + (schedule.get(isoKey(d))?.count ?? 0), 0);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <Card className="gold-frame p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="gold-icon-circle"><CalendarDays className="h-5 w-5" /></span>
          <h2 className="font-display text-2xl font-bold">לוח שנה — יעדי לימוד</h2>
          <Badge variant="outline" className="border-gold/60">
            {perDay > 0 ? `${perDay.toFixed(1)} עמ׳/יום · ${(perDay * 7).toFixed(0)} בשבוע` : "אין יעד פעיל"}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">מקור: {targetSource}</Badge>
        </div>
        {perDay <= 0 && (
          <div className="text-xs text-muted-foreground p-2 rounded-md bg-card border border-gold/30">
            סמן עמודים בלוח (או קבע יעד ידני בלשונית "תכנון לסיום") כדי שיופיעו יעדים בלוח השנה.
          </div>
        )}
      </Card>

      {/* Month nav */}
      <Card className="gold-frame p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setCursor(addDays(startOfMonth(cursor), -1))}>
            <ChevronRight className="h-4 w-4" /> חודש קודם
          </Button>
          <h3 className="font-display text-lg font-bold">{fmtMonth(cursor)}</h3>
          <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(addDays(startOfMonth(cursor), 32)))}>
            חודש הבא <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        {/* Day-of-week header */}
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-muted-foreground">
          {DOW.map((d) => <div key={d}>{d}</div>)}
        </div>

        {/* Grid */}
        <div className="space-y-1">
          {weeks.map((row, wi) => {
            const weekTotal = row.reduce((s, d) => s + (schedule.get(isoKey(d))?.count ?? 0), 0);
            return (
              <div key={wi} className="grid grid-cols-8 gap-1">
                {row.map((d) => {
                  const iso = isoKey(d);
                  const info = schedule.get(iso);
                  const inMonth = d.getMonth() === cursor.getMonth();
                  const isToday = sameDay(d, today);
                  const isPast = d < today;
                  const learnedThatDay = log[iso] ?? 0;
                  const hasMilestone = (info?.finishedMasechtot.length ?? 0) > 0 || (info?.finishedSedarim.length ?? 0) > 0;
                  return (
                    <div
                      key={iso}
                      className={cn(
                        "relative h-16 rounded-md border-2 p-1 flex flex-col items-center justify-between text-[11px] leading-tight",
                        inMonth ? "bg-card" : "bg-secondary/40 opacity-60",
                        isToday ? "border-gold ring-2 ring-gold/40" : "border-gold/20",
                        hasMilestone && "bg-gradient-to-br from-amber-500/10 to-gold/10 border-gold",
                      )}
                      title={[
                        fmtDate(d),
                        info ? `יעד: ${info.count} עמ׳` : "אין יעד",
                        learnedThatDay > 0 ? `נלמד: ${learnedThatDay}` : "",
                        info?.finishedMasechtot.length ? `סיום מסכת: ${info.finishedMasechtot.join(", ")}` : "",
                        info?.finishedSedarim.length ? `סיום סדר: ${info.finishedSedarim.join(", ")}` : "",
                      ].filter(Boolean).join("\n")}
                    >
                      <span className={cn("font-bold", isToday && "text-gold")}>{d.getDate()}</span>
                      {info && info.count > 0 && (
                        <span className="font-bold text-gold text-sm">{info.count}</span>
                      )}
                      {isPast && learnedThatDay > 0 && (
                        <span className="absolute top-0.5 right-0.5 text-[9px] bg-gradient-navy text-primary-foreground rounded-full px-1">
                          ✓{learnedThatDay}
                        </span>
                      )}
                      {hasMilestone && (
                        <Flag className="absolute bottom-0.5 left-0.5 h-3 w-3 text-gold" />
                      )}
                    </div>
                  );
                })}
                {/* Week total cell */}
                <div className="h-16 rounded-md border-2 border-gold/40 bg-secondary p-1 flex flex-col items-center justify-center text-[10px]">
                  <span className="text-muted-foreground">סה"כ שבוע</span>
                  <span className="font-bold text-gold text-base">{weekTotal}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-gold/20">
          <span>סה"כ יעדים בחודש: <strong className="text-gold">{monthTotal}</strong> עמודים</span>
          <span className="flex items-center gap-1"><Flag className="h-3 w-3 text-gold" /> = יום שמסיים מסכת/סדר</span>
        </div>
      </Card>

      {/* Expected finish per Seder */}
      <Card className="gold-frame p-4 space-y-2">
        <h3 className="font-display text-lg font-bold">תאריך סיום צפוי — סדרים</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {SEDARIM.map((s) => {
            const iso = finishes.perSeder[s];
            const allDone = SHAS_BAVLI.filter(m => m.seder === s).every(m => {
              const t = m.pages * 2;
              const mp = progress[m.name] ?? {};
              let l = 0;
              for (const e of Object.values(mp)) { if ((e.a ?? 0) > 0) l++; if ((e.b ?? 0) > 0) l++; }
              return l === t;
            });
            return (
              <div key={s} className="p-3 rounded-md border border-gold/30 flex items-center justify-between gap-2">
                <span className="font-semibold">סדר {s}</span>
                <Badge variant="outline" className={cn("border-gold/60", allDone && "bg-gold text-primary-foreground border-gold")}>
                  {allDone ? "הושלם" : iso ? fmtDate(new Date(iso + "T00:00:00")) : "—"}
                </Badge>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Expected finish per Masechta */}
      <Card className="gold-frame p-4 space-y-2">
        <h3 className="font-display text-lg font-bold">תאריך סיום צפוי — מסכתות</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {SHAS_BAVLI.map((m) => {
            const iso = finishes.perMasechta[m.name];
            const total = m.pages * 2;
            const mp = progress[m.name] ?? {};
            let learned = 0;
            for (const e of Object.values(mp)) { if ((e.a ?? 0) > 0) learned++; if ((e.b ?? 0) > 0) learned++; }
            const done = learned === total;
            return (
              <div key={m.name} className="p-3 rounded-md border border-gold/30 text-xs flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm">{m.name}</div>
                  <div className="text-[10px] text-muted-foreground">{m.seder} · {learned}/{total}</div>
                </div>
                <Badge variant={done ? "default" : "outline"} className={cn("border-gold/60 shrink-0", done && "bg-gold text-primary-foreground border-gold")}>
                  {done ? "הושלם" : iso ? fmtDate(new Date(iso + "T00:00:00")) : "—"}
                </Badge>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
