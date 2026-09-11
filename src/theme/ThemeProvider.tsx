import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";

/** Full list of CSS tokens that define a theme. Values are HSL "H S% L%" strings. */
export const THEME_TOKEN_KEYS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "gold",
  "gold-soft",
  "navy",
  "navy-soft",
  "sidebar-background",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "focus-streak-from",
  "focus-streak-to",
  "focus-streak-icon",
  "focus-streak-icon-border",
  "focus-due-from",
  "focus-due-to",
  "focus-due-icon",
  "focus-due-icon-border",
  "focus-learned-from",
  "focus-learned-to",
  "focus-learned-icon",
  "focus-learned-icon-border",
] as const;
export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];
export type ThemeTokens = Partial<Record<ThemeTokenKey, string>>;

export interface ThemeDef {
  id: string;
  label: string;
  description: string;
  swatch: string[];
  builtin: boolean;
  tokens: ThemeTokens; // full token set (defaults for built-ins)
}

/** Built-in defaults — kept identical to index.css. */
export const BUILTIN_THEMES: ThemeDef[] = [
  {
    id: "royal-navy",
    label: "Royal Navy",
    description: "לבן · זהב · נייבי",
    builtin: true,
    swatch: ["hsl(40 33% 98%)", "hsl(42 70% 50%)", "hsl(220 65% 14%)"],
    tokens: {
      background: "40 33% 98%",
      foreground: "220 60% 12%",
      card: "0 0% 100%",
      "card-foreground": "220 60% 12%",
      popover: "0 0% 100%",
      "popover-foreground": "220 60% 12%",
      primary: "220 65% 14%",
      "primary-foreground": "40 50% 96%",
      secondary: "40 30% 95%",
      "secondary-foreground": "220 60% 14%",
      muted: "40 25% 94%",
      "muted-foreground": "220 15% 40%",
      accent: "42 60% 52%",
      "accent-foreground": "220 60% 12%",
      destructive: "0 70% 50%",
      "destructive-foreground": "0 0% 98%",
      border: "42 55% 60%",
      input: "42 40% 75%",
      ring: "42 60% 52%",
      gold: "42 70% 50%",
      "gold-soft": "42 60% 65%",
      navy: "220 65% 14%",
      "navy-soft": "220 50% 25%",
      "focus-streak-from": "38 92% 50%",
      "focus-streak-to": "42 70% 50%",
      "focus-streak-icon": "40 80% 44%",
      "focus-streak-icon-border": "40 75% 55%",
      "focus-due-from": "42 72% 52%",
      "focus-due-to": "45 92% 62%",
      "focus-due-icon": "42 75% 46%",
      "focus-due-icon-border": "42 72% 56%",
      "focus-learned-from": "160 84% 39%",
      "focus-learned-to": "42 70% 50%",
      "focus-learned-icon": "160 78% 34%",
      "focus-learned-icon-border": "160 65% 48%",
      "sidebar-background": "0 0% 100%",
      "sidebar-foreground": "220 60% 12%",
      "sidebar-primary": "220 65% 14%",
      "sidebar-primary-foreground": "40 50% 96%",
      "sidebar-accent": "40 30% 95%",
      "sidebar-accent-foreground": "220 60% 14%",
      "sidebar-border": "42 55% 60%",
      "sidebar-ring": "42 60% 52%",
    },
  },
  {
    id: "midnight-gold",
    label: "Midnight Gold",
    description: "נייבי כהה · זהב",
    builtin: true,
    swatch: ["hsl(220 50% 8%)", "hsl(42 75% 58%)", "hsl(40 40% 95%)"],
    tokens: {
      background: "220 50% 8%",
      foreground: "40 40% 95%",
      card: "220 45% 12%",
      "card-foreground": "40 40% 95%",
      popover: "220 45% 12%",
      "popover-foreground": "40 40% 95%",
      primary: "42 70% 55%",
      "primary-foreground": "220 60% 10%",
      secondary: "220 40% 16%",
      "secondary-foreground": "40 40% 95%",
      muted: "220 35% 18%",
      "muted-foreground": "40 20% 70%",
      accent: "42 70% 55%",
      "accent-foreground": "220 60% 10%",
      destructive: "0 70% 50%",
      "destructive-foreground": "0 0% 98%",
      border: "42 50% 45%",
      input: "220 35% 22%",
      ring: "42 70% 55%",
      gold: "42 75% 58%",
      "gold-soft": "42 60% 70%",
      navy: "220 50% 8%",
      "navy-soft": "220 40% 16%",
      "focus-streak-from": "42 78% 58%",
      "focus-streak-to": "42 70% 45%",
      "focus-streak-icon": "42 80% 62%",
      "focus-streak-icon-border": "42 72% 52%",
      "focus-due-from": "46 88% 62%",
      "focus-due-to": "35 80% 52%",
      "focus-due-icon": "40 82% 60%",
      "focus-due-icon-border": "39 74% 50%",
      "focus-learned-from": "160 70% 45%",
      "focus-learned-to": "42 75% 58%",
      "focus-learned-icon": "160 72% 52%",
      "focus-learned-icon-border": "160 56% 44%",
      "sidebar-background": "220 50% 10%",
      "sidebar-foreground": "40 40% 95%",
      "sidebar-primary": "42 70% 55%",
      "sidebar-primary-foreground": "220 60% 10%",
      "sidebar-accent": "220 40% 16%",
      "sidebar-accent-foreground": "40 40% 95%",
      "sidebar-border": "42 50% 45%",
      "sidebar-ring": "42 70% 55%",
    },
  },
  {
    id: "emerald-ivory",
    label: "Emerald Ivory",
    description: "שנהב · ירוק · זהב",
    builtin: true,
    swatch: ["hsl(45 40% 97%)", "hsl(160 55% 18%)", "hsl(42 70% 50%)"],
    tokens: {
      background: "45 40% 97%",
      foreground: "160 50% 12%",
      card: "0 0% 100%",
      "card-foreground": "160 50% 12%",
      popover: "0 0% 100%",
      "popover-foreground": "160 50% 12%",
      primary: "160 55% 18%",
      "primary-foreground": "45 50% 96%",
      secondary: "45 35% 93%",
      "secondary-foreground": "160 50% 14%",
      muted: "45 30% 92%",
      "muted-foreground": "160 15% 35%",
      accent: "42 65% 50%",
      "accent-foreground": "160 50% 12%",
      destructive: "0 70% 50%",
      "destructive-foreground": "0 0% 98%",
      border: "42 55% 58%",
      input: "42 40% 75%",
      ring: "160 55% 30%",
      gold: "42 70% 50%",
      "gold-soft": "42 60% 65%",
      navy: "160 55% 18%",
      "navy-soft": "160 45% 28%",
      "focus-streak-from": "38 85% 52%",
      "focus-streak-to": "42 65% 50%",
      "focus-streak-icon": "40 78% 46%",
      "focus-streak-icon-border": "40 70% 55%",
      "focus-due-from": "42 70% 50%",
      "focus-due-to": "48 80% 60%",
      "focus-due-icon": "42 72% 44%",
      "focus-due-icon-border": "43 65% 52%",
      "focus-learned-from": "158 60% 40%",
      "focus-learned-to": "42 65% 50%",
      "focus-learned-icon": "158 62% 34%",
      "focus-learned-icon-border": "158 50% 46%",
      "sidebar-background": "0 0% 100%",
      "sidebar-foreground": "160 50% 12%",
      "sidebar-primary": "160 55% 18%",
      "sidebar-primary-foreground": "45 50% 96%",
      "sidebar-accent": "45 35% 93%",
      "sidebar-accent-foreground": "160 50% 14%",
      "sidebar-border": "42 55% 58%",
      "sidebar-ring": "160 55% 30%",
    },
  },
  {
    id: "burgundy-rose",
    label: "Burgundy Rose",
    description: "קרם · בורדו · רוז גולד",
    builtin: true,
    swatch: ["hsl(30 30% 97%)", "hsl(350 55% 25%)", "hsl(25 60% 55%)"],
    tokens: {
      background: "30 30% 97%",
      foreground: "350 45% 18%",
      card: "0 0% 100%",
      "card-foreground": "350 45% 18%",
      popover: "0 0% 100%",
      "popover-foreground": "350 45% 18%",
      primary: "350 55% 25%",
      "primary-foreground": "30 40% 96%",
      secondary: "30 30% 94%",
      "secondary-foreground": "350 45% 20%",
      muted: "30 25% 92%",
      "muted-foreground": "350 15% 40%",
      accent: "25 55% 55%",
      "accent-foreground": "350 45% 18%",
      destructive: "0 70% 50%",
      "destructive-foreground": "0 0% 98%",
      border: "25 50% 65%",
      input: "25 35% 80%",
      ring: "350 55% 35%",
      gold: "25 60% 55%",
      "gold-soft": "25 55% 70%",
      navy: "350 55% 25%",
      "navy-soft": "350 45% 35%",
      "focus-streak-from": "30 70% 58%",
      "focus-streak-to": "25 60% 55%",
      "focus-streak-icon": "30 72% 50%",
      "focus-streak-icon-border": "28 66% 58%",
      "focus-due-from": "28 75% 62%",
      "focus-due-to": "20 68% 56%",
      "focus-due-icon": "24 70% 52%",
      "focus-due-icon-border": "22 62% 58%",
      "focus-learned-from": "150 45% 38%",
      "focus-learned-to": "25 60% 55%",
      "focus-learned-icon": "150 48% 34%",
      "focus-learned-icon-border": "148 40% 48%",
      "sidebar-background": "0 0% 100%",
      "sidebar-foreground": "350 45% 18%",
      "sidebar-primary": "350 55% 25%",
      "sidebar-primary-foreground": "30 40% 96%",
      "sidebar-accent": "30 30% 94%",
      "sidebar-accent-foreground": "350 45% 20%",
      "sidebar-border": "25 50% 65%",
      "sidebar-ring": "350 55% 35%",
    },
  },
];

