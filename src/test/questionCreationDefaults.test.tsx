import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetUiPref, mockState } = vi.hoisted(() => ({
  mockSetUiPref: vi.fn(),
  mockState: { uiPrefs: {} as Record<string, unknown> },
}));

vi.mock("@/lib/study/store", () => ({
  useStudy: () => ({ state: mockState, setUiPref: mockSetUiPref }),
}));
vi.mock("@/components/study/CardEditor", () => ({
  CardEditor: () => <div data-testid="classic-question-editor" />,
}));
vi.mock("@/components/study/ShasDeckBuilder", () => ({
  ShasDeckBuilder: ({ questionCreationLayout, onQuestionCreationLayoutChange }: {
    questionCreationLayout?: string;
    onQuestionCreationLayoutChange?: (layout: "classic" | "content-tree") => void;
  }) => (
    <div data-testid="content-tree-question-builder" data-layout={questionCreationLayout}>
      <button type="button" onClick={() => onQuestionCreationLayoutChange?.("classic")}>החלף לטופס רגיל</button>
    </div>
  ),
}));

import { QuestionCreationPage } from "@/components/study/QuestionCreationPage";

describe("question creation layout defaults", () => {
  beforeEach(() => {
    mockSetUiPref.mockClear();
    mockState.uiPrefs = {};
    localStorage.clear();
    localStorage.setItem("question-creation-guide-hidden-v1", "1");
  });

  it("starts with content tree and persists a personal override locally and to synced UI preferences", async () => {
    render(<QuestionCreationPage />);

    expect(screen.getByTestId("content-tree-question-builder")).toHaveAttribute("data-layout", "content-tree");
    fireEvent.click(screen.getByRole("button", { name: "החלף לטופס רגיל" }));

    expect(mockSetUiPref).toHaveBeenCalledWith("questionCreationLayout", "classic");
    expect(screen.getByTestId("classic-question-editor")).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("question-creation-layout-v1")).toBe("classic"));
  });
});
