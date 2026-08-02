import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FolderTree,
  ListChecks,
  PencilLine,
  EyeOff,
  SkipForward,
  SlidersHorizontal,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CardEditor } from "./CardEditor";

const QUESTION_GUIDE_HIDDEN_KEY = "question-creation-guide-hidden-v1";

const GUIDE_STEPS = [
  {
    title: "שלב ראשון: בוחרים קטגוריה",
    description: "כדי ליצור שאלה, צריך קודם לבחור באיזה מקום היא תישמר. המקום הזה נקרא קטגוריה.",
    instructions: [
      "הכרטיס „ש״ס”, שמסומן במספר 1, הוא דוגמה לקטגוריה.",
      "הכפתור העגול עם החץ בתוך הכרטיס „ש״ס”, שמסומן במספר 2, פותח את הקטגוריה.",
      "אחרי שבחרת את הקטגוריה הרצויה, לחץ על סימן ה־✓ שמסומן במספר 3 כדי לאשר את הסיווג.",
    ],
    tip: "גם „כללי”, „טור” ו„תנ״ך” הן קטגוריות. בדוגמה הזאת מתמקדים רק ב„ש״ס”.",
    image: "/question-guide/categories.png",
    imageAlt: "צילום אמיתי של אזור בחירת הקטגוריות",
    imageHint: "1 הוא כרטיס הקטגוריה. 2 הוא כפתור הפתיחה. 3 הוא סימן ה־✓ שמאשר את הבחירה.",
    imageDisplayWidth: 771,
    markers: [
      { number: 1, x: 72, y: 62, offsetX: 0, offsetY: -18, targetWidth: 43, targetHeight: 11, label: "כרטיס הקטגוריה שנבחרה" },
      { number: 2, x: 89, y: 60, offsetX: 0, offsetY: -25, label: "כפתור פתיחת הקטגוריה" },
      { number: 3, x: 56, y: 60, offsetX: 0, offsetY: -25, label: "סימן הווי שמאשר את הסיווג" },
    ],
    icon: FolderTree,
  },
  {
    title: "שלב שני: בוחרים סוג שאלה",
    description: "עכשיו בוחרים איך השאלה תיראה. הכפתור הכחול הוא הסוג שנבחר.",
    instructions: [
      "„אמריקאי” כבר נבחר עבורך כברירת מחדל.",
      "אפשר ללחוץ על „נכון/לא נכון” או על „כרטיסיה” כדי לבחור סוג אחר.",
      "אפשר לבחור יותר מסוג אחד אם רוצים ליצור כמה גרסאות של אותה שאלה.",
    ],
    tip: "לשאלה עם כמה תשובות אפשריות בחר „אמריקאי”.",
    image: "/question-guide/question-types.png",
    imageAlt: "צילום אמיתי של כפתורי סוגי השאלות",
    imageHint: "הכפתור הכחול מראה מה בחרת.",
    imageDisplayWidth: 771,
    markers: [
      { number: 1, x: 83, y: 55, offsetX: 0, offsetY: -35, label: "סוג אמריקאי שנבחר כברירת מחדל" },
      { number: 2, x: 50, y: 55, offsetX: 0, offsetY: -35, label: "כפתור נכון או לא נכון" },
      { number: 3, x: 17, y: 55, offsetX: 0, offsetY: -35, label: "כפתור כרטיסיה" },
    ],
    icon: ListChecks,
  },
  {
    title: "שלב שלישי: כותבים ומסמנים תשובה נכונה",
    description: "כותבים את השאלה ואת כל התשובות האפשריות. אחר כך חייבים לומר למערכת איזו תשובה נכונה.",
    instructions: [
      "כתוב את השאלה בתיבה הגדולה.",
      "כתוב תשובה אחרת בכל שורת „אפשרות”.",
      "לחץ על העיגול בצד שמאל של התשובה הנכונה.",
      "כשהעיגול מסומן, המערכת יודעת שזו התשובה הנכונה.",
    ],
    tip: "אפשר לסמן יותר מעיגול אחד רק כאשר יש לשאלה כמה תשובות נכונות.",
    image: "/question-guide/question-and-answers.png",
    imageAlt: "צילום אמיתי של שדה השאלה, אפשרויות התשובה ועיגולי הסימון",
    imageHint: "העיגולים נמצאים בצד שמאל של כל תשובה — לחץ על העיגול הנכון.",
    imageDisplayWidth: 771,
    markers: [
      { number: 1, x: 92, y: 13, offsetX: -8, offsetY: 12, label: "המקום שבו כותבים את השאלה" },
      { number: 2, x: 88, y: 44, offsetX: -8, offsetY: -10, label: "המקום שבו כותבים אפשרות תשובה" },
      { number: 3, x: 3, y: 43, offsetX: 8, offsetY: -10, label: "העיגול שעליו לוחצים לסימון תשובה נכונה" },
    ],
    icon: PencilLine,
  },
  {
    title: "שלב רביעי: אפשרויות נוספות — לא חובה",
    description: "החלק הזה אינו חובה. משתמשים בו רק אם רוצים להוסיף תגיות או להכניס את השאלה למערכת מבחן.",
    instructions: [
      "לחץ על „אפשרויות אופציונליות” כדי לפתוח את האזור.",
      "אפשר לכתוב תגיות שיעזרו למצוא את השאלה.",
      "אפשר לבחור מערכת יעד, או להשאיר „ללא מערכת”.",
      "לחץ שוב על הכותרת כדי למזער את האזור.",
    ],
    tip: "אם אינך צריך תגיות או מערכת מבחן, אפשר לדלג על השלב הזה.",
    image: "/question-guide/optional-settings.png",
    imageAlt: "צילום אמיתי של אזור האפשרויות האופציונליות",
    imageHint: "כל מה שמופיע באזור הזה הוא רשות ולא חובה.",
    imageDisplayWidth: 771,
    markers: [
      { number: 1, x: 91, y: 9, offsetX: -8, offsetY: 12, label: "כותרת האפשרויות האופציונליות" },
      { number: 2, x: 89, y: 47, offsetX: -8, offsetY: -12, label: "שדה התגיות" },
      { number: 3, x: 89, y: 76, offsetX: -8, offsetY: -12, label: "בחירת מערכת היעד" },
      { number: 4, x: 4, y: 9, offsetX: 8, offsetY: 12, label: "החץ למזעור האפשרויות" },
    ],
    icon: SlidersHorizontal,
  },
  {
    title: "שלב חמישי: שומרים את השאלה",
    description: "זהו השלב האחרון. בודקים שהכול נכון ושומרים.",
    instructions: [
      "בדוק שכתבת שאלה וכל התשובות.",
      "בשאלה אמריקאית, בדוק שסימנת לפחות עיגול אחד.",
      "לחץ על הכפתור הכחול „הוסף שאלה”.",
      "לאחר השמירה הטופס יתנקה ותוכל ליצור שאלה נוספת.",
    ],
    tip: "אם הכפתור לא שומר, חזור למעלה ובדוק שלא שכחת שאלה, תשובה או עיגול נכון.",
    image: "/question-guide/save-question.png",
    imageAlt: "צילום אמיתי של כפתור הוסף שאלה",
    imageHint: "רק לחיצה על „הוסף שאלה” שומרת את השאלה.",
    imageDisplayWidth: 166,
    markers: [
      { number: 3, x: 50, y: 50, offsetX: 0, offsetY: -30, label: "כפתור הוסף שאלה ששומר את השאלה" },
    ],
    icon: CheckCircle2,
  },
] as const;

