import { describe, expect, it } from "vitest";
import { cardsForShasDeckSources, shasDeckSourceLabel } from "@/lib/study/shasDeckBuilder";
import type { Card } from "@/lib/study/types";
import type { Category } from "@/lib/study/types";

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
  it("includes questions from a dragged category and all its descendants", () => {
    const categories: Category[] = [
      { id: "root", name: "חומש", parentId: null, createdAt: 1 },
      { id: "child", name: "בראשית", parentId: "root", createdAt: 1 },
    ];
    const categorized = [
      { ...card("root-card", 2, 1), tags: ["cat:root"] },
      { ...card("child-card", 2, 1), tags: ["cat:בראשית"] },
      { ...card("other", 2, 1), tags: ["cat:אחר"] },
    ];
    const result = cardsForShasDeckSources(categorized, categories, [
      { id: "category:root", kind: "category", categoryId: "root", categoryName: "חומש" },
    ]);
    expect(result.map((item) => item.id).sort()).toEqual(["child-card", "root-card"]);
  });
  it("formats daf numbers with Hebrew letters in every source label", () => {
    expect(shasDeckSourceLabel({ id: "d", kind: "daf", masechta: "שבת", daf: 2 })).toBe("שבת · דף ב");
    expect(shasDeckSourceLabel({ id: "a", kind: "amud", masechta: "שבת", daf: 13, amud: 2 })).toBe("שבת · דף יג · עמוד ב׳");
  });
});
