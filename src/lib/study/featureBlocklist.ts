import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSiteSettingValue, updateSiteSettingCache } from "@/lib/siteSettingsCache";

export type BlocklistScope = "desktop" | "mobile";

export interface FeatureBlocklist {
  sections: string[]; // sidebar section ids globally blocked
  widgets: Record<string, string[]>; // tabId -> blocked widget ids
}

export interface FeatureBlocklistProfile {
  id: string;
  name: string;
  blocklist: FeatureBlocklist;
  updatedAt: number;
}

export interface RoleBlocklistAssignment {
  id: string;
  roleId: string;
  profileId: string;
}

const EMPTY: FeatureBlocklist = { sections: [], widgets: {} };
const KEY: Record<BlocklistScope, string> = {
  desktop: "feature_blocklist",
  mobile: "feature_blocklist_mobile_v1",
};
const PROFILES_KEY: Record<BlocklistScope, string> = {
  desktop: "feature_blocklist_profiles_v1",
  mobile: "feature_blocklist_profiles_mobile_v1",
};
const ROLE_ASSIGNMENTS_KEY: Record<BlocklistScope, string> = {
  desktop: "feature_blocklist_role_assignments_v1",
  mobile: "feature_blocklist_role_assignments_mobile_v1",
};
const CACHE_KEY: Record<BlocklistScope, string> = {
  desktop: "cache:feature-blocklist",
  mobile: "cache:feature-blocklist:mobile",
};
const REFRESH_TTL_MS = 2 * 60 * 1000;

const cachedByScope = new Map<BlocklistScope, FeatureBlocklist>();
const loadedAtByScope = new Map<BlocklistScope, number>();
const inFlightByScope = new Map<BlocklistScope, Promise<FeatureBlocklist>>();
const profilesCache = new Map<BlocklistScope, FeatureBlocklistProfile[]>();
const roleAssignmentsCache = new Map<BlocklistScope, RoleBlocklistAssignment[]>();
const listenersByScope = new Map<BlocklistScope, Set<(b: FeatureBlocklist) => void>>();

function runWhenBrowserIdle(fn: () => void, timeout = 1500): void {
  const ric = (window as typeof window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => fn(), { timeout });
    return;
  }
  window.setTimeout(fn, 0);
}

function listenersForScope(scope: BlocklistScope): Set<(b: FeatureBlocklist) => void> {
  const existing = listenersByScope.get(scope);
  if (existing) return existing;
  const created = new Set<(b: FeatureBlocklist) => void>();
  listenersByScope.set(scope, created);
  return created;
}

function isFreshCache(scope: BlocklistScope): boolean {
  const cached = cachedByScope.get(scope);
  const loadedAt = loadedAtByScope.get(scope) ?? 0;
  return !!cached && Date.now() - loadedAt < REFRESH_TTL_MS;
}

function emit(scope: BlocklistScope, b: FeatureBlocklist) {
  cachedByScope.set(scope, b);
  loadedAtByScope.set(scope, Date.now());
  try { localStorage.setItem(CACHE_KEY[scope], JSON.stringify(b)); } catch { /* ignore */ }
  listenersForScope(scope).forEach((fn) => fn(b));
}

export async function loadFeatureBlocklist(opts?: { force?: boolean; scope?: BlocklistScope }): Promise<FeatureBlocklist> {
  const force = !!opts?.force;
  const scope = opts?.scope ?? "desktop";
  if (!force && isFreshCache(scope)) return cachedByScope.get(scope) as FeatureBlocklist;
  const inFlight = inFlightByScope.get(scope);
  if (inFlight) return inFlight;

  const nextFlight = (async () => {
    const value = await getSiteSettingValue(KEY[scope], { force });
    const v = (value ?? EMPTY) as Partial<FeatureBlocklist>;
    const norm: FeatureBlocklist = {
      sections: Array.isArray(v.sections) ? v.sections : [],
      widgets: (v.widgets && typeof v.widgets === "object" && !Array.isArray(v.widgets)) ? v.widgets as Record<string, string[]> : {},
    };
    updateSiteSettingCache(KEY[scope], norm);
    emit(scope, norm);
    return norm;
  })().finally(() => {
    inFlightByScope.delete(scope);
  });
  inFlightByScope.set(scope, nextFlight);

  return nextFlight;
}

