import type { Card, ReviewLog, StudyState } from "./types";

export type RangePreset = "7" | "30" | "90" | "all" | "custom";

export interface AnalyticsRange {
  preset: RangePreset;
  from: number; // ms
  to: number;   // ms
}

export function computeRange(preset: RangePreset, customFrom?: Date, customTo?: Date): AnalyticsRange {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  if (preset === "custom" && customFrom && customTo) {
    const f = new Date(customFrom); f.setHours(0, 0, 0, 0);
    const t = new Date(customTo); t.setHours(23, 59, 59, 999);
    return { preset, from: f.getTime(), to: t.getTime() };
  }
  if (preset === "all") return { preset, from: 0, to: to.getTime() };
  const days = preset === "7" ? 7 : preset === "30" ? 30 : 90;
  const from = new Date(now);
  from.setDate(from.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);
  return { preset, from: from.getTime(), to: to.getTime() };
}

export function filterLogs(state: StudyState, range: AnalyticsRange, deckId?: string): ReviewLog[] {
  return state.logs.filter((l) =>
    l.at >= range.from && l.at <= range.to && (!deckId || l.deckId === deckId)
  );
}

// === Hour-of-day analysis ===
// Buckets: 0-5 לילה, 6-11 בוקר, 12-17 צהריים, 18-23 ערב
export interface HourBucket {
  hour: number;
  total: number;
  correct: number;
  accuracy: number;
  avgDurationMs: number;
}

export function byHour(logs: ReviewLog[]): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h, total: 0, correct: 0, accuracy: 0, avgDurationMs: 0,
  }));
  const sumDur = new Array(24).fill(0);
  logs.forEach((l) => {
    const h = new Date(l.at).getHours();
    buckets[h].total += 1;
    if (l.correct) buckets[h].correct += 1;
    sumDur[h] += l.durationMs;
  });
  buckets.forEach((b, i) => {
    b.accuracy = b.total ? Math.round((b.correct / b.total) * 100) : 0;
    b.avgDurationMs = b.total ? Math.round(sumDur[i] / b.total) : 0;
  });
  return buckets;
}

export type DayPart = "night" | "morning" | "noon" | "evening";
export const DAY_PARTS: Record<DayPart, { label: string; range: [number, number] }> = {
  night:   { label: "לילה (00-05)",   range: [0, 5] },
  morning: { label: "בוקר (06-11)",   range: [6, 11] },
  noon:    { label: "צהריים (12-17)", range: [12, 17] },
  evening: { label: "ערב (18-23)",    range: [18, 23] },
};

export function byDayPart(logs: ReviewLog[]) {
  const out: Record<DayPart, { total: number; correct: number; accuracy: number }> = {
    night: { total: 0, correct: 0, accuracy: 0 },
    morning: { total: 0, correct: 0, accuracy: 0 },
    noon: { total: 0, correct: 0, accuracy: 0 },
    evening: { total: 0, correct: 0, accuracy: 0 },
  };
  logs.forEach((l) => {
    const h = new Date(l.at).getHours();
    const part: DayPart = h <= 5 ? "night" : h <= 11 ? "morning" : h <= 17 ? "noon" : "evening";
    out[part].total += 1;
    if (l.correct) out[part].correct += 1;
  });
  (Object.keys(out) as DayPart[]).forEach((k) => {
    out[k].accuracy = out[k].total ? Math.round((out[k].correct / out[k].total) * 100) : 0;
  });
  return out;
}

// === Day-of-week analysis ===
export const HEB_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function byWeekday(logs: ReviewLog[]) {
  const arr = Array.from({ length: 7 }, (_, i) => ({
    weekday: i, label: HEB_WEEKDAYS[i], total: 0, correct: 0, accuracy: 0,
  }));
  logs.forEach((l) => {
    const w = new Date(l.at).getDay();
    arr[w].total += 1;
    if (l.correct) arr[w].correct += 1;
  });
  arr.forEach((b) => {
    b.accuracy = b.total ? Math.round((b.correct / b.total) * 100) : 0;
  });
  return arr;
}

