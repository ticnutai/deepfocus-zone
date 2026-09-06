/**
 * Admin-controlled visibility + order for the first-visit guides hub.
 * Stored globally (site_settings), same pattern as guest view profiles and
 * the feature blocklist — one admin edit applies to every user.
 */
import { supabase } from "@/integrations/supabase/client";
import { getSiteSettingValue, updateSiteSettingCache } from "@/lib/siteSettingsCache";
import type { Json } from "@/integrations/supabase/types";

const GUIDES_CONFIG_KEY = "guides_config_v1";

export interface GuideConfigEntry {
  id: string;
  visible: boolean;
  order: number;
}

function normalize(value: unknown): GuideConfigEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is { id: unknown; visible?: unknown; order?: unknown } => !!v && typeof v === "object")
    .filter((v): v is { id: string; visible?: unknown; order?: unknown } => typeof v.id === "string")
    .map((v, i) => ({
      id: v.id,
      visible: v.visible !== false,
      order: typeof v.order === "number" ? v.order : i,
    }));
}

/** Returns the admin's saved config, or [] if none was ever saved (→ caller falls back to defaults). */
export async function loadGuidesConfig(opts?: { force?: boolean }): Promise<GuideConfigEntry[]> {
  const value = await getSiteSettingValue(GUIDES_CONFIG_KEY, { force: !!opts?.force });
  return normalize(value);
}

export async function saveGuidesConfig(entries: GuideConfigEntry[]): Promise<void> {
  const { error } = await supabase.from("site_settings").upsert(
    [{ key: GUIDES_CONFIG_KEY, value: entries as unknown as Json }],
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
  updateSiteSettingCache(GUIDES_CONFIG_KEY, entries);
}

/**
 * Orders `allTopicIds` per the saved config (dragged order first, then any
 * topic missing from the config appended at the end so newly-added guides
 * are never silently lost) and returns only the visible ones, in order.
 */
export function applyGuidesConfig(allTopicIds: string[], config: GuideConfigEntry[]): string[] {
  if (config.length === 0) return allTopicIds;
  const byId = new Map(config.map((c) => [c.id, c]));
  const known = allTopicIds.filter((id) => byId.has(id)).sort((a, b) => byId.get(a)!.order - byId.get(b)!.order);
  const unknown = allTopicIds.filter((id) => !byId.has(id));
  return [...known, ...unknown].filter((id) => byId.get(id)?.visible !== false);
}
