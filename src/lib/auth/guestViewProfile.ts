import type { SidebarConfig, TabConfig, WidgetLayout } from "@/lib/study/types";

export type GuestPermissionMatrix = Record<string, boolean>;

export interface GuestViewProfile {
  id: string;
  label: string;
  roleId?: string;
  roleName?: string;
  isAdmin: boolean;
  roles: { id: string; name: string }[];
  matrix: GuestPermissionMatrix;
  sidebarConfig?: SidebarConfig[];
  tabConfig?: TabConfig[];
  widgetLayout?: WidgetLayout;
  createdAt: number;
  updatedAt: number;
}

const GUEST_ACTIVE_PROFILE_KEY = "guest-view:active-profile";
const GUEST_PROFILE_CATALOG_KEY = "guest-view:profiles";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function listGuestViewProfiles(): GuestViewProfile[] {
  if (typeof window === "undefined") return [];
  const parsed = safeParse<GuestViewProfile[]>(localStorage.getItem(GUEST_PROFILE_CATALOG_KEY), []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((p) => !!p && typeof p.id === "string")
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function saveGuestViewProfile(profile: Omit<GuestViewProfile, "createdAt" | "updatedAt">): GuestViewProfile {
  const now = Date.now();
  const all = listGuestViewProfiles();
  const existing = all.find((p) => p.id === profile.id);
  const next: GuestViewProfile = {
    ...profile,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const filtered = all.filter((p) => p.id !== profile.id);
  filtered.unshift(next);
  localStorage.setItem(GUEST_PROFILE_CATALOG_KEY, JSON.stringify(filtered));
  return next;
}

export function removeGuestViewProfile(profileId: string): void {
  const all = listGuestViewProfiles().filter((p) => p.id !== profileId);
  localStorage.setItem(GUEST_PROFILE_CATALOG_KEY, JSON.stringify(all));
  if (getActiveGuestViewProfileId() === profileId) {
    clearActiveGuestViewProfile();
  }
}

export function setActiveGuestViewProfile(profileId: string | null): void {
  if (!profileId) {
    clearActiveGuestViewProfile();
    return;
  }
  localStorage.setItem(GUEST_ACTIVE_PROFILE_KEY, profileId);
}

export function getActiveGuestViewProfileId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(GUEST_ACTIVE_PROFILE_KEY);
}

export function getActiveGuestViewProfile(): GuestViewProfile | null {
  const activeId = getActiveGuestViewProfileId();
  if (!activeId) return null;
  return listGuestViewProfiles().find((p) => p.id === activeId) ?? null;
}

export function clearActiveGuestViewProfile(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(GUEST_ACTIVE_PROFILE_KEY);
}
