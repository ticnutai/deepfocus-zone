import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShasDeckBuilder } from "@/components/study/ShasDeckBuilder";

const setUiPref = vi.fn();

vi.mock("@/lib/study/store", () => ({
  useStudy: () => ({
    state: { cards: [], categories: [], decks: [], cardDecks: [], uiPrefs: { deckBuilderNavigationMode: "drilldown" } },
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
});