export async function saveFeatureBlocklist(value: FeatureBlocklist, opts?: { scope?: BlocklistScope }): Promise<void> {
  const scope = opts?.scope ?? "desktop";
  await supabase.from("site_settings").upsert(
    [{ key: KEY[scope], value: value as unknown as import("@/integrations/supabase/types").Json }],
    { onConflict: "key" },
  );
  updateSiteSettingCache(KEY[scope], value);
  emit(scope, value);
}

const normalizeBlocklist = (value: unknown): FeatureBlocklist => {
  const v = (value ?? EMPTY) as Partial<FeatureBlocklist>;
  return {
    sections: Array.isArray(v.sections) ? v.sections : [],
    widgets: (v.widgets && typeof v.widgets === "object" && !Array.isArray(v.widgets)) ? v.widgets as Record<string, string[]> : {},
  };
};

const normalizeProfiles = (value: unknown): FeatureBlocklistProfile[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const raw = item as Partial<FeatureBlocklistProfile> & { blocklist?: unknown };
      return {
        id: typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
        name: typeof raw.name === "string" ? raw.name : "ללא שם",
        blocklist: normalizeBlocklist(raw.blocklist),
        updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
      };
    });
};

const normalizeRoleAssignments = (value: unknown): RoleBlocklistAssignment[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const raw = item as Partial<RoleBlocklistAssignment>;
      return {
        id: typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
        roleId: typeof raw.roleId === "string" ? raw.roleId : "",
        profileId: typeof raw.profileId === "string" ? raw.profileId : "",
      };
    })
    .filter((row) => row.roleId && row.profileId);
};

export async function loadFeatureBlocklistProfiles(opts?: { force?: boolean; scope?: BlocklistScope }): Promise<FeatureBlocklistProfile[]> {
  const force = !!opts?.force;
  const scope = opts?.scope ?? "desktop";
  if (!force && profilesCache.has(scope)) return profilesCache.get(scope) ?? [];
  const value = await getSiteSettingValue(PROFILES_KEY[scope], { force });
  const rows = normalizeProfiles(value);
  profilesCache.set(scope, rows);
  updateSiteSettingCache(PROFILES_KEY[scope], rows);
  return rows;
}

export async function saveFeatureBlocklistProfiles(value: FeatureBlocklistProfile[], opts?: { scope?: BlocklistScope }): Promise<void> {
  const scope = opts?.scope ?? "desktop";
  const normalized = normalizeProfiles(value);
  await supabase.from("site_settings").upsert(
    [{ key: PROFILES_KEY[scope], value: normalized as unknown as import("@/integrations/supabase/types").Json }],
    { onConflict: "key" },
  );
  profilesCache.set(scope, normalized);
  updateSiteSettingCache(PROFILES_KEY[scope], normalized);
}

export async function loadRoleBlocklistAssignments(opts?: { force?: boolean; scope?: BlocklistScope }): Promise<RoleBlocklistAssignment[]> {
  const force = !!opts?.force;
  const scope = opts?.scope ?? "desktop";
  if (!force && roleAssignmentsCache.has(scope)) return roleAssignmentsCache.get(scope) ?? [];
  const value = await getSiteSettingValue(ROLE_ASSIGNMENTS_KEY[scope], { force });
  const rows = normalizeRoleAssignments(value);
  roleAssignmentsCache.set(scope, rows);
  updateSiteSettingCache(ROLE_ASSIGNMENTS_KEY[scope], rows);
  return rows;
}

