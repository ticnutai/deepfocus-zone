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

export type DesignScope = "element" | "component" | "global";
export interface DesignRule {
  id: string;
  selector: string;
  label: string;
  scope: DesignScope;
  styles: Record<string, string>;
}
export interface DesignGeometry { x: number; y: number; width: number; height: number }
export interface ThemeDesignSnapshot {
  schemaVersion: 1;
  rules: DesignRule[];
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
const DEFAULT_GEOMETRY: DesignGeometry = { x: 24, y: 84, width: 560, height: 720 };
const EMPTY_DESIGN: ThemeDesignSnapshot = { schemaVersion: 1, rules: [], geometry: DEFAULT_GEOMETRY, updatedAt: 0 };

function readDesign(): ThemeDesignSnapshot {
  try {
    const parsed = JSON.parse(localStorage.getItem(DESIGN_STORAGE_KEY) || "null") as ThemeDesignSnapshot | null;
    if (parsed?.schemaVersion === 1 && Array.isArray(parsed.rules)) return parsed;
  } catch { /* local fallback */ }
  return EMPTY_DESIGN;
}

function persistDesign(value: ThemeDesignSnapshot, notify = true) {
  localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(value));
  if (notify) window.dispatchEvent(new CustomEvent("app-theme-design-changed"));
}

function cssText(rules: DesignRule[]) {
  return rules.map((rule) => `${rule.selector}{${Object.entries(rule.styles)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}:${value} !important`)
    .join(";")}}`).join("\n");
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
  const parts: string[] = [];
  let node: HTMLElement | null = element;
  while (node && node !== document.body && parts.length < 6) {
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
  const stable = Array.from(element.classList).find((name) =>
    !name.includes(":") && !name.includes("[") && !/^(p|m|h|w|min|max|text|bg|border|flex|grid|gap|rounded|shadow|overflow|items|justify)-/.test(name),
  );
  return stable ? `.${safeCssIdent(stable)}` : exactSelector(element);
}

function globalSelector(element: HTMLElement): string {
  const role = element.getAttribute("role");
  if (role) return `[role="${role.replace(/"/g, "\\\"")}"]`;
  const tag = element.tagName.toLowerCase();
  if (/^(button|input|textarea|select|a|h1|h2|h3|h4|h5|h6|p|article|section|aside|nav)$/.test(tag)) return tag;
  return "[data-theme-surface]";
}

