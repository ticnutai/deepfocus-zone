import { Minus, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const LENGTHS = new Set(["font-size", "line-height", "letter-spacing", "word-spacing", "padding", "margin", "border-width", "border-radius", "width", "height", "min-width", "min-height", "max-width", "max-height", "gap"]);
const NEGATIVE = new Set(["margin", "letter-spacing", "word-spacing"]);
const CHOICES: Record<string, string[][]> = {
  "font-family": [['"Heebo", sans-serif', "Heebo — עברית נקייה"], ['"Assistant", sans-serif', "Assistant — קריא ומרווח"], ['Arial, sans-serif', "Arial"], ['"David", serif', "David — מסורתי"], ['"Noto Serif Hebrew", serif', "Noto Serif Hebrew — ספר"], ['system-ui, sans-serif', "גופן המערכת"], ['serif', "סריף"], ['monospace', "רוחב אחיד"]],
  "font-weight": [["300", "דק"], ["400", "רגיל"], ["500", "בינוני"], ["600", "מודגש מעט"], ["700", "מודגש"], ["800", "עבה"], ["900", "עבה מאוד"]],
  "text-align": [["start", "תחילת השורה"], ["center", "מרכז"], ["end", "סוף השורה"], ["right", "ימין"], ["left", "שמאל"], ["justify", "יישור לשני הצדדים"]],
};
export function parseStyleNumber(value: string) {
  const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|rem|em|%|vw|vh)?$/.exec(value.trim());
  return match ? { number: Number(match[1]), unit: match[2] || "" } : null;
}

/** Edits the existing draft only; never flattens complex CSS into a guessed number. */
export function LiveStyleControl({ property, label, value, onChange }: {
  property: string; label: string; value: string; onChange: (value: string) => void;
}) {
  const choices = CHOICES[property];
  const parsed = parseStyleNumber(value);
  const numeric = LENGTHS.has(property) || property === "opacity";
  const unit = parsed?.unit || (property === "opacity" || property === "line-height" ? "" : "px");
  const step = property === "opacity" ? (parsed?.unit === "%" ? 5 : 0.05) : ["em", "rem"].includes(unit) || (property === "line-height" && !unit) ? 0.1 : 1;
  const nudge = (direction: number) => {
    if (!parsed) return;
    let number = Math.round((parsed.number + direction * step) * 1000) / 1000;
    if (!NEGATIVE.has(property)) number = Math.max(0, number);
    if (property === "opacity") number = Math.min(parsed.unit === "%" ? 100 : 1, number);
    onChange(`${number}${parsed.unit || unit}`);
  };
  const raw = <Input aria-label={label} dir="ltr" value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-0 flex-1 text-xs" onKeyDown={numeric ? (event) => {
    if (parsed && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); nudge(event.key === "ArrowUp" ? 1 : -1); }
  } : undefined} />;
  if (choices) return <div className="min-w-0 space-y-1">
    <select aria-label={`בחירת ${label}`} value={choices.some(([key]) => key === value) ? value : "__custom"} onChange={(event) => { if (event.target.value !== "__custom") onChange(event.target.value); }} className="h-10 w-full min-w-0 rounded-lg border border-gold/40 bg-background px-2 text-xs">
      <option value="__custom">הערך הנוכחי / מותאם אישית</option>
      {choices.map(([key, name]) => <option key={key} value={key} style={property === "font-family" ? { fontFamily: key } : undefined}>{name}</option>)}
    </select>
    <details><summary className="cursor-pointer text-[11px] text-muted-foreground">ערך ידני</summary>{raw}</details>
  </div>;
  if (!numeric) return raw;
  return <div className="min-w-0 space-y-1">
    <div className="flex min-w-0 items-center gap-1" dir="ltr">
      <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label={`הקטן ${label}`} disabled={!parsed} onClick={() => nudge(-1)}><Minus className="h-3.5 w-3.5" /></Button>
      {raw}
      <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label={`הגדל ${label}`} disabled={!parsed} onClick={() => nudge(1)}><Plus className="h-3.5 w-3.5" /></Button>
    </div>
    {!parsed && <select aria-label={`ערך התחלתי ${label}`} value="" onChange={(event) => { if (event.target.value) onChange(event.target.value); }} className="h-8 w-full rounded border border-gold/30 bg-background px-2 text-xs">
      <option value="">בחירת ערך מספרי…</option>
      {(property === "opacity" ? ["0", "0.5", "1"] : property === "line-height" ? ["1", "1.5", "2"] : ["0px", "8px", "16px", "24px", "100%"]).map(v => <option key={v} value={v}>{v}</option>)}
    </select>}
    {LENGTHS.has(property) && <select aria-label={`יחידות ${label}`} value={parsed?.unit ?? "__custom"} disabled={!parsed} onChange={(event) => { if (parsed) onChange(`${parsed.number}${event.target.value}`); }} className="h-8 w-full rounded border border-gold/30 bg-background px-2 text-xs" dir="ltr">
      {!parsed && <option value="__custom">ערך מורכב — ניתן לערוך ידנית</option>}
      <option value="">ללא יחידה</option>{["px", "rem", "em", "%", "vw", "vh"].map(u => <option key={u} value={u}>{u}</option>)}
    </select>}
  </div>;
}
