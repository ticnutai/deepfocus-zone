/**
 * PerfMonitor — floating admin-only dev overlay.
 * Dense log view: FPS, memory, per-entry timing + detail, copy-report button.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Activity, X, Trash2, Copy, Check, ChevronDown, ChevronRight, Clock, Power } from "lucide-react";
import { debugLog, type DebugEntry, type LogLevel, type PerfCategory } from "@/lib/debug/perf";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

/* ─── helpers ─────────────────────────────────────────────────────────────── */

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return (
    [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":") +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
};

const fmtDur = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;

type FilterKey = "all" | LogLevel;

const levelBadge: Record<LogLevel, string> = {
  perf:     "bg-blue-500/20  text-blue-300",
  log:      "bg-zinc-500/20  text-zinc-300",
  warn:     "bg-yellow-500/20 text-yellow-300",
  error:    "bg-red-500/20   text-red-300",
  longtask: "bg-orange-500/20 text-orange-300",
};
const levelLabel: Record<LogLevel, string> = {
  perf: "PERF", log: "LOG", warn: "WARN", error: "ERR", longtask: "BLOCK",
};
const catLabel: Record<PerfCategory, string> = {
  db: "DB", store: "Store", longtask: "Block", other: "—",
};

const durColor = (ms: number, level: LogLevel) => {
  if (level === "longtask") return "text-orange-400";
  if (ms >= 1000) return "text-red-400 font-bold";
  if (ms >= 300)  return "text-orange-400";
  if (ms >= 100)  return "text-yellow-400";
  return "text-emerald-400";
};

const rowBg = (e: DebugEntry) => {
  if (e.level === "error")    return "bg-red-950";
  if (e.level === "warn")     return "bg-yellow-950";
  if (e.level === "longtask") return "bg-orange-950";
  return "";
};

/* ─── Themes ─────────────────────────────────────────────────────────────── */
const PM_THEMES = [
  {
    id: "dark", icon: "🌑", label: "כהה",
    panel:      "bg-zinc-950 border-zinc-700 text-zinc-200",
    bar:        "bg-zinc-900 border-zinc-800",
    thead:      "bg-zinc-900 text-zinc-400",
    row:        "border-zinc-800 hover:bg-zinc-800",
    inner:      "bg-zinc-900",
    chip:       "border-zinc-700 text-zinc-400 hover:border-zinc-500",
    chipActive: "bg-zinc-700 border-zinc-500 text-white",
  },
  {
    id: "blue", icon: "🔷", label: "כחול",
    panel:      "bg-slate-950 border-slate-700 text-slate-200",
    bar:        "bg-slate-900 border-slate-800",
    thead:      "bg-slate-900 text-slate-400",
    row:        "border-slate-800 hover:bg-slate-800",
    inner:      "bg-slate-900",
    chip:       "border-slate-700 text-slate-400 hover:border-slate-500",
    chipActive: "bg-slate-700 border-slate-500 text-white",
  },
  {
    id: "terminal", icon: "💻", label: "טרמינל",
    panel:      "bg-black border-green-900 text-green-300",
    bar:        "bg-black border-green-900/50",
    thead:      "bg-black text-green-600",
    row:        "border-green-900/30 hover:bg-green-900/20",
    inner:      "bg-zinc-950",
    chip:       "border-green-900/50 text-green-600 hover:border-green-700",
    chipActive: "bg-green-900/40 border-green-700 text-green-300",
  },
];
type PmTheme = typeof PM_THEMES[number];

/* ─── FPS pill ────────────────────────────────────────────────────────────── */
function FpsPill({ fps }: { fps: number }) {
  const color =
    fps >= 50 ? "text-emerald-400" : fps >= 30 ? "text-orange-400" : "text-red-400";
  return <span className={cn("tabular-nums font-bold", color)}>{fps}fps</span>;
}

/* ─── Resizable table header ──────────────────────────────────────────────── */
function ResizableTh({
  label, colKey, onStart, className,
}: {
  label: string;
  colKey: string;
  onStart: (key: string, e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <th className={cn("relative select-none", className)}>
      <span className="block truncate pr-1.5">{label}</span>
      {/* resize handle */}
      <span
        onMouseDown={(e) => onStart(colKey, e)}
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-cyan-400/60 active:bg-cyan-400"
        title="גרור כדי לשנות רוחב עמודה"
      />
    </th>
  );
}

/* ─── Health Score badge ─────────────────────────────────────────────────── */
function HealthBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "text-emerald-400 border-emerald-600" :
    score >= 60 ? "text-yellow-400 border-yellow-600" :
    score >= 40 ? "text-orange-400 border-orange-600" :
                  "text-red-400 border-red-600";
  return (
    <span
      className={cn("tabular-nums font-bold border rounded px-1 text-[10px]", color)}
      title={`Health Score: ${score}/100`}
    >
      ❤ {score}
    </span>
  );
}

