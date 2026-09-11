import { describe, expect, it } from "vitest";
import { normalizeContentAccessProfile } from "@/lib/study/layoutProfiles";

describe("content access profile", () => {
  it("keeps existing profiles safe by default", () => {
    expect(normalizeContentAccessProfile(undefined)).toEqual({
      includeOwn: true,
      includeSiteLibrary: false,
      approvedOnly: true,
      sourceUserIds: [],
    });
  });

  it("normalizes several contributor identities without duplicates", () => {
    expect(normalizeContentAccessProfile({
      includeOwn: false,
      includeSiteLibrary: true,
      approvedOnly: false,
      sourceUserIds: ["source-a", "source-a", "source-b", "", 7],
    })).toEqual({
      includeOwn: false,
      includeSiteLibrary: true,
      approvedOnly: false,
      sourceUserIds: ["source-a", "source-b"],
    });
  });
});
