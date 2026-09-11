import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockState, mockUpdateCard, mockSetUiPref, mockPermissions } = vi.hoisted(() => ({
  mockState: { cards: [] as Array<Record<string, unknown>>, categories: [], uiPrefs: {} },
  mockUpdateCard: vi.fn(),
  mockSetUiPref: vi.fn(),
  mockPermissions: { isAdmin: true, can: vi.fn(() => true) },
}));

vi.mock("@/lib/study/store", () => ({
  useStudy: () => ({
    state: mockState,
    setUiPref: mockSetUiPref,
    updateCard: mockUpdateCard,
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn(), useLocation: () => ({ pathname: "/" }) };
});

vi.mock("@/components/study/GemaraViewer", () => ({
  GemaraViewer: ({ masechta, daf, amud }: { masechta: string; daf: number; amud: number }) => (
    <div data-testid="active-gemara-page">{`${masechta}-${daf}-${amud}`}</div>
  ),
}));

vi.mock("@/components/study/CardDecksDialog", () => ({ CardDecksDialog: () => null }));
vi.mock("@/components/study/BulkCardDecksDialog", () => ({ BulkCardDecksDialog: () => null }));
vi.mock("@/components/study/CardEditor", () => ({ CardEditor: () => null }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => mockPermissions }));
vi.mock("@/components/study/StudySession", () => ({
  StudySession: ({ classificationDragEnabled }: { classificationDragEnabled?: boolean }) => (
    <div data-testid="mock-study-session" draggable={classificationDragEnabled}>תרגול פעיל</div>
  ),
}));

import { DafLearningTabInner } from "@/components/study/DafLearningTab";

describe("Daf learning amud navigation", () => {
  beforeEach(() => {
    mockState.cards = [];
    mockUpdateCard.mockClear();
    mockSetUiPref.mockClear();
    mockPermissions.isAdmin = true;
    mockPermissions.can.mockReset();
    mockPermissions.can.mockReturnValue(true);
    localStorage.clear();
    localStorage.setItem("daf-learning-navigation-view", "expanded");
    localStorage.setItem("daf-learning-state", JSON.stringify({
      seder: "זרעים",
      masechta: "ברכות",
      daf: 13,
      amud: 2,
      layout: "stacked",
    }));
  });

  it("classifies a dragged daf question into an existing amud target", async () => {
    mockState.cards = [{
      id: "card-daf-only",
      deckId: null,
      type: "flashcard",
      question: "שאלה כללית לדף",
      answer: "תשובה",
      tags: [],
      masechta: "עירובין",
      daf: 13,
      amud: null,
      createdAt: 1,
      srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0, lastReviewedAt: null },
      stats: { totalReviews: 0, correct: 0, incorrect: 0 },
    }];

    render(<DafLearningTabInner isVisible />);
    fireEvent.click(screen.getByRole("button", { name: /מועד 12 מסכתות/ }));
    fireEvent.click(screen.getByRole("button", { name: "עירובין" }));
    fireEvent.click(screen.getByText("יג").closest("button")!);
    fireEvent.click(screen.getByTestId("inline-amud-1"));

    await screen.findByText("שאלה כללית לדף");
    fireEvent.drop(screen.getByTestId("inline-amud-2"), {
      dataTransfer: {
        getData: (type: string) => type === "application/x-study-card-id" ? "card-daf-only" : "",
      },
    });

    expect(mockUpdateCard).toHaveBeenCalledWith("card-daf-only", {
      masechta: "עירובין",
      daf: 13,
      amud: 2,
    });
  });


  it("keeps saved content hidden until an amud is chosen, then switches sides", async () => {
    render(<DafLearningTabInner isVisible />);

    expect(screen.queryByTestId("active-gemara-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inline-amud-2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /מועד 12 מסכתות/ }));
    fireEvent.click(screen.getByRole("button", { name: "עירובין" }));
    fireEvent.click(screen.getByText("יג").closest("button")!);

    expect(screen.getByTestId("inline-amud-2")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("inline-amud-1-count")).toHaveTextContent("0");
    expect(screen.getByTestId("inline-amud-2-count")).toHaveTextContent("0");

    fireEvent.click(screen.getByTestId("inline-amud-2"));
    await waitFor(() => expect(screen.getByTestId("active-gemara-page")).toHaveTextContent("עירובין-13-2"));

    fireEvent.click(screen.getByTestId("inline-amud-1"));
    await waitFor(() => expect(screen.getByTestId("active-gemara-page")).toHaveTextContent("עירובין-13-1"));
    expect(screen.getByTestId("inline-amud-1")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("inline-amud-2"));
    await waitFor(() => expect(screen.getByTestId("active-gemara-page")).toHaveTextContent("עירובין-13-2"));
    expect(screen.getByTestId("inline-amud-2")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows in-practice amud drop targets to admins and saves the exact side", async () => {
    mockState.cards = [{
      id: "admin-practice-card", deckId: null, type: "flashcard", question: "שאלת תרגול", answer: "תשובה",
      tags: [], masechta: "עירובין", daf: 13, amud: null, createdAt: 1,
      srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0, lastReviewedAt: null },
      stats: { totalReviews: 0, correct: 0, incorrect: 0 },
    }];
    render(<DafLearningTabInner isVisible />);
    fireEvent.click(screen.getByRole("button", { name: /מועד 12 מסכתות/ }));
    fireEvent.click(screen.getByRole("button", { name: "עירובין" }));
    fireEvent.click(screen.getByText("יג").closest("button")!);
    fireEvent.click(screen.getByTestId("inline-amud-1"));
    await screen.findByText("שאלת תרגול");
    fireEvent.click(screen.getByRole("button", { name: "תרגול" }));

    expect(screen.getByTestId("admin-practice-amud-targets")).toBeInTheDocument();
    expect(screen.getByTestId("mock-study-session")).toHaveAttribute("draggable", "true");
    fireEvent.drop(screen.getByTestId("practice-amud-drop-2"), {
      dataTransfer: { getData: (type: string) => type === "application/x-study-card-id" ? "admin-practice-card" : "" },
    });
    expect(mockUpdateCard).toHaveBeenCalledWith("admin-practice-card", { masechta: "עירובין", daf: 13, amud: 2 });
  });

  it("keeps existing classification available but hides in-practice classification from non-admin users", async () => {
    mockPermissions.isAdmin = false;
    mockState.cards = [{
      id: "regular-card", deckId: null, type: "flashcard", question: "שאלה רגילה", answer: "תשובה",
      tags: [], masechta: "עירובין", daf: 13, amud: null, createdAt: 1,
      srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0, lastReviewedAt: null },
      stats: { totalReviews: 0, correct: 0, incorrect: 0 },
    }];
    render(<DafLearningTabInner isVisible />);
    fireEvent.click(screen.getByRole("button", { name: /מועד 12 מסכתות/ }));
    fireEvent.click(screen.getByRole("button", { name: "עירובין" }));
    fireEvent.click(screen.getByText("יג").closest("button")!);
    fireEvent.click(screen.getByTestId("inline-amud-1"));
    await screen.findByText("שאלה רגילה");

    expect(screen.getAllByLabelText("גרור לסיווג בעמוד א׳ או ב׳").length).toBeGreaterThan(0);
    fireEvent.drop(screen.getByTestId("inline-amud-2"), {
      dataTransfer: { getData: () => "regular-card" },
    });
    expect(mockUpdateCard).toHaveBeenCalledWith("regular-card", { masechta: "עירובין", daf: 13, amud: 2 });
    mockUpdateCard.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "תרגול" }));
    expect(screen.queryByTestId("admin-practice-amud-targets")).not.toBeInTheDocument();
    expect(screen.getByTestId("mock-study-session")).toHaveAttribute("draggable", "false");
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("opens the exact practice question editor from the hover action and saves its answers", async () => {
    mockState.cards = [{
      id: "editable-question",
      deckId: null,
      type: "multiple",
      question: "איזו תשובה נכונה?",
      options: ["תשובה ראשונה", "תשובה שנייה", "תשובה שלישית"],
      correctIndices: [1],
      explanation: "הסבר קיים",
      tags: [],
      masechta: "עירובין",
      daf: 13,
      amud: 1,
      createdAt: 1,
      srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0, lastReviewedAt: null },
      stats: { totalReviews: 0, correct: 0, incorrect: 0 },
    }];

    render(<DafLearningTabInner isVisible />);
    fireEvent.click(screen.getByRole("button", { name: /מועד 12 מסכתות/ }));
    fireEvent.click(screen.getByRole("button", { name: "עירובין" }));
    fireEvent.click(screen.getByText("יג").closest("button")!);
    fireEvent.click(screen.getByTestId("inline-amud-1"));

    const editButton = await screen.findByRole("button", { name: "ערוך שאלה: איזו תשובה נכונה?" });
    expect(editButton).toHaveClass("opacity-0");
    fireEvent.click(editButton);

    expect(screen.getByTestId("practice-question-editor")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "עריכת שאלה ותשובות" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("תשובה ראשונה")).toBeInTheDocument();
    expect(screen.getByDisplayValue("תשובה שנייה")).toBeInTheDocument();
    expect(screen.getByDisplayValue("תשובה שלישית")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("שאלה"), { target: { value: "שאלה מעודכנת" } });
    fireEvent.change(screen.getByDisplayValue("תשובה ראשונה"), { target: { value: "תשובה מעודכנת" } });
    fireEvent.click(screen.getByRole("button", { name: "שמור" }));

    expect(mockUpdateCard).toHaveBeenCalledWith("editable-question", expect.objectContaining({
      question: "שאלה מעודכנת",
      options: ["תשובה מעודכנת", "תשובה שנייה", "תשובה שלישית"],
      correctIndices: [1],
    }));
    expect(screen.queryByTestId("practice-question-editor")).not.toBeInTheDocument();
  });

  it("does not expose practice question editing without cards edit permission", async () => {
    mockPermissions.can.mockImplementation((module: string, action: string) => !(module === "cards" && action === "edit"));
    mockState.cards = [{
      id: "read-only-question", deckId: null, type: "flashcard", question: "שאלה לקריאה בלבד", answer: "תשובה",
      tags: [], masechta: "עירובין", daf: 13, amud: 1, createdAt: 1,
      srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0, lastReviewedAt: null },
      stats: { totalReviews: 0, correct: 0, incorrect: 0 },
    }];

    render(<DafLearningTabInner isVisible />);
    fireEvent.click(screen.getByRole("button", { name: /מועד 12 מסכתות/ }));
    fireEvent.click(screen.getByRole("button", { name: "עירובין" }));
    fireEvent.click(screen.getByText("יג").closest("button")!);
    fireEvent.click(screen.getByTestId("inline-amud-1"));

    await screen.findByText("שאלה לקריאה בלבד");
    expect(screen.queryByRole("button", { name: "ערוך שאלה: שאלה לקריאה בלבד" })).not.toBeInTheDocument();
  });

});
