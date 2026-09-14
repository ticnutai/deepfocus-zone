import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Eye, EyeOff, MousePointer2, Pause, Play, Redo2, RotateCcw, Save,
  Trash2, Undo2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
import { useStudy } from "@/lib/study/store";
import type { Json } from "@/integrations/supabase/types";
import {
  THEME_PREFERENCES_EVENT, useTheme, type ThemePreferencesSnapshot,
} from "./ThemeProvider";
import { BUNDLED_THEME_DEFAULTS } from "./publishedThemeDefaults.generated";
import { LiveGradientEditor, type GradientPreset } from "./LiveGradientEditor";

export type DesignScope = "element" | "component" | "global";
export interface DesignRule {
  id: string;
  selector: string;
  label: string;
  scope: DesignScope;
  /** Missing means all themes, preserving existing saved designs. */
  themeId?: string;
  styles: Record<string, string>;
}
export interface DesignGeometry { x: number; y: number; width: number; height: number }
export interface ThemeDesignSnapshot {
  schemaVersion: 1;
  rules: DesignRule[];
  gradientPresets?: GradientPreset[];
  geometry: DesignGeometry;
  updatedAt: number;
}
interface PublishedThemeSystem {
  schemaVersion: 1;
  themePreferences: ThemePreferencesSnapshot;
  design: ThemeDesignSnapshot;
  publishedAt: number;
}

const PUBLISHED_KEY = "published_theme_system_v1";
const DESIGN_STORAGE_KEY = "app-theme-design-v1";
const DESIGN_QUARANTINE_STORAGE_KEY = "app-theme-design-quarantine-v1";
const DEFAULT_GEOMETRY: DesignGeometry = { x: 24, y: 84, width: 560, height: 720 };
const EMPTY_DESIGN: ThemeDesignSnapshot = { schemaVersion: 1, rules: [], geometry: DEFAULT_GEOMETRY, updatedAt: 0 };

const GENERIC_UTILITY_CLASSES = new Set([
  "relative", "absolute", "fixed", "sticky", "static",
  "block", "inline", "inline-block", "inline-flex", "inline-grid", "flex", "grid", "hidden",
  "container", "isolate", "contents", "flow-root",
]);

function isLayoutUtilityClass(name: string): boolean {
  if (!name || name.includes(":") || name.includes("[") || name.includes("/")) return true;
  if (GENERIC_UTILITY_CLASSES.has(name)) return true;
  return /^(?:-?(?:inset|top|right|bottom|left|z|order|col|row|float|clear|object|overflow|overscroll|position)-|(?:p|m)[trblxy]?-|(?:h|w|min-h|min-w|max-h|max-w)-|(?:text|bg|border|rounded|shadow|opacity|gap|space|items|justify|content|self|place|basis|grow|shrink|transition|duration|ease|delay|animate|cursor|select|pointer-events|transform|translate|rotate|scale)-)/u.test(name);
}

function isSafeDesignRule(rule: DesignRule): boolean {
  if (!rule || typeof rule.selector !== "string" || !rule.selector.trim()) return false;
  const selector = rule.selector.trim();
  if (selector === "*" || selector === "html" || selector === "body" || selector === ":root") return false;
  if (rule.scope !== "component") return true;
  const classes = Array.from(selector.matchAll(/\.([a-zA-Z0-9_-]+)/gu), (match) => match[1]);
  return classes.length === 0 || classes.some((name) => !isLayoutUtilityClass(name));
}

export function sanitizeThemeDesign(snapshot: ThemeDesignSnapshot): ThemeDesignSnapshot {
  const rules = snapshot.rules.filter(isSafeDesignRule);
  if (rules.length === snapshot.rules.length) return snapshot;
  return { ...snapshot, rules, updatedAt: Date.now() };
}

function quarantineRules(rules: DesignRule[]) {
  if (!rules.length) return;
  try {
    localStorage.setItem(DESIGN_QUARANTINE_STORAGE_KEY, JSON.stringify({ quarantinedAt: Date.now(), rules }));
  } catch { /* best-effort recovery copy */ }
}