/* ─── Sparkline ──────────────────────────────────────────────────────────── */
function Sparkline({
  data, color = "#34d399", width = 56, height = 18,
}: { data: number[]; color?: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible shrink-0 opacity-75">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ─── Smart Alerts bar ───────────────────────────────────────────────────── */
type SmartAlert = ReturnType<typeof debugLog.getSmartAlerts>[number];

function SmartAlertsBar({ alerts, theme }: { alerts: SmartAlert[]; theme: PmTheme }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const visible = alerts.filter((a) => !dismissed.has(a.key));
  if (visible.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-0.5 px-2 py-1 border-b shrink-0", theme.bar)}>
      {visible.map((a) => (
        <div
          key={a.key}
          className={cn(
            "flex items-center gap-1.5 text-[10px] rounded px-2 py-0.5",
            a.level === "error"
              ? "bg-red-950/80 text-red-300 border border-red-800/50"
              : "bg-yellow-950/80 text-yellow-300 border border-yellow-800/50",
          )}
        >
          <span className="shrink-0 text-[9px]">{a.level === "error" ? "🔴" : "⚠️"}</span>
          <span className="flex-1">{a.msg}</span>
          <button
            onClick={() => setDismissed((d) => new Set([...d, a.key]))}
            className="shrink-0 opacity-40 hover:opacity-100 px-1 leading-none"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* ─── N+1 card ───────────────────────────────────────────────────────────── */
type N1Pattern = ReturnType<typeof debugLog.detectN1Patterns>[number];

function N1Card({ patterns, theme }: { patterns: N1Pattern[]; theme: PmTheme }) {
  const [collapsed, setCollapsed] = useState(true);
  if (patterns.length === 0) return null;
  return (
    <div className={cn("border-b shrink-0", theme.bar)}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] hover:bg-zinc-800"
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3 text-purple-400" />
          : <ChevronDown  className="h-3 w-3 text-purple-400" />}
        <span className="font-bold text-purple-300">N+1 Detected</span>
        <span className="text-purple-400 tabular-nums">
          {patterns.length} pattern{patterns.length > 1 ? "s" : ""}
        </span>
        <span className="text-zinc-500 ml-auto text-[9px]">last 5s</span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-2 space-y-1">
          {patterns.map((p, i) => (
            <div key={i} className={cn("text-[9px] rounded px-2 py-1.5 space-y-0.5", theme.inner)}>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-purple-300 tabular-nums text-[10px]">{p.count}×</span>
                <span className="text-zinc-200 flex-1 truncate font-mono">{p.label}</span>
                <span className="text-zinc-500 shrink-0">
                  {p.windowMs > 0 ? `${(p.windowMs / 1000).toFixed(1)}s window` : "burst"}
                </span>
              </div>
              <div className="text-zinc-400 pl-6">
                total: <span className="text-orange-300 tabular-nums">{p.totalMs}ms</span>
                {" · "}avg/call: <span className="text-orange-300 tabular-nums">
                  {Math.round(p.totalMs / p.count)}ms
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Blocks card ────────────────────────────────────────────────────────── */
type BlockEntry = ReturnType<typeof debugLog.getRecentBlocks>[number];

const classColors: Record<string, string> = {
  "user-interaction": "text-amber-300 bg-amber-900/40",
  "async-callback":   "text-blue-300 bg-blue-900/40",
  "timer-callback":   "text-sky-300 bg-sky-900/40",
  "db-callback":      "text-emerald-300 bg-emerald-900/40",
  "bundle-parse":     "text-violet-300 bg-violet-900/40",
  "initial-load":     "text-violet-300 bg-violet-900/40",
  "react-render":     "text-cyan-300 bg-cyan-900/40",
  "raf-work":         "text-orange-300 bg-orange-900/40",
  "mutation-observer":"text-indigo-300 bg-indigo-900/40",
  "intersection-observer":"text-indigo-300 bg-indigo-900/40",
  "dnd-work":         "text-pink-300 bg-pink-900/40",
  "unknown-block":    "text-zinc-400 bg-zinc-800/40",
};

function BlocksCard({ blocks, theme }: { blocks: BlockEntry[]; theme: PmTheme }) {
  const [collapsed, setCollapsed] = useState(true);
  if (blocks.length === 0) return null;

  const worstMs = Math.max(...blocks.map((b) => b.durationMs));

  return (
    <div className={cn("border-b shrink-0", theme.bar)}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] hover:bg-zinc-800"
      >
        {collapsed ? <ChevronRight className="h-3 w-3 text-orange-400" /> : <ChevronDown className="h-3 w-3 text-orange-400" />}
        <span className="font-bold text-orange-300">Blocks</span>
        <span className="text-orange-400 tabular-nums">{blocks.length} × worst {fmtDur(worstMs)}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-2 space-y-1">
          {blocks.map((b, i) => {
            const cls = b.classification ?? "unknown-block";
            const clsColor = classColors[cls] ?? classColors["unknown-block"];
            const totalWork = (b.workMs ?? 0) + (b.renderMs ?? 0);
            const workPct = totalWork > 0 ? Math.round(((b.workMs ?? 0) / totalWork) * 100) : 0;
            return (
              <div key={i} className={cn("text-[9px] rounded px-2 py-1 space-y-0.5", theme.inner)}>
                {/* Header row: duration + label + class badge + traceId */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cn("font-bold tabular-nums", b.durationMs >= 100 ? "text-red-400" : "text-orange-400")}>
                    {fmtDur(b.durationMs)}
                  </span>
                  <span className="text-zinc-400">{b.label}</span>
                  <span className={cn("px-1 rounded font-semibold", clsColor)}>{cls}</span>
                  {b.phase && <span className="text-zinc-500">{b.phase}</span>}
                  {b.traceId && <span className="text-cyan-400 ml-auto">{b.traceId.slice(-6)}</span>}
                </div>

                {/* Invoker chain */}
                {(b.invokerType || b.invoker) && (
                  <div className="text-yellow-300">
                    <span className="text-zinc-500">trigger: </span>
                    {b.invokerType && <span className="text-amber-400 font-semibold">{b.invokerType}</span>}
                    {b.invokerType && b.invoker && <span className="text-zinc-500"> ← </span>}
                    {b.invoker && <span>{b.invoker.slice(0, 60)}</span>}
                  </div>
                )}

                {/* Cause (longtask nearest signal) */}
                {b.cause && !b.invoker && (
                  <div className="text-yellow-200">
                    <span className="text-zinc-500">cause: </span>{b.cause.slice(0, 70)}
                  </div>
                )}

                {/* Source file */}
                {b.src && (
                  <div className="text-sky-300">
                    <span className="text-zinc-500">src: </span>{b.src}
                  </div>
                )}

                {/* Work / Render timing bar */}
                {(b.workMs !== undefined || b.renderMs !== undefined) && (
                  <div className="space-y-0.5">
                    <div className="flex gap-2 text-[8px]">
                      <span className="text-zinc-500">work:</span>
                      <span className="text-orange-300 tabular-nums">{b.workMs ?? 0}ms</span>
                      {b.renderMs !== undefined && b.renderMs > 0 && (
                        <>
                          <span className="text-zinc-500">render:</span>
                          <span className="text-cyan-300 tabular-nums">{b.renderMs}ms</span>
                        </>
                      )}
                      {b.uiEventMs !== undefined && (
                        <>
                          <span className="text-zinc-500">uiEvent@</span>
                          <span className="text-purple-300 tabular-nums">{b.uiEventMs}ms</span>
                        </>
                      )}
                    </div>
                    {totalWork > 0 && (
                      <div className="flex h-1 rounded overflow-hidden w-full bg-zinc-700">
                        <div className="bg-orange-500 h-full" style={{ width: `${workPct}%` }} />
                        <div className="bg-cyan-600 h-full" style={{ width: `${100 - workPct}%` }} />
                      </div>
                    )}
                  </div>
                )}

                {/* Top scripts breakdown */}
                {b.scripts && b.scripts.length > 0 && (
                  <div className="text-[8px] text-zinc-300 space-y-px">
                    <span className="text-zinc-500">scripts:</span>
                    {b.scripts.map((s, si) => (
                      <div key={si} className="pl-2 text-zinc-400">
                        <span className="text-emerald-400">[{si + 1}]</span> {s}
                      </div>
                    ))}
                  </div>
                )}

                {/* Library detected */}
                {b.lib && (
                  <div className="text-pink-300">
                    <span className="text-zinc-500">lib: </span>{b.lib}
                  </div>
                )}

                {/* React measures overlapping */}
                {b.reactMeasures && (
                  <div className="text-cyan-300">
                    <span className="text-zinc-500">react: </span>{b.reactMeasures}
                  </div>
                )}

                {/* Concurrent ops */}
                {b.overlap && (
                  <div className="text-purple-300">
                    <span className="text-zinc-500">overlap: </span>{b.overlap}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Pipeline card ──────────────────────────────────────────────────────── */
type PipelineStage = { label: string; durationMs: number; traceId: string; ts: number };

const stageDurColor = (ms: number) =>
  ms < 200  ? "bg-emerald-500" :
  ms < 500  ? "bg-yellow-500" :
  ms < 800  ? "bg-orange-500" :
              "bg-red-500";

const stageDurText = (ms: number) =>
  ms < 200  ? "text-emerald-400" :
  ms < 500  ? "text-yellow-400" :
  ms < 800  ? "text-orange-400" :
              "text-red-400 font-bold";

function PipelineCard({ stages, theme }: { stages: PipelineStage[]; theme: PmTheme }) {
  const [collapsed, setCollapsed] = useState(false);
  if (stages.length === 0) return null;

  const allGreen = stages.every((s) => s.durationMs < 200);
  const total = stages.find((s) => s.label === "total");
  const subStages = stages.filter((s) => s.label !== "total");
  const maxMs = Math.max(...subStages.map((s) => s.durationMs), 1);

  return (
    <div className={cn("border-b shrink-0", theme.bar)}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        <span className="font-bold">Pipeline</span>
        {total && (
          <span className={cn("ml-1 tabular-nums", stageDurText(total.durationMs))}>
            {fmtDur(total.durationMs)} total
          </span>
        )}
        {allGreen && <span className="text-emerald-400 ml-auto">✓ all fast</span>}
      </button>

      {!collapsed && subStages.length > 0 && (
        <div className="px-3 pb-2 space-y-0.5">
          {subStages.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="text-zinc-400 w-[130px] truncate shrink-0 text-[9px]" title={s.label}>
                {s.label}
              </span>
              <div className="flex-1 h-1.5 bg-zinc-800 rounded overflow-hidden">
                <div
                  className={cn("h-full rounded", stageDurColor(s.durationMs))}
                  style={{ width: `${Math.min(100, (s.durationMs / maxMs) * 100)}%` }}
                />
              </div>
              <span className={cn("w-[42px] text-right tabular-nums text-[9px]", stageDurText(s.durationMs))}>
                {fmtDur(s.durationMs)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main component ──────────────────────────────────────────────────────── */
export function PerfMonitor() {
  const { isAdmin } = usePermissions();
  const [open, setOpen]       = useState(false);
  const [filter, setFilter]   = useState<FilterKey>("all");
  const [traceFilter, setTraceFilter] = useState<string | null>(null);
  const [copied, setCopied]   = useState(false);
  const [, forceUpdate]       = useState(0);
  const [themeId, setThemeId] = useState<string>(() => {
    const s = localStorage.getItem("pashash:pm:theme");
    return (s && PM_THEMES.some(t => t.id === s)) ? s : "dark";
  });
  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    try {
      const s = localStorage.getItem("pashash:pm:size");
      if (s) return JSON.parse(s) as { w: number; h: number };
    } catch { /* ignore */ }
    return { w: 520, h: Math.round(window.innerHeight * 0.75) };
  });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const s = localStorage.getItem("pashash:pm:pos");
      if (s) return JSON.parse(s) as { x: number; y: number };
    } catch { /* ignore */ }
    const defaultH = Math.round(window.innerHeight * 0.75);
    return { x: 16, y: Math.max(16, window.innerHeight - 16 - defaultH) };
  });
  const posRef = useRef(pos);
  posRef.current = pos;
  const [displayLimit, setDisplayLimit] = useState<number>(100);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  /* ── resizable log table columns ── */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const defaults = { time: 72, type: 44, cat: 30, trace: 62, label: 140, detail: 120, dur: 56 };
    try {
      const s = localStorage.getItem("pashash:pm:colWidths");
      if (s) return { ...defaults, ...(JSON.parse(s) as Record<string, number>) };
    } catch { /* ignore */ }
    return defaults;
  });
  useEffect(() => {
    try { localStorage.setItem("pashash:pm:colWidths", JSON.stringify(colWidths)); } catch { /* ignore */ }
  }, [colWidths]);
  const startColResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[key] ?? 80;
    const onMove = (mv: MouseEvent) => {
      const next = Math.max(24, startW + (mv.clientX - startX));
      setColWidths((prev) => ({ ...prev, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [colWidths]);
  const entriesRef            = useRef<DebugEntry[]>([]);
  const fpsRef                = useRef(60);
  const memRef                = useRef<number | null>(null);

  const refresh = useCallback(() => {
    entriesRef.current = [...debugLog.entries];
    fpsRef.current     = debugLog.fps;
    memRef.current     = debugLog.memoryMB;
    forceUpdate((n) => n + 1);
  }, []);

  useEffect(() => debugLog.subscribe(refresh), [refresh]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setShowHistoryPanel(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* copy report — must be before any early return (Rules of Hooks) */
  const handleCopy = useCallback(() => {
    const report = debugLog.generateReport();
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [setCopied]);

  const handleCopyN = useCallback((limit: number | null) => {
    const report = debugLog.generateReport(limit ?? undefined);
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setShowHistoryPanel(false);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const [copiedSummary, setCopiedSummary] = React.useState(false);
  const handleCopySummary = useCallback(() => {
    const summary = typeof debugLog.generateSummary === "function"
      ? debugLog.generateSummary()
      : debugLog.generateReport();
    navigator.clipboard.writeText(summary).then(() => {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    });
  }, []);

  type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  const makeResizeHandler = useCallback((dir: ResizeDir) => (e: React.MouseEvent) => {    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const { w: startW, h: startH } = sizeRef.current;
    const { x: startPX, y: startPY } = posRef.current;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let newW = startW, newH = startH, newX = startPX, newY = startPY;
      if (dir === 'e' || dir === 'se' || dir === 'ne') newW = Math.max(280, startW + dx);
      if (dir === 'w' || dir === 'sw' || dir === 'nw') {
        newW = Math.max(280, startW - dx);
        newX = startPX + startW - newW;
      }
      if (dir === 's' || dir === 'se' || dir === 'sw') newH = Math.max(150, startH + dy);
      if (dir === 'n' || dir === 'ne' || dir === 'nw') {
        newH = Math.max(150, startH - dy);
        newY = startPY + startH - newH;
      }
      const nextSize = { w: newW, h: newH };
      const nextPos  = { x: newX,  y: newY };
      setSize(nextSize); setPos(nextPos);
      sizeRef.current = nextSize; posRef.current = nextPos;
    };
    const onUp = () => {
      localStorage.setItem("pashash:pm:size", JSON.stringify(sizeRef.current));
      localStorage.setItem("pashash:pm:pos",  JSON.stringify(posRef.current));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  /* drag panel by header */
  const makeDragHandler = useCallback(() => (e: React.MouseEvent) => {
    e.preventDefault();
    const offX = e.clientX - posRef.current.x;
    const offY = e.clientY - posRef.current.y;
    const onMove = (ev: MouseEvent) => {
      const nextPos = {
        x: Math.max(0, Math.min(window.innerWidth  - 80, ev.clientX - offX)),
        y: Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - offY)),
      };
      setPos(nextPos);
      posRef.current = nextPos;
    };
    const onUp = () => {
      localStorage.setItem("pashash:pm:pos", JSON.stringify(posRef.current));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  /* drag pill — click if no significant movement */
  const makePillDragOrClick = useCallback((onClick: () => void) => (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...posRef.current };
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      moved = true;
      const nextPos = {
        x: Math.max(0, Math.min(window.innerWidth  - 80, startPos.x + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, startPos.y + dy)),
      };
      setPos(nextPos);
      posRef.current = nextPos;
    };
    const onUp = () => {
      if (moved) localStorage.setItem("pashash:pm:pos", JSON.stringify(posRef.current));
      else onClick();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const theme = PM_THEMES.find(t => t.id === themeId) ?? PM_THEMES[0];
  if (!isAdmin) return null;

  const all = entriesRef.current;
  const byLevel = filter === "all" ? all : all.filter((e) => e.level === filter);
  const visible = traceFilter ? byLevel.filter((e) => e.traceId === traceFilter) : byLevel;

  const errorCount    = all.filter((e) => e.level === "error").length;
  const warnCount     = all.filter((e) => e.level === "warn").length;
  const longtaskCount = all.filter((e) => e.level === "longtask").length;
  const hasAlerts     = errorCount > 0 || longtaskCount > 0;

  const slowestMs = all.length
    ? Math.max(...all.slice(0, 80).map((e) => e.durationMs ?? 0))
    : 0;

  const { score: healthScore } = typeof debugLog.computeHealthScore === "function"
    ? debugLog.computeHealthScore()
    : { score: 100 };
  const pipelineStages = typeof debugLog.getPipelineStages === "function"
    ? debugLog.getPipelineStages()
    : [];
  const recentBlocks = typeof debugLog.getRecentBlocks === "function"
    ? debugLog.getRecentBlocks()
    : [];
  const n1Patterns = typeof debugLog.detectN1Patterns === "function"
    ? debugLog.detectN1Patterns()
    : [];
  const smartAlerts = typeof debugLog.getSmartAlerts === "function"
    ? debugLog.getSmartAlerts()
    : [];
  const inp = debugLog.inp;
  const cls = debugLog.cls;
  const ttfb = debugLog.ttfb;

  const inpColor = inp >= 500 ? "text-red-400" : inp >= 200 ? "text-orange-400" : "text-emerald-400";
  const clsColor = cls >= 0.25 ? "text-red-400" : cls >= 0.1 ? "text-orange-400" : "text-emerald-400";

  /* ── collapsed pill ── */
  if (!open) {
    if (!debugLog.active) {
      return (
        <div
          onMouseDown={makePillDragOrClick(() => { debugLog.enable(); setOpen(true); })}
          title="גרור להזזה | לחץ להפעלה"
          className="fixed z-[9999] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full shadow-lg text-[11px] font-mono font-semibold cursor-grab active:cursor-grabbing select-none bg-zinc-900 border border-zinc-700 hover:border-emerald-500 text-zinc-500 hover:text-emerald-300"
          style={{ left: pos.x, top: pos.y }}
        >
          <Power className="h-3.5 w-3.5" />
          <span>Debug</span>
        </div>
      );
    }
    return (
      <div
        onMouseDown={makePillDragOrClick(() => setOpen(true))}
        title="גרור להזזה | לחץ לפתיחה"
        className={cn(
          "fixed z-[9999] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full shadow-lg text-[11px] font-mono font-semibold cursor-grab active:cursor-grabbing select-none transition-colors",
          "bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-zinc-200",
          hasAlerts && "border-red-500/70 animate-pulse",
        )}
        style={{ left: pos.x, top: pos.y }}
      >
        <Activity className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <FpsPill fps={fpsRef.current} />
        {errorCount > 0 && (
          <span className="bg-red-600 text-white text-[9px] font-bold rounded-full px-1.5">{errorCount}!</span>
        )}
        {slowestMs > 0 && (
          <span className={cn("text-[10px]", slowestMs >= 1000 ? "text-red-400" : slowestMs >= 300 ? "text-orange-400" : "text-zinc-400")}>
            {fmtDur(slowestMs)}
          </span>
        )}
        <HealthBadge score={healthScore} />
        {inp > 0 && (
          <span className={cn("text-[10px] tabular-nums", inpColor)} title="INP (Interaction to Next Paint)">
            INP:{inp}ms
          </span>
        )}
      </div>
    );
  }

  /* ── expanded panel ── */
  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: "all",      label: "All" },
    { key: "perf",     label: "Perf" },
    { key: "error",    label: "Error" },
    { key: "warn",     label: "Warn" },
    { key: "longtask", label: "Block" },
    { key: "log",      label: "Log" },
  ];

  return (
    <div
      dir="ltr"
      className="fixed z-[9999] font-mono"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* ── Resize handles — all 4 edges + 4 corners ── */}
      <div onMouseDown={makeResizeHandler('e')}  className="absolute top-4 bottom-4 -right-1 w-2.5 cursor-ew-resize z-20 hover:bg-zinc-400/20 rounded-full transition-colors" title="גרור ימינה להרחבה" />
      <div onMouseDown={makeResizeHandler('w')}  className="absolute top-4 bottom-4 -left-1  w-2.5 cursor-ew-resize z-20 hover:bg-zinc-400/20 rounded-full transition-colors" title="גרור שמאלה להרחבה" />
      <div onMouseDown={makeResizeHandler('s')}  className="absolute left-4 right-4 -bottom-1 h-2.5 cursor-ns-resize z-20 hover:bg-zinc-400/20 rounded-full transition-colors" title="גרור למטה להרחבה" />
      <div onMouseDown={makeResizeHandler('n')}  className="absolute left-4 right-4 -top-1   h-2.5 cursor-ns-resize z-20 hover:bg-zinc-400/20 rounded-full transition-colors" title="גרור למעלה להרחבה" />
      <div onMouseDown={makeResizeHandler('se')} className="absolute -bottom-1 -right-1 w-4 h-4 cursor-se-resize z-30" />
      <div onMouseDown={makeResizeHandler('sw')} className="absolute -bottom-1 -left-1  w-4 h-4 cursor-sw-resize z-30" />
      <div onMouseDown={makeResizeHandler('ne')} className="absolute -top-1    -right-1 w-4 h-4 cursor-ne-resize z-30" />
      <div onMouseDown={makeResizeHandler('nw')} className="absolute -top-1    -left-1  w-4 h-4 cursor-nw-resize z-30" />
      <div className={cn("flex flex-col rounded-xl shadow-2xl border overflow-hidden w-full h-full", theme.panel)}>
      {/* ── header ── */}
      <div className={cn("flex items-center gap-2 px-3 py-1.5 border-b shrink-0", theme.bar)}>
        {/* drag handle */}
        <div
          onMouseDown={makeDragHandler()}
          className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing select-none shrink-0 pr-1"
          title="גרור להזזת הפאנל"
        >
          <Activity className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <span className="text-[11px] font-bold text-zinc-100">Debug Log</span>
        </div>
        <FpsPill fps={fpsRef.current} />
        <Sparkline
          data={debugLog.fpsHistory}
          color={fpsRef.current >= 50 ? "#34d399" : fpsRef.current >= 30 ? "#fb923c" : "#f87171"}
        />
        {memRef.current !== null && (
          <>
            <span className="text-[10px] text-sky-300">{memRef.current}MB</span>
            <Sparkline data={debugLog.memHistory} color="#38bdf8" />
          </>
        )}
        {errorCount > 0 && (
          <span className="text-[10px] text-red-400 font-bold">{errorCount} errors</span>
        )}
        {warnCount > 0 && (
          <span className="text-[10px] text-yellow-400">{warnCount} warns</span>
        )}
        {longtaskCount > 0 && (
          <span className="text-[10px] text-orange-400">{longtaskCount} blocks</span>
        )}
        <HealthBadge score={healthScore} />
        {inp > 0 && (
          <span className={cn("text-[10px] tabular-nums", inpColor)} title="INP">
            INP:{inp}ms
          </span>
        )}
        {cls > 0 && (
          <span className={cn("text-[10px] tabular-nums", clsColor)} title="CLS">
            CLS:{cls.toFixed(3)}
          </span>
        )}
        {ttfb !== null && (
          <span className={cn("text-[10px] tabular-nums", ttfb >= 800 ? "text-red-400" : ttfb >= 200 ? "text-orange-400" : "text-sky-300")} title="TTFB">
            TTFB:{ttfb}ms
          </span>
        )}
        {traceFilter && (
          <button
            onClick={() => setTraceFilter(null)}
            title="נקה סינון Trace"
            className="text-[10px] px-2 py-0.5 rounded border border-cyan-500/60 text-cyan-300 hover:text-cyan-200"
          >
            trace:{traceFilter.slice(-6)} x
          </button>
        )}
        <div className="flex-1" />

        {/* copy summary button */}
        <button
          onClick={handleCopySummary}
          title="העתק סיכום (ללא שורות לוג)"
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-all",
            copiedSummary
              ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
              : "border-zinc-600 hover:border-zinc-400 text-zinc-300 hover:text-white",
          )}
        >
          {copiedSummary ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copiedSummary ? "הועתק!" : "סיכום"}
        </button>

        {/* copy report button */}
        <button
          onClick={handleCopy}
          title="העתק לוג מלא לשליחה ל-Copilot"
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-all",
            copied
              ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
              : "border-zinc-600 hover:border-zinc-400 text-zinc-300 hover:text-white",
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "הועתק!" : "העתק לוגים"}
        </button>

        {/* history / copy-depth button */}
        <div className="relative">
          <button
            onClick={() => setShowHistoryPanel((v) => !v)}
            title={`היסטוריה — מציג ${displayLimit} / ${all.length} ערכים. לחץ לבחור כמה להעתיק`}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
              showHistoryPanel
                ? "border-cyan-500 bg-cyan-500/20 text-cyan-200"
                : "border-zinc-600 hover:border-zinc-400 text-zinc-400 hover:text-white",
            )}
          >
            <Clock className="h-3 w-3" />
            <span className="tabular-nums">{displayLimit}/{all.length}</span>
          </button>
          {showHistoryPanel && (
            <div
              className={cn("absolute bottom-full right-0 mb-1.5 rounded-xl border shadow-2xl p-2.5 z-50 min-w-[200px]", theme.panel)}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[10px] font-bold text-zinc-300 mb-1 px-0.5">היסטוריה</div>
              <div className="text-[9px] text-zinc-500 mb-2 px-0.5">סה״כ {all.length} ערכים בזיכרון (max 5000)</div>
              <div className="text-[9px] text-zinc-500 mb-1.5 px-0.5">הצג / העתק:</div>
              {([100, 250, 500, 1000, null] as (number | null)[]).map((n) => {
                const label = n === null ? `הכל (${all.length})` : `${n} ערכים`;
                const isActive = displayLimit === (n ?? all.length);
                return (
                  <div key={String(n)} className="flex gap-1 mb-1">
                    <button
                      onClick={() => setDisplayLimit(n ?? all.length)}
                      className={cn(
                        "flex-1 px-2 py-0.5 rounded text-[10px] border text-left transition-all",
                        isActive
                          ? "border-cyan-500 bg-cyan-500/20 text-cyan-200 font-semibold"
                          : "border-zinc-700 hover:border-zinc-500 text-zinc-300",
                      )}
                    >
                      {isActive ? "✓ " : ""}{label}
                    </button>
                    <button
                      onClick={() => handleCopyN(n)}
                      title={`העתק ${label} לקלמנסט`}
                      className="px-2 py-0.5 rounded text-[10px] border border-zinc-700 hover:border-emerald-500 text-zinc-400 hover:text-emerald-300 transition-all flex items-center"
                    >
                      <Copy className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => { debugLog.disable(); setOpen(false); }}
          title="כבה מנטר (שחרר משאבים)"
          className="flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-700 hover:border-orange-500 text-zinc-500 hover:text-orange-300 hover:bg-orange-900/20 text-[10px] font-semibold transition-all"
        >
          <Power className="h-3.5 w-3.5" />
          <span>כבה</span>
        </button>
        <button
          onClick={() => debugLog.clearEntries()}
          title="נקה"
          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setOpen(false)}
          title="סגור (Esc)"
          className="flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-600 hover:border-red-400 text-zinc-400 hover:text-red-300 hover:bg-red-900/30 text-[10px] font-semibold transition-all"
        >
          <X className="h-3.5 w-3.5" />
          <span>סגור</span>
        </button>
      </div>

      {/* ── filter chips ── */}
      <div className={cn("flex items-center gap-1 px-3 py-1 border-b shrink-0 overflow-x-auto", theme.bar)}>
        {FILTERS.map(({ key, label }) => {
          const cnt =
            key === "all" ? all.length : all.filter((e) => e.level === key).length;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "px-2 py-0.5 rounded-full border text-[10px] whitespace-nowrap transition-all",
                filter === key ? theme.chipActive : theme.chip,
                key === "error"    && cnt > 0 && filter !== key && "border-red-500/60 text-red-400",
                key === "longtask" && cnt > 0 && filter !== key && "border-orange-500/60 text-orange-400",
              )}
            >
              {label}
              {cnt > 0 && <span className="ml-1 opacity-70">{cnt}</span>}
            </button>
          );
        })}
        <div className="flex-1 shrink-0" />
        <button
          onClick={() => {
            const idx = PM_THEMES.findIndex(t => t.id === themeId);
            const next = PM_THEMES[(idx + 1) % PM_THEMES.length];
            setThemeId(next.id);
            localStorage.setItem("pashash:pm:theme", next.id);
          }}
          title={`ערכת נושא: ${theme.label} — לחץ להחלפה`}
          className={cn("px-1.5 py-0.5 rounded border text-[11px] shrink-0 transition-all", theme.chip)}
        >
          {theme.icon}
        </button>
      </div>

      {/* ── smart alerts ── */}
      <SmartAlertsBar alerts={smartAlerts} theme={theme} />

      {/* ── pipeline card ── */}
      <PipelineCard stages={pipelineStages} theme={theme} />

      {/* ── N+1 card ── */}
      <N1Card patterns={n1Patterns} theme={theme} />

      {/* ── blocks card ── */}
      <BlocksCard blocks={recentBlocks} theme={theme} />

      {/* ── log entries ── */}
      <div className="overflow-y-auto flex-1 text-[10px] leading-tight">
        {visible.length === 0 ? (
          <p className="text-zinc-600 text-center py-8">
            {all.length === 0
              ? "אין לוגים עדיין — הפעל פעולה כדי לראות"
              : "אין תוצאות לסינון זה"}
          </p>
        ) : (
          <table className="w-full border-collapse table-fixed">
            <colgroup>
              <col style={{ width: colWidths.time }} />
              <col style={{ width: colWidths.type }} />
              <col style={{ width: colWidths.cat }} />
              <col style={{ width: colWidths.trace }} />
              <col style={{ width: colWidths.label }} />
              <col style={{ width: colWidths.detail }} />
              <col style={{ width: colWidths.dur }} />
            </colgroup>
            <thead className={cn("sticky top-0 text-[9px] uppercase tracking-wide", theme.thead)}>
              <tr>
                <ResizableTh label="Time"   colKey="time"   onStart={startColResize} className="px-2 py-0.5 text-left" />
                <ResizableTh label="Type"   colKey="type"   onStart={startColResize} className="px-1 py-0.5 text-left" />
                <ResizableTh label="Cat"    colKey="cat"    onStart={startColResize} className="px-1 py-0.5 text-left" />
                <ResizableTh label="Trace"  colKey="trace"  onStart={startColResize} className="px-1 py-0.5 text-left" />
                <ResizableTh label="Label"  colKey="label"  onStart={startColResize} className="px-2 py-0.5 text-left" />
                <ResizableTh label="Detail" colKey="detail" onStart={startColResize} className="px-1 py-0.5 text-left" />
                <ResizableTh label="Dur"    colKey="dur"    onStart={startColResize} className="px-2 py-0.5 text-right" />
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, displayLimit).map((e) => (
                <tr
                  key={e.id}
                  className={cn(
                    "border-b",
                    theme.row,
                    rowBg(e),
                  )}
                >
                  {/* time */}
                  <td className="px-2 py-0.5 text-zinc-300 tabular-nums whitespace-nowrap font-medium">
                    {fmtTime(e.ts)}
                  </td>
                  {/* level badge */}
                  <td className="px-1 py-0.5 whitespace-nowrap">
                    <span className={cn("px-1 py-px rounded text-[9px] font-bold", levelBadge[e.level])}>
                      {levelLabel[e.level]}
                    </span>
                  </td>
                  {/* category */}
                  <td className="px-1 py-0.5 text-zinc-400 whitespace-nowrap">
                    {catLabel[e.category]}
                  </td>
                  {/* trace */}
                  <td className="px-1 py-0.5 whitespace-nowrap">
                    {e.traceId ? (
                      <button
                        onClick={() => setTraceFilter(e.traceId ?? null)}
                        title={`Filter by trace ${e.traceId}`}
                        className={cn(
                          "rounded px-1 text-[9px] font-semibold",
                          traceFilter === e.traceId
                            ? "bg-cyan-600/30 text-cyan-200"
                            : "text-cyan-300 hover:bg-cyan-500/20",
                        )}
                      >
                        {e.traceId.slice(-6)}
                      </button>
                    ) : (
                      <span className="text-zinc-500">-</span>
                    )}
                  </td>
                  {/* label */}
                  <td className="px-2 py-0.5 overflow-hidden">
                    <span
                      className={cn(
                        "block truncate",
                        e.level === "error" ? "text-red-300" :
                        e.level === "warn"  ? "text-yellow-300" :
                        "text-zinc-200",
                      )}
                      title={e.label}
                    >
                      {e.label}
                    </span>
                  </td>
                  {/* detail */}
                  <td className="px-1 py-0.5 overflow-hidden">
                    {e.detail && (
                      <span className="block truncate text-zinc-300" title={e.detail}>
                        {e.detail}
                      </span>
                    )}
                  </td>
                  {/* duration */}
                  <td className={cn(
                    "px-2 py-0.5 text-right tabular-nums whitespace-nowrap",
                    e.durationMs !== undefined ? durColor(e.durationMs, e.level) : "text-zinc-500",
                  )}>
                    {e.durationMs !== undefined ? fmtDur(e.durationMs) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── footer ── */}
      {/* ── footer ── */}
      <div className={cn("px-3 py-1 border-t shrink-0 flex justify-between text-[10px]", theme.bar)}>
        <span>
          {visible.length > displayLimit
            ? `מציג ${displayLimit} / ${visible.length} (${all.length} סה״כ)`
            : `${visible.length} ערכים (${all.length} סה״כ, max 5000)`}
        </span>
        <span>
          {hasAlerts
            ? `⚠ ${errorCount > 0 ? `${errorCount} errors` : ""}${errorCount > 0 && longtaskCount > 0 ? ", " : ""}${longtaskCount > 0 ? `${longtaskCount} JS blocks` : ""}`
            : "No errors / JS blocks"}
        </span>
      </div>
      </div>
    </div>
  );
}

