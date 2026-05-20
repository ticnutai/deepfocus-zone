import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Play, Trash2, TrendingDown, TrendingUp, Minus, Info, Download,
  RefreshCw, Star, StarOff, ChevronDown, ChevronRight, AlertTriangle,
  Zap, Eye,
} from "lucide-react";
import { useStudy } from "@/lib/study/store";
import type { Card as FlashCard, Category } from "@/lib/study/types";
import { uiTimings } from "@/lib/debug/uiTimings";
import { cn } from "@/lib/utils";
import { NavFlowBench } from "./NavFlowBench";

// ─── Types ──────────────────────────────────────────────────────────────────────────────────

type TestGroup = "algo" | "profile" | "dom";

type TestResult = {
  name: string;
  label: string;
  ms: number;
  group: TestGroup;
  phases?: { label: string; ms: number }[];
  /** number of samples averaged (DOM group only) */
  samples?: number;
};

type PerfRun = {
  id: string;
  timestamp: number;
  runLabel: string;
  results: TestResult[];
};

type Thresholds = Record<TestGroup, number>;

// ─── Storage ──────────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "perf-history-v2";
const BASELINE_KEY = "perf-baseline-id";
const THRESHOLD_KEY = "perf-thresholds";
const MAX_HISTORY = 30;

const DEFAULT_THRESHOLDS: Thresholds = { algo: 50, profile: 15, dom: 300 };

function loadHistory(): PerfRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PerfRun[]) : [];
  } catch {
    return [];
  }
}
function saveHistory(runs: PerfRun[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(-MAX_HISTORY)));
}
function loadBaselineId(): string | null {
  return localStorage.getItem(BASELINE_KEY);
}
function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(THRESHOLD_KEY);
    return raw ? { ...DEFAULT_THRESHOLDS, ...(JSON.parse(raw) as Thresholds) } : DEFAULT_THRESHOLDS;
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

// ─── Benchmark implementations ─────────────────────────────────────────────────────────────

function benchCountsAlgo(cards: FlashCard[], categories: Category[]): number {
  const t0 = performance.now();
  const childrenByParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }
  const directCards = new Map<string, number[]>();
  cards.forEach((c, i) => {
    for (const t of c.tags) {
      if (!t.startsWith("cat:")) continue;
      const name = t.slice(4);
      const arr = directCards.get(name) ?? [];
      arr.push(i);
      directCards.set(name, arr);
    }
  });
  const memo = new Map<string, Set<number>>();
  function subtreeCardSet(cat: Category): Set<number> {
    const cached = memo.get(cat.id);
    if (cached) return cached;
    const set = new Set<number>(directCards.get(cat.name));
    for (const child of childrenByParent.get(cat.id) ?? []) {
      for (const i of subtreeCardSet(child)) set.add(i);
    }
    memo.set(cat.id, set);
    return set;
  }
  const result = new Map<string, number>();
  for (const cat of categories) result.set(cat.name, subtreeCardSet(cat).size);
  void result.size;
  return Math.round(performance.now() - t0);
}

function benchCountsSteps(
  cards: FlashCard[],
  categories: Category[],
): { label: string; ms: number }[] {
  // Phase 1: children map
  const t1 = performance.now();
  const childrenByParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }
  const t1e = performance.now();

  // Phase 2: directCards index
  const t2 = performance.now();
  const directCards = new Map<string, number[]>();
  cards.forEach((c, i) => {
    for (const t of c.tags) {
      if (!t.startsWith("cat:")) continue;
      const name = t.slice(4);
      const arr = directCards.get(name) ?? [];
      arr.push(i);
      directCards.set(name, arr);
    }
  });
  const t2e = performance.now();

  // Phase 3: subtree accumulation
  const t3 = performance.now();
  const memo = new Map<string, Set<number>>();
  function subtreeCardSet(cat: Category): Set<number> {
    const cached = memo.get(cat.id);
    if (cached) return cached;
    const set = new Set<number>(directCards.get(cat.name));
    for (const child of childrenByParent.get(cat.id) ?? []) {
      for (const i of subtreeCardSet(child)) set.add(i);
    }
    memo.set(cat.id, set);
    return set;
  }
  for (const cat of categories) subtreeCardSet(cat);
  const t3e = performance.now();

  // Phase 4: final result map
  const t4 = performance.now();
  const result = new Map<string, number>();
  for (const cat of categories) result.set(cat.name, subtreeCardSet(cat).size);
  void result.size;
  const t4e = performance.now();

  return [
    { label: "בניית מפת ילדים", ms: Math.round(t1e - t1) },
    { label: "אינדקס קלפים ישירים", ms: Math.round(t2e - t2) },
    { label: "צבירת עצי קטגוריות", ms: Math.round(t3e - t3) },
    { label: "מפת תוצאות סופית", ms: Math.round(t4e - t4) },
  ];
}

