import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/study/store", () => ({
  useStudy: () => ({
    state: { cards: [], categories: [], uiPrefs: {} },
    setUiPref: vi.fn(),
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

import { DafLearningTabInner } from "@/components/study/DafLearningTab";

describe("Daf learning amud navigation", () => {
  beforeEach(() => {
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

  it("switches from amud B to A and back without restoring the previous side", async () => {
    render(<DafLearningTabInner isVisible />);

    expect(screen.getByTestId("active-gemara-page")).toHaveTextContent("ברכות-13-2");
    expect(screen.getByTestId("inline-amud-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("inline-amud-1-count")).toHaveTextContent("0");
    expect(screen.getByTestId("inline-amud-2-count")).toHaveTextContent("0");

    fireEvent.click(screen.getByTestId("inline-amud-1"));
    await waitFor(() => expect(screen.getByTestId("active-gemara-page")).toHaveTextContent("ברכות-13-1"));
    expect(screen.getByTestId("inline-amud-1")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("inline-amud-2"));
    await waitFor(() => expect(screen.getByTestId("active-gemara-page")).toHaveTextContent("ברכות-13-2"));
    expect(screen.getByTestId("inline-amud-2")).toHaveAttribute("aria-pressed", "true");
  });
});
