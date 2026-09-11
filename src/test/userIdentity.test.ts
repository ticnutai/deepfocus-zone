import { describe, expect, it } from "vitest";
import { isTechnicalIdentity, publicUserIdentity } from "@/lib/admin/userIdentity";

describe("admin user identity", () => {
  it("shows only a real username and email", () => {
    expect(publicUserIdentity({ username: "utkrizer", display_name: "יוטי", email: "user@example.com" }))
      .toEqual({ name: "utkrizer", email: "user@example.com" });
  });

  it("never exposes synthetic offline identifiers", () => {
    const identity = publicUserIdentity(
      { username: "offline-1d7dd2bbc86d419786d5bb3912418df6", email: "offline-1d7dd2bbc86d419786d5bb3912418df6@users.local" },
      { local_username: "offline-1d7dd2bbc86d419786d5bb3912418df6", display_name: "עבודה מקומית (אופליין)" },
    );
    expect(identity).toEqual({ name: "עבודה מקומית (אופליין)", email: null });
    expect(isTechnicalIdentity(identity.name)).toBe(false);
  });
});
