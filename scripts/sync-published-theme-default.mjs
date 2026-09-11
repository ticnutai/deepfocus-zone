import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = fileURLToPath(new URL("../src/theme/publishedThemeDefaults.generated.ts", import.meta.url));
const env = {};
for (const name of [".env", ".env.local"]) {
  const path = fileURLToPath(new URL(`../${name}`, import.meta.url));
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}
const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
async function syncPublishedDefault() {
  if (!url || !key) {
    console.warn("Theme defaults: cloud configuration unavailable; keeping the existing bundled fallback.");
    return;
  }
  try {
    const response = await fetch(`${url}/rest/v1/site_settings?select=value&key=eq.published_theme_system_v1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    const value = rows?.[0]?.value;
    if (!value || value.schemaVersion !== 1) {
      console.warn("Theme defaults: no published admin theme yet; keeping the existing bundled fallback.");
      return;
    }
    const source = `// Generated before an Electron installer build. Do not edit manually.\nimport type { ThemePreferencesSnapshot } from "./ThemeProvider";\nimport type { ThemeDesignSnapshot } from "./ThemeStudioProvider";\nexport interface BundledThemeDefaults { schemaVersion: 1; themePreferences: ThemePreferencesSnapshot; design: ThemeDesignSnapshot; publishedAt: number; }\nexport const BUNDLED_THEME_DEFAULTS: BundledThemeDefaults = ${JSON.stringify(value, null, 2)};\n`;
    writeFileSync(target, source, "utf8");
    console.log(`Theme defaults: bundled published snapshot ${value.publishedAt}.`);
  } catch (error) {
    console.warn(`Theme defaults: cloud fetch failed; keeping the existing bundled fallback (${error instanceof Error ? error.message : String(error)}).`);
  }
}

await syncPublishedDefault();
