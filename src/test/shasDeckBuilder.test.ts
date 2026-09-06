import { describe, expect, it } from "vitest";
import { cardsForShasDeckSources } from "@/lib/study/shasDeckBuilder";
import type { Card } from "@/lib/study/types";

const card = (id: string, daf: number, amud: 1 | 2 | null): Card => ({
  id, deckId: null, type: "flashcard", question: id, answer: id, tags: [], createdAt: 1,
  masechta: "ברכות", daf, amud, srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0, lastReviewedAt: null },
  stats: { totalReviews: 0, correct: 0, incorrect: 0 },
});

describe("Shas deck drag sources", () => {
  const cards = [card("a", 2, 1), card("b", 2, 2), card("generic", 2, null), card("c", 3, 1)];
  it("combines several dropped scopes without duplicate questions", () => {
    const result = cardsForShasDeckSources(cards, [], [
      { id: "daf", kind: "daf", masechta: "ברכות", daf: 2 },
      { id: "amud", kind: "amud", masechta: "ברכות", daf: 2, amud: 1 },
    ]);
    expect(result.map((item) => item.id).sort()).toEqual(["a", "b", "generic"]);
  });
  it("includes all pages when a tractate is dropped", () => {
    expect(cardsForShasDeckSources(cards, [], [{ id: "m", kind: "masechta", masechta: "ברכות" }])).toHaveLength(4);
  });
});
