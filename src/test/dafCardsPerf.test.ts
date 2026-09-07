import { describe, it, expect } from "vitest";
import { countCardsPerDaf, filterCardsByDafAmud } from "@/lib/study/dafCards";
import type { Card, Category } from "@/lib/study/types";
import { dafLabel } from "@/lib/study/shasGen";

/**
 * בדיקות עומס לוודא שהבדיקה של דפי גמרא וטעינת בורר הסדרים
 * נשארת תחת זמן יעד גם על ספריות גדולות מאוד.
 *
 * יעדים (חמרניים — כוללים מרווח בטיחות פי-כמה ל-CI איטי):
 *   - countCardsPerDaf על ~50K כרטיסים: < 350ms
 *   - filterCardsByDafAmud על אותה ספריה: < 50ms (קריאה בודדת)
 *   - שניהם רק-build של אינדקס פעם אחת — שיחה שניה < 50ms / 10ms
 */

const MASECHTA = "ברכות";
const TOTAL_PAGES = 64;

function buildBigLibrary(cardCount: number): { cards: Card[]; categories: Category[] } {
  const categories: Category[] = [];
  const masechtaCat: Category = {
    id: "m-ber",
    name: MASECHTA,
    parentId: null,
    createdAt: 0,
  };
  categories.push(masechtaCat);

  // קטגוריה לכל דף + תת-קטגוריות ע"א / ע"ב
  const amudCats: Category[] = [];
  for (let d = 2; d <= TOTAL_PAGES + 1; d++) {
    const dafCat: Category = {
      id: `d-${d}`,
      name: dafLabel(d),
      parentId: masechtaCat.id,
      createdAt: 0,
    };
    categories.push(dafCat);
    const a: Category = { id: `d-${d}-a`, name: 'ע"א', parentId: dafCat.id, createdAt: 0 };
    const b: Category = { id: `d-${d}-b`, name: 'ע"ב', parentId: dafCat.id, createdAt: 0 };
    categories.push(a, b);
    amudCats.push(a, b);
  }

  const cards: Card[] = [];
  for (let i = 0; i < cardCount; i++) {
    const target = amudCats[i % amudCats.length];
    cards.push({
      id: `c-${i}`,
      deckId: null,
      type: "flashcard",
      question: `שאלה ${i}`,
      answer: "תשובה",
      tags: [`cat:${target.name}`, `cat:${target.id}`],
      createdAt: 0,
      srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0, lastReviewedAt: null },
      stats: { totalReviews: 0, correct: 0, incorrect: 0 },
    } as Card);
  }
  return { cards, categories };
}

describe("dafCards performance (load test)", () => {
  const { cards, categories } = buildBigLibrary(50_000);

  it("countCardsPerDaf builds quickly on 50K cards", () => {
    const t0 = performance.now();
    const map = countCardsPerDaf(cards, categories, MASECHTA, TOTAL_PAGES);
    const ms = performance.now() - t0;
    expect(map.size).toBeGreaterThan(0);
    // יעד נדיב ל-CI — בפועל הפעולה צריכה לרוץ הרבה יותר מהר.
    expect(ms).toBeLessThan(800);
  });

  it("countCardsPerDaf second call is cached / fast", () => {
    countCardsPerDaf(cards, categories, MASECHTA, TOTAL_PAGES); // warm
    const t0 = performance.now();
    countCardsPerDaf(cards, categories, MASECHTA, TOTAL_PAGES);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(400);
  });

  it("filterCardsByDafAmud lookup is fast on 50K cards", () => {
    // warm the index cache
    filterCardsByDafAmud(cards, categories, MASECHTA, 2, 1);
    const t0 = performance.now();
    const out = filterCardsByDafAmud(cards, categories, MASECHTA, 5, 2);
    const ms = performance.now() - t0;
    expect(out.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(120);
  });

  it("100 sequential page filters stay snappy (picker dialog scrolling)", () => {
    filterCardsByDafAmud(cards, categories, MASECHTA, 2, 1); // warm
    const t0 = performance.now();
    for (let d = 2; d <= 64; d++) {
      filterCardsByDafAmud(cards, categories, MASECHTA, d, d % 2 === 0 ? 1 : 2);
    }
    const ms = performance.now() - t0;
    // ~63 קריאות — חייב להישאר חלק
    expect(ms).toBeLessThan(800);
  });
});

describe("dafCards amud filtering", () => {
  const categories: Category[] = [
    { id: "m", name: MASECHTA, parentId: null, createdAt: 0 },
    { id: "d", name: dafLabel(35), parentId: "m", createdAt: 0 },
    { id: "a", name: 'ע"א', parentId: "d", createdAt: 0 },
    { id: "b", name: 'ע"ב', parentId: "d", createdAt: 0 },
  ];
  const makeCard = (id: string, amud: 1 | 2 | null): Card => ({
    id,
    deckId: null,
    type: "flashcard",
    question: id,
    answer: "answer",
    masechta: MASECHTA,
    daf: 35,
    amud,
    tags: amud ? [`cat:${amud === 1 ? "a" : "b"}`] : ["cat:d"],
    createdAt: 0,
    srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0, lastReviewedAt: null },
    stats: { totalReviews: 0, correct: 0, incorrect: 0 },
  } as Card);
  const cards = [makeCard("general", null), makeCard("amud-a", 1), makeCard("amud-b", 2)];

  it("shows only explicitly assigned questions in amud-only mode", () => {
    expect(filterCardsByDafAmud(cards, categories, MASECHTA, 35, 1, { includeDafOnly: false }).map((c) => c.id))
      .toEqual(["amud-a"]);
    expect(filterCardsByDafAmud(cards, categories, MASECHTA, 35, 2, { includeDafOnly: false }).map((c) => c.id))
      .toEqual(["amud-b"]);
  });

  it("keeps legacy daf-only questions available when explicitly requested", () => {
    expect(filterCardsByDafAmud(cards, categories, MASECHTA, 35, 1).map((c) => c.id))
      .toEqual(["general", "amud-a"]);
    expect(filterCardsByDafAmud(cards, categories, MASECHTA, 35, 2).map((c) => c.id))
      .toEqual(["general", "amud-b"]);
  });

  it("keeps a classified question permanently isolated to its assigned amud", () => {
    const classified = { ...makeCard("classified", null), amud: 1 as const };
    expect(filterCardsByDafAmud([classified], categories, MASECHTA, 35, 1).map((c) => c.id))
      .toEqual(["classified"]);
    expect(filterCardsByDafAmud([classified], categories, MASECHTA, 35, 2).map((c) => c.id))
      .toEqual([]);
    expect(filterCardsByDafAmud([classified], categories, MASECHTA, 35, 1, { includeDafOnly: false }).map((c) => c.id))
      .toEqual(["classified"]);
  });

  it("counts visible questions per amud and unique questions per daf", () => {
    expect(countCardsPerDaf(cards, categories, MASECHTA, TOTAL_PAGES).get(35))
      .toEqual({ a: 2, b: 2, total: 3 });
  });
});
