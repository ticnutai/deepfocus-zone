import { useEffect, useMemo, useState, memo } from "react";
import { ChevronRight, ChevronLeft, LayoutGrid, Columns2, Rows2, BookOpen, ListChecks, GraduationCap, PanelRightOpen, Maximize2, X, ZoomIn, BookText, Scroll, Layers } from "lucide-react";
import { MishnaLearningTab } from "./MishnaLearningTab";
import { ChumashLearningTab } from "./ChumashLearningTab";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useStudy } from "@/lib/study/store";
import { SHAS_BAVLI, SEDARIM } from "@/lib/study/shasData";
import { dafLabel, toGematria } from "@/lib/study/shasGen";
import { filterCardsByDafAmud, countCardsPerDaf } from "@/lib/study/dafCards";
import { GemaraViewer } from "./GemaraViewer";
import { StudySession } from "./StudySession";
import { FitToContainer } from "./FitToContainer";
import { cn } from "@/lib/utils";

type Layout = "split-v" | "split-h" | "gemara" | "cards";
type PracticeMode = "inline" | "fullscreen";

const STORAGE_KEY = "daf-learning-state";

interface SavedState {
  seder?: string;
  masechta?: string;
  daf?: number;
  amud?: 1 | 2;
  layout?: Layout;
  practiceMode?: PracticeMode;
  practiceScale?: number;
}

