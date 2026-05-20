/**
 * NavFlowBench — Category navigation speed test
 *
 * Automated:  finds the deepest/most-branched category path, runs ×5 iterations,
 *             measures React render time at each navigation step (null→L1→L2→L3…).
 * Manual:     step-by-step timer — user navigates, clicks "הגעתי" per level.
 *
 * Results: stored in localStorage, copyable as plain text + JSON,
 *          last-2 comparison also copyable.
 */

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import {
  Play,
  ClipboardCopy,
  Clock,
  ChevronDown,
  ChevronRight,
  Check,
  Trash2,
  Timer,
  Gauge,
  FileJson,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStudy } from "@/lib/study/store";
import { cn } from "@/lib/utils";
import { displayCategoryName } from "@/lib/study/shasGen";
import type { Category } from "@/lib/study/types";
import { navBenchSignal, type BenchStepResult } from "@/lib/debug/navBenchSignal";
import { CategoryExplorerView } from "./CategoryExplorerView";

// ─── Types ────────────────────────────────────────────────────────────────────

type NavStep = {
  /** e.g. "כל הקטגוריות → ש\"ס" */
  label: string;
  /** individual measurements (up to numRuns) */
  times: number[];
  avg: number;
  min: number;
  max: number;
};

export type NavFlowRun = {
  id: string;
  timestamp: number;
  runLabel: string;
  mode: "auto" | "manual";
  pathNames: string[];
  steps: NavStep[];
  totalAvg: number;
};

type FoundPath = {
  /** sequence of parentId values to navigate through */
  navIds: Array<string | null>;
  /** human-readable names matching navIds */
  names: string[];
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const NAV_STORAGE_KEY = "nav-flow-history-v1";
const MAX_NAV_HISTORY = 20;

function loadNavHistory(): NavFlowRun[] {
  try {
    const raw = localStorage.getItem(NAV_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NavFlowRun[]) : [];
  } catch {
    return [];
  }
}

function saveNavHistory(runs: NavFlowRun[]): void {
  localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(runs.slice(-MAX_NAV_HISTORY)));
}

// ─── Path finder ──────────────────────────────────────────────────────────────

function findBestNavPath(categories: Category[]): FoundPath {
  const childrenOf = new Map<string | null, Category[]>();
  for (const c of categories) {
    const arr = childrenOf.get(c.parentId) ?? [];
    arr.push(c);
    childrenOf.set(c.parentId, arr);
  }

  function countDesc(id: string): number {
    const kids = childrenOf.get(id) ?? [];
    return kids.length + kids.reduce((s, k) => s + countDesc(k.id), 0);
  }

  const roots = childrenOf.get(null) ?? [];
  if (roots.length === 0) return { navIds: [null], names: ["כל הקטגוריות"] };

  // Best root: prefer one with grandchildren, sorted by total descendants
  const sorted = [...roots].sort((a, b) => countDesc(b.id) - countDesc(a.id));
  const bestRoot =
    sorted.find(r =>
      (childrenOf.get(r.id) ?? []).some(c => (childrenOf.get(c.id) ?? []).length > 0),
    ) ?? sorted[0];

  if (!bestRoot) return { navIds: [null], names: ["כל הקטגוריות"] };

  // Best L1: child of bestRoot with most children
  const L1kids = [...(childrenOf.get(bestRoot.id) ?? [])].sort(
    (a, b) =>
      (childrenOf.get(b.id)?.length ?? 0) - (childrenOf.get(a.id)?.length ?? 0),
  );
  const bestL1 =
    L1kids.find(c => (childrenOf.get(c.id) ?? []).length > 0) ?? L1kids[0];

  if (!bestL1) {
    return {
      navIds: [null, bestRoot.id],
      names: ["כל הקטגוריות", displayCategoryName(bestRoot.name)],
    };
  }

  // Best L2: child of bestL1 with most children
  const L2kids = [...(childrenOf.get(bestL1.id) ?? [])].sort(
    (a, b) =>
      (childrenOf.get(b.id)?.length ?? 0) - (childrenOf.get(a.id)?.length ?? 0),
  );
  const bestL2 = L2kids[0];

  if (!bestL2) {
    return {
      navIds: [null, bestRoot.id, bestL1.id],
      names: [
        "כל הקטגוריות",
        displayCategoryName(bestRoot.name),
        displayCategoryName(bestL1.name),
      ],
    };
  }

  // Optional L3
  const L3kids = childrenOf.get(bestL2.id) ?? [];
  const bestL3 = L3kids.sort(
    (a, b) =>
      (childrenOf.get(b.id)?.length ?? 0) - (childrenOf.get(a.id)?.length ?? 0),
  )[0];

  if (bestL3) {
    return {
      navIds: [null, bestRoot.id, bestL1.id, bestL2.id, bestL3.id],
      names: [
        "כל הקטגוריות",
        displayCategoryName(bestRoot.name),
        displayCategoryName(bestL1.name),
        displayCategoryName(bestL2.name),
        displayCategoryName(bestL3.name),
      ],
    };
  }

  return {
    navIds: [null, bestRoot.id, bestL1.id, bestL2.id],
    names: [
      "כל הקטגוריות",
      displayCategoryName(bestRoot.name),
      displayCategoryName(bestL1.name),
      displayCategoryName(bestL2.name),
    ],
  };
}

