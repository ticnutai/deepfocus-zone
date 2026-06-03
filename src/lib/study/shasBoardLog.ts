/**
 * Helpers for logging daily Shas Board progress and analyzing pace.
 * Log shape: Record<YYYY-MM-DD, number> — how many amudim were marked-as-learned that day.
 */
import type { UiPrefs } from "./types";

export type ShasBoardLog = Record<string, number>;

export const todayKey = (d = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export function countTotalLearned(
  progress: NonNullable<UiPrefs["shasBoardProgress"]>,
): number {
  let total = 0;
  for (const masechta of Object.values(progress)) {
    for (const entry of Object.values(masechta)) {
      if ((entry.a ?? 0) > 0) total++;
      if ((entry.b ?? 0) > 0) total++;
    }
  }
  return total;
}

export function logDelta(log: ShasBoardLog, delta: number, dateKey = todayKey()): ShasBoardLog {
  if (delta <= 0) return log;
  return { ...log, [dateKey]: (log[dateKey] ?? 0) + delta };
}

export interface PaceStats {
  /** Average amudim/day across the analysis window */
  avgPerDay: number;
  /** Median amudim/day across active days */
  medianActive: number;
  /** Active days (days with > 0) in window */
  activeDays: number;
  /** Total amudim in window */
  totalInWindow: number;
  /** Best day in window */
  bestDay: number;
  /** Current consecutive-day streak ending today */
  streak: number;
}

export function computePace(log: ShasBoardLog, windowDays: number): PaceStats {
  const now = new Date();
  const days: number[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(log[todayKey(d)] ?? 0);
  }
  const total = days.reduce((a, b) => a + b, 0);
  const active = days.filter((v) => v > 0).sort((a, b) => a - b);
  const median = active.length === 0 ? 0
    : active.length % 2 === 1
      ? active[(active.length - 1) >> 1]
      : (active[active.length / 2 - 1] + active[active.length / 2]) / 2;
  let streak = 0;
  for (const v of days) {
    if (v > 0) streak++; else break;
  }
  return {
    avgPerDay: total / windowDays,
    medianActive: median,
    activeDays: active.length,
    totalInWindow: total,
    bestDay: active.length ? active[active.length - 1] : 0,
    streak,
  };
}

export function estimateFinishDate(remaining: number, perDay: number, from = new Date()): Date | null {
  if (perDay <= 0 || remaining <= 0) return null;
  const days = Math.ceil(remaining / perDay);
  const out = new Date(from);
  out.setDate(out.getDate() + days);
  return out;
}
