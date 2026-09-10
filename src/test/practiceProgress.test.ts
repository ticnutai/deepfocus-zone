import { describe, expect, it } from "vitest";
import { calculatePracticeTrend } from "@/lib/study/practiceProgress";
import type { PracticeResult } from "@/lib/study/types";

const result = (id: string, score: number, completedAt: number): PracticeResult => ({
  id,
  kind: "general",
  sourceExamId: null,
  sourceExamName: null,
  startedAt: completedAt - 1_000,
  completedAt,
  total: 10,
  correct: score / 10,
  score,
  durationMs: 1_000,
  questionIds: [],
  answers: [],
  completed: true,
  updatedAt: completedAt,
});

describe("practice progress trend", () => {
  it("reports improvement from the latest attempt", () => {
    expect(calculatePracticeTrend([result("old", 50, 1), result("new", 80, 2)])).toEqual({ delta: 30, label: "שיפור" });
  });

  it("uses rolling groups of three and treats small changes as stable", () => {
    const values = [60, 61, 62, 64, 65, 66].map((score, index) => result(String(index), score, index));
    expect(calculatePracticeTrend(values).label).toBe("יציב");
  });

  it("does not invent a trend from one attempt", () => {
    expect(calculatePracticeTrend([result("only", 90, 1)])).toEqual({ delta: null, label: "נדרש ניסיון נוסף" });
  });
});
