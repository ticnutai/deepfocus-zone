import { describe, it, expect } from "vitest";
import { toHebrewNum, amudLetter, formatShasPosition } from "@/lib/study/shasFormat";

// ─── toHebrewNum ──────────────────────────────────────────────────────────────

describe("toHebrewNum", () => {
  it("converts 1 → א", () => expect(toHebrewNum(1)).toBe("א"));
  it("converts 2 → ב", () => expect(toHebrewNum(2)).toBe("ב"));
  it("converts 10 → י", () => expect(toHebrewNum(10)).toBe("י"));
  it("converts 11 → יא", () => expect(toHebrewNum(11)).toBe("יא"));
  it("converts 14 → יד", () => expect(toHebrewNum(14)).toBe("יד"));
  // 15 and 16 use special forms to avoid divine names
  it("converts 15 → טו (not יה)", () => expect(toHebrewNum(15)).toBe("טו"));
  it("converts 16 → טז (not יו)", () => expect(toHebrewNum(16)).toBe("טז"));
  it("converts 20 → כ", () => expect(toHebrewNum(20)).toBe("כ"));
  it("converts 100 → ק", () => expect(toHebrewNum(100)).toBe("ק"));
  it("converts 115 → קטו (not קיה)", () => expect(toHebrewNum(115)).toBe("קטו"));
  it("converts 116 → קטז (not קיו)", () => expect(toHebrewNum(116)).toBe("קטז"));
  it("converts 400 → ת", () => expect(toHebrewNum(400)).toBe("ת"));
  it("returns empty string for 0", () => expect(toHebrewNum(0)).toBe(""));
});

// ─── amudLetter ───────────────────────────────────────────────────────────────

describe("amudLetter", () => {
  it("amud 1 → א'", () => expect(amudLetter(1)).toBe("א'"));
  it("amud 2 → ב'", () => expect(amudLetter(2)).toBe("ב'"));
});

// ─── formatShasPosition ───────────────────────────────────────────────────────

describe("formatShasPosition", () => {
  it("formats daf without half", () => {
    const result = formatShasPosition("ברכות", 2, 1, null);
    expect(result).toBe("ברכות דף ב' עמוד א'");
  });

  it("includes חצי ראשון when half=1", () => {
    const result = formatShasPosition("שבת", 5, 2, 1);
    expect(result).toContain("חצי ראשון");
  });

  it("includes חצי שני when half=2", () => {
    const result = formatShasPosition("שבת", 5, 1, 2);
    expect(result).toContain("חצי שני");
  });

  it("handles large daf number (115 = קטו)", () => {
    const result = formatShasPosition("בבא בתרא", 115, 1, null);
    expect(result).toContain("קטו");
    expect(result).not.toContain("קיה");
  });
});
