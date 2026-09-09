import { describe, expect, it } from "vitest";
import { buildDisplaySecurityRows, permissionsWithVisibility } from "@/lib/auth/displaySecurity";

const roles = [{ id: "user-role", name: "user" }];

describe("display profile security synchronization", () => {
  it('preserves explicit shared view denial even if mobile pages are visible', () => {
    const rows = buildDisplaySecurityRows([], roles, 'local-offline', { cards: { view: false, edit: true } });
    expect(rows.filter(row => row.module === 'cards').every(row => !row.allowed)).toBe(true);
  });
  it('changes shared view only on an explicit visibility edit', () => {
    const permissions = { cards: { view: false, edit: true } };
    expect(permissionsWithVisibility(permissions, []).cards).toEqual({ view: true, edit: true });
    expect(permissions.cards.view).toBe(false);
    expect(permissionsWithVisibility(permissions, ['categories', 'questions']).cards.view).toBe(false);
  });
  it("grants view and applies profile actions when at least one page of the module is visible", () => {
    const rows = buildDisplaySecurityRows(["categories"], roles, "local-offline", {
      cards: { edit: true, delete: false },
    });
    expect(rows).toContainEqual({
      role_id: "user-role",
      module: "cards",
      action: "view",
      allowed: true,
    });
    expect(rows).toContainEqual({
      role_id: "user-role",
      module: "cards",
      action: "edit",
      allowed: true,
    });
    expect(rows).toContainEqual({
      role_id: "user-role",
      module: "cards",
      action: "delete",
      allowed: false,
    });
  });

  it("revokes every action when every page of a module is hidden", () => {
    const rows = buildDisplaySecurityRows(["categories", "questions"], roles, "local-offline")
      .filter((row) => row.module === "cards");
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.allowed === false)).toBe(true);
  });

  it("never mutates administrator or synthetic local permissions", () => {
    const rows = buildDisplaySecurityRows([], [
      { id: "admin-role", name: "admin" },
      { id: "local-offline", name: "local" },
    ], "local-offline");
    expect(rows).toEqual([]);
  });
  it('hiding Summary also blocks its legacy analytics alias', () => {
    const rows = buildDisplaySecurityRows(['summary'], roles, 'local-offline', {analytics:{create:true,edit:true,delete:true}})
      .filter((row) => row.module === 'analytics');
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => !row.allowed)).toBe(true);
  });
});
