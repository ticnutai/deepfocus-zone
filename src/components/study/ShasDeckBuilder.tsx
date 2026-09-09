import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { BookOpen, BookText, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, GripVertical, Layers3, LayoutPanelTop, List, ListTree, Plus, Save, Scroll, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useStudy } from "@/lib/study/store";
import { usePermissions } from "@/hooks/usePermissions";
import { SHAS_BAVLI, SEDARIM } from "@/lib/study/shasData";
import { dafLabel } from "@/lib/study/shasGen";
import { cardsForShasDeckSources, shasDeckSourceLabel, type ShasDeckSource } from "@/lib/study/shasDeckBuilder";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { CardEditor } from "./CardEditor";

const DRAG_TYPE = "application/x-shas-deck-source";
type QuestionView = "all" | "masechta" | "daf" | "amud";
type ContentArea = "shas" | "mishna" | "chumash" | "neviim";
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

const CONTENT_TABS = [
  { id: "shas", label: "ש״ס", icon: Layers3 },
  { id: "mishna", label: "משנה", icon: BookText },
  { id: "chumash", label: "חומש", icon: Scroll },
  { id: "neviim", label: "נביאים וכתובים", icon: BookOpen },
] as const;

const sourceId = (source: WithoutId<ShasDeckSource>) => source.kind === "category"
  ? `category:${source.categoryId}`
  : [source.kind, source.masechta, source.daf ?? "", source.amud ?? ""].join(":");

function makeSource(source: WithoutId<ShasDeckSource>): ShasDeckSource {
  return { ...source, id: sourceId(source) };
}

