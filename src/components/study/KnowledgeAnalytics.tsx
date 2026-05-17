import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Activity, TrendingUp, TrendingDown, Minus, Clock, Calendar as CalendarIcon,
  AlertTriangle, CheckCircle2, Info, Sparkles, Target, Layers, Tag,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useStudy } from "@/lib/study/store";
import {
  computeRange, filterLogs, byHour, byDayPart, DAY_PARTS, byWeekday,
  trendByDay, comparePrevious, hardestCards, byTag, byDeck, generateInsights,
  type RangePreset,
} from "@/lib/study/analytics";
import { cn } from "@/lib/utils";

const PRESETS: { v: RangePreset; l: string }[] = [
  { v: "7", l: "7 ימים" },
  { v: "30", l: "30 ימים" },
  { v: "90", l: "90 ימים" },
  { v: "all", l: "הכל" },
  { v: "custom", l: "מותאם" },
];

function pct(v: number) { return `${v}%`; }
function fmtMs(ms: number) {
  if (!ms) return "—";
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} ש'` : `${Math.round(s / 60)} ד'`;
}

export function KnowledgeAnalytics() {
  const { state } = useStudy();
  const [preset, setPreset] = useState<RangePreset>("30");
  const [from, setFrom] = useState<Date | undefined>();
  const [to, setTo] = useState<Date | undefined>();
  const [deckId, setDeckId] = useState<string>("all");

  const range = useMemo(
    () => computeRange(preset, from, to),
    [preset, from, to],
  );

  const did = deckId === "all" ? undefined : deckId;
  const logs = useMemo(() => filterLogs(state, range, did), [state, range, did]);
  const hours = useMemo(() => byHour(logs), [logs]);
  const dayParts = useMemo(() => byDayPart(logs), [logs]);
  const weekdays = useMemo(() => byWeekday(logs), [logs]);
  const trend = useMemo(() => trendByDay(logs, range), [logs, range]);
  const cmp = useMemo(() => comparePrevious(state, range, did), [state, range, did]);
  const hardest = useMemo(() => hardestCards(state, logs, 3, 10), [state, logs]);
  const tagStats = useMemo(() => byTag(state, logs), [state, logs]);
  const deckStats = useMemo(() => byDeck(state, logs), [state, logs]);
  const insights = useMemo(() => generateInsights(state, range, did), [state, range, did]);

  const totalReviews = logs.length;
  const correct = logs.filter((l) => l.correct).length;
  const accuracy = totalReviews ? Math.round((correct / totalReviews) * 100) : 0;
  const avgDur = totalReviews
    ? Math.round(logs.reduce((a, l) => a + l.durationMs, 0) / totalReviews)
    : 0;
  const activeDays = new Set(logs.map((l) => new Date(l.at).toDateString())).size;

  const maxHour = Math.max(1, ...hours.map((h) => h.total));
  const maxWd = Math.max(1, ...weekdays.map((w) => w.total));
  const maxTrend = Math.max(1, ...trend.map((p) => p.total));

  return (
    <div className="space-y-6">
      {/* Header / Range selector */}
      <Card className="gold-frame p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="gold-icon-circle"><Activity className="h-4 w-4" /></span>
            <div>
              <h2 className="font-display text-xl font-semibold">מנתח ידע</h2>
              <p className="text-xs text-muted-foreground">תובנות חכמות על הביצועים שלך</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={deckId} onValueChange={setDeckId}>
              <SelectTrigger className="w-[160px] border-2 border-gold/40">
                <SelectValue placeholder="מערכת" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל המערכות</SelectItem>
                {state.decks.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <Button
                  key={p.v}
                  size="sm"
                  variant={preset === p.v ? "default" : "outline"}
                  onClick={() => setPreset(p.v)}
                  className={cn(
                    "rounded-full",
                    preset === p.v
                      ? "bg-gradient-navy text-primary-foreground"
                      : "border-2 border-gold/50 text-foreground",
                  )}
                >
                  {p.l}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {preset === "custom" && (
          <div className="flex flex-wrap gap-2 mt-4">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="border-2 border-gold/40">
                  <CalendarIcon className="h-4 w-4" />
                  {from ? format(from, "dd/MM/yyyy") : "מתאריך"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={from} onSelect={setFrom}
                  className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="border-2 border-gold/40">
                  <CalendarIcon className="h-4 w-4" />
                  {to ? format(to, "dd/MM/yyyy") : "עד תאריך"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={to} onSelect={setTo}
                  className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
          </div>
        )}
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="חזרות בטווח" value={totalReviews} icon={Activity}
          delta={cmp.totalDelta} deltaSuffix="%" />
        <KpiCard label="% הצלחה" value={pct(accuracy)} icon={Target}
          delta={cmp.accuracyDelta} deltaSuffix=" נק'" />
        <KpiCard label="ימים פעילים" value={activeDays} icon={CalendarIcon} />
        <KpiCard label="זמן ממוצע" value={fmtMs(avgDur)} icon={Clock} />
        <KpiCard label="תקופה קודמת" value={`${cmp.previous.total} • ${pct(cmp.previous.accuracy)}`}
          icon={Layers} small />
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <Card className="gold-frame p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="gold-icon-circle"><Sparkles className="h-4 w-4" /></span>
            <h3 className="font-display text-lg font-semibold">תובנות אוטומטיות</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((ins) => {
              const Icon = ins.kind === "positive" ? CheckCircle2
                : ins.kind === "warning" ? AlertTriangle : Info;
              const tone = ins.kind === "positive"
                ? "border-gold bg-secondary/50"
                : ins.kind === "warning"
                ? "border-destructive/50 bg-destructive/5"
                : "border-gold/40 bg-card";
              return (
                <div key={ins.id} className={cn("rounded-xl border-2 p-3 flex gap-3", tone)}>
                  <Icon className={cn(
                    "h-5 w-5 flex-shrink-0 mt-0.5",
                    ins.kind === "warning" ? "text-destructive" : "text-navy",
                  )} />
                  <div>
                    <p className="font-semibold text-sm text-foreground">{ins.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{ins.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Tabs defaultValue="time">
        <TabsList className="w-full bg-muted flex-wrap h-auto">
          <TabsTrigger value="time" className="flex-1 min-w-[100px]">זמן ויום</TabsTrigger>
          <TabsTrigger value="trend" className="flex-1 min-w-[100px]">מגמה</TabsTrigger>
          <TabsTrigger value="content" className="flex-1 min-w-[100px]">תוכן</TabsTrigger>
          <TabsTrigger value="hard" className="flex-1 min-w-[100px]">שאלות קשות</TabsTrigger>
        </TabsList>

        {/* === TIME === */}
        <TabsContent value="time" className="mt-4 space-y-4">
          {/* Day parts */}
          <Card className="gold-frame p-5">
            <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-navy" /> ביצועים לפי שעות היום
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {(Object.keys(DAY_PARTS) as Array<keyof typeof DAY_PARTS>).map((k) => {
                const v = dayParts[k];
                return (
                  <div key={k} className="rounded-xl border-2 border-gold/40 p-3 bg-card">
                    <div className="text-xs text-muted-foreground">{DAY_PARTS[k].label}</div>
                    <div className="font-display text-2xl font-bold mt-1">{pct(v.accuracy)}</div>
                    <div className="text-xs text-muted-foreground">{v.total} חזרות</div>
                  </div>
                );
              })}
            </div>
            {/* Hour-by-hour bars */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground mb-2">פירוט לפי שעה (גובה = כמות, צבע = הצלחה)</p>
              <div className="flex items-end gap-0.5 h-32">
                {hours.map((h) => {
                  const heightPct = (h.total / maxHour) * 100;
                  const accColor = h.total === 0
                    ? "bg-muted"
                    : h.accuracy >= 80 ? "bg-gold"
                    : h.accuracy >= 60 ? "bg-navy/60"
                    : "bg-destructive/70";
                  return (
                    <div key={h.hour} className="flex-1 flex flex-col items-center gap-0.5"
                      title={`${h.hour}:00 — ${h.total} חזרות, ${h.accuracy}% הצלחה`}>
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className={cn("w-full rounded-t transition-all", accColor)}
                          style={{ height: `${Math.max(heightPct, h.total > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-muted-foreground leading-none">
                        {h.hour % 3 === 0 ? h.hour : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-gold" /> ≥80%</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-navy/60" /> 60-80%</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-destructive/70" /> &lt;60%</span>
              </div>
            </div>
          </Card>

          {/* Weekday */}
          <Card className="gold-frame p-5">
            <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-navy" /> ביצועים לפי יום בשבוע
            </h3>
            <div className="space-y-2">
              {weekdays.map((w) => (
                <div key={w.weekday} className="flex items-center gap-3">
                  <div className="w-16 text-sm text-foreground">{w.label}</div>
                  <div className="flex-1 relative h-7 rounded-md bg-muted overflow-hidden">
                    <div
                      className="absolute inset-y-0 right-0 bg-gradient-to-l from-gold to-navy/60"
                      style={{ width: `${(w.total / maxWd) * 100}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-end pr-2 text-xs font-medium text-foreground">
                      {w.total} • {pct(w.accuracy)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* === TREND === */}
        <TabsContent value="trend" className="mt-4 space-y-4">
          <Card className="gold-frame p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-navy" /> מגמה יומית
              </h3>
              <DeltaPill delta={cmp.accuracyDelta} suffix=" נק'" label="הצלחה" />
            </div>
            {trend.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">אין נתונים בטווח זה</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-end gap-0.5 h-40 border-b border-gold/30">
                  {trend.map((p) => {
                    const heightPct = (p.total / maxTrend) * 100;
                    const color = p.total === 0
                      ? "bg-muted/40"
                      : p.accuracy >= 80 ? "bg-gold"
                      : p.accuracy >= 60 ? "bg-navy/60"
                      : "bg-destructive/70";
                    return (
                      <div key={p.date} className="flex-1 flex items-end" title={`${p.label}: ${p.total} חזרות, ${p.accuracy}%`}>
                        <div className={cn("w-full rounded-t", color)}
                          style={{ height: `${Math.max(heightPct, p.total > 0 ? 4 : 0)}%` }} />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{trend[0]?.label}</span>
                  <span>{trend[Math.floor(trend.length / 2)]?.label}</span>
                  <span>{trend[trend.length - 1]?.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gold/20">
                  <div>
                    <div className="text-xs text-muted-foreground">תקופה נוכחית</div>
                    <div className="font-semibold">{cmp.current.total} חזרות • {pct(cmp.current.accuracy)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">תקופה קודמת</div>
                    <div className="font-semibold">{cmp.previous.total} חזרות • {pct(cmp.previous.accuracy)}</div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* === CONTENT === */}
        <TabsContent value="content" className="mt-4 space-y-4">
          <Card className="gold-frame p-5">
            <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
              <Tag className="h-4 w-4 text-navy" /> לפי תגיות / קטגוריות
            </h3>
            {tagStats.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">אין נתונים</p>
            ) : (
              <div className="space-y-2">
                {tagStats.slice(0, 10).map((t) => (
                  <GroupRow key={t.key} label={t.label} total={t.total} accuracy={t.accuracy} />
                ))}
              </div>
            )}
          </Card>

          <Card className="gold-frame p-5">
            <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
              <Layers className="h-4 w-4 text-navy" /> לפי מערכת
            </h3>
            {deckStats.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">אין נתונים</p>
            ) : (
              <div className="space-y-2">
                {deckStats.map((d) => (
                  <GroupRow key={d.key} label={d.label} total={d.total} accuracy={d.accuracy} />
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* === HARD === */}
        <TabsContent value="hard" className="mt-4">
          <Card className="gold-frame p-5">
            <h3 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> שאלות קשות במיוחד
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              הכרטיסים עם אחוז ההצלחה הנמוך ביותר (לפחות 3 חזרות בטווח)
            </p>
            {hardest.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">
                אין מספיק נתונים. תרגל עוד כדי לזהות שאלות קשות.
              </p>
            ) : (
              <div className="space-y-2">
                {hardest.map((c, i) => {
                  const deck = state.decks.find((d) => d.id === c.deckId);
                  return (
                    <div key={c.cardId}
                      className="flex items-start gap-3 rounded-xl border-2 border-gold/40 p-3 bg-card">
                      <div className="gold-icon-circle h-7 w-7 flex-shrink-0 text-xs">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground line-clamp-2">{c.question}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                          {deck && <Badge variant="outline" className="border-gold/40">{deck.name}</Badge>}
                          <span>{c.correct}/{c.total} נכון</span>
                          <span>•</span>
                          <span>זמן ממוצע: {fmtMs(c.avgDurationMs)}</span>
                        </div>
                      </div>
                      <div className={cn(
                        "font-display text-lg font-bold",
                        c.accuracy >= 60 ? "text-navy" : "text-destructive",
                      )}>
                        {pct(c.accuracy)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// === Sub components ===
function KpiCard({
  label, value, icon: Icon, delta, deltaSuffix, small,
}: {
  label: string; value: string | number; icon: React.ElementType;
  delta?: number; deltaSuffix?: string; small?: boolean;
}) {
  return (
    <Card className="gold-frame p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="gold-icon-circle h-7 w-7"><Icon className="h-3.5 w-3.5" /></span>
        {typeof delta === "number" && <DeltaPill delta={delta} suffix={deltaSuffix} />}
      </div>
      <div className={cn("font-display font-bold text-foreground", small ? "text-base" : "text-2xl")}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </Card>
  );
}

function DeltaPill({ delta, suffix = "", label }: { delta: number; suffix?: string; label?: string }) {
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone = delta > 0
    ? "bg-secondary text-navy border-gold"
    : delta < 0
    ? "bg-destructive/10 text-destructive border-destructive/40"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", tone)}>
      <Icon className="h-3 w-3" />
      {label && <span>{label}</span>}
      {delta > 0 ? "+" : ""}{delta}{suffix}
    </span>
  );
}

function GroupRow({ label, total, accuracy }: { label: string; total: number; accuracy: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 truncate text-sm text-foreground" title={label}>{label}</div>
      <div className="flex-1">
        <Progress value={accuracy} className="h-2" />
      </div>
      <div className="w-24 text-right text-xs text-muted-foreground">
        {total} • <span className={cn(
          "font-semibold",
          accuracy >= 80 ? "text-navy" : accuracy >= 60 ? "text-foreground" : "text-destructive",
        )}>{pct(accuracy)}</span>
      </div>
    </div>
  );
}