function readDesign(): ThemeDesignSnapshot {
  try {
    const parsed = JSON.parse(localStorage.getItem(DESIGN_STORAGE_KEY) || "null") as ThemeDesignSnapshot | null;
    if (parsed?.schemaVersion === 1 && Array.isArray(parsed.rules)) {
      const safe = sanitizeThemeDesign(parsed);
      if (safe !== parsed) {
        quarantineRules(parsed.rules.filter((rule) => !isSafeDesignRule(rule)));
        localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(safe));
      }
      return safe;
    }
  } catch { /* local fallback */ }
  return EMPTY_DESIGN;
}

function persistDesign(value: ThemeDesignSnapshot, notify = true) {
  localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(value));
  if (notify) window.dispatchEvent(new CustomEvent("app-theme-design-changed"));
}

function cssText(rules: DesignRule[], theme?: string) {
  return rules.filter(isSafeDesignRule)
    .sort((a, b) => Number(Boolean(a.themeId)) - Number(Boolean(b.themeId)))
    .map((rule) => {
      const root = `[data-design-theme="${(rule.themeId || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
      const other = `[data-design-theme]:not(${root})`;
      const withinTheme = rule.themeId ? `:where(${root}, ${root} *):not(:where(${root} ${other}, ${root} ${other} *))` : "";
      return `:is(${rule.selector})${withinTheme}:not(#design-mode-never-target):not(:where([data-design-mode-ui], [data-design-mode-ui] *)){${Object.entries(rule.styles)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}:${value} !important`)
    .join(";")}}`;
    }).join("\n");
}

function ensureStyleTag(id: string) {
  let tag = document.getElementById(id) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = id;
    document.head.appendChild(tag);
  }
  return tag;
}

function safeCssIdent(value: string) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function exactSelector(element: HTMLElement): string {
  if (element.id) return `#${safeCssIdent(element.id)}`;
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
  const parts: string[] = [];
  let node: HTMLElement | null = element;
  while (node && node !== document.body) {
    let part = node.tagName.toLowerCase();
    const siblings = node.parentElement
      ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName)
      : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    parts.unshift(part);
    node = node.parentElement;
  }
  return `body > ${parts.join(" > ")}`;
}

function componentSelector(element: HTMLElement): string {
  const stable = Array.from(element.classList).filter((name) => !isLayoutUtilityClass(name)).slice(0, 2);
  if (!stable.length) return exactSelector(element);
  return `${element.tagName.toLowerCase()}${stable.map((name) => `.${safeCssIdent(name)}`).join("")}`;
}

function globalSelector(element: HTMLElement): string {
  const role = element.getAttribute("role");
  if (role) return `[role="${role.replace(/"/g, "\\\"")}"]`;
  const tag = element.tagName.toLowerCase();
  if (/^(button|input|textarea|select|a|h1|h2|h3|h4|h5|h6|p|article|section|aside|nav)$/.test(tag)) return tag;
  // Generic containers may have no semantic kind; use their stable component
  // identity instead of a marker that might not exist anywhere in the page.
  return componentSelector(element);
}

const FIELDS = [
  ["color", "צבע טקסט", "color"], ["background-color", "צבע רקע", "color"],
  ["background-image", "גרדיאנט", "text"],
  ["border-color", "צבע מסגרת", "color"], ["font-family", "גופן", "text"],
  ["font-size", "גודל טקסט", "text"], ["font-weight", "עובי טקסט", "text"],
  ["line-height", "גובה שורה", "text"], ["letter-spacing", "ריווח אותיות", "text"],
  ["word-spacing", "ריווח מילים", "text"], ["text-align", "יישור", "text"],
  ["padding", "ריפוד פנימי", "text"], ["margin", "מרווח חיצוני", "text"],
  ["border-width", "עובי מסגרת", "text"], ["border-radius", "עיגול פינות", "text"],
  ["max-width", "רוחב מרבי", "text"], ["opacity", "שקיפות", "text"],
  ["box-shadow", "צל", "text"],
] as const;

