import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShasDeckBuilder } from "@/components/study/ShasDeckBuilder";

const setUiPref = vi.fn();

vi.mock("@/lib/study/store", () => ({
  useStudy: () => ({
    state: {
      cards: [], categories: [], decks: [], cardDecks: [],
      uiPrefs: {
        deckBuilderNavigationMode: "drilldown",
        dafLearningPins: [{ id: "ברכות::3::2", seder: "זרעים", masechta: "ברכות", daf: 3, amud: 2, createdAt: 1 }],
      },
    },
    addDeck: vi.fn(),
    addCardsToDeck: vi.fn(),
    removeCardFromDeck: vi.fn(),
    updateCard: vi.fn(),
    renameDeck: vi.fn(),
    setDeckCategories: vi.fn(),
    updateDeckCategoryIds: vi.fn(),
    setUiPref,
  }),
}));

vi.mock("@/components/study/CardEditor", () => ({
  CardEditor: ({ prefillDaf }: { prefillDaf?: { masechta: string; daf: number; amud: 1 | 2 } }) => <div data-testid="card-editor-location">{prefillDaf ? `${prefillDaf.masechta}:${prefillDaf.daf}:${prefillDaf.amud}` : "none"}</div>,
}));

describe("ShasDeckBuilder step-by-step navigation", () => {
  it("advances from seder to masechta, daf and amud without crashing", () => {
    render(<ShasDeckBuilder purpose="question" mode="top-bottom" />);

    expect(screen.queryByText("ברכות")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "זרעים" }));
    expect(screen.getByText("בחר מסכת — סדר זרעים")).toBeInTheDocument();
    fireEvent.click(screen.getByText("ברכות"));
    expect(screen.getByText("בחר דפים — ברכות")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^דף ב/ }));
    expect(screen.getByText(/^בחר עמוד — דף ב/)).toBeInTheDocument();
    expect(screen.getByText("עמוד א׳")).toBeInTheDocument();
    expect(screen.getByText("עמוד ב׳")).toBeInTheDocument();
  });

  it("opens a pinned location directly in question creation", () => {
    render(<ShasDeckBuilder purpose="question" mode="top-bottom" />);

    fireEvent.click(screen.getByRole("button", { name: /עבור להצמדה ברכות/ }));

    expect(screen.getByText(/בחר עמוד — דף ג/)).toBeInTheDocument();
    expect(screen.getByTestId("card-editor-location")).toHaveTextContent("ברכות:3:2");
    expect(screen.getByText(/הסיווג שנבחר: ברכות/)).toBeInTheDocument();
  });

  it("navigates an exam builder to a pin without adding it to the exam", () => {
    render(<ShasDeckBuilder purpose="exam" mode="top-bottom" />);

    fireEvent.click(screen.getByRole("button", { name: /עבור להצמדה ברכות/ }));

    expect(screen.getByText(/בחר עמוד — דף ג/)).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("שאלות ייכללו במבחן")).toBeInTheDocument();
    expect(screen.getByText("גרור לכאן מסכת, דף או עמוד")).toBeInTheDocument();
  });
});
