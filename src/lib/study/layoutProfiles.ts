import { supabase } from "@/integrations/supabase/client";
import { getSiteSettingValue, updateSiteSettingCache } from "@/lib/siteSettingsCache";
import type { SidebarConfig, WidgetLayout } from "@/lib/study/types";

export interface LayoutProfileCategory {
  id: string;
  name: string;
  color?: string | null;
}

export interface RoleLayoutProfile {
  id: string;
  name: string;
  widgetLayout: WidgetLayout;
  sidebarConfig: SidebarConfig[];
  categoryTemplate: LayoutProfileCategory[];
  updatedAt: number;
}

export interface RoleLayoutProfileAssignment {
  id: string;
  roleId: string;
  profileId: string;
}

export interface ResolvedRoleLayoutProfile {
  roleId: string;
  profileId: string;
  profileName: string;
  widgetLayout: WidgetLayout;
  sidebarConfig: SidebarConfig[];
  categoryTemplate: LayoutProfileCategory[];
}

const LAYOUT_PROFILES_KEY = "role_layout_profiles_v1";
const LAYOUT_ASSIGNMENTS_KEY = "role_layout_profile_assignments_v1";

let profilesCache: RoleLayoutProfile[] | null = null;
let assignmentsCache: RoleLayoutProfileAssignment[] | null = null;

const uuid = () => (typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const normalizeProfile = (item: unknown): RoleLayoutProfile | null => {
  if (!item || typeof item !== "object") return null;
  const raw = item as Partial<RoleLayoutProfile> & {
    widgetLayout?: unknown;
    sidebarConfig?: unknown;
    categoryTemplate?: unknown;
  };
  return {
    id: typeof raw.id === "string" ? raw.id : uuid(),
    name: typeof raw.name === "string" ? raw.name : "ללא שם",
    widgetLayout: (raw.widgetLayout && typeof raw.widgetLayout === "object" && !Array.isArray(raw.widgetLayout))
      ? (raw.widgetLayout as WidgetLayout)
      : {},
    sidebarConfig: Array.isArray(raw.sidebarConfig) ? (raw.sidebarConfig as SidebarConfig[]) : [],
    categoryTemplate: Array.isArray(raw.categoryTemplate) ? (raw.categoryTemplate as LayoutProfileCategory[]) : [],
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
};

const normalizeProfiles = (value: unknown): RoleLayoutProfile[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeProfile(item))
    .filter((item): item is RoleLayoutProfile => !!item);
};

const normalizeAssignments = (value: unknown): RoleLayoutProfileAssignment[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const raw = item as Partial<RoleLayoutProfileAssignment>;
      return {
        id: typeof raw.id === "string" ? raw.id : uuid(),
        roleId: typeof raw.roleId === "string" ? raw.roleId : "",
        profileId: typeof raw.profileId === "string" ? raw.profileId : "",
      };
    })
    .filter((row) => row.roleId && row.profileId);
};

export async function loadRoleLayoutProfiles(opts?: { force?: boolean }): Promise<RoleLayoutProfile[]> {
  const force = !!opts?.force;
  if (!force && profilesCache) return profilesCache;
  const value = await getSiteSettingValue(LAYOUT_PROFILES_KEY, { force });
  const rows = normalizeProfiles(value);
  profilesCache = rows;
  updateSiteSettingCache(LAYOUT_PROFILES_KEY, rows);
  return rows;
}

export async function saveRoleLayoutProfiles(value: RoleLayoutProfile[]): Promise<void> {
  const normalized = normalizeProfiles(value);
  await supabase.from("site_settings").upsert(
    [{ key: LAYOUT_PROFILES_KEY, value: normalized as unknown as import("@/integrations/supabase/types").Json }],
    { onConflict: "key" },
  );
  profilesCache = normalized;
  updateSiteSettingCache(LAYOUT_PROFILES_KEY, normalized);
}

export async function loadRoleLayoutProfileAssignments(opts?: { force?: boolean }): Promise<RoleLayoutProfileAssignment[]> {
  const force = !!opts?.force;
  if (!force && assignmentsCache) return assignmentsCache;
  const value = await getSiteSettingValue(LAYOUT_ASSIGNMENTS_KEY, { force });
  const rows = normalizeAssignments(value);
  assignmentsCache = rows;
  updateSiteSettingCache(LAYOUT_ASSIGNMENTS_KEY, rows);
  return rows;
}

export async function saveRoleLayoutProfileAssignments(value: RoleLayoutProfileAssignment[]): Promise<void> {
  const normalized = normalizeAssignments(value);
  await supabase.from("site_settings").upsert(
    [{ key: LAYOUT_ASSIGNMENTS_KEY, value: normalized as unknown as import("@/integrations/supabase/types").Json }],
    { onConflict: "key" },
  );
  assignmentsCache = normalized;
  updateSiteSettingCache(LAYOUT_ASSIGNMENTS_KEY, normalized);
}

export async function resolveRoleLayoutProfile(roleId: string, opts?: { force?: boolean }): Promise<ResolvedRoleLayoutProfile | null> {
  if (!roleId) return null;
  const [profiles, assignments] = await Promise.all([
    loadRoleLayoutProfiles(opts),
    loadRoleLayoutProfileAssignments(opts),
  ]);
  const assignment = assignments.find((row) => row.roleId === roleId);
  if (!assignment) return null;
  const profile = profiles.find((row) => row.id === assignment.profileId);
  if (!profile) return null;
  return {
    roleId,
    profileId: profile.id,
    profileName: profile.name,
    widgetLayout: profile.widgetLayout,
    sidebarConfig: profile.sidebarConfig,
    categoryTemplate: profile.categoryTemplate,
  };
}
