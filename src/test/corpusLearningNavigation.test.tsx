import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/study/store", () => ({ useStudy: () => ({ state: { cards: [], categories: [], uiPrefs: {} }, setUiPref: vi.fn() }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: "/" }) }));
vi.mock("@/components/study/SefariaTextViewer", () => ({ SefariaTextViewer: ({ sefariaRef }: { sefariaRef: string }) => <div data-testid="text-reference">{sefariaRef}</div> }));
vi.mock("@/components/study/StudySession", () => ({ StudySession: () => null }));
vi.mock("@/components/study/CardDecksDialog", () => ({ CardDecksDialog: () => null }));
vi.mock("@/components/study/ProgressShortcut", () => ({ ProgressShortcut: () => null }));
import { ChumashLearningTab } from "@/components/study/ChumashLearningTab";
import { MishnaLearningTab } from "@/components/study/MishnaLearningTab";
import { NeviimKetuvimLearningTab } from "@/components/study/NeviimKetuvimLearningTab";
beforeEach(() => localStorage.clear());
for (const [name, Component, path, ref] of [
  ["chumash", ChumashLearningTab, ["בראשית", "פרק א", "פסוק ב"], "Genesis.1.2"],
  ["nach", NeviimKetuvimLearningTab, ["נביאים", "יהושע", "פרק א", "פסוק ב"], "Joshua.1.2"],
  ["mishna", MishnaLearningTab, ["זרעים", "ברכות", "פרק א", "משנה ב"], "Mishnah_Berakhot.1.2"],
] as const) it(`${name}: replaces steps, requires final choice and shows questions before text`, () => {
  render(<Component />);
  const layoutPicker = screen.getByRole("combobox", { name: "פריסת שאלות וטקסט" });
  expect(layoutPicker).not.toHaveTextContent("שאלות ואחריהן הטקסט");
  expect(layoutPicker.querySelector("svg")).not.toBeNull();
  const nav = screen.getByLabelText("בחירה שלב אחר שלב");
  for (const label of path) {
    expect(screen.getByTestId("questions-before-text")).not.toBeVisible();
    const button = within(nav).getByRole("button", { name: label, exact: true });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
  }
  const content = screen.getByTestId("questions-before-text");
  expect(content).toBeVisible();
  expect(content.children[0]).toHaveAttribute("aria-label", "שאלות");
  expect(content.children[1]).toHaveAttribute("aria-label", "טקסט הלימוד");
  expect(within(content).getByTestId("text-reference")).toHaveTextContent(ref);
  fireEvent.click(within(nav).getByRole("button", { name: /חזרה/ }));
  expect(content).not.toBeVisible();
});
