import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const PRESETS = [
  { label: "מנטה ושמנת", colors: ["#dcefe5", "#fbf4df"] },
  { label: "שמנת וזהב", colors: ["#fffaf0", "#ecd393"] },
  { label: "נייבי וזהב", colors: ["#142542", "#d8ab35"] },
  { label: "מנטה וזהב", colors: ["#dcefe5", "#ecd393"] },
] as const;

function readColors(value: string): string[] {
  return (value.match(/#[\da-f]{6}\b|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/gi) || [])
    .map((color) => color.startsWith("#") ? color : "#" + (color.match(/\d+/g) || []).map((n) => Number(n).toString(16).padStart(2, "0")).join(""));
}

/** Edits the existing live-design draft; no independent save or storage. */
export interface GradientPreset { id: string; name: string; value: string }
export function LiveGradientEditor({ value, onChange, presets = [], onPresetsChange }: { value: string; onChange: (value: string) => void; presets?: GradientPreset[]; onPresetsChange?: (presets: GradientPreset[]) => void }) {
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const found = readColors(value);
  const [colors, setColors] = useState([found[0] || "#dcefe5", found.at(-1) || "#fbf4df"]);
  const [angle, setAngle] = useState(Number(value.match(/([\d.]+)deg/)?.[1] ?? 125));
  const [kind, setKind] = useState(value.startsWith("radial") ? "radial" : "linear");
  useEffect(() => {
    const parsed = readColors(value);
    if (parsed.length >= 2) setColors([parsed[0], parsed.at(-1)!]);
    setAngle(Number(value.match(/([\d.]+)deg/)?.[1] ?? 125));
    setKind(value.startsWith("radial") ? "radial" : "linear");
  }, [value]);
  const savePreset = () => {
    const trimmed = name.trim();
    if (!trimmed || !/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(value.trim()) || (typeof CSS !== "undefined" && CSS.supports && !CSS.supports("background-image", value))) {
      setNotice("נא להזין שם ולבחור גרדיאנט תקין."); return;
    }
    const existing = presets.find((preset) => preset.name === trimmed);
    onPresetsChange?.([...presets.filter((preset) => preset.id !== existing?.id), { id: existing?.id || crypto.randomUUID(), name: trimmed, value }]);
    setNotice(existing ? "הדוגמה עודכנה בספרייה." : "הדוגמה נשמרה בספרייה.");
    setName("");
  };
  const update = (nextColors = colors, nextAngle = angle, nextKind = kind) => {
    setColors(nextColors); setAngle(nextAngle); setKind(nextKind);
    onChange(nextKind === "radial"
      ? `radial-gradient(circle at center, ${nextColors[0]}, ${nextColors[1]})`
      : `linear-gradient(${nextAngle}deg, ${nextColors[0]}, ${nextColors[1]})`);
  };
  return <section className="space-y-3 rounded-xl border border-gold/30 p-3">
    <div className="font-bold">גרדיאנט לרקע</div>
    <p className="text-xs text-muted-foreground">כל שינוי מוצג מיד בעמוד. כפתור שמור עיצוב שומר לפי ההיקף שבחרת. הגדרת רקע מורכבת קיימת זמינה בשדה המתקדם; בקרי הצבע יוצרים מעבר חדש בין שני צבעים.</p>
    <div className="grid grid-cols-2 gap-2">{PRESETS.map((preset) => <button type="button" key={preset.label} onClick={() => update([...preset.colors], 125, "linear")} className="rounded-lg border border-gold/30 p-2 text-right text-xs">
      <span aria-hidden="true" className="mb-1 block h-8 rounded" style={{ background: `linear-gradient(125deg, ${preset.colors.join(",")})` }} />{preset.label}
    </button>)}</div>
    <div className="flex flex-wrap items-center gap-3">
      {colors.map((color, index) => <label key={index} className="flex items-center gap-1 text-xs">צבע {index + 1}<input aria-label={`צבע גרדיאנט ${index + 1}`} type="color" value={color} onChange={(event) => update(colors.map((c, i) => i === index ? event.target.value : c))} /></label>)}
      <label className="text-xs">סוג מעבר <select aria-label="סוג גרדיאנט" className="rounded border bg-background p-1" value={kind} onChange={(event) => update(colors, angle, event.target.value)}><option value="linear">קווי</option><option value="radial">מעגלי</option></select></label>
    </div>
    {kind === "linear" && <label className="flex items-center gap-2 text-xs">כיוון: {angle}°<input aria-label="כיוון גרדיאנט" type="range" min="0" max="360" value={angle} onChange={(event) => update(colors, Number(event.target.value))} /></label>}
    <Button type="button" variant="outline" size="sm" onClick={() => onChange("none")}>הסר גרדיאנט</Button>
    <label className="block text-xs">רקע מתקדם — לעריכת מעבר קיים או יותר משני צבעים
      <input aria-label="גרדיאנט מתקדם" dir="ltr" className="mt-1 w-full rounded border bg-background p-2 text-xs" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
    {onPresetsChange && <section className="space-y-2 border-t pt-3">
      <h3 className="font-bold">הגרדיאנטים שלי</h3>
      <p className="text-xs text-muted-foreground">שמור דוגמה לשימוש חוזר בכל אלמנט. שם קיים יעדכן את הדוגמה. החלה על העמוד דורשת שמור עיצוב; הספרייה נשמרת עם העדפות העיצוב ומסונכרנת בחשבון מחובר.</p>
      <div className="flex gap-2"><input aria-label="שם דוגמת גרדיאנט" maxLength={60} className="min-w-0 flex-1 rounded border bg-background p-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="שם הדוגמה" /><Button type="button" variant="outline" onClick={savePreset}>שמור כדוגמה</Button></div>
      <p role="status" className="text-xs">{notice}</p>
      {presets.map((preset) => <div key={preset.id} className="flex items-center gap-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded border p-2 text-right" aria-label={`החל דוגמה ${preset.name}`} onClick={() => onChange(preset.value)}><span aria-hidden="true" className="h-7 w-12 shrink-0 rounded" style={{ backgroundImage: preset.value }} /><span className="break-words">{preset.name}</span></button>
        <Button type="button" variant="ghost" size="sm" aria-label={`מחק דוגמה ${preset.name}`} onClick={() => onPresetsChange(presets.filter((item) => item.id !== preset.id))}>מחק</Button>
      </div>)}
    </section>}
  </section>;
}
