import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Eye, Check, X, ChevronLeft, ChevronRight, RotateCcw, Trophy, Settings2, LayoutGrid, Clock, ChevronDown, Calendar as CalendarIcon, RefreshCw, Timer, TrendingUp, TrendingDown, Minus, List, Grid2x2, Zap, Palette, Edit2, AlignRight, AlignCenter, AlignLeft } from "lucide-react";
import { QuizThemeEditorDialog, CustomQuizTheme, DEFAULT_CUSTOM_THEME, FONT_FAMILY_MAP, FONT_SIZE_MAP, FONT_WEIGHT_MAP, BORDER_RADIUS_MAP } from "./QuizThemeEditor";
import { QuizTypographyPanel, QuizTypography, loadTypography, storeTypography, typographyToStyle, typographyToBgStyle, ANSWER_TYPOGRAPHY_KEY, loadAnswerTypography } from "./QuizTypographyPanel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useStudy } from "@/lib/study/store";
import { isDue, buildStudyQueue } from "@/lib/study/srs";
import { parseCloze, hasCloze, renderCloze } from "@/lib/study/cloze";
import type { Card as StudyCard, StudyMode } from "@/lib/study/types";
import { cn } from "@/lib/utils";

// ===== Persistence keys =====
const COMBO_PREF_KEY       = "study-combo-pref-v1";
const VIEW_MODE_KEY        = "study-view-mode-v1";
const OPT_LAYOUT_KEY       = "study-opt-layout-v1";     // "list" | "grid" | "letters"
const QUIZ_ANSWER_MODE_KEY   = "study-quiz-answer-mode-v1"; // "instant" | "button"
const QUIZ_THEME_KEY         = "study-quiz-theme-v1";      // "classic" | "millionaire" | "navy" | "dark" | "colorful" | "custom"
const CUSTOM_QUIZ_THEME_KEY  = "study-quiz-custom-theme-v1";
const QUESTION_ALIGN_KEY     = "study-question-align-v1";
const QUIZ_HISTORY_KEY     = "study-quiz-history-v1";

type ComboPref      = "flash" | "multi" | "both";
type ViewMode       = "classic" | "flip" | "list" | "test";
type OptLayout      = "list" | "grid" | "letters";
type QuizAnswerMode = "instant" | "button";
type QuizTheme      = "classic" | "millionaire" | "navy" | "dark" | "colorful" | "custom";
type QuestionAlign  = "right" | "center" | "left";

const QUIZ_THEME_META: Record<QuizTheme, { label: string; desc: string; icon: string }> = {
  classic:     { label: "קלאסי",    desc: "רשימה עם אותיות עבריות",       icon: "📋" },
  millionaire: { label: "מיליונר",  desc: "גריד כחול כהה עם מסגרות זהב",  icon: "🏆" },
  navy:        { label: "נייבי",    desc: "כפתורי נייבי על רקע לבן",      icon: "🔷" },
  dark:        { label: "לילה",     desc: "רקע כהה עם מסגרות זהב",        icon: "🌙" },
  colorful:    { label: "צבעוני",   desc: "גריד עם צבע לכל תשובה",       icon: "🎨" },
  custom:      { label: "מותאם",    desc: "עיצוב מותאם אישית שלך",        icon: "✏️" },
};

// Per-option colors for the 'colorful' theme
const COLORFUL_OPTS: { base: string; sel: string }[] = [
  { base: "bg-blue-600/90 border-blue-400",       sel: "bg-blue-700 border-blue-200 ring-2 ring-white/30" },
  { base: "bg-emerald-600/90 border-emerald-400", sel: "bg-emerald-700 border-emerald-200 ring-2 ring-white/30" },
  { base: "bg-orange-500/90 border-orange-300",   sel: "bg-orange-600 border-orange-100 ring-2 ring-white/30" },
  { base: "bg-purple-600/90 border-purple-400",   sel: "bg-purple-700 border-purple-200 ring-2 ring-white/30" },
  { base: "bg-teal-600/90 border-teal-400",       sel: "bg-teal-700 border-teal-200 ring-2 ring-white/30" },
  { base: "bg-rose-600/90 border-rose-400",       sel: "bg-rose-700 border-rose-200 ring-2 ring-white/30" },
];

type QuizHistoryEntry = { date: string; pct: number; totalMs: number; mode: string; total: number };

function loadQuizHistory(): QuizHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(QUIZ_HISTORY_KEY) ?? "[]"); } catch { return []; }
}
function saveQuizEntry(entry: QuizHistoryEntry) {
  try {
    const hist = loadQuizHistory();
    hist.unshift(entry);
    localStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(hist.slice(0, 60)));
  } catch { /* noop */ }
}

const HEB_LETTERS = ["א", "ב", "ג", "ד", "ה", "ו"];

const MS = { min: 60_000, hour: 3_600_000, day: 86_400_000 };

const NEXT_INTERVAL_OPTIONS: { id: string; label: string; ms: number | null }[] = [
  { id: "auto", label: "\u05d0\u05d5\u05d8\u05d5\u05de\u05d8\u05d9", ms: null },
  { id: "10m", label: "10 \u05d3\u05e7\u05d5\u05ea", ms: 10 * MS.min },
  { id: "1h", label: "\u05e9\u05e2\u05d4", ms: MS.hour },
  { id: "1d", label: "\u05de\u05d7\u05e8", ms: MS.day },
  { id: "3d", label: "3 \u05d9\u05de\u05d9\u05dd", ms: 3 * MS.day },
  { id: "1w", label: "\u05e9\u05d1\u05d5\u05e2", ms: 7 * MS.day },
  { id: "1mo", label: "\u05d7\u05d5\u05d3\u05e9", ms: 30 * MS.day },
];

function NextReviewTabs({
  value,
  customDate,
  onChange,
  onCustomDate,
}: {
  value: string;
  customDate: string;
  onChange: (id: string) => void;
  onCustomDate: (iso: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">חזרה הבאה:</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {NEXT_INTERVAL_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              "px-2.5 py-1 text-xs rounded-lg border-2 transition-colors",
              value === o.id
                ? "border-gold bg-gradient-navy text-primary-foreground"
                : "border-gold/40 bg-card hover:bg-secondary"
            )}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange("custom")}
          className={cn(
            "px-2.5 py-1 text-xs rounded-lg border-2 transition-colors flex items-center gap-1",
            value === "custom"
              ? "border-gold bg-gradient-navy text-primary-foreground"
              : "border-gold/40 bg-card hover:bg-secondary"
          )}
        >
          <CalendarIcon className="h-3 w-3" /> מותאם
        </button>
      </div>
      {value === "custom" && (
        <Input
          type="datetime-local"
          value={customDate}
          onChange={(e) => onCustomDate(e.target.value)}
          className="h-8 text-sm border-2 border-gold/40"
        />
      )}
    </div>
  );
}

