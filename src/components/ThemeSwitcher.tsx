import { useMemo, useState } from "react";
import { Palette, Check, Pencil, Copy, RotateCcw, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useTheme, THEME_TOKEN_KEYS, type ThemeTokens, type ThemeDef, BUILTIN_THEMES } from "@/theme/ThemeProvider";
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

function ThemeEditorDialog({ open, onOpenChange, themeId }: EditorProps) {
  const { allThemes, saveThemeTokens, duplicateTheme, resetBuiltin, setTheme } = useTheme();
  const theme = allThemes.find((t) => t.id === themeId);
  const builtinDefault = useMemo(() => BUILTIN_THEMES.find((t) => t.id === themeId)?.tokens, [themeId]);
  const [draft, setDraft] = useState<ThemeTokens>({});
  const [dupName, setDupName] = useState("");

  // Sync draft when dialog opens or theme changes
  useMemo(() => {
    if (open && theme) {
      setDraft({ ...theme.tokens });
      setDupName(`${theme.label} — עותק`);
    }
  }, [open, themeId]);

  if (!theme) return null;

  const setToken = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

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
    if (!confirm("לאפס את הערכה חזרה לברירת המחדל המקורית? כל השינויים שנשמרו לערכה הזו יימחקו.")) return;
    resetBuiltin(themeId);
    if (builtinDefault) setDraft({ ...builtinDefault });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0" dir="rtl">
        <DialogHeader className="p-4 border-b border-gold/30 bg-gradient-to-l from-gold/10 via-secondary/30 to-transparent">
          <DialogTitle className="text-right text-xl font-display font-bold flex items-center gap-2">
            <Palette className="h-5 w-5 text-gold" />
            עריכת ערכה: {theme.label}
            {!theme.builtin && <span className="text-xs text-muted-foreground font-normal">(מותאמת אישית)</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Preview swatches */}
          <div className="flex items-center gap-2 p-3 rounded-lg border-2 border-gold/30 bg-card">
            <span className="text-xs text-muted-foreground">תצוגה מקדימה:</span>
            <div className="flex -space-x-1 rtl:space-x-reverse">
              {["background", "primary", "accent", "gold", "navy"].map((k) => (
                <span key={k} className="h-7 w-7 rounded-full border-2 border-card shadow-sm"
                  style={{ background: draft[k as keyof ThemeTokens] ? `hsl(${draft[k as keyof ThemeTokens]})` : "transparent" }}
                  title={k} />
              ))}
            </div>
          </div>

          {/* Token grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {THEME_TOKEN_KEYS.map((k) => {
              const val = draft[k] ?? "";
              const hex = hslStrToHex(val);
              return (
                <div key={k} className="flex items-center gap-2 p-2 rounded-lg border border-gold/20 bg-card">
                  <input
                    type="color"
                    value={hex}
                    onChange={(e) => setToken(k, hexToHslStr(e.target.value))}
                    className="h-8 w-10 rounded border border-gold/30 cursor-pointer bg-transparent"
                    title={k}
                  />
                  <div className="flex-1 min-w-0">
                    <Label className="text-[11px] text-muted-foreground block">{TOKEN_LABELS[k] ?? k}</Label>
                    <Input
                      value={val}
                      onChange={(e) => setToken(k, e.target.value)}
                      placeholder="H S% L%"
                      className="h-7 text-xs font-mono text-right"
                      dir="ltr"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Duplicate name field */}
          <div className="p-3 rounded-lg border border-gold/30 bg-secondary/30 space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <Copy className="h-3.5 w-3.5 text-gold" /> שם לשכפול (כדי לשמור כערכה חדשה):
            </Label>
            <Input value={dupName} onChange={(e) => setDupName(e.target.value)} className="h-8 text-sm" />
          </div>
        </div>

        <DialogFooter className="p-3 border-t border-gold/20 gap-2 flex-wrap sm:justify-between">
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            className="rounded-full border-2 border-gold bg-card text-navy hover:bg-secondary shadow-elegant"
            aria-label="בחר ערכת נושא"
          >
            <Palette className="h-4 w-4" />
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
