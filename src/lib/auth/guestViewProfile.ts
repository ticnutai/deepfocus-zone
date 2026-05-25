import type { SidebarConfig, TabConfig, WidgetLayout } from "@/lib/study/types";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getSiteSettingValue, updateSiteSettingCache } from "@/lib/siteSettingsCache";

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
const GUEST_PROFILES_SITE_KEY = "guest_view_profiles_v1";
const GUEST_DEFAULT_PROFILE_SITE_KEY = "guest_view_default_profile_id_v1";

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `guest-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
  return normalizeGuestProfiles(parsed);
}

function normalizeGuestProfiles(raw: unknown): GuestViewProfile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const p = item as Partial<GuestViewProfile>;
      return {
        id: typeof p.id === "string" && p.id ? p.id : makeId(),
        label: typeof p.label === "string" ? p.label : "אורח",
        roleId: typeof p.roleId === "string" ? p.roleId : undefined,
        roleName: typeof p.roleName === "string" ? p.roleName : undefined,
        isAdmin: !!p.isAdmin,
        roles: Array.isArray(p.roles)
          ? p.roles
              .filter((r) => !!r && typeof r.id === "string" && typeof r.name === "string")
              .map((r) => ({ id: r.id, name: r.name }))
          : [],
        matrix: p.matrix && typeof p.matrix === "object" && !Array.isArray(p.matrix)
          ? p.matrix as GuestPermissionMatrix
          : {},
        sidebarConfig: Array.isArray(p.sidebarConfig) ? p.sidebarConfig : undefined,
        tabConfig: Array.isArray(p.tabConfig) ? p.tabConfig : undefined,
        widgetLayout: p.widgetLayout && typeof p.widgetLayout === "object" ? p.widgetLayout : undefined,
        createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
        updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
      };
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function setGuestProfilesLocal(profiles: GuestViewProfile[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_PROFILE_CATALOG_KEY, JSON.stringify(normalizeGuestProfiles(profiles)));
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
  setGuestProfilesLocal(filtered);
  return next;
}

export function removeGuestViewProfile(profileId: string): void {
  const all = listGuestViewProfiles().filter((p) => p.id !== profileId);
  setGuestProfilesLocal(all);
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

export async function loadGuestViewProfilesFromSiteSettings(opts?: { force?: boolean }): Promise<GuestViewProfile[]> {
  const value = await getSiteSettingValue(GUEST_PROFILES_SITE_KEY, { force: !!opts?.force });
  return normalizeGuestProfiles(value);
}

export async function saveGuestViewProfilesToSiteSettings(profiles: GuestViewProfile[]): Promise<void> {
  const normalized = normalizeGuestProfiles(profiles);
  await supabase.from("site_settings").upsert(
    [{ key: GUEST_PROFILES_SITE_KEY, value: normalized as unknown as Json }],
    { onConflict: "key" },
  );
  updateSiteSettingCache(GUEST_PROFILES_SITE_KEY, normalized);
  setGuestProfilesLocal(normalized);
}

export async function loadGuestDefaultProfileIdFromSiteSettings(opts?: { force?: boolean }): Promise<string | null> {
  const value = await getSiteSettingValue(GUEST_DEFAULT_PROFILE_SITE_KEY, { force: !!opts?.force });
  return typeof value === "string" && value ? value : null;
}

export async function saveGuestDefaultProfileIdToSiteSettings(profileId: string | null): Promise<void> {
  const value = profileId ?? null;
  await supabase.from("site_settings").upsert(
    [{ key: GUEST_DEFAULT_PROFILE_SITE_KEY, value: value as unknown as Json }],
    { onConflict: "key" },
  );
  updateSiteSettingCache(GUEST_DEFAULT_PROFILE_SITE_KEY, value);
  if (profileId) {
    setActiveGuestViewProfile(profileId);
  } else {
    clearActiveGuestViewProfile();
  }
}

export async function hydrateGuestProfilesFromSiteSettings(opts?: { force?: boolean }): Promise<{
  profiles: GuestViewProfile[];
  defaultProfileId: string | null;
}> {
  const [profiles, defaultProfileId] = await Promise.all([
    loadGuestViewProfilesFromSiteSettings({ force: !!opts?.force }),
    loadGuestDefaultProfileIdFromSiteSettings({ force: !!opts?.force }),
  ]);

  setGuestProfilesLocal(profiles);
  const activeId = getActiveGuestViewProfileId();
  const hasDefault = !!defaultProfileId && profiles.some((p) => p.id === defaultProfileId);
  const hasActive = !!activeId && profiles.some((p) => p.id === activeId);

  if (hasDefault) {
    setActiveGuestViewProfile(defaultProfileId);
  } else if (!hasActive) {
    setActiveGuestViewProfile(profiles[0]?.id ?? null);
  }

  return {
    profiles,
    defaultProfileId: hasDefault ? defaultProfileId : null,
  };
}
