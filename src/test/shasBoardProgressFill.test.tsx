import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetUiPref, mockState } = vi.hoisted(() => ({
  mockSetUiPref: vi.fn(),
  mockState: { uiPrefs: {} as Record<string, unknown> },
}));

vi.mock("@/lib/study/store", () => ({
  useStudy: () => ({ state: mockState, setUiPref: mockSetUiPref }),
}));
vi.mock("@/theme/ThemeProvider", () => ({
  THEME_TOKEN_KEYS: [],
  useTheme: () => ({
    allThemes: [{ id: "royal-navy", label: "מלכותי", description: "", swatch: [] }],
    getEffectiveTokens: () => ({}),
    theme: "royal-navy",
    duplicateTheme: vi.fn(() => "copy"),
  }),
}));
vi.mock("@/components/ThemeSwitcher", () => ({ ThemeEditorDialog: () => null }));
vi.mock("@/components/study/ShasExportDialog", () => ({ ShasExportDialog: () => null }));

import { ShasBoard } from "@/components/study/ShasBoard";

describe("Shas board progress-filled cards", () => {
  beforeEach(() => {
    mockSetUiPref.mockClear();
    mockState.uiPrefs = {};
  });

  it("opens on all masechtot by default and fills cards from the right", () => {
    mockState.uiPrefs = {
      shasBoardProgress: {
        ברכות: Object.fromEntries(Array.from({ length: 63 }, (_, index) => [index + 2, { a: 1 }])),
      },
    };
    render(<ShasBoard />);

    expect(screen.getByRole("tab", { name: "כל המסכתות" })).toHaveAttribute("aria-selected", "true");
    const fill = screen.getAllByRole("progressbar", { name: /מילוי התקדמות/ })[0];
    expect(fill).toHaveClass("right-0", "shas-progress-card__fill--surface");
    expect(fill).toHaveStyle({ width: "50%" });
  });

  it("loads and persists the navy-to-gold fill preference", async () => {
    mockState.uiPrefs = {
      shasBoardViewPrefs: { defaultsVersion: 1, activeTab: "flat", progressFillStyle: "navy-gold" },
    };
    render(<ShasBoard />);

    expect(document.querySelector('[data-progress-style="navy-gold"]')).toBeInTheDocument();
    await waitFor(() => expect(mockSetUiPref).toHaveBeenLastCalledWith(
      "shasBoardViewPrefs",
      expect.objectContaining({
        defaultsVersion: 1,
        activeTab: "flat",
        progressFillStyle: "navy-gold",
      }),
    ));
  });

  it("keeps a saved tab after the one-time default migration", () => {
    mockState.uiPrefs = {
      shasBoardViewPrefs: { defaultsVersion: 1, activeTab: "hierarchy", progressFillStyle: "bar" },
    };
    render(<ShasBoard />);

    expect(screen.getByRole("tab", { name: "לפי סדרים" })).toHaveAttribute("aria-selected", "true");
  });

  it.each([
    ["mosaic", "shas-progress-card__fill--mosaic"],
    ["heat", "shas-progress-card__fill--heat"],
    ["milestones", "shas-progress-card__fill--milestones"],
    ["book", "shas-progress-card__fill--book"],
  ] as const)("renders the saved %s progress visualization", (style, expectedClass) => {
    mockState.uiPrefs = {
      shasBoardViewPrefs: { defaultsVersion: 1, activeTab: "flat", progressFillStyle: style },
      shasBoardProgress: { ברכות: { 2: { a: 3, b: 2 } } },
    };
    render(<ShasBoard />);

    const fill = screen.getAllByRole("progressbar", { name: /מילוי התקדמות/ })[0];
    expect(fill).toHaveClass(expectedClass);
    expect(document.querySelector(`[data-progress-style="${style}"]`)).toBeInTheDocument();
    if (style === "heat") expect(fill).toHaveAttribute("data-repetitions");
    cleanup();
  });

  it("renders the saved progress-ring visualization with a numeric value", () => {
    mockState.uiPrefs = {
      shasBoardViewPrefs: { defaultsVersion: 1, activeTab: "flat", progressFillStyle: "ring" },
      shasBoardProgress: { ברכות: { 2: { a: 1 } } },
    };
    render(<ShasBoard />);

    expect(screen.getAllByRole("progressbar", { name: /טבעת התקדמות/ })[0]).toHaveAttribute("aria-valuenow");
    expect(document.querySelector('[data-progress-style="ring"]')).toBeInTheDocument();
  });
});