// ─── Copy helpers ─────────────────────────────────────────────────────────────

function runToText(run: NavFlowRun, prevRun?: NavFlowRun): string {
  const date = new Date(run.timestamp).toLocaleString("he-IL");
  const modeLabel =
    run.mode === "auto"
      ? `אוטומטי (${run.steps[0]?.times.length ?? 1} ריצות)`
      : "ידני";
  const lines: string[] = [
    `=== בדיקת ניווט קטגוריות ===`,
    `תאריך:  ${date}`,
    `מצב:    ${modeLabel}`,
    `מסלול:  ${run.pathNames.join(" → ")}`,
    ``,
    ...run.steps.map(s => {
      const base =
        s.times.length > 1
          ? `ממוצע ${s.avg}ms  (מין ${s.min}ms, מקס ${s.max}ms)  [${s.times.join(", ")}ms]`
          : `${s.avg}ms`;
      return `${s.label}:  ${base}`;
    }),
    ``,
    `סה"כ:   ממוצע ${run.totalAvg}ms`,
  ];

  if (prevRun) {
    lines.push(``, `--- השוואה לריצה הקודמת (${prevRun.runLabel}) ---`);
    run.steps.forEach((step, i) => {
      const prev = prevRun.steps[i];
      if (!prev) return;
      const diff = step.avg - prev.avg;
      const sign = diff > 0 ? "+" : "";
      lines.push(`${step.label}:  ${prev.avg}ms → ${step.avg}ms  (${sign}${diff}ms)`);
    });
    const totalDiff = run.totalAvg - prevRun.totalAvg;
    lines.push(`סה"כ:  ${prevRun.totalAvg}ms → ${run.totalAvg}ms  (${totalDiff > 0 ? "+" : ""}${totalDiff}ms)`);
  }

  return lines.join("\n");
}

function comparisonText(a: NavFlowRun, b: NavFlowRun): string {
  const lines: string[] = [
    `=== השוואת ניווט ===`,
    `A: ${a.runLabel} (${a.mode === "auto" ? "אוטומטי" : "ידני"})`,
    `B: ${b.runLabel} (${b.mode === "auto" ? "אוטומטי" : "ידני"})`,
    ``,
    ...b.steps.map((step, i) => {
      const prev = a.steps[i];
      const diff = step.avg - (prev?.avg ?? 0);
      const sign = diff > 0 ? "+" : "";
      return `${step.label}:  A=${prev?.avg ?? "?"}ms → B=${step.avg}ms  (${sign}${diff}ms)`;
    }),
    ``,
    `סה"כ:  A=${a.totalAvg}ms → B=${b.totalAvg}ms  (${
      b.totalAvg - a.totalAvg > 0 ? "+" : ""
    }${b.totalAvg - a.totalAvg}ms)`,
  ];
  return lines.join("\n");
}

function copyText(text: string, onDone: () => void) {
  navigator.clipboard.writeText(text).then(onDone).catch(() => {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      onDone();
    } catch {
      /* ignore */
    }
  });
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const THRESHOLDS = { fast: 30, ok: 100 } as const;

