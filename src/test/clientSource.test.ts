import { afterEach, describe, expect, it } from "vitest";
import { clientSource, sourceFromTags, withClientSource } from "@/lib/app/clientSource";

describe("client source tracking", () => {
  afterEach(() => { delete window.desktop; });

  it("labels browser questions as web", () => {
    expect(clientSource()).toBe("web");
    expect(withClientSource(["cat:כללי"])).toEqual(["cat:כללי", "source:client:web"]);
  });

  it("labels Electron questions as desktop and replaces stale labels", () => {
    window.desktop = { isElectron: true } as typeof window.desktop;
    const tags = withClientSource(["source:client:web", "cat:כללי"]);
    expect(tags).toEqual(["cat:כללי", "source:client:desktop"]);
    expect(sourceFromTags(tags)).toBe("desktop");
  });

  it("keeps legacy questions explicitly unclassified", () => {
    expect(sourceFromTags(["cat:כללי"])).toBeNull();
  });
});
