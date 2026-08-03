import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/study/types";
import { filterUserOwnedCards } from "@/lib/study/userQuestionsExport";

const card = (id: string): Card => ({
  id,
  deckId: null,
  type: "flashcard",
  question: `שאלה ${id}`,
  answer: `תשובה ${id}`,
  tags: [],
  createdAt: 1,
  srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0, lastReviewedAt: null },
  stats: { totalReviews: 0, correct: 0, incorrect: 0 },
});

describe("user questions export ownership filter", () => {
  it("exports only cards created by the current user", () => {
    const cards = [card("mine-1"), card("bundled-1"), card("source-1"), card("mine-2")];
    const result = filterUserOwnedCards(
      cards,
      new Set(["bundled-1"]),
      (id) => id === "source-1",
    );

    expect(result.map((item) => item.id)).toEqual(["mine-1", "mine-2"]);
  });

  it("never mutates the original card list", () => {
    const cards = [card("mine"), card("bundled")];
    filterUserOwnedCards(cards, new Set(["bundled"]), () => false);
    expect(cards.map((item) => item.id)).toEqual(["mine", "bundled"]);
  });
});
