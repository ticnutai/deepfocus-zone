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
  StudySession: ({ classificationDragEnabled, cardIds, includeAllQuestionTypes }: { classificationDragEnabled?: boolean; cardIds?: string[]; includeAllQuestionTypes?: boolean }) => (
    <div data-testid="mock-study-session" data-card-ids={cardIds?.join(',')} data-all-types={String(!!includeAllQuestionTypes)} draggable={classificationDragEnabled}>תרגול פעיל</div>
  ),
}));

import { DafLearningTab, DafLearningTabInner } from "@/components/study/DafLearningTab";

it('opens a search target with its exact Gemara page and preserves question-type preferences', () => {
  mockState.cards=[{id:'target',question:'שאלה',masechta:'שבת',daf:2,amud:2}];
  const exit=vi.fn();
  render(<DafLearningTab requestedCardId="target" onCardExit={exit} />);
  expect(screen.getByTestId('mock-study-session')).toHaveAttribute('data-card-ids','target');
  expect(screen.getByTestId('mock-study-session')).toHaveAttribute('data-all-types','true');
  expect(screen.getByTestId('active-gemara-page')).toHaveTextContent('שבת-2-2');
  fireEvent.click(screen.getByText('חזרה לבחירת תרגול'));
  expect(exit).toHaveBeenCalledOnce();
});

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

  it("keeps the mobile drilldown space while replacing orders, tractates and pages", () => {
    localStorage.setItem("daf-learning-navigation-view", "drilldown");
    const media = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    try {
      render(<DafLearningTabInner isVisible />);
      const panel = screen.getByTestId("daf-inline-navigator");
      vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ height: 420 } as DOMRect);
      fireEvent.click(screen.getByRole("button", { name: /זרעים 1 מסכתות/ }));
      expect(panel.style.minHeight).toBe("420px");
      fireEvent.click(screen.getByRole("button", { name: "ברכות", exact: true }));
      expect(screen.getByText("ברכות — בחירת דף")).toBeInTheDocument();
      fireEvent.click(screen.getByText("יג").closest("button")!);
      for (const side of [1, 2]) {
        expect(screen.getByTestId(`inline-amud-${side}`)).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByTestId(`inline-amud-${side}`)).not.toHaveClass("bg-gradient-navy");
      }
      fireEvent.click(screen.getByTestId("inline-amud-2"));
      expect(screen.getByTestId("inline-amud-2")).toHaveAttribute("aria-pressed", "true");
      expect(panel.style.minHeight).toBe("");
      fireEvent.click(screen.getByRole("button", { name: "חזרה לדפים" }));
      fireEvent.click(screen.getByRole("button", { name: "חזרה למסכתות" }));
      fireEvent.click(screen.getByRole("button", { name: "חזרה לסדרים" }));
      expect(screen.getByRole("button", { name: /זרעים 1 מסכתות/ })).toBeInTheDocument();
      expect(panel.style.minHeight).toBe("");
    } finally { media.mockRestore(); }
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
    mockPermissions.can.mockImplementation(((module: string, action: string) => !(module === "cards" && action === "edit")) as never);
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
