import { describe, expect, it } from "vitest";
import { collectPlanSubjectLabelsByDay } from "@/lib/study/calendarDataSources";
import type { GeneralStudyPlan, LearningSession } from "@/lib/study/types";

describe("collectPlanSubjectLabelsByDay", () => {
  it("includes only plan-derived learning sessions", () => {
    const plans: GeneralStudyPlan[] = [
      {
        id: "p1",
        planType: "shas",
        title: 'ש"ס בבלי — יומא',
        units: ["יומא ב' ע\"א"],
        unitsPerDay: 1,
        startDate: Date.now(),
        completedUnits: [],
      },
    ];

    const sessions: LearningSession[] = [
      {
        id: "s1",
        date: "2026-05-10",
        subject: 'ש"ס בבלי — יומא — יומא ב\' ע"א',
        sessionType: "initial",
        quality: 4,
        reviewNumber: 1,
        createdAt: Date.now(),
      },
      {
        id: "s2",
        date: "2026-05-10",
        subject: "סיכום אישי",
        sessionType: "initial",
        quality: 4,
        reviewNumber: 1,
        createdAt: Date.now(),
      },
    ];

    const byDay = collectPlanSubjectLabelsByDay(sessions, plans);
    expect(byDay.get("2026-05-10")).toEqual(['ש"ס בבלי — יומא — יומא ב\' ע"א']);
  });
});