const GUIDE_HIGHLIGHT_PATTERN =
  /(קטגוריות|קטגוריה|החץ|סימן ה־✓|כפתור ה־\+|העיגול|אמריקאי|נכון\/לא נכון|כרטיסיה|אפשרויות אופציונליות|תגיות|מערכת יעד|הוסף שאלה)/g;
const GUIDE_HIGHLIGHT_TERMS = new Set([
  "קטגוריות",
  "קטגוריה",
  "החץ",
  "סימן ה־✓",
  "כפתור ה־+",
  "העיגול",
  "אמריקאי",
  "נכון/לא נכון",
  "כרטיסיה",
  "אפשרויות אופציונליות",
  "תגיות",
  "מערכת יעד",
  "הוסף שאלה",
]);

function renderHighlightedGuideText(text: string) {
  return text.split(GUIDE_HIGHLIGHT_PATTERN).map((part, index) =>
    GUIDE_HIGHLIGHT_TERMS.has(part) ? (
      <mark
        key={`${part}-${index}`}
        className="rounded bg-gold/25 px-1 font-semibold text-foreground"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function QuestionCreationPage() {
  const [editorKey, setEditorKey] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [dontShowGuideAgain, setDontShowGuideAgain] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [guideDemoCategoryOpen, setGuideDemoCategoryOpen] = useState(false);
  const [guideDemoCategoryConfirmed, setGuideDemoCategoryConfirmed] = useState(false);
  const [guideDemoType, setGuideDemoType] = useState<"multiple" | "boolean" | "flashcard">("multiple");
  const [guideDemoCorrectIndex, setGuideDemoCorrectIndex] = useState<number | null>(null);
  const [guideDemoOptionsOpen, setGuideDemoOptionsOpen] = useState(false);
  const [guideDemoSaved, setGuideDemoSaved] = useState(false);
  const resetEditor = useCallback(() => setEditorKey((key) => key + 1), []);
  const currentGuideStep = GUIDE_STEPS[guideStep];
  const GuideIcon = currentGuideStep.icon;

  useEffect(() => {
    try {
      const hidden = localStorage.getItem(QUESTION_GUIDE_HIDDEN_KEY) === "1";
      setDontShowGuideAgain(hidden);
      if (!hidden) setGuideOpen(true);
    } catch {
      setGuideOpen(true);
    }
  }, []);

  const setGuideVisibility = (open: boolean) => {
    setGuideOpen(open);
    if (open) {
      try {
        setDontShowGuideAgain(localStorage.getItem(QUESTION_GUIDE_HIDDEN_KEY) === "1");
      } catch {
        setDontShowGuideAgain(false);
      }
    }
    if (!open) {
      setGuideStep(0);
      setGuideDemoCategoryOpen(false);
      setGuideDemoCategoryConfirmed(false);
      setGuideDemoType("multiple");
      setGuideDemoCorrectIndex(null);
      setGuideDemoOptionsOpen(false);
      setGuideDemoSaved(false);
    }
  };

  const toggleGuideForever = () => {
    const next = !dontShowGuideAgain;
    setDontShowGuideAgain(next);
    try {
      if (next) localStorage.setItem(QUESTION_GUIDE_HIDDEN_KEY, "1");
      else localStorage.removeItem(QUESTION_GUIDE_HIDDEN_KEY);
    } catch {
      /* localStorage may be unavailable */
    }
  };

  const guideIllustration = (() => {
    if (guideStep === 0) {
      return (
        <div className="mx-auto max-w-md space-y-3 text-right">
          <div className="text-sm font-semibold text-muted-foreground">
            1. בחר „ש״ס” · 2. פתח בחץ · 3. אשר בסימן ✓
          </div>
          <div className="overflow-hidden rounded-2xl border-2 border-gold/50 bg-background shadow-sm">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-xs font-bold text-primary-foreground">
                  1
                </span>
                <span className="text-lg font-bold text-foreground">ש״ס</span>
                <FolderTree className="h-5 w-5 text-gold" />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="אשר את קטגוריית ש״ס"
                  disabled={!guideDemoCategoryOpen}
                  onClick={() => setGuideDemoCategoryConfirmed(true)}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed ${
                    guideDemoCategoryConfirmed
                      ? "border-green-600 bg-green-600 text-white"
                      : guideDemoCategoryOpen
                        ? "border-gold/60 bg-card text-navy hover:bg-gold/15"
                        : "border-gold/35 bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <Check className="h-5 w-5" />
                  <span className="absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[11px] font-bold text-white">
                    3
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={guideDemoCategoryOpen ? "סגור את קטגוריית ש״ס" : "פתח את קטגוריית ש״ס"}
                  aria-expanded={guideDemoCategoryOpen}
                  onClick={() => {
                    setGuideDemoCategoryOpen((open) => !open);
                    setGuideDemoCategoryConfirmed(false);
                  }}
                  className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-gold/60 bg-card text-navy transition-colors hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ChevronLeft
                    className={`h-5 w-5 transition-transform ${guideDemoCategoryOpen ? "-rotate-90" : ""}`}
                  />
                  <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[11px] font-bold text-white">
                    2
                  </span>
                </button>
              </div>
            </div>
            {guideDemoCategoryOpen && (
              <div className="border-t border-gold/30 bg-gold/5 px-4 py-3">
                <div className="rounded-xl border border-gold/35 bg-card px-3 py-2 text-sm font-medium">
                  <span>מועד — הקטגוריה שבחרת</span>
                </div>
              </div>
            )}
          </div>
          <div className="text-center text-xs font-medium text-muted-foreground">
            {guideDemoCategoryConfirmed
              ? "מצוין — לחצת על ✓ והקטגוריה אושרה. עכשיו השאלה תישמר במקום שבחרת."
              : guideDemoCategoryOpen
                ? "עכשיו לחץ על סימן ה־✓ שמסומן במספר 3 כדי לאשר את הסיווג."
              : "הכרטיס עצמו הוא קטגוריה. החץ רק פותח אותה."}
          </div>
        </div>
      );
    }

    if (guideStep === 1) {
      const types = [
        { id: "multiple" as const, label: "אמריקאי" },
        { id: "boolean" as const, label: "נכון/לא נכון" },
        { id: "flashcard" as const, label: "כרטיסיה" },
      ];
      return (
        <div className="space-y-2 text-right">
          <div className="text-xs font-semibold text-muted-foreground">סוג שאלה</div>
          <div className="grid grid-cols-3 gap-2">
            {types.map((type) => {
              const selected = guideDemoType === type.id;
              return (
                <button
                  key={type.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setGuideDemoType(type.id)}
                  className={`rounded-lg border-2 px-2 py-2 text-xs font-medium transition-colors ${
                    selected
                      ? "border-navy bg-gradient-navy text-primary-foreground"
                      : "border-gold/35 bg-background hover:bg-gold/10"
                  }`}
                >
                  {type.label}
                </button>
              );
            })}
          </div>
          <div className="text-center text-[11px] text-muted-foreground">
            נסה לעבור בין סוגי השאלות
          </div>
        </div>
      );
    }

    if (guideStep === 2) {
      const answers = ["ירושלים", "חיפה", "באר שבע"];
      return (
        <div className="space-y-3 text-right">
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">שאלה</div>
            <div className="rounded-lg border-2 border-gold/35 bg-background px-3 py-2 text-sm">
              מהי בירת ישראל?
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground">
              סמן את התשובה הנכונה בעיגול
            </div>
            {answers.map((answer, index) => {
              const selected = guideDemoCorrectIndex === index;
              return (
                <button
                  key={answer}
                  type="button"
                  aria-label={`סמן את ${answer} כתשובה נכונה`}
                  aria-pressed={selected}
                  onClick={() => setGuideDemoCorrectIndex(index)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    selected
                      ? "border-gold bg-gold/15"
                      : "border-gold/30 bg-background hover:bg-gold/10"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      selected ? "border-navy" : "border-muted-foreground/60"
                    }`}
                  >
                    {selected && <span className="h-2.5 w-2.5 rounded-full bg-navy" />}
                  </span>
                  <span>{answer}</span>
                  {selected && <span className="mr-auto text-xs font-semibold text-navy">נכונה</span>}
                </button>
              );
            })}
          </div>
          <div className="rounded-lg bg-gold/10 px-2 py-1.5 text-center text-xs font-medium">
            לחץ על העיגול שליד „ירושלים”
          </div>
        </div>
      );
    }

    if (guideStep === 3) {
      return (
        <div className="overflow-hidden rounded-xl border-2 border-gold/35 bg-background text-right">
          <button
            type="button"
            aria-expanded={guideDemoOptionsOpen}
            onClick={() => setGuideDemoOptionsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 px-3 py-3 text-sm font-semibold hover:bg-gold/10"
          >
            <span>אפשרויות אופציונליות</span>
            <ChevronLeft
              className={`h-4 w-4 transition-transform ${guideDemoOptionsOpen ? "-rotate-90" : ""}`}
            />
          </button>
          {guideDemoOptionsOpen && (
            <div className="space-y-2 border-t border-gold/25 bg-secondary/20 p-3 text-xs">
              <div className="rounded-lg border border-gold/30 bg-background px-3 py-2">
                תגיות: היסטוריה, מבחן
              </div>
              <div className="rounded-lg border border-gold/30 bg-background px-3 py-2">
                מערכת יעד: ללא מערכת
              </div>
            </div>
          )}
          <div className="border-t border-gold/20 px-3 py-2 text-center text-[11px] text-muted-foreground">
            לחץ לפתיחה ולמזעור
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3 text-center">
        <Button
          type="button"
          onClick={() => setGuideDemoSaved(true)}
          className="mx-auto gap-2 bg-gradient-navy text-primary-foreground"
        >
          {guideDemoSaved ? <CheckCircle2 className="h-4 w-4" /> : <PencilLine className="h-4 w-4" />}
          {guideDemoSaved ? "השאלה נשמרה" : "הוסף שאלה"}
        </Button>
        <div className={`text-xs ${guideDemoSaved ? "font-semibold text-green-700" : "text-muted-foreground"}`}>
          {guideDemoSaved
            ? "מצוין! זו הדגמה בלבד ולא נוספה שאלה אמיתית."
            : "לחץ על הכפתור כדי לתרגל שמירה"}
        </div>
      </div>
    );
  })();

  return (
    <Card className="gold-frame mx-auto w-full max-w-7xl p-4 sm:p-6" dir="rtl">
      <div className="mb-5 flex items-center justify-end gap-3 text-right">
        <div>
          <h2 className="font-display text-xl font-bold text-foreground">יצירת שאלות</h2>
          <p className="text-sm text-muted-foreground">
            יצירת שאלה חדשה ושיוכה לקטגוריות או למערכת מבחנים.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setGuideVisibility(true)}
          aria-label="פתח מדריך אינטראקטיבי ליצירת שאלות"
          title="איך יוצרים שאלה?"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-gold/60 text-gold transition-colors hover:border-gold hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
        >
          <CircleHelp className="h-5 w-5" />
        </button>
      </div>

      <CardEditor key={editorKey} deckId={null} onClose={resetEditor} />

      <Dialog open={guideOpen} onOpenChange={setGuideVisibility}>
        <DialogContent dir="rtl" className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader className="text-right">
            <div className="flex items-start justify-between gap-3 pl-8">
              <div>
                <DialogTitle>מדריך אינטראקטיבי ליצירת שאלות</DialogTitle>
                <DialogDescription className="mt-1">
                  שלב {guideStep + 1} מתוך {GUIDE_STEPS.length}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={dontShowGuideAgain ? "default" : "outline"}
                  size="sm"
                  aria-pressed={dontShowGuideAgain}
                  onClick={toggleGuideForever}
                  className="gap-2 border-2 border-gold/50 font-semibold"
                >
                  <EyeOff className="h-4 w-4" />
                  {dontShowGuideAgain ? "לא יוצג שוב" : "אל תציג שוב"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setGuideVisibility(false)}
                  className="gap-2 border-2 border-gold/50 font-semibold"
                >
                  <SkipForward className="h-4 w-4" />
                  דלג על המדריך
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div
              className="h-2 overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-label="התקדמות במדריך"
              aria-valuemin={1}
              aria-valuemax={GUIDE_STEPS.length}
              aria-valuenow={guideStep + 1}
            >
              <div
                className="h-full rounded-full bg-gold transition-[width] duration-300"
                style={{ width: `${((guideStep + 1) / GUIDE_STEPS.length) * 100}%` }}
              />
            </div>

            <div className="rounded-2xl border-2 border-gold/40 bg-secondary/20 p-5 text-center">
              <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-gold/60 bg-background text-gold">
                <GuideIcon className="h-7 w-7" />
              </span>
              <h3 className="mb-2 text-lg font-bold text-foreground">{currentGuideStep.title}</h3>
              <p className="text-sm leading-6 text-muted-foreground">{currentGuideStep.description}</p>
              <ol className="mt-4 space-y-2 text-right">
                {currentGuideStep.instructions.map((instruction, index) => (
                  <li key={instruction} className="flex items-start gap-2 text-sm leading-6 text-foreground">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-primary-foreground">
                      {index + 1}
                    </span>
                    <span>{renderHighlightedGuideText(instruction)}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 rounded-xl bg-gold/10 px-3 py-2 text-sm text-foreground">
                <strong>טיפ:</strong> {currentGuideStep.tip}
              </div>
            </div>

            <figure className="overflow-hidden rounded-2xl border-2 border-gold/40 bg-background shadow-sm">
              <div className="border-b border-gold/25 bg-gold/10 px-3 py-2 text-right text-sm font-bold">
                כך זה נראה במסך האמיתי
              </div>
              <div className="bg-white p-2">
                <div className="relative mx-auto w-fit max-w-full">
                  <img
                    src={currentGuideStep.image}
                    alt={currentGuideStep.imageAlt}
                    className="block h-auto w-auto max-w-full rounded-lg object-contain"
                    style={{ width: `${currentGuideStep.imageDisplayWidth}px` }}
                  />
                  {currentGuideStep.markers.map((marker) => (
                    <span key={`${currentGuideStep.title}-${marker.number}`}>
                      <svg
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                      >
                        <line
                          x1={marker.x + marker.offsetX}
                          y1={marker.y + marker.offsetY}
                          x2={marker.x}
                          y2={marker.y}
                          stroke="hsl(var(--navy))"
                          strokeWidth="0.7"
                          strokeDasharray="2 1"
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 border-[3px] border-red-500 bg-transparent shadow-[0_0_0_3px_rgba(255,255,255,0.9)] ${
                          "targetWidth" in marker ? "rounded-xl" : "h-8 w-8 rounded-full"
                        }`}
                        style={{
                          left: `${marker.x}%`,
                          top: `${marker.y}%`,
                          ...("targetWidth" in marker
                            ? { width: `${marker.targetWidth}%`, height: `${marker.targetHeight}%` }
                            : {}),
                        }}
                      />
                      <span
                        aria-label={`סימון ${marker.number}: ${marker.label}`}
                        title={`${marker.number}. ${marker.label}`}
                        className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-navy text-xs font-extrabold text-primary-foreground shadow-lg ring-4 ring-gold/80"
                        style={{
                          left: `${marker.x + marker.offsetX}%`,
                          top: `${marker.y + marker.offsetY}%`,
                        }}
                      >
                        {marker.number}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              <figcaption className="border-t border-gold/25 px-3 py-2 text-center text-xs font-medium text-muted-foreground">
                {currentGuideStep.imageHint}
              </figcaption>
            </figure>

            <div className="rounded-2xl border-2 border-gold/30 bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-foreground">המחשה אינטראקטיבית</span>
                <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-muted-foreground">
                  אפשר ללחוץ
                </span>
              </div>
              {guideIllustration}
            </div>

            <div className="flex justify-center gap-2" aria-label="בחירת שלב במדריך">
              {GUIDE_STEPS.map((step, index) => (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setGuideStep(index)}
                  aria-label={`עבור לשלב ${index + 1}: ${step.title}`}
                  aria-current={index === guideStep ? "step" : undefined}
                  className={`h-2.5 rounded-full transition-all ${
                    index === guideStep ? "w-8 bg-gold" : "w-2.5 bg-gold/30 hover:bg-gold/60"
                  }`}
                />
              ))}
            </div>
          </div>

          <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={guideStep === 0}
              onClick={() => setGuideStep((step) => Math.max(0, step - 1))}
              className="gap-1"
            >
              <ChevronRight className="h-4 w-4" />
              הקודם
            </Button>

            {guideStep < GUIDE_STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={() => setGuideStep((step) => Math.min(GUIDE_STEPS.length - 1, step + 1))}
                className="gap-1 bg-gradient-navy text-primary-foreground"
              >
                הבא
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => setGuideVisibility(false)}
                className="bg-gradient-navy text-primary-foreground"
              >
                הבנתי, אפשר להתחיל
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
