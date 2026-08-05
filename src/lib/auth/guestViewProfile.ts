import type { Card, CardDeckLink, Category, Deck, SidebarConfig, TabConfig, WidgetLayout } from "@/lib/study/types";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getSiteSettingValue, updateSiteSettingCache } from "@/lib/siteSettingsCache";

export type GuestPermissionMatrix = Record<string, boolean>;

export const LOCAL_OFFLINE_PROFILE_ID = "local-offline";
export const LOCAL_OFFLINE_MATRIX: GuestPermissionMatrix = Object.fromEntries(
  ["decks", "cards", "goals", "shas", "analytics", "settings"].flatMap((module) =>
    // Match a normal registered user. `manage` is deliberately excluded:
    // anonymous offline entry must never become a management role.
    ["view", "create", "edit", "delete"].map((action) => [`${module}:${action}`, true]),
  ),
);

export interface GuestStudySeed {
  seededAt: number;
  categories: Category[];
  decks: Deck[];
  cards: Card[];
  cardDecks: CardDeckLink[];
  deckCategories?: Record<string, string[]>;
}

export function hasUsableGuestCategoryTree(categories: Pick<Category, "id" | "parentId">[]): boolean {
  if (categories.length === 0) return true;

  const ids = new Set(categories.map((category) => category.id));
  let rootCount = 0;
  let brokenParentCount = 0;
  for (const category of categories) {
    if (!category.parentId) {
      rootCount += 1;
      continue;
    }
    if (!ids.has(category.parentId)) {
      brokenParentCount += 1;
    }
  }

  return rootCount > 0 && brokenParentCount < categories.length;
}

export function isGuestStudySeedStructurallyUsable(seed: GuestStudySeed | undefined): boolean {
  if (!seed) return false;
  const hasMeaningfulData = seed.categories.length > 0
    || seed.decks.length > 0
    || seed.cards.length > 0
    || seed.cardDecks.length > 0;
  if (!hasMeaningfulData) return true;
  return hasUsableGuestCategoryTree(seed.categories);
}

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
  studySeed?: GuestStudySeed;
  /**
   * Optional registered-user id whose cloud data (categories/cards/decks) this
   * guest profile should mirror. When null/undefined, falls back to the global
   * guest_source site-setting.
   */
  sourceUserId?: string | null;
  createdAt: number;
  updatedAt: number;
}

const sanitizeGuestMatrix = (matrix: GuestPermissionMatrix): GuestPermissionMatrix => Object.fromEntries(
  Object.entries(matrix).filter(([key, allowed]) => {
    if (!allowed) return false;
    const [module, action] = key.split(":");
    return module !== "users" && module !== "roles" && action !== "manage";
  }),
);

/**
 * Guest profiles are display/content presets, never authenticated identities.
 * Strip administrator identity at persistence time so stale/cloud snapshots
 * cannot leak into navigation, layout resolution or permission loading.
 */
export function sanitizeGuestViewProfile(profile: GuestViewProfile): GuestViewProfile {
  if (profile.id === LOCAL_OFFLINE_PROFILE_ID) return sanitizeLocalOfflineProfile(profile);

  const hadAdminIdentity = profile.isAdmin
    || profile.roleName === "admin"
    || profile.roles.some((role) => role.name === "admin");

  return {
    ...profile,
    roleId: hadAdminIdentity ? undefined : profile.roleId,
    roleName: hadAdminIdentity ? "guest" : profile.roleName,
    isAdmin: false,
    roles: profile.roles.filter((role) => role.name !== "admin"),
    matrix: sanitizeGuestMatrix(profile.matrix ?? {}),
    sidebarConfig: hadAdminIdentity ? undefined : profile.sidebarConfig,
    tabConfig: hadAdminIdentity ? undefined : profile.tabConfig,
    widgetLayout: hadAdminIdentity ? undefined : profile.widgetLayout,
  };
}

/** Enforce the non-admin security boundary for the machine-local account. */
export function sanitizeLocalOfflineProfile(profile: GuestViewProfile): GuestViewProfile {
  if (profile.id !== LOCAL_OFFLINE_PROFILE_ID) return sanitizeGuestViewProfile(profile);
  return {
    ...profile,
    // A synthetic, non-cloud role id lets the unified display-profile manager
    // assign an offline layout without ever resolving an administrator role.
    roleId: LOCAL_OFFLINE_PROFILE_ID,
    roleName: "local",
    isAdmin: false,
    roles: [{ id: LOCAL_OFFLINE_PROFILE_ID, name: "local" }],
    matrix: { ...LOCAL_OFFLINE_MATRIX },
    // Legacy guest profiles used to embed an entire admin-shaped layout. The
    // unified role/display profile is now the only source for these settings.
    sidebarConfig: undefined,
    tabConfig: undefined,
    widgetLayout: undefined,
  };
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
  return attachCachedSeeds(normalizeGuestProfiles(parsed));
}

