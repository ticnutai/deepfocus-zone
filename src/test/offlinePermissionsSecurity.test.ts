import { describe, expect, it } from "vitest";
import {
  LOCAL_OFFLINE_PROFILE_ID,
  sanitizeLocalOfflineProfile,
  type GuestViewProfile,
} from "@/lib/auth/guestViewProfile";
import { canAccessAppSection } from "@/lib/auth/sectionAccess";
import { resolvePublishedPermissions } from "@/lib/auth/localPermissionBoundary";

function unsafeOfflineProfile(): GuestViewProfile {
  return {
    id: LOCAL_OFFLINE_PROFILE_ID,
    label: "offline",
    roleId: "admin-role",
    roleName: "admin",
    isAdmin: true,
    roles: [{ id: "admin-role", name: "admin" }],
    matrix: {
      "users:manage": true,
      "roles:manage": true,
      "settings:manage": true,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("anonymous offline permission boundary", () => {
  it("strips administrator identity and management permissions", () => {
    const safe = sanitizeLocalOfflineProfile(unsafeOfflineProfile());

    expect(safe.isAdmin).toBe(false);
    expect(safe.roleId).toBeUndefined();
    expect(safe.roleName).toBe("local");
    expect(safe.roles).toEqual([{ id: LOCAL_OFFLINE_PROFILE_ID, name: "local" }]);
    expect(safe.matrix["users:manage"]).toBeUndefined();
    expect(safe.matrix["roles:manage"]).toBeUndefined();
    expect(safe.matrix["settings:manage"]).toBeUndefined();
  });

  it("keeps normal offline study actions available", () => {
    const safe = sanitizeLocalOfflineProfile(unsafeOfflineProfile());

    expect(safe.matrix["cards:view"]).toBe(true);
    expect(safe.matrix["cards:create"]).toBe(true);
    expect(safe.matrix["cards:edit"]).toBe(true);
    expect(safe.matrix["cards:delete"]).toBe(true);
  });

  it("cannot inherit a previously published administrator snapshot", () => {
    const staleAdmin = {
      isAdmin: true,
      roles: [{ id: "admin-role", name: "admin" }],
      matrix: { "users:manage": true, "roles:manage": true },
    };

    const published = resolvePublishedPermissions(staleAdmin, true, unsafeOfflineProfile());

    expect(published.isAdmin).toBe(false);
    expect(published.roles).toEqual([{ id: LOCAL_OFFLINE_PROFILE_ID, name: "local" }]);
    expect(published.matrix["users:manage"]).toBeUndefined();
    expect(published.matrix["roles:manage"]).toBeUndefined();
  });

  it("never grants administrator rights to a non-local guest preset", () => {
    const unsafeGuest = { ...unsafeOfflineProfile(), id: "guest-preview-admin" };
    const published = resolvePublishedPermissions(
      { isAdmin: true, roles: unsafeGuest.roles, matrix: unsafeGuest.matrix },
      true,
      unsafeGuest,
    );

    expect(published.isAdmin).toBe(false);
    expect(published.roles.some((role) => role.name === "admin")).toBe(false);
    expect(published.matrix["users:manage"]).toBeUndefined();
    expect(published.matrix["settings:manage"]).toBeUndefined();
  });
});

describe("section access security", () => {
  const localAccess = { isAdmin: false, canViewCards: true };

  it.each([
    "admin",
    "system-rubric",
    "db-inspector",
    "perf",
    "ai-generator",
    "question-lab",
    "sync-diagnostics",
  ])("blocks local offline users from %s", (sectionId) => {
    expect(canAccessAppSection(sectionId, localAccess)).toBe(false);
  });

  it("allows management sections to administrators", () => {
    expect(canAccessAppSection("admin", { isAdmin: true, canViewCards: true })).toBe(true);
    expect(canAccessAppSection("sync-diagnostics", { isAdmin: true, canViewCards: true })).toBe(true);
  });

  it("fails closed for a future unclassified section", () => {
    expect(canAccessAppSection("future-manager-screen", localAccess)).toBe(false);
  });
});
