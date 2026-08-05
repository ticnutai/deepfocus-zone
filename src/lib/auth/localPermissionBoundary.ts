import {
  LOCAL_OFFLINE_PROFILE_ID,
  sanitizeGuestViewProfile,
  type GuestViewProfile,
} from "@/lib/auth/guestViewProfile";

export type PublishedPermissionSnapshot = {
  isAdmin: boolean;
  matrix: Record<string, boolean>;
  roles: { id: string; name: string }[];
};

/**
 * Fail closed during an account transition. In particular, never publish a
 * previous cloud administrator snapshot while local/offline mode is active.
 */
export function resolvePublishedPermissions(
  current: PublishedPermissionSnapshot,
  isGuest: boolean,
  guestProfile: GuestViewProfile | null,
): PublishedPermissionSnapshot {
  if (!isGuest) return current;

  // No anonymous/guest session may ever become an administrator. Guest view
  // profiles are presentation presets, not authentication identities.
  if (!guestProfile) return { isAdmin: false, matrix: {}, roles: [] };
  if (guestProfile.id === LOCAL_OFFLINE_PROFILE_ID) {
    const safe = sanitizeGuestViewProfile(guestProfile);
    return { isAdmin: false, matrix: safe.matrix, roles: safe.roles };
  }

  const safe = sanitizeGuestViewProfile(guestProfile);
  return {
    isAdmin: false,
    matrix: safe.matrix,
    roles: safe.roles,
  };
}
