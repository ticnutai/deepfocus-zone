import { describe, expect, it } from "vitest";
import { getHomeLocation } from "@/lib/study/homeNavigation";

describe("getHomeLocation", () => {
  it("clears stale section and workspace deep links", () => {
    expect(getHomeLocation("http://localhost:5000/?section=decks&workspace=decks&previewRole=abc#top"))
      .toBe("/?previewRole=abc#top");
  });

  it("keeps the clean home URL unchanged", () => {
    expect(getHomeLocation("app://local/")).toBe("/");
  });

  it("clears stale Electron HashRouter deep links", () => {
    expect(getHomeLocation("file:///C:/app/dist/index.html#/?section=decks&workspace=decks&previewRole=guest"))
      .toBe("/C:/app/dist/index.html#/?previewRole=guest");
  });
});