/** Backwards-compatible alias for older imports. */
export const THEMES = BUILTIN_THEMES;
export type ThemeName = string;

export interface ThemePreferencesSnapshot {
  schemaVersion: 1;
  themeId: string;
  overrides: Record<string, ThemeTokens>;
  customThemes: ThemeDef[];
  updatedAt: number;
}

export const THEME_PREFERENCES_EVENT = "app-theme-preferences-changed";

const LS_THEME = "app-theme";
const LS_OVERRIDES = "app-theme-overrides"; // Record<id, ThemeTokens>
const LS_CUSTOM = "app-theme-custom"; // ThemeDef[]
const LS_UPDATED = "app-theme-updated-at";

type Ctx = {
  theme: string;
  setTheme: (t: string) => void;
  allThemes: ThemeDef[];
  /** Current effective tokens for a given theme id (merged with overrides). */
  getEffectiveTokens: (id: string) => ThemeTokens;
  /** Overwrite (save) tokens for the given theme — both built-in (as override) and custom. */
  saveThemeTokens: (
    id: string,
    tokens: ThemeTokens,
    meta?: { label?: string; description?: string },
  ) => void;
  /** Duplicate any theme into a new custom theme with given name + tokens. Returns new id. */
  duplicateTheme: (
    sourceId: string,
    name: string,
    tokens: ThemeTokens,
  ) => string;
  /** Reset a built-in theme back to its default tokens (clears override). */
  resetBuiltin: (id: string) => void;
  /** Delete a custom theme. Falls back to royal-navy if it was active. */
  deleteCustomTheme: (id: string) => void;
  exportPreferences: () => ThemePreferencesSnapshot;
  hydratePreferences: (snapshot: ThemePreferencesSnapshot) => void;
};
const ThemeContext = createContext<Ctx | null>(null);

