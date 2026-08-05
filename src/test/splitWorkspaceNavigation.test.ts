import { describe, expect, it } from "vitest";
import {
  ALL_SIDEBAR_ITEMS,
  normalizeSplitWorkspaceSections,
  normalizeSplitWorkspaceSidebarConfig,
} from "@/lib/study/sidebarItems";
import { DEFAULT_SIDEBAR_ITEMS } from "@/config/sidebarItems";

const splitIds = ["categories", "decks", "questions"];

describe("split categories, exams and questions navigation", () => {
  it("publishes three independent profile choices and no legacy combined choice", () => {
    expect(ALL_SIDEBAR_ITEMS.filter((item) => splitIds.includes(item.id))).toEqual([
      { id: "categories", label: "קטגוריות" },
      { id: "decks", label: "יצירת מבחנים" },
      { id: "questions", label: "יצירת שאלות" },
    ]);
    expect(ALL_SIDEBAR_ITEMS.some((item) => item.id === "cards")).toBe(false);
    expect(DEFAULT_SIDEBAR_ITEMS.filter((item) => splitIds.includes(item.id)).map((item) => item.label)).toEqual([
      "קטגוריות",
      "יצירת מבחנים",
      "יצירת שאלות",
    ]);
    expect(DEFAULT_SIDEBAR_ITEMS.some((item) => item.id === "cards")).toBe(false);
  });

  it("expands a hidden legacy section into all three hidden pages", () => {
    expect(normalizeSplitWorkspaceSections(["home", "cards", "admin"])).toEqual([
      "home",
      "admin",
      "categories",
      "decks",
      "questions",
    ]);
  });

  it("expands old saved sidebar configuration while keeping visibility and order", () => {
    expect(normalizeSplitWorkspaceSidebarConfig([
      { id: "home", visible: true, order: 0 },
      { id: "cards", visible: false, order: 1 },
      { id: "search", visible: true, order: 2 },
    ])).toEqual([
      { id: "home", visible: true, order: 0 },
      { id: "categories", visible: false, order: 1 },
      { id: "decks", visible: false, order: 2 },
      { id: "questions", visible: false, order: 3 },
      { id: "search", visible: true, order: 4 },
    ]);
  });

  it("preserves explicit split choices instead of overriding them with legacy data", () => {
    const normalized = normalizeSplitWorkspaceSidebarConfig([
      { id: "cards", visible: false, order: 0 },
      { id: "categories", visible: true, order: 1 },
      { id: "decks", visible: false, order: 2 },
      { id: "questions", visible: true, order: 3 },
    ]);
    expect(normalized).toEqual([
      { id: "categories", visible: true, order: 0 },
      { id: "decks", visible: false, order: 1 },
      { id: "questions", visible: true, order: 2 },
    ]);
  });
});
