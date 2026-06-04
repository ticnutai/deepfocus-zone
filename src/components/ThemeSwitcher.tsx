import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Palette, Check, Pencil, Copy, RotateCcw, Trash2, Save, X, PanelsTopLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorFavoritesRow } from "@/components/ui/color-favorites-row";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme, THEME_TOKEN_KEYS, type ThemeTokens, type ThemeDef, BUILTIN_THEMES } from "@/theme/ThemeProvider";
import { useColorFavorites } from "@/lib/study/colorFavorites";
import { cn } from "@/lib/utils";

const TOKEN_LABELS: Record<string, string> = {
  background: "רקע ראשי", foreground: "טקסט ראשי",
  card: "רקע כרטיס", "card-foreground": "טקסט כרטיס",
  popover: "רקע פופאובר", "popover-foreground": "טקסט פופאובר",
  primary: "צבע ראשי", "primary-foreground": "טקסט על ראשי",
  secondary: "צבע משני", "secondary-foreground": "טקסט על משני",
  muted: "מעומעם", "muted-foreground": "טקסט מעומעם",
  accent: "צבע דגש", "accent-foreground": "טקסט על דגש",
  destructive: "צבע סכנה", "destructive-foreground": "טקסט סכנה",
  border: "מסגרת", input: "שדות קלט", ring: "טבעת מיקוד",
  gold: "זהב", "gold-soft": "זהב רך", navy: "נייבי", "navy-soft": "נייבי רך",
  "sidebar-background": "סייד-בר רקע", "sidebar-foreground": "סייד-בר טקסט",
  "sidebar-primary": "סייד-בר ראשי", "sidebar-primary-foreground": "סייד-בר טקסט-על-ראשי",
  "sidebar-accent": "סייד-בר דגש", "sidebar-accent-foreground": "סייד-בר טקסט-על-דגש",
  "sidebar-border": "סייד-בר מסגרת", "sidebar-ring": "סייד-בר טבעת",
  "focus-streak-from": "רצף ימים - צבע התחלה",
  "focus-streak-to": "רצף ימים - צבע סיום",
  "focus-streak-icon": "רצף ימים - צבע אייקון",
  "focus-streak-icon-border": "רצף ימים - צבע מסגרת אייקון",
  "focus-due-from": "חזרות בתור - צבע התחלה",
  "focus-due-to": "חזרות בתור - צבע סיום",
  "focus-due-icon": "חזרות בתור - צבע אייקון",
  "focus-due-icon-border": "חזרות בתור - צבע מסגרת אייקון",
  "focus-learned-from": "נלמד היום - צבע התחלה",
  "focus-learned-to": "נלמד היום - צבע סיום",
  "focus-learned-icon": "נלמד היום - צבע אייקון",
  "focus-learned-icon-border": "נלמד היום - צבע מסגרת אייקון",
};

/** Convert "H S% L%" → "#rrggbb" for the color picker UI. */
function hslStrToHex(hslStr?: string): string {
  if (!hslStr) return "#000000";
  const m = hslStr.trim().match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/);
  if (!m) return "#000000";
  const h = parseFloat(m[1]) / 360, s = parseFloat(m[2]) / 100, l = parseFloat(m[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function hexToHslStr(hex: string): string {
  const v = hex.replace("#", "");
  if (v.length !== 6) return "0 0% 0%";
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0; const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

interface EditorProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  themeId: string;
}

type PreviewMode = "page" | "components" | "live";
type MobilePane = "preview" | "editor";

const PANEL_MIN_W = 920;
const PANEL_MAX_W = 1500;
const PANEL_MIN_W_MOBILE = 340;

function tokenVarsStyle(tokens: ThemeTokens) {
  const style: Record<string, string> = {};
  for (const key of THEME_TOKEN_KEYS) {
    const value = tokens[key];
    if (value) style[`--${key}`] = value;
  }
  return style;
}

function hexToRgb(hex: string): string | null {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return `rgb(${r}, ${g}, ${b})`;
}

function normalizeCssColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  const rgbMatch = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[-\d.]+)?\)$/);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (v.startsWith("#")) return hexToRgb(v);
  return null;
}

