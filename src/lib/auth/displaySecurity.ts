export const SECURITY_MODULE_SECTIONS: Record<string, string[]> = {
  cards: ["categories", "questions"],
  decks: ["decks"],
  goals: ["goals"],
  shas: ["shas-board"],
  // "analytics" is a legacy navigation alias, not another independently visible page.
  // Keeping it here granted access even after the actual Summary page was hidden.
  analytics: ["summary"],
  settings: ["settings"],
};

const SECURITY_ACTIONS = ["view", "create", "edit", "delete", "manage"] as const;
export const PROFILE_ACTIONS = ["create", "edit", "delete", "manage"] as const;

export type ProfileAction = typeof PROFILE_ACTIONS[number];
export type ProfileActionPermissions = Record<string, Partial<Record<ProfileAction | 'view', boolean>>>;

/** Only an explicit page-visibility edit changes shared view permissions. */
export function permissionsWithVisibility(permissions: ProfileActionPermissions, hiddenSections: string[]): ProfileActionPermissions {
  const hidden = new Set(hiddenSections);
  return Object.fromEntries(Object.entries(SECURITY_MODULE_SECTIONS).map(([module, sections]) =>
    [module, { ...permissions[module], view: sections.some(section => !hidden.has(section)) }]));
}

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
 * - Explicit shared view permissions take precedence over device layout.
 * - Legacy profiles derive view from page visibility until the first edit.
 * - Denied view also disables all actions of that module.
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
        const moduleVisible = actionPermissions[module]?.view ?? sectionIds.some((sectionId) => !hidden.has(sectionId));
        return SECURITY_ACTIONS.map((action) => ({
            role_id: role.id,
            module,
            action,
            allowed: moduleVisible && (action === "view" || actionPermissions[module]?.[action] === true),
          }));
      }),
    );
}
