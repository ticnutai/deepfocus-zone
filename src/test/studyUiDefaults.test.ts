import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_ITEMS, isDefaultSidebarItemVisible } from "@/config/sidebarItems";
import { STUDY_UI_DEFAULTS } from "@/config/studyUiDefaults";

describe("clean-install study UI defaults", () => {
  it("uses the approved step-by-step learning and builder layouts", () => {
    expect(STUDY_UI_DEFAULTS).toEqual({
      dafLearningLayout: "stacked",
      dafLearningNavigationView: "drilldown",
      questionCreationLayout: "content-tree",
      deckBuilderLayout: "shas-spacious",
      deckBuilderNavigationMode: "drilldown",
    });
  });

  it("uses the compact approved sidebar order and leaves permission filtering to runtime", () => {
    const visible = DEFAULT_SIDEBAR_ITEMS
      .filter((item) => isDefaultSidebarItemVisible(item.id))
      .map((item) => item.id);

    expect(visible).toEqual([
      "home",
      "daf",
      "admin",
      "settings",
      "questions",
      "decks",
      "categories",
      "search",
      "study",
      "shas-board",
      "summary",
    ]);
    expect(isDefaultSidebarItemVisible("system-rubric")).toBe(false);
    expect(isDefaultSidebarItemVisible("db-inspector")).toBe(false);
  });
});