function collectTokenCandidatesFromElement(
  target: HTMLElement,
  tokenRgbMap: Record<string, string>,
): string[] {
  const matches: string[] = [];
  const seen = new Set<string>();
  const colorProps: Array<keyof CSSStyleDeclaration> = [
    "backgroundColor",
    "color",
    "borderColor",
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
    "outlineColor",
  ];

  let node: HTMLElement | null = target;
  let depth = 0;
  while (node && depth < 7) {
    const style = window.getComputedStyle(node);
    for (const prop of colorProps) {
      const normalized = normalizeCssColor(String(style[prop] ?? ""));
      if (!normalized) continue;
      for (const token of THEME_TOKEN_KEYS) {
        if (tokenRgbMap[token] === normalized && !seen.has(token)) {
          seen.add(token);
          matches.push(token);
        }
      }
    }
    node = node.parentElement;
    depth += 1;
  }

  return matches;
}

function PreviewChip({
  label,
  tokens,
  selectedToken,
  hoveredToken,
  onHover,
  onLeave,
  onPick,
  className,
}: {
  label: string;
  tokens: string[];
  selectedToken: string | null;
  hoveredToken: string | null;
  onHover: (token: string | null) => void;
  onLeave: () => void;
  onPick: (tokens: string[]) => void;
  className?: string;
}) {
  const isActive = tokens.some((t) => t === selectedToken || t === hoveredToken);
  const hoverToken = tokens[0] ?? null;

  return (
    <button
      type="button"
      onMouseEnter={() => onHover(hoverToken)}
      onMouseLeave={onLeave}
      onClick={() => onPick(tokens)}
      className={cn(
        "rounded-lg border px-3 py-2 text-right text-[11px] transition-all",
        isActive
          ? "border-navy bg-gold/20 ring-2 ring-gold/60"
          : "border-gold/30 bg-card hover:border-gold/60 hover:bg-gold-soft/20",
        className,
      )}
      title={tokens.join(" / ")}
    >
      {label}
    </button>
  );
}

