import type { PracticeResult } from "./types";

export function calculatePracticeTrend(results: PracticeResult[]) {
  const ordered = [...results].sort((a, b) => b.completedAt - a.completedAt);
  if (ordered.length < 2) return { delta: null, label: "נדרש ניסיון נוסף" };
  const recent = ordered.slice(0, 3);
  const prior = ordered.slice(3, 6);
  const average = (items: PracticeResult[]) => items.reduce((sum, item) => sum + item.score, 0) / items.length;
  const delta = prior.length ? average(recent) - average(prior) : ordered[0].score - ordered[1].score;
  return { delta, label: Math.abs(delta) < 5 ? "יציב" : delta > 0 ? "שיפור" : "נסיגה" };
}
