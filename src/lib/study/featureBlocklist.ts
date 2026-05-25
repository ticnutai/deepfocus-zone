import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSiteSettingValue, updateSiteSettingCache } from "@/lib/siteSettingsCache";

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
const KEY = "feature_blocklist";
const PROFILES_KEY = "feature_blocklist_profiles_v1";
const ROLE_ASSIGNMENTS_KEY = "feature_blocklist_role_assignments_v1";
const CACHE_KEY = "cache:feature-blocklist";
const REFRESH_TTL_MS = 2 * 60 * 1000;

let cached: FeatureBlocklist | null = null;
let lastLoadedAt = 0;
let inFlight: Promise<FeatureBlocklist> | null = null;
let profilesCache: FeatureBlocklistProfile[] | null = null;
let roleAssignmentsCache: RoleBlocklistAssignment[] | null = null;
const listeners = new Set<(b: FeatureBlocklist) => void>();

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

function isFreshCache(): boolean {
  return !!cached && Date.now() - lastLoadedAt < REFRESH_TTL_MS;
}

function emit(b: FeatureBlocklist) {
  cached = b;
  lastLoadedAt = Date.now();
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(b)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(b));
}

export async function loadFeatureBlocklist(opts?: { force?: boolean }): Promise<FeatureBlocklist> {
  const force = !!opts?.force;
  if (!force && isFreshCache()) return cached as FeatureBlocklist;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const value = await getSiteSettingValue(KEY, { force });
    const v = (value ?? EMPTY) as Partial<FeatureBlocklist>;
    const norm: FeatureBlocklist = {
      sections: Array.isArray(v.sections) ? v.sections : [],
      widgets: (v.widgets && typeof v.widgets === "object" && !Array.isArray(v.widgets)) ? v.widgets as Record<string, string[]> : {},
    };
    updateSiteSettingCache(KEY, norm);
    emit(norm);
    return norm;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export async function saveFeatureBlocklist(value: FeatureBlocklist): Promise<void> {
  await supabase.from("site_settings").upsert(
    [{ key: KEY, value: value as unknown as import("@/integrations/supabase/types").Json }],
    { onConflict: "key" },
  );
  updateSiteSettingCache(KEY, value);
  emit(value);
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

export async function loadFeatureBlocklistProfiles(opts?: { force?: boolean }): Promise<FeatureBlocklistProfile[]> {
  const force = !!opts?.force;
  if (!force && profilesCache) return profilesCache;
  const value = await getSiteSettingValue(PROFILES_KEY, { force });
  const rows = normalizeProfiles(value);
  profilesCache = rows;
  updateSiteSettingCache(PROFILES_KEY, rows);
  return rows;
}

export async function saveFeatureBlocklistProfiles(value: FeatureBlocklistProfile[]): Promise<void> {
  const normalized = normalizeProfiles(value);
  await supabase.from("site_settings").upsert(
    [{ key: PROFILES_KEY, value: normalized as unknown as import("@/integrations/supabase/types").Json }],
    { onConflict: "key" },
  );
  profilesCache = normalized;
  updateSiteSettingCache(PROFILES_KEY, normalized);
}

export async function loadRoleBlocklistAssignments(opts?: { force?: boolean }): Promise<RoleBlocklistAssignment[]> {
  const force = !!opts?.force;
  if (!force && roleAssignmentsCache) return roleAssignmentsCache;
  const value = await getSiteSettingValue(ROLE_ASSIGNMENTS_KEY, { force });
  const rows = normalizeRoleAssignments(value);
  roleAssignmentsCache = rows;
  updateSiteSettingCache(ROLE_ASSIGNMENTS_KEY, rows);
  return rows;
}

export async function saveRoleBlocklistAssignments(value: RoleBlocklistAssignment[]): Promise<void> {
  const normalized = normalizeRoleAssignments(value);
  await supabase.from("site_settings").upsert(
    [{ key: ROLE_ASSIGNMENTS_KEY, value: normalized as unknown as import("@/integrations/supabase/types").Json }],
    { onConflict: "key" },
  );
  roleAssignmentsCache = normalized;
  updateSiteSettingCache(ROLE_ASSIGNMENTS_KEY, normalized);
}

export function useFeatureBlocklist(): FeatureBlocklist {
  const [b, setB] = useState<FeatureBlocklist>(() => {
    if (cached) return cached;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as FeatureBlocklist;
        cached = parsed;
        return parsed;
      }
    } catch { /* ignore */ }
    return EMPTY;
  });

  useEffect(() => {
    listeners.add(setB);
    // refresh from server in background (deduped + stale-while-revalidate)
    runWhenBrowserIdle(() => {
      loadFeatureBlocklist().catch(() => { /* ignore */ });
    });
    return () => { listeners.delete(setB); };
  }, []);

  return b;
}
