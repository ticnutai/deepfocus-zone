import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  decks: [{ id: "deck-1", name: "מבחן ברכות", createdAt: 1 }],
  cards: [
    { id: "q-1", deckId: "deck-1", question: "שאלה א" },
    { id: "q-page", deckId: null, question: "שאלת שבת", masechta: "שבת", daf: 2, amud: 1 },
  ],
  categories: [],
  cardDecks: [],
  practiceResults: [
    { id: "formal", kind: "exam", sourceExamId: "deck-1", sourceExamName: "מבחן ברכות", startedAt: 1, completedAt: 2, total: 1, correct: 1, score: 100, durationMs: 1000, questionIds: ["q-1"], answers: [], completed: true, updatedAt: 2 },
    { id: "deleted", kind: "exam", sourceExamId: "deleted-deck", sourceExamName: "מבחן ישן", startedAt: 1, completedAt: 3, total: 1, correct: 0, score: 0, durationMs: 1000, questionIds: ["q-2"], answers: [], completed: true, updatedAt: 3 },
    { id: "prior", kind: "general", sourceExamId: null, sourceExamName: null, startedAt: 1, completedAt: 4, total: 1, correct: 1, score: 100, durationMs: 1000, questionIds: ["q-1"], answers: [], completed: true, updatedAt: 4 },
    { id: "shabbat-page", kind: "exam", sourceExamId: "deleted-page-exam", sourceExamName: "מבחן שבת ב ע״א", startedAt: 4, completedAt: 5, total: 1, correct: 1, score: 100, durationMs: 1000, questionIds: ["q-page"], answers: [{ id: "a-page", cardId: "q-page", question: "שאלת שבת", correct: true, quality: 5, durationMs: 1000, answeredAt: 5 }], completed: true, updatedAt: 5 },
  ],
};

vi.mock("@/lib/study/store", () => ({ useStudy: () => ({ state }) }));

import { PracticeProgress } from "@/components/study/PracticeProgress";
import { PageProgressDialog } from "@/components/study/ShasProgressViews";

describe("PracticeProgress", () => {
  beforeEach(() => localStorage.clear());

  it("keeps deleted exams in general history and starts an active exam directly", async () => {
    const listener = vi.fn();
    window.addEventListener("deepfocus:start-exam", listener);
    const view = render(<PracticeProgress initialTab="exams" />);
    expect((await screen.findAllByText("מבחן ברכות")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/1 תרגולי ידע קודם/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "התחל מבחן" }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("practice-start-exam-v1")).toBe("deck-1");

    view.unmount();
    render(<PracticeProgress initialTab="general" />);
    expect(screen.getByText("מבחן ישן")).toBeInTheDocument();
    expect(screen.getAllByText("בוצע בעבר כמבחן").length).toBeGreaterThan(0);
    window.removeEventListener("deepfocus:start-exam", listener);
  });

  it("shows Shas progress by masechta, daf and amud", () => {
    render(<PracticeProgress />);
    expect(screen.getByText("מסכת שבת")).toBeInTheDocument();
    expect(screen.getByText("דף ב")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /שבת דף ב.*עמוד א׳/ })).toBeInTheDocument();
    expect(screen.getByText("מבחן שבת ב ע״א")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("חיפוש בתוצאות"), { target: { value: "שבת דף ב עמוד א" } });
    expect(screen.getByText("מסכת שבת")).toBeInTheDocument();
    expect(screen.queryByText("מבחן ישן")).not.toBeInTheDocument();
  });

  it("opens a page-only progress dialog for Shabbat daf 2 amud A", async () => {
    render(<PageProgressDialog open onOpenChange={() => undefined} masechta="שבת" daf={2} amud={1} />);
    expect(await screen.findByText(/התקדמות — שבת · דף ב · עמוד א׳/)).toBeInTheDocument();
    expect(screen.getByText("כל המבחנים והתרגולים לפי תאריך")).toBeInTheDocument();
    expect(screen.getByText("מבחן שבת ב ע״א")).toBeInTheDocument();
    expect(screen.getByText("1/1 נכונות בעמוד")).toBeInTheDocument();
  });
});
