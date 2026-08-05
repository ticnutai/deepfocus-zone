export const SECURITY_MODULE_SECTIONS: Record<string, string[]> = {
  cards: ["categories", "questions"],
  decks: ["decks"],
  goals: ["goals"],
  shas: ["shas-board"],
  analytics: ["summary", "analytics"],
  settings: ["settings"],
};

const SECURITY_ACTIONS = ["view", "create", "edit", "delete", "manage"] as const;
export const PROFILE_ACTIONS = ["create", "edit", "delete", "manage"] as const;

export type ProfileAction = typeof PROFILE_ACTIONS[number];
export type ProfileActionPermissions = Record<string, Partial<Record<ProfileAction, boolean>>>;

export interface SecurityRoleRef {
  id: string;
  name: string;
}

export interface DisplaySecurityRow {
  role_id: string;
  module: string;
  action: typeof SECURITY_ACTIONS[number];
  allowed: boolean;
}

/**
 * Convert one display choice into the matching security writes.
 *
 * - At least one visible page for a module grants `view` and applies the
 *   profile's action switches.
 * - Hiding every page for a module revokes every action, so a hidden module
 *   cannot remain writable through a direct API call.
 * - Administrator and synthetic local roles are never mutated here.
 */
export function buildDisplaySecurityRows(
  hiddenSections: string[],
  roles: SecurityRoleRef[],
  localRoleId: string,
  actionPermissions: ProfileActionPermissions = {},
): DisplaySecurityRow[] {
  const hidden = new Set(hiddenSections);
  return roles
    .filter((role) => role.id !== localRoleId && role.name !== "admin")
    .flatMap((role) =>
      Object.entries(SECURITY_MODULE_SECTIONS).flatMap(([module, sectionIds]) => {
        const moduleVisible = sectionIds.some((sectionId) => !hidden.has(sectionId));
        return SECURITY_ACTIONS.map((action) => ({
            role_id: role.id,
            module,
            action,
            allowed: moduleVisible && (action === "view" || actionPermissions[module]?.[action] === true),
          }));
      }),
    );
}