const FIELDS = [
  ["color", "צבע טקסט", "color"], ["background-color", "צבע רקע", "color"],
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
  const { exportPreferences, hydratePreferences } = useTheme();
  const [design, setDesign] = useState<ThemeDesignSnapshot>(readDesign);
  const [published, setPublished] = useState<PublishedThemeSystem | null>(BUNDLED_THEME_DEFAULTS);
  const [enabled, setEnabled] = useState(false);
  const [paused, setPaused] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [selected, setSelected] = useState<HTMLElement | null>(null);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<DesignScope>("element");
  const [history, setHistory] = useState<DesignRule[][]>([]);
  const [future, setFuture] = useState<DesignRule[][]>([]);
  const [geometry, setGeometry] = useState<DesignGeometry>(design.geometry || DEFAULT_GEOMETRY);
  const hydratedSnapshot = useRef("");
  const replaying = useRef(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const currentIdentity = isGuest ? "guest" : user?.id || "signed-out";
  const canAuthor = isAdmin && viewerIsAdmin;

  const commitDesign = useCallback((rules: DesignRule[], nextGeometry = geometry) => {
    const next: ThemeDesignSnapshot = { schemaVersion: 1, rules, geometry: nextGeometry, updatedAt: Date.now() };
    setDesign(next);
    persistDesign(next);
  }, [geometry]);

  useEffect(() => {
    ensureStyleTag("design-mode-overrides").textContent = cssText(design.rules);
  }, [design.rules]);

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
    else if (localTheme.updatedAt > 0) setUiPref("themePreferences", localTheme as never);
    else if (published?.themePreferences?.schemaVersion === 1) hydratePreferences(published.themePreferences);
    if (canAuthor && personalDesign?.schemaVersion === 1) {
      setDesign(personalDesign); setGeometry(personalDesign.geometry); persistDesign(personalDesign, false);
    } else if (published?.design?.schemaVersion === 1) {
      setDesign(published.design); setGeometry(published.design.geometry); persistDesign(published.design, false);
    }
    hydratedSnapshot.current = hydrationKey;
  }, [canAuthor, currentIdentity, exportPreferences, hydratePreferences, published, setUiPref, state.uiPrefs?.themeDesign, state.uiPrefs?.themePreferences]);

  useEffect(() => {
    const saveTheme = () => setUiPref("themePreferences", exportPreferences() as never);
    const saveDesign = () => setUiPref("themeDesign", readDesign() as never);
    window.addEventListener(THEME_PREFERENCES_EVENT, saveTheme);
    window.addEventListener("app-theme-design-changed", saveDesign);
    return () => {
      window.removeEventListener(THEME_PREFERENCES_EVENT, saveTheme);
      window.removeEventListener("app-theme-design-changed", saveDesign);
    };
  }, [exportPreferences, setUiPref]);

  useEffect(() => {
    if (!canAuthor && enabled) { setEnabled(false); setSelected(null); }
  }, [canAuthor, enabled]);

  useEffect(() => {
    const tag = ensureStyleTag("design-mode-live-preview");
    if (!selected || !enabled || paused) { tag.textContent = ""; return; }
    const selector = scope === "element" ? exactSelector(selected) : scope === "component" ? componentSelector(selected) : globalSelector(selected);
    tag.textContent = cssText([{ id: "preview", selector, label: "preview", scope, styles: draft }]);
  }, [draft, enabled, paused, scope, selected]);

  useEffect(() => {
    if (!enabled) return;
    const ignored = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-design-mode-ui]");
    const onMove = (event: PointerEvent) => {
      if (paused || ignored(event.target)) return;
      const target = event.target as HTMLElement;
      setHoverRect(target.getBoundingClientRect());
    };
    const onDown = (event: PointerEvent) => {
      if (paused || ignored(event.target) || replaying.current) return;
      const target = event.target as HTMLElement;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.altKey) {
        replaying.current = true;
        target.click();
        queueMicrotask(() => { replaying.current = false; });
        return;
      }
      const computed = getComputedStyle(target);
      const next: Record<string, string> = {};
      for (const [property] of FIELDS) next[property] = computed.getPropertyValue(property).trim();
      setSelected(target); setDraft(next); setScope("element");
    };
    const onClick = (event: MouseEvent) => {
      if (!paused && !replaying.current && !ignored(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selected) setSelected(null); else setEnabled(false);
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled, paused, selected]);

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
    const selector = scope === "element" ? exactSelector(selected) : scope === "component" ? componentSelector(selected) : globalSelector(selected);
    const nextRule: DesignRule = {
      id: `${scope}:${selector}`,
      selector,
      scope,
      label: `${selected.tagName.toLowerCase()} · ${scope === "element" ? "אלמנט" : scope === "component" ? "רכיב" : "כללי"}`,
      styles: Object.fromEntries(Object.entries(draft).filter(([, value]) => value.trim() !== "")),
    };
    setHistory((items) => [...items.slice(-49), design.rules]); setFuture([]);
    commitDesign([...design.rules.filter((rule) => rule.id !== nextRule.id), nextRule]);
    setSelected(null);
    toast.success("העיצוב נשמר");
  }, [commitDesign, design.rules, draft, scope, selected]);

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
      {enabled && typeof document !== "undefined" && createPortal(<>
        {hoverRect && !paused && <div data-design-mode-ui className="pointer-events-none fixed z-[2147483000] border-2 border-dashed border-sky-400 bg-sky-400/10" style={{ left: hoverRect.left, top: hoverRect.top, width: hoverRect.width, height: hoverRect.height }}><span className="absolute bottom-full right-0 rounded-t bg-sky-600 px-2 py-0.5 text-[10px] text-white">{selected ? selected.tagName.toLowerCase() : "לחץ לעריכה"}</span></div>}
        <div data-design-mode-ui dir="rtl" className="fixed bottom-4 left-1/2 z-[2147483001] flex -translate-x-1/2 items-center gap-1 rounded-2xl border-2 border-gold bg-card p-2 shadow-2xl">
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
          className="fixed z-[2147483002] flex min-h-[420px] min-w-[420px] resize overflow-hidden rounded-2xl border-2 border-gold bg-background shadow-2xl"
          style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: Math.min(geometry.height, window.innerHeight - geometry.y - 12) } as CSSProperties}
        >
          <div className="flex min-h-0 w-full flex-col">
            <div className="flex cursor-move items-center justify-between border-b border-gold/40 bg-secondary/60 px-3 py-2" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}>
              <div><div className="font-bold">עריכה חיה</div><div className="text-[11px] text-muted-foreground">בחר ערכים ושמור לפי היקף</div></div>
              <div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => setPaused((value) => !value)} title="השהה/המשך">{paused ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</Button><Button size="icon" variant="ghost" onClick={() => setSelected(null)}><X className="h-4 w-4" /></Button></div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <div className="grid grid-cols-3 gap-1">
                {(["element", "component", "global"] as DesignScope[]).map((item) => <Button key={item} size="sm" variant={scope === item ? "default" : "outline"} onClick={() => setScope(item)}>{item === "element" ? "אלמנט זה" : item === "component" ? "כל רכיב דומה" : "כללי במערכת"}</Button>)}
              </div>
              {!!design.rules.length && <div className="rounded-xl border border-gold/30 bg-card p-2"><div className="mb-1 text-xs font-bold">שינויים שמורים ({design.rules.length})</div><div className="max-h-28 space-y-1 overflow-y-auto">{design.rules.map((rule) => <div key={rule.id} className="flex items-center justify-between gap-2 rounded border border-gold/20 px-2 py-1 text-[11px]"><span className="min-w-0 truncate" dir="ltr">{rule.label} · {rule.selector}</span><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeRule(rule.id)} title="מחק שינוי"><Trash2 className="h-3.5 w-3.5" /></Button></div>)}</div></div>}
              <div className="grid grid-cols-2 gap-2">
                {FIELDS.map(([property, label, type]) => <div key={property} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <div className="flex gap-1">
                    {type === "color" && <><input type="color" className="h-9 w-10 rounded border" value={draft[property]?.startsWith("#") ? draft[property] : "#000000"} onChange={(event) => setDraft((value) => ({ ...value, [property]: event.target.value }))} /><Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={() => void pickScreenColor(property)} title="דגום צבע מהמסך"><MousePointer2 className="h-3.5 w-3.5" /></Button></>}
                    <Input dir="ltr" value={draft[property] || ""} onChange={(event) => setDraft((value) => ({ ...value, [property]: event.target.value }))} className="h-9 flex-1 text-xs" />
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
