import { getSiteSettingValue, updateSiteSettingCache } from "@/lib/siteSettingsCache";
import type { SidebarConfig, WidgetLayout } from "@/lib/study/types";
import { normalizeSplitWorkspaceSidebarConfig } from "@/lib/study/sidebarItems";

export type LayoutScope = "desktop" | "mobile";

export interface LayoutProfileCategory {
  id: string;
  name: string;
  color?: string | null;
}

export interface ContentAccessProfile {
  includeOwn: boolean;
  includeSiteLibrary: boolean;
  approvedOnly: boolean;
  sourceUserIds: string[];
}

export const DEFAULT_CONTENT_ACCESS: ContentAccessProfile = {
  includeOwn: true,
  includeSiteLibrary: false,
  approvedOnly: true,
  sourceUserIds: [],
};

export function normalizeContentAccessProfile(value: unknown): ContentAccessProfile {
  const content = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<ContentAccessProfile>
    : DEFAULT_CONTENT_ACCESS;
  return {
    includeOwn: content.includeOwn !== false,
    includeSiteLibrary: content.includeSiteLibrary === true,
    approvedOnly: content.approvedOnly !== false,
    sourceUserIds: Array.from(new Set(Array.isArray(content.sourceUserIds)
      ? content.sourceUserIds.filter((id): id is string => typeof id === "string" && !!id)
      : [])),
  };
}

export interface RoleLayoutProfile {
  id: string;
  name: string;
  /**
   * Action permissions owned by this profile. Page visibility owns `view`;
   * these switches describe what may be done after the page is visible.
   */
  actionPermissions?: Record<string, Record<string, boolean>>;
  contentAccess?: ContentAccessProfile;
  widgetLayout: WidgetLayout;
  sidebarConfig: SidebarConfig[];
  categoryTemplate: LayoutProfileCategory[];
  /** Hide the large home hero while an inner home workspace is open. */
  compactInnerPages?: boolean;
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
  compactInnerPages: boolean;
}

const LAYOUT_PROFILES_KEY: Record<LayoutScope, string> = {
  desktop: "role_layout_profiles_v1",
  mobile: "role_layout_profiles_mobile_v1",
};
const LAYOUT_ASSIGNMENTS_KEY: Record<LayoutScope, string> = {
  desktop: "role_layout_profile_assignments_v1",
  mobile: "role_layout_profile_assignments_mobile_v1",
};

const profilesCache = new Map<LayoutScope, RoleLayoutProfile[]>();
const assignmentsCache = new Map<LayoutScope, RoleLayoutProfileAssignment[]>();

const uuid = () => (typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const normalizeProfile = (item: unknown): RoleLayoutProfile | null => {
  if (!item || typeof item !== "object") return null;
  const raw = item as Partial<RoleLayoutProfile> & {
    actionPermissions?: unknown;
    widgetLayout?: unknown;
    sidebarConfig?: unknown;
    categoryTemplate?: unknown;
    contentAccess?: unknown;
  };
  return {
    id: typeof raw.id === "string" ? raw.id : uuid(),
    name: typeof raw.name === "string" ? raw.name : "ללא שם",
    actionPermissions: raw.actionPermissions && typeof raw.actionPermissions === "object" && !Array.isArray(raw.actionPermissions)
      ? (raw.actionPermissions as Record<string, Record<string, boolean>>)
      : {},
    contentAccess: normalizeContentAccessProfile(raw.contentAccess),
    widgetLayout: (raw.widgetLayout && typeof raw.widgetLayout === "object" && !Array.isArray(raw.widgetLayout))
      ? (raw.widgetLayout as WidgetLayout)
      : {},
    sidebarConfig: Array.isArray(raw.sidebarConfig)
      ? normalizeSplitWorkspaceSidebarConfig(raw.sidebarConfig as SidebarConfig[])
      : [],
    categoryTemplate: Array.isArray(raw.categoryTemplate) ? (raw.categoryTemplate as LayoutProfileCategory[]) : [],
    compactInnerPages: raw.compactInnerPages === true,
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

export async function loadRoleLayoutProfiles(opts?: { force?: boolean; scope?: LayoutScope }): Promise<RoleLayoutProfile[]> {
  const force = !!opts?.force;
  const scope = opts?.scope ?? "desktop";
  if (!force && profilesCache.has(scope)) return profilesCache.get(scope) ?? [];
  const value = await getSiteSettingValue(LAYOUT_PROFILES_KEY[scope], { force });
  const rows = normalizeProfiles(value);
  profilesCache.set(scope, rows);
  updateSiteSettingCache(LAYOUT_PROFILES_KEY[scope], rows);
  return rows;
}


export async function loadRoleLayoutProfileAssignments(opts?: { force?: boolean; scope?: LayoutScope }): Promise<RoleLayoutProfileAssignment[]> {
  const force = !!opts?.force;
  const scope = opts?.scope ?? "desktop";
  if (!force && assignmentsCache.has(scope)) return assignmentsCache.get(scope) ?? [];
  const value = await getSiteSettingValue(LAYOUT_ASSIGNMENTS_KEY[scope], { force });
  const rows = normalizeAssignments(value);
  assignmentsCache.set(scope, rows);
  updateSiteSettingCache(LAYOUT_ASSIGNMENTS_KEY[scope], rows);
  return rows;
}


export async function resolveRoleLayoutProfile(roleId: string, opts?: { force?: boolean; scope?: LayoutScope }): Promise<ResolvedRoleLayoutProfile | null> {
  if (!roleId) return null;
  const scope = opts?.scope ?? "desktop";
  const [profiles, assignments] = await Promise.all([
    loadRoleLayoutProfiles({ force: opts?.force, scope }),
    loadRoleLayoutProfileAssignments({ force: opts?.force, scope }),
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
    compactInnerPages: profile.compactInnerPages === true,
  };
}
