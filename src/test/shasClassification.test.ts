import { describe, expect, it } from "vitest";
import { formatShasLocation, replaceCategoryTagsWithShasLocation, shasCategoryPath } from "@/lib/study/shasClassification";

describe("canonical Shas classification", () => {
  const location = { masechta: "שבת", daf: 2, amud: 1 as const };

  it("builds the existing category chain without a parallel classification", () => {
    expect(shasCategoryPath(location)).toEqual(['ש"ס', "מועד", "שבת", "שבת · ב.", 'שבת · ב. · ע"א']);
    expect(formatShasLocation(location)).toBe("שבת · דף ב · עמוד א׳");
  });

  it("replaces an old category assignment while preserving non-category provenance", () => {
    expect(replaceCategoryTagsWithShasLocation(["source:web", "cat:ללא סיווג"], location)).toEqual([
      "source:web", 'cat:ש"ס', "cat:מועד", "cat:שבת", "cat:שבת · ב.", 'cat:שבת · ב. · ע"א',
    ]);
  });
});