function benchAggregates(cards: FlashCard[]): number {
  const t0 = performance.now();
  const m = new Map<string, { count: number; correct: number; total: number }>();
  for (const c of cards) {
    for (const t of c.tags) {
      if (!t.startsWith("cat:")) continue;
      const name = t.slice(4);
      const cur = m.get(name) ?? { count: 0, correct: 0, total: 0 };
      cur.count += 1;
      cur.correct += c.stats.correct;
      cur.total += c.stats.totalReviews;
      m.set(name, cur);
    }
  }
  void m.size;
  return Math.round(performance.now() - t0);
}

function benchCardsFilter(cards: FlashCard[], catName: string): number {
  const t0 = performance.now();
  const tag = `cat:${catName}`;
  const result = cards.filter((c) => c.tags.includes(tag));
  void result.length;
  return Math.round(performance.now() - t0);
}

function benchFolderFilter(categories: Category[]): number {
  const t0 = performance.now();
  const result = categories
    .filter((c) => !!c.name)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  void result.length;
  return Math.round(performance.now() - t0);
}

function benchSearchFilter(categories: Category[]): number {
  const queries = ["ב", "ברכ", "ברכות", "א", "ש", "גמ", "מש", "תל", "הל", "עב"];
  const t0 = performance.now();
  for (const q of queries) {
    const q_ = q.toLowerCase();
    const result = categories.filter((c) => c.name.toLowerCase().includes(q_));
    void result.length;
  }
  return Math.round(performance.now() - t0);
}

// ─── Small UI helpers ────────────────────────────────────────────────────────────────────────────

function getStatus(ms: number, threshold: number): "fast" | "ok" | "slow" {
  if (ms <= threshold * 0.4) return "fast";
  if (ms <= threshold) return "ok";
  return "slow";
}

function StatusBadge({ ms, threshold }: { ms: number; threshold: number }) {
  const s = getStatus(ms, threshold);
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-bold tabular-nums",
        s === "fast" &&
          "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300",
        s === "ok" &&
          "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300",
        s === "slow" &&
          "bg-red-50 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300",
      )}
    >
      {ms}ms
    </Badge>
  );
}

