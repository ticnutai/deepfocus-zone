import { useMemo, useState, type DragEvent } from "react";
import { BookOpen, Check, ChevronDown, ChevronLeft, GripVertical, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStudy } from "@/lib/study/store";
import { SHAS_BAVLI, SEDARIM } from "@/lib/study/shasData";
import { dafLabel } from "@/lib/study/shasGen";
import { cardsForShasDeckSources, shasDeckSourceLabel, type ShasDeckSource } from "@/lib/study/shasDeckBuilder";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const DRAG_TYPE = "application/x-shas-deck-source";

const sourceId = (source: Omit<ShasDeckSource, "id">) =>
  [source.kind, source.masechta, source.daf ?? "", source.amud ?? ""].join(":");

function makeSource(source: Omit<ShasDeckSource, "id">): ShasDeckSource {
  return { ...source, id: sourceId(source) };
}

export function ShasDeckBuilder({ mode = "compact" }: { mode?: "compact" | "spacious" | "overview" }) {
  const spacious = mode === "spacious";
  const overview = mode === "overview";
  const { state, addDeck, addCardsToDeck } = useStudy();
  const [seder, setSeder] = useState("מועד");
  const [masechta, setMasechta] = useState("שבת");
  const [daf, setDaf] = useState(2);
  const [name, setName] = useState("");
  const [sources, setSources] = useState<ShasDeckSource[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const masechtot = useMemo(() => SHAS_BAVLI.filter((item) => item.seder === seder), [seder]);
  const displayedMasechtot = overview ? SHAS_BAVLI : masechtot;
  const selectedMasechta = SHAS_BAVLI.find((item) => item.name === masechta) ?? masechtot[0];
  const dafim = useMemo(() => {
    if (!selectedMasechta) return [];
    return Array.from({ length: selectedMasechta.pages }, (_, index) => index + 2);
  }, [selectedMasechta]);
  const selectedCards = useMemo(
    () => cardsForShasDeckSources(state.cards, state.categories ?? [], sources),
    [state.cards, state.categories, sources],
  );

  const addSource = (source: ShasDeckSource) => {
    setSources((current) => current.some((item) => item.id === source.id) ? current : [...current, source]);
  };
  const startDrag = (event: DragEvent, source: ShasDeckSource) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(source));
    event.dataTransfer.setData("text/plain", shasDeckSourceLabel(source));
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    try {
      const source = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as ShasDeckSource;
      if (source?.id && source?.masechta) addSource(source);
    } catch { /* unrelated drag */ }
  };
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return toast({ title: "יש לתת שם למבחן", variant: "destructive" });
    if (!sources.length) return toast({ title: "יש לגרור לפחות מסכת, דף או עמוד", variant: "destructive" });
    if (!selectedCards.length) return toast({ title: "לא נמצאו שאלות במקורות שנבחרו", variant: "destructive" });
    const deck = addDeck(trimmed, `נבנה מעץ ש״ס: ${sources.map(shasDeckSourceLabel).join(", ")}`);
    addCardsToDeck(selectedCards.map((card) => card.id), deck.id);
    toast({ title: "המבחן נוצר", description: `${selectedCards.length} שאלות נוספו ל״${trimmed}״` });
    setName("");
    setSources([]);
  };

  const draggableClass = cn(
    "flex cursor-grab items-center justify-between rounded-xl border border-gold/45 bg-card text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:border-gold hover:bg-gold/10 hover:shadow-md active:cursor-grabbing",
    spacious ? "min-h-11 gap-3 px-4 py-3" : overview ? "min-h-8 gap-1 px-2 py-1.5 text-xs" : "min-h-9 gap-2 px-3 py-2",
  );
  const stepTitle = (number: number, title: string) => <h3 className={cn("flex items-center font-bold", overview ? "gap-1.5 text-sm" : "gap-2 text-base")}><span className={cn("flex items-center justify-center rounded-full bg-gradient-navy text-gold", overview ? "h-6 w-6 text-xs" : "h-7 w-7 text-sm")}>{number}</span>{title}</h3>;
  return <section dir="rtl" className={cn(
    spacious ? "space-y-5" : "space-y-4",
    overview && "grid items-stretch gap-4 space-y-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] xl:gap-5",
  )}>
    <Card className="gold-frame overflow-hidden p-0">
      <div className={cn("flex items-center justify-between border-b border-gold/35 bg-gradient-to-l from-gold/15 via-card to-card", spacious ? "gap-4 px-6 py-5 md:px-8" : overview ? "gap-2 px-3 py-2.5" : "gap-3 px-4 py-3")}>
        <div><h2 className={cn("font-bold", spacious ? "text-2xl" : overview ? "text-lg" : "text-xl")}>בחירת תוכן למבחן</h2><p className={cn("text-muted-foreground", spacious ? "mt-1 text-base" : overview ? "text-xs" : "mt-1 text-sm")}>בחר את המיקום בעץ וגרור מסכת, דף או עמוד אל מסגרת המבחן.</p></div>
        <span className={cn("flex shrink-0 items-center justify-center rounded-full border-2 border-gold bg-card", spacious ? "h-12 w-12" : overview ? "h-8 w-8" : "h-10 w-10")}><GripVertical className={cn("text-gold", spacious ? "h-6 w-6" : overview ? "h-4 w-4" : "h-5 w-5")} /></span>
      </div>
      <div className={cn("grid", !overview && "xl:grid-cols-[1.15fr_1.5fr_0.85fr]", overview ? "gap-2.5 p-2.5" : spacious ? "gap-5 p-5 md:p-7" : "gap-3 p-4")}>
        <div className={cn("rounded-2xl border border-gold/35 bg-secondary/15", spacious ? "space-y-3 p-4" : overview ? "space-y-1.5 p-2" : "space-y-2 p-3")}>
          {stepTitle(1, "בחר סדר ומסכת")}
          <div className={cn("grid grid-cols-2 sm:grid-cols-3", overview ? "gap-1" : "gap-2")}>{SEDARIM.map((item) => <button key={item} onClick={() => { setSeder(item); const first = SHAS_BAVLI.find((m) => m.seder === item); if (first) { setMasechta(first.name); setDaf(2); } }} className={cn("rounded-xl border font-semibold transition", overview ? "min-h-8 px-2 py-1 text-xs" : "min-h-10 px-3 py-2 text-sm", seder === item ? "border-gold bg-gradient-navy text-white shadow-sm" : "border-gold/40 bg-card hover:bg-gold/10")}>{item}</button>)}</div>
          <div className={cn("grid rounded-xl border border-gold/30 bg-background/60", overview ? "max-h-40 grid-cols-2 gap-1 overflow-y-auto p-1.5 xl:grid-cols-3" : "grid-cols-2 overflow-y-auto p-2", spacious ? "max-h-80 gap-2" : !overview && "max-h-52 gap-1")}>{displayedMasechtot.map((item) => {
            const source = makeSource({ kind: "masechta", masechta: item.name });
            return <div key={item.name} draggable onDragStart={(e) => startDrag(e, source)} onClick={() => { setSeder(item.seder); setMasechta(item.name); setDaf(2); }} className={cn(draggableClass, masechta === item.name && "border-gold bg-gold/15")}><span>{item.name}</span><span className="flex items-center gap-1 text-xs text-muted-foreground">גרור <ChevronLeft className="h-4 w-4" /></span></div>;
          })}</div>
        </div>
        <div className={cn("rounded-2xl border border-gold/35 bg-secondary/15", spacious ? "space-y-3 p-4" : overview ? "space-y-1.5 p-2" : "space-y-2 p-3")}>
          {stepTitle(2, `בחר דפים — ${selectedMasechta?.name ?? ""}`)}
          <div className={cn("grid rounded-xl border border-gold/30 bg-background/60", overview ? "max-h-48 grid-cols-3 gap-1 overflow-y-auto p-1.5 xl:grid-cols-5" : "grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4", spacious ? "max-h-96 p-3" : !overview && "max-h-72 p-2")}>{dafim.map((item) => {
            const source = makeSource({ kind: "daf", masechta: selectedMasechta!.name, daf: item });
            return <button key={item} draggable onDragStart={(e) => startDrag(e, source)} onClick={() => setDaf(item)} className={cn(draggableClass, "justify-center", daf === item && "border-gold bg-gradient-navy text-white")}>דף {dafLabel(item)}</button>;
          })}</div>
        </div>
        <div className={cn("rounded-2xl border border-gold/35 bg-secondary/15", spacious ? "space-y-3 p-4" : overview ? "space-y-1.5 p-2" : "space-y-2 p-3")}>
          {stepTitle(3, `בחר עמוד — דף ${dafLabel(daf)}`)}
          <div className="grid grid-cols-2 gap-3">
            {[1, 2].map((side) => {
              const source = makeSource({ kind: "amud", masechta: selectedMasechta?.name ?? masechta, daf, amud: side as 1 | 2 });
              return <div key={side} draggable onDragStart={(e) => startDrag(e, source)} className={cn(draggableClass, "flex-col justify-center text-center", overview ? "min-h-14" : "min-h-20")}><span className={cn(overview ? "text-sm" : "text-base")}>עמוד {side === 1 ? "א׳" : "ב׳"}</span><span className="flex items-center gap-1 text-xs font-normal text-muted-foreground"><GripVertical className="h-4 w-4 text-gold" />גרור למבחן</span></div>;
            })}
          </div>
          <p className={cn("rounded-xl border border-gold/25 bg-card text-muted-foreground", overview ? "p-2 text-xs leading-5" : "p-4 text-sm leading-6")}>אפשר לגרור כמה פריטים, גם ממסכתות ומדפים שונים. שאלות כפולות ייכנסו פעם אחת בלבד.</p>
        </div>
      </div>
    </Card>

    <Card onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={drop} className={cn("gold-frame border-2 p-5 transition", overview ? "top-3 z-20 h-full min-h-[27rem] md:sticky md:p-3" : "md:p-6", dragOver && "scale-[1.01] border-primary bg-primary/5 shadow-lg")}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-navy text-gold"><BookOpen /></span>
        <div className={cn("flex-1", overview ? "min-w-40" : "min-w-52")}><label className="mb-1 block text-sm font-bold">שם המבחן</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: מבחן חזרה מסכת שבת" className="h-11" /></div>
        <Button onClick={save} size="lg" className={cn("h-12 bg-gradient-navy text-base text-white", overview ? "w-full px-4" : "px-7")}><Save className="ml-2 h-5 w-5" />הוסף מבחן</Button>
      </div>
      <div className={cn("rounded-2xl border-2 border-dashed", overview ? "min-h-32 p-3" : "min-h-36 p-5", sources.length ? "border-gold/60" : "flex items-center justify-center border-gold/40 text-muted-foreground")}>
        {!sources.length ? <div className="text-center"><Plus className="mx-auto mb-2 h-7 w-7 text-gold" /><strong>גרור לכאן מסכת, דף או עמוד</strong></div> : <div className="flex flex-wrap gap-2">{sources.map((source) => <span key={source.id} className="inline-flex items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-3 py-2 text-sm font-semibold"><Check className="h-4 w-4 text-primary" />{shasDeckSourceLabel(source)}<button aria-label={`הסר ${shasDeckSourceLabel(source)}`} onClick={() => setSources((items) => items.filter((item) => item.id !== source.id))}><X className="h-4 w-4 text-destructive" /></button></span>)}</div>}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm"><span><strong>{selectedCards.length}</strong> שאלות ייכללו במבחן</span>{sources.length > 0 && <Button variant="ghost" size="sm" onClick={() => setSources([])} className="text-destructive"><Trash2 className="ml-1 h-4 w-4" />נקה הכול</Button>}</div>
      {selectedCards.length > 0 && <details className="mt-3 rounded-xl border border-gold/30 p-3"><summary className="flex cursor-pointer items-center gap-2 font-semibold"><ChevronDown className="h-4 w-4" />הצגת השאלות שנבחרו</summary><ol className="mt-3 max-h-52 list-decimal space-y-2 overflow-y-auto pr-6 text-sm">{selectedCards.map((card) => <li key={card.id}>{card.question}</li>)}</ol></details>}
    </Card>
  </section>;
}
