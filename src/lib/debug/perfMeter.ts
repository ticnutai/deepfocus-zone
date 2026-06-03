/**
 * Lightweight performance meter — measures real-world impact of optimizations.
 *
 * Two metrics:
 *   1. notifies — how many times the study store called listeners (post-batching).
 *   2. renders  — per-component render counts (opt-in via useRenderCounter).
 *
 * Open browser console and run `__perf()` to print a table, or `__perf("reset")`.
 *
 * Total renders avoided by rAF batching is approximated as:
 *     rawMutations - notifies
 *   (every coalesced mutation would otherwise have notified every subscriber).
 */

import { useEffect, useRef } from "react";

type Counters = {
  rawMutations: number;
  notifies: number;
  renders: Map<string, number>;
  startedAt: number;
};

const c: Counters = {
  rawMutations: 0,
  notifies: 0,
  renders: new Map(),
  startedAt: Date.now(),
};

export const perfMeter = {
  bumpMutation() { c.rawMutations += 1; },
  bumpNotify(subscriberCount: number) {
    c.notifies += 1;
    // Each notify fires N subscriber callbacks → use to estimate render budget
    if (!c.renders.has("__subscribers")) c.renders.set("__subscribers", 0);
    c.renders.set("__subscribers", (c.renders.get("__subscribers") ?? 0) + subscriberCount);
  },
  bumpRender(name: string) {
    c.renders.set(name, (c.renders.get(name) ?? 0) + 1);
  },
  reset() {
    c.rawMutations = 0;
    c.notifies = 0;
    c.renders.clear();
    c.startedAt = Date.now();
  },
  report() {
    const seconds = Math.max(1, (Date.now() - c.startedAt) / 1000);
    const coalesced = Math.max(0, c.rawMutations - c.notifies);
    const summary = {
      uptime_s: Math.round(seconds),
      rawMutations: c.rawMutations,
      notifies: c.notifies,
      coalesced,
      coalesceRatio: c.rawMutations ? `${Math.round((coalesced / c.rawMutations) * 100)}%` : "n/a",
      subscriberCallbacks: c.renders.get("__subscribers") ?? 0,
    };
    const renderRows = [...c.renders.entries()]
      .filter(([k]) => k !== "__subscribers")
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ component: name, renders: count, perSec: +(count / seconds).toFixed(2) }));
    /* eslint-disable no-console */
    console.group("%c[perfMeter] summary", "color:#d4af37;font-weight:bold");
    console.table(summary);
    if (renderRows.length) {
      console.log("Renders by component (opt-in via useRenderCounter):");
      console.table(renderRows);
    }
    console.groupEnd();
    /* eslint-enable no-console */
    return { summary, renders: renderRows };
  },
};

if (typeof window !== "undefined") {
  (window as unknown as { __perf: (action?: "reset") => unknown }).__perf = (action) => {
    if (action === "reset") { perfMeter.reset(); return "reset"; }
    return perfMeter.report();
  };
}

/** Opt-in render counter for a component. */
export function useRenderCounter(name: string) {
  const ref = useRef(0);
  ref.current += 1;
  useEffect(() => {
    perfMeter.bumpRender(name);
  });
}