function resolveCustomDueAt(intervalId: string, customDate: string): number | undefined {
  if (intervalId === "auto") return undefined;
  if (intervalId === "custom") {
    if (!customDate) return undefined;
    const t = new Date(customDate).getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  const opt = NEXT_INTERVAL_OPTIONS.find((o) => o.id === intervalId);
  if (!opt || opt.ms == null) return undefined;
  return Date.now() + opt.ms;
}

interface Props {
  deckId: string | null;
  mode: StudyMode;
  cardIds?: string[]; // optional whitelist; when provided, restrict queue to these cards
  onExit: () => void;
  /** When set, session auto-ends after this many seconds (used by Quick Review). */
  timeLimitSec?: number;
}

export function StudySession({ deckId, mode, cardIds, onExit, timeLimitSec }: Props) {
  const { state, reviewCard, setUiPref } = useStudy();

  const comboPrefForQueue = (state.uiPrefs?.studyComboPref as ComboPref | undefined)
    ?? ((typeof window !== "undefined" ? localStorage.getItem(COMBO_PREF_KEY) : null) as ComboPref | null)
    ?? "both";
  const queue = useMemo(() => {
    // When cardIds is explicitly provided, use them directly (supports card_decks-linked cards).
    // When deckId is null (category-owned cards), use all cards.
    let cards: StudyCard[];
    if (cardIds) {
      const allowed = new Set(cardIds);
      cards = state.cards.filter((c) => allowed.has(c.id));
    } else if (deckId) {
      cards = state.cards.filter((c) => c.deckId === deckId);
    } else {
      cards = state.cards;
    }
    // Respect the combo-mode preference at the queue level so that
    // "רק בחירה מרובה" actually hides pure flashcards (and vice versa).
    if (comboPrefForQueue === "multi") {
      cards = cards.filter((c) =>
        c.type === "multiple" || c.type === "boolean" ||
        (c.type === "combo" && Array.isArray(c.options) && c.options.length > 0)
      );
    } else if (comboPrefForQueue === "flash") {
      cards = cards.filter((c) =>
        c.type === "flashcard" ||
        (c.type === "combo" && !!c.answer)
      );
    }
    if (mode === "srs") return buildStudyQueue(cards);
    return [...cards].sort(() => Math.random() - 0.5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, mode, cardIds, comboPrefForQueue]);

  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [instantPendingSubmit, setInstantPendingSubmit] = useState<{ correct: boolean; quality: 0|1|2|3|4|5 } | null>(null);
  const [boolPick, setBoolPick] = useState<boolean | null>(null);
  const [comboMode, setComboMode] = useState<"flash" | "multi" | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [results, setResults] = useState<{ correct: number; total: number; totalMs: number; failed: string[] }>({ correct: 0, total: 0, totalMs: 0, failed: [] });

  // Session-level timer (never resets per card)
  const sessionStart = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - sessionStart.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Quick Review: optional countdown timer that auto-ends the session.
  useEffect(() => {
    if (!timeLimitSec) return;
    if (elapsed >= timeLimitSec) {
      setIdx((i) => Math.max(i, 1)); // ensure results screen path is taken
      // Jump to results: set idx beyond queue length
      setIdx(queue.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, timeLimitSec, queue.length]);

  // Option layout / combo preference / view mode — synced via uiPrefs (localStorage + cloud, last-write-wins).
  // We keep localStorage as a synchronous fallback for first paint (and for guest mode).
  // NOTE: optLayout is kept only for legacy pref storage; layout is now driven by quizTheme.
  const _optLayoutRaw =
    (state.uiPrefs?.studyOptLayout as OptLayout | undefined)
    ?? (() => {
      if (typeof window === "undefined") return "letters";
      const v = localStorage.getItem(OPT_LAYOUT_KEY);
      return (v === "grid" || v === "letters" || v === "list" ? v : "letters") as OptLayout;
    })();
  void _optLayoutRaw; // kept for potential migration reads

  const comboPref: ComboPref =
    (state.uiPrefs?.studyComboPref as ComboPref | undefined)
    ?? (() => {
      if (typeof window === "undefined") return "both";
      const v = localStorage.getItem(COMBO_PREF_KEY);
      return (v === "flash" || v === "multi" || v === "both" ? v : "both") as ComboPref;
    })();
  const setComboPref = useCallback((v: ComboPref) => {
    try { localStorage.setItem(COMBO_PREF_KEY, v); } catch { /* noop */ }
    try { setUiPref("studyComboPref", v); } catch { /* guest / not signed in */ }
  }, [setUiPref]);

  const viewMode: ViewMode =
    (state.uiPrefs?.studyViewMode as ViewMode | undefined)
    ?? (() => {
      if (typeof window === "undefined") return "classic";
      const v = localStorage.getItem(VIEW_MODE_KEY);
      return (v === "classic" || v === "flip" || v === "list" || v === "test" ? v : "classic") as ViewMode;
    })();
  const setViewMode = useCallback((v: ViewMode) => {
    try { localStorage.setItem(VIEW_MODE_KEY, v); } catch { /* noop */ }
    try { setUiPref("studyViewMode", v); } catch { /* guest / not signed in */ }
  }, [setUiPref]);

  const quizAnswerMode: QuizAnswerMode =
    (state.uiPrefs?.studyAnswerMode as QuizAnswerMode | undefined)
    ?? (() => {
      if (typeof window === "undefined") return "instant";
      const v = localStorage.getItem(QUIZ_ANSWER_MODE_KEY);
      return (v === "instant" || v === "button" ? v : "instant") as QuizAnswerMode;
    })();
  const setQuizAnswerMode = useCallback((v: QuizAnswerMode) => {
    try { localStorage.setItem(QUIZ_ANSWER_MODE_KEY, v); } catch { /* noop */ }
    try { setUiPref("studyAnswerMode", v); } catch { /* guest / not signed in */ }
  }, [setUiPref]);

  const quizTheme: QuizTheme =
    (state.uiPrefs?.studyQuizTheme as QuizTheme | undefined)
    ?? (() => {
      if (typeof window === "undefined") return "classic";
      const v = localStorage.getItem(QUIZ_THEME_KEY);
      return (["classic", "millionaire", "navy", "dark", "colorful", "custom"].includes(v ?? "") ? v : "classic") as QuizTheme;
    })();
  const setQuizTheme = useCallback((v: QuizTheme) => {
    try { localStorage.setItem(QUIZ_THEME_KEY, v); } catch { /* noop */ }
    try { setUiPref("studyQuizTheme", v); } catch { /* guest / not signed in */ }
  }, [setUiPref]);

  const [customQuizTheme, setCustomQuizTheme] = useState<CustomQuizTheme>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_QUIZ_THEME_KEY);
      return saved ? { ...DEFAULT_CUSTOM_THEME, ...(JSON.parse(saved) as Partial<CustomQuizTheme>) } : DEFAULT_CUSTOM_THEME;
    } catch { return DEFAULT_CUSTOM_THEME; }
  });
  const saveCustomTheme = useCallback((t: CustomQuizTheme) => {
    setCustomQuizTheme(t);
    try { localStorage.setItem(CUSTOM_QUIZ_THEME_KEY, JSON.stringify(t)); } catch { /* noop */ }
  }, []);

  const [themeEditorOpen, setThemeEditorOpen] = useState(false);

  const [typography, setTypography] = useState<QuizTypography>(loadTypography);
  const [answerTypography, setAnswerTypography] = useState<QuizTypography>(loadAnswerTypography);

  const [questionAlign, setQuestionAlign] = useState<QuestionAlign>(() => {
    try {
      const v = localStorage.getItem(QUESTION_ALIGN_KEY);
      return (["right", "center", "left"] as QuestionAlign[]).includes(v as QuestionAlign) ? (v as QuestionAlign) : "right";
    } catch { return "right"; }
  });

  // Custom next-due selection (per current card). Reset when card changes.
  const [nextInterval, setNextInterval] = useState<string>("auto");
  const [customDate, setCustomDate] = useState<string>("");

  // Test mode: store all answers; reveal nothing until end
  const [testAnswers, setTestAnswers] = useState<Array<{ cardId: string; quality: 0|1|2|3|4|5; correct: boolean; durationMs: number }>>([]);

  useEffect(() => {
    setStartedAt(Date.now());
    setComboMode(null);
    setNextInterval("auto");
    setCustomDate("");
    setInstantPendingSubmit(null);
  }, [idx]);

  const card = queue[idx];

  const categoryBreadcrumb = useMemo(() => {
    const cats = state.categories ?? [];
    const catNames = card?.tags.filter((t) => t.startsWith("cat:")).map((t) => t.slice(4)) ?? [];
    if (!catNames.length) return null;
    const buildPath = (name: string): string[] => {
      const cat = cats.find((c) => c.name === name);
      if (!cat) return [name];
      const path: string[] = [];
      let cur: typeof cat | undefined = cat;
      while (cur) {
        path.unshift(cur.name);
        cur = cur.parentId ? cats.find((c) => c.id === cur!.parentId) : undefined;
      }
      return path;
    };
    let bestPath = buildPath(catNames[0]);
    for (const name of catNames.slice(1)) {
      const p = buildPath(name);
      if (p.length > bestPath.length) bestPath = p;
    }
    // Skip root level (e.g. "תלמוד בבלי") when there are deeper levels
    const displayPath = bestPath.length > 1 ? bestPath.slice(1) : bestPath;
    return displayPath.join(" ❯ ");
  }, [card?.tags, state.categories]);

  const submit = useCallback((correct: boolean, quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    if (!card) return;
    const durationMs = Date.now() - startedAt;
    const customDueAt = resolveCustomDueAt(nextInterval, customDate);
    const cardSnapshot = card; // capture for undo (current srs/stats are pre-review)
    const idxAtSubmit = idx;
    if (viewMode === "test") {
      setTestAnswers((arr) => [...arr, { cardId: card.id, quality, correct, durationMs }]);
    } else {
      const res = reviewCard(card.id, quality, durationMs, mode === "srs", customDueAt);
    }
    setResults((r) => ({
      correct: r.correct + (correct ? 1 : 0),
      total: r.total + 1,
      totalMs: r.totalMs + durationMs,
      failed: correct ? r.failed : [...r.failed, card.id],
    }));
    setRevealed(false); setSelected([]); setBoolPick(null); setComboMode(null);
    setIdx((i) => i + 1);
  }, [card, startedAt, mode, reviewCard, nextInterval, customDate, viewMode, idx]);

  // Flush test-mode answers when finishing
  useEffect(() => {
    if (viewMode === "test" && idx >= queue.length && testAnswers.length > 0) {
      testAnswers.forEach((a) => reviewCard(a.cardId, a.quality, a.durationMs, mode === "srs"));
      setTestAnswers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, queue.length, viewMode]);

  // Instant-answer mode: auto-submit 1 second after reveal
  useEffect(() => {
    if (!instantPendingSubmit) return;
    const t = setTimeout(() => {
      submit(instantPendingSubmit.correct, instantPendingSubmit.quality);
    }, 1000);
    return () => clearTimeout(t);
  }, [instantPendingSubmit, submit]);

  // === Keyboard shortcuts ===
  // Space / Enter — reveal answer (flashcard) or check answer (multiple)
  // Flashcard: 1=שכחתי, 2=קשה, 3=טוב, 4=קל
  // Multiple: 1-9 = toggle option
  // Boolean: 1 = נכון, 2 = לא נכון
  // U / Escape = יציאה
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!card) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Exit
      if (e.key.toLowerCase() === "u" || e.key === "Escape") {
        e.preventDefault(); onExit(); return;
      }

      const isFlash = card.type === "flashcard" || (card.type === "combo" && comboMode === "flash");
      const isMulti = card.type === "multiple" || (card.type === "combo" && comboMode === "multi");

      // Flashcard reveal + grade
      if (isFlash) {
        if (!revealed && (e.key === " " || e.key === "Enter")) {
          e.preventDefault(); setRevealed(true); return;
        }
        if (revealed) {
          if (e.key === "1") { e.preventDefault(); submit(false, 1); return; }
          if (e.key === "2") { e.preventDefault(); submit(true, 3); return; }
          if (e.key === "3") { e.preventDefault(); submit(true, 4); return; }
          if (e.key === "4") { e.preventDefault(); submit(true, 5); return; }
        }
      }

      // Multiple choice — 1-9 toggle option, Enter/Space = check
      if (isMulti && (card.type as string) !== "boolean") {
        const opts = (card.type === "multiple" || card.type === "combo") ? (card.options ?? []) : [];
        if (!revealed && /^[1-9]$/.test(e.key)) {
          const i = parseInt(e.key, 10) - 1;
          if (i < opts.length) {
            e.preventDefault();
            setSelected((arr) => arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i]);
            return;
          }
        }
        if (!revealed && (e.key === "Enter" || e.key === " ") && selected.length > 0) {
          e.preventDefault(); setRevealed(true); return;
        }
      }

      // Boolean — 1=true, 2=false
      if (card.type === "boolean" && !revealed) {
        if (e.key === "1") { e.preventDefault(); setBoolPick(true); setRevealed(true); return; }
        if (e.key === "2") { e.preventDefault(); setBoolPick(false); setRevealed(true); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [card, revealed, comboMode, selected, submit, onExit]);

  if (queue.length === 0) {
    return (
      <Card className="gold-frame p-10 text-center space-y-4">
        <Trophy className="h-12 w-12 text-gold mx-auto" />
        <h3 className="font-display text-2xl font-bold">אין שאלות לחזרה</h3>
        <p className="text-muted-foreground">
          {mode === "srs" ? "כל הכבוד! חזרת על כל הכרטיסים שצריך היום." : "אין שאלות במערכת זו. הוסף שאלות כדי להתחיל."}
        </p>
        <Button onClick={onExit} className="bg-gradient-navy text-primary-foreground rounded-xl">
          חזרה
        </Button>
      </Card>
    );
  }

  // ===== List view: read-only browse of all questions + answers =====
  if (viewMode === "list") {
    return (
      <Card className="gold-frame p-6 space-y-4 animate-fade-in" dir="rtl">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={onExit}>יציאה <ChevronRight className="h-4 w-4" /></Button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{queue.length} שאלות · תצוגת רשימה</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 px-2 border-gold/50 hover:bg-gold/10 gap-1">
                  <LayoutGrid className="h-3.5 w-3.5 text-gold" />
                  <span className="text-xs">רשימה</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setViewMode("classic")}>קלאסי</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setViewMode("flip")}>כרטיס מתהפך</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setViewMode("list")}>רשימה</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setViewMode("test")}>מבחן</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          {queue.map((c, i) => (
            <details key={c.id} className="rounded-xl border-2 border-gold/30 bg-card p-4 group">
              <summary className="cursor-pointer font-medium flex items-center justify-between gap-2">
                <span>{i + 1}. {c.question.replace(/\{\{c\d+::([^}]+)\}\}/g, "$1")}</span>
                <Badge variant="outline" className="text-xs">{c.type === "flashcard" ? "פתוחה" : c.type === "multiple" ? "אמריקאית" : c.type === "boolean" ? "נכון/לא" : "משולבת"}</Badge>
              </summary>
              <div className="mt-3 pt-3 border-t border-gold/20 space-y-2 text-sm">
                {c.type === "flashcard" && <p className="text-foreground">{c.answer}</p>}
                {c.type === "combo" && c.answer && <p className="text-foreground">{c.answer}</p>}
                {(c.type === "multiple" || (c.type === "combo" && c.options?.length)) && (
                  <ul className="space-y-1">
                    {c.options?.map((o, j) => (
                      <li key={j} className={cn("px-2 py-1 rounded", c.correctIndices?.includes(j) ? "bg-green-50 dark:bg-green-950/30 border border-green-500/40" : "border border-gold/20")}>
                        {c.correctIndices?.includes(j) && <Check className="inline h-3 w-3 text-green-600 ml-1" />}
                        {o}
                      </li>
                    ))}
                  </ul>
                )}
                {c.type === "boolean" && <p>תשובה: <strong>{c.correct ? "נכון" : "לא נכון"}</strong></p>}
                {(c as { explanation?: string }).explanation && <p className="text-xs text-muted-foreground italic">{(c as { explanation?: string }).explanation}</p>}
              </div>
            </details>
          ))}
        </div>
      </Card>
    );
  }

  if (idx >= queue.length) {
    const pct = Math.round((results.correct / results.total) * 100) || 0;
    const avgSec = results.total > 0 ? Math.round((results.totalMs / results.total) / 1000 * 10) / 10 : 0;
    const totalSec = Math.floor(elapsed);
    const totalMin = Math.floor(totalSec / 60);
    const totalSecRem = totalSec % 60;
    const totalTimeStr = totalMin > 0 ? `${totalMin}:${String(totalSecRem).padStart(2,"0")} דקות` : `${totalSec} שניות`;
    const medal: { color: string; label: string; border: string } =
      pct >= 90 ? { color: "text-yellow-500", label: "מושלם", border: "border-yellow-500" }
      : pct >= 75 ? { color: "text-slate-400", label: "טוב מאוד", border: "border-slate-400" }
      : pct >= 60 ? { color: "text-amber-700", label: "עברת", border: "border-amber-700" }
      : { color: "text-destructive", label: "מומלץ לחזור", border: "border-destructive" };
    const failedCards = state.cards.filter((c) => results.failed.includes(c.id));

    // Load history & save this entry
    const history = loadQuizHistory();
    const today = new Date().toISOString().slice(0, 10);
    const todayEntry: QuizHistoryEntry = { date: today, pct, totalMs: elapsed * 1000, mode, total: results.total };
    // Only save if not already saved (avoid double-save on re-render)
    const alreadySaved = history.length > 0 && history[0].date === today && history[0].total === results.total && history[0].pct === pct;
    if (!alreadySaved) saveQuizEntry(todayEntry);

    // Compare: last session that isn't today
    const prev = history.find((h) => h.date !== today);
    const pctDiff = prev ? pct - prev.pct : null;
    const timeDiff = prev ? (elapsed * 1000) - prev.totalMs : null; // positive = slower

    const retryFailed = () => {
      setIdx(0);
      setResults({ correct: 0, total: 0, totalMs: 0, failed: [] });
      setRevealed(false); setSelected([]); setBoolPick(null);
    };
    return (
      <Card className="gold-frame p-8 text-center space-y-5 animate-fade-in" dir="rtl">
        <div className={cn("w-24 h-24 rounded-full border-4 flex items-center justify-center bg-card shadow-lg mx-auto", medal.border)}>
          <Trophy className={cn("h-10 w-10", medal.color)} />
        </div>
        <h3 className="font-display text-3xl font-bold">סיימת את הסשן!</h3>
        <div className={cn("text-6xl font-display font-bold", medal.color)}>{pct}%</div>
        <p className="text-muted-foreground">{medal.label}</p>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-lg mx-auto pt-2">
          <div className="rounded-xl border-2 border-gold/40 bg-card p-3">
            <div className="text-xs text-muted-foreground">נכונות</div>
            <div className="text-2xl font-display font-bold text-green-600">{results.correct}</div>
          </div>
          <div className="rounded-xl border-2 border-gold/40 bg-card p-3">
            <div className="text-xs text-muted-foreground">שגויות</div>
            <div className="text-2xl font-display font-bold text-destructive">{results.total - results.correct}</div>
          </div>
          <div className="rounded-xl border-2 border-gold/40 bg-card p-3">
            <div className="text-xs text-muted-foreground">זמן ממוצע</div>
            <div className="text-xl font-display font-bold text-navy flex items-center justify-center gap-1">
              <Clock className="h-3.5 w-3.5" />{avgSec}ש׳
            </div>
          </div>
          <div className="rounded-xl border-2 border-gold/40 bg-card p-3">
            <div className="text-xs text-muted-foreground">סה"כ זמן</div>
            <div className="text-lg font-display font-bold text-navy flex items-center justify-center gap-1">
              <Timer className="h-3.5 w-3.5" />{totalTimeStr}
            </div>
          </div>
        </div>

        {/* History comparison */}
        {prev && (
          <div className="max-w-md mx-auto rounded-xl border border-gold/30 bg-secondary/40 p-3 text-sm space-y-2 text-right">
            <div className="font-semibold text-foreground flex items-center justify-end gap-1">
              <TrendingUp className="h-4 w-4 text-gold" /> השוואה לסשן הקודם ({prev.date})
            </div>
            <div className="flex justify-between text-xs gap-4">
              <span className="flex items-center gap-1">
                {pctDiff !== null && pctDiff > 0 && <TrendingUp className="h-3.5 w-3.5 text-green-600" />}
                {pctDiff !== null && pctDiff < 0 && <TrendingDown className="h-3.5 w-3.5 text-destructive" />}
                {pctDiff !== null && pctDiff === 0 && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className={pctDiff !== null ? (pctDiff > 0 ? "text-green-600 font-semibold" : pctDiff < 0 ? "text-destructive font-semibold" : "text-muted-foreground") : ""}>
                  {pctDiff !== null ? `${pctDiff > 0 ? "+" : ""}${pctDiff}% ציון` : ""}
                </span>
              </span>
              <span className="text-muted-foreground">ציון קודם: {prev.pct}%</span>
            </div>
            {timeDiff !== null && (
              <div className="text-xs text-muted-foreground flex justify-between">
                <span className={timeDiff < 0 ? "text-green-600" : "text-amber-600"}>
                  {timeDiff < 0 ? `⚡ ${Math.round(Math.abs(timeDiff)/1000)}ש׳ מהר יותר` : `🐢 ${Math.round(timeDiff/1000)}ש׳ איטי יותר`}
                </span>
                <span>זמן קודם: {Math.round(prev.totalMs/1000)}ש׳</span>
              </div>
            )}
          </div>
        )}

        {/* History mini chart (last 5 sessions) */}
        {history.length >= 2 && (
          <div className="max-w-md mx-auto">
            <div className="text-xs text-muted-foreground text-right mb-1">היסטוריה (5 אחרונות)</div>
            <div className="flex items-end justify-center gap-2 h-16">
              {history.slice(0, 5).reverse().map((h, i) => (
                <div key={i} className="flex flex-col items-center gap-1 flex-1">
                  <div className="text-[10px] text-muted-foreground">{h.pct}%</div>
                  <div
                    className="w-full rounded-t-md transition-all"
                    style={{
                      height: `${Math.max(8, (h.pct / 100) * 48)}px`,
                      background: h.pct >= 90 ? "hsl(var(--gold))" : h.pct >= 60 ? "hsl(var(--navy))" : "hsl(var(--destructive))",
                      opacity: i === history.slice(0,5).length - 1 ? 1 : 0.6 + i * 0.1,
                    }}
                  />
                  <div className="text-[9px] text-muted-foreground truncate w-full text-center">{h.date.slice(5)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {failedCards.length > 0 && (
          <div className="text-right max-w-md mx-auto rounded-xl border-2 border-destructive/30 bg-destructive/5 p-3 space-y-2">
            <div className="text-sm font-semibold text-destructive">שאלות שנכשלת בהן ({failedCards.length}):</div>
            <ul className="text-xs text-muted-foreground space-y-1 max-h-24 overflow-y-auto">
              {failedCards.slice(0, 8).map((c) => (
                <li key={c.id} className="truncate">• {c.question.replace(/\{\{c\d+::([^}]+)\}\}/g, "$1")}</li>
              ))}
              {failedCards.length > 8 && <li className="opacity-60">ועוד {failedCards.length - 8}...</li>}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-center">
          {failedCards.length > 0 && (
            <Button onClick={retryFailed} variant="outline" className="border-2 border-destructive/50 text-destructive rounded-xl">
              <RefreshCw className="h-4 w-4" /> תרגל שוב רק את השגיאות
            </Button>
          )}
          <Button onClick={() => { setIdx(0); setResults({ correct: 0, total: 0, totalMs: 0, failed: [] }); setRevealed(false); setSelected([]); setBoolPick(null); sessionStart.current = Date.now(); setElapsed(0); }}
            variant="outline" className="border-2 border-gold rounded-xl">
            <RotateCcw className="h-4 w-4" /> שוב
          </Button>
          <Button onClick={onExit} className="bg-gradient-navy text-primary-foreground rounded-xl">
            סיום
          </Button>
        </div>
      </Card>
    );
  }

  const progress = ((idx) / queue.length) * 100;

  // ── Per-theme question area styles ──────────────────────────────────────────
  const questionAreaCls =
    quizTheme === "millionaire" ? "bg-[#061022] border-yellow-600/60" :
    quizTheme === "navy"        ? "bg-white dark:bg-card border-navy/40" :
    quizTheme === "dark"        ? "bg-gray-900 border-yellow-600/40" :
    "bg-secondary/30 border-gold/30"; // classic, colorful, custom (colours via style prop)

  const questionAreaStyle: React.CSSProperties = {
    ...(quizTheme === "custom" ? {
      backgroundColor: customQuizTheme.questionBg,
      borderColor:     customQuizTheme.questionBorder,
    } : {}),
    ...typographyToBgStyle(typography),
  };

  const questionTextCls =
    quizTheme === "millionaire" ? "text-white" :
    quizTheme === "dark"        ? "text-white" :
    quizTheme === "navy"        ? "text-navy dark:text-foreground" :
    "text-foreground";

  const questionTextStyle: React.CSSProperties = {
    ...(quizTheme === "custom" ? {
      color:      customQuizTheme.questionText,
      fontFamily: FONT_FAMILY_MAP[customQuizTheme.questionFontFamily],
      fontSize:   FONT_SIZE_MAP[customQuizTheme.questionFontSize],
      fontWeight: FONT_WEIGHT_MAP[customQuizTheme.questionFontWeight],
    } : {}),
    // Typography overlay (always applied on top of theme)
    ...typographyToStyle(typography),
    // Alignment from dedicated toggle (typography.align wins when explicitly set)
    textAlign: typography.align,
  };

  return (
    <Card className="gold-frame p-6 space-y-5 animate-fade-in" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* RIGHT edge (RTL start): quiz theme picker + edit btn */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Quiz theme picker */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2 border-gold/50 hover:bg-gold/10 gap-1" title="עיצוב שאלות אמריקאיות">
                <Palette className="h-3.5 w-3.5 text-gold" />
                <span className="text-xs">{QUIZ_THEME_META[quizTheme].label}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel>עיצוב שאלות אמריקאיות</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(["classic", "millionaire", "navy", "dark", "colorful", "custom"] as QuizTheme[]).map((t) => (
                <DropdownMenuItem
                  key={t}
                  onClick={() => { setQuizTheme(t); if (t === "custom") setThemeEditorOpen(true); }}
                  className={cn("flex items-start gap-2", quizTheme === t && "font-bold bg-secondary")}
                >
                  <span className="text-base mt-0.5">{QUIZ_THEME_META[t].icon}</span>
                  <div className="flex-1">
                    <div>{QUIZ_THEME_META[t].label}</div>
                    <div className="text-xs text-muted-foreground font-normal">{QUIZ_THEME_META[t].desc}</div>
                  </div>
                  {t === "custom" && (
                    <Edit2 className="h-3 w-3 text-muted-foreground mt-1 shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Edit button for custom theme */}
          {quizTheme === "custom" && (
            <Button variant="outline" size="sm" className="h-7 px-2 border-gold/50 hover:bg-gold/10"
              title="ערוך ערכת נושא מותאמת" onClick={() => setThemeEditorOpen(true)}>
              <Edit2 className="h-3.5 w-3.5 text-gold" />
            </Button>
          )}
          {/* Combo-mode preference dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2 border-gold/50 hover:bg-gold/10 gap-1" title="מסלול תרגול">
                <Settings2 className="h-3.5 w-3.5 text-gold" />
                <span className="text-xs">{comboPref === "flash" ? "פתוחה" : comboPref === "multi" ? "מרובה" : "שניהם"}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>מסלול שאלות ותשובות</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setComboPref("flash")}>
                <Eye className="h-4 w-4" /> רק תשובה פתוחה
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setComboPref("multi")}>
                <Check className="h-4 w-4" /> רק בחירה מרובה
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setComboPref("both")}>
                <RotateCcw className="h-4 w-4" /> שניהם (ברצף)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* View-mode dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2 border-gold/50 hover:bg-gold/10 gap-1" title="תצוגה">
                <LayoutGrid className="h-3.5 w-3.5 text-gold" />
                <span className="text-xs">{viewMode === "classic" ? "קלאסי" : viewMode === "flip" ? "מתהפך" : (viewMode as string) === "list" ? "רשימה" : "מבחן"}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>צורת תצוגה</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setViewMode("classic")}>קלאסי</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode("flip")}>כרטיס מתהפך</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode("list")}>רשימה (סקירה בלבד)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode("test")}>מבחן (ללא גילוי בזמן אמת)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Question text alignment toggle */}
          <Button variant="outline" size="sm" className="h-7 px-2 border-gold/50 hover:bg-gold/10"
            title="יישור טקסט השאלה"
            onClick={() => {
              const next: QuestionAlign = typography.align === "right" ? "center" : typography.align === "center" ? "left" : "right";
              setQuestionAlign(next);
              setTypography((prev) => { const t = { ...prev, align: next }; storeTypography(t); return t; });
              try { localStorage.setItem(QUESTION_ALIGN_KEY, next); } catch { /* noop */ }
            }}
          >
            {typography.align === "right"  && <AlignRight  className="h-3.5 w-3.5 text-gold" />}
            {typography.align === "center" && <AlignCenter className="h-3.5 w-3.5 text-gold" />}
            {typography.align === "left"   && <AlignLeft   className="h-3.5 w-3.5 text-gold" />}
          </Button>
          {/* Typography (T) floating panel */}
          <QuizTypographyPanel value={typography} onChange={setTypography} />
          {/* Answer typography (T) panel — separate styling for answers including justify */}
          <QuizTypographyPanel
            value={answerTypography}
            onChange={setAnswerTypography}
            storageKey={ANSWER_TYPOGRAPHY_KEY}
            title="עיצוב טקסט תשובות"
            buttonTitle="עיצוב טיפוגרפיה של תשובות"
            previewText="דוגמה לתשובה במבחן"
          />
          {/* Answer-mode toggle */}
          <Button variant="outline" size="sm" className="h-7 px-2 border-gold/50 hover:bg-gold/10 gap-1"
            title={quizAnswerMode === "instant" ? "מצב מיידי — לחץ לעבור לבדוק תשובה" : "מצב בדוק תשובה — לחץ לעבור למיידי"}
            onClick={() => setQuizAnswerMode(quizAnswerMode === "instant" ? "button" : "instant")}
          >
            {quizAnswerMode === "instant"
              ? <><Zap className="h-3.5 w-3.5 text-gold" /><span className="text-xs">מיידי</span></>
              : <><Check className="h-3.5 w-3.5 text-gold" /><span className="text-xs">בדוק</span></>
            }
          </Button>
          {/* Live timer */}
          {timeLimitSec ? (() => {
            const remain = Math.max(0, timeLimitSec - elapsed);
            const danger = remain <= 30;
            return (
              <span className={cn(
                "flex items-center gap-1 text-xs font-bold border rounded-lg px-2 py-1",
                danger ? "border-destructive/60 bg-destructive/10 text-destructive animate-pulse" : "border-gold/50 bg-gold/10 text-gold"
              )}>
                <Timer className="h-3.5 w-3.5" />
                ⏱ {Math.floor(remain / 60)}:{String(remain % 60).padStart(2, "0")}
              </span>
            );
          })() : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground border border-gold/30 rounded-lg px-2 py-1 bg-secondary/40">
              <Timer className="h-3.5 w-3.5 text-gold" />
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </span>
          )}
          <span className="text-sm text-muted-foreground">
            {idx + 1} / {queue.length} · {mode === "srs" ? "חזרה ממוקדת" : "תרגול חופשי"}
          </span>
        </div>
      </div>
      <Progress value={progress} className="h-2" />

      <div className={cn("relative min-h-[200px] flex items-center justify-center p-6 pt-10 rounded-2xl border-2", questionAreaCls)} style={questionAreaStyle}>
        {/* Top-right corner: card type badge */}
        <Badge variant="outline" className="absolute top-3 right-3 border-gold text-navy text-xs">
          {card.type === "flashcard" ? "כרטיסיה" : card.type === "multiple" ? "אמריקאית" : card.type === "boolean" ? "נכון/לא נכון" : "משולבת"}
        </Badge>
        {/* Top-left corner: category breadcrumb */}
        {categoryBreadcrumb && (
          <span className="absolute top-3 left-3 text-xs text-muted-foreground max-w-[55%] truncate" dir="rtl">
            {categoryBreadcrumb}
          </span>
        )}
        {/* Source badge: Y (navy) for yeshiva, S (gold) for shemesh */}
        {card.tags?.includes("source:yeshiva") && (
          <span
            title="yeshiva.org.il"
            className="absolute bottom-3 left-3 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold text-white"
            style={{ backgroundColor: "hsl(220 70% 25%)" }}
          >
            Y
          </span>
        )}
        {card.tags?.includes("source:shemesh") && (
          <span
            title="שמש בגבעון"
            className="absolute bottom-3 left-3 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold text-black"
            style={{ backgroundColor: "hsl(45 85% 55%)" }}
          >
            S
          </span>
        )}
        <div className="space-y-3 w-full" dir="rtl">
          <h3 className={cn("font-display text-2xl font-semibold leading-relaxed", questionAlign === "right" ? "text-right" : questionAlign === "center" ? "text-center" : "text-left", questionTextCls)} style={questionTextStyle}>
            {hasCloze(card.question) ? (
              <span dir="rtl">
                {(() => {
                  const parts = parseCloze(card.question);
                  const showAll = revealed || (card.type !== "flashcard" && !(card.type === "combo" && comboMode === "flash"));
                  return renderCloze(parts, 1, showAll);
                })()}
              </span>
            ) : card.question}
          </h3>
        </div>
      </div>

      {/* Flashcard */}
      {card.type === "flashcard" && (
        <div className="space-y-3" dir="rtl">
          {!revealed ? (
            <Button onClick={() => setRevealed(true)} className={cn("w-full bg-gradient-navy text-primary-foreground rounded-xl py-6", viewMode === "flip" && "transition-transform [transform:rotateY(0deg)] hover:[transform:rotateY(8deg)]") }>
              <Eye className="h-5 w-5" /> הצג תשובה
            </Button>
          ) : (
            <>
              <div className={cn("p-5 rounded-xl bg-card border-2 border-gold/40", viewMode === "flip" && "animate-fade-in")}> 
                <p className="text-lg text-foreground text-right font-medium" dir="rtl">{card.answer}</p>
              </div>
              <NextReviewTabs value={nextInterval} customDate={customDate} onChange={setNextInterval} onCustomDate={setCustomDate} />
              <div className="grid grid-cols-4 gap-2">
                <Button onClick={() => submit(false, 1)} variant="outline" className="border-2 border-destructive/50 text-destructive">שכחתי</Button>
                <Button onClick={() => submit(true, 3)} variant="outline" className="border-2 border-gold/50">קשה</Button>
                <Button onClick={() => submit(true, 4)} variant="outline" className="border-2 border-gold">טוב</Button>
                <Button onClick={() => submit(true, 5)} className="bg-gradient-navy text-primary-foreground">קל</Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Multiple choice */}
      {card.type === "multiple" && (
        <div className="space-y-3" dir="rtl">
          {/* Theme-aware options rendering */}
          {(() => {
            const isGrid = quizTheme === "millionaire" || quizTheme === "colorful" || (quizTheme === "custom" && customQuizTheme.optionsLayout === "grid");
            const wrapperCls =
              quizTheme === "millionaire" ? "grid grid-cols-2 gap-3 p-4 rounded-2xl bg-[#061022]" :
              quizTheme === "colorful"    ? "grid grid-cols-2 gap-3" :
              quizTheme === "dark"        ? "space-y-2 p-3 rounded-2xl bg-gray-900" :
              (quizTheme === "custom" && customQuizTheme.optionsLayout === "grid") ? cn("grid grid-cols-2 gap-3", customQuizTheme.optionWrapperBg && "p-3 rounded-2xl") :
              (quizTheme === "custom" && customQuizTheme.optionWrapperBg) ? "space-y-2 p-3 rounded-2xl" :
              "space-y-2";
            const wrapperStyle: React.CSSProperties = (quizTheme === "custom" && customQuizTheme.optionWrapperBg)
              ? { backgroundColor: customQuizTheme.optionWrapperBg } : {};
            return (
              <div className={wrapperCls} style={wrapperStyle}>
                {card.options.map((opt, i) => {
                  const isSelected = selected.includes(i);
                  const isCorrect = card.correctIndices.includes(i);
                  const showResult = revealed;
                  const handleClick = () => {
                    if (revealed) return;
                    if (quizAnswerMode === "instant") {
                      const correct = card.correctIndices.length === 1 && card.correctIndices.includes(i);
                      setSelected([i]);
                      setRevealed(true);
                      setInstantPendingSubmit({ correct, quality: correct ? 5 : 1 });
                    } else {
                      setSelected((arr) => isSelected ? arr.filter((x) => x !== i) : [...arr, i]);
                    }
                  };

                  // ── Compute per-theme button + letter classes ──
                  let btnCls = "";
                  let btnStyle: React.CSSProperties = {};
                  let optTextStyle: React.CSSProperties = {};
                  let letterEl: React.ReactNode = null;

                  if (quizTheme === "classic") {
                    btnCls = cn(
                      "w-full p-4 rounded-xl border-2 text-right transition-all flex items-center gap-3",
                      !showResult && isSelected  && "border-navy bg-secondary",
                      !showResult && !isSelected && "border-gold/40 bg-card hover:bg-secondary/50",
                      showResult && isCorrect                  && "border-green-500 bg-green-50 dark:bg-green-950/30",
                      showResult && !isCorrect && isSelected   && "border-destructive bg-destructive/10",
                      showResult && !isCorrect && !isSelected  && "border-gold/20 opacity-60",
                    );
                    letterEl = (
                      <span className={cn(
                        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold",
                        !showResult && isSelected  ? "bg-navy text-primary-foreground" : "bg-gold/20 text-navy",
                        showResult && isCorrect                 ? "bg-green-500 text-white" : "",
                        showResult && !isCorrect && isSelected  ? "bg-destructive text-white" : "",
                        showResult && !isCorrect && !isSelected ? "bg-gold/20 text-navy opacity-60" : "",
                      )}>{HEB_LETTERS[i]}</span>
                    );
                  } else if (quizTheme === "millionaire") {
                    btnCls = cn(
                      "relative p-4 rounded-[2rem] border-2 text-right transition-all min-h-[80px] flex flex-col items-end justify-center gap-2 overflow-hidden",
                      !showResult && !isSelected && "border-yellow-600/60 bg-gradient-to-b from-[#0d2040] to-[#0a1628] text-white hover:border-yellow-400 hover:shadow-[0_0_12px_rgba(234,179,8,0.3)]",
                      !showResult && isSelected  && "border-yellow-300 bg-gradient-to-b from-[#1a3a60] to-[#0d2040] text-yellow-200 shadow-[0_0_16px_rgba(234,179,8,0.4)]",
                      showResult && isCorrect                  && "border-green-400 bg-gradient-to-b from-green-800 to-green-900 text-white",
                      showResult && !isCorrect && isSelected   && "border-red-500 bg-gradient-to-b from-red-900 to-red-950 text-white",
                      showResult && !isCorrect && !isSelected  && "border-yellow-600/20 bg-gradient-to-b from-[#0d2040] to-[#0a1628] opacity-50 text-white",
                    );
                    letterEl = (
                      <span className={cn(
                        "flex-shrink-0 h-6 min-w-[1.5rem] px-1.5 rounded-full flex items-center justify-center text-xs font-bold border",
                        !showResult && !isSelected && "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
                        !showResult && isSelected  && "bg-yellow-400/30 text-yellow-200 border-yellow-300/60",
                        showResult && isCorrect                 && "bg-green-500/30 text-green-200 border-green-400",
                        showResult && !isCorrect && isSelected  && "bg-red-500/30 text-red-200 border-red-400",
                        showResult && !isCorrect && !isSelected && "bg-yellow-500/10 text-yellow-600/50 border-yellow-600/20",
                      )}>{HEB_LETTERS[i]}</span>
                    );
                  } else if (quizTheme === "navy") {
                    btnCls = cn(
                      "w-full py-4 px-5 rounded-xl border-2 text-right transition-all flex items-center gap-3 font-semibold",
                      !showResult && !isSelected && "border-navy/30 bg-white dark:bg-card text-navy dark:text-foreground hover:border-navy hover:bg-navy/5",
                      !showResult && isSelected  && "border-navy bg-navy text-white",
                      showResult && isCorrect                  && "border-green-600 bg-green-600 text-white",
                      showResult && !isCorrect && isSelected   && "border-red-500 bg-red-500 text-white",
                      showResult && !isCorrect && !isSelected  && "border-gray-200 bg-gray-50 dark:bg-card opacity-60",
                    );
                    letterEl = (
                      <span className={cn(
                        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border",
                        !showResult && !isSelected && "bg-navy/10 text-navy border-navy/30",
                        !showResult && isSelected  && "bg-white text-navy border-white/60",
                        showResult && isCorrect                 && "bg-white text-green-700 border-white",
                        showResult && !isCorrect && isSelected  && "bg-white text-red-600 border-white",
                        showResult && !isCorrect && !isSelected && "bg-gray-200/50 text-muted-foreground border-gray-200",
                      )}>{HEB_LETTERS[i]}</span>
                    );
                  } else if (quizTheme === "dark") {
                    btnCls = cn(
                      "w-full p-4 rounded-xl border-2 text-right transition-all flex items-center gap-3",
                      !showResult && !isSelected && "border-yellow-600/40 bg-gray-800 text-white hover:border-yellow-400 hover:bg-gray-700",
                      !showResult && isSelected  && "border-yellow-400 bg-gray-700 text-yellow-200 shadow-[0_0_10px_rgba(234,179,8,0.2)]",
                      showResult && isCorrect                  && "border-green-400 bg-green-900/70 text-green-100",
                      showResult && !isCorrect && isSelected   && "border-red-500 bg-red-900/70 text-red-100",
                      showResult && !isCorrect && !isSelected  && "border-gray-700 bg-gray-800/50 text-gray-500",
                    );
                    letterEl = (
                      <span className={cn(
                        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border",
                        !showResult && !isSelected && "bg-yellow-900/40 text-yellow-400 border-yellow-700/50",
                        !showResult && isSelected  && "bg-yellow-500/30 text-yellow-200 border-yellow-400/50",
                        showResult && isCorrect                 && "bg-green-500/30 text-green-200 border-green-400/50",
                        showResult && !isCorrect && isSelected  && "bg-red-500/30 text-red-200 border-red-400/50",
                        showResult && !isCorrect && !isSelected && "bg-gray-700 text-gray-500 border-gray-600/50",
                      )}>{HEB_LETTERS[i]}</span>
                    );
                  } else if (quizTheme === "custom") {
                    const oc = customQuizTheme.optionColors[i % customQuizTheme.optionColors.length];
                    const rad = BORDER_RADIUS_MAP[customQuizTheme.optionsBorderRadius];
                    btnCls = cn(
                      "p-4 border-2 text-right transition-all flex items-center gap-3 font-medium",
                      !isGrid && "w-full",
                      isGrid && "min-h-[80px] flex-col items-end justify-center",
                      !showResult && "hover:opacity-90",
                      showResult && isCorrect                  && "ring-4 ring-green-300 ring-offset-1",
                      showResult && !isCorrect && isSelected   && "opacity-80 ring-4 ring-red-500 ring-offset-1",
                      showResult && !isCorrect && !isSelected  && "opacity-40",
                    );
                    btnStyle = { backgroundColor: oc.bg, color: oc.text, borderColor: oc.border, borderRadius: rad };
                    optTextStyle = { fontFamily: FONT_FAMILY_MAP[customQuizTheme.answerFontFamily], fontSize: FONT_SIZE_MAP[customQuizTheme.answerFontSize], fontWeight: FONT_WEIGHT_MAP[customQuizTheme.answerFontWeight] };
                    letterEl = (
                      <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border"
                        style={{ backgroundColor: oc.text + "22", color: oc.text, borderColor: oc.text + "55" }}>
                        {HEB_LETTERS[i]}
                      </span>
                    );
                  } else {
                    // colorful — per-option color, no letter
                    const c = COLORFUL_OPTS[i % COLORFUL_OPTS.length];
                    btnCls = cn(
                      "relative p-4 rounded-2xl border-2 text-right transition-all min-h-[80px] flex flex-col items-end justify-center gap-2 font-semibold text-white",
                      !showResult && !isSelected && `${c.base} hover:opacity-90`,
                      !showResult && isSelected  && c.sel,
                      showResult && isCorrect                  && `${c.base} ring-4 ring-green-300 ring-offset-1`,
                      showResult && !isCorrect && isSelected   && `${c.base} opacity-80 ring-4 ring-red-500 ring-offset-1`,
                      showResult && !isCorrect && !isSelected  && `${c.base} opacity-40`,
                    );
                    letterEl = null;
                  }

                  // Apply answer typography overlay on top of any theme
                  optTextStyle = {
                    ...optTextStyle,
                    ...typographyToStyle(answerTypography),
                    textAlign: answerTypography.align,
                  };
                  btnStyle = { ...btnStyle, ...typographyToBgStyle(answerTypography) };

                  return (
                    <button key={i} dir="rtl" disabled={revealed} onClick={handleClick} className={btnCls} style={btnStyle}>
                      {isGrid ? (
                        // Grid layout: text stacked, letter+icon at bottom
                        <>
                          <span className="font-medium text-right leading-snug w-full" style={optTextStyle}>{opt}</span>
                          <div className="w-full flex justify-between items-center mt-1">
                            {letterEl ?? <span />}
                            <span>
                              {showResult && isCorrect                && <Check className="h-5 w-5 text-green-300" />}
                              {showResult && !isCorrect && isSelected && <X className="h-5 w-5 text-red-300" />}
                            </span>
                          </div>
                        </>
                      ) : (
                        // List layout: letter | text | icon inline
                        <>
                          {letterEl}
                          <span className="font-medium flex-1 text-right" style={optTextStyle}>{opt}</span>
                          <span className="flex-shrink-0 w-5">
                            {showResult && isCorrect                && <Check className="h-5 w-5 text-green-600" />}
                            {showResult && !isCorrect && isSelected && <X className="h-5 w-5 text-destructive" />}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {!revealed ? (
            quizAnswerMode === "button" ? (
              <Button
                disabled={selected.length === 0}
                onClick={() => setRevealed(true)}
                className="w-full bg-gradient-navy text-primary-foreground rounded-xl py-6"
              >
                בדוק תשובה
              </Button>
            ) : null
          ) : (
            (() => {
              const correct = selected.length === card.correctIndices.length &&
                selected.every((s) => card.correctIndices.includes(s));
              return (
                <>
                  {quizAnswerMode === "button" && (
                    <NextReviewTabs value={nextInterval} customDate={customDate} onChange={setNextInterval} onCustomDate={setCustomDate} />
                  )}
                  <Button
                    onClick={() => { setInstantPendingSubmit(null); submit(correct, correct ? 5 : 1); }}
                    className={cn("w-full rounded-xl py-6 text-primary-foreground",
                      correct ? "bg-green-600 hover:bg-green-700" : "bg-destructive hover:bg-destructive/90")}
                  >
                    {correct ? "נכון! המשך" : "לא נכון - המשך"}
                  </Button>
                </>
              );
            })()
          )}
        </div>
      )}

      {/* Boolean */}
      {card.type === "boolean" && (
        <div className="space-y-3" dir="rtl">
          {!revealed ? (
            <div className="grid grid-cols-2 gap-3">
              <Button onClick={() => { setBoolPick(true); setRevealed(true); }}
                variant="outline" className="border-2 border-gold/50 rounded-xl py-8 text-lg">
                <Check className="h-5 w-5" /> נכון
              </Button>
              <Button onClick={() => { setBoolPick(false); setRevealed(true); }}
                variant="outline" className="border-2 border-gold/50 rounded-xl py-8 text-lg">
                <X className="h-5 w-5" /> לא נכון
              </Button>
            </div>
          ) : (
            (() => {
              const correct = boolPick === card.correct;
              return (
                <>
                  <div className={cn("p-4 rounded-xl border-2 text-center space-y-2",
                    correct ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                            : "border-destructive bg-destructive/10")}>
                    <div className="font-display text-xl font-bold">
                      {correct ? "✓ נכון!" : "✗ לא נכון"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      התשובה: <span className="font-semibold text-foreground">{card.correct ? "נכון" : "לא נכון"}</span>
                    </div>
                    {card.explanation && <p className="text-sm text-foreground mt-2">{card.explanation}</p>}
                  </div>
                  <NextReviewTabs value={nextInterval} customDate={customDate} onChange={setNextInterval} onCustomDate={setCustomDate} />
                  <Button onClick={() => submit(correct, correct ? 5 : 1)}
                    className="w-full bg-gradient-navy text-primary-foreground rounded-xl py-6">
                    הבא <ChevronLeft className="h-4 w-4" />
                  </Button>
                </>
              );
            })()
          )}
        </div>
      )}

      {/* Combo card */}
      {card.type === "combo" && (() => {
        const hasFlash = !!card.answer;
        const hasMulti = !!(card.options && card.options.length > 0);
        // Determine active mode: prefer comboPref unless not available, otherwise auto
        let prefMode: "flash" | "multi" | null;
        if (comboPref === "flash" && hasFlash) prefMode = "flash";
        else if (comboPref === "multi" && hasMulti) prefMode = "multi";
        else if (comboPref === "both") prefMode = null; // show selector
        else prefMode = hasFlash ? "flash" : hasMulti ? "multi" : null;
        const onlyMode = hasFlash && !hasMulti ? "flash" : !hasFlash && hasMulti ? "multi" : null;
        const activeMode = comboMode ?? prefMode ?? onlyMode;

        if (!activeMode) {
          return (
            <div className="space-y-3">
              <p className="text-center text-sm text-muted-foreground">בחר מצב תרגול:</p>
              <div className="grid grid-cols-2 gap-3">
                <Button onClick={() => { setComboMode("flash"); }} variant="outline"
                  className="border-2 border-gold rounded-xl py-6 text-navy">
                  <Eye className="h-4 w-4" /> תשובה פתוחה
                </Button>
                <Button onClick={() => { setComboMode("multi"); }} variant="outline"
                  className="border-2 border-gold rounded-xl py-6 text-navy">
                  <Check className="h-4 w-4" /> בחירה מרובה
                </Button>
              </div>
            </div>
          );
        }

        if (activeMode === "flash") {
          return (
            <div className="space-y-3" dir="rtl">
              {!revealed ? (
                <Button onClick={() => setRevealed(true)} className="w-full bg-gradient-navy text-primary-foreground rounded-xl py-6">
                  <Eye className="h-5 w-5" /> הצג תשובה
                </Button>
              ) : (
                <>
                  <div className="p-5 rounded-xl bg-card border-2 border-gold/40">
                    <p className="text-lg text-foreground text-right font-medium" dir="rtl">{card.answer}</p>
                    {card.explanation && (
                      <p className="text-sm text-muted-foreground text-center mt-2">{card.explanation}</p>
                    )}
                  </div>
                  <NextReviewTabs value={nextInterval} customDate={customDate} onChange={setNextInterval} onCustomDate={setCustomDate} />
                  <div className="grid grid-cols-4 gap-2">
                    <Button onClick={() => submit(false, 1)} variant="outline" className="border-2 border-destructive/50 text-destructive">שכחתי</Button>
                    <Button onClick={() => submit(true, 3)} variant="outline" className="border-2 border-gold/50">קשה</Button>
                    <Button onClick={() => submit(true, 4)} variant="outline" className="border-2 border-gold">טוב</Button>
                    <Button onClick={() => submit(true, 5)} className="bg-gradient-navy text-primary-foreground">קל</Button>
                  </div>
                  {hasMulti && (
                    <Button variant="ghost" size="sm" onClick={() => { setRevealed(false); setComboMode("multi"); }} className="w-full text-xs">
                      נסה גם את הבחירה המרובה ↩
                    </Button>
                  )}
                </>
              )}
            </div>
          );
        }

        // multi mode
        return (
          <div className="space-y-3" dir="rtl">
            {/* Reuse the same theme-aware rendering as normal mode */}
            {(() => {
              const isGrid = quizTheme === "millionaire" || quizTheme === "colorful" || (quizTheme === "custom" && customQuizTheme.optionsLayout === "grid");
              const wrapperCls =
                quizTheme === "millionaire" ? "grid grid-cols-2 gap-3 p-4 rounded-2xl bg-[#061022]" :
                quizTheme === "colorful"    ? "grid grid-cols-2 gap-3" :
                quizTheme === "dark"        ? "space-y-2 p-3 rounded-2xl bg-gray-900" :
                (quizTheme === "custom" && customQuizTheme.optionsLayout === "grid") ? cn("grid grid-cols-2 gap-3", customQuizTheme.optionWrapperBg && "p-3 rounded-2xl") :
                (quizTheme === "custom" && customQuizTheme.optionWrapperBg) ? "space-y-2 p-3 rounded-2xl" :
                "space-y-2";
              const wrapperStyle: React.CSSProperties = (quizTheme === "custom" && customQuizTheme.optionWrapperBg)
                ? { backgroundColor: customQuizTheme.optionWrapperBg } : {};
              return (
                <div className={wrapperCls} style={wrapperStyle}>
                  {card.options!.map((opt, i) => {
                    const isSelected = selected.includes(i);
                    const isCorrect = card.correctIndices!.includes(i);
                    const showResult = revealed;
                    let btnCls = "";
                    let btnStyle: React.CSSProperties = {};
                    let optTextStyle: React.CSSProperties = {};
                    let letterEl: React.ReactNode = null;
                    if (quizTheme === "classic") {
                      btnCls = cn(
                        "w-full p-4 rounded-xl border-2 text-right transition-all flex items-center gap-3",
                        !showResult && isSelected  && "border-navy bg-secondary",
                        !showResult && !isSelected && "border-gold/40 bg-card hover:bg-secondary/50",
                        showResult && isCorrect                 && "border-green-500 bg-green-50 dark:bg-green-950/30",
                        showResult && !isCorrect && isSelected  && "border-destructive bg-destructive/10",
                        showResult && !isCorrect && !isSelected && "border-gold/20 opacity-60",
                      );
                      letterEl = (
                        <span className={cn(
                          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold",
                          !showResult && isSelected ? "bg-navy text-primary-foreground" : "bg-gold/20 text-navy",
                          showResult && isCorrect                 ? "bg-green-500 text-white" : "",
                          showResult && !isCorrect && isSelected  ? "bg-destructive text-white" : "",
                          showResult && !isCorrect && !isSelected ? "bg-gold/20 text-navy opacity-60" : "",
                        )}>{HEB_LETTERS[i]}</span>
                      );
                    } else if (quizTheme === "millionaire") {
                      btnCls = cn(
                        "relative p-4 rounded-[2rem] border-2 text-right transition-all min-h-[80px] flex flex-col items-end justify-center gap-2 overflow-hidden",
                        !showResult && !isSelected && "border-yellow-600/60 bg-gradient-to-b from-[#0d2040] to-[#0a1628] text-white hover:border-yellow-400 hover:shadow-[0_0_12px_rgba(234,179,8,0.3)]",
                        !showResult && isSelected  && "border-yellow-300 bg-gradient-to-b from-[#1a3a60] to-[#0d2040] text-yellow-200 shadow-[0_0_16px_rgba(234,179,8,0.4)]",
                        showResult && isCorrect                 && "border-green-400 bg-gradient-to-b from-green-800 to-green-900 text-white",
                        showResult && !isCorrect && isSelected  && "border-red-500 bg-gradient-to-b from-red-900 to-red-950 text-white",
                        showResult && !isCorrect && !isSelected && "border-yellow-600/20 bg-gradient-to-b from-[#0d2040] to-[#0a1628] opacity-50 text-white",
                      );
                      letterEl = (
                        <span className={cn(
                          "flex-shrink-0 h-6 min-w-[1.5rem] px-1.5 rounded-full flex items-center justify-center text-xs font-bold border",
                          !showResult && !isSelected && "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
                          !showResult && isSelected  && "bg-yellow-400/30 text-yellow-200 border-yellow-300/60",
                          showResult && isCorrect                 && "bg-green-500/30 text-green-200 border-green-400",
                          showResult && !isCorrect && isSelected  && "bg-red-500/30 text-red-200 border-red-400",
                          showResult && !isCorrect && !isSelected && "bg-yellow-500/10 text-yellow-600/50 border-yellow-600/20",
                        )}>{HEB_LETTERS[i]}</span>
                      );
                    } else if (quizTheme === "navy") {
                      btnCls = cn(
                        "w-full py-4 px-5 rounded-xl border-2 text-right transition-all flex items-center gap-3 font-semibold",
                        !showResult && !isSelected && "border-navy/30 bg-white dark:bg-card text-navy dark:text-foreground hover:border-navy hover:bg-navy/5",
                        !showResult && isSelected  && "border-navy bg-navy text-white",
                        showResult && isCorrect                 && "border-green-600 bg-green-600 text-white",
                        showResult && !isCorrect && isSelected  && "border-red-500 bg-red-500 text-white",
                        showResult && !isCorrect && !isSelected && "border-gray-200 bg-gray-50 dark:bg-card opacity-60",
                      );
                      letterEl = (
                        <span className={cn(
                          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border",
                          !showResult && !isSelected && "bg-navy/10 text-navy border-navy/30",
                          !showResult && isSelected  && "bg-white text-navy border-white/60",
                          showResult && isCorrect                 && "bg-white text-green-700 border-white",
                          showResult && !isCorrect && isSelected  && "bg-white text-red-600 border-white",
                          showResult && !isCorrect && !isSelected && "bg-gray-200/50 text-muted-foreground border-gray-200",
                        )}>{HEB_LETTERS[i]}</span>
                      );
                    } else if (quizTheme === "dark") {
                      btnCls = cn(
                        "w-full p-4 rounded-xl border-2 text-right transition-all flex items-center gap-3",
                        !showResult && !isSelected && "border-yellow-600/40 bg-gray-800 text-white hover:border-yellow-400 hover:bg-gray-700",
                        !showResult && isSelected  && "border-yellow-400 bg-gray-700 text-yellow-200 shadow-[0_0_10px_rgba(234,179,8,0.2)]",
                        showResult && isCorrect                 && "border-green-400 bg-green-900/70 text-green-100",
                        showResult && !isCorrect && isSelected  && "border-red-500 bg-red-900/70 text-red-100",
                        showResult && !isCorrect && !isSelected && "border-gray-700 bg-gray-800/50 text-gray-500",
                      );
                      letterEl = (
                        <span className={cn(
                          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border",
                          !showResult && !isSelected && "bg-yellow-900/40 text-yellow-400 border-yellow-700/50",
                          !showResult && isSelected  && "bg-yellow-500/30 text-yellow-200 border-yellow-400/50",
                          showResult && isCorrect                 && "bg-green-500/30 text-green-200 border-green-400/50",
                          showResult && !isCorrect && isSelected  && "bg-red-500/30 text-red-200 border-red-400/50",
                          showResult && !isCorrect && !isSelected && "bg-gray-700 text-gray-500 border-gray-600/50",
                        )}>{HEB_LETTERS[i]}</span>
                      );
                    } else if (quizTheme === "colorful") {
                      const c = COLORFUL_OPTS[i % COLORFUL_OPTS.length];
                      btnCls = cn(
                        "relative p-4 rounded-2xl border-2 text-right transition-all min-h-[80px] flex flex-col items-end justify-center gap-2 font-semibold text-white",
                        !showResult && !isSelected && `${c.base} hover:opacity-90`,
                        !showResult && isSelected  && c.sel,
                        showResult && isCorrect                 && `${c.base} ring-4 ring-green-300 ring-offset-1`,
                        showResult && !isCorrect && isSelected  && `${c.base} opacity-80 ring-4 ring-red-500 ring-offset-1`,
                        showResult && !isCorrect && !isSelected && `${c.base} opacity-40`,
                      );
                      letterEl = null;
                    } else if (quizTheme === "custom") {
                      const oc = customQuizTheme.optionColors[i % customQuizTheme.optionColors.length];
                      const rad = BORDER_RADIUS_MAP[customQuizTheme.optionsBorderRadius];
                      btnCls = cn(
                        "p-4 border-2 text-right transition-all flex items-center gap-3 font-medium",
                        !isGrid && "w-full",
                        isGrid && "min-h-[80px] flex-col items-end justify-center",
                        !showResult && "hover:opacity-90",
                        showResult && isCorrect                  && "ring-4 ring-green-300 ring-offset-1",
                        showResult && !isCorrect && isSelected   && "opacity-80 ring-4 ring-red-500 ring-offset-1",
                        showResult && !isCorrect && !isSelected  && "opacity-40",
                      );
                      btnStyle = { backgroundColor: oc.bg, color: oc.text, borderColor: oc.border, borderRadius: rad };
                      optTextStyle = { fontFamily: FONT_FAMILY_MAP[customQuizTheme.answerFontFamily], fontSize: FONT_SIZE_MAP[customQuizTheme.answerFontSize], fontWeight: FONT_WEIGHT_MAP[customQuizTheme.answerFontWeight] };
                      letterEl = (
                        <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border"
                          style={{ backgroundColor: oc.text + "22", color: oc.text, borderColor: oc.text + "55" }}>
                          {HEB_LETTERS[i]}
                        </span>
                      );
                    }
                    // Apply answer typography overlay on top of any theme
                    optTextStyle = {
                      ...optTextStyle,
                      ...typographyToStyle(answerTypography),
                      textAlign: answerTypography.align,
                    };
                    btnStyle = { ...btnStyle, ...typographyToBgStyle(answerTypography) };
                    return (
                      <button key={i} dir="rtl" disabled={revealed}
                        onClick={() => setSelected((arr) => isSelected ? arr.filter((x) => x !== i) : [...arr, i])}
                        className={btnCls}
                        style={btnStyle}
                      >
                        {isGrid ? (
                          <>
                            <span className="font-medium text-right leading-snug w-full" style={optTextStyle}>{opt}</span>
                            <div className="w-full flex justify-between items-center mt-1">
                              {letterEl ?? <span />}
                              <span>
                                {showResult && isCorrect                && <Check className="h-5 w-5 text-green-300" />}
                                {showResult && !isCorrect && isSelected && <X className="h-5 w-5 text-red-300" />}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            {letterEl}
                            <span className="font-medium flex-1 text-right" style={optTextStyle}>{opt}</span>
                            <span className="flex-shrink-0 w-5">
                              {showResult && isCorrect                && <Check className="h-5 w-5 text-green-600" />}
                              {showResult && !isCorrect && isSelected && <X className="h-5 w-5 text-destructive" />}
                            </span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            {!revealed ? (
              <Button disabled={selected.length === 0} onClick={() => setRevealed(true)}
                className="w-full bg-gradient-navy text-primary-foreground rounded-xl py-6">
                בדוק תשובה
              </Button>
            ) : (
              (() => {
                const correct = selected.length === card.correctIndices!.length &&
                  selected.every((s) => card.correctIndices!.includes(s));
                return (
                  <>
                    <NextReviewTabs value={nextInterval} customDate={customDate} onChange={setNextInterval} onCustomDate={setCustomDate} />
                    <Button onClick={() => submit(correct, correct ? 5 : 1)}
                      className={cn("w-full rounded-xl py-6 text-primary-foreground",
                        correct ? "bg-green-600 hover:bg-green-700" : "bg-destructive hover:bg-destructive/90")}>
                      {correct ? "נכון! המשך" : "לא נכון - המשך"}
                    </Button>
                    {hasFlash && (
                      <Button variant="ghost" size="sm" onClick={() => { setRevealed(false); setSelected([]); setComboMode("flash"); }} className="w-full text-xs">
                        ראה גם את התשובה המלאה ↩
                      </Button>
                    )}
                  </>
                );
              })()
            )}
          </div>
        );
      })()}

      <QuizThemeEditorDialog
        open={themeEditorOpen}
        value={customQuizTheme}
        onSave={saveCustomTheme}
        onPreview={(t) => setCustomQuizTheme(t)}
        onClose={() => setThemeEditorOpen(false)}
      />
    </Card>
  );
}
