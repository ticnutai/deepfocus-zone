import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("ResizeObserver", class ResizeObserver {
  observe() { /* jsdom test shim */ }
  unobserve() { /* jsdom test shim */ }
  disconnect() { /* jsdom test shim */ }
});

const setUiPref = vi.fn();
const state = { uiPrefs: {} };

vi.mock("@/lib/study/store", () => ({
  useStudy: () => ({ state, setUiPref }),
}));

import {
  QuestionTypographyControl,
  useQuestionTypographyPreferences,
} from "@/components/study/QuestionTypographyControl";
import { QUIZ_TYPOGRAPHY_KEY } from "@/components/study/QuizTypographyPanel";

function Harness() {
  const preferences = useQuestionTypographyPreferences();
  return <QuestionTypographyControl preferences={preferences} />;
}

describe("QuestionTypographyControl", () => {
  beforeEach(() => {
    localStorage.clear();
    setUiPref.mockClear();
  });

  afterAll(() => vi.unstubAllGlobals());

  it("uses one T dialog and saves question styles locally and through uiPrefs", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "עיצוב טקסט שאלות ותשובות" }));
    fireEvent.click(screen.getByRole("button", { name: "מודגש" }));

    expect(JSON.parse(localStorage.getItem(QUIZ_TYPOGRAPHY_KEY) ?? "{}").fontWeight).toBe("700");
    expect(setUiPref).toHaveBeenCalledWith("studyTypography", expect.objectContaining({ fontWeight: "700" }));
  });
});
