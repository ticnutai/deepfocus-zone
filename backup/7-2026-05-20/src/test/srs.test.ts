import { describe, it, expect, vi, afterEach } from "vitest";
import { applySM2, defaultSrs, isDue, priorityScore } from "@/lib/study/srs";
import type { Card } from "@/lib/study/types";

const DAY = 24 * 60 * 60 * 1000;

// Helper to build a minimal flashcard
function makeCard(overrides: Partial<Card["srs"]> = {}, statsOverride?: Partial<Card["stats"]>): Card {
  return {
    id: "c1",
    deckId: "d1",
    type: "flashcard",
    question: "Q",
    answer: "A",
    tags: [],
    createdAt: 0,
    srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: Date.now(), lastReviewedAt: null, ...overrides },
    stats: { totalReviews: 0, correct: 0, incorrect: 0, ...statsOverride },
  } as Card;
}

// ─── applySM2 ───────────────────────────────────────────────────────────────

describe("applySM2", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fail (quality < 3) resets repetitions and interval to 1", () => {
    const card = makeCard({ ease: 2.5, interval: 10, repetitions: 3 });
    const srs = applySM2(card, 2);
    expect(srs.repetitions).toBe(0);
    expect(srs.interval).toBe(1);
    // ease decreases on fail
    expect(srs.ease).toBeLessThan(2.5);
    // ease never drops below 1.3
    expect(srs.ease).toBeGreaterThanOrEqual(1.3);
  });

  it("perfect quality 5 increases ease", () => {
    const card = makeCard({ ease: 2.5, interval: 0, repetitions: 0 });
    const srs = applySM2(card, 5);
    expect(srs.ease).toBeGreaterThan(2.5);
    expect(srs.repetitions).toBe(1);
    expect(srs.interval).toBe(1); // first repetition
  });

  it("second pass (repetitions=1) sets interval to 3", () => {
    const card = makeCard({ ease: 2.5, interval: 1, repetitions: 1 });
    const srs = applySM2(card, 3);
    expect(srs.interval).toBe(3);
    expect(srs.repetitions).toBe(2);
  });

  it("third+ pass multiplies interval by ease", () => {
    const card = makeCard({ ease: 2.5, interval: 3, repetitions: 2 });
    const srs = applySM2(card, 3);
    expect(srs.interval).toBe(Math.round(3 * 2.5)); // 8
    expect(srs.repetitions).toBe(3);
  });

  it("quality 0 (complete fail) still clamps ease at 1.3", () => {
    // Repeatedly fail to drive ease toward floor
    let card = makeCard({ ease: 1.4, interval: 1, repetitions: 0 });
    for (let i = 0; i < 10; i++) {
      const newSrs = applySM2(card, 0);
      card = { ...card, srs: newSrs };
    }
    expect(card.srs.ease).toBeGreaterThanOrEqual(1.3);
  });

  it("updates lastReviewedAt to current time", () => {
    const before = Date.now();
    const srs = applySM2(makeCard(), 4);
    expect(srs.lastReviewedAt).toBeGreaterThanOrEqual(before);
  });

  it("dueAt is set in the future after pass", () => {
    const before = Date.now();
    const srs = applySM2(makeCard(), 4);
    expect(srs.dueAt).toBeGreaterThan(before);
  });
});

// ─── defaultSrs ──────────────────────────────────────────────────────────────

describe("defaultSrs", () => {
  it("returns sensible initial values", () => {
    const srs = defaultSrs();
    expect(srs.ease).toBe(2.5);
    expect(srs.interval).toBe(0);
    expect(srs.repetitions).toBe(0);
    expect(srs.lastReviewedAt).toBeNull();
    expect(srs.dueAt).toBeLessThanOrEqual(Date.now() + 100);
  });
});

// ─── isDue ───────────────────────────────────────────────────────────────────

describe("isDue", () => {
  it("returns true when dueAt is in the past", () => {
    const card = makeCard({ dueAt: Date.now() - 1000 });
    expect(isDue(card)).toBe(true);
  });

  it("returns false when dueAt is in the future", () => {
    const card = makeCard({ dueAt: Date.now() + DAY });
    expect(isDue(card)).toBe(false);
  });

  it("returns true when dueAt equals now (boundary)", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const card = makeCard({ dueAt: now });
    expect(isDue(card)).toBe(true);
  });
});

// ─── priorityScore ──────────────────────────────────────────────────────────

describe("priorityScore", () => {
  const NOW = 1_000_000_000_000; // fixed timestamp for reproducibility

  it("new card (no reviews) gets newBonus of 15", () => {
    const card = makeCard({ dueAt: NOW, lastReviewedAt: null, ease: 2.5, interval: 0 });
    const score = priorityScore(card, NOW);
    // newBonus = 15, overdueScore = 0, difficultyScore = 0, rest = 0
    expect(score).toBe(15);
  });

  it("severely overdue card scores higher than a fresh card", () => {
    const overdueCard = makeCard({ dueAt: NOW - 10 * DAY, interval: 1, ease: 2.5, lastReviewedAt: NOW - 11 * DAY });
    const freshCard = makeCard({ dueAt: NOW + DAY, interval: 7, ease: 2.5, lastReviewedAt: null });
    expect(priorityScore(overdueCard, NOW)).toBeGreaterThan(priorityScore(freshCard, NOW));
  });

  it("low-ease (difficult) card scores higher than easy card with same due date", () => {
    const hardCard = makeCard({ dueAt: NOW - 100, interval: 1, ease: 1.3, lastReviewedAt: NOW - 200 });
    const easyCard = makeCard({ dueAt: NOW - 100, interval: 1, ease: 2.5, lastReviewedAt: NOW - 200 });
    expect(priorityScore(hardCard, NOW)).toBeGreaterThan(priorityScore(easyCard, NOW));
  });

  it("recently reviewed card is penalised (recency penalty)", () => {
    const justReviewed = makeCard({ dueAt: NOW - 100, interval: 1, ease: 2.5, lastReviewedAt: NOW - 1000 }); // 1 sec ago
    const notRecent = makeCard({ dueAt: NOW - 100, interval: 1, ease: 2.5, lastReviewedAt: NOW - 2 * 60 * 60 * 1000 }); // 2h ago
    expect(priorityScore(notRecent, NOW)).toBeGreaterThan(priorityScore(justReviewed, NOW));
  });

  it("high incorrect count boosts score (leech penalty)", () => {
    const leech = makeCard(
      { dueAt: NOW - 100, interval: 1, ease: 2.5, lastReviewedAt: NOW - 10000 },
      { totalReviews: 20, correct: 5, incorrect: 15 },
    );
    const clean = makeCard(
      { dueAt: NOW - 100, interval: 1, ease: 2.5, lastReviewedAt: NOW - 10000 },
      { totalReviews: 20, correct: 18, incorrect: 2 },
    );
    expect(priorityScore(leech, NOW)).toBeGreaterThan(priorityScore(clean, NOW));
  });
});