type StudioContextValue = {
  enabled: boolean;
  paused: boolean;
  rules: DesignRule[];
  start: () => void;
  stop: () => void;
  publishDefault: () => Promise<void>;
  publishing: boolean;
};
const StudioContext = createContext<StudioContextValue | null>(null);

export function useThemeStudio() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useThemeStudio must be used within ThemeStudioProvider");
  return value;
}

export function ThemeStudioProvider({ children }: { children: ReactNode }) {
  const { user, isGuest } = useAuth();
  const { isAdmin, viewerIsAdmin } = usePermissions();
  const { state, setUiPref } = useStudy();
  const { theme, allThemes, exportPreferences, hydratePreferences } = useTheme();
  const [design, setDesign] = useState<ThemeDesignSnapshot>(readDesign);
  const [published, setPublished] = useState<PublishedThemeSystem | null>(BUNDLED_THEME_DEFAULTS);
  const [enabled, setEnabled] = useState(false);
  const [paused, setPaused] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [selected, setSelected] = useState<HTMLElement | null>(null);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const initialStyles = useRef<Record<string, string>>({});
  const changedStyles = useMemo(() => Object.fromEntries(Object.entries(draft).filter(([key, value]) => value.trim() !== "" && value !== initialStyles.current[key])), [draft]);
  const [scope, setScope] = useState<DesignScope>("element");
  const [selectedTheme, setSelectedTheme] = useState(theme);
  const [themeScope, setThemeScope] = useState<"current" | "all">("current");
  // Discard a draft when its originating theme changes.
  useEffect(() => { setSelected(null); setDraft({}); setHoverRect(null); }, [theme]);
  const [history, setHistory] = useState<DesignRule[][]>([]);
  const [future, setFuture] = useState<DesignRule[][]>([]);
  const [geometry, setGeometry] = useState<DesignGeometry>(design.geometry || DEFAULT_GEOMETRY);
  const hydratedSnapshot = useRef("");
  const replaying = useRef(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const currentIdentity = isGuest ? "guest" : user?.id || "signed-out";
  const hasStudyIdentity = isGuest || Boolean(user?.id);
  const canAuthor = isAdmin && viewerIsAdmin;

  const commitDesign = useCallback((rules: DesignRule[], nextGeometry = geometry) => {
    const next = sanitizeThemeDesign({ ...design, schemaVersion: 1, rules, geometry: nextGeometry, updatedAt: Date.now() });
    setDesign(next);
    persistDesign(next);
  }, [geometry, design]);

  const saveGradientPresets = (gradientPresets: GradientPreset[]) => {
    if (!canAuthor) return;
    const next = { ...design, gradientPresets, updatedAt: Date.now() };
    setDesign(next);
    persistDesign(next);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-design-theme", theme);
    ensureStyleTag("design-mode-overrides").textContent = cssText(design.rules, theme);
  }, [design.rules, theme]);

  useEffect(() => {
    let cancelled = false;
    void supabase.from("site_settings").select("value").eq("key", PUBLISHED_KEY).maybeSingle().then(({ data, error }) => {
      if (cancelled || error || !data?.value) return;
      const value = data.value as unknown as PublishedThemeSystem;
      if (value.schemaVersion === 1) setPublished(value);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const personalTheme = state.uiPrefs?.themePreferences as ThemePreferencesSnapshot | undefined;
    const personalDesign = state.uiPrefs?.themeDesign as ThemeDesignSnapshot | undefined;
    const localTheme = exportPreferences();
    const hydrationKey = `${currentIdentity}:${personalTheme?.updatedAt || 0}:${personalDesign?.updatedAt || 0}:${published?.publishedAt || 0}`;
    if (hydratedSnapshot.current === hydrationKey) return;
    if (personalTheme?.schemaVersion === 1) hydratePreferences(personalTheme);
    // The theme provider also wraps the signed-out route. Persisting into the
    // study store before AuthProvider has resolved a real/local identity used
    // to throw "נדרשת התחברות" and unmount the entire Electron renderer.
    else if (localTheme.updatedAt > 0 && hasStudyIdentity) setUiPref("themePreferences", localTheme as never);
    else if (published?.themePreferences?.schemaVersion === 1) hydratePreferences(published.themePreferences);
    if (canAuthor && personalDesign?.schemaVersion === 1) {
      const safeDesign = sanitizeThemeDesign(personalDesign);
      setDesign(safeDesign); setGeometry(safeDesign.geometry); persistDesign(safeDesign, false);
      if (safeDesign !== personalDesign) setUiPref("themeDesign", safeDesign as never);
    } else if (published?.design?.schemaVersion === 1) {
      const safeDesign = sanitizeThemeDesign(published.design);
      setDesign(safeDesign); setGeometry(safeDesign.geometry); persistDesign(safeDesign, false);
    }
    hydratedSnapshot.current = hydrationKey;
  }, [canAuthor, currentIdentity, exportPreferences, hasStudyIdentity, hydratePreferences, published, setUiPref, state.uiPrefs?.themeDesign, state.uiPrefs?.themePreferences]);

  useEffect(() => {
    const saveTheme = () => { if (hasStudyIdentity) setUiPref("themePreferences", exportPreferences() as never); };
    const saveDesign = () => { if (hasStudyIdentity) setUiPref("themeDesign", readDesign() as never); };
    window.addEventListener(THEME_PREFERENCES_EVENT, saveTheme);
    window.addEventListener("app-theme-design-changed", saveDesign);
    return () => {
      window.removeEventListener(THEME_PREFERENCES_EVENT, saveTheme);
      window.removeEventListener("app-theme-design-changed", saveDesign);
    };
  }, [exportPreferences, hasStudyIdentity, setUiPref]);

  useEffect(() => {
    if (!canAuthor && enabled) { setEnabled(false); setSelected(null); }
  }, [canAuthor, enabled]);

  useEffect(() => {
    const tag = ensureStyleTag("design-mode-live-preview");
    if (!selected || !enabled || paused) { tag.textContent = ""; return; }
    const selector = scope === "element" ? exactSelector(selected) : scope === "component" ? componentSelector(selected) : globalSelector(selected);
    tag.textContent = cssText([{ id: "preview", selector, label: "preview", scope, ...(themeScope === "current" ? { themeId: selectedTheme } : {}), styles: changedStyles }]);
  }, [changedStyles, enabled, paused, scope, selected, selectedTheme, themeScope]);

  useEffect(() => {
    if (!enabled) return;
    const ignored = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-design-mode-ui]");
    const onMove = (event: PointerEvent) => {
      if (paused || ignored(event.target)) return;
      const target = event.target instanceof SVGElement ? event.target.closest("button, a") || event.target.ownerSVGElement?.parentElement : event.target;
      if (!(target instanceof HTMLElement)) return;
      setHoverRect(target.getBoundingClientRect());
    };
    const onDown = (event: PointerEvent) => {
      if (paused || ignored(event.target) || replaying.current) return;
      const target = event.target instanceof SVGElement ? event.target.closest("button, a") || event.target.ownerSVGElement?.parentElement : event.target;
      if (!(target instanceof HTMLElement)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.altKey) {
        replaying.current = true;
        target.click();
        queueMicrotask(() => { replaying.current = false; });
        return;
      }
      const computed = getComputedStyle(target);
      setSelectedTheme(target.closest("[data-design-theme]")?.getAttribute("data-design-theme") || theme);
      const next: Record<string, string> = {};
      for (const [property] of FIELDS) next[property] = computed.getPropertyValue(property).trim();
      initialStyles.current = next;
      setSelected(target); setDraft(next); setScope("element");
    };
    const onClick = (event: MouseEvent) => {
      if (!paused && !replaying.current && !ignored(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (selected) setSelected(null); else setEnabled(false);
    };
    // Radix dialogs can trap focus in their content. The editor is a separate
    // portal, so let its inputs receive focus without dismissing that dialog.
    const onEditorFocus = (event: FocusEvent) => { if (ignored(event.target) || ignored(event.relatedTarget)) event.stopImmediatePropagation(); };
    const onLayerOutside = (event: Event) => {
      const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
      if (original && ignored(original.target)) event.preventDefault();
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onEditorFocus, true);
    document.addEventListener("focusout", onEditorFocus, true);
    document.addEventListener("dismissableLayer.pointerDownOutside", onLayerOutside, true);
    document.addEventListener("dismissableLayer.focusOutside", onLayerOutside, true);
    return () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onEditorFocus, true);
      document.removeEventListener("focusout", onEditorFocus, true);
      document.removeEventListener("dismissableLayer.pointerDownOutside", onLayerOutside, true);
      document.removeEventListener("dismissableLayer.focusOutside", onLayerOutside, true);
    };
  }, [enabled, paused, selected, theme]);

  useEffect(() => {
    if (!selected) return;
    const update = () => setHoverRect(selected.getBoundingClientRect());
    window.addEventListener("scroll", update, true); window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [selected]);

  useEffect(() => {
    const node = panelRef.current;
    if (!node || !selected) return;
    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      const next = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      setGeometry(next);
      const saved = { ...design, geometry: next };
      setDesign(saved); persistDesign(saved, false);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [design, selected]);

  const saveRule = useCallback(() => {
    if (!selected) return;
    if (!Object.keys(changedStyles).length) { toast.info("לא בוצעו שינויים לשמירה"); return; }
    const selector = scope === "element" ? exactSelector(selected) : scope === "component" ? componentSelector(selected) : globalSelector(selected);
    const id = `${themeScope === "current" ? `theme:${selectedTheme}:` : ""}${scope}:${selector}`;
    const nextRule: DesignRule = {
      id,
      ...(themeScope === "current" ? { themeId: selectedTheme } : {}),
      selector,
      scope,
      label: `${themeScope === "current" ? allThemes.find((item) => item.id === selectedTheme)?.label || selectedTheme : "כל ערכות הנושא"} · ${selected.tagName.toLowerCase()} · ${scope === "element" ? "אלמנט" : scope === "component" ? "רכיב" : "סוג רכיב"}`,
      styles: { ...design.rules.find((rule) => rule.id === id)?.styles, ...changedStyles },
    };
    setHistory((items) => [...items.slice(-49), design.rules]); setFuture([]);
    commitDesign([...design.rules.filter((rule) => rule.id !== nextRule.id), nextRule]);
    setSelected(null);
    toast.success("העיצוב נשמר");
  }, [allThemes, changedStyles, commitDesign, design.rules, scope, selected, selectedTheme, themeScope]);

  const undo = useCallback(() => {
    const previous = history.at(-1); if (!previous) return;
    setFuture((items) => [design.rules, ...items].slice(0, 50)); setHistory((items) => items.slice(0, -1)); commitDesign(previous);
  }, [commitDesign, design.rules, history]);
  const redo = useCallback(() => {
    const next = future[0]; if (!next) return;
    setHistory((items) => [...items, design.rules].slice(-50)); setFuture((items) => items.slice(1)); commitDesign(next);
  }, [commitDesign, design.rules, future]);
  const clearAll = useCallback(() => {
    if (!confirm("למחוק את כל שינויי העיצוב החי?")) return;
    setHistory((items) => [...items, design.rules]); setFuture([]); commitDesign([]);
  }, [commitDesign, design.rules]);
  const removeRule = useCallback((id: string) => {
    setHistory((items) => [...items.slice(-49), design.rules]); setFuture([]);
    commitDesign(design.rules.filter((rule) => rule.id !== id));
  }, [commitDesign, design.rules]);

  const pickScreenColor = useCallback(async (property: string) => {
    const EyeDropperApi = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropperApi) { toast.info("דוגם הצבע אינו זמין בדפדפן זה"); return; }
    try {
      const result = await new EyeDropperApi().open();
      setDraft((value) => ({ ...value, [property]: result.sRGBHex }));
    } catch { /* cancelled by the user */ }
  }, []);

  const publishDefault = useCallback(async () => {
    if (!canAuthor || !user?.id) { toast.error("הפרסום זמין למנהל בלבד"); return; }
    setPublishing(true);
    const value: PublishedThemeSystem = {
      schemaVersion: 1,
      themePreferences: exportPreferences(),
      design,
      publishedAt: Date.now(),
    };
    const { error } = await supabase.from("site_settings").upsert({
      key: PUBLISHED_KEY, value: value as unknown as Json, updated_at: new Date().toISOString(), updated_by: user.id,
    }, { onConflict: "key" });
    setPublishing(false);
    if (error) { toast.error("פרסום ברירת המחדל נכשל", { description: error.message }); return; }
    setPublished(value);
    toast.success("ערכת הנושא פורסמה כברירת המחדל של המערכת");
  }, [canAuthor, design, exportPreferences, user?.id]);

  const onDragStart = (event: ReactPointerEvent) => {
    drag.current = { dx: event.clientX - geometry.x, dy: event.clientY - geometry.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onDragMove = (event: ReactPointerEvent) => {
    if (!drag.current) return;
    const next = {
      ...geometry,
      x: Math.max(0, Math.min(window.innerWidth - geometry.width, event.clientX - drag.current.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 80, event.clientY - drag.current.dy)),
    };
    setGeometry(next);
  };
  const onDragEnd = () => {
    drag.current = null;
    const next = { ...design, geometry, updatedAt: Date.now() };
    setDesign(next); persistDesign(next);
  };

  const contextValue = useMemo<StudioContextValue>(() => ({
    enabled, paused, rules: design.rules,
    start: () => { if (canAuthor) { setEnabled(true); setPaused(false); } },
    stop: () => { setEnabled(false); setSelected(null); setHoverRect(null); },
    publishDefault, publishing,
  }), [canAuthor, design.rules, enabled, paused, publishDefault, publishing]);

  return (
    <StudioContext.Provider value={contextValue}>
      {children}
      {canAuthor && !enabled && typeof document !== "undefined" && createPortal(
        <Button data-design-mode-ui type="button" className="pointer-events-auto fixed bottom-20 left-4 z-[2147483001] gap-2 rounded-full border border-gold shadow-lg" onClick={() => { setEnabled(true); setPaused(false); }} title="פתח עריכה חיה של העמוד">
          <MousePointer2 className="h-4 w-4" />עריכה חיה
        </Button>, document.body,
      )}
      {enabled && typeof document !== "undefined" && createPortal(<>
        {hoverRect && !paused && <div data-design-mode-ui className="pointer-events-none fixed z-[2147483000] border-2 border-dashed border-sky-400 bg-sky-400/10" style={{ left: hoverRect.left, top: hoverRect.top, width: hoverRect.width, height: hoverRect.height }}><span className="absolute bottom-full right-0 rounded-t bg-sky-600 px-2 py-0.5 text-[10px] text-white">{selected ? selected.tagName.toLowerCase() : "לחץ לעריכה"}</span></div>}
        <div data-design-mode-ui dir="rtl" className="pointer-events-auto fixed bottom-4 left-1/2 z-[2147483001] flex -translate-x-1/2 items-center gap-1 rounded-2xl border-2 border-gold bg-card p-2 shadow-2xl">
          <Button size="sm" onClick={() => setPaused((value) => !value)}>{paused ? <Play className="ml-1 h-4 w-4" /> : <Pause className="ml-1 h-4 w-4" />}{paused ? "המשך עריכה" : "השהה"}</Button>
          <Button size="icon" variant="outline" disabled={!history.length} onClick={undo} title="בטל"><Undo2 className="h-4 w-4" /></Button>
          <Button size="icon" variant="outline" disabled={!future.length} onClick={redo} title="בצע שוב"><Redo2 className="h-4 w-4" /></Button>
          <Button size="icon" variant="outline" disabled={!design.rules.length} onClick={clearAll} title="נקה הכל"><Trash2 className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => { setEnabled(false); setSelected(null); }}><X className="ml-1 h-4 w-4" />סיום</Button>
        </div>
        {selected && <div
          ref={panelRef}
          data-design-mode-ui
          dir="rtl"
          className="pointer-events-auto fixed z-[2147483002] flex min-h-[420px] min-w-[420px] resize overflow-hidden rounded-2xl border-2 border-gold bg-background shadow-2xl"
          style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: Math.min(geometry.height, window.innerHeight - geometry.y - 12) } as CSSProperties}
        >
          <div className="flex min-h-0 w-full flex-col">
            <div className="flex cursor-move items-center justify-between border-b border-gold/40 bg-secondary/60 px-3 py-2" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}>
              <div><div className="font-bold">עריכה חיה</div><div className="text-[11px] text-muted-foreground">בחר ערכים ושמור לפי היקף</div></div>
              <div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => setPaused((value) => !value)} title="השהה/המשך">{paused ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</Button><Button size="icon" variant="ghost" onClick={() => setSelected(null)}><X className="h-4 w-4" /></Button></div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <div className="space-y-2 rounded-xl border border-gold/30 p-2">
                <div className="text-sm font-bold">על אילו ערכות נושא להחיל? · {allThemes.find((item) => item.id === selectedTheme)?.label || selectedTheme}</div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" aria-pressed={themeScope === "current"} variant={themeScope === "current" ? "default" : "outline"} onClick={() => setThemeScope("current")}>רק ערכת הנושא הנוכחית</Button>
                  <Button size="sm" aria-pressed={themeScope === "all"} variant={themeScope === "all" ? "default" : "outline"} onClick={() => setThemeScope("all")}>כל ערכות הנושא</Button>
                </div>
                <p className="text-xs text-muted-foreground">שינוי ייחודי לערכה מקבל עדיפות על שינוי משותף. שינויים ישנים נשארים משותפים לכל הערכות.</p>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(["element", "component", "global"] as DesignScope[]).map((item) => <Button key={item} size="sm" variant={scope === item ? "default" : "outline"} onClick={() => setScope(item)}>{item === "element" ? "אלמנט זה" : item === "component" ? "כל רכיב דומה" : "כל הרכיבים מסוג זה"}</Button>)}
              </div>
              {!!design.rules.length && <div className="rounded-xl border border-gold/30 bg-card p-2"><div className="mb-1 text-xs font-bold">שינויים שמורים ({design.rules.length})</div><div className="max-h-28 space-y-1 overflow-y-auto">{design.rules.map((rule) => <div key={rule.id} className="flex items-center justify-between gap-2 rounded border border-gold/20 px-2 py-1 text-[11px]"><span className="min-w-0 truncate" dir="ltr">{rule.label} · {rule.selector}</span><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeRule(rule.id)} title="מחק שינוי"><Trash2 className="h-3.5 w-3.5" /></Button></div>)}</div></div>}
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2"><LiveGradientEditor key={exactSelector(selected)} value={draft["background-image"] || "none"} presets={design.gradientPresets} onPresetsChange={saveGradientPresets} onChange={(value) => setDraft((current) => ({ ...current, "background-image": value }))} /></div>
                {FIELDS.filter(([property]) => property !== "background-image").map(([property, label, type]) => <div key={property} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <div className="flex gap-1">
                    {type === "color" && <><input type="color" className="h-9 w-10 rounded border" value={draft[property]?.startsWith("#") ? draft[property] : "#000000"} onChange={(event) => setDraft((value) => ({ ...value, [property]: event.target.value }))} /><Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={() => void pickScreenColor(property)} title="דגום צבע מהמסך"><MousePointer2 className="h-3.5 w-3.5" /></Button></>}
                    <Input aria-label={label} dir="ltr" value={draft[property] || ""} onChange={(event) => setDraft((value) => ({ ...value, [property]: event.target.value }))} className="h-9 flex-1 text-xs" />
                  </div>
                </div>)}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-gold/40 p-3"><Button variant="outline" onClick={() => { setDraft({}); }}><RotateCcw className="ml-1 h-4 w-4" />נקה טיוטה</Button><Button onClick={saveRule}><Save className="ml-1 h-4 w-4" />שמור עיצוב</Button></div>
          </div>
        </div>}
      </>, document.body)}
    </StudioContext.Provider>
  );
}