export function ShasDeckBuilder({
  mode = "compact",
  editingDeckId = null,
  onEditingComplete,
  layout = "shas-overview",
  onLayoutChange,
  purpose = "exam",
  questionCreationLayout,
  onQuestionCreationLayoutChange,
}: {
  mode?: "compact" | "spacious" | "overview" | "top-bottom";
  editingDeckId?: string | null;
  onEditingComplete?: () => void;
  layout?: "classic" | "shas-tree" | "shas-spacious" | "shas-overview" | "shas-top-bottom";
  onLayoutChange?: (layout: "classic" | "shas-tree" | "shas-spacious" | "shas-overview" | "shas-top-bottom") => void;
  purpose?: "exam" | "question";
  questionCreationLayout?: "classic" | "content-tree";
  onQuestionCreationLayoutChange?: (layout: "classic" | "content-tree") => void;
}) {
  const spacious = mode === "spacious";
  const overview = mode === "overview";
  const topBottom = mode === "top-bottom";
  const { state, addDeck, addCardsToDeck, removeCardFromDeck, updateCard, renameDeck, setDeckCategories, updateDeckCategoryIds, setUiPref } = useStudy();
  const { can } = usePermissions();
  const [seder, setSeder] = useState("מועד");
  const [masechta, setMasechta] = useState("שבת");
  const [daf, setDaf] = useState(2);
  const [name, setName] = useState("");
  const [sources, setSources] = useState<ShasDeckSource[]>([]);
  const [existingCardIds, setExistingCardIds] = useState<string[]>([]);
  const [initialExistingCardIds, setInitialExistingCardIds] = useState<string[]>([]);
  const [excludedCardIds, setExcludedCardIds] = useState<string[]>([]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedSources, setSelectedSources] = useState<ShasDeckSource[]>([]);
  const [questionView, setQuestionView] = useState<QuestionView>("all");
  const [contentArea, setContentArea] = useState<ContentArea>("shas");
  const [questionSource, setQuestionSource] = useState<ShasDeckSource | null>(null);
  const [questionEditorKey, setQuestionEditorKey] = useState(0);
  const [genericCategoryPath, setGenericCategoryPath] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [navigationStep, setNavigationStep] = useState<1 | 2 | 3 | 4>(1);
  const loadedDeckId = useRef<string | null>(null);
  const navigationMode = state.uiPrefs?.deckBuilderNavigationMode ?? "expanded";

  const masechtot = useMemo(() => SHAS_BAVLI.filter((item) => item.seder === seder), [seder]);
  const displayedMasechtot = overview ? SHAS_BAVLI : masechtot;
  const selectedMasechta = SHAS_BAVLI.find((item) => item.name === masechta) ?? masechtot[0];
  const dafim = useMemo(() => {
    if (!selectedMasechta) return [];
    return Array.from({ length: selectedMasechta.pages }, (_, index) => index + 2);
  }, [selectedMasechta]);
  const selectedCards = useMemo(() => {
    const existingIds = new Set(existingCardIds);
    const excludedIds = new Set(excludedCardIds);
    const byId = new Map(state.cards.filter((card) => existingIds.has(card.id)).map((card) => [card.id, card]));
    cardsForShasDeckSources(state.cards, state.categories ?? [], sources).forEach((card) => byId.set(card.id, card));
    return [...byId.values()].filter((card) => !excludedIds.has(card.id));
  }, [state.cards, state.categories, sources, existingCardIds, excludedCardIds]);

  const allSelectableSources = useMemo(() => contentArea === "shas" ? dafim.map((item) => makeSource({
    kind: "daf" as const,
    masechta: selectedMasechta?.name ?? masechta,
    daf: item,
  })) : [], [contentArea, dafim, selectedMasechta, masechta]);
  const selectedSourceIds = useMemo(() => new Set(selectedSources.map((source) => source.id)), [selectedSources]);
  const rootCategories = useMemo(() => (state.categories ?? []).filter((category) => !category.parentId), [state.categories]);
  const activeRootCategory = useMemo(() => {
    const matchers: Record<ContentArea, (name: string) => boolean> = {
      shas: (name) => name.includes('ש"ס') || name.includes("ש״ס") || name.includes("תלמוד בבלי"),
      mishna: (name) => (name.includes("משנה") || name.includes("משניות")) && !name.includes("תורה"),
      chumash: (name) => name.includes("חומש") || name.includes("חמשת חומשי"),
      neviim: (name) => name.includes("נביאים") || name.includes("כתובים") || name.includes("תנ״ך") || name.includes('תנ"ך'),
    };
    return rootCategories.find((category) => matchers[contentArea](category.name)) ?? null;
  }, [contentArea, rootCategories]);
  const categoryIndex = useMemo(() => {
    const byId = new Map((state.categories ?? []).map((category) => [category.id, category]));
    const children = new Map<string, typeof state.categories>();
    (state.categories ?? []).forEach((category) => {
      if (!category.parentId) return;
      const siblings = children.get(category.parentId) ?? [];
      siblings.push(category);
      children.set(category.parentId, siblings);
    });
    return { byId, children };
  }, [state.categories]);
  useEffect(() => {
    setGenericCategoryPath(activeRootCategory ? [activeRootCategory.id] : []);
  }, [activeRootCategory?.id]);
  const currentGenericCategoryId = genericCategoryPath.at(-1) ?? activeRootCategory?.id ?? null;
  const currentGenericCategory = currentGenericCategoryId ? categoryIndex.byId.get(currentGenericCategoryId) ?? null : null;
  const genericVisibleCategories = currentGenericCategoryId ? categoryIndex.children.get(currentGenericCategoryId) ?? [] : [];
  const genericBreadcrumb = genericCategoryPath.map((id) => categoryIndex.byId.get(id)).filter(Boolean);
  const questionGroups = useMemo(() => {
    if (questionView === "all") return [{ key: "all", label: "כל השאלות", cards: selectedCards }];
    const groups = new Map<string, typeof selectedCards>();
    const labels = new Map<string, string>();
    selectedCards.forEach((card) => {
      const tractate = card.masechta?.trim() || "ללא מסכת";
      const page = card.daf ? `דף ${dafLabel(card.daf)}` : "ללא דף";
      const side = card.amud === 1 ? "עמוד א׳" : card.amud === 2 ? "עמוד ב׳" : "ללא עמוד מסוים";
      const key = questionView === "masechta" ? tractate : questionView === "daf" ? `${tractate}:${page}` : `${tractate}:${page}:${side}`;
      const label = questionView === "masechta" ? tractate : questionView === "daf" ? `${tractate} — ${page}` : `${tractate} — ${page} — ${side}`;
      groups.set(key, [...(groups.get(key) ?? []), card]);
      labels.set(key, label);
    });
    return [...groups.entries()].map(([key, cards]) => ({ key, label: labels.get(key) ?? key, cards }));
  }, [selectedCards, questionView]);

  useEffect(() => {
    if (!editingDeckId) {
      loadedDeckId.current = null;
      return;
    }
    if (loadedDeckId.current === editingDeckId) return;
    const deck = state.decks.find((item) => item.id === editingDeckId);
    if (!deck) return;
    const linkedIds = new Set((state.cardDecks ?? []).filter((link) => link.deckId === deck.id).map((link) => link.cardId));
    const categoryIds = new Set(deck.categoryIds ?? []);
    if (deck.includeSubCategories !== false && categoryIds.size) {
      let changed = true;
      while (changed) {
        changed = false;
        (state.categories ?? []).forEach((category) => {
          if (category.parentId && categoryIds.has(category.parentId) && !categoryIds.has(category.id)) {
            categoryIds.add(category.id);
            changed = true;
          }
        });
      }
    }
    const categoryNames = new Set((state.categories ?? []).filter((category) => categoryIds.has(category.id)).map((category) => category.name));
    const ids = state.cards.filter((card) => card.deckId === deck.id || linkedIds.has(card.id) || card.tags?.some((tag) => tag.startsWith("cat:") && categoryNames.has(tag.slice(4)))).map((card) => card.id);
    setName(deck.name);
    setExistingCardIds(ids);
    setInitialExistingCardIds(ids);
    setExcludedCardIds([]);
    setSources([]);
    setSelectedSources([]);
    loadedDeckId.current = editingDeckId;
  }, [editingDeckId, state.decks, state.cards, state.cardDecks, state.categories]);

  const addSource = (source: ShasDeckSource) => {
    setSources((current) => current.some((item) => item.id === source.id) ? current : [...current, source]);
  };
  const startDrag = (event: DragEvent, source: ShasDeckSource) => {
    event.dataTransfer.effectAllowed = "copy";
    const payload = multiSelect
      ? (selectedSourceIds.has(source.id) ? selectedSources : [...selectedSources, source])
      : [source];
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", payload.length === 1 ? shasDeckSourceLabel(source) : `${payload.length} פריטים`);
  };
  const chooseSource = (source: ShasDeckSource) => {
    if (purpose === "question") {
      setQuestionSource(source);
      return;
    }
    if (!multiSelect) return;
    setSelectedSources((current) => current.some((item) => item.id === source.id)
      ? current.filter((item) => item.id !== source.id)
      : [...current, source]);
  };
  const toggleMultiSelect = () => {
    if (!multiSelect) {
      setMultiSelect(true);
      setSelectedSources([]);
      return;
    }
    if (contentArea !== "shas" && selectedSources.length === 0) {
      setMultiSelect(false);
      return;
    }
    setSelectedSources(selectedSources.length > 0 ? [] : allSelectableSources);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    try {
      const parsed = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as ShasDeckSource | ShasDeckSource[];
      const dropped = Array.isArray(parsed) ? parsed : [parsed];
      dropped.filter((source) => source?.id && (source.kind === "category" ? source.categoryId : source.masechta)).forEach(addSource);
    } catch { /* unrelated drag */ }
  };
  const save = () => {
    if (!can('decks', editingDeckId ? 'edit' : 'create')) {
      return toast({ title: 'אין הרשאה לשמירת מבחנים בתפקיד הנוכחי', variant: 'destructive' });
    }
    const trimmed = name.trim();
    if (!trimmed) return toast({ title: "יש לתת שם למבחן", variant: "destructive" });
    if (!editingDeckId && !sources.length) return toast({ title: "יש לגרור לפחות מסכת, דף או עמוד", variant: "destructive" });
    if (!editingDeckId && !selectedCards.length) return toast({ title: "לא נמצאו שאלות במקורות שנבחרו", variant: "destructive" });
    if (editingDeckId) {
      const keptIds = new Set(selectedCards.map((card) => card.id));
      const removedIds = initialExistingCardIds.filter((id) => !keptIds.has(id));
      if (removedIds.length) {
        // Convert category-backed/legacy deck membership to an exact explicit list,
        // otherwise a removed question would reappear through its old category/deck field.
        setDeckCategories(editingDeckId, []);
        updateDeckCategoryIds(editingDeckId, [], false);
        removedIds.forEach((cardId) => {
          removeCardFromDeck(cardId, editingDeckId);
          const card = state.cards.find((item) => item.id === cardId);
          if (card?.deckId === editingDeckId) updateCard(cardId, { deckId: null });
        });
      }
      renameDeck(editingDeckId, trimmed);
      addCardsToDeck(selectedCards.map((card) => card.id), editingDeckId);
      toast({ title: "המבחן עודכן", description: `${selectedCards.length} שאלות נמצאות ב״${trimmed}״` });
      setName("");
      setSources([]);
      setExistingCardIds([]);
      setInitialExistingCardIds([]);
      setExcludedCardIds([]);
      setSelectedSources([]);
      loadedDeckId.current = null;
      onEditingComplete?.();
      return;
    }
    const deck = addDeck(trimmed, `נבנה מעץ ש״ס: ${sources.map(shasDeckSourceLabel).join(", ")}`);
    addCardsToDeck(selectedCards.map((card) => card.id), deck.id);
    toast({ title: "המבחן נוצר", description: `${selectedCards.length} שאלות נוספו ל״${trimmed}״` });
    setName("");
    setSources([]);
    setExistingCardIds([]);
    setExcludedCardIds([]);
    setSelectedSources([]);
  };

  const draggableClass = cn(
    "flex cursor-grab items-center justify-between rounded-xl border border-gold/45 bg-card text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:border-gold hover:bg-gold/10 hover:shadow-md active:cursor-grabbing",
    spacious ? "min-h-11 gap-3 px-4 py-3" : overview ? "min-h-8 gap-1 px-2 py-1.5 text-xs" : "min-h-9 gap-2 px-3 py-2",
  );
  const stepTitle = (number: number, title: string) => <h3 className={cn("flex items-center font-bold", overview ? "gap-1.5 text-sm" : "gap-2 text-base")}><span className={cn("flex items-center justify-center rounded-full bg-gradient-navy text-gold", overview ? "h-6 w-6 text-xs" : "h-7 w-7 text-sm")}>{number}</span>{title}</h3>;
  return <section dir="rtl" className={cn(
    spacious ? "space-y-5" : topBottom ? "space-y-3" : "space-y-4",
    overview && "grid items-stretch gap-4 space-y-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] xl:gap-5",
  )}>
    <Card className="gold-frame col-span-full overflow-hidden p-1">
      <nav aria-label="מקור התוכן למבחן" className="grid grid-cols-2 gap-1 md:grid-cols-4">
        {CONTENT_TABS.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" onClick={() => { setContentArea(tab.id); setQuestionSource(null); }} aria-current={contentArea === tab.id ? "page" : undefined} className={cn("flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition", contentArea === tab.id ? "bg-gradient-navy text-white shadow-sm" : "bg-card text-navy hover:bg-gold/10")}><Icon className={cn("h-4 w-4", contentArea === tab.id ? "text-gold" : "text-navy")} />{tab.label}</button>; })}
      </nav>
    </Card>
    <Card className="gold-frame overflow-hidden p-0">
      <div className={cn("flex items-center justify-between border-b border-gold/35 bg-gradient-to-l from-gold/15 via-card to-card", spacious ? "gap-4 px-6 py-5 md:px-8" : overview ? "gap-2 px-3 py-2.5" : "gap-3 px-4 py-3")}>
        <div><h2 className={cn("font-bold", spacious ? "text-2xl" : overview ? "text-lg" : "text-xl")}>{purpose === "question" ? "בחירת סיווג לשאלה" : "בחירת תוכן למבחן"}</h2><p className={cn("text-muted-foreground", spacious ? "mt-1 text-base" : overview ? "text-xs" : "mt-1 text-sm")}>{purpose === "question" ? "בחר קטגוריה או עמוד; הטופס למטה יקבל את הסיווג אוטומטית." : contentArea === "shas" ? "בחר את המיקום בעץ וגרור מסכת, דף או עמוד אל מסגרת המבחן." : "בחר וגרור קטגוריה או תת־קטגוריה אל מסגרת המבחן."}</p></div>
        <div className="flex items-center gap-2">
          {onLayoutChange && <Select value={layout} onValueChange={(value) => onLayoutChange(value as typeof layout)}><SelectTrigger className="h-9 w-44 border-gold/60 bg-card font-semibold"><SelectValue placeholder="בחר תצוגה" /></SelectTrigger><SelectContent><SelectItem value="shas-tree">עץ ש״ס קודם</SelectItem><SelectItem value="shas-spacious">עץ ש״ס מרווח</SelectItem><SelectItem value="shas-overview">סקירה מלאה</SelectItem><SelectItem value="shas-top-bottom">תוכן למעלה, מבחן למטה</SelectItem><SelectItem value="classic">ניהול רגיל</SelectItem></SelectContent></Select>}
          {onQuestionCreationLayoutChange && <DropdownMenu dir="rtl">
            <DropdownMenuTrigger asChild><Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0 border-gold/60" title="בחר פריסת בניית שאלות" aria-label="בחר פריסת בניית שאלות"><LayoutPanelTop className="h-4 w-4 text-gold" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52" dir="rtl">
              <DropdownMenuLabel>פריסת בניית שאלות</DropdownMenuLabel><DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onQuestionCreationLayoutChange("content-tree")} className={cn(questionCreationLayout === "content-tree" && "bg-gold/10")}><Check className={cn("ml-2 h-4 w-4", questionCreationLayout !== "content-tree" && "opacity-0")} />עץ תוכן + שאלה</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onQuestionCreationLayoutChange("classic")} className={cn(questionCreationLayout === "classic" && "bg-gold/10")}><Check className={cn("ml-2 h-4 w-4", questionCreationLayout !== "classic" && "opacity-0")} />טופס רגיל</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          <DropdownMenu dir="rtl">
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0 border-gold/60" title="בחר תצוגת ניווט" aria-label="בחר תצוגת ניווט">
                <ListTree className="h-4 w-4 text-gold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52" dir="rtl">
              <DropdownMenuLabel>תצוגת ניווט</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setUiPref("deckBuilderNavigationMode", "expanded")} className={cn(navigationMode === "expanded" && "bg-gold/10")}>
                <Check className={cn("ml-2 h-4 w-4", navigationMode !== "expanded" && "opacity-0")} />עץ פתוח
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setUiPref("deckBuilderNavigationMode", "drilldown"); setNavigationStep(1); setQuestionSource(null); }} className={cn(navigationMode === "drilldown" && "bg-gold/10")}>
                <Check className={cn("ml-2 h-4 w-4", navigationMode !== "drilldown" && "opacity-0")} />שלב אחר שלב
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {purpose === "exam" && <Button type="button" variant={multiSelect ? "default" : "outline"} size="sm" onClick={toggleMultiSelect} className={cn("border-gold/60", multiSelect && "bg-gradient-navy text-white")} title="לחיצה ראשונה מפעילה בחירה מרובה; בש״ס ניתן לבחור את כל דפי המסכת בלבד"><CheckCheck className="ml-1 h-4 w-4" />{!multiSelect ? "בחירה מרובה" : selectedSources.length > 0 ? "נקה הכול" : contentArea === "shas" ? "בחר את כל הדפים" : "סיום בחירה"}</Button>}
          {purpose === "exam" && multiSelect && selectedSources.length > 0 && <span className="rounded-full bg-gold/15 px-2 py-1 text-xs font-bold">{selectedSources.length} נבחרו</span>}
          <span className={cn("flex shrink-0 items-center justify-center rounded-full border-2 border-gold bg-card", spacious ? "h-12 w-12" : overview ? "h-8 w-8" : "h-10 w-10")}><GripVertical className={cn("text-gold", spacious ? "h-6 w-6" : overview ? "h-4 w-4" : "h-5 w-5")} /></span>
        </div>
      </div>
      {contentArea === "shas" ? <div className={cn("grid", !overview && "xl:grid-cols-[1.15fr_1.5fr_0.85fr]", overview ? "gap-2.5 p-2.5" : spacious ? "gap-5 p-5 md:p-7" : topBottom ? "gap-3 p-3" : "gap-3 p-4")}>
        {(navigationMode === "expanded" || navigationStep <= 2) && <div className={cn("rounded-2xl border border-gold/35 bg-secondary/15", navigationMode === "drilldown" && "col-span-full", spacious ? "space-y-3 p-4" : overview ? "space-y-1.5 p-2" : "space-y-2 p-3")}>
          {stepTitle(1, navigationMode === "drilldown" && navigationStep === 1 ? "בחר סדר" : "בחר סדר ומסכת")}
          {(navigationMode === "expanded" || navigationStep === 1) && <div className={cn("grid grid-cols-2 sm:grid-cols-3", overview ? "gap-1" : "gap-2")}>{SEDARIM.map((item) => <button key={item} onClick={() => { setSeder(item); setQuestionSource(null); const first = SHAS_BAVLI.find((m) => m.seder === item); if (first) { setMasechta(first.name); setDaf(2); } if (navigationMode === "drilldown") setNavigationStep(2); }} className={cn("rounded-xl border font-semibold transition", overview ? "min-h-8 px-2 py-1 text-xs" : "min-h-10 px-3 py-2 text-sm", seder === item ? "border-gold bg-gradient-navy text-white shadow-sm" : "border-gold/40 bg-card hover:bg-gold/10")}>{item}</button>)}</div>}
          {(navigationMode === "expanded" || navigationStep === 2) && <>
          {navigationMode === "drilldown" && <Button type="button" variant="ghost" size="sm" onClick={() => setNavigationStep(1)}><ChevronRight className="ml-1 h-4 w-4" />חזרה לסדרים</Button>}
          {navigationMode === "drilldown" && <h3 className="font-bold">בחר מסכת — סדר {seder}</h3>}
          <div className={cn("grid rounded-xl border border-gold/30 bg-background/60", overview ? "max-h-40 grid-cols-2 gap-1 overflow-y-auto p-1.5 xl:grid-cols-3" : "grid-cols-2 overflow-y-auto p-2", spacious ? "max-h-80 gap-2" : !overview && "max-h-52 gap-1")}>{(navigationMode === "drilldown" ? masechtot : displayedMasechtot).map((item) => {
            const source = makeSource({ kind: "masechta", masechta: item.name });
            return <div key={item.name} draggable={purpose === "exam"} onDragStart={(e) => startDrag(e, source)} onClick={() => { setSeder(item.seder); setMasechta(item.name); setDaf(2); setQuestionSource(null); if (navigationMode === "drilldown") setNavigationStep(3); if (purpose === "exam") chooseSource(source); }} className={cn(draggableClass, masechta === item.name && "border-gold bg-gold/15", selectedSourceIds.has(source.id) && "border-navy bg-gradient-navy text-white ring-2 ring-gold")}><span>{item.name}</span><span className={cn("flex items-center gap-1 text-xs text-muted-foreground", selectedSourceIds.has(source.id) && "text-gold")}>{selectedSourceIds.has(source.id) ? <><Check className="h-4 w-4" />נבחר</> : purpose === "question" ? <>בחר דף <ChevronLeft className="h-4 w-4" /></> : <>גרור <ChevronLeft className="h-4 w-4" /></>}</span></div>;
          })}</div>
          </>}
        </div>}
        {(navigationMode === "expanded" || navigationStep === 3) && <div className={cn("rounded-2xl border border-gold/35 bg-secondary/15", navigationMode === "drilldown" && "col-span-full", spacious ? "space-y-3 p-4" : overview ? "space-y-1.5 p-2" : "space-y-2 p-3")}>
          {navigationMode === "drilldown" && <Button type="button" variant="ghost" size="sm" onClick={() => setNavigationStep(2)} className="mb-1"><ChevronRight className="ml-1 h-4 w-4" />חזרה למסכתות</Button>}
          {stepTitle(2, `בחר דפים — ${selectedMasechta?.name ?? ""}`)}
          <div className={cn("grid rounded-xl border border-gold/30 bg-background/60", overview ? "max-h-48 grid-cols-3 gap-1 overflow-y-auto p-1.5 xl:grid-cols-5" : "grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4", spacious ? "max-h-96 p-3" : !overview && "max-h-72 p-2")}>{dafim.map((item) => {
            const source = makeSource({ kind: "daf", masechta: selectedMasechta!.name, daf: item });
            return <button key={item} draggable={purpose === "exam"} onDragStart={(e) => startDrag(e, source)} onClick={() => { setDaf(item); setQuestionSource(null); if (navigationMode === "drilldown") setNavigationStep(4); if (purpose === "exam") chooseSource(source); }} className={cn(draggableClass, "justify-center", daf === item && "border-gold bg-gradient-navy text-white", selectedSourceIds.has(source.id) && "border-navy bg-gradient-navy text-white ring-2 ring-gold")}>דף {dafLabel(item)}{selectedSourceIds.has(source.id) && <Check className="h-3.5 w-3.5" />}</button>;
          })}</div>
        </div>}
        {(navigationMode === "expanded" || navigationStep === 4) && <div className={cn("rounded-2xl border border-gold/35 bg-secondary/15", navigationMode === "drilldown" && "col-span-full", spacious ? "space-y-3 p-4" : overview ? "space-y-1.5 p-2" : "space-y-2 p-3")}>
          {navigationMode === "drilldown" && <Button type="button" variant="ghost" size="sm" onClick={() => { setNavigationStep(3); setQuestionSource(null); }} className="mb-1"><ChevronRight className="ml-1 h-4 w-4" />חזרה לדפים</Button>}
          {stepTitle(3, `בחר עמוד — דף ${dafLabel(daf)}`)}
          <div className="grid grid-cols-2 gap-3">
            {[1, 2].map((side) => {
              const source = makeSource({ kind: "amud", masechta: selectedMasechta?.name ?? masechta, daf, amud: side as 1 | 2 });
              return <div key={side} draggable={purpose === "exam"} onDragStart={(e) => startDrag(e, source)} onClick={() => chooseSource(source)} className={cn(draggableClass, "flex-col justify-center text-center", overview ? "min-h-14" : "min-h-20", (selectedSourceIds.has(source.id) || questionSource?.id === source.id) && "border-navy bg-gradient-navy text-white ring-2 ring-gold")}><span className={cn(overview ? "text-sm" : "text-base")}>עמוד {side === 1 ? "א׳" : "ב׳"}</span><span className={cn("flex items-center gap-1 text-xs font-normal text-muted-foreground", (selectedSourceIds.has(source.id) || questionSource?.id === source.id) && "text-gold")}>{questionSource?.id === source.id ? <><Check className="h-4 w-4" />נבחר לסיווג</> : selectedSourceIds.has(source.id) ? <><Check className="h-4 w-4" />נבחר</> : purpose === "question" ? <>בחר עמוד</> : <><GripVertical className="h-4 w-4 text-gold" />גרור למבחן</>}</span></div>;
            })}
          </div>
          <p className={cn("rounded-xl border border-gold/25 bg-card text-muted-foreground", overview ? "p-2 text-xs leading-5" : "p-4 text-sm leading-6")}>אפשר לגרור כמה פריטים, גם ממסכתות ומדפים שונים. שאלות כפולות ייכנסו פעם אחת בלבד.</p>
        </div>}
      </div> : <div className={cn("p-3", spacious && "p-6")}>
        <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-lg font-bold">{CONTENT_TABS.find((tab) => tab.id === contentArea)?.label}</h3><p className="text-sm text-muted-foreground">פתח רמה בלחיצה או גרור קטגוריה שלמה למסגרת המבחן.</p></div><span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-bold">{genericVisibleCategories.length} ברמה זו</span></div>
        {activeRootCategory ? <>
          <div className="mb-3 flex flex-wrap items-center gap-1 rounded-xl border border-gold/25 bg-card p-2 text-sm">{genericBreadcrumb.map((category, index) => <span key={category!.id} className="flex items-center gap-1"><button type="button" onClick={() => { setGenericCategoryPath((path) => path.slice(0, index + 1)); setQuestionSource(null); }} className="rounded-lg px-2 py-1 font-semibold hover:bg-gold/10">{category!.name}</button>{index < genericBreadcrumb.length - 1 && <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />}</span>)}</div>
          {currentGenericCategory && (() => { const source = makeSource({ kind: "category", categoryId: currentGenericCategory.id, categoryName: currentGenericCategory.name }); const isLeaf = genericVisibleCategories.length === 0; return <div className="mb-3 flex items-center justify-between rounded-xl border border-gold/45 bg-gold/10 p-3"><strong>כל {currentGenericCategory.name}</strong>{(purpose === "exam" || isLeaf) && <button type="button" draggable={purpose === "exam"} onDragStart={(event) => startDrag(event, source)} onClick={() => chooseSource(source)} className={cn("flex items-center gap-2 rounded-lg border border-gold/50 bg-card px-3 py-2 text-sm font-semibold", (selectedSourceIds.has(source.id) || questionSource?.id === source.id) && "bg-gradient-navy text-white")}><GripVertical className="h-4 w-4 text-gold" />{purpose === "question" ? "בחר קטגוריה סופית" : "גרור קטגוריה זו"}</button>}</div>; })()}
          {genericVisibleCategories.length ? <div className={cn("grid max-h-[28rem] gap-2 overflow-y-auto rounded-2xl border border-gold/30 bg-secondary/10 p-3", overview ? "grid-cols-2 xl:grid-cols-3" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-4")}>
            {genericVisibleCategories.map((category) => { const source = makeSource({ kind: "category", categoryId: category.id, categoryName: category.name }); const hasChildren = (categoryIndex.children.get(category.id)?.length ?? 0) > 0; return <button key={category.id} type="button" draggable={purpose === "exam"} onDragStart={(event) => startDrag(event, source)} onClick={() => { if (purpose === "question" && !hasChildren) chooseSource(source); else if (multiSelect) chooseSource(source); else if (hasChildren) { setGenericCategoryPath((path) => [...path, category.id]); setQuestionSource(null); } }} className={cn(draggableClass, "min-w-0", (selectedSourceIds.has(source.id) || questionSource?.id === source.id) && "border-navy bg-gradient-navy text-white ring-2 ring-gold")}><span className="truncate">{category.name}</span><span className={cn("flex shrink-0 items-center gap-1 text-xs text-muted-foreground", (selectedSourceIds.has(source.id) || questionSource?.id === source.id) && "text-gold")}>{questionSource?.id === source.id ? <><Check className="h-4 w-4" />נבחר</> : selectedSourceIds.has(source.id) ? <><Check className="h-4 w-4" />נבחר</> : hasChildren ? <>פתח <ChevronLeft className="h-4 w-4" /></> : purpose === "question" ? <>בחר</> : <><GripVertical className="h-4 w-4 text-gold" />גרור</>}</span></button>; })}
          </div> : <div className="rounded-2xl border-2 border-dashed border-gold/35 p-8 text-center text-muted-foreground">אין תתי־קטגוריות נוספות. אפשר לגרור את הקטגוריה הנוכחית למבחן.</div>}
        </> : <div className="rounded-2xl border-2 border-dashed border-gold/35 p-10 text-center text-muted-foreground">לא נמצאה קטגוריית {CONTENT_TABS.find((tab) => tab.id === contentArea)?.label} בעץ הקטגוריות. ניתן ליצור אותה במסך קטגוריות.</div>}
      </div>}
    </Card>

    {purpose === "question" ? questionSource ? <Card className={cn("gold-frame border-2 p-4", overview && "h-full md:p-5")}>
      <div className="mb-4 rounded-xl border border-gold/40 bg-gold/10 p-3"><strong>הוספת שאלה</strong><p className="mt-1 text-sm text-muted-foreground">הסיווג שנבחר: {shasDeckSourceLabel(questionSource)}</p></div>
      <CardEditor key={`${questionEditorKey}:${questionSource.id}`} deckId={null} prefillCategories={questionSource.kind === "category" ? [questionSource.categoryName] : questionSource.kind === "masechta" ? [questionSource.masechta] : undefined} prefillDaf={questionSource.kind === "amud" ? { masechta: questionSource.masechta, daf: questionSource.daf ?? 2, amud: questionSource.amud ?? 1 } : undefined} onClose={() => setQuestionEditorKey((key) => key + 1)} />
    </Card> : <Card className="gold-frame col-span-full border-2 border-dashed border-gold/40 p-8 text-center text-muted-foreground"><BookOpen className="mx-auto mb-2 h-7 w-7 text-gold" /><strong>{contentArea === "shas" ? "בחר מסכת, דף ולאחר מכן עמוד א׳ או ב׳" : "פתח את כל שרשרת הקטגוריות ובחר את הקטגוריה האחרונה"}</strong><p className="mt-1 text-sm">טופס הוספת השאלה יופיע רק לאחר השלמת הסיווג.</p></Card> : <Card onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={drop} className={cn("gold-frame border-2 p-5 transition", overview ? "top-3 z-20 h-full min-h-[27rem] md:sticky md:p-3" : topBottom ? "w-full md:p-4" : "md:p-6", dragOver && "scale-[1.01] border-primary bg-primary/5 shadow-lg")}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-navy text-gold"><BookOpen /></span>
        <div className={cn("flex-1", overview ? "min-w-40" : "min-w-52")}><label className="mb-1 block text-sm font-bold">{editingDeckId ? "עריכת מבחן קיים" : "שם המבחן"}</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: מבחן חזרה מסכת שבת" className="h-11" /></div>
        <Button onClick={save} size="lg" className={cn("h-12 bg-gradient-navy text-base text-white", overview ? "w-full px-4" : "px-7")}><Save className="ml-2 h-5 w-5" />{editingDeckId ? "שמור שינויים" : "הוסף מבחן"}</Button>
        {editingDeckId && <Button type="button" variant="outline" className="w-full border-gold/50" onClick={() => { setName(""); setSources([]); setExistingCardIds([]); setInitialExistingCardIds([]); setExcludedCardIds([]); setSelectedSources([]); loadedDeckId.current = null; onEditingComplete?.(); }}>ביטול עריכה</Button>}
      </div>
      <div className={cn("rounded-2xl border-2 border-dashed", overview ? "min-h-32 p-3" : topBottom ? "min-h-24 p-3" : "min-h-36 p-5", sources.length ? "border-gold/60" : "flex items-center justify-center border-gold/40 text-muted-foreground")}>
        {!sources.length && !existingCardIds.length ? <div className="text-center"><Plus className="mx-auto mb-2 h-7 w-7 text-gold" /><strong>גרור לכאן מסכת, דף או עמוד</strong></div> : <div className="space-y-3">{existingCardIds.length > 0 && <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm font-semibold">המבחן הקיים נטען עם {existingCardIds.length} שאלות. אפשר להוסיף אליו בגרירה.</div>}<div className="flex flex-wrap gap-2">{sources.map((source) => <span key={source.id} className="inline-flex items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-3 py-2 text-sm font-semibold"><Check className="h-4 w-4 text-primary" />{shasDeckSourceLabel(source)}<button aria-label={`הסר ${shasDeckSourceLabel(source)}`} onClick={() => setSources((items) => items.filter((item) => item.id !== source.id))}><X className="h-4 w-4 text-destructive" /></button></span>)}</div></div>}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm"><span><strong>{selectedCards.length}</strong> שאלות ייכללו במבחן</span>{sources.length > 0 && <Button variant="ghost" size="sm" onClick={() => setSources([])} className="text-destructive"><Trash2 className="ml-1 h-4 w-4" />נקה הכול</Button>}</div>
      {selectedCards.length > 0 && <details open={!!editingDeckId} className="mt-3 rounded-xl border border-gold/30 p-3">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><ChevronDown className="h-4 w-4" />הצגת השאלות שנבחרו</summary>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-gold/25 pb-3" role="group" aria-label="חלוקת תצוגת שאלות">
          {([['all', 'הכול', List], ['masechta', 'לפי מסכת', BookOpen], ['daf', 'לפי דף', Layers3], ['amud', 'לפי עמוד', CheckCheck]] as const).map(([value, label, Icon]) => <button key={value} type="button" onClick={() => setQuestionView(value)} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition", questionView === value ? "border-navy bg-gradient-navy text-white" : "border-gold/40 bg-card hover:bg-gold/10")}><Icon className="h-3.5 w-3.5" />{label}</button>)}
        </div>
        <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">
          {questionGroups.map((group) => <section key={group.key} className="rounded-xl border border-gold/25 bg-secondary/10 p-2">
            {questionView !== "all" && <h4 className="mb-2 flex items-center justify-between rounded-lg bg-gold/10 px-3 py-2 text-sm font-bold"><span>{group.label}</span><span className="rounded-full bg-card px-2 py-0.5 text-xs">{group.cards.length}</span></h4>}
            <ol className="list-decimal space-y-2 pr-6 text-sm">{group.cards.map((card) => <li key={card.id} className="rounded-lg border border-gold/20 bg-card px-2 py-1.5"><span className="flex items-center justify-between gap-3"><span>{card.question}</span><button type="button" aria-label={`הסר את השאלה ${card.question}`} title="הסר שאלה מהמבחן" onClick={() => { setExistingCardIds((ids) => ids.filter((id) => id !== card.id)); setExcludedCardIds((ids) => ids.includes(card.id) ? ids : [...ids, card.id]); }} className="shrink-0 rounded-full p-1 text-destructive transition hover:bg-destructive/10"><X className="h-4 w-4" /></button></span></li>)}</ol>
          </section>)}
        </div>
      </details>}
    </Card>}
  </section>;
}