function NavBadge({ ms }: { ms: number }) {
  const s = ms <= THRESHOLDS.fast ? "fast" : ms <= THRESHOLDS.ok ? "ok" : "slow";
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-bold tabular-nums shrink-0",
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

// NavSimulator removed — bench now runs inside the real CategoryExplorerView via navBenchSignal

// ─── ResultCard ───────────────────────────────────────────────────────────────

function RunResultCard({
  run,
  prevRun,
  onCopyText,
  onCopyJson,
  copiedId,
}: {
  run: NavFlowRun;
  prevRun?: NavFlowRun;
  onCopyText: (run: NavFlowRun) => void;
  onCopyJson: (run: NavFlowRun) => void;
  copiedId: string | null;
}) {
  return (
    <Card className="gold-frame p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => onCopyText(run)}
            title="העתק כטקסט"
          >
            {copiedId === `text-${run.id}` ? (
              <Check className="h-3 w-3 text-emerald-600" />
            ) : (
              <ClipboardCopy className="h-3 w-3" />
            )}
            טקסט
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => onCopyJson(run)}
            title="העתק כ-JSON"
          >
            {copiedId === `json-${run.id}` ? (
              <Check className="h-3 w-3 text-emerald-600" />
            ) : (
              <FileJson className="h-3 w-3" />
            )}
            JSON
          </Button>
        </div>
        <div className="text-right min-w-0">
          <p className="text-sm font-semibold leading-snug">{run.runLabel}</p>
          <p className="text-[10px] text-muted-foreground">
            {run.mode === "auto"
              ? `אוטומטי ×${run.steps[0]?.times.length ?? 1}`
              : "ידני"}
            {" · "}
            {run.pathNames.join(" → ")}
          </p>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {run.steps.map((step, i) => {
          const prev = prevRun?.steps[i];
          const diff = prev != null ? step.avg - prev.avg : null;
          const isRegression = diff != null && diff > 10;
          return (
            <div key={i} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 shrink-0">
                <NavBadge ms={step.avg} />
                {diff !== null && Math.abs(diff) >= 3 && (
                  <span
                    className={cn(
                      "text-[10px] font-semibold flex items-center gap-0.5",
                      isRegression ? "text-red-500" : "text-emerald-600",
                    )}
                  >
                    {isRegression ? (
                      <TrendingUp className="h-2.5 w-2.5" />
                    ) : (
                      <TrendingDown className="h-2.5 w-2.5" />
                    )}
                    {diff > 0 ? "+" : ""}{diff}ms
                  </span>
                )}
                {step.times.length > 1 && (
                  <span className="text-[10px] text-muted-foreground/70 font-mono">
                    [{step.min}–{step.max}]
                  </span>
                )}
              </div>
              <p className="text-xs text-right text-muted-foreground flex-1 min-w-0 truncate">
                {step.label}
              </p>
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between pt-2 border-t border-gold/20">
        <NavBadge ms={run.totalAvg} />
        <span className="text-xs font-semibold text-muted-foreground">
          סה&quot;כ מסע
          {prevRun != null && Math.abs(run.totalAvg - prevRun.totalAvg) >= 3 && (
            <span
              className={cn(
                "mr-1.5 font-bold",
                run.totalAvg > prevRun.totalAvg ? "text-red-500" : "text-emerald-600",
              )}
            >
              ({run.totalAvg > prevRun.totalAvg ? "+" : ""}{run.totalAvg - prevRun.totalAvg}ms)
            </span>
          )}
        </span>
      </div>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NavFlowBench() {
  const { state } = useStudy();
  const categories = useMemo(() => state.categories ?? [], [state.categories]);

  const [history, setHistory] = useState<NavFlowRun[]>(loadNavHistory);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{ run: number; step: number } | null>(null);
  const [showBenchView, setShowBenchView] = useState(false);

  // benchTriggerRef stores pending trigger params when we mount the hidden view
  const benchTriggerRef = useRef<{
    navIds: Array<string | null>;
    numRuns: number;
    stepLabels: string[];
    onComplete: (r: BenchStepResult[]) => void;
    onProgress: (run: number, step: number) => void;
  } | null>(null);

  // Poll via requestAnimationFrame until the hidden CategoryExplorerView registers itself
  useEffect(() => {
    if (!showBenchView) return;
    let rafId: number;
    const poll = () => {
      if (navBenchSignal.isAvailable() && benchTriggerRef.current) {
        const t = benchTriggerRef.current;
        benchTriggerRef.current = null;
        navBenchSignal.trigger(t.navIds, t.numRuns, t.stepLabels, t.onComplete, t.onProgress);
      } else {
        rafId = requestAnimationFrame(poll);
      }
    };
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [showBenchView]);

  // Manual timer state
  const [manualRunning, setManualRunning] = useState(false);
  const [manualStepIdx, setManualStepIdx] = useState(0);
  const [manualStepTimes, setManualStepTimes] = useState<number[]>([]);
  const manualT0Ref = useRef<number>(0);
  const manualStepT0Ref = useRef<number>(0);

  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const navPath = useMemo(() => findBestNavPath(categories), [categories]);
  const NUM_RUNS = 5;

  const stepLabels = useMemo(
    () =>
      navPath.navIds.slice(1).map((_, i) => {
        const from = navPath.names[i] ?? "—";
        const to = navPath.names[i + 1] ?? "—";
        return `${from} → ${to}`;
      }),
    [navPath],
  );

  const latestRun = history[history.length - 1];
  const prevRun = history.length >= 2 ? history[history.length - 2] : undefined;

  const hasData = categories.length > 0;

  // ── Build NavFlowRun from step results ───────────────────────────────────────

  const buildRunFromResults = useCallback(
    (results: BenchStepResult[]): NavFlowRun => {
      const steps: NavStep[] = results.map((r, i) => {
        const nonZero = r.times.filter(t => t > 0);
        const avg = nonZero.length > 0
          ? Math.round(nonZero.reduce((s, v) => s + v, 0) / nonZero.length)
          : 0;
        return {
          label: r.label || stepLabels[i] || `שלב ${i + 1}`,
          times: nonZero,
          avg,
          min: nonZero.length > 0 ? Math.min(...nonZero) : 0,
          max: nonZero.length > 0 ? Math.max(...nonZero) : 0,
        };
      });
      const totalAvg = steps.reduce((s, st) => s + st.avg, 0);
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: Date.now(),
        runLabel: new Date().toLocaleString("he-IL", {
          day: "2-digit", month: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }),
        mode: "auto",
        pathNames: navPath.names,
        steps,
        totalAvg,
      };
    },
    [stepLabels, navPath.names],
  );

  const buildRun = useCallback(
    (stepTimings: number[][], mode: "auto" | "manual"): NavFlowRun => {
      const steps: NavStep[] = stepTimings.map((times, i) => {
        const nonZero = times.filter(t => t > 0);
        const avg =
          nonZero.length > 0
            ? Math.round(nonZero.reduce((s, v) => s + v, 0) / nonZero.length)
            : 0;
        return {
          label: stepLabels[i] ?? `שלב ${i + 1}`,
          times: nonZero,
          avg,
          min: nonZero.length > 0 ? Math.min(...nonZero) : 0,
          max: nonZero.length > 0 ? Math.max(...nonZero) : 0,
        };
      });
      const totalAvg = steps.reduce((s, st) => s + st.avg, 0);
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: Date.now(),
        runLabel: new Date().toLocaleString("he-IL", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        mode,
        pathNames: navPath.names,
        steps,
        totalAvg,
      };
    },
    [stepLabels, navPath.names],
  );

  const pushRun = useCallback((run: NavFlowRun) => {
    setHistory(prev => {
      const next = [...prev, run];
      saveNavHistory(next);
      return next;
    });
  }, []);

  // ── Auto test callbacks ─────────────────────────────────────────────────────

  const handleAutoComplete = useCallback(
    (results: BenchStepResult[]) => {
      const run = buildRunFromResults(results);
      pushRun(run);
      setAutoRunning(false);
      setAutoProgress(null);
      setShowBenchView(false);
    },
    [buildRunFromResults, pushRun],
  );

  const handleAutoProgress = useCallback((run: number, step: number) => {
    setAutoProgress({ run, step });
  }, []);

  // ── Manual timer ────────────────────────────────────────────────────────────

  const startManual = () => {
    const t = performance.now();
    manualT0Ref.current = t;
    manualStepT0Ref.current = t;
    setManualStepTimes([]);
    setManualStepIdx(0);
    setManualRunning(true);
  };

  const recordManualStep = () => {
    const elapsed = Math.round(performance.now() - manualStepT0Ref.current);
    manualStepT0Ref.current = performance.now();
    const newTimes = [...manualStepTimes, elapsed];
    const nextIdx = manualStepIdx + 1;

    if (nextIdx >= stepLabels.length) {
      setManualRunning(false);
      setManualStepTimes([]);
      setManualStepIdx(0);
      const run = buildRun(newTimes.map(t => [t]), "manual");
      pushRun(run);
    } else {
      setManualStepTimes(newTimes);
      setManualStepIdx(nextIdx);
    }
  };

  const cancelManual = () => {
    setManualRunning(false);
    setManualStepTimes([]);
    setManualStepIdx(0);
  };

  // ── Copy ────────────────────────────────────────────────────────────────────

  const handleCopyText = (run: NavFlowRun) => {
    const prev = history[history.indexOf(run) - 1];
    copyText(runToText(run, prev), () => {
      setCopiedId(`text-${run.id}`);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleCopyJson = (run: NavFlowRun) => {
    copyText(JSON.stringify(run, null, 2), () => {
      setCopiedId(`json-${run.id}`);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleCopyComparison = () => {
    if (history.length < 2) return;
    const [a, b] = history.slice(-2);
    copyText(comparisonText(a, b), () => {
      setCopiedId("comparison");
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(NAV_STORAGE_KEY);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {history.length >= 2 && (
            <Button
              onClick={handleCopyComparison}
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-xl text-xs h-8"
            >
              {copiedId === "comparison" ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <ClipboardCopy className="h-3.5 w-3.5" />
              )}
              השווה והעתק
            </Button>
          )}
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHistory}
              className="text-muted-foreground gap-1.5 text-xs h-8 rounded-xl"
            >
              <Trash2 className="h-3 w-3" />
              נקה
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-gold" />
          <h2 className="font-semibold text-sm">בדיקת ניווט UI</h2>
        </div>
      </div>

      {/* No data warning */}
      {!hasData && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          הנתונים טרם נטענו — פתח טאב קטגוריות וחזור לכאן
        </div>
      )}

      {/* Path info */}
      {hasData && (
        <p className="text-[11px] text-muted-foreground text-right leading-relaxed">
          <span className="font-semibold">מסלול:&nbsp;</span>
          {navPath.names.map((n, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1 opacity-40">→</span>}
              <span>{n}</span>
            </span>
          ))}
          <span className="ml-2 opacity-60">({stepLabels.length} שלבים)</span>
        </p>
      )}

      {/* Action row */}
      <div className="flex flex-wrap gap-2 items-center justify-end">

        {/* Auto */}
        <Button
          onClick={() => {
            setAutoRunning(true);
            if (navBenchSignal.isAvailable()) {
              navBenchSignal.trigger(
                navPath.navIds,
                NUM_RUNS,
                stepLabels,
                handleAutoComplete,
                handleAutoProgress,
              );
            } else {
              benchTriggerRef.current = {
                navIds: navPath.navIds,
                numRuns: NUM_RUNS,
                stepLabels,
                onComplete: handleAutoComplete,
                onProgress: handleAutoProgress,
              };
              setShowBenchView(true);
            }
          }}
          disabled={autoRunning || manualRunning || !hasData}
          size="sm"
          className="bg-gradient-navy text-primary-foreground gap-2 rounded-xl"
        >
          <Play className="h-3.5 w-3.5" />
          {autoRunning
            ? autoProgress
              ? `ריצה ${autoProgress.run + 1}/${NUM_RUNS} · שלב ${autoProgress.step + 1}/${stepLabels.length}`
              : "מריץ…"
            : `בדיקה אוטומטית ×${NUM_RUNS}`}
        </Button>

        {/* Manual */}
        {!manualRunning ? (
          <Button
            onClick={startManual}
            disabled={autoRunning || !hasData}
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl"
          >
            <Timer className="h-3.5 w-3.5" />
            טיימר ידני
          </Button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="text-xs text-muted-foreground text-right">
              {manualStepIdx < stepLabels.length
                ? <>כעת: <span className="font-semibold">{stepLabels[manualStepIdx]}</span></>
                : "סיום"}
            </div>
            <Button
              onClick={recordManualStep}
              size="sm"
              className="bg-amber-500 hover:bg-amber-600 text-white gap-2 rounded-xl"
            >
              <Clock className="h-3.5 w-3.5" />
              הגעתי לשלב {manualStepIdx + 1}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelManual}
              className="text-muted-foreground text-xs rounded-xl"
            >
              ביטול
            </Button>
          </div>
        )}
      </div>

      {/* Manual step progress */}
      {manualRunning && (
        <Card className="gold-frame p-3 space-y-1.5">
          <p className="text-xs font-semibold text-right text-muted-foreground">
            נווט לשלב הנוכחי ולאחר מכן לחץ &quot;הגעתי לשלב X&quot;
          </p>
          {stepLabels.map((label, i) => {
            const recorded = manualStepTimes[i];
            const isCurrent = i === manualStepIdx;
            return (
              <div key={i} className="flex items-center justify-between gap-2 text-xs">
                <div>
                  {recorded != null ? (
                    <NavBadge ms={recorded} />
                  ) : (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs",
                        isCurrent
                          ? "border-amber-400 text-amber-600 animate-pulse"
                          : "text-muted-foreground/40",
                      )}
                    >
                      {isCurrent ? "⏱ מודד…" : "ממתין"}
                    </Badge>
                  )}
                </div>
                <span className={cn("text-right", isCurrent && "font-semibold")}>{label}</span>
              </div>
            );
          })}
        </Card>
      )}

      {/* Hidden real CategoryExplorerView — mounted on demand to feed the bench signal */}
      {showBenchView && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            opacity: 0,
            pointerEvents: "none",
            height: 0,
            overflow: "hidden",
            width: "100%",
          }}
        >
          <CategoryExplorerView
            selectedCategory={null}
            onSelectCategory={() => {}}
            onAddCardToCategory={() => {}}
          />
        </div>
      )}

      {/* Latest result */}
      {latestRun && !autoRunning && (
        <RunResultCard
          run={latestRun}
          prevRun={prevRun}
          onCopyText={handleCopyText}
          onCopyJson={handleCopyJson}
          copiedId={copiedId}
        />
      )}

      {/* History table */}
      {history.length > 1 && (
        <Card className="gold-frame overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-3 text-sm font-semibold hover:bg-secondary/30 transition-colors"
            onClick={() => setHistoryExpanded(v => !v)}
          >
            <span className="text-xs text-muted-foreground">{history.length} ריצות שמורות</span>
            <span className="flex items-center gap-1.5">
              היסטוריה + השוואה
              {historyExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
          </button>

          {historyExpanded && (
            <div className="overflow-x-auto border-t border-gold/20">
              <table className="w-full text-xs min-w-[360px]">
                <thead>
                  <tr className="border-b border-gold/20 bg-secondary/30">
                    <th className="text-right p-2 font-semibold text-muted-foreground sticky right-0 bg-secondary/30">
                      ריצה
                    </th>
                    {stepLabels.map((l, i) => (
                      <th
                        key={i}
                        className="text-center p-2 font-semibold text-muted-foreground whitespace-nowrap"
                      >
                        {l}
                      </th>
                    ))}
                    <th className="text-center p-2 font-semibold text-muted-foreground">סה&quot;כ</th>
                    <th className="p-2 w-14" />
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((run, idx) => (
                    <tr
                      key={run.id}
                      className={cn(
                        "border-b border-gold/10 hover:bg-secondary/20 transition-colors",
                        idx === 0 && "bg-gold/5",
                      )}
                    >
                      <td className="p-2 text-right sticky right-0 bg-card">
                        <p className="font-medium leading-snug">{run.runLabel}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {run.mode === "auto" ? "אוטומטי" : "ידני"}
                        </p>
                      </td>
                      {stepLabels.map((_, i) => {
                        const step = run.steps[i];
                        return (
                          <td key={i} className="p-2 text-center">
                            {step ? (
                              <NavBadge ms={step.avg} />
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-2 text-center">
                        <NavBadge ms={run.totalAvg} />
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1 justify-end">
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => handleCopyText(run)}
                            title="העתק טקסט"
                          >
                            {copiedId === `text-${run.id}` ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <ClipboardCopy className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => handleCopyJson(run)}
                            title="העתק JSON"
                          >
                            {copiedId === `json-${run.id}` ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <FileJson className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
