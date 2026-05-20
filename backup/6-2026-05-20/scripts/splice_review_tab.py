#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Replaces the ReviewScheduleTab section in PlanDetail.tsx with the new version.
"""
import os

SRC = os.path.join(os.path.dirname(__file__), '..', 'src', 'pages', 'PlanDetail.tsx')

NEW_BLOCK = '''\
// ─── Mini plan-review calendar ───────────────────────────────────────────────
const GREG_MONTHS_CAL = [
  "ינואר","פברואר","מרץ","אפריל","מאי","יוני",
  "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר",
];
const HEB_DAYS_SHORT = ["א\'","ב\'","ג\'","ד\'","ה\'","ו\'","ש\'"];

function PlanReviewMiniCalendar({
  reviews, onMarkDone, onMarkUndone, onPostpone,
}: {
  reviews: import("@/lib/study/types").PlanReview[];
  onMarkDone: (id: string, q: import("@/lib/study/types").PlanReviewQuality) => void;
  onMarkUndone: (id: string) => void;
  onPostpone: (id: string, days: number) => void;
}) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selected, setSelected] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const byDay = useMemo(() => {
    const m = new Map<string, typeof reviews>();
    reviews.forEach((r) => {
      const list = m.get(r.dueDate) ?? [];
      list.push(r);
      m.set(r.dueDate, list);
    });
    return m;
  }, [reviews]);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const selectedDayReviews = selected ? (byDay.get(selected) ?? []) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-1 rounded hover:bg-secondary">
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="font-semibold text-sm">{GREG_MONTHS_CAL[month]} {year}</span>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-1 rounded hover:bg-secondary">
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] text-muted-foreground font-semibold mb-1">
        {HEB_DAYS_SHORT.map((d) => <div key={d}>{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDow }).map((_, i) => <div key={`empty-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayReviews = byDay.get(iso) ?? [];
          const hasDone = dayReviews.some((r) => r.doneAt);
          const hasPending = dayReviews.some((r) => !r.doneAt);
          const hasOverdue = hasPending && iso < today;
          const isToday = iso === today;
          const isSelected = selected === iso;

          return (
            <button
              key={iso}
              onClick={() => setSelected(isSelected ? null : iso)}
              className={cn(
                "relative flex flex-col items-center justify-center rounded-lg h-9 text-xs font-medium transition-all",
                isSelected ? "bg-gold/20 ring-2 ring-gold" : isToday ? "bg-sky-500/10 ring-1 ring-sky-400" : "hover:bg-secondary",
                dayReviews.length === 0 && "text-muted-foreground/60",
              )}
            >
              <span className={cn(isToday && "font-bold text-sky-600 dark:text-sky-400")}>{day}</span>
              {dayReviews.length > 0 && (
                <div className="flex gap-0.5 mt-0.5">
                  {hasOverdue && <span className="h-1.5 w-1.5 rounded-full bg-destructive" />}
                  {hasPending && !hasOverdue && <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />}
                  {hasDone && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex gap-3 text-[10px] text-muted-foreground pt-1">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive inline-block" /> פגר</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500 inline-block" /> ממתין</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" /> בוצע</span>
      </div>

      {selected && selectedDayReviews.length > 0 && (
        <div className="rounded-xl border-2 border-gold/30 bg-card p-3 space-y-2 mt-2">
          <p className="text-xs font-bold text-gold">{selected}</p>
          {selectedDayReviews.map((r) => (
            <ReviewRow key={r.id} r={r} today={today} onMarkDone={onMarkDone} onMarkUndone={onMarkUndone} onPostpone={onPostpone} />
          ))}
        </div>
      )}
      {selected && selectedDayReviews.length === 0 && (
        <p className="text-xs text-muted-foreground text-center pt-2">אין חזרות ביום זה</p>
      )}
    </div>
  );
}

// ─── Shared review row ───────────────────────────────────────────────────────
function ReviewRow({
  r, today, onMarkDone, onMarkUndone, onPostpone,
}: {
  r: import("@/lib/study/types").PlanReview;
  today: string;
  onMarkDone: (id: string, q: import("@/lib/study/types").PlanReviewQuality) => void;
  onMarkUndone: (id: string) => void;
  onPostpone: (id: string, days: number) => void;
}) {
  const [showQuality, setShowQuality] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const overdue = !r.doneAt && r.dueDate < today;
  const dueToday = !r.doneAt && r.dueDate === today;

  const formatDate = (iso: string) => {
    try { return toHebrewDate(new Date(iso + "T00:00:00")); } catch { return iso; }
  };

  return (
    <div className={cn("rounded-lg border px-3 py-2.5 space-y-2 transition-colors",
      r.doneAt ? "border-emerald-500/20 bg-emerald-500/5" : overdue ? "border-destructive/30 bg-destructive/5" : "border-border bg-background",
    )}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{r.unit}</p>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className={cn("text-[11px] font-medium",
              r.doneAt ? "text-emerald-600 dark:text-emerald-400"
              : overdue ? "text-destructive" : dueToday ? "text-amber-500" : "text-muted-foreground",
            )}>
              {r.doneAt ? `✓ בוצע ${formatDate(r.doneAt)}` : overdue ? `⚠ פגר · ${formatDate(r.dueDate)}` : dueToday ? `היום · ${formatDate(r.dueDate)}` : formatDate(r.dueDate)}
            </span>
            <span className="text-[10px] border border-border rounded-full px-1.5 py-0 text-muted-foreground">
              {REVIEW_INDEX_LABELS[r.reviewIndex] ?? `חזרה ${r.reviewIndex}`}
            </span>
          </div>
        </div>

        {r.doneAt ? (
          <button onClick={() => onMarkUndone(r.id)} title="בטל סימון"
            className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onMarkDone(r.id, 3)}
              className="h-7 w-7 rounded-full flex items-center justify-center bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors"
              title="בוצע ✓"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setShowQuality((v) => !v)}
              className={cn("h-7 px-1.5 rounded text-[10px] font-semibold border transition-colors",
                showQuality ? "border-gold bg-gold/10 text-gold" : "border-border text-muted-foreground hover:border-gold/50")}
              title="סמן עם איכות"
            >
              ★
            </button>
            <button onClick={() => setExpanded((v) => !v)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>

      {!r.doneAt && showQuality && (
        <div className="flex gap-1.5 flex-wrap">
          {([
            { q: 1 as const, label: "שכחתי", cls: "border-destructive/50 text-destructive hover:bg-destructive/10" },
            { q: 2 as const, label: "קשה",   cls: "border-amber-400/60 text-amber-600 hover:bg-amber-50/30" },
            { q: 3 as const, label: "טוב",   cls: "border-sky-400/60 text-sky-600 hover:bg-sky-50/30" },
            { q: 4 as const, label: "קל",    cls: "border-emerald-400/60 text-emerald-600 hover:bg-emerald-50/30" },
          ]).map(({ q, label, cls }) => (
            <button key={q} onClick={() => { onMarkDone(r.id, q); setShowQuality(false); }}
              className={cn("text-xs border-2 rounded-lg px-2.5 py-1 font-semibold transition-colors", cls)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {!r.doneAt && expanded && (
        <div className="flex gap-1.5 flex-wrap">
          {[1, 2, 7, 14].map((d) => (
            <button key={d} onClick={() => { onPostpone(r.id, d); setExpanded(false); }}
              className="text-[11px] border border-border rounded-lg px-2 py-0.5 text-muted-foreground hover:border-gold/50 transition-colors">
              +{d === 1 ? "יום" : d === 7 ? "שבוע" : d === 14 ? "שבועיים" : `${d} ימים`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Review Schedule Tab ──────────────────────────────────────────────────────
function ReviewScheduleTab({ planId }: { planId: string }) {
  const {
    state,
    updateGeneralPlan,
    markPlanReviewDone,
    undoPlanReviewDone,
    postponePlanReview,
  } = useStudy();

  const plan = (state.generalPlans ?? []).find((p) => p.id === planId);
  const planReviews = useMemo(
    () => (state.planReviews ?? []).filter((r) => r.planId === planId),
    [state.planReviews, planId],
  );

  const globalIntervals: number[] =
    state.planReviewIntervals?.length
      ? state.planReviewIntervals
      : [...PLAN_REVIEW_INTERVALS_DAYS];

  const scheduleType: ReviewScheduleType = plan?.reviewScheduleType ?? "srs";
  const fixedDays = plan?.fixedIntervalDays ?? 30;
  const [localFixed, setLocalFixed] = useState(String(fixedDays));
  const [localManualDate, setLocalManualDate] = useState("");
  const [localCustomReps, setLocalCustomReps] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  const today = new Date().toISOString().slice(0, 10);

  const { pending, done } = useMemo(() => {
    const p = planReviews.filter((r) => !r.doneAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const d = planReviews.filter((r) => r.doneAt).sort((a, b) => b.doneAt!.localeCompare(a.doneAt!));
    return { pending: p, done: d };
  }, [planReviews]);

  if (!plan) return null;

  const setType = (t: ReviewScheduleType) => updateGeneralPlan(planId, { reviewScheduleType: t });

  const saveFixed = () => {
    const n = parseInt(localFixed);
    if (n > 0) updateGeneralPlan(planId, { fixedIntervalDays: n });
  };

  const addManualDate = () => {
    if (!localManualDate) return;
    const existing = plan.manualReviewDates ?? [];
    if (existing.includes(localManualDate)) return;
    updateGeneralPlan(planId, { manualReviewDates: [...existing, localManualDate].sort() });
    setLocalManualDate("");
  };

  const removeManualDate = (d: string) =>
    updateGeneralPlan(planId, { manualReviewDates: (plan.manualReviewDates ?? []).filter((x) => x !== d) });

  const setReps = (n: number) => {
    updateGeneralPlan(planId, { reviewRepetitions: n });
    setLocalCustomReps("");
  };

  const currentReps = plan.reviewRepetitions;
  const REP_PRESETS = [1, 2, 3, 5, 7, 10];

  const formatDate = (iso: string) => {
    try { return toHebrewDate(new Date(iso + "T00:00:00")); } catch { return iso; }
  };

  return (
    <div className="space-y-5">

      {/* ── Repetitions per unit ── */}
      <Card className="gold-frame p-5 space-y-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-gold" />
          <h2 className="font-semibold text-sm">כמה פעמים לחזור על כל יחידה?</h2>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          לאחר שתסמן יחידה כ"סיימתי", יקבעו חזרות עתידיות. כמה חזרות תרצה לכל יחידה?
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          {REP_PRESETS.map((n) => (
            <button
              key={n}
              onClick={() => setReps(n)}
              className={cn(
                "text-sm border-2 rounded-full px-4 py-1.5 font-semibold transition-colors",
                currentReps === n
                  ? "border-gold bg-gold/15 text-foreground shadow-sm"
                  : "border-border text-muted-foreground hover:border-gold/50 hover:text-foreground",
              )}
            >
              {n}×
            </button>
          ))}
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={1}
              max={50}
              placeholder="אחר"
              value={localCustomReps}
              onChange={(e) => setLocalCustomReps(e.target.value)}
              className="w-20 h-9 text-center border-2 border-gold/30 text-sm"
            />
            {localCustomReps && (
              <Button size="sm" onClick={() => { const n = parseInt(localCustomReps); if (n > 0) setReps(n); }}
                className="bg-gradient-navy text-primary-foreground h-9 px-3">
                <Check className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {currentReps != null && (
          <p className="text-xs text-muted-foreground">
            מוגדר: <span className="text-gold font-bold">{currentReps} חזרות</span> לכל יחידה
          </p>
        )}
      </Card>

      {/* ── Schedule type ── */}
      <Card className="gold-frame p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-gold" />
          <h2 className="font-semibold text-sm">סוג לוח חזרות</h2>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          קבע איך יתוזמנו החזרות לאחר שתסמן כל יחידה כ"סיימתי".
          <br />
          <span className="text-[11px]">שינוי ישפיע רק על יחידות שיסתיימו מכאן ואילך.</span>
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            { id: "srs",            label: "SRS חכם",        icon: <RefreshCw className="h-4 w-4" />, desc: "מרווחים משתנים לפי ביצועים" },
            { id: "fixed_interval", label: "מרווח קבוע",     icon: <Clock className="h-4 w-4" />,     desc: "חזרה כל X ימים" },
            { id: "manual",         label: "תאריכים ידניים", icon: <Calendar className="h-4 w-4" />,  desc: "בחר תאריכים בעצמך" },
            { id: "none",           label: "ללא חזרות",      icon: <BellOff className="h-4 w-4" />,   desc: "ללא תזכורות" },
          ] as { id: string; label: string; icon: React.ReactNode; desc: string }[]).map(({ id, label, icon, desc }) => (
            <button
              key={id}
              onClick={() => setType(id as ReviewScheduleType)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-center transition-all",
                scheduleType === id
                  ? "border-gold bg-gold/10 text-foreground shadow-sm"
                  : "border-border hover:border-gold/50 text-muted-foreground hover:text-foreground",
              )}
            >
              <span className={scheduleType === id ? "text-gold" : ""}>{icon}</span>
              <span className="text-xs font-semibold">{label}</span>
              <span className="text-[10px] leading-tight text-muted-foreground">{desc}</span>
            </button>
          ))}
        </div>

        {scheduleType === "srs" && (
          <div className="rounded-xl bg-muted/40 p-4 space-y-2 border border-border">
            <p className="text-xs font-semibold">מרווחים ברירת מחדל:</p>
            <div className="flex flex-wrap gap-2">
              {globalIntervals.map((d, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-navy/10 border border-navy/20 px-3 py-1 text-xs font-semibold text-navy dark:text-sky-300">
                  {d === 1 ? "מחר" : d < 7 ? `${d} ימים` : d === 7 ? "שבוע" : d === 30 ? "חודש" : d === 90 ? "רבעון" : `${d} ימים`}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              ניתן לשנות מרווחים אלה בהגדרות → "מרווחי חזרה לתוכניות לימוד"
            </p>
          </div>
        )}

        {scheduleType === "fixed_interval" && (
          <div className="rounded-xl bg-muted/40 p-4 space-y-3 border border-border">
            <p className="text-xs font-semibold">חזרה כל כמה ימים?</p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={365}
                value={localFixed}
                onChange={(e) => setLocalFixed(e.target.value)}
                className="w-24 h-9 text-center border-2 border-gold/40 font-semibold"
              />
              <span className="text-sm text-muted-foreground">ימים</span>
              <Button size="sm" onClick={saveFixed} className="bg-gradient-navy text-primary-foreground gap-1">
                <Check className="h-3.5 w-3.5" /> שמור
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {[7, 14, 30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => { setLocalFixed(String(d)); updateGeneralPlan(planId, { fixedIntervalDays: d }); }}
                  className={cn(
                    "text-xs border-2 rounded-full px-3 py-1 transition-colors",
                    fixedDays === d ? "border-gold bg-gold/10 font-semibold" : "border-border hover:border-gold/50",
                  )}
                >
                  {d === 7 ? "שבוע" : d === 14 ? "שבועיים" : d === 30 ? "חודש" : d === 60 ? "חודשיים" : "רבעון"}
                </button>
              ))}
            </div>
          </div>
        )}

        {scheduleType === "manual" && (
          <div className="rounded-xl bg-muted/40 p-4 space-y-3 border border-border">
            <p className="text-xs font-semibold">תאריכי חזרה קבועים:</p>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={localManualDate}
                onChange={(e) => setLocalManualDate(e.target.value)}
                min={today}
                className="h-9 border-2 border-gold/40 flex-1"
              />
              <Button size="sm" onClick={addManualDate} className="bg-gradient-navy text-primary-foreground gap-1 shrink-0">
                <Plus className="h-3.5 w-3.5" /> הוסף
              </Button>
            </div>
            {(plan.manualReviewDates ?? []).length > 0 ? (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {(plan.manualReviewDates ?? []).map((d) => (
                  <div key={d} className="flex items-center justify-between rounded-lg bg-background border border-border px-3 py-1.5">
                    <span className="text-xs font-semibold">{formatDate(d)}</span>
                    <button onClick={() => removeManualDate(d)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">לא הוגדרו תאריכים עדיין.</p>
            )}
          </div>
        )}

        {scheduleType === ("none" as ReviewScheduleType) && (
          <div className="rounded-xl bg-muted/40 p-4 border border-border text-center text-sm text-muted-foreground">
            לא יתוזמנו חזרות לאחר סיום יחידות.
          </div>
        )}
      </Card>

      {/* ── Review board ── */}
      {planReviews.length > 0 && (
        <Card className="gold-frame overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">לוח חזרות</h2>
              {pending.length > 0 && (
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full",
                  pending.some((r) => r.dueDate < today) ? "bg-destructive/10 text-destructive" : "bg-sky-500/10 text-sky-600"
                )}>
                  {pending.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5 border border-border rounded-lg p-0.5">
              <button
                onClick={() => setViewMode("list")}
                className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold transition-colors",
                  viewMode === "list" ? "bg-gradient-navy text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <List className="h-3.5 w-3.5" /> רשימה
              </button>
              <button
                onClick={() => setViewMode("calendar")}
                className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold transition-colors",
                  viewMode === "calendar" ? "bg-gradient-navy text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <CalendarDays className="h-3.5 w-3.5" /> לוח
              </button>
            </div>
          </div>

          {viewMode === "calendar" && (
            <div className="p-4">
              <PlanReviewMiniCalendar
                reviews={planReviews}
                onMarkDone={markPlanReviewDone}
                onMarkUndone={undoPlanReviewDone}
                onPostpone={postponePlanReview}
              />
            </div>
          )}

          {viewMode === "list" && (
            <div className="p-4 space-y-4">
              {pending.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">אין חזרות ממתינות 🎉</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">ממתינות ({pending.length})</p>
                  {pending.map((r) => (
                    <ReviewRow key={r.id} r={r} today={today}
                      onMarkDone={markPlanReviewDone}
                      onMarkUndone={undoPlanReviewDone}
                      onPostpone={postponePlanReview}
                    />
                  ))}
                </div>
              )}
              {done.length > 0 && (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">בוצעו ({done.length})</p>
                  {done.map((r) => (
                    <ReviewRow key={r.id} r={r} today={today}
                      onMarkDone={markPlanReviewDone}
                      onMarkUndone={undoPlanReviewDone}
                      onPostpone={postponePlanReview}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {planReviews.length === 0 && (
        <Card className="gold-frame p-8 text-center text-sm text-muted-foreground space-y-1">
          <p>אין חזרות ממתינות 🎉</p>
          <p className="text-xs">חזרות יוצרו אוטומטית לאחר סיום יחידות</p>
        </Card>
      )}
    </div>
  );
}
'''

with open(SRC, encoding='utf-8') as f:
    content = f.read()

lines = content.splitlines(keepends=True)

start = next(i for i, l in enumerate(lines) if '─── Review Schedule Tab' in l)
end   = next(i for i, l in enumerate(lines) if '─── Main Plan Detail' in l)

# Also need the imports update (List, CalendarDays, ChevronLeft) if not there
needs_import = 'CalendarDays' not in lines[2] if len(lines) > 2 else True
if needs_import:
    old_import = 'from "lucide-react"'
    # will be handled by existing import line
    pass

before = lines[:start]
after  = lines[end:]

new_content = ''.join(before) + NEW_BLOCK + '\n' + ''.join(after)

with open(SRC, 'w', encoding='utf-8', newline='\n') as f:
    f.write(new_content)

result_lines = new_content.splitlines()
print(f"Done. Lines: {len(result_lines)}")
print(f"Starts at line {start+1}, ends at {end+1}")