function normalizeGuestProfiles(raw: unknown): GuestViewProfile[] {
  if (!Array.isArray(raw)) return [];

  const normalizeSeed = (seed: unknown): GuestStudySeed | undefined => {
    if (!seed || typeof seed !== "object" || Array.isArray(seed)) return undefined;
    const rawSeed = seed as Partial<GuestStudySeed>;
    const normalized: GuestStudySeed = {
      seededAt: typeof rawSeed.seededAt === "number" ? rawSeed.seededAt : Date.now(),
      categories: Array.isArray(rawSeed.categories) ? rawSeed.categories : [],
      decks: Array.isArray(rawSeed.decks) ? rawSeed.decks : [],
      cards: Array.isArray(rawSeed.cards) ? rawSeed.cards : [],
      cardDecks: Array.isArray(rawSeed.cardDecks) ? rawSeed.cardDecks : [],
      deckCategories:
        rawSeed.deckCategories && typeof rawSeed.deckCategories === "object" && !Array.isArray(rawSeed.deckCategories)
          ? (rawSeed.deckCategories as Record<string, string[]>)
          : undefined,
    };
            return isGuestStudySeedStructurallyUsable(normalized) ? normalized : undefined;
  };

  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const p = item as Partial<GuestViewProfile>;
      return sanitizeGuestViewProfile({
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
        studySeed: normalizeSeed(p.studySeed),
        sourceUserId: typeof p.sourceUserId === "string" && p.sourceUserId ? p.sourceUserId : null,
        createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
        updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
      });
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

// In-memory cache for the heavy studySeed data. Storing seeds in
// localStorage can easily exceed the ~5MB quota (a single profile can hold
// tens of thousands of cards), so we keep seeds out of disk persistence and
// rely on the cloud (site_settings) as the source of truth.
const seedCache = new Map<string, GuestStudySeed>();

function attachCachedSeeds(profiles: GuestViewProfile[]): GuestViewProfile[] {
  return profiles.map((p) => {
    if (p.studySeed) return p;
    const cached = seedCache.get(p.id);
    return cached ? { ...p, studySeed: cached } : p;
  });
}

function setGuestProfilesLocal(profiles: GuestViewProfile[]): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeGuestProfiles(profiles);
  // Cache seeds in memory, then strip them before writing to localStorage
  // to avoid QuotaExceededError on large datasets.
  const stripped = normalized.map((p) => {
    if (p.studySeed) seedCache.set(p.id, p.studySeed);
    const { studySeed: _omit, ...rest } = p;
    return rest as GuestViewProfile;
  });
  try {
    localStorage.setItem(GUEST_PROFILE_CATALOG_KEY, JSON.stringify(stripped));
  } catch (err) {
    console.warn("[guest-view] failed to persist profiles to localStorage", err);
  }
}

export function saveGuestViewProfile(profile: Omit<GuestViewProfile, "createdAt" | "updatedAt">): GuestViewProfile {
  const now = Date.now();
  const all = listGuestViewProfiles();
  const existing = all.find((p) => p.id === profile.id);
  const next = sanitizeGuestViewProfile({
    ...profile,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
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
  // Strip heavy studySeed before pushing to site_settings — it can easily exceed
  // PostgREST request-size limits and cause silent 413/500 failures. The seed
  // stays in localStorage and is re-merged by hydrateGuestProfilesFromSiteSettings.
  const lightweight = normalized.map(({ studySeed: _omit, ...rest }) => rest) as GuestViewProfile[];
  const { error } = await supabase.from("site_settings").upsert(
    [{ key: GUEST_PROFILES_SITE_KEY, value: lightweight as unknown as Json }],
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
  updateSiteSettingCache(GUEST_PROFILES_SITE_KEY, lightweight);
  setGuestProfilesLocal(normalized);
}

export async function loadGuestDefaultProfileIdFromSiteSettings(opts?: { force?: boolean }): Promise<string | null> {
  const value = await getSiteSettingValue(GUEST_DEFAULT_PROFILE_SITE_KEY, { force: !!opts?.force });
  return typeof value === "string" && value ? value : null;
}

export async function saveGuestDefaultProfileIdToSiteSettings(profileId: string | null): Promise<void> {
  const value = profileId ?? null;
  const { error } = await supabase.from("site_settings").upsert(
    [{ key: GUEST_DEFAULT_PROFILE_SITE_KEY, value: value as unknown as Json }],
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
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
  const localProfiles = listGuestViewProfiles();
  const [profiles, defaultProfileId] = await Promise.all([
    loadGuestViewProfilesFromSiteSettings({ force: !!opts?.force }),
    loadGuestDefaultProfileIdFromSiteSettings({ force: !!opts?.force }),
  ]);

  const mergedProfiles = profiles.map((profile) => {
    if (profile.studySeed) return profile;
    const local = localProfiles.find((candidate) => candidate.id === profile.id);
    if (!local?.studySeed) return profile;
    return {
      ...profile,
      studySeed: local.studySeed,
      updatedAt: Math.max(profile.updatedAt, local.updatedAt),
    };
  });

  setGuestProfilesLocal(mergedProfiles);
  const activeId = getActiveGuestViewProfileId();
  const hasDefault = !!defaultProfileId && mergedProfiles.some((p) => p.id === defaultProfileId);
  const hasActive = !!activeId && mergedProfiles.some((p) => p.id === activeId);

  if (hasDefault) {
    setActiveGuestViewProfile(defaultProfileId);
  } else if (!hasActive) {
    setActiveGuestViewProfile(mergedProfiles[0]?.id ?? null);
  }

  return {
    profiles: mergedProfiles,
    defaultProfileId: hasDefault ? defaultProfileId : null,
  };
}
