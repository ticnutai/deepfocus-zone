import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import {
  Settings as SettingsIcon, Check, X, Type, AlignRight, AlignCenter, AlignLeft,
  Plus, Trash2, Move, GripVertical, Eye, EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const KEY = "dedication_banner";
const CACHE_KEY = "pashash:banner";
const readCachedBanner = (): Settings | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch { return null; }
};
const writeCachedBanner = (s: Settings) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch { /* quota/private */ }
};

const FONT_FAMILIES = [
  { id: "display", label: "כותרת", css: "var(--font-display, 'Frank Ruhl Libre', serif)" },
  { id: "sans", label: "רגיל", css: "system-ui, -apple-system, sans-serif" },
  { id: "serif", label: "סריף", css: "'Frank Ruhl Libre', 'David', serif" },
  { id: "mono", label: "מונו", css: "ui-monospace, 'SF Mono', monospace" },
  { id: "rashi", label: "רש\"י", css: "'Miriam Libre', 'David', serif" },
];
const FONT_SIZES = [
  { id: "xs", label: "זעיר", px: 11 },
  { id: "sm", label: "קטן", px: 13 },
  { id: "md", label: "בינוני", px: 15 },
  { id: "lg", label: "גדול", px: 18 },
  { id: "xl", label: "ענק", px: 22 },
];
const COLORS = [
  { id: "gold", label: "זהב", value: "hsl(var(--gold, 45 80% 50%))" },
  { id: "navy", label: "כחול", value: "hsl(var(--navy, 220 60% 25%))" },
  { id: "fg", label: "רגיל", value: "hsl(var(--foreground))" },
  { id: "muted", label: "מעומעם", value: "hsl(var(--muted-foreground))" },
  { id: "primary", label: "ראשי", value: "hsl(var(--primary))" },
  { id: "red", label: "אדום", value: "#dc2626" },
  { id: "green", label: "ירוק", value: "#16a34a" },
  { id: "purple", label: "סגול", value: "#7c3aed" },
];
const ANIMATIONS = [
  { id: "none", label: "ללא" },
  { id: "marquee", label: "ריצה" },
  { id: "blink", label: "הבהוב" },
  { id: "fade", label: "פעימה" },
] as const;
const SPEEDS = [
  { id: "slow", label: "איטי", sec: 30 },
  { id: "normal", label: "רגיל", sec: 18 },
  { id: "fast", label: "מהיר", sec: 10 },
] as const;

type Style = {
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "right" | "center" | "left";
  animation?: "none" | "marquee" | "blink" | "fade";
  speed?: "slow" | "normal" | "fast";
  direction?: "rtl" | "ltr";
};
type Position =
  | { kind: "header" }
  | { kind: "floating"; x: number; y: number };
type Line = { id: string; text: string; style: Style; position: Position; hidden?: boolean };
type Settings = { lines: Line[]; enabled: boolean };

const DEFAULT_STYLE: Style = {
  fontFamily: "display", fontSize: "sm", color: "fg", bold: true, italic: false,
  align: "center", animation: "none", speed: "normal", direction: "rtl",
};
const newId = () => Math.random().toString(36).slice(2, 10);

// Migrate legacy { text, style } → lines[]
const normalize = (raw: unknown): Settings => {
  const v = (raw ?? {}) as Record<string, unknown>;
  if (Array.isArray((v as { lines?: unknown }).lines)) {
    const lines = ((v as { lines: unknown[] }).lines)
      .map((l) => {
        const obj = (l ?? {}) as Partial<Line>;
        return {
          id: obj.id ?? newId(),
          text: obj.text ?? "",
          style: { ...DEFAULT_STYLE, ...(obj.style ?? {}) },
          position: obj.position ?? { kind: "header" as const },
          hidden: obj.hidden === true,
        } as Line;
      });
    return { lines, enabled: v.enabled !== false };
  }
  // legacy
  const legacyText = typeof v.text === "string" ? v.text : "";
  const legacyStyle = (v.style as Style) ?? {};
  return {
    enabled: v.enabled !== false,
    lines: legacyText
      ? [{ id: newId(), text: legacyText, style: { ...DEFAULT_STYLE, ...legacyStyle }, position: { kind: "header" } }]
      : [],
  };
};

/* ------------------------------ Renderers ------------------------------ */

