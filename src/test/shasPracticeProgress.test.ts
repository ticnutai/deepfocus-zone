import { describe, expect, it } from "vitest";
import { buildShasPracticeProgress, summarizePageAttempts } from "@/lib/study/shasPracticeProgress";
import type { Card, Category, PracticeResult } from "@/lib/study/types";

const categories: Category[] = [
  { id: "shas", name: "ש״ס", parentId: null, createdAt: 1 },
  { id: "shabbat", name: "שבת", parentId: "shas", createdAt: 1 },
  { id: "daf-b", name: "שבת · ב.", parentId: "shabbat", createdAt: 1 },
  { id: "amud-a", name: "שבת · ב. · ע\"א", parentId: "daf-b", createdAt: 1 },
];

const card = (id: string): Card => ({
  id, deckId: null, type: "boolean", question: id, correct: true, tags: ["cat:amud-a"], createdAt: 1,
  srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0, lastReviewedAt: null },
  stats: { totalReviews: 0, correct: 0, incorrect: 0 },
});

const result = (id: string, completedAt: number, correct: boolean): PracticeResult => ({
  id, kind: "exam", sourceExamId: "exam-1", sourceExamName: "מבחן שבת ב ע״א", startedAt: completedAt - 1000,
  completedAt, total: 1, correct: correct ? 1 : 0, score: correct ? 100 : 0, durationMs: 1000,
  questionIds: ["q1"], answers: [{ id: `${id}:q1`, cardId: "q1", question: "שאלה", correct, quality: correct ? 5 : 1, durationMs: 1000, answeredAt: completedAt }],
  completed: true, updatedAt: completedAt,
});

describe("Shas practice progress", () => {
  it("groups exam attempts by masechta, daf and amud from the question category", () => {
    const tree = buildShasPracticeProgress([result("new", 200, true), result("old", 100, false)], [card("q1")], categories);
    const amud = tree[0].dapim[0].amudim[0];
    expect([tree[0].masechta, tree[0].dapim[0].daf, amud.amud]).toEqual(["שבת", 2, 1]);
    expect(amud.attempts).toHaveLength(2);
    expect(summarizePageAttempts(amud.attempts)).toMatchObject({ attempts: 2, average: 50, delta: 100, trend: "שיפור" });
  });
});