const readJSON = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeJSON = (key: string, val: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // ignore storage errors
  }
};

const swatchFromTokens = (t: ThemeTokens): string[] => [
  t.background ? `hsl(${t.background})` : "hsl(0 0% 100%)",
  (t.gold ?? t.accent) ? `hsl(${t.gold ?? t.accent})` : "hsl(42 70% 50%)",
  (t.navy ?? t.primary) ? `hsl(${t.navy ?? t.primary})` : "hsl(220 65% 14%)",
];

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<string>(() => {
    if (typeof window === "undefined") return "royal-navy";
    return localStorage.getItem(LS_THEME) || "royal-navy";
  });
  const [overrides, setOverrides] = useState<Record<string, ThemeTokens>>(() =>
    readJSON(LS_OVERRIDES, {}),
  );
  const [customThemes, setCustomThemes] = useState<ThemeDef[]>(() =>
    readJSON(LS_CUSTOM, []),
  );
  const [updatedAt, setUpdatedAt] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const stored = Number(localStorage.getItem(LS_UPDATED) || 0);
    // Migrate an existing pre-sync theme choice without treating a clean install as personalized.
    return stored || (localStorage.getItem(LS_THEME) ? Date.now() : 0);
  });

  const touchPreferences = useCallback(() => {
    const next = Date.now();
    setUpdatedAt(next);
    localStorage.setItem(LS_UPDATED, String(next));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(THEME_PREFERENCES_EVENT)), 0);
  }, []);

  const allThemes = useMemo<ThemeDef[]>(() => {
    const builtinsMerged = BUILTIN_THEMES.map((t) => {
      const ov = overrides[t.id];
      if (!ov) return t;
      const merged = { ...t.tokens, ...ov };
      return { ...t, tokens: merged, swatch: swatchFromTokens(merged) };
    });
    return [...builtinsMerged, ...customThemes];
  }, [overrides, customThemes]);

  const getEffectiveTokens = useCallback(
    (id: string): ThemeTokens => {
      const found = allThemes.find((t) => t.id === id);
      return found?.tokens ?? BUILTIN_THEMES[0].tokens;
    },
    [allThemes],
  );

  // Apply theme: set data-theme + inline CSS variables on documentElement
  useEffect(() => {
    const def = allThemes.find((t) => t.id === theme) ?? BUILTIN_THEMES[0];
    const root = document.documentElement;
    root.setAttribute("data-theme", def.builtin ? def.id : "custom");
    // Apply ALL tokens inline so custom themes (and overrides) take effect
    for (const k of THEME_TOKEN_KEYS) {
      const v = def.tokens[k];
      if (v) root.style.setProperty(`--${k}`, v);
      else root.style.removeProperty(`--${k}`);
    }
    localStorage.setItem(LS_THEME, theme);
  }, [theme, allThemes]);

  const setTheme = useCallback((t: string) => {
    setThemeState(t);
    localStorage.setItem(LS_THEME, t);
    touchPreferences();
  }, [touchPreferences]);

  const saveThemeTokens = useCallback(
    (
      id: string,
      tokens: ThemeTokens,
      meta?: { label?: string; description?: string },
    ) => {
      const builtin = BUILTIN_THEMES.find((t) => t.id === id);
      if (builtin) {
        setOverrides((prev) => {
          const next = { ...prev, [id]: tokens };
          writeJSON(LS_OVERRIDES, next);
          return next;
        });
      } else {
        setCustomThemes((prev) => {
          const next = prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  tokens: { ...t.tokens, ...tokens },
                  label: meta?.label ?? t.label,
                  description: meta?.description ?? t.description,
                  swatch: swatchFromTokens({ ...t.tokens, ...tokens }),
                }
              : t,
          );
          writeJSON(LS_CUSTOM, next);
          return next;
        });
      }
      touchPreferences();
    },
    [touchPreferences],
  );

  const duplicateTheme = useCallback(
    (sourceId: string, name: string, tokens: ThemeTokens): string => {
      const source = allThemes.find((t) => t.id === sourceId);
      const baseTokens = {
        ...(source?.tokens ?? {}),
        ...tokens,
      } as ThemeTokens;
      const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const def: ThemeDef = {
        id,
        label: name || "ערכה מותאמת",
        description: source ? `מבוסס על ${source.label}` : "ערכה מותאמת",
        builtin: false,
        tokens: baseTokens,
        swatch: swatchFromTokens(baseTokens),
      };
      setCustomThemes((prev) => {
        const next = [...prev, def];
        writeJSON(LS_CUSTOM, next);
        return next;
      });
      touchPreferences();
      return id;
    },
    [allThemes, touchPreferences],
  );

  const resetBuiltin = useCallback((id: string) => {
    setOverrides((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      writeJSON(LS_OVERRIDES, next);
      return next;
    });
    touchPreferences();
  }, [touchPreferences]);

  const deleteCustomTheme = useCallback(
    (id: string) => {
      setCustomThemes((prev) => {
        const next = prev.filter((t) => t.id !== id);
        writeJSON(LS_CUSTOM, next);
        return next;
      });
      if (theme === id) setThemeState("royal-navy");
      touchPreferences();
    },
    [theme, touchPreferences],
  );

  const exportPreferences = useCallback((): ThemePreferencesSnapshot => ({
    schemaVersion: 1,
    themeId: theme,
    overrides,
    customThemes,
    updatedAt,
  }), [customThemes, overrides, theme, updatedAt]);

  const hydratePreferences = useCallback((snapshot: ThemePreferencesSnapshot) => {
    if (!snapshot || snapshot.schemaVersion !== 1) return;
    const safeOverrides = snapshot.overrides && typeof snapshot.overrides === "object" ? snapshot.overrides : {};
    const safeCustom = Array.isArray(snapshot.customThemes)
      ? snapshot.customThemes.filter((item) => item && !item.builtin && typeof item.id === "string")
      : [];
    const validIds = new Set([...BUILTIN_THEMES.map((item) => item.id), ...safeCustom.map((item) => item.id)]);
    const safeTheme = validIds.has(snapshot.themeId) ? snapshot.themeId : "royal-navy";
    const safeUpdatedAt = Number(snapshot.updatedAt || 0);
    setThemeState(safeTheme);
    setOverrides(safeOverrides);
    setCustomThemes(safeCustom);
    setUpdatedAt(safeUpdatedAt);
    localStorage.setItem(LS_THEME, safeTheme);
    writeJSON(LS_OVERRIDES, safeOverrides);
    writeJSON(LS_CUSTOM, safeCustom);
    localStorage.setItem(LS_UPDATED, String(safeUpdatedAt));
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      theme,
      setTheme,
      allThemes,
      getEffectiveTokens,
      saveThemeTokens,
      duplicateTheme,
      resetBuiltin,
      deleteCustomTheme,
      exportPreferences,
      hydratePreferences,
    }),
    [
      theme,
      setTheme,
      allThemes,
      getEffectiveTokens,
      saveThemeTokens,
      duplicateTheme,
      resetBuiltin,
      deleteCustomTheme,
      exportPreferences,
      hydratePreferences,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = (): Ctx => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