// === Trend (daily) ===
function dayKey(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export interface TrendPoint {
  date: number;
  label: string;
  total: number;
  accuracy: number;
}

export function trendByDay(logs: ReviewLog[], range: AnalyticsRange): TrendPoint[] {
  const map = new Map<number, { total: number; correct: number }>();
  logs.forEach((l) => {
    const k = dayKey(new Date(l.at));
    const cur = map.get(k) ?? { total: 0, correct: 0 };
    cur.total += 1;
    if (l.correct) cur.correct += 1;
    map.set(k, cur);
  });
  const points: TrendPoint[] = [];
  const start = new Date(range.from); start.setHours(0, 0, 0, 0);
  const end = new Date(range.to); end.setHours(0, 0, 0, 0);
  const maxDays = Math.min(120, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  for (let i = 0; i < maxDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const k = dayKey(d);
    const v = map.get(k) ?? { total: 0, correct: 0 };
    points.push({
      date: k,
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      total: v.total,
      accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    });
  }
  return points;
}

// === Period comparison ===
export interface PeriodCompare {
  current: { total: number; accuracy: number };
  previous: { total: number; accuracy: number };
  totalDelta: number;     // percentage change
  accuracyDelta: number;  // percentage points
}

export function comparePrevious(state: StudyState, range: AnalyticsRange, deckId?: string): PeriodCompare {
  const span = range.to - range.from;
  const prevRange: AnalyticsRange = { preset: "custom", from: range.from - span, to: range.from - 1 };
  const cur = filterLogs(state, range, deckId);
  const prev = filterLogs(state, prevRange, deckId);
  const curCorrect = cur.filter((l) => l.correct).length;
  const prevCorrect = prev.filter((l) => l.correct).length;
  const curAcc = cur.length ? Math.round((curCorrect / cur.length) * 100) : 0;
  const prevAcc = prev.length ? Math.round((prevCorrect / prev.length) * 100) : 0;
  const totalDelta = prev.length ? Math.round(((cur.length - prev.length) / prev.length) * 100) : 0;
  return {
    current: { total: cur.length, accuracy: curAcc },
    previous: { total: prev.length, accuracy: prevAcc },
    totalDelta,
    accuracyDelta: curAcc - prevAcc,
  };
}

// === Hardest cards / tags / decks ===
export interface CardDifficulty {
  cardId: string;
  question: string;
  deckId: string | null;
  total: number;
  correct: number;
  accuracy: number;
  avgDurationMs: number;
}

export function hardestCards(state: StudyState, logs: ReviewLog[], minReviews = 3, limit = 10): CardDifficulty[] {
  const map = new Map<string, { total: number; correct: number; dur: number }>();
  logs.forEach((l) => {
    const cur = map.get(l.cardId) ?? { total: 0, correct: 0, dur: 0 };
    cur.total += 1;
    if (l.correct) cur.correct += 1;
    cur.dur += l.durationMs;
    map.set(l.cardId, cur);
  });
  const out: CardDifficulty[] = [];
  map.forEach((v, cardId) => {
    if (v.total < minReviews) return;
    const card = state.cards.find((c) => c.id === cardId);
    if (!card) return;
    out.push({
      cardId,
      question: card.question,
      deckId: card.deckId,
      total: v.total,
      correct: v.correct,
      accuracy: Math.round((v.correct / v.total) * 100),
      avgDurationMs: Math.round(v.dur / v.total),
    });
  });
  return out.sort((a, b) => a.accuracy - b.accuracy || b.total - a.total).slice(0, limit);
}

export interface GroupAccuracy {
  key: string;
  label: string;
  total: number;
  correct: number;
  accuracy: number;
}

export function byTag(state: StudyState, logs: ReviewLog[]): GroupAccuracy[] {
  const cardMap = new Map(state.cards.map((c) => [c.id, c]));
  const map = new Map<string, { total: number; correct: number }>();
  logs.forEach((l) => {
    const card = cardMap.get(l.cardId);
    if (!card) return;
    const tags = card.tags.length ? card.tags : ["(ללא תגית)"];
    tags.forEach((t) => {
      const cur = map.get(t) ?? { total: 0, correct: 0 };
      cur.total += 1;
      if (l.correct) cur.correct += 1;
      map.set(t, cur);
    });
  });
  const out: GroupAccuracy[] = [];
  map.forEach((v, key) => {
    out.push({
      key, label: key.replace(/^cat:/, ""),
      total: v.total, correct: v.correct,
      accuracy: Math.round((v.correct / v.total) * 100),
    });
  });
  return out.sort((a, b) => b.total - a.total);
}

export function byDeck(state: StudyState, logs: ReviewLog[]): GroupAccuracy[] {
  const map = new Map<string, { total: number; correct: number }>();
  logs.forEach((l) => {
    const key = l.deckId ?? "__none__";
    const cur = map.get(key) ?? { total: 0, correct: 0 };
    cur.total += 1;
    if (l.correct) cur.correct += 1;
    map.set(key, cur);
  });
  const out: GroupAccuracy[] = [];
  map.forEach((v, key) => {
    if (key === "__none__") return; // skip category-only cards from deck chart
    const deck = state.decks.find((d) => d.id === key);
    out.push({
      key, label: deck?.name ?? "(נמחק)",
      total: v.total, correct: v.correct,
      accuracy: Math.round((v.correct / v.total) * 100),
    });
  });
  return out.sort((a, b) => b.total - a.total);
}

// === Auto insights ===
export interface Insight {
  id: string;
  kind: "positive" | "warning" | "info";
  title: string;
  detail: string;
}

export function generateInsights(state: StudyState, range: AnalyticsRange, deckId?: string): Insight[] {
  const logs = filterLogs(state, range, deckId);
  const insights: Insight[] = [];
  if (logs.length < 5) {
    insights.push({
      id: "low-data", kind: "info",
      title: "מעט נתונים בטווח הנבחר",
      detail: "נסה להרחיב את הטווח או להמשיך לתרגל כדי לקבל תובנות מדויקות יותר.",
    });
    return insights;
  }

  // Best/worst day-part
  const dp = byDayPart(logs);
  const dpEntries = (Object.entries(dp) as [DayPart, typeof dp.morning][])
    .filter(([, v]) => v.total >= 3);
  if (dpEntries.length >= 2) {
    const sorted = [...dpEntries].sort((a, b) => b[1].accuracy - a[1].accuracy);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    if (best[1].accuracy - worst[1].accuracy >= 10) {
      insights.push({
        id: "daypart",
        kind: "positive",
        title: `הכי חזק ב${DAY_PARTS[best[0]].label}`,
        detail: `${best[1].accuracy}% הצלחה ב${DAY_PARTS[best[0]].label} לעומת ${worst[1].accuracy}% ב${DAY_PARTS[worst[0]].label}.`,
      });
    }
  }

  // Best/worst weekday
  const wd = byWeekday(logs).filter((d) => d.total >= 3);
  if (wd.length >= 2) {
    const sorted = [...wd].sort((a, b) => b.accuracy - a.accuracy);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    if (best.accuracy - worst.accuracy >= 10) {
      insights.push({
        id: "weekday",
        kind: "info",
        title: `יום ${best.label} הוא היום החזק שלך`,
        detail: `${best.accuracy}% לעומת ${worst.accuracy}% ביום ${worst.label}.`,
      });
    }
  }

  // Trend vs previous period
  const cmp = comparePrevious(state, range, deckId);
  if (cmp.previous.total > 0) {
    if (cmp.accuracyDelta >= 5) {
      insights.push({
        id: "trend-up", kind: "positive",
        title: "מגמה חיובית",
        detail: `הצלחה עלתה ב-${cmp.accuracyDelta} נק' אחוז לעומת התקופה הקודמת.`,
      });
    } else if (cmp.accuracyDelta <= -5) {
      insights.push({
        id: "trend-down", kind: "warning",
        title: "ירידה בהצלחה",
        detail: `ירידה של ${Math.abs(cmp.accuracyDelta)} נק' אחוז לעומת התקופה הקודמת. שווה לחזור על חומר קשה.`,
      });
    }
    if (cmp.totalDelta >= 20) {
      insights.push({
        id: "volume-up", kind: "positive",
        title: "הגדלת נפח חזרות",
        detail: `כמות החזרות עלתה ב-${cmp.totalDelta}% לעומת התקופה הקודמת.`,
      });
    } else if (cmp.totalDelta <= -20) {
      insights.push({
        id: "volume-down", kind: "warning",
        title: "ירידה בכמות חזרות",
        detail: `ירידה של ${Math.abs(cmp.totalDelta)}% בכמות החזרות.`,
      });
    }
  }

  // Hardest tag
  const tags = byTag(state, logs).filter((t) => t.total >= 5);
  if (tags.length >= 2) {
    const sorted = [...tags].sort((a, b) => a.accuracy - b.accuracy);
    const worst = sorted[0];
    if (worst.accuracy < 70) {
      insights.push({
        id: "weak-tag", kind: "warning",
        title: `נושא חלש: ${worst.label}`,
        detail: `${worst.accuracy}% הצלחה (${worst.correct}/${worst.total}). שווה השקעה ממוקדת.`,
      });
    }
  }

  // Hard cards count
  const hard = hardestCards(state, logs, 3, 100).filter((c) => c.accuracy < 60);
  if (hard.length >= 3) {
    insights.push({
      id: "hard-cards", kind: "warning",
      title: `${hard.length} כרטיסים קשים במיוחד`,
      detail: `יש כרטיסים עם פחות מ-60% הצלחה. עיין ברשימה למטה כדי לחזור עליהם.`,
    });
  }

  return insights;
}

// ============================================================================
// Forecast — predicted reviews per day for the next N days
// ============================================================================
export interface ForecastPoint {
  date: number;
  label: string;
  count: number;
  isToday: boolean;
}

export function forecastReviews(cards: Card[], days = 30): ForecastPoint[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const points: ForecastPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const start = d.getTime();
    const end = start + 86400000;
    const count = cards.filter((c) => c.srs.dueAt >= start && c.srs.dueAt < end).length;
    points.push({
      date: start,
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      count,
      isToday: i === 0,
    });
  }
  return points;
}

// ============================================================================
// True retention — pass rate on cards that were already learned (mature)
// Mature = interval >= maturityDays (default 21).
// ============================================================================
export interface RetentionStats {
  total: number;
  passed: number;
  retention: number; // 0..1
  young: { total: number; passed: number; retention: number };
  mature: { total: number; passed: number; retention: number };
}

export function trueRetention(
  state: StudyState,
  logs: ReviewLog[],
  maturityDays = 21,
): RetentionStats {
  const cardMap = new Map(state.cards.map((c) => [c.id, c]));
  let total = 0, passed = 0;
  let yT = 0, yP = 0, mT = 0, mP = 0;
  logs.forEach((l) => {
    const card = cardMap.get(l.cardId);
    if (!card) return;
    // Only count cards that have a learned state (interval > 0 at time of review).
    // We approximate using current interval; this is the standard approach.
    const interval = card.srs.interval;
    if (interval <= 0) return;
    total += 1;
    if (l.correct) passed += 1;
    if (interval >= maturityDays) {
      mT += 1;
      if (l.correct) mP += 1;
    } else {
      yT += 1;
      if (l.correct) yP += 1;
    }
  });
  return {
    total,
    passed,
    retention: total ? passed / total : 0,
    young: { total: yT, passed: yP, retention: yT ? yP / yT : 0 },
    mature: { total: mT, passed: mP, retention: mT ? mP / mT : 0 },
  };
}

// ============================================================================
// Card maturity distribution — for understanding library health
// ============================================================================
export interface MaturityBucket {
  label: string;
  count: number;
}

export function maturityDistribution(cards: Card[], maturityDays = 21): MaturityBucket[] {
  let newC = 0, learning = 0, young = 0, mature = 0;
  cards.forEach((c) => {
    if (!c.srs.lastReviewedAt) newC += 1;
    else if (c.srs.interval < 1) learning += 1;
    else if (c.srs.interval < maturityDays) young += 1;
    else mature += 1;
  });
  return [
    { label: "חדשים", count: newC },
    { label: "בלימוד", count: learning },
    { label: "צעירים", count: young },
    { label: "בשלים", count: mature },
  ];
}
