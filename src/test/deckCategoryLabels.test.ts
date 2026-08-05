import { describe, expect, it } from "vitest";
import { resolveDeckCategoryLabels } from "@/lib/study/deckCategoryLabels";

describe("resolveDeckCategoryLabels", () => {
  const categories = [
    { id: "6c0a9ad5-4444-493f-b18f-ec461d55d7ce", name: "חגיגה" },
  ];

  it("replaces stored category ids with readable names", () => {
    expect(resolveDeckCategoryLabels([categories[0].id], categories)).toEqual(["חגיגה"]);
  });

  it("hides orphaned UUIDs and keeps legacy readable labels", () => {
    expect(resolveDeckCategoryLabels([
      "c348d364-f774-4a38-a15e-2491aab7e80f",
      "ברכות",
      "ברכות",
    ], categories)).toEqual(["ברכות"]);
  });
});
