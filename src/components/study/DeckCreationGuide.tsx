import { useEffect, useState } from "react";
import { BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, EyeOff, FolderTree, PencilLine, Save, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const HIDDEN_KEY = "deck-creation-guide-hidden-v1";

const STEPS = [
  {
    title: "שלב ראשון: פותחים מבחן חדש",
    description: "לוחצים על הכפתור הכחול „יצירת מבחן” כדי לפתוח את טופס יצירת המבחן.",
    tip: "המבחן הוא אוסף שאלות שאפשר לתרגל יחד.",
    icon: BookOpen,
  },
  {
    title: "שלב שני: נותנים למבחן שם",
    description: "כותבים שם ברור שיעזור לזהות את המבחן, למשל „ספר הכוזרי — מאמר ראשון”.",
    tip: "כדאי לבחור שם קצר שמסביר מיד מה נמצא במבחן.",
    icon: PencilLine,
  },
  {
    title: "שלב שלישי: משייכים לקטגוריות",
    description: "בצילום האמיתי: 1 הוא כרטיס הקטגוריה, 2 הוא החץ שפותח אותה, ו־3 הוא סימן ה־✓ שבוחר אותה למבחן.",
    tip: "פתח את העץ עד המקום הרצוי ורק אז לחץ על ✓. אפשר לבחור יותר מקטגוריה אחת, והסיווג אינו חובה.",
    icon: FolderTree,
  },
  {
    title: "שלב רביעי: שומרים ומוסיפים שאלות",
    description: "לוחצים „שמור”. המבחן יופיע מיד ברשימת המבחנים, ואז אפשר לבחור אותו ולהוסיף אליו שאלות.",
    tip: "לאחר השמירה אפשר לערוך, לשכפל או להתחיל תרגול דרך כרטיס המבחן.",
    icon: Save,
  },
] as const;

export function DeckCreationGuide() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const StepIcon = current.icon;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HIDDEN_KEY) === "1";
      setHidden(stored);
      if (!stored) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const setGuideOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setStep(0);
  };

  const toggleHidden = () => {
    const next = !hidden;
    setHidden(next);
    try {
      if (next) localStorage.setItem(HIDDEN_KEY, "1");
      else localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // localStorage may be unavailable
    }
  };

  const illustration = [
    <figure key="open" className="mx-auto max-w-[790px] overflow-hidden rounded-2xl border-2 border-gold/45 bg-card p-3 shadow-sm">
      <div className="mb-3 text-right font-semibold">צילום אמיתי של עמוד המבחנים</div>
      <div className="relative overflow-hidden rounded-xl border border-gold/30">
        <img src="/question-guide/create-test-dialog.png" alt="צילום אמיתי של עמוד המבחנים" className="block h-auto w-full" />
        <span aria-label="סימון 1: כפתור יצירת מבחן" className="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-navy text-base font-bold text-white shadow-lg" style={{ left: "40%", top: "50%" }}>1</span>
      </div>
      <figcaption className="mt-3 rounded-lg bg-navy/5 px-3 py-2 text-right text-sm"><strong>1.</strong> לחץ על הפס הכחול „יצירת מבחן”.</figcaption>
    </figure>,
    <figure key="name" className="mx-auto max-w-[650px] rounded-2xl border-2 border-gold/45 bg-card p-4 text-right shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <strong>דוגמה מתוך המידע הקיים במערכת</strong>
        <span className="text-xs text-muted-foreground">כל מסכת חגיגה</span>
      </div>
      <div className="relative space-y-4 rounded-xl border-2 border-gold/35 bg-background p-5">
        <div>
          <div className="mb-2 font-semibold">שם המבחן</div>
          <div className="rounded-xl border-2 border-gold/50 px-4 py-3">כל מסכת חגיגה</div>
          <span className="absolute left-3 top-7 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-navy font-bold text-white shadow-lg">1</span>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2 font-semibold"><FolderTree className="h-4 w-4 text-gold" /> סיווג קיים</div>
          <div className="flex flex-wrap gap-2">
            {['ש״ס', 'מועד', 'חגיגה'].map((name) => <span key={name} className="rounded-full border border-gold/50 bg-gold/5 px-3 py-1.5">{name}</span>)}
          </div>
          <span className="absolute left-3 top-[7.5rem] flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-navy font-bold text-white shadow-lg">2</span>
        </div>
        <div className="flex justify-start">
          <div className="rounded-xl bg-navy px-5 py-2.5 font-bold text-white">שמור מבחן</div>
          <span className="absolute bottom-4 left-3 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-green-600 font-bold text-white shadow-lg">3</span>
        </div>
      </div>
      <figcaption className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-navy/5 px-3 py-2"><strong>1.</strong> כתוב שם למבחן.</div>
        <div className="rounded-lg bg-navy/5 px-3 py-2"><strong>2.</strong> בחר קטגוריות קיימות.</div>
        <div className="rounded-lg bg-green-600/10 px-3 py-2"><strong>3.</strong> שמור את המבחן.</div>
      </figcaption>
    </figure>,
    <figure key="categories" className="mx-auto max-w-[790px] overflow-hidden rounded-2xl border-2 border-gold/45 bg-card p-3 text-right shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold"><FolderTree className="h-5 w-5 text-gold" /> צילום אמיתי מאזור הקטגוריות</div>
        <div className="text-xs text-muted-foreground">המספרים מראים איפה ללחוץ</div>
      </div>
      <div className="relative mx-auto overflow-hidden rounded-xl border border-gold/30" style={{ maxWidth: 771 }}>
        <img src="/question-guide/categories.png" alt="צילום אמיתי של אזור בחירת הקטגוריות עם סימוני הדרכה" className="block h-auto w-full" />
        <span aria-label="סימון 1: כרטיס הקטגוריה" className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-navy text-sm font-bold text-white shadow-lg" style={{ left: "8%", top: "60%" }}>1</span>
        <span aria-label="סימון 2: כפתור פתיחת הקטגוריה" className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-navy text-sm font-bold text-white shadow-lg" style={{ left: "89%", top: "60%" }}>2</span>
        <span aria-label="סימון 3: סימן הווי לבחירת הקטגוריה" className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-green-600 text-sm font-bold text-white shadow-lg" style={{ left: "56%", top: "60%" }}>3</span>
      </div>
      <figcaption className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-navy/5 px-3 py-2"><strong>1.</strong> בחר את כרטיס הקטגוריה הרצויה.</div>
        <div className="rounded-lg bg-navy/5 px-3 py-2"><strong>2.</strong> לחץ על החץ כדי לפתוח תת־קטגוריות.</div>
        <div className="rounded-lg bg-green-600/10 px-3 py-2"><strong>3.</strong> לחץ על ✓ כדי לשייך למבחן.</div>
      </figcaption>
    </figure>,
    <figure key="save" className="mx-auto max-w-[790px] overflow-hidden rounded-2xl border-2 border-gold/45 bg-card p-3 shadow-sm">
      <div className="mb-3 text-right font-semibold">כך מבחן שמור נראה ברשימה האמיתית</div>
      <div className="relative overflow-hidden rounded-xl border border-gold/30">
        <img src="/question-guide/create-test-dialog.png" alt="צילום אמיתי של מבחן קיים ברשימת המבחנים" className="block h-auto w-full" />
        <span aria-label="סימון 1: כרטיס מבחן קיים" className="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-navy text-base font-bold text-white shadow-lg" style={{ left: "40%", top: "69%" }}>1</span>
        <span aria-label="סימון 2: כפתור התרגול" className="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-green-600 text-base font-bold text-white shadow-lg" style={{ left: "70%", top: "58%" }}>2</span>
      </div>
      <figcaption className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-navy/5 px-3 py-2"><strong>1.</strong> המבחן החדש מופיע ברשימת המבחנים.</div>
        <div className="rounded-lg bg-green-600/10 px-3 py-2"><strong>2.</strong> אפשר לבחור אותו ולהתחיל תרגול.</div>
      </figcaption>
    </figure>,
  ][step];

  return (
    <>
      <Button type="button" size="icon" variant="outline" onClick={() => setOpen(true)} className="h-9 w-9 rounded-full border-2 border-gold/60" title="פתח מדריך אינטראקטיבי ליצירת מבחנים" aria-label="פתח מדריך אינטראקטיבי ליצירת מבחנים">
        <CircleHelp className="h-5 w-5 text-gold" />
      </Button>

      <Dialog open={open} onOpenChange={setGuideOpen}>
        <DialogContent dir="rtl" className="max-h-[92vh] w-[min(94vw,900px)] max-w-4xl overflow-y-auto border-2 border-gold/50 p-0">
          <DialogHeader className="border-b border-gold/25 bg-secondary/20 p-5 text-right">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-2xl">מדריך אינטראקטיבי ליצירת מבחנים</DialogTitle>
                <DialogDescription className="mt-1 text-right">שלב {step + 1} מתוך {STEPS.length}</DialogDescription>
              </div>
              <Button type="button" variant="outline" onClick={() => setGuideOpen(false)} className="gap-2 border-2 border-gold/50 font-semibold">
                <SkipForward className="h-4 w-4" /> דלג על המדריך
              </Button>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="התקדמות במדריך" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
              <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
            </div>
          </DialogHeader>

          <div className="space-y-5 p-5">
            <div className="flex items-start gap-4 rounded-2xl border-2 border-gold/35 bg-background p-5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-gold/10"><StepIcon className="h-6 w-6 text-navy" /></span>
              <div className="space-y-2 text-right">
                <h3 className="text-xl font-bold">{current.title}</h3>
                <p className="text-base leading-7 text-muted-foreground">{current.description}</p>
                <p className="rounded-lg bg-gold/10 px-3 py-2 text-sm"><strong>טיפ:</strong> {current.tip}</p>
              </div>
            </div>

            <div className="rounded-2xl border-2 border-gold/30 bg-secondary/10 p-5">
              <div className="mb-3 text-sm font-semibold text-muted-foreground">המחשה אינטראקטיבית</div>
              {illustration}
            </div>

            <div className="flex justify-center gap-2" aria-label="בחירת שלב במדריך">
              {STEPS.map((item, index) => (
                <button key={item.title} type="button" onClick={() => setStep(index)} aria-label={`עבור לשלב ${index + 1}: ${item.title}`} className={cn("h-3 w-3 rounded-full border border-gold", index === step ? "bg-navy ring-2 ring-gold/40" : "bg-background")} />
              ))}
            </div>

            <Button type="button" variant={hidden ? "default" : "outline"} onClick={toggleHidden} className="h-12 w-full gap-2 border-2 border-gold/60 text-base font-semibold">
              <EyeOff className="h-5 w-5" /> {hidden ? "לא יוצג שוב — לחץ כדי לבטל" : "אל תציג לי את המדריך שוב"}
            </Button>
          </div>

          <DialogFooter className="flex-row-reverse justify-between gap-3 border-t border-gold/25 bg-secondary/10 p-5 sm:justify-between">
            {step === STEPS.length - 1 ? (
              <Button type="button" onClick={() => setGuideOpen(false)} className="gap-2 bg-navy text-white"><Check className="h-4 w-4" /> הבנתי, אפשר להתחיל</Button>
            ) : (
              <Button type="button" onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))} className="gap-2 bg-navy text-white">הבא <ChevronLeft className="h-4 w-4" /></Button>
            )}
            <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))} className="gap-2"><ChevronRight className="h-4 w-4" /> הקודם</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
