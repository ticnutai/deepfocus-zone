import { describe, expect, it } from "vitest";
import { containsCompleteGuestStudySeed, type GuestStudySeed } from "@/lib/auth/guestViewProfile";
import type { StudyState } from "@/lib/study/types";

const seed: GuestStudySeed = {
  seededAt: 123,
  categories: [{ id: "root", name: "root", parentId: null, createdAt: 1 }],
  decks: [{ id: "deck", name: "deck", color: "gold", createdAt: 1, categoryIds: ["root"], includeSubCategories: true }],
  cards: [{
    id: "card",
    deckId: "deck",
    type: "flashcard",
    question: "question",
    answer: "answer",
    tags: [],
    createdAt: 1,
    srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 1, lastReviewedAt: null },
    stats: { totalReviews: 0, correct: 0, incorrect: 0 },
  }],
  cardDecks: [{ cardId: "card", deckId: "deck", sortOrder: 0 }],
  deckCategories: { deck: ["root"] },
};

const state = (overrides: Partial<StudyState> = {}): StudyState => ({
  decks: seed.decks,
  cards: seed.cards,
  logs: [],
  categories: seed.categories,
  cardDecks: seed.cardDecks,
  deckCategories: seed.deckCategories,
  ...overrides,
});

describe("guest seed integrity", () => {
  it("rejects a category shell whose bundled questions were lost", () => {
    expect(containsCompleteGuestStudySeed(state({ cards: [] }), seed)).toBe(false);
  });

  it("rejects missing category links even when cards survived", () => {
    expect(containsCompleteGuestStudySeed(state({ cardDecks: [] }), seed)).toBe(false);
    expect(containsCompleteGuestStudySeed(state({ deckCategories: {} }), seed)).toBe(false);
  });

  it("accepts a complete seed alongside additional local content", () => {
    expect(containsCompleteGuestStudySeed(state({
      cards: [...seed.cards, { ...seed.cards[0], id: "local-card" }],
    }), seed)).toBe(true);
  });
});