function loadSaved(): SavedState {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveState(s: SavedState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function DafLearningTabInner({ isVisible }: { isVisible: boolean }) {
  const { state } = useStudy();
  const saved = useMemo(() => loadSaved(), []);

  const [seder, setSeder] = useState<string>(saved.seder ?? "מועד");
  const [masechta, setMasechta] = useState<string>(saved.masechta ?? "שבת");
  const [daf, setDaf] = useState<number>(saved.daf ?? 2);
  const [amud, setAmud] = useState<1 | 2>(saved.amud ?? 1);
  const [layout, setLayout] = useState<Layout>(saved.layout ?? (window.innerWidth >= 1024 ? "split-v" : "cards"));
  const [studyOpen, setStudyOpen] = useState(false);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>(saved.practiceMode ?? "inline");
  const [practiceScale, setPracticeScale] = useState<number>(saved.practiceScale ?? 1);
  const [countsReady, setCountsReady] = useState(false);

  // שמור בחירה
  useEffect(() => { saveState({ seder, masechta, daf, amud, layout, practiceMode, practiceScale }); }, [seder, masechta, daf, amud, layout, practiceMode, practiceScale]);

  // איפוס מסכת אם הסדר השתנה ולא תואם
  const masechtos = useMemo(() => SHAS_BAVLI.filter((m) => m.seder === seder), [seder]);
  useEffect(() => {
    if (!masechtos.find((m) => m.name === masechta)) {
      setMasechta(masechtos[0]?.name ?? "");
      setDaf(2);
      setAmud(1);
    }
  }, [seder, masechtos, masechta]);

  const currentMasechet = SHAS_BAVLI.find((m) => m.name === masechta);
  const totalPages = currentMasechet?.pages ?? 0;

  // כדי שהטאב יופיע מיידית: דוחים את חישובי הספירות לרגע שאחרי הציור הראשון.
  useEffect(() => {
    setCountsReady(false);
    const timer = window.setTimeout(() => setCountsReady(true), 0);
    return () => window.clearTimeout(timer);
  }, [state.cards, state.categories, masechta, totalPages]);

  // ספירת כרטיסים פר-דף (לבחירה מהירה)
  const dafCounts = useMemo(
    () => (countsReady ? countCardsPerDaf(state.cards, state.categories, masechta, totalPages) : new Map()),
    [state.cards, state.categories, masechta, totalPages, countsReady],
  );

  // כרטיסים לעמוד הנוכחי
  const cards = useMemo(
    () => filterCardsByDafAmud(state.cards, state.categories, masechta, daf, amud),
    [state.cards, state.categories, masechta, daf, amud],
  );
  const cardIds = useMemo(() => cards.map((c) => c.id), [cards]);

  // ניווט דף קודם/הבא
  const goPrev = () => {
    if (amud === 2) { setAmud(1); return; }
    if (daf > 2) { setDaf(daf - 1); setAmud(2); }
  };
  const goNext = () => {
    if (amud === 1) { setAmud(2); return; }
    if (daf < totalPages + 1) { setDaf(daf + 1); setAmud(1); }
  };
  const isFirst = daf === 2 && amud === 1;
  const isLast = daf === totalPages + 1 && amud === 2;

  // לימוד פעיל במצב מסך מלא בלבד — מציג רק את ה-StudySession
  if (studyOpen && practiceMode === "fullscreen" && cardIds.length > 0) {
    return (
      <StudySession
        deckId={null}
        mode="practice"
        cardIds={cardIds}
        onExit={() => setStudyOpen(false)}
      />
    );
  }

  // ====== Render ======
  const navigator = (
    <Card className="gold-frame p-3 space-y-3" dir="rtl">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {/* סדר */}
        <Select value={seder} onValueChange={setSeder}>
          <SelectTrigger><SelectValue placeholder="סדר" /></SelectTrigger>
          <SelectContent>
            {SEDARIM.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* מסכת */}
        <Select value={masechta} onValueChange={(v) => { setMasechta(v); setDaf(2); setAmud(1); }}>
          <SelectTrigger><SelectValue placeholder="מסכת" /></SelectTrigger>
          <SelectContent>
            {masechtos.map((m) => <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* דף */}
        <Select value={String(daf)} onValueChange={(v) => setDaf(Number(v))}>
          <SelectTrigger><SelectValue placeholder="דף" /></SelectTrigger>
          <SelectContent className="max-h-72">
            {Array.from({ length: totalPages }, (_, i) => i + 2).map((d) => {
              const cnt = dafCounts.get(d);
              return (
                <SelectItem key={d} value={String(d)}>
                  דף {dafLabel(d).replace(".", "")}
                  {cnt && <span className="text-gold mr-2 text-xs">({cnt.total})</span>}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* עמוד */}
        <ToggleGroup type="single" value={String(amud)} onValueChange={(v) => v && setAmud(Number(v) as 1 | 2)} className="w-full">
          <ToggleGroupItem value="1" className="flex-1">ע&quot;א {dafCounts.get(daf)?.a ? <span className="text-gold mr-1 text-xs">({dafCounts.get(daf)?.a})</span> : null}</ToggleGroupItem>
          <ToggleGroupItem value="2" className="flex-1">ע&quot;ב {dafCounts.get(daf)?.b ? <span className="text-gold mr-1 text-xs">({dafCounts.get(daf)?.b})</span> : null}</ToggleGroupItem>
        </ToggleGroup>

        {/* פריסה */}
        <ToggleGroup type="single" value={layout} onValueChange={(v) => v && setLayout(v as Layout)} className="w-full">
          <ToggleGroupItem value="split-v" title="פיצול אנכי"><Columns2 className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="split-h" title="פיצול אופקי"><Rows2 className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="gemara" title="גמרא בלבד"><BookOpen className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="cards" title="שאלות בלבד"><ListChecks className="h-4 w-4" /></ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button onClick={goPrev} disabled={isFirst} variant="outline" size="sm" className="gap-1">
          <ChevronRight className="h-4 w-4" /> הקודם
        </Button>
        <div className="text-sm text-muted-foreground">
          {masechta} · דף {toGematria(daf)} · {amud === 1 ? 'ע"א' : 'ע"ב'} · <span className="text-gold font-semibold">{cards.length} שאלות</span>
        </div>
        <Button onClick={goNext} disabled={isLast} variant="outline" size="sm" className="gap-1">
          הבא <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );

  const gemara = <GemaraViewer masechta={masechta} daf={daf} amud={amud} className="h-full" isActive={isVisible} />;

  const startPractice = () => setStudyOpen(true);
  const practiceModeMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="outline" className="h-8 w-8 border-gold/50" title="הגדרות תרגול">
          {practiceMode === "inline" ? <PanelRightOpen className="h-4 w-4 text-gold" /> : <Maximize2 className="h-4 w-4 text-gold" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>פתיחת תרגול</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setPracticeMode("inline")} className={cn(practiceMode === "inline" && "bg-gold/10")}>
          <PanelRightOpen className="h-4 w-4 ml-2" /> ליד הגמרא (פאנל)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPracticeMode("fullscreen")} className={cn(practiceMode === "fullscreen" && "bg-gold/10")}>
          <Maximize2 className="h-4 w-4 ml-2" /> מסך מלא
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const practicePanel = (
    <Card className="gold-frame p-3 flex flex-col h-full" dir="rtl">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <GraduationCap className="h-4 w-4 text-gold" /> תרגול · {cards.length} שאלות
        </h3>
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7 border-gold/50"
                title="קנה מידה של התרגול"
              >
                <ZoomIn className="h-4 w-4 text-gold" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3" align="end" dir="rtl">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">קנה מידה</span>
                  <span className="font-bold text-gold">{Math.round(practiceScale * 100)}%</span>
                </div>
                <Slider
                  min={40}
                  max={100}
                  step={5}
                  value={[Math.round(practiceScale * 100)]}
                  onValueChange={(v) => setPracticeScale((v[0] ?? 100) / 100)}
                />
                <div className="flex items-center justify-between gap-1 pt-1">
                  <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => setPracticeScale(1)}>100%</Button>
                  <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => setPracticeScale(0.75)}>75%</Button>
                  <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => setPracticeScale(0.5)}>50%</Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="ghost" onClick={() => setStudyOpen(false)} className="h-7 gap-1">
            <X className="h-4 w-4" /> סגור תרגול
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <FitToContainer enabled={practiceScale !== 1} manualScale={practiceScale}>
          <StudySession
            key={cardIds.join(",")}
            deckId={null}
            mode="practice"
            cardIds={cardIds}
            onExit={() => setStudyOpen(false)}
          />
        </FitToContainer>
      </div>
    </Card>
  );

  const cardsPanel = (
    <Card className="gold-frame p-4 flex flex-col h-full" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <ListChecks className="h-4 w-4 text-gold" /> שאלות לעמוד זה ({cards.length})
        </h3>
        {cards.length > 0 && (
          <div className="flex items-center gap-1">
            {practiceModeMenu}
            <Button onClick={startPractice} size="sm" className="bg-gradient-navy text-primary-foreground">
              <GraduationCap className="h-4 w-4" /> תרגול
            </Button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {cards.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12">
            אין שאלות משויכות לעמוד זה.<br />
            <span className="text-xs">תוכל להוסיף שאלות בלשונית &quot;שאלות חזרה&quot; ולשייך אותן לקטגוריית &quot;{masechta} › דף {toGematria(daf)} › {amud === 1 ? 'ע"א' : 'ע"ב'}&quot;.</span>
          </div>
        ) : (
          cards.map((c, i) => (
            <div key={c.id} className="rounded-lg border border-gold/30 bg-card p-3 hover:border-gold/60 transition-colors">
              <div className="flex items-start gap-2">
                <span className="text-xs text-gold font-bold shrink-0 mt-0.5">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{c.question}</div>
                  <div className="text-xs text-muted-foreground mt-1 capitalize">
                    {c.type === "flashcard" && "פתוחה"}
                    {c.type === "multiple" && "אמריקאית"}
                    {c.type === "boolean" && "נכון/לא נכון"}
                    {c.type === "combo" && "משולבת"}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );

  return (
    <div className="space-y-4" dir="rtl">
      {navigator}
      <div
        className={cn(
          "gap-4",
          layout === "split-v" && "grid grid-cols-1 lg:grid-cols-2",
          layout === "split-h" && "grid grid-cols-1 grid-rows-2",
          layout === "gemara" && "grid grid-cols-1",
          layout === "cards" && "grid grid-cols-1",
        )}
        style={{ height: "calc(100vh - 280px)", minHeight: 500 }}
      >
        {(layout === "split-v" || layout === "split-h" || layout === "gemara") && (
          <div className="min-h-0">{gemara}</div>
        )}
        {(layout === "split-v" || layout === "split-h" || layout === "cards") && (
          <div className="min-h-0">{studyOpen && practiceMode === "inline" ? practicePanel : cardsPanel}</div>
        )}
      </div>
    </div>
  );
}

type LearnMode = "shas" | "mishna" | "chumash";
const MODE_STORAGE_KEY = "daf-learning-mode";

function DafLearningTab({ isVisible = true }: { isVisible?: boolean }) {
  const [mode, setMode] = useState<LearnMode>(() => {
    try {
      const stored = localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === "daf") return "shas";
      if (stored === "shas" || stored === "mishna" || stored === "chumash") return stored;
      return "shas";
    }
    catch { return "shas"; }
  });
  useEffect(() => {
    try { localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const tabs: { id: LearnMode; label: string; icon: typeof BookText }[] = [
    { id: "shas",    label: "ש\"ס", icon: Layers },
    { id: "mishna",  label: "משנה",      icon: BookText },
    { id: "chumash", label: "חומש",      icon: Scroll },
  ];

  return (
    <div className="space-y-3" dir="rtl">
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(v) => v && setMode(v as LearnMode)}
        className="w-full flex justify-center gap-1 rounded-xl border-2 border-gold/40 bg-card p-1"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <ToggleGroupItem
              key={t.id}
              value={t.id}
              className="flex-1 max-w-[200px] gap-2 data-[state=on]:bg-gradient-navy data-[state=on]:text-primary-foreground"
            >
              <Icon className="h-4 w-4" /> {t.label}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {mode === "shas"    && <DafLearningTabInner isVisible={isVisible} />}
      {mode === "mishna"  && <MishnaLearningTab />}
      {mode === "chumash" && <ChumashLearningTab />}
    </div>
  );
}

const DafLearningTabMemo = memo(DafLearningTab);
export { DafLearningTabMemo as DafLearningTab };
