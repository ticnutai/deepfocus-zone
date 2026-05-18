import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FeatureBlocklist {
  sections: string[]; // sidebar section ids globally blocked
  widgets: Record<string, string[]>; // tabId -> blocked widget ids
}

const EMPTY: FeatureBlocklist = { sections: [], widgets: {} };
const KEY = "feature_blocklist";
const CACHE_KEY = "cache:feature-blocklist";

let cached: FeatureBlocklist | null = null;
const listeners = new Set<(b: FeatureBlocklist) => void>();

function emit(b: FeatureBlocklist) {
  cached = b;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(b)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(b));
}

export async function loadFeatureBlocklist(): Promise<FeatureBlocklist> {
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
}

export async function saveFeatureBlocklist(value: FeatureBlocklist): Promise<void> {
  await supabase.from("site_settings").upsert(
    [{ key: KEY, value: value as unknown as Record<string, unknown> }],
    { onConflict: "key" },
  );
  emit(value);
}

export function useFeatureBlocklist(): FeatureBlocklist {
  const [b, setB] = useState<FeatureBlocklist>(() => {
    if (cached) return cached;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return JSON.parse(raw) as FeatureBlocklist;
    } catch { /* ignore */ }
    return EMPTY;
  });

  useEffect(() => {
    listeners.add(setB);
    // refresh from server in background
    loadFeatureBlocklist().catch(() => { /* ignore */ });
    return () => { listeners.delete(setB); };
  }, []);

  return b;
}
