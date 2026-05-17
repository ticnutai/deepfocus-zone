import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { dateKey, todayKey, evaluateGoal, buildHeatmap } from "@/lib/study/goals";
import type { Goal, ReviewLog } from "@/lib/study/types";

const DAY = 24 * 60 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setFakeDate(iso: string) {
  // Use fake timers so both Date.now() and new Date() return the mocked time
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso + "T12:00:00"));
}

function makeLog(iso: string, correct: boolean, cardId = "c1", deckId = "d1"): ReviewLog {
  const at = new Date(iso + "T12:00:00").getTime();
  return { id: `l${at}`, cardId, deckId, at, quality: correct ? 4 : 1, correct, durationMs: 1000 };
}

function makeGoal(overrides: Partial<Goal>): Goal {
  return {
    id: "g1",
    type: "daily_reviews",
    title: "Test",
    target: 10,
    active: true,
    createdAt: 0,
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

// ─── dateKey ──────────────────────────────────────────────────────────────────

describe("dateKey", () => {
  it("formats timestamp as yyyy-mm-dd", () => {
    const ts = new Date("2026-01-05T15:30:00").getTime();
    expect(dateKey(ts)).toBe("2026-01-05");
  });

  it("midnight falls on correct day", () => {
    const ts = new Date("2026-03-15T00:00:00").getTime();
    expect(dateKey(ts)).toBe("2026-03-15");
  });

  it("todayKey matches dateKey(Date.now())", () => {
    expect(todayKey()).toBe(dateKey(Date.now()));
  });
});

// ─── evaluateGoal — daily_reviews ────────────────────────────────────────────

describe("evaluateGoal - daily_reviews", () => {
  beforeEach(() => setFakeDate("2026-05-03"));

  it("counts only today's logs", () => {
    const logs = [
      makeLog("2026-05-03", true),
      makeLog("2026-05-03", false),
      makeLog("2026-05-02", true), // yesterday - should not count
    ];
    const result = evaluateGoal(makeGoal({ type: "daily_reviews", target: 5 }), logs);
    expect(result.current).toBe(2);
    expect(result.target).toBe(5);
    expect(result.percent).toBe(40);
    expect(result.doneToday).toBe(false);
  });

  it("marks done when current >= target", () => {
    const logs = Array.from({ length: 10 }, (_, i) => makeLog("2026-05-03", true, `c${i}`));
    const result = evaluateGoal(makeGoal({ type: "daily_reviews", target: 10 }), logs);
    expect(result.doneToday).toBe(true);
    expect(result.percent).toBe(100);
  });

  it("filters by deckId when specified", () => {
    const logs = [
      makeLog("2026-05-03", true, "c1", "deck-a"),
      makeLog("2026-05-03", true, "c2", "deck-b"),
    ];
    const result = evaluateGoal(makeGoal({ type: "daily_reviews", target: 5, deckId: "deck-a" }), logs);
    expect(result.current).toBe(1);
  });

  it("does not produce NaN when target is 0", () => {
    const result = evaluateGoal(makeGoal({ type: "daily_reviews", target: 0 }), []);
    expect(result.percent).not.toBeNaN();
    expect(isFinite(result.percent)).toBe(true);
  });
});

// ─── evaluateGoal — daily_cards ───────────────────────────────────────────────

describe("evaluateGoal - daily_cards", () => {
  beforeEach(() => setFakeDate("2026-05-03"));

  it("deduplicates cards (same card reviewed multiple times counts once)", () => {
    const logs = [
      makeLog("2026-05-03", true, "same-card"),
      makeLog("2026-05-03", false, "same-card"),
      makeLog("2026-05-03", true, "other-card"),
    ];
    const result = evaluateGoal(makeGoal({ type: "daily_cards", target: 5 }), logs);
    expect(result.current).toBe(2); // only 2 unique cards
  });
});

// ─── evaluateGoal — success_rate ──────────────────────────────────────────────

describe("evaluateGoal - success_rate", () => {
  beforeEach(() => setFakeDate("2026-05-03"));

  it("calculates rate across the window", () => {
    const logs = [
      makeLog("2026-05-01", true),
      makeLog("2026-05-02", true),
      makeLog("2026-05-03", false),
      makeLog("2026-04-01", true), // outside 7-day window
    ];
    const result = evaluateGoal(makeGoal({ type: "success_rate", target: 80, windowDays: 7 }), logs);
    // 2 correct out of 3 in window = 67%
    expect(result.current).toBe(67);
    expect(result.doneToday).toBe(false);
  });

  it("returns 0 with no logs", () => {
    const result = evaluateGoal(makeGoal({ type: "success_rate", target: 80 }), []);
    expect(result.current).toBe(0);
    expect(result.percent).toBe(0);
  });

  it("does not produce NaN when target is 0", () => {
    const result = evaluateGoal(makeGoal({ type: "success_rate", target: 0, windowDays: 7 }), []);
    expect(result.percent).not.toBeNaN();
    expect(isFinite(result.percent)).toBe(true);
  });
});

// ─── evaluateGoal — streak ────────────────────────────────────────────────────

describe("evaluateGoal - streak", () => {
  it("counts consecutive days ending today", () => {
    setFakeDate("2026-05-03");
    const logs = [
      makeLog("2026-05-03", true),
      makeLog("2026-05-02", true),
      makeLog("2026-05-01", true),
      // gap: 2026-04-30 missing
      makeLog("2026-04-29", true),
    ];
    const result = evaluateGoal(makeGoal({ type: "streak", target: 7 }), logs);
    expect(result.current).toBe(3); // only 3 consecutive ending today
  });

  it("allows empty today — counts from yesterday", () => {
    setFakeDate("2026-05-03");
    const logs = [
      makeLog("2026-05-02", true),
      makeLog("2026-05-01", true),
    ];
    const result = evaluateGoal(makeGoal({ type: "streak", target: 7 }), logs);
    expect(result.current).toBe(2); // yesterday and day before
    expect(result.doneToday).toBe(false); // today has no log
  });

  it("returns streak 0 with no logs", () => {
    setFakeDate("2026-05-03");
    const result = evaluateGoal(makeGoal({ type: "streak", target: 7 }), []);
    expect(result.current).toBe(0);
  });

  it("does not produce NaN when target is 0", () => {
    setFakeDate("2026-05-03");
    const result = evaluateGoal(makeGoal({ type: "streak", target: 0 }), []);
    expect(result.percent).not.toBeNaN();
    expect(isFinite(result.percent)).toBe(true);
  });
});

// ─── evaluateGoal — custom ────────────────────────────────────────────────────

describe("evaluateGoal - custom", () => {
  beforeEach(() => setFakeDate("2026-05-03"));

  it("counts manual done dates", () => {
    const result = evaluateGoal(
      makeGoal({ type: "custom", target: 30, manualDoneDates: ["2026-05-01", "2026-05-02", "2026-05-03"] }),
      [],
    );
    expect(result.current).toBe(3);
    expect(result.doneToday).toBe(true);
  });

  it("handles no manual done dates", () => {
    const result = evaluateGoal(makeGoal({ type: "custom", target: 30, manualDoneDates: [] }), []);
    expect(result.current).toBe(0);
    expect(result.doneToday).toBe(false);
  });
});

// ─── buildHeatmap ─────────────────────────────────────────────────────────────

describe("buildHeatmap", () => {
  beforeEach(() => setFakeDate("2026-05-10"));

  it("returns exactly N cells", () => {
    const cells = buildHeatmap([], 35);
    expect(cells).toHaveLength(35);
  });

  it("last cell is today", () => {
    const cells = buildHeatmap([], 7);
    const todayIso = new Date().toLocaleDateString("sv"); // sv locale = yyyy-mm-dd in local time
    expect(cells[cells.length - 1].key).toBe(todayIso);
  });

  it("counts logs per day correctly", () => {
    // Use dates relative to the faked "today" (2026-05-10) — within last 7 days
    const logs = [
      makeLog("2026-05-10", true),
      makeLog("2026-05-10", false),
      makeLog("2026-05-09", true),
    ];
    const cells = buildHeatmap(logs, 7);
    const todayCell = cells.find((c) => c.key === "2026-05-10");
    const yesterdayCell = cells.find((c) => c.key === "2026-05-09");
    expect(todayCell?.count).toBe(2);
    expect(yesterdayCell?.count).toBe(1);
  });

  it("logs outside range are not counted", () => {
    const logs = [makeLog("2026-01-01", true)]; // far in past
    const cells = buildHeatmap(logs, 7);
    const total = cells.reduce((sum, c) => sum + c.count, 0);
    expect(total).toBe(0);
  });
});
