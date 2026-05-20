/**
 * Passive UI timing collector.
 *
 * Key components call `uiTimings.record(slot, ms)` at render milestones
 * (e.g. after navigation, after search filter, on mount).
 * PerformancePage reads `uiTimings.snapshot()` to display accumulated data.
 *
 * Slots used by CategoryExplorerView:
 *   "cat:mount"  — first render time of the explorer
 *   "cat:nav"    — time from navigateTo() call to DOM update
 *   "cat:search" — time from search-input change to folders DOM update
 */

const MAX_SAMPLES = 12;

const _slots = new Map<string, number[]>();

export const uiTimings = {
  /** Record one timing sample for `slot`. Keeps the last MAX_SAMPLES values. */
  record(slot: string, ms: number): void {
    const arr = _slots.get(slot) ?? [];
    arr.push(Math.round(ms));
    if (arr.length > MAX_SAMPLES) arr.shift();
    _slots.set(slot, arr);
  },

  /** Latest recorded value for a slot (or undefined if none). */
  getLast(slot: string): number | undefined {
    const arr = _slots.get(slot);
    return arr?.[arr.length - 1];
  },

  /** Average of all samples for a slot (or undefined). */
  getAvg(slot: string): number | undefined {
    const arr = _slots.get(slot);
    if (!arr?.length) return undefined;
    return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
  },

  /** Snapshot of all slots: { [slot]: { last, avg, samples } } */
  snapshot(): Record<string, { last: number; avg: number; samples: number[] }> {
    const out: Record<string, { last: number; avg: number; samples: number[] }> = {};
    for (const [slot, arr] of _slots) {
      if (!arr.length) continue;
      out[slot] = {
        last: arr[arr.length - 1],
        avg: Math.round(arr.reduce((s, v) => s + v, 0) / arr.length),
        samples: [...arr],
      };
    }
    return out;
  },

  /** Remove all accumulated timings. */
  clear(): void {
    _slots.clear();
  },
};