export async function saveRoleBlocklistAssignments(value: RoleBlocklistAssignment[], opts?: { scope?: BlocklistScope }): Promise<void> {
  const scope = opts?.scope ?? "desktop";
  const normalized = normalizeRoleAssignments(value);
  await supabase.from("site_settings").upsert(
    [{ key: ROLE_ASSIGNMENTS_KEY[scope], value: normalized as unknown as import("@/integrations/supabase/types").Json }],
    { onConflict: "key" },
  );
  roleAssignmentsCache.set(scope, normalized);
  updateSiteSettingCache(ROLE_ASSIGNMENTS_KEY[scope], normalized);
}

const mergeBlocklists = (base: FeatureBlocklist, extra: FeatureBlocklist | null): FeatureBlocklist => {
  if (!extra) return base;
  const sections = Array.from(new Set([...(base.sections ?? []), ...(extra.sections ?? [])]));
  const widgets: Record<string, string[]> = { ...base.widgets };
  for (const [tabId, ids] of Object.entries(extra.widgets ?? {})) {
    widgets[tabId] = Array.from(new Set([...(widgets[tabId] ?? []), ...(ids ?? [])]));
  }
  return { sections, widgets };
};

export async function resolveRoleFeatureBlocklist(roleIds: string[], opts?: { force?: boolean; scope?: BlocklistScope }): Promise<FeatureBlocklist> {
  const scope = opts?.scope ?? "desktop";
  const uniqueRoleIds = Array.from(new Set(roleIds.filter(Boolean)));
  const [globalBlocklist, profiles, assignments] = await Promise.all([
    loadFeatureBlocklist({ force: opts?.force, scope }),
    loadFeatureBlocklistProfiles({ force: opts?.force, scope }),
    loadRoleBlocklistAssignments({ force: opts?.force, scope }),
  ]);

  if (uniqueRoleIds.length === 0) return globalBlocklist;

  const assignment = uniqueRoleIds
    .map((roleId) => assignments.find((row) => row.roleId === roleId))
    .find((row): row is RoleBlocklistAssignment => !!row);
  if (!assignment) return globalBlocklist;

  const profile = profiles.find((row) => row.id === assignment.profileId) ?? null;
  // When a role has an assigned blocklist profile, that profile fully defines
  // what's blocked for the role — do NOT union with the global blocklist,
  // otherwise a broad global blocklist (e.g. all overview widgets) would
  // override the per-role profile and make tabs appear empty.
  if (profile) return profile.blocklist;
  return globalBlocklist;
}

export function useFeatureBlocklist(opts?: { scope?: BlocklistScope }): FeatureBlocklist {
  const scope = opts?.scope ?? "desktop";
  const [b, setB] = useState<FeatureBlocklist>(() => {
    const cached = cachedByScope.get(scope);
    if (cached) return cached;
    try {
      const raw = localStorage.getItem(CACHE_KEY[scope]);
      if (raw) {
        const parsed = JSON.parse(raw) as FeatureBlocklist;
        cachedByScope.set(scope, parsed);
        loadedAtByScope.set(scope, Date.now());
        return parsed;
      }
    } catch { /* ignore */ }
    return EMPTY;
  });

  useEffect(() => {
    listenersForScope(scope).add(setB);
    // refresh from server in background (deduped + stale-while-revalidate)
    runWhenBrowserIdle(() => {
      loadFeatureBlocklist({ scope }).catch(() => { /* ignore */ });
    });
    return () => { listenersForScope(scope).delete(setB); };
  }, [scope]);

  return b;
}

export function useResolvedFeatureBlocklist(roleIds: string[], opts?: { scope?: BlocklistScope }): FeatureBlocklist {
  const scope = opts?.scope ?? "desktop";
  const [resolved, setResolved] = useState<FeatureBlocklist>(() => EMPTY);

  useEffect(() => {
    let cancelled = false;
    void resolveRoleFeatureBlocklist(roleIds, { scope }).then((next) => {
      if (!cancelled) setResolved(next);
    }).catch(() => {
      if (!cancelled) setResolved(EMPTY);
    });
    return () => { cancelled = true; };
  }, [scope, JSON.stringify(Array.from(new Set(roleIds.filter(Boolean))).sort())]);

  return resolved;
}
