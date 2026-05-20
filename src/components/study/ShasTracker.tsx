import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookOpen, Check, RotateCcw, X } from "lucide-react";
import { useStudy } from "@/lib/study/store";
import { SHAS_BAVLI, SEDARIM } from "@/lib/study/shasData";
import { toHebrewNum, formatShasPosition, unitLabel, unitRhythmHint, unitsPerDaf, totalUnitsInMasechta, computeExpectedShasPosition } from "@/lib/study/shasFormat";
import type { ShasPlan, ShasUnit } from "@/lib/study/types";
import { cn, toHebrewDate, fromHebrewDate, hebrewYearGematriya, HEB_MONTHS, calcEtaDate } from "@/lib/utils";
import { ShasReviewScheduleDialog, isShasDialogSkipped } from "./ShasReviewScheduleDialog";
import { GridPickerPopover } from "./HebrewGridPicker";

const DAY_SHORT_SHAS = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];

export function ShasTracker() {
  const { state, setShasPlan, setActiveShasPlan, deleteShasPlan, completeShasDaf, undoLastShasDaf, setShasUnit, scheduleShasReviewsAt, setReviewIntervals } = useStudy();
  const plans = (state.shasPlans && state.shasPlans.length > 0)
    ? state.shasPlans
    : (state.shasPlan ? [state.shasPlan] : []);
  const plan = state.shasPlan ?? null;

  const [setupOpen, setSetupOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pagesPerDay, setPagesPerDay] = useState("1");
  const [unit, setUnit] = useState<ShasUnit>("daf");
  const [skipWeekdays, setSkipWeekdays] = useState<number[]>([]);
  const [skipDates, setSkipDates] = useState<string[]>([]);
  const [skipDateInput, setSkipDateInput] = useState("");
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [pendingSnapshot, setPendingSnapshot] = useState<{
    masechta: string; daf: number; amud: 1 | 2; half: 1 | 2 | null; unit: ShasUnit;
  } | null>(null);
  // Anchor
  const [anchorEnabled, setAnchorEnabled] = useState(false);
  const [anchorDate, setAnchorDate] = useState("");
  const [anchorMasechta, setAnchorMasechta] = useState("");
  const [anchorDaf, setAnchorDaf] = useState("2");
  const [anchorAmud, setAnchorAmud] = useState<1 | 2>(1);
  const [anchorMode, setAnchorMode] = useState<"gregorian" | "hebrew">("hebrew");
  const [hebDay, setHebDay] = useState("");
  const [hebMonth, setHebMonth] = useState("");
  const [hebYear, setHebYear] = useState(5786);

  const handleCompleteDaf = () => {
    if (!plan) return;
    const snap = {
      masechta: plan.currentMasechta,
      daf: plan.currentDaf,
      amud: plan.currentAmud,
      half: plan.unit === "half" ? plan.currentHalf : null,
      unit: plan.unit,
    };
    // אם המשתמש כבר הגדיר מרווחי חזרה (או בחר "אל תשאל שוב") — יוצרים חזרות אוטומטית
    const hasConfiguredIntervals = (state.reviewIntervals ?? []).length > 0;
    if (isShasDialogSkipped() || hasConfiguredIntervals) {
      completeShasDaf();
      return;
    }
    // בפעם הראשונה (לפני הגדרת מרווחים) — פותחים דיאלוג לבחירת תאריכי חזרה
    completeShasDaf({ intervals: [] });
    setPendingSnapshot(snap);
    setScheduleDialogOpen(true);
  };

  const planLabel = (p: ShasPlan) => {
    if (p.name?.trim()) return p.name;
    if (p.selectedMasechtos.length > 1) return `${p.selectedMasechtos[0]} +${p.selectedMasechtos.length - 1}`;
    return p.selectedMasechtos[0] ?? 'ש"ס';
  };

  // סך-כל היחידות בתוכנית (לפי בחירת unit) — לחישוב התקדמות
  const totalUnits = useMemo(() => {
    if (!plan) return 0;
    return plan.selectedMasechtos.reduce((sum, name) => {
      const m = SHAS_BAVLI.find((x) => x.name === name);
      return sum + (m ? totalUnitsInMasechta(m.pages, plan.unit) : 0);
    }, 0);
  }, [plan]);

  const completedUnits = plan?.completed.length ?? 0;
  const percent = totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0;

  // pagesPerDay מתפרש כיחידות-ביום
  const estDaysLeft = plan && plan.pagesPerDay > 0
    ? Math.ceil((totalUnits - completedUnits) / plan.pagesPerDay)
    : 0;
  const hasSkips = !!(plan?.skipWeekdays?.length || plan?.skipDates?.length);
  const estFinishDate = estDaysLeft > 0
    ? calcEtaDate(estDaysLeft, plan?.skipWeekdays ?? [], plan?.skipDates ?? [])
    : null;

  // מיקום צפוי לפי עוגן
  const todayDateStr = new Date().toISOString().slice(0, 10);
  const expectedPosition = useMemo(
    () => plan ? computeExpectedShasPosition(plan, todayDateStr) : null,
     
    [plan, todayDateStr],
  );

  const toggleAll = (seder: string) => {
    const inSeder = SHAS_BAVLI.filter((m) => m.seder === seder).map((m) => m.name);
    const allSelected = inSeder.every((n) => selected.includes(n));
    if (allSelected) setSelected((s) => s.filter((n) => !inSeder.includes(n)));
    else setSelected((s) => Array.from(new Set([...s, ...inSeder])));
  };

  const startPlan = () => {
    if (selected.length === 0) return;
    const ordered = SHAS_BAVLI.filter((m) => selected.includes(m.name)).map((m) => m.name);
    const anchorPos = anchorEnabled && anchorDate && anchorMasechta
      ? { masechta: anchorMasechta, daf: parseInt(anchorDaf, 10) || 2, amud: anchorAmud }
      : undefined;
    setShasPlan(
      ordered,
      parseInt(pagesPerDay, 10) || 1,
      unit,
      undefined,
      undefined,
      skipWeekdays.length ? skipWeekdays : undefined,
      skipDates.length ? skipDates : undefined,
      anchorEnabled && anchorDate ? anchorDate : undefined,
      anchorPos,
    );
    setSetupOpen(false);
    setSelected([]);
    setPagesPerDay("1");
    setUnit("daf");
    setSkipWeekdays([]);
    setSkipDates([]);
    setSkipDateInput("");
    setAnchorEnabled(false);
    setAnchorDate("");
    setAnchorMasechta("");
    setAnchorDaf("2");
    setAnchorAmud(1);
  };

  const unitOptions: { value: ShasUnit; title: string; sub: string }[] = [
    { value: "daf",  title: "דף שלם",   sub: "דף יומי – דף שלם בכל יום" },
    { value: "amud", title: "עמוד",     sub: "עמוד ביום – דף שלם כל יומיים" },
    { value: "half", title: "חצי עמוד", sub: "חצי עמוד ביום – דף שלם כל ארבעה ימים" },
  ];

  return (
    <Card className="gold-frame p-6 space-y-4 animate-fade-in" dir="rtl">
      <div className="flex items-center gap-2">
        <span className="gold-icon-circle"><BookOpen className="h-4 w-4" /></span>
        <h3 className="font-display text-lg font-semibold">לימוד ש&quot;ס</h3>
      </div>

      {/* Dialog for new plan — opened programmatically only */}
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
            <DialogContent className="gold-frame max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
              <DialogHeader>
                <DialogTitle className="font-display text-right">תוכנית לימוד ש"ס</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-right">
                {/* יחידת לימוד */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground">יחידת לימוד</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {unitOptions.map((opt) => (
                      <button
                        type="button"
                        key={opt.value}
                        onClick={() => setUnit(opt.value)}
                        className={cn(
                          "rounded-xl border-2 p-3 text-right transition-colors",
                          unit === opt.value
                            ? "border-gold bg-gold/10"
                            : "border-gold/30 bg-card hover:border-gold/60",
                        )}
                      >
                        <div className="font-display font-semibold">{opt.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">{opt.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* קצב */}
                <div>
                  <label className="text-xs text-muted-foreground">
                    {unit === "daf" ? "דפים ביום" : unit === "amud" ? "עמודים ביום" : "חצאי-עמוד ביום"}
                  </label>
                  <Input type="number" min={1} value={pagesPerDay}
                    onChange={(e) => setPagesPerDay(e.target.value)}
                    className="border-2 border-gold/40 text-right w-32" />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {unitRhythmHint(unit)}
                  </p>
                </div>
                <div className="space-y-3">
                  {SEDARIM.map((seder) => {
                    const inSeder = SHAS_BAVLI.filter((m) => m.seder === seder);
                    const selCount = inSeder.filter((m) => selected.includes(m.name)).length;
                    return (
                      <div key={seder} className="border-2 border-gold/30 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <Button size="sm" variant="ghost" onClick={() => toggleAll(seder)}
                            className="text-xs h-7">
                            {selCount === inSeder.length ? "בטל הכל" : "בחר הכל"}
                          </Button>
                          <h4 className="font-display font-semibold text-foreground">
                            סדר {seder} <span className="text-xs text-muted-foreground">({selCount}/{inSeder.length})</span>
                          </h4>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {inSeder.map((m) => (
                            <label key={m.name}
                              className={cn(
                                "flex items-center gap-2 rounded-lg border-2 px-2 py-1.5 cursor-pointer text-sm",
                                selected.includes(m.name)
                                  ? "border-gold bg-secondary"
                                  : "border-gold/30 bg-card"
                              )}>
                              <Checkbox
                                checked={selected.includes(m.name)}
                                onCheckedChange={(c) => {
                                  if (c) setSelected((s) => [...s, m.name]);
                                  else setSelected((s) => s.filter((n) => n !== m.name));
                                }}
                              />
                              <span className="flex-1 text-right">{m.name}</span>
                              <span className="text-[10px] text-muted-foreground">{(m.pages - 1) * unitsPerDaf(unit)} {unit === "daf" ? "ד׳" : unit === "amud" ? "ע׳" : "ח׳"}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* ימי דילוג */}
                <div className="space-y-2 border-t border-gold/15 pt-3">
                  <label className="text-xs font-semibold text-muted-foreground">ימי דילוג (לא נחשבים במניין)</label>
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const bothSet = [5, 6].every((d) => skipWeekdays.includes(d));
                        setSkipWeekdays(bothSet ? skipWeekdays.filter((d) => ![5, 6].includes(d)) : Array.from(new Set([...skipWeekdays, 5, 6])));
                      }}
                      className={cn(
                        "text-xs px-2.5 py-1 rounded-lg border-2 transition-colors font-semibold",
                        [5, 6].every((d) => skipWeekdays.includes(d)) ? "border-gold bg-gold/20 text-gold" : "border-gold/30 text-muted-foreground hover:border-gold/50",
                      )}
                    >שישי+שבת</button>
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <button type="button" key={d}
                        onClick={() => setSkipWeekdays(skipWeekdays.includes(d) ? skipWeekdays.filter((x) => x !== d) : [...skipWeekdays, d])}
                        className={cn("text-xs w-8 py-1 rounded-lg border-2 transition-colors", skipWeekdays.includes(d) ? "border-gold bg-gold/20 text-gold font-semibold" : "border-gold/30 text-muted-foreground hover:border-gold/50")}
                      >{DAY_SHORT_SHAS[d]}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 justify-end" dir="ltr">
                    <button type="button"
                      onClick={() => { const v = skipDateInput.trim(); if (/^\d{2}-\d{2}$/.test(v) && !skipDates.includes(v)) { setSkipDates([...skipDates, v]); setSkipDateInput(""); } }}
                      className="text-xs px-2 py-1 rounded-lg border border-gold/40 hover:bg-gold/10 transition-colors"
                    >+ הוסף</button>
                    <input value={skipDateInput} onChange={(e) => setSkipDateInput(e.target.value)} placeholder="MM-DD"
                      className="w-20 text-xs px-2 py-1 rounded-lg border border-gold/30 text-center bg-background" />
                    <span className="text-[11px] text-muted-foreground">חגים חוזרים:</span>
                  </div>
                  {skipDates.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-end">
                      {skipDates.map((date) => (
                        <span key={date} className="text-[10px] bg-gold/10 text-gold border border-gold/30 rounded px-1.5 py-0.5 flex items-center gap-1">
                          {date}
                          <button type="button" onClick={() => setSkipDates(skipDates.filter((d) => d !== date))} className="hover:text-destructive leading-none">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* עוגן תאריך */}
                <div className="space-y-2 border-2 border-gold/30 rounded-xl p-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none" onClick={() => setAnchorEnabled((v) => !v)}>
                    <Checkbox checked={anchorEnabled} onCheckedChange={(c) => setAnchorEnabled(!!c)} />
                    <span className="text-xs font-semibold text-muted-foreground">עוגן תאריך — איפה הייתי בתאריך מסוים?</span>
                  </label>
                  {anchorEnabled && (
                    <div className="space-y-3 pt-1">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-muted-foreground">תאריך עוגן</label>
                          <div className="flex gap-1 text-[11px]">
                            <button
                              type="button"
                              onClick={() => setAnchorMode("gregorian")}
                              className={cn("px-2 py-0.5 rounded border transition-colors", anchorMode === "gregorian" ? "border-gold bg-gold/20 font-semibold" : "border-gold/30 text-muted-foreground hover:border-gold/60")}
                            >לועזי</button>
                            <button
                              type="button"
                              onClick={() => setAnchorMode("hebrew")}
                              className={cn("px-2 py-0.5 rounded border transition-colors", anchorMode === "hebrew" ? "border-gold bg-gold/20 font-semibold" : "border-gold/30 text-muted-foreground hover:border-gold/60")}
                            >עברי</button>
                          </div>
                        </div>
                        {anchorMode === "gregorian" ? (
                          <div className="flex items-center gap-2">
                            <Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)}
                              className="border-2 border-gold/40 w-44 text-left" dir="ltr" />
                            {anchorDate && (
                              <span className="text-sm font-semibold text-gold">{toHebrewDate(anchorDate)}</span>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* יום */}
                              <GridPickerPopover
                                value={hebDay}
                                placeholder="יום"
                                options={Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: toHebrewNum(i + 1) }))}
                                onSelect={(d) => {
                                  setHebDay(d);
                                  if (d && hebMonth && hebYear) {
                                    const g = fromHebrewDate(+d, +hebMonth, hebYear);
                                    if (g) setAnchorDate(g);
                                  }
                                }}
                                columns={5}
                                className="w-20"
                              />
                              {/* חודש */}
                              <GridPickerPopover
                                value={hebMonth}
                                placeholder="חודש"
                                options={HEB_MONTHS.map((m) => ({ value: String(m.num), label: m.name }))}
                                onSelect={(m) => {
                                  setHebMonth(m);
                                  if (hebDay && m && hebYear) {
                                    const g = fromHebrewDate(+hebDay, +m, hebYear);
                                    if (g) setAnchorDate(g);
                                  }
                                }}
                                columns={2}
                                className="flex-1 min-w-[90px]"
                              />
                              {/* שנה */}
                              <GridPickerPopover
                                value={String(hebYear)}
                                placeholder="שנה"
                                options={Array.from({ length: 21 }, (_, i) => 5775 + i).map((y) => ({ value: String(y), label: hebrewYearGematriya(y) }))}
                                onSelect={(y) => {
                                  const yn = +y;
                                  setHebYear(yn);
                                  if (hebDay && hebMonth && yn) {
                                    const g = fromHebrewDate(+hebDay, +hebMonth, yn);
                                    if (g) setAnchorDate(g);
                                  }
                                }}
                                columns={3}
                                className="w-24"
                              />
                            </div>
                            {anchorDate && (
                              <span className="text-sm font-semibold text-gold">{toHebrewDate(anchorDate)}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">מסכתא</label>
                          <select
                            value={anchorMasechta || (selected[0] ?? "")}
                            onChange={(e) => setAnchorMasechta(e.target.value)}
                            className="w-full rounded-lg border-2 border-gold/40 bg-card px-2 py-1 text-sm text-right"
                            dir="rtl"
                          >
                            <option value="">בחר...</option>
                            {SHAS_BAVLI.map((m) => (
                              <option key={m.name} value={m.name}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">דף</label>
                          <select
                            value={anchorDaf}
                            onChange={(e) => setAnchorDaf(e.target.value)}
                            className="w-full rounded-lg border-2 border-gold/40 bg-card px-2 py-1 text-sm text-right"
                            dir="rtl"
                          >
                            {(() => {
                              const effMas = anchorMasechta || (selected[0] ?? SHAS_BAVLI[0]?.name ?? "");
                              const masData = SHAS_BAVLI.find((m) => m.name === effMas);
                              const maxDaf = masData ? masData.pages + 1 : 64;
                              return Array.from({ length: maxDaf - 2 + 1 }, (_, i) => i + 2).map((d) => (
                                <option key={d} value={String(d)}>{toHebrewNum(d)}׳</option>
                              ));
                            })()}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">עמוד</label>
                          <div className="flex gap-1">
                            {([1, 2] as (1 | 2)[]).map((a) => (
                              <button key={a} type="button" onClick={() => setAnchorAmud(a)}
                                className={cn(
                                  "flex-1 rounded-lg border-2 py-1 text-[10px] font-semibold transition-colors",
                                  anchorAmud === a ? "border-gold bg-gold/20" : "border-gold/30 hover:border-gold/60",
                                )}
                              >{a === 1 ? "עמוד א׳" : "עמוד ב׳"}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{selected.length} מסכתות נבחרו</span>
                  <Button onClick={startPlan} disabled={selected.length === 0}
                    className="bg-gradient-navy text-primary-foreground rounded-xl">
                    <Check className="h-4 w-4" /> התחל תוכנית
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

      {!plan ? (
        <div className="flex flex-col items-center gap-3 py-8 border-2 border-dashed border-gold/30 rounded-xl">
          <p className="text-sm text-muted-foreground">לא הוגדרה תוכנית. הוסף תוכנית מקטע &quot;תוכניות לימוד&quot;.</p>
          <Button size="sm" onClick={() => setSetupOpen(true)} className="bg-gradient-navy text-primary-foreground rounded-xl">
            התחל תוכנית
          </Button>
        </div>
      ) : (
        <>
          {/* שורה אחת: תוכניות + מסכתות בימין, יחידת לימוד בשמאל */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 justify-end flex-1 order-2">
              {plans.map((p) => {
                const active = p.id === (state.activeShasPlanId ?? state.shasPlan?.id);
                return (
                  <div key={p.id} className="relative group/plan">
                    <button
                      onClick={() => setActiveShasPlan(p.id)}
                      className={cn(
                        "text-[11px] rounded-lg border-2 px-2.5 py-1 transition-colors",
                        active
                          ? "border-gold bg-gold/15 font-semibold"
                          : "border-gold/30 bg-card hover:border-gold/60",
                      )}
                      title={p.selectedMasechtos.join(", ")}
                    >
                      {planLabel(p)}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`למחוק את "${planLabel(p)}"?`)) deleteShasPlan(p.id);
                      }}
                      className="absolute -top-1.5 -left-1.5 h-4 w-4 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover/plan:opacity-100 transition-opacity delay-1000 duration-150 z-10"
                      aria-label="מחק תוכנית"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              })}
              {plan.selectedMasechtos.length > 1 && plan.selectedMasechtos.map((name) => {
                const m = SHAS_BAVLI.find((x) => x.name === name);
                if (!m) return null;
                const completedInM = plan.completed.filter((c) => c.masechta === name).length;
                const total = totalUnitsInMasechta(m.pages, plan.unit);
                const done = completedInM >= total;
                const current = name === plan.currentMasechta;
                return (
                  <Badge key={name}
                    className={cn(
                      "text-[11px] gap-1",
                      done ? "bg-gold text-navy"
                        : current ? "bg-navy text-primary-foreground"
                        : "bg-secondary text-foreground"
                    )}>
                    {name} {completedInM}/{total}
                  </Badge>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 order-1 shrink-0">
              <span className="text-[11px] text-muted-foreground">יחידה:</span>
              {(["daf","amud","half"] as ShasUnit[]).map((u) => (
                <button
                  key={u}
                  onClick={() => { if (u !== plan.unit) setShasUnit(u); }}
                  className={cn(
                    "text-[11px] rounded-lg border-2 px-2 py-1 transition-colors",
                    plan.unit === u
                      ? "border-gold bg-gold/15 font-semibold"
                      : "border-gold/30 bg-card hover:border-gold/60",
                  )}
                >
                  {unitLabel(u)}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-gradient-navy text-primary-foreground p-4 text-center">
            <div className="text-xs opacity-80 mb-1">
              {plan.unit === "daf" ? "הדף הבא" : plan.unit === "amud" ? "העמוד הבא" : "חצי-העמוד הבא"}
            </div>
            <div className="font-display text-2xl font-bold">
              {formatShasPosition(
                plan.currentMasechta,
                plan.currentDaf,
                plan.currentAmud,
                plan.unit === "half" ? plan.currentHalf : null,
              )}
            </div>
            <div className="flex items-center justify-center gap-2 mt-3">
              <Button
                size="sm" onClick={handleCompleteDaf}
                className="bg-gold text-navy hover:bg-gold/90 rounded-lg">
                <Check className="h-4 w-4" /> סיימתי {plan.unit === "daf" ? "דף זה" : plan.unit === "amud" ? "עמוד זה" : "חצי זה"}
              </Button>
              {plan.completed.length > 0 && (
                <Button size="sm" variant="outline" onClick={undoLastShasDaf}
                  className="border-2 border-gold/50 text-primary-foreground bg-transparent hover:bg-gold/20 rounded-lg">
                  <RotateCcw className="h-3.5 w-3.5" /> בטל אחרון
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{percent}%</span>
              <span className="font-semibold text-foreground">
                {completedUnits}/{totalUnits} {plan.unit === "daf" ? "דפים" : plan.unit === "amud" ? "עמודים" : "חצאי-עמוד"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div className="h-full bg-gradient-gold transition-all" style={{ width: `${percent}%` }} />
            </div>
            {estFinishDate && (
              <div className="text-[11px] text-muted-foreground text-center">
                בקצב {plan.pagesPerDay} {plan.unit === "daf" ? "דפים" : plan.unit === "amud" ? "עמודים" : "חצאי-עמוד"} {hasSkips ? "ביום פעיל" : "ביום"} → סיום משוער: {toHebrewDate(estFinishDate)} ({estDaysLeft} {hasSkips ? "ימים פעילים" : "ימים"})
              </div>
            )}
            {expectedPosition && (
              <div className="mt-1 rounded-lg border border-gold/30 bg-gold/5 px-3 py-1.5 text-center text-[11px]">
                <span className="text-muted-foreground">לפי עוגן — צפוי להיות היום ב: </span>
                <span className="font-semibold text-gold">
                  {formatShasPosition(expectedPosition.masechta, expectedPosition.daf, expectedPosition.amud, null)}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {pendingSnapshot && (
        <ShasReviewScheduleDialog
          open={scheduleDialogOpen}
          onOpenChange={setScheduleDialogOpen}
          positionLabel={formatShasPosition(
            pendingSnapshot.masechta,
            pendingSnapshot.daf,
            pendingSnapshot.amud,
            pendingSnapshot.half,
          )}
          defaultDays={state.reviewIntervals?.length ? state.reviewIntervals : [1, 3, 7, 14, 30]}
          onSaveAsDefault={(days) => setReviewIntervals(days)}
          onConfirm={(days) => {
            if (days.length) {
              scheduleShasReviewsAt({ ...pendingSnapshot, days });
            }
          }}
        />
      )}
    </Card>
  );
}
