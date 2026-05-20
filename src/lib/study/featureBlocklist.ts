import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FeatureBlocklist {
  sections: string[]; // sidebar section ids globally blocked
  widgets: Record<string, string[]>; // tabId -> blocked widget ids
}

const EMPTY: FeatureBlocklist = { sections: [], widgets: {} };
const KEY = "feature_blocklist";
const CACHE_KEY = "cache:feature-blocklist";
const REFRESH_TTL_MS = 2 * 60 * 1000;

let cached: FeatureBlocklist | null = null;
let lastLoadedAt = 0;
let inFlight: Promise<FeatureBlocklist> | null = null;
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
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    const v = (data?.value ?? EMPTY) as Partial<FeatureBlocklist>;
    const norm: FeatureBlocklist = {
      sections: Array.isArray(v.sections) ? v.sections : [],
      widgets: (v.widgets && typeof v.widgets === "object" && !Array.isArray(v.widgets)) ? v.widgets as Record<string, string[]> : {},
    };
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
  emit(value);
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
