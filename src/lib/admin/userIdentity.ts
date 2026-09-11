export type UserIdentityProfile = {
  display_name?: string | null;
  username?: string | null;
  email?: string | null;
};

export type OfflineIdentity = {
  display_name?: string | null;
  local_username?: string | null;
};

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i;
const OFFLINE_ID = /^offline-[0-9a-f-]{12,}$/i;

export function isTechnicalIdentity(value: string | null | undefined): boolean {
  const normalized = value?.trim();
  if (!normalized) return true;
  return normalized === "guest@local"
    || normalized.endsWith("@users.local")
    || OFFLINE_ID.test(normalized)
    || UUID_LIKE.test(normalized);
}

function firstPublicValue(...values: Array<string | null | undefined>): string | null {
  return values.map((value) => value?.trim()).find((value) => value && !isTechnicalIdentity(value)) ?? null;
}

/**
 * The admin UI must never expose UUIDs, offline device keys or synthetic
 * @users.local addresses as if they were a person's name or email.
 */
export function publicUserIdentity(
  profile?: UserIdentityProfile | null,
  offline?: OfflineIdentity | null,
): { name: string; email: string | null } {
  const username = firstPublicValue(profile?.username, offline?.local_username);
  const displayName = firstPublicValue(profile?.display_name, offline?.display_name);
  const email = firstPublicValue(profile?.email);
  return {
    name: username ?? displayName ?? email ?? "משתמש אופליין",
    email: email && email !== username ? email : null,
  };
}
