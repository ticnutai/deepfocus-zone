import { useStudy } from "@/lib/study/store";
import { HomeTitle, DEFAULT_HOME_TITLE } from "@/components/layout/HomeTitle";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function HomeTitleSettings() {
  const { state, setUiPref } = useStudy();
  const prefs = { ...DEFAULT_HOME_TITLE, ...state.uiPrefs?.homeTitle };
  const update = (patch: Partial<typeof prefs>) => setUiPref("homeTitle", { ...prefs, ...patch });
  return <Card className="gold-frame p-4 space-y-4 mb-4" dir="rtl">
    <h3 className="font-display text-lg font-bold">כותרת הבית במובייל</h3>
    <p className="text-sm text-muted-foreground">רק ליד התפריט בעמוד הבית. הבחירה נשמרת אוטומטית. במסך צר הכותרת מוקטנת במידת הצורך כדי להישאר בשורה אחת.</p>
    <div className="flex items-center gap-2 rounded-xl border border-gold/40 p-2"><HomeTitle preferences={prefs} /><span className="shrink-0 rounded-full border border-gold p-2" aria-hidden>☰</span></div>
    <div className="grid grid-cols-2 gap-2">{Object.entries({gold:"זהב קלאסי", "two-tone":"כחול וזהב", badge:"תג מעוצב", classic:"סגנון תורני"}).map(([value,label]) => <Button key={value} variant={prefs.style === value ? "default" : "outline"} aria-pressed={prefs.style === value} onClick={() => update({style:value as typeof prefs.style})}>{label}</Button>)}</div>
    <label className="block space-y-2"><span>סוג גופן</span><select aria-label="סוג גופן לכותרת" className="w-full rounded-xl border border-gold/40 bg-background p-3" value={prefs.font} onChange={e=>update({font:e.target.value as typeof prefs.font})}><option value="heebo">Heebo — מודרני</option><option value="assistant">Assistant — נקי</option><option value="serif">סריף — מסורתי</option></select></label>
    <label className="block space-y-2"><span>גודל גופן: {prefs.size}</span><input aria-label="גודל גופן לכותרת" className="w-full accent-gold" type="range" min="16" max="32" step="1" value={prefs.size} onChange={e=>update({size:Number(e.target.value)})}/></label>
    <Button variant="outline" onClick={()=>setUiPref("homeTitle", {...DEFAULT_HOME_TITLE})}>חזרה לברירת המחדל</Button>
  </Card>;
}