function StyledText({ s, txt }: { s: Style; txt: string }) {
  const family = FONT_FAMILIES.find(f => f.id === s.fontFamily)?.css ?? FONT_FAMILIES[0].css;
  const size = FONT_SIZES.find(f => f.id === s.fontSize)?.px ?? 13;
  const color = COLORS.find(c => c.id === s.color)?.value ?? "hsl(var(--foreground))";
  const baseStyle: React.CSSProperties = {
    fontFamily: family, fontSize: size, color,
    fontWeight: s.bold ? 700 : 400, fontStyle: s.italic ? "italic" : "normal",
  };
  const animation = s.animation ?? "none";
  const speedSec = SPEEDS.find(x => x.id === (s.speed ?? "normal"))?.sec ?? 18;

  if (animation === "marquee") {
    const dir = s.direction ?? "rtl";
    const animName = dir === "ltr" ? "dedication-marquee-ltr" : "dedication-marquee-rtl";
    return (
      <div className="overflow-hidden w-full">
        <div className="inline-block whitespace-nowrap"
             style={{ ...baseStyle, animation: `${animName} ${speedSec}s linear infinite` }}>
          {txt}
        </div>
      </div>
    );
  }
  const animClass =
    animation === "blink" ? "animate-[dedication-blink_1.2s_steps(2)_infinite]" :
    animation === "fade"  ? "animate-[dedication-fade_2.4s_ease-in-out_infinite]" : "";
  return <span style={baseStyle} className={`truncate ${animClass}`}>{txt}</span>;
}

const justifyClassFor = (a?: Style["align"]) =>
  a === "right" ? "justify-end text-right" :
  a === "left"  ? "justify-start text-left" : "justify-center text-center";

/* ------------------------------ Editor UI ------------------------------ */