function ThemeEditorDialog({ open, onOpenChange, themeId }: EditorProps) {
  const { allThemes, saveThemeTokens, duplicateTheme, setTheme } = useTheme();
  const { favorites, addFavorite, removeFavorite, moveFavorite } = useColorFavorites();
  const theme = allThemes.find((t) => t.id === themeId);
  const builtinDefault = useMemo(() => BUILTIN_THEMES.find((t) => t.id === themeId)?.tokens, [themeId]);
  const [draft, setDraft] = useState<ThemeTokens>({});
  const [dupName, setDupName] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("page");
  const [mobilePane, setMobilePane] = useState<MobilePane>("preview");
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [hoveredToken, setHoveredToken] = useState<string | null>(null);
  const [pendingTokens, setPendingTokens] = useState<string[]>([]);
  const [panelWidth, setPanelWidth] = useState(1180);
  const [resizingSide, setResizingSide] = useState<"left" | "right" | null>(null);
  const [isMobileView, setIsMobileView] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(1180);
  const tokenRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const liveFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [livePreviewUrl, setLivePreviewUrl] = useState("/");
  const liveHighlightedElsRef = useRef<HTMLElement[]>([]);
  const liveHoverRafRef = useRef<number | null>(null);
  const pendingHoverTokenRef = useRef<string | null>(null);
  const previewVars = useMemo(() => tokenVarsStyle(draft), [draft]);
  const tokenRgbMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const token of THEME_TOKEN_KEYS) {
      const hsl = draft[token];
      if (!hsl) continue;
      const rgb = hexToRgb(hslStrToHex(hsl));
      if (rgb) map[token] = rgb;
    }
    return map;
  }, [draft]);

  useEffect(() => {
    if (open && theme) {
      setDraft({ ...theme.tokens });
      setDupName(`${theme.label} — עותק`);
      setSelectedToken(null);
      setHoveredToken(null);
      setPendingTokens([]);
      setPreviewMode("page");
      setMobilePane("preview");
      setLivePreviewUrl(`${window.location.pathname}${window.location.search}${window.location.hash}` || "/");
    }
  }, [open, theme]);

  const clearLiveHighlights = () => {
    for (const el of liveHighlightedElsRef.current) el.classList.remove("theme-live-highlight");
    liveHighlightedElsRef.current = [];
  };

  const highlightLiveByToken = (token: string | null) => {
    clearLiveHighlights();
    if (!token || !tokenRgbMap[token]) return;

    const frameDoc = liveFrameRef.current?.contentDocument;
    if (!frameDoc?.body) return;

    const needle = tokenRgbMap[token];
    const colorProps: Array<keyof CSSStyleDeclaration> = [
      "backgroundColor",
      "color",
      "borderColor",
      "borderTopColor",
      "borderRightColor",
      "borderBottomColor",
      "borderLeftColor",
      "outlineColor",
    ];

    const all = Array.from(frameDoc.body.querySelectorAll<HTMLElement>("*"));
    const matched: HTMLElement[] = [];
    for (const el of all) {
      const style = frameDoc.defaultView?.getComputedStyle(el);
      if (!style) continue;
      const isMatch = colorProps.some((p) => normalizeCssColor(String(style[p] ?? "")) === needle);
      if (isMatch) matched.push(el);
      if (matched.length >= 150) break;
    }

    for (const el of matched) el.classList.add("theme-live-highlight");
    liveHighlightedElsRef.current = matched;
  };

  useEffect(() => {
    if (previewMode !== "live") {
      clearLiveHighlights();
      return;
    }
    highlightLiveByToken(hoveredToken ?? selectedToken);
  }, [previewMode, hoveredToken, selectedToken, tokenRgbMap]);

  useEffect(() => {
    if (!open || previewMode !== "live") return;

    const frame = liveFrameRef.current;
    if (!frame) return;

    let cleanupHandlers: (() => void) | null = null;

    const applyDraftToFrame = () => {
      const frameDoc = frame.contentDocument;
      if (!frameDoc) return;
      const root = frameDoc.documentElement;
      for (const key of THEME_TOKEN_KEYS) {
        const value = draft[key];
        if (value) root.style.setProperty(`--${key}`, value);
      }

      if (!frameDoc.getElementById("theme-live-highlight-style")) {
        const styleTag = frameDoc.createElement("style");
        styleTag.id = "theme-live-highlight-style";
        styleTag.textContent = `.theme-live-highlight { outline: 2px solid hsl(var(--navy)); outline-offset: 1px; }`;
        frameDoc.head.appendChild(styleTag);
      }

      const onClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();

        const candidates = collectTokenCandidatesFromElement(target, tokenRgbMap);
        if (candidates.length <= 1) {
          const next = candidates[0] ?? null;
          setPendingTokens([]);
          setSelectedToken(next);
          return;
        }
        setPendingTokens(candidates);
      };

      const onMove = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const candidates = collectTokenCandidatesFromElement(target, tokenRgbMap);
        pendingHoverTokenRef.current = candidates[0] ?? null;
        if (liveHoverRafRef.current !== null) return;
        liveHoverRafRef.current = window.requestAnimationFrame(() => {
          setHoveredToken(pendingHoverTokenRef.current);
          liveHoverRafRef.current = null;
        });
      };

      const onLeave = () => setHoveredToken(null);

      frameDoc.addEventListener("click", onClick, true);
      frameDoc.addEventListener("mousemove", onMove, true);
      frameDoc.addEventListener("mouseleave", onLeave, true);

      cleanupHandlers = () => {
        frameDoc.removeEventListener("click", onClick, true);
        frameDoc.removeEventListener("mousemove", onMove, true);
        frameDoc.removeEventListener("mouseleave", onLeave, true);
        if (liveHoverRafRef.current !== null) {
          window.cancelAnimationFrame(liveHoverRafRef.current);
          liveHoverRafRef.current = null;
        }
      };

      highlightLiveByToken(hoveredToken ?? selectedToken);
    };

    frame.addEventListener("load", applyDraftToFrame);
    applyDraftToFrame();

    return () => {
      frame.removeEventListener("load", applyDraftToFrame);
      cleanupHandlers?.();
      setHoveredToken(null);
    };
  }, [open, previewMode, draft, tokenRgbMap, selectedToken, hoveredToken]);

  useEffect(() => {
    if (!open) return;
    const checkMobile = () => setIsMobileView(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || !resizingSide) return;
    const onMouseMove = (e: MouseEvent) => {
      const directionFactor = resizingSide === "left" ? -1 : 1;
      const delta = (e.clientX - resizeStartXRef.current) * directionFactor;
      const minW = isMobileView ? PANEL_MIN_W_MOBILE : PANEL_MIN_W;
      const maxW = Math.min(PANEL_MAX_W, window.innerWidth - 32);
      setPanelWidth(Math.max(minW, Math.min(maxW, resizeStartWidthRef.current + delta)));
    };
    const onMouseUp = () => setResizingSide(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [open, resizingSide, isMobileView]);

  if (!theme) return null;
  if (!open) return null;

  const startResize = (side: "left" | "right", clientX: number) => {
    resizeStartXRef.current = clientX;
    resizeStartWidthRef.current = panelWidth;
    setResizingSide(side);
  };

  const setToken = (k: string, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSelectedToken(k);
  };

  const selectedTokenColorHex = selectedToken ? hslStrToHex(draft[selectedToken] ?? "") : "";

  const focusTokenRow = (token: string) => {
    const node = tokenRowRefs.current[token];
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const revealLiveToken = (token: string | null) => {
    if (previewMode !== "live" || !token) return;
    highlightLiveByToken(token);
    const firstMatch = liveHighlightedElsRef.current[0];
    firstMatch?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  };

  const pickFromPreview = (tokens: string[]) => {
    if (tokens.length <= 1) {
      const next = tokens[0] ?? null;
      setSelectedToken(next);
      setPendingTokens([]);
      if (next) {
        focusTokenRow(next);
        revealLiveToken(next);
      }
      return;
    }
    setPendingTokens(tokens);
  };

  const choosePendingToken = (token: string) => {
    setSelectedToken(token);
    setPendingTokens([]);
    focusTokenRow(token);
    revealLiveToken(token);
  };

  const handleSave = () => {
    saveThemeTokens(themeId, draft);
    setTheme(themeId); // re-apply
    onOpenChange(false);
  };
  const handleDuplicate = () => {
    const newId = duplicateTheme(themeId, dupName.trim() || `${theme.label} — עותק`, draft);
    setTheme(newId);
    onOpenChange(false);
  };
  const handleReset = () => {
    if (!confirm("לאפס את הטיוטה לברירת המחדל המקורית של הערכה?")) return;
    if (builtinDefault) setDraft({ ...builtinDefault });
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] pointer-events-none" dir="rtl">
      <div
        className="pointer-events-auto fixed left-1/2 top-3 flex max-h-[94vh] -translate-x-1/2 flex-col overflow-hidden rounded-3xl border-2 border-gold/70 bg-background shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
        style={{ width: isMobileView ? "95vw" : `${panelWidth}px` }}
      >
        {!isMobileView && (
          <>
            <button
              type="button"
              onMouseDown={(e) => startResize("left", e.clientX)}
              className="absolute left-0 top-1/2 z-10 h-24 w-2 -translate-x-1/2 -translate-y-1/2 cursor-col-resize rounded-full border border-gold/60 bg-card/90"
              title="הגדל/הקטן מהצד השמאלי"
              aria-label="הגדל/הקטן מהצד השמאלי"
            />
            <button
              type="button"
              onMouseDown={(e) => startResize("right", e.clientX)}
              className="absolute right-0 top-1/2 z-10 h-24 w-2 translate-x-1/2 -translate-y-1/2 cursor-col-resize rounded-full border border-gold/60 bg-card/90"
              title="הגדל/הקטן מהצד הימני"
              aria-label="הגדל/הקטן מהצד הימני"
            />
          </>
        )}

        <div className="flex items-center justify-between border-b border-gold/40 bg-gradient-to-l from-gold/10 via-secondary/30 to-transparent px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="rounded-full border border-gold/60">
            <X className="h-4 w-4" />
          </Button>
          <div className="text-right">
            <div className="flex items-center gap-2 text-xl font-display font-bold text-foreground">
              עריכת ערכה: {theme.label}
              <Palette className="h-5 w-5 text-gold" />
            </div>
            {!theme.builtin && <div className="text-xs text-muted-foreground">(מותאמת אישית)</div>}
          </div>
        </div>

        {isMobileView && (
          <div className="flex items-center gap-2 border-b border-gold/30 px-3 py-2">
            <Button
              type="button"
              size="sm"
              variant={mobilePane === "preview" ? "default" : "outline"}
              className={cn("h-8", mobilePane === "preview" ? "bg-gradient-navy text-primary-foreground" : "border-gold/50")}
              onClick={() => setMobilePane("preview")}
            >
              תצוגה
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mobilePane === "editor" ? "default" : "outline"}
              className={cn("h-8", mobilePane === "editor" ? "bg-gradient-navy text-primary-foreground" : "border-gold/50")}
              onClick={() => setMobilePane("editor")}
            >
              עריכה
            </Button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <section
            className={cn(
              "min-h-0 border-l border-gold/30 bg-secondary/20",
              isMobileView ? (mobilePane === "preview" ? "flex w-full flex-col" : "hidden") : "flex w-1/2 flex-col",
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-gold/30 px-3 py-2">
              <div className="text-xs text-muted-foreground">תצוגה מקדימה חיה</div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={previewMode === "page" ? "default" : "outline"}
                  className={cn("h-7 px-2 text-xs", previewMode === "page" ? "bg-gradient-navy text-primary-foreground" : "border-gold/50")}
                  onClick={() => setPreviewMode("page")}
                >
                  עמוד
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={previewMode === "components" ? "default" : "outline"}
                  className={cn("h-7 px-2 text-xs", previewMode === "components" ? "bg-gradient-navy text-primary-foreground" : "border-gold/50")}
                  onClick={() => setPreviewMode("components")}
                >
                  רכיבים
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={previewMode === "live" ? "default" : "outline"}
                  className={cn("h-7 px-2 text-xs", previewMode === "live" ? "bg-gradient-navy text-primary-foreground" : "border-gold/50")}
                  onClick={() => setPreviewMode("live")}
                >
                  עמוד חי
                </Button>
              </div>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto p-3"
              style={previewVars as CSSProperties}
            >
              {pendingTokens.length > 1 && (
                <div className="mb-3 rounded-xl border border-gold/50 bg-gold-soft/30 p-2 text-xs">
                  <div className="mb-2 font-semibold text-foreground">נמצאו כמה צבעים לאזור הזה, בחר מה לערוך:</div>
                  <div className="flex flex-wrap gap-2">
                    {pendingTokens.map((token) => (
                      <button
                        key={token}
                        type="button"
                        onClick={() => choosePendingToken(token)}
                        className="rounded-md border border-gold/60 bg-card px-2 py-1 hover:bg-gold/20"
                      >
                        {TOKEN_LABELS[token] ?? token}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {previewMode === "live" ? (
                <div className="space-y-2 rounded-2xl border border-gold/40 bg-card p-2">
                  <div className="text-[11px] text-muted-foreground px-1">
                    תצוגת עמוד אמיתי עם מיפוי דו-כיווני: ריחוף/לחיצה בתצוגה ממפים צבעים לעריכה, וריחוף על צבע מסמן אזורים תואמים.
                  </div>
                  <div className="h-[520px] overflow-hidden rounded-xl border-2 border-navy/80 bg-background">
                    <iframe
                      ref={liveFrameRef}
                      title="תצוגה מקדימה עמוד חי"
                      src={livePreviewUrl}
                      className="h-full w-full bg-white"
                    />
                  </div>
                </div>
              ) : previewMode === "page" ? (
                <div className="space-y-3 rounded-2xl border border-gold/40 bg-[hsl(var(--background))] p-3 text-[hsl(var(--foreground))]">
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <PreviewChip
                        label="כותרת ראשית"
                        tokens={["foreground", "primary"]}
                        selectedToken={selectedToken}
                        hoveredToken={hoveredToken}
                        onHover={setHoveredToken}
                        onLeave={() => setHoveredToken(null)}
                        onPick={pickFromPreview}
                      />
                      <PreviewChip
                        label="כפתור ראשי"
                        tokens={["primary", "primary-foreground"]}
                        selectedToken={selectedToken}
                        hoveredToken={hoveredToken}
                        onHover={setHoveredToken}
                        onLeave={() => setHoveredToken(null)}
                        onPick={pickFromPreview}
                        className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <PreviewChip
                        label="כרטיס תוכן"
                        tokens={["card", "card-foreground", "border"]}
                        selectedToken={selectedToken}
                        hoveredToken={hoveredToken}
                        onHover={setHoveredToken}
                        onLeave={() => setHoveredToken(null)}
                        onPick={pickFromPreview}
                      />
                      <PreviewChip
                        label="כפתור משני"
                        tokens={["secondary", "secondary-foreground"]}
                        selectedToken={selectedToken}
                        hoveredToken={hoveredToken}
                        onHover={setHoveredToken}
                        onLeave={() => setHoveredToken(null)}
                        onPick={pickFromPreview}
                        className="bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
                      />
                      <PreviewChip
                        label="דגש/אקסנט"
                        tokens={["accent", "accent-foreground"]}
                        selectedToken={selectedToken}
                        hoveredToken={hoveredToken}
                        onHover={setHoveredToken}
                        onLeave={() => setHoveredToken(null)}
                        onPick={pickFromPreview}
                        className="bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                      />
                      <PreviewChip
                        label="סיידבר"
                        tokens={["sidebar-background", "sidebar-foreground", "sidebar-border"]}
                        selectedToken={selectedToken}
                        hoveredToken={hoveredToken}
                        onHover={setHoveredToken}
                        onLeave={() => setHoveredToken(null)}
                        onPick={pickFromPreview}
                        className="bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))]"
                      />
                      <PreviewChip
                        label="זהב וקישוט"
                        tokens={["gold", "gold-soft"]}
                        selectedToken={selectedToken}
                        hoveredToken={hoveredToken}
                        onHover={setHoveredToken}
                        onLeave={() => setHoveredToken(null)}
                        onPick={pickFromPreview}
                        className="bg-[hsl(var(--gold-soft))]"
                      />
                      <PreviewChip
                        label="נייבי"
                        tokens={["navy", "navy-soft"]}
                        selectedToken={selectedToken}
                        hoveredToken={hoveredToken}
                        onHover={setHoveredToken}
                        onLeave={() => setHoveredToken(null)}
                        onPick={pickFromPreview}
                        className="bg-[hsl(var(--navy-soft))]"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded-2xl border border-gold/40 bg-[hsl(var(--background))] p-3 text-[hsl(var(--foreground))]">
                  <div className="grid grid-cols-2 gap-2">
                    <PreviewChip
                      label="Input"
                      tokens={["input", "foreground", "background"]}
                      selectedToken={selectedToken}
                      hoveredToken={hoveredToken}
                      onHover={setHoveredToken}
                      onLeave={() => setHoveredToken(null)}
                      onPick={pickFromPreview}
                    />
                    <PreviewChip
                      label="Popover"
                      tokens={["popover", "popover-foreground", "border"]}
                      selectedToken={selectedToken}
                      hoveredToken={hoveredToken}
                      onHover={setHoveredToken}
                      onLeave={() => setHoveredToken(null)}
                      onPick={pickFromPreview}
                    />
                    <PreviewChip
                      label="Ring Focus"
                      tokens={["ring"]}
                      selectedToken={selectedToken}
                      hoveredToken={hoveredToken}
                      onHover={setHoveredToken}
                      onLeave={() => setHoveredToken(null)}
                      onPick={pickFromPreview}
                      className="ring-2 ring-[hsl(var(--ring))]"
                    />
                    <PreviewChip
                      label="Destructive"
                      tokens={["destructive", "destructive-foreground"]}
                      selectedToken={selectedToken}
                      hoveredToken={hoveredToken}
                      onHover={setHoveredToken}
                      onLeave={() => setHoveredToken(null)}
                      onPick={pickFromPreview}
                      className="bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]"
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          <section
            className={cn(
              "min-h-0",
              isMobileView ? (mobilePane === "editor" ? "flex w-full flex-col" : "hidden") : "flex w-1/2 flex-col",
            )}
          >
            <div className="flex items-center justify-between border-b border-gold/30 px-3 py-2">
              <div className="text-xs text-muted-foreground">עריכת צבעים</div>
              <div className="text-[11px] text-muted-foreground">
                סימון: זהב בצבעים + מסגרת נייבי בתצוגה
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
              <div className="flex items-center gap-2 rounded-xl border-2 border-gold/30 bg-card p-3">
                <PanelsTopLeft className="h-4 w-4 text-gold" />
                <span className="text-xs text-muted-foreground">בחר צבע מהרשימה או לחץ באזור בתצוגה המקדימה</span>
              </div>

              <div className="rounded-xl border border-gold/30 bg-secondary/20 p-2.5">
                <ColorFavoritesRow
                  favorites={favorites}
                  currentColor={selectedToken ? selectedTokenColorHex : undefined}
                  onAddCurrent={selectedToken ? () => addFavorite(selectedTokenColorHex) : undefined}
                  onPick={(color) => {
                    if (!selectedToken) return;
                    setToken(selectedToken, hexToHslStr(color));
                  }}
                  onRemove={removeFavorite}
                  onMove={moveFavorite}
                  emptyText="אין צבעים מועדפים. בחר טוקן והוסף צבע למועדפים."
                />
                {!selectedToken && (
                  <p className="pt-1 text-[10px] text-muted-foreground">כדי להחיל צבע מועדף, בחר קודם טוקן צבע מהרשימה.</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {THEME_TOKEN_KEYS.map((k) => {
                  const val = draft[k] ?? "";
                  const hex = hslStrToHex(val);
                  const rowActive = k === selectedToken || k === hoveredToken;
                  return (
                    <div
                      key={k}
                      ref={(el) => { tokenRowRefs.current[k] = el; }}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border p-2 transition-all",
                        rowActive
                          ? "border-gold bg-gold-soft/30 ring-2 ring-gold/60"
                          : "border-gold/20 bg-card",
                      )}
                      onMouseEnter={() => setHoveredToken(k)}
                      onMouseLeave={() => setHoveredToken(null)}
                      onClick={() => {
                        setSelectedToken(k);
                        revealLiveToken(k);
                      }}
                    >
                      <input
                        type="color"
                        value={hex}
                        onChange={(e) => setToken(k, hexToHslStr(e.target.value))}
                        className="h-8 w-10 cursor-pointer rounded border border-gold/30 bg-transparent"
                        title={k}
                      />
                      <div className="min-w-0 flex-1">
                        <Label className="block text-[11px] text-muted-foreground">{TOKEN_LABELS[k] ?? k}</Label>
                        <Input
                          value={val}
                          onChange={(e) => setToken(k, e.target.value)}
                          placeholder="H S% L%"
                          className="h-7 text-right font-mono text-xs"
                          dir="ltr"
                          onFocus={() => {
                            setSelectedToken(k);
                            revealLiveToken(k);
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 rounded-lg border border-gold/30 bg-secondary/30 p-3">
                <Label className="flex items-center gap-1.5 text-xs">
                  <Copy className="h-3.5 w-3.5 text-gold" /> שם לשכפול (כדי לשמור כערכה חדשה):
                </Label>
                <Input value={dupName} onChange={(e) => setDupName(e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gold/20 p-3">
          <div className="flex gap-2">
            {theme.builtin && (
              <Button variant="outline" size="sm" onClick={handleReset} className="gap-1 border-gold/40">
                <RotateCcw className="h-3.5 w-3.5" /> אפס לברירת מחדל
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="gap-1">
              <X className="h-3.5 w-3.5" /> ביטול
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleDuplicate} className="gap-1 border-2 border-gold/60">
              <Copy className="h-3.5 w-3.5" /> שכפל ושמור
            </Button>
            <Button size="sm" onClick={handleSave} className="gap-1 bg-gradient-navy text-primary-foreground">
              <Save className="h-3.5 w-3.5" /> שמור
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const ThemeSwitcher = () => {
  const { theme, setTheme, allThemes, deleteCustomTheme } = useTheme();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openEditor = (id: string) => { setEditingId(id); setEditorOpen(true); };

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline" size="icon"
            className="aspect-square h-6 w-6 rounded-full border border-gold/70 bg-card text-navy hover:bg-secondary [&_svg]:size-3"
            aria-label="בחר ערכת נושא"
          >
            <Palette className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 border-2 border-gold rounded-2xl shadow-elegant">
          <div className="space-y-1">
            <p className="font-display text-base font-semibold text-foreground">ערכות נושא</p>
            <p className="text-xs text-muted-foreground mb-3">בחר, ערוך, או שכפל</p>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {allThemes.map((t: ThemeDef) => {
                const active = t.id === theme;
                return (
                  <div key={t.id} className={cn(
                    "flex items-center gap-2 p-2 rounded-xl border-2 transition-all",
                    active ? "border-gold bg-secondary shadow-gold" : "border-transparent hover:border-gold/40 hover:bg-secondary/60",
                  )}>
                    <button onClick={() => setTheme(t.id)} className="flex-1 flex items-center gap-2 text-right">
                      <div className="flex -space-x-1 rtl:space-x-reverse">
                        {t.swatch.map((c, i) => (
                          <span key={i} className="h-6 w-6 rounded-full border-2 border-card" style={{ background: c }} />
                        ))}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{t.label}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{t.description}</div>
                      </div>
                      {active && <Check className="h-4 w-4 text-gold shrink-0" />}
                    </button>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openEditor(t.id); }}
                        title="ערוך ערכה"
                        className="p-1.5 rounded hover:bg-card text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {!t.builtin && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`למחוק את הערכה "${t.label}"?`)) deleteCustomTheme(t.id);
                          }}
                          title="מחק ערכה"
                          className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {editingId && (
        <ThemeEditorDialog open={editorOpen} onOpenChange={setEditorOpen} themeId={editingId} />
      )}
    </>
  );
};