type DeltaProps = { current: number; baseline: number | undefined; threshold: number };
function DeltaBadge({ current, baseline, threshold }: DeltaProps) {
  if (baseline == null) return null;
  const diff = current - baseline;
  if (Math.abs(diff) < 2) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  const pct = Math.round((diff / baseline) * 100);
  const isRegression = diff > 0 && diff > threshold * 0.3;
  return (
    <span
      className={cn(
        "text-[11px] font-semibold tabular-nums flex items-center gap-0.5",
        isRegression ? "text-red-600" : "text-emerald-600",
      )}
      title={`${diff > 0 ? "+" : ""}${diff}ms (בסיס ${baseline}ms)`}
    >
      {isRegression ? (
        <AlertTriangle className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {diff > 0 ? "+" : ""}{diff}ms
      <span className="opacity-60">({pct > 0 ? "+" : ""}{pct}%)</span>
    </span>
  );
}

function PrevArrow({ current, previous }: { current: number; previous?: number }) {
  if (previous == null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 2) return <Minus className="h-3.5 w-3.5 text-muted-foreground/50" />;
  if (diff < 0) return <TrendingDown className="h-3.5 w-3.5 text-emerald-600" title={`${diff}ms מהסיבוב הקודם`} />;
  return <TrendingUp className="h-3.5 w-3.5 text-red-500" title={`+${diff}ms מהסיבוב הקודם`} />;
}

const GROUP_LABELS: Record<TestGroup, string> = {
  algo: "אלגוריתמי",
  profile: "פרופיל שלבים",
  dom: "DOM פאסיבי",
};

const DOM_SLOT_LABELS: Record<string, string> = {
  "cat:mount": "טעינת דף הקטגוריות",
  "cat:nav": "ניווט לקטגוריה",
  "cat:search": "סינון קטגוריות (זמן אמת)",
};

// ─── Main component ───────────────────────────────────────────────────────────────────────────────

export function PerformancePage() {
  const { state } = useStudy();
  const [history, setHistory] = useState<PerfRun[]>(loadHistory);
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState("");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState<string | null>(loadBaselineId);
  const [thresholds, setThresholds] = useState<Thresholds>(loadThresholds);
  const [enabledGroups, setEnabledGroups] = useState<Set<TestGroup>>(
    new Set<TestGroup>(["algo", "profile", "dom"]),
  );
  const [runOnlyFailing, setRunOnlyFailing] = useState(false);
  const [domSnapshot, setDomSnapshot] = useState<ReturnType<typeof uiTimings.snapshot>>({});
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);

  // refresh DOM snapshot on mount and on demand
  useEffect(() => {
    setDomSnapshot(uiTimings.snapshot());
  }, []);

  const refreshDom = useCallback(() => {
    setDomSnapshot(uiTimings.snapshot());
  }, []);

  const hasData = state.cards.length > 0;

  const prevRun =
    history.length >= 2 ? history[history.length - 2] : undefined;
  const currentRun = currentRunId
    ? history.find((r) => r.id === currentRunId)
    : history[history.length - 1];
  const baselineRun = baselineId
    ? history.find((r) => r.id === baselineId)
    : undefined;

  /** Returns the baseline ms for a test name, or undefined */
  const getBaseline = useCallback(
    (name: string) => baselineRun?.results.find((r) => r.name === name)?.ms,
    [baselineRun],
  );

  /** True if this run is failing (above threshold) */
  const isTestFailing = useCallback(
    (name: string, group: TestGroup): boolean => {
      const last = currentRun?.results.find((r) => r.name === name);
      if (!last) return false;
      return last.ms > thresholds[group];
    },
    [currentRun, thresholds],
  );

  const failingCount = currentRun
    ? currentRun.results.filter((r) => r.ms > thresholds[r.group]).length
    : 0;

  // ── Run tests ───────────────────────────────────────────────────────────────

  const runTests = useCallback(
    async (onlyFailing = false) => {
      setRunning(true);
      await new Promise<void>((r) => setTimeout(r, 10));

      const cards = state.cards;
      const categories = [...(state.categories ?? [])];
      const firstCat = categories[0]?.name ?? "ברכות";

      const results: TestResult[] = [];

      // ── algo group ──────────────────────────────────────────────
      if (enabledGroups.has("algo")) {
        const algoTests: [string, string, () => number][] = [
          [
            "counts_usememo",
            `counts useMemo · ${categories.length} קטגוריות × ${cards.length} קלפים`,
            () => benchCountsAlgo(cards, categories),
          ],
          [
            "aggregates_usememo",
            `aggregates useMemo · ${cards.length} קלפים`,
            () => benchAggregates(cards),
          ],
          [
            "cards_filter",
            `סינון קלפים לקטגוריה · "ראשונה" (${cards.length} קלפים)`,
            () => benchCardsFilter(cards, firstCat),
          ],
          [
            "folder_filter_sort",
            `סינון+מיון תיקיות · ${categories.length} קטגוריות`,
            () => benchFolderFilter(categories),
          ],
          [
            "search_filter",
            `סינון חיפוש בזמן אמת · 10 שאילתות × ${categories.length} קטגוריות`,
            () => benchSearchFilter(categories),
          ],
        ];

        for (const [name, lbl, fn] of algoTests) {
          if (onlyFailing && !isTestFailing(name, "algo")) continue;
          results.push({ name, label: lbl, ms: fn(), group: "algo" });
        }
      }

      // ── profile group ──────────────────────────────────────────
      if (
        enabledGroups.has("profile") &&
        (!onlyFailing || isTestFailing("counts_profile", "profile"))
      ) {
        const phases = benchCountsSteps(cards, categories);
        const total = phases.reduce((s, p) => s + p.ms, 0);
        results.push({
          name: "counts_profile",
          label: `פרופיל counts useMemo · סה"כ ${total}ms`,
          ms: total,
          group: "profile",
          phases,
        });
      }

      // ── dom group (passive snapshot) ──────────────────────────
      if (enabledGroups.has("dom")) {
        const snap = uiTimings.snapshot();
        setDomSnapshot(snap);
        for (const [slot, data] of Object.entries(snap)) {
          if (onlyFailing && data.avg <= thresholds.dom) continue;
          results.push({
            name: `dom:${slot}`,
            label: DOM_SLOT_LABELS[slot] ?? slot,
            ms: data.avg,
            group: "dom",
            samples: data.samples.length,
          });
        }
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const run: PerfRun = {
        id,
        timestamp: Date.now(),
        runLabel:
          label.trim() ||
          new Date().toLocaleString("he-IL", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        results,
      };

      const newHistory = [...history, run];
      setHistory(newHistory);
      saveHistory(newHistory);
      setCurrentRunId(id);
      setLabel("");
      setRunning(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.cards, state.categories, history, label, enabledGroups, thresholds, isTestFailing],
  );

  const clearHistory = () => {
    setHistory([]);
    setCurrentRunId(null);
    setBaselineId(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BASELINE_KEY);
  };

  const markBaseline = (runId: string) => {
    setBaselineId(runId);
    localStorage.setItem(BASELINE_KEY, runId);
  };
  const clearBaseline = () => {
    setBaselineId(null);
    localStorage.removeItem(BASELINE_KEY);
  };

  const exportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      thresholds,
      baselineRunId: baselineId,
      domSnapshot,
      history,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `perf-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateThreshold = (group: TestGroup, val: number) => {
    const next = { ...thresholds, [group]: val };
    setThresholds(next);
    localStorage.setItem(THRESHOLD_KEY, JSON.stringify(next));
  };

  const toggleGroup = (g: TestGroup) => {
    setEnabledGroups((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  };

  // ── Results rendering helpers ──────────────────────────────────────────

  function ResultCard({ r }: { r: TestResult }) {
    const baselineMs = getBaseline(r.name);
    const prevMs = prevRun?.results.find((x) => x.name === r.name)?.ms;
    const isRegression =
      baselineMs != null && r.ms - baselineMs > thresholds[r.group] * 0.3;

    return (
      <Card
        className={cn(
          "gold-frame p-4 hover:bg-secondary/20 transition-colors",
          isRegression && "border-red-400/60 bg-red-50/30 dark:bg-red-950/20",
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 text-right min-w-0">
            <p className="text-sm font-medium leading-snug">{r.label}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{r.name}</p>
            {r.samples != null && (
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">{r.samples} דגימות בממוצע</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="flex items-center gap-1.5">
              <PrevArrow current={r.ms} previous={prevMs} />
              <StatusBadge ms={r.ms} threshold={thresholds[r.group]} />
            </div>
            <DeltaBadge current={r.ms} baseline={baselineMs} threshold={thresholds[r.group]} />
          </div>
        </div>

        {/* Profile phases */}
        {r.phases && profileExpanded && (
          <div className="mt-3 pt-3 border-t border-gold/20 space-y-1.5">
            {r.phases.map((p) => (
              <div key={p.label} className="flex items-center justify-between text-xs">
                <StatusBadge ms={p.ms} threshold={thresholds.profile} />
                <span className="text-muted-foreground">{p.label}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  const groupOrder: TestGroup[] = ["algo", "profile", "dom"];
  const currentRunByGroup = groupOrder.reduce<Record<TestGroup, TestResult[]>>(
    (acc, g) => {
      acc[g] = currentRun?.results.filter((r) => r.group === g) ?? [];
      return acc;
    },
    { algo: [], profile: [], dom: [] },
  );

  // ── History columns (union of all test names across runs) ───────────────────
  const historyColumns: string[] = [];
  for (const run of history) {
    for (const r of run.results) {
      if (!historyColumns.includes(r.name)) historyColumns.push(r.name);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" className="space-y-5 animate-fade-in">

      {/* ── Header ── */}
      <div className="text-right space-y-1">
        <h1 className="font-display text-2xl font-bold text-gold">בדיקת מהירות</h1>
        <p className="text-muted-foreground text-sm">
          מדידת ביצועים · השוואה עם baseline · התראות רגרסיה אוטומטית
        </p>
      </div>

      {/* ── No data ── */}
      {!hasData && (
        <Card className="gold-frame p-4 flex items-start gap-3 text-sm text-amber-700 dark:text-amber-400">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>הנתונים טרם נטענו — פתח טאב קטגוריות וחזור לכאן.</span>
        </Card>
      )}

      {/* ── Config (collapsible) ── */}
      <Card className="gold-frame overflow-hidden">
        <button
          className="w-full flex items-center justify-between p-3 text-sm font-semibold hover:bg-secondary/30 transition-colors"
          onClick={() => setConfigExpanded((v) => !v)}
        >
          <span className="text-xs text-muted-foreground">
            ספים: אלגו={thresholds.algo}ms · פרופיל={thresholds.profile}ms · DOM={thresholds.dom}ms
          </span>
          <span className="flex items-center gap-1.5">
            הגדרות
            {configExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
        </button>

        {configExpanded && (
          <div className="p-4 border-t border-gold/20 space-y-4">
            {/* Group toggles */}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground text-right">קבוצות פעילות</p>
              <div className="flex flex-wrap gap-2 justify-end">
                {(Object.entries(GROUP_LABELS) as [TestGroup, string][]).map(([g, lbl]) => (
                  <button
                    key={g}
                    onClick={() => toggleGroup(g)}
                    className={cn(
                      "px-3 py-1 rounded-lg text-xs font-semibold border-2 transition-colors",
                      enabledGroups.has(g)
                        ? "bg-gradient-navy text-primary-foreground border-transparent"
                        : "bg-card text-muted-foreground border-gold/30",
                    )}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Thresholds */}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
              {([
                ["algo", "אלגוריתמי (מס):"],
                ["profile", "פרופיל שלב (מס):"],
                ["dom", "DOM (מס):"],
              ] as [TestGroup, string][]).map(([g, lbl]) => (
                <label key={g} className="flex flex-col gap-1 text-right">
                  <span className="text-xs text-muted-foreground">{lbl}</span>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={thresholds[g]}
                    onChange={(e) => updateThreshold(g, Number(e.target.value) || 1)}
                    className="h-8 rounded-md border border-gold/30 bg-background px-2 text-right text-sm tabular-nums w-full"
                  />
                </label>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ── Action row ── */}
      <Card className="gold-frame p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => runTests(false)}
            disabled={running || !hasData}
            className="bg-gradient-navy text-primary-foreground hover:opacity-90 rounded-xl gap-2 shrink-0"
          >
            <Play className="h-4 w-4" />
            {running ? "מריץ…" : "הרץ הכל"}
          </Button>

          {failingCount > 0 && (
            <Button
              variant="outline"
              onClick={() => runTests(true)}
              disabled={running || !hasData}
              className="border-red-400 text-red-700 hover:bg-red-50 dark:hover:bg-red-950 gap-2 rounded-xl shrink-0"
            >
              <AlertTriangle className="h-4 w-4" />
              הרץ רק בעייתיים ({failingCount})
            </Button>
          )}

          <Button
            variant="outline"
            onClick={exportJson}
            disabled={history.length === 0}
            className="gap-2 rounded-xl shrink-0"
          >
            <Download className="h-4 w-4" />
            ייצוא JSON
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={clearHistory}
            className="text-muted-foreground gap-1.5 rounded-xl shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            נקה היסטוריה
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="תווית לבדיקה זו (אופציונלי) — למשל: אחרי React.memo"
            className="flex-1 text-right"
            disabled={running}
            onKeyDown={(e) => e.key === "Enter" && !running && hasData && runTests(false)}
          />
        </div>

        {hasData && (
          <p className="text-[11px] text-muted-foreground text-right">
            {state.cards.length} קלפים · {(state.categories ?? []).length} קטגוריות
          </p>
        )}
      </Card>

      {/* ── Baseline info bar ── */}
      {baselineRun && (
        <div className="flex items-center justify-between rounded-xl border-2 border-gold/40 bg-gold/5 px-4 py-2 text-sm">
          <button
            onClick={clearBaseline}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <StarOff className="h-3.5 w-3.5" />
            בטל baseline
          </button>
          <span className="flex items-center gap-1.5 font-semibold text-gold">
            <Star className="h-4 w-4" />
            baseline: {baselineRun.runLabel}
          </span>
        </div>
      )}

      {/* ── Current run results grouped ── */}
      {currentRun && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            {currentRun.id !== baselineId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markBaseline(currentRun.id)}
                className="gap-1.5 h-7 text-xs border-gold/40 hover:bg-gold/10"
              >
                <Star className="h-3.5 w-3.5 text-gold" />
                סמן כ-baseline
              </Button>
            ) : (
              <Badge className="bg-gold/20 text-gold border-gold/40 text-xs">baseline נוכחי</Badge>
            )}
            <h2 className="font-semibold text-sm text-muted-foreground">
              ריצה נוכחית — {currentRun.runLabel}
            </h2>
          </div>

          {/* Algo group */}
          {currentRunByGroup.algo.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2 text-right">
                {GROUP_LABELS.algo}
              </h3>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                {currentRunByGroup.algo.map((r) => (
                  <ResultCard key={r.name} r={r} />
                ))}
              </div>
            </section>
          )}

          {/* Profile group */}
          {currentRunByGroup.profile.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <button
                  className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground"
                  onClick={() => setProfileExpanded((v) => !v)}
                >
                  {profileExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  {profileExpanded ? "הסתר שלבים" : "הצג שלבים"}
                </button>
                <h3 className="text-xs font-semibold text-muted-foreground">{GROUP_LABELS.profile}</h3>
              </div>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                {currentRunByGroup.profile.map((r) => (
                  <ResultCard key={r.name} r={r} />
                ))}
              </div>
            </section>
          )}

          {/* DOM passive group */}
          {currentRunByGroup.dom.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2 text-right">
                {GROUP_LABELS.dom} — מדידות מצטברות משימוש רגיל
              </h3>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                {currentRunByGroup.dom.map((r) => (
                  <ResultCard key={r.name} r={r} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Nav flow bench ── */}
      <Card className="gold-frame p-4">
        <NavFlowBench />
      </Card>

      {/* ── DOM live snapshot ── */}
      <Card className="gold-frame overflow-hidden">
        <div className="p-3 border-b border-gold/20 flex items-center justify-between">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshDom}
              className="h-7 gap-1.5 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              רענן
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { uiTimings.clear(); setDomSnapshot({}); }}
              className="h-7 gap-1.5 text-xs text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
              נקה
            </Button>
          </div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Eye className="h-4 w-4 text-gold" />
            מדידות DOM פאסיביות (מצטברות)
          </div>
        </div>

        {Object.keys(domSnapshot).length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            אין נתוני DOM עדיין — נווט לדף הקטגוריות, היכנס לקטגוריה, חפש — וחזור לכאן
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gold/20 bg-secondary/30">
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground">מדידה</th>
                  <th className="text-center p-3 text-xs font-semibold text-muted-foreground">אחרון</th>
                  <th className="text-center p-3 text-xs font-semibold text-muted-foreground">ממוצע</th>
                  <th className="text-center p-3 text-xs font-semibold text-muted-foreground">דגימות</th>
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground">עקומה (אחרונות {Math.min(6, Math.max(...Object.values(domSnapshot).map(d => d.samples.length)))})</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(domSnapshot).map(([slot, data]) => (
                  <tr key={slot} className="border-b border-gold/10 hover:bg-secondary/20 transition-colors">
                    <td className="p-3 text-right">
                      <p className="font-medium text-xs">{DOM_SLOT_LABELS[slot] ?? slot}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{slot}</p>
                    </td>
                    <td className="p-3 text-center">
                      <StatusBadge ms={data.last} threshold={thresholds.dom} />
                    </td>
                    <td className="p-3 text-center">
                      <StatusBadge ms={data.avg} threshold={thresholds.dom} />
                    </td>
                    <td className="p-3 text-center text-xs text-muted-foreground">{data.samples.length}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center gap-1 flex-wrap justify-end">
                        {data.samples.slice(-6).map((s, i) => (
                          <span
                            key={i}
                            className={cn(
                              "text-[10px] font-mono px-1 rounded",
                              getStatus(s, thresholds.dom) === "fast" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                              getStatus(s, thresholds.dom) === "ok" && "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                              getStatus(s, thresholds.dom) === "slow" && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
                            )}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── History comparison table ── */}
      {history.length > 1 && (
        <Card className="gold-frame overflow-hidden">
          <div className="p-4 border-b border-gold/20 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{history.length} ריצות שמורות</span>
            <h2 className="font-semibold text-sm">השוואה היסטורית</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-gold/20 bg-secondary/30">
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground sticky right-0 bg-secondary/30">ריצה</th>
                  {historyColumns.map((col) => (
                    <th key={col} className="text-center p-3 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      {col.replace(/_/g, " ").replace("dom:", "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().slice(0, 20).map((run, idx) => {
                  const isBaseline = run.id === baselineId;
                  return (
                    <tr
                      key={run.id}
                      className={cn(
                        "border-b border-gold/10 hover:bg-secondary/20 transition-colors",
                        idx === 0 && "bg-gold/5",
                        isBaseline && "ring-1 ring-inset ring-gold/50",
                      )}
                    >
                      <td className="p-3 text-right sticky right-0 bg-card">
                        <div className="flex items-center gap-1.5 justify-end">
                          {isBaseline && <Star className="h-3 w-3 text-gold shrink-0" />}
                          <div>
                            <p className="font-medium text-xs leading-snug">{run.runLabel}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">
                              {new Date(run.timestamp).toLocaleString("he-IL", {
                                day: "2-digit", month: "2-digit", year: "2-digit",
                                hour: "2-digit", minute: "2-digit",
                              })}
                            </p>
                          </div>
                          <button
                            onClick={() => isBaseline ? clearBaseline() : markBaseline(run.id)}
                            className="h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity"
                            title={isBaseline ? "בטל baseline" : "סמן כ-baseline"}
                          >
                            {isBaseline ? (
                              <StarOff className="h-3.5 w-3.5 text-gold" />
                            ) : (
                              <Zap className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-gold" />
                            )}
                          </button>
                        </div>
                      </td>
                      {historyColumns.map((col) => {
                        const r = run.results.find((x) => x.name === col);
                        const group: TestGroup = r?.group ?? "algo";
                        return (
                          <td key={col} className="p-3 text-center">
                            {r ? <StatusBadge ms={r.ms} threshold={thresholds[group]} /> : <span className="text-muted-foreground/30">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="p-3 border-t border-gold/20 flex flex-wrap gap-4 justify-end text-[11px] text-muted-foreground">
            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 ml-1" />מהיר (≥40% מהסף)</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 ml-1" />בינוני (≤סף)</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 ml-1" />איטי (&gt;סף)</span>
          </div>
        </Card>
      )}
    </div>
  );
}