function StyleEditor({ style, onChange }: { style: Style; onChange: (s: Style) => void }) {
  const set = (patch: Partial<Style>) => onChange({ ...style, ...patch });
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-semibold mb-1.5 text-muted-foreground">גופן</div>
        <div className="flex flex-wrap gap-1">
          {FONT_FAMILIES.map(f => (
            <button key={f.id} onClick={() => set({ fontFamily: f.id })} style={{ fontFamily: f.css }}
              className={`text-xs px-2 py-1 rounded border ${style.fontFamily === f.id ? "bg-gold text-navy border-gold" : "border-border hover:bg-secondary"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold mb-1.5 text-muted-foreground">גודל</div>
        <div className="flex gap-1">
          {FONT_SIZES.map(s => (
            <button key={s.id} onClick={() => set({ fontSize: s.id })}
              className={`flex-1 text-xs px-1 py-1 rounded border ${style.fontSize === s.id ? "bg-gold text-navy border-gold" : "border-border hover:bg-secondary"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold mb-1.5 text-muted-foreground">צבע</div>
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map(c => (
            <button key={c.id} onClick={() => set({ color: c.id })} title={c.label} style={{ background: c.value }}
              className={`h-7 w-7 rounded-full border-2 ${style.color === c.id ? "border-foreground ring-2 ring-gold" : "border-border"}`} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => set({ bold: !style.bold })}
          className={`flex-1 text-xs px-2 py-1 rounded border font-bold ${style.bold ? "bg-gold text-navy border-gold" : "border-border hover:bg-secondary"}`}>מודגש</button>
        <button onClick={() => set({ italic: !style.italic })}
          className={`flex-1 text-xs px-2 py-1 rounded border italic ${style.italic ? "bg-gold text-navy border-gold" : "border-border hover:bg-secondary"}`}>נטוי</button>
      </div>
      <div>
        <div className="text-xs font-semibold mb-1.5 text-muted-foreground">יישור</div>
        <div className="flex gap-1">
          {([
            { id: "right" as const, icon: AlignRight },
            { id: "center" as const, icon: AlignCenter },
            { id: "left" as const, icon: AlignLeft },
          ]).map(a => {
            const Icon = a.icon;
            const active = (style.align ?? "center") === a.id;
            return (
              <button key={a.id} onClick={() => set({ align: a.id })}
                className={`flex-1 text-xs px-2 py-1 rounded border flex items-center justify-center ${active ? "bg-gold text-navy border-gold" : "border-border hover:bg-secondary"}`}>
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold mb-1.5 text-muted-foreground">אנימציה</div>
        <div className="flex gap-1">
          {ANIMATIONS.map(a => {
            const active = (style.animation ?? "none") === a.id;
            return (
              <button key={a.id} onClick={() => set({ animation: a.id })}
                className={`flex-1 text-xs px-1 py-1 rounded border ${active ? "bg-gold text-navy border-gold" : "border-border hover:bg-secondary"}`}>
                {a.label}
              </button>
            );
          })}
        </div>
      </div>
      {(style.animation ?? "none") !== "none" && (
        <div>
          <div className="text-xs font-semibold mb-1.5 text-muted-foreground">מהירות</div>
          <div className="flex gap-1">
            {SPEEDS.map(sp => {
              const active = (style.speed ?? "normal") === sp.id;
              return (
                <button key={sp.id} onClick={() => set({ speed: sp.id })}
                  className={`flex-1 text-xs px-1 py-1 rounded border ${active ? "bg-gold text-navy border-gold" : "border-border hover:bg-secondary"}`}>
                  {sp.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {(style.animation ?? "none") === "marquee" && (
        <div>
          <div className="text-xs font-semibold mb-1.5 text-muted-foreground">כיוון ריצה</div>
          <div className="flex gap-1">
            {([{ id: "rtl" as const, label: "מימין לשמאל ←" }, { id: "ltr" as const, label: "→ משמאל לימין" }]).map(d2 => {
              const active = (style.direction ?? "rtl") === d2.id;
              return (
                <button key={d2.id} onClick={() => set({ direction: d2.id })}
                  className={`flex-1 text-xs px-1 py-1 rounded border ${active ? "bg-gold text-navy border-gold" : "border-border hover:bg-secondary"}`}>
                  {d2.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------- Floating draggable line ------------------------- */

function FloatingLine({
  line, layoutMode, isAdmin, onMove,
}: { line: Line; layoutMode: boolean; isAdmin: boolean; onMove: (x: number, y: number) => void }) {
  if (line.position.kind !== "floating") return null;
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!layoutMode) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      origX: (line.position as { x: number }).x,
      origY: (line.position as { y: number }).y,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const x = Math.max(0, Math.min(window.innerWidth - 100, dragRef.current.origX + dx));
    const y = Math.max(0, Math.min(window.innerHeight - 30, dragRef.current.origY + dy));
    onMove(x, y);
  };
  const onPointerUp = () => { dragRef.current = null; };

  const node = (
    <div
      ref={ref}
      dir="rtl"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`fixed z-40 px-2 py-1 max-w-[90vw] ${layoutMode ? "cursor-move ring-2 ring-gold/70 ring-dashed bg-background/80 rounded-md" : "pointer-events-none"}`}
      style={{ left: line.position.x, top: line.position.y }}
    >
      <div className={`flex items-center gap-2 ${justifyClassFor(line.style.align)}`}>
        {layoutMode && isAdmin && <Move className="h-3 w-3 text-gold" />}
        <StyledText s={line.style} txt={line.text || (isAdmin ? "(שורה ריקה)" : "")} />
      </div>
    </div>
  );
  return createPortal(node, document.body);
}

/* ============================== Main Banner ============================== */

export function DedicationBanner() {
  const { isAdmin } = usePermissions();
  const [settings, setSettings] = useState<Settings>(() => readCachedBanner() ?? { lines: [], enabled: true });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Settings>({ lines: [], enabled: true });
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState(false);
  const skipReloadRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const apply = (v: unknown) => {
      if (!mounted) return;
      if (skipReloadRef.current) { skipReloadRef.current = false; return; }
      const norm = normalize(v);
      writeCachedBanner(norm);
      setSettings(norm);
    };
    supabase.from("site_settings").select("value").eq("key", KEY).maybeSingle()
      .then(({ data }) => apply(data?.value));
    const channel = supabase.channel("site_settings_dedication")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "site_settings", filter: `key=eq.${KEY}` },
        (payload) => apply((payload.new as { value?: unknown } | null)?.value))
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, []);

  const persist = async (next: Settings, silent = false) => {
    skipReloadRef.current = true;
    writeCachedBanner(next);
    setSettings(next);
    const { error } = await supabase.from("site_settings")
      .upsert([{ key: KEY, value: next as never, updated_at: new Date().toISOString() }]);
    if (error) { toast.error("שמירה נכשלה: " + error.message); return false; }
    if (!silent) toast.success("נשמר");
    return true;
  };

  const openSettings = () => {
    setDraft(settings.lines.length ? settings : {
      ...settings,
      lines: [{ id: newId(), text: "", style: DEFAULT_STYLE, position: { kind: "header" } }],
    });
    setActiveLineId((settings.lines[0]?.id) ?? null);
    setOpen(true);
  };

  const saveDraft = async () => {
    const cleaned: Settings = { ...draft, lines: draft.lines.map(l => ({ ...l, text: l.text.trim() })) };
    const ok = await persist(cleaned);
    if (ok) setOpen(false);
  };

  const updateLine = (id: string, patch: Partial<Line>) => {
    setDraft(d => ({ ...d, lines: d.lines.map(l => l.id === id ? { ...l, ...patch } : l) }));
  };
  const addLine = () => {
    const id = newId();
    setDraft(d => ({ ...d, lines: [...d.lines, { id, text: "", style: DEFAULT_STYLE, position: { kind: "header" } }] }));
    setActiveLineId(id);
  };
  const removeLine = (id: string) => {
    setDraft(d => {
      const lines = d.lines.filter(l => l.id !== id);
      if (activeLineId === id) setActiveLineId(lines[0]?.id ?? null);
      return { ...d, lines };
    });
  };

  // Move floating line during layout mode (writes to live settings + persists, debounced)
  const moveTimer = useRef<number | null>(null);
  const moveFloatingLine = (id: string, x: number, y: number) => {
    setSettings(s => ({
      ...s,
      lines: s.lines.map(l => l.id === id && l.position.kind === "floating"
        ? { ...l, position: { kind: "floating", x, y } } : l),
    }));
    if (moveTimer.current) window.clearTimeout(moveTimer.current);
    moveTimer.current = window.setTimeout(() => {
      setSettings(curr => { void persist(curr, true); return curr; });
    }, 350);
  };

  const togglePosition = (id: string) => {
    setDraft(d => ({
      ...d,
      lines: d.lines.map(l => {
        if (l.id !== id) return l;
        if (l.position.kind === "header") {
          return { ...l, position: { kind: "floating", x: 120, y: 120 } };
        }
        return { ...l, position: { kind: "header" } };
      }),
    }));
  };

  if (!settings.enabled && !isAdmin) return null;

  const headerLines = settings.lines.filter(l => l.position.kind === "header" && !l.hidden);
  const floatingLines = settings.lines.filter(l => l.position.kind === "floating" && !l.hidden);
  const activeLine = draft.lines.find(l => l.id === activeLineId) ?? draft.lines[0] ?? null;

  return (
    <>
      <style>{`
        @keyframes dedication-marquee-rtl { from { transform: translateX(100%); } to { transform: translateX(-100%); } }
        @keyframes dedication-marquee-ltr { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
        @keyframes dedication-blink { 50% { opacity: 0.15; } }
        @keyframes dedication-fade { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
      `}</style>

      {/* Inline header rendering */}
      <div dir="rtl" className="group w-full relative">
        <div className="flex items-center gap-2 min-h-[28px] flex-wrap">
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            {headerLines.length > 0 && (
              headerLines.map(l => (
                <div key={l.id} className={`flex items-center ${justifyClassFor(l.style.align)} ${(l.style.animation ?? "none") === "marquee" ? "w-full" : ""}`}>
                  <StyledText s={l.style} txt={l.text} />
                </div>
              ))
            )}
          </div>

          {isAdmin && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity delay-200">
              <button
                onClick={() => setLayoutMode(m => !m)}
                title={layoutMode ? "סיים פריסה" : "מצב פריסה"}
                className={`h-6 w-6 flex items-center justify-center rounded-full transition-colors ${layoutMode ? "bg-gold text-navy" : "text-gold hover:bg-gold/20"}`}
              >
                <Move className="h-3.5 w-3.5" />
              </button>
              <Popover open={open} onOpenChange={(v) => v ? openSettings() : setOpen(false)}>
                <PopoverTrigger asChild>
                  <button title="הגדרות הקדשה"
                    className="h-6 w-6 flex items-center justify-center rounded-full text-gold hover:bg-gold/20 transition-colors">
                    <SettingsIcon className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[340px] p-3" dir="rtl" align="start">
                  <Tabs defaultValue="lines" className="w-full">
                    <TabsList className="w-full grid grid-cols-2">
                      <TabsTrigger value="lines">הקדשות</TabsTrigger>
                      <TabsTrigger value="design" disabled={!activeLine}>עיצוב</TabsTrigger>
                    </TabsList>

                    <TabsContent value="lines" className="mt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input type="checkbox" checked={draft.enabled}
                            onChange={(e) => setDraft(d => ({ ...d, enabled: e.target.checked }))} />
                          {draft.enabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          הצג באתר
                        </label>
                        <button onClick={addLine} className="text-xs flex items-center gap-1 px-2 py-1 rounded border border-gold/50 hover:bg-secondary">
                          <Plus className="h-3 w-3" /> שורה חדשה
                        </button>
                      </div>

                      <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                        {draft.lines.map((l) => {
                          const active = l.id === activeLineId;
                          return (
                            <div key={l.id}
                              className={`rounded-lg border p-2 space-y-1.5 ${active ? "border-gold bg-secondary/40" : "border-border"}`}
                              onClick={() => setActiveLineId(l.id)}
                            >
                              <input
                                value={l.text}
                                onChange={(e) => updateLine(l.id, { text: e.target.value })}
                                placeholder="טקסט ההקדשה..."
                                className="w-full bg-background border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-gold"
                                style={{
                                  fontFamily: FONT_FAMILIES.find(f => f.id === l.style.fontFamily)?.css,
                                  color: COLORS.find(c => c.id === l.style.color)?.value,
                                  fontWeight: l.style.bold ? 700 : 400,
                                }}
                              />
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1">
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateLine(l.id, { hidden: !l.hidden }); }}
                                  className={`text-[11px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${l.hidden ? "border-muted-foreground/40 text-muted-foreground" : "border-gold/50 text-gold"}`}
                                  title={l.hidden ? "הצג שורה" : "הסתר שורה"}
                                >
                                  {l.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                  {l.hidden ? "מוסתר" : "מוצג"}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); togglePosition(l.id); }}
                                  className="text-[11px] px-1.5 py-0.5 rounded border border-border hover:bg-secondary flex items-center gap-1"
                                  title="שנה מיקום"
                                >
                                  {l.position.kind === "header" ? "כותרת" : "צף"}
                                </button>
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeLine(l.id); }}
                                  className="text-[11px] px-1.5 py-0.5 rounded text-red-500 hover:bg-red-500/10 flex items-center gap-1"
                                >
                                  <Trash2 className="h-3 w-3" /> מחק
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {draft.lines.length === 0 && (
                          <div className="text-center text-xs text-muted-foreground py-4">לחץ "שורה חדשה" כדי להתחיל</div>
                        )}
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-border">
                        <button onClick={() => setOpen(false)}
                          className="text-xs px-3 py-1 rounded border border-border hover:bg-secondary">בטל</button>
                        <button onClick={saveDraft}
                          className="text-xs px-3 py-1 rounded bg-gold text-navy hover:bg-gold/80 font-semibold">שמור</button>
                      </div>
                    </TabsContent>

                    <TabsContent value="design" className="mt-3">
                      {activeLine ? (
                        <>
                          <div className="text-[11px] text-muted-foreground mb-2">
                            עורך עיצוב עבור: <span className="text-foreground">"{activeLine.text || "ללא טקסט"}"</span>
                          </div>
                          <StyleEditor
                            style={activeLine.style}
                            onChange={(s) => updateLine(activeLine.id, { style: s })}
                          />
                          <div className="rounded-lg border border-border p-2 mt-3 bg-secondary/50 text-center">
                            <StyledText s={activeLine.style} txt={activeLine.text || "תצוגה מקדימה"} />
                          </div>
                          <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-border">
                            <button onClick={saveDraft}
                              className="text-xs px-3 py-1 rounded bg-gold text-navy hover:bg-gold/80 font-semibold flex items-center gap-1">
                              <Check className="h-3 w-3" /> שמור
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="text-center text-xs text-muted-foreground py-4">בחר שורה בטאב "הקדשות"</div>
                      )}
                    </TabsContent>
                  </Tabs>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>

        {layoutMode && isAdmin && (
          <div className="absolute -bottom-7 right-0 text-[11px] bg-gold text-navy px-2 py-0.5 rounded shadow z-50">
            מצב פריסה — גרור שורות צפות. לחץ שוב על האייקון לסיום.
          </div>
        )}
      </div>

      {/* Floating lines (rendered to body) */}
      {floatingLines.map(l => (
        <FloatingLine
          key={l.id}
          line={l}
          layoutMode={layoutMode && isAdmin}
          isAdmin={isAdmin}
          onMove={(x, y) => moveFloatingLine(l.id, x, y)}
        />
      ))}
    </>
  );
}