import { supabase } from "@/integrations/supabase/client";

type CacheEntry = {
  value: unknown;
  loadedAt: number;
};

const CACHE_TTL_MS = 2 * 60 * 1000;
const STARTUP_KEYS = [
  "dedication_banner",
  "feature_blocklist",
  "feature_blocklist_profiles_v1",
  "feature_blocklist_role_assignments_v1",
  "role_layout_profiles_v1",
  "role_layout_profile_assignments_v1",
  "guest_view_profiles_v1",
  "guest_view_default_profile_id_v1",
] as const;

const cache = new Map<string, CacheEntry>();
let inFlight: Promise<void> | null = null;
const queuedKeys = new Set<string>();

function isFresh(key: string): boolean {
  const entry = cache.get(key);
  return !!entry && (Date.now() - entry.loadedAt) < CACHE_TTL_MS;
}

function expandKeys(keys: string[]): string[] {
  const next = new Set(keys);
  if (keys.some((k) => (STARTUP_KEYS as readonly string[]).includes(k))) {
    STARTUP_KEYS.forEach((k) => next.add(k));
  }
  return [...next];
}

async function flushQueuedKeys(force = false): Promise<void> {
  const keysToFetch = [...queuedKeys].filter((k) => force || !isFresh(k));
  queuedKeys.clear();
  if (!keysToFetch.length) return;

  const { data } = await supabase
    .from("site_settings")
    .select("key,value")
    .in("key", keysToFetch);

  const now = Date.now();
  const rows = (data ?? []) as { key: string; value: unknown }[];
  const found = new Set<string>();

  rows.forEach((row) => {
    found.add(row.key);
    cache.set(row.key, { value: row.value, loadedAt: now });
  });

  // Missing keys are cached as null to avoid repetitive misses.
  keysToFetch.forEach((key) => {
    if (!found.has(key)) {
      cache.set(key, { value: null, loadedAt: now });
    }
  });
}

async function ensureLoaded(keys: string[], force = false): Promise<void> {
  expandKeys(keys).forEach((k) => queuedKeys.add(k));
  if (inFlight) {
    await inFlight;
    if (force) {
      expandKeys(keys).forEach((k) => queuedKeys.add(k));
      inFlight = flushQueuedKeys(true).finally(() => {
        inFlight = null;
      });
      await inFlight;
    }
    return;
  }

  inFlight = flushQueuedKeys(force).finally(() => {
    inFlight = null;
  });
  await inFlight;
}

export async function getSiteSettingValue(key: string, opts?: { force?: boolean }): Promise<unknown> {
  const force = !!opts?.force;
  if (!force && isFresh(key)) {
    return cache.get(key)?.value ?? null;
  }
  await ensureLoaded([key], force);
  return cache.get(key)?.value ?? null;
}

export function updateSiteSettingCache(key: string, value: unknown): void {
  cache.set(key, { value, loadedAt: Date.now() });
}