import { useState, useMemo, useRef, useEffect } from "react";
import { Plus, BookOpen, Trash2, Brain, Library, Upload, History, Pencil, Copy, GripVertical, Layers, Play, Folder, List as ListIcon, LayoutGrid, Rows3, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  pointerWithin,
} from "@dnd-kit/core";
import { CardHistoryDialog } from "./CardHistoryDialog";
import { CategoryManager } from "./CategoryManager";
import { CopyCardDialog } from "./CopyCardDialog";
import { CardDecksDialog } from "./CardDecksDialog";
import { DateRangePicker } from "./DateRangePicker";
import type { DateRangeFilter } from "@/lib/study/dateFilter";
import type { Card as StudyCardType } from "@/lib/study/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useStudy } from "@/lib/study/store";
import { isDue } from "@/lib/study/srs";
import { CardEditor } from "./CardEditor";
import { BulkImporter } from "./BulkImporter";
import { WidgetGrid } from "./WidgetGrid";
import type { StudyMode } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { applyDateFilter } from "@/lib/study/dateFilter";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { StudySession } from "./StudySession";
import { DeckCreateDialog } from "./DeckCreateDialog";
import { DeckEditDialog } from "./DeckEditDialog";
import { PinnedCategoriesWidget } from "./PinnedCategoriesWidget";

// helper: collect a category id and all its descendant ids
function collectDescendants(rootId: string, cats: { id: string; parentId: string | null }[]): Set<string> {
  const set = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    cats.forEach((c) => {
      if (c.parentId && set.has(c.parentId) && !set.has(c.id)) {
        set.add(c.id); changed = true;
      }
    });
  }
  return set;
}

const TYPE_LABEL: Record<string, string> = {
  flashcard: "כרטיסיה",
  multiple: "אמריקאית",
  boolean: "נכון/לא",
  combo: "משולבת",
};

export function CardsManager() {
  const { state, addDeck, deleteDeck, deleteCard, moveCardToDeck, addCardToDeck, setCardCategories, setDeckCategories, duplicateCard, moveCategory, reorderCategories, duplicateCategoryUnder, setUiPref, setWidgetLayout } = useStudy();
  const [activeDeckId, setActiveDeckId] = useState<string | null>(state.decks[0]?.id ?? null);
  const [deckCreateOpen, setDeckCreateOpen] = useState(false);
  const [deckEditOpen, setDeckEditOpen] = useState(false);
  const [deckEditingId, setDeckEditingId] = useState<string | null>(null);

  const openDeckEdit = (deckId: string) => { setDeckEditingId(deckId); setDeckEditOpen(true); };

  const duplicateDeck = (deckId: string) => {
    const src = state.decks.find((d) => d.id === deckId);
    if (!src) return;
    const cats = state.deckCategories?.[deckId] ?? [];
    const newDeck = addDeck(`${src.name} (עותק)`, src.description, cats.slice());
    const linkedIds = new Set(
      (state.cardDecks ?? []).filter((l) => l.deckId === deckId).map((l) => l.cardId),
    );
    const cards = state.cards.filter((c) => c.deckId === deckId || linkedIds.has(c.id));
    cards.forEach((c) => duplicateCard(c.id, newDeck.id));
    setActiveDeckId(newDeck.id);
    toast({ title: "המערכת הועתקה", description: `${cards.length} כרטיסים הועתקו` });
  };
  type DeckViewMode = "list" | "grid" | "compact";
  const DECK_VIEW_KEY = "cards-deck-view-v1";
  const [deckView, setDeckView] = useState<DeckViewMode>(() => {
    const syncedPref = state.uiPrefs?.cardsDeckView;
    if (syncedPref === "grid" || syncedPref === "compact" || syncedPref === "list") return syncedPref;
    if (typeof window === "undefined") return "list";
    const v = localStorage.getItem(DECK_VIEW_KEY);
    return v === "grid" || v === "compact" || v === "list" ? v : "list";
  });

  // Sync cloud → local only (no effect writing back to cloud — that's done in the click handler)
  useEffect(() => {
    const syncedPref = state.uiPrefs?.cardsDeckView;
    if ((syncedPref === "grid" || syncedPref === "compact" || syncedPref === "list") && syncedPref !== deckView) {
      setDeckView(syncedPref);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.uiPrefs?.cardsDeckView]);

  const changeDeckView = (v: DeckViewMode) => {
    setDeckView(v);
    try { localStorage.setItem(DECK_VIEW_KEY, v); } catch { /* ignore */ }
    try { setUiPref("cardsDeckView", v); } catch { /* ignore (e.g. before auth) */ }
  };

  // ===== Deck sorting =====
  type DeckSortKey = "manual" | "name" | "size" | "due" | "recent";
  const DECK_SORT_KEY = "cards-deck-sort-v1";
  const DECK_SORT_DIR_KEY = "cards-deck-sort-dir-v1";
  const [deckSort, setDeckSort] = useState<DeckSortKey>(() => {
    if (typeof window === "undefined") return "manual";
    const v = localStorage.getItem(DECK_SORT_KEY);
    return v === "name" || v === "size" || v === "due" || v === "recent" || v === "manual" ? v : "manual";
  });
  const [deckSortDir, setDeckSortDir] = useState<"asc" | "desc">(() => {
    if (typeof window === "undefined") return "asc";
    const v = localStorage.getItem(DECK_SORT_DIR_KEY);
    return v === "desc" ? "desc" : "asc";
  });
  useEffect(() => { try { localStorage.setItem(DECK_SORT_KEY, deckSort); } catch { /* noop */ } }, [deckSort]);
  useEffect(() => { try { localStorage.setItem(DECK_SORT_DIR_KEY, deckSortDir); } catch { /* noop */ } }, [deckSortDir]);

  // ===== Cards sorting =====
  type CardSortKey = "manual" | "question" | "difficulty" | "failed" | "created" | "due";
  const CARD_SORT_KEY = "cards-card-sort-v1";
  const CARD_SORT_DIR_KEY = "cards-card-sort-dir-v1";
  const [cardSort, setCardSort] = useState<CardSortKey>(() => {
    if (typeof window === "undefined") return "manual";
    const v = localStorage.getItem(CARD_SORT_KEY);
    return v === "question" || v === "difficulty" || v === "failed" || v === "created" || v === "due" || v === "manual" ? v : "manual";
  });
  const [cardSortDir, setCardSortDir] = useState<"asc" | "desc">(() => {
    if (typeof window === "undefined") return "asc";
    const v = localStorage.getItem(CARD_SORT_DIR_KEY);
    return v === "desc" ? "desc" : "asc";
  });
  useEffect(() => { try { localStorage.setItem(CARD_SORT_KEY, cardSort); } catch { /* noop */ } }, [cardSort]);
  useEffect(() => { try { localStorage.setItem(CARD_SORT_DIR_KEY, cardSortDir); } catch { /* noop */ } }, [cardSortDir]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<StudyCardType | null>(null);
  const [prefillCategoryName, setPrefillCategoryName] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [session, setSession] = useState<{ deckId: string; mode: StudyMode; cardIds?: string[] } | null>(null);
  const [historyCard, setHistoryCard] = useState<StudyCardType | null>(null);
  const [copyCard, setCopyCard] = useState<StudyCardType | null>(null);
  const [decksDialogCard, setDecksDialogCard] = useState<StudyCardType | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>({
    field: "createdAt", from: null, to: null,
  });
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const copyDragRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // All hooks MUST be above any early return (Rules of Hooks)
  const activeDeck = state.decks.find((d) => d.id === activeDeckId);

  /** Get all cards for a given deckId, including categoryIds-linked and card_decks-linked cards */
  const getCardsForDeck = useMemo(() => {
    const catNameById = new Map((state.categories ?? []).map((c) => [c.id, c.name]));
    const cardDecksByDeck = new Map<string, Set<string>>();
    (state.cardDecks ?? []).forEach((l) => {
      const s = cardDecksByDeck.get(l.deckId) ?? new Set<string>();
      s.add(l.cardId);
      cardDecksByDeck.set(l.deckId, s);
    });
    return (deck: { id: string; categoryIds?: string[] }) => {
      const linkedIds = cardDecksByDeck.get(deck.id) ?? new Set<string>();
      const catNames = new Set(
        (deck.categoryIds ?? []).map((id) => catNameById.get(id)).filter(Boolean) as string[]
      );
      return state.cards.filter((c) =>
        c.deckId === deck.id ||
        linkedIds.has(c.id) ||
        (catNames.size > 0 && c.tags?.some((t) => t.startsWith("cat:") && catNames.has(t.slice(4))))
      );
    };
  }, [state.cards, state.cardDecks, state.categories]);

  // Sorted decks for display
  const sortedDecks = useMemo(() => {
    if (deckSort === "manual") return state.decks;
    const arr = [...state.decks];
    arr.sort((a, b) => {
      let cmp = 0;
      if (deckSort === "name") cmp = (a.name || "").localeCompare(b.name || "", "he");
      else if (deckSort === "size") {
        cmp = getCardsForDeck(a).length - getCardsForDeck(b).length;
      } else if (deckSort === "due") {
        cmp = getCardsForDeck(a).filter(isDue).length - getCardsForDeck(b).filter(isDue).length;
      } else if (deckSort === "recent") {
        cmp = ((a as { createdAt?: number }).createdAt ?? 0) - ((b as { createdAt?: number }).createdAt ?? 0);
      }
      return deckSortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [state.decks, getCardsForDeck, deckSort, deckSortDir]);
  const linkedCardIds = useMemo(() => {
    if (!activeDeckId) return new Set<string>();
    return new Set(
      (state.cardDecks ?? [])
        .filter((l) => l.deckId === activeDeckId)
        .map((l) => l.cardId),
    );
  }, [state.cardDecks, activeDeckId]);
  const allDeckCards = useMemo(() => {
    if (!activeDeckId || !activeDeck) return [];
    return getCardsForDeck(activeDeck);
  }, [getCardsForDeck, activeDeckId, activeDeck]);
  const deckCards = useMemo(() => {
    let result = allDeckCards;
    if (categoryFilter) {
      result = result.filter((c) => c.tags.includes(`cat:${categoryFilter}`));
    }
    result = applyDateFilter(result, dateFilter);
    return result;
  }, [allDeckCards, categoryFilter, dateFilter]);
  const dueCount = deckCards.filter(isDue).length;
  const isDateFilterActive = dateFilter.from !== null || dateFilter.to !== null;

  // Keep the quick-actions widget (cards-toolbar) above pinned categories in cards tab.
  useEffect(() => {
    const full = state.widgetLayout ?? {};
    const cardsLayout = full.cards;
    if (!cardsLayout || cardsLayout.length === 0) return;
    const toolbarIdx = cardsLayout.findIndex((w) => w.id === "cards-toolbar");
    const pinnedIdx = cardsLayout.findIndex((w) => w.id === "cards-pinned");
    if (toolbarIdx < 0 || pinnedIdx < 0) return;
    if (toolbarIdx < pinnedIdx) return;

    const next = [...cardsLayout];
    const [toolbar] = next.splice(toolbarIdx, 1);
    next.splice(pinnedIdx, 0, toolbar);
    const normalized = next.map((w, i) => ({ ...w, order: i }));
    setWidgetLayout({ ...full, cards: normalized });
  }, [state.widgetLayout, setWidgetLayout]);

  // Sorted card list for display
  const sortedDeckCards = useMemo(() => {
    if (cardSort === "manual") return deckCards;
    const arr = [...deckCards];
    arr.sort((a, b) => {
      let cmp = 0;
      if (cardSort === "question") cmp = (a.question || "").localeCompare(b.question || "", "he");
      else if (cardSort === "difficulty") {
        // higher ease = easier; lower = harder. Sort ascending = hardest first
        cmp = (a.srs?.ease ?? 2.5) - (b.srs?.ease ?? 2.5);
      } else if (cardSort === "failed") {
        cmp = (a.stats?.incorrect ?? 0) - (b.stats?.incorrect ?? 0);
      } else if (cardSort === "created") {
        cmp = (a.createdAt ?? 0) - (b.createdAt ?? 0);
      } else if (cardSort === "due") {
        cmp = (a.srs?.dueAt ?? 0) - (b.srs?.dueAt ?? 0);
      }
      return cardSortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [deckCards, cardSort, cardSortDir]);

  if (session) {
    return (
      <div className="space-y-4">
        <StudySession
          deckId={session.deckId}
          mode={session.mode}
          cardIds={session.cardIds}
          onExit={() => setSession(null)}
        />
      </div>
    );
  }

  const openNewCard = () => { setEditingCard(null); setPrefillCategoryName(null); setEditorOpen(true); };
  const openNewCardForCategory = (catName: string) => {
    setEditingCard(null);
    setPrefillCategoryName(catName);
    setEditorOpen(true);
  };
  const openEditCard = (c: StudyCardType) => { setEditingCard(c); setEditorOpen(true); };

  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith("card:")) setDraggedCardId(id.slice(5));
    if (id.startsWith("catdrag:")) setDraggedCategoryId(id.slice("catdrag:".length));
    const event = e.activatorEvent as (MouseEvent & { metaKey?: boolean }) | (KeyboardEvent & { metaKey?: boolean }) | null;
    copyDragRef.current = !!event && (!!event.ctrlKey || !!event.metaKey);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setDraggedCardId(null);
    setDraggedCategoryId(null);
    const { active, over } = e;
    if (!over) return;
    const isCopyDrag = copyDragRef.current;
    copyDragRef.current = false;
    const activeId = String(active.id);
    const overId = String(over.id);

    // === category drag ===
    if (activeId.startsWith("catdrag:")) {
      const catId = activeId.slice("catdrag:".length);
      const cats = state.categories ?? [];
      const dragged = cats.find((c) => c.id === catId);
      if (!dragged) return;

      const descendants = collectDescendants(catId, cats);
      const canMoveUnder = (parentId: string | null) => {
        if (parentId === null) return true;
        if (parentId === catId) return false;
        return !descendants.has(parentId);
      };

      const placeAmongSiblings = (parentId: string | null, targetIdx: number) => {
        if (!canMoveUnder(parentId)) return;
        if (isCopyDrag) {
          const newId = duplicateCategoryUnder(catId, parentId);
          if (newId) {
            const existingSiblings = cats
              .filter((c) => c.parentId === parentId)
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .map((c) => c.id);
            existingSiblings.splice(Math.max(0, Math.min(targetIdx, existingSiblings.length)), 0, newId);
            reorderCategories(existingSiblings);
            toast({ title: "📋 הקטגוריה הועתקה" });
          }
          return;
        }
        if (dragged.parentId !== parentId) moveCategory(catId, parentId);
        const siblings = cats
          .filter((c) => c.parentId === parentId && c.id !== catId)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const newOrder = [...siblings];
        newOrder.splice(Math.max(0, Math.min(targetIdx, newOrder.length)), 0, dragged);
        reorderCategories(newOrder.map((c) => c.id));
      };

      if (overId.startsWith("before:") || overId.startsWith("after:")) {
        const targetId = overId.slice(overId.indexOf(":") + 1);
        const target = cats.find((c) => c.id === targetId);
        if (!target || targetId === catId) return;
        const siblings = cats
          .filter((c) => c.parentId === target.parentId)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const targetIdx = siblings.findIndex((c) => c.id === targetId);
        placeAmongSiblings(target.parentId, overId.startsWith("after:") ? targetIdx + 1 : targetIdx);
      } else if (overId.startsWith("catdrag:")) {
        const targetId = overId.slice("catdrag:".length);
        const target = cats.find((c) => c.id === targetId);
        if (!target || targetId === catId) return;
        const siblings = cats
          .filter((c) => c.parentId === target.parentId)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const targetIdx = siblings.findIndex((c) => c.id === targetId);
        placeAmongSiblings(target.parentId, targetIdx);
      } else if (overId.startsWith("catparent:")) {
        const parentId = overId.slice("catparent:".length);
        const parentIdOrNull = parentId === "root" ? null : parentId;
        const siblings = cats
          .filter((c) => c.parentId === parentIdOrNull && c.id !== catId)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        placeAmongSiblings(parentIdOrNull, siblings.length);
      } else if (overId.startsWith("cat:")) {
        const targetName = overId.slice("cat:".length);
        const target = cats.find((c) => c.name === targetName);
        if (!target || target.id === catId) return;
        const children = cats
          .filter((c) => c.parentId === target.id && c.id !== catId)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        placeAmongSiblings(target.id, children.length);
      } else if (overId === "cat-root") {
        const siblings = cats
          .filter((c) => c.parentId === null && c.id !== catId)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        placeAmongSiblings(null, siblings.length);
      }
      return;
    }

    // === card drag ===
    if (activeId.startsWith("card:") && overId.startsWith("deck:")) {
      const cardId = activeId.slice(5);
      const deckId = overId.slice(5);
      if (deckId === activeDeckId) return;
      if (isCopyDrag) {
        addCardToDeck(cardId, deckId);
        toast({ title: "📚 שויך למערכת נוספת", description: state.decks.find((d) => d.id === deckId)?.name });
      } else {
        moveCardToDeck(cardId, deckId);
        toast({ title: "📦 הועבר למערכת", description: state.decks.find((d) => d.id === deckId)?.name });
      }
      return;
    }

    if (activeId.startsWith("card:")) {
      const cardId = activeId.slice(5);
      let catName: string | null = overId.startsWith("cat:") ? overId.slice(4) : null;
      if (!catName) {
        const catId = over.data?.current?.catId;
        if (typeof catId === "string") {
          catName = (state.categories ?? []).find((c) => c.id === catId)?.name ?? null;
        }
      }
      if (!catName) return;

      const card = state.cards.find((c) => c.id === cardId);
      if (!card) return;
      const existing = card.tags.filter((t) => t.startsWith("cat:")).map((t) => t.slice(4));
      const previous = existing.slice();
      const next = isCopyDrag
        ? Array.from(new Set([...existing, catName]))
        : [catName];
      if (next.length === previous.length && next.every((n, i) => n === previous[i])) return;

      setCardCategories(cardId, next);
      toast({
        title: isCopyDrag ? `📁 הועתק לקטגוריה: ${catName}` : `📁 הועבר לקטגוריה: ${catName}`,
        description: card.question.length > 60 ? card.question.slice(0, 60) + "…" : card.question,
        action: (
          <ToastAction
            altText="בטל שיוך"
            onClick={() => {
              setCardCategories(cardId, previous);
              toast({ title: "השיוך בוטל", description: `הוסר מהקטגוריה "${catName}"` });
            }}
          >
            ↶ בטל
          </ToastAction>
        ),
      });
      return;
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="space-y-4 sm:space-y-6 overflow-x-hidden">
      <WidgetGrid
        tabId="cards"
        inlineDrag={false}
        widgetMap={{
          "cards-decks": (
            <Card className="gold-frame p-3 sm:p-5 space-y-3 sm:space-y-4 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="gold-icon-circle"><Library className="h-4 w-4" /></span>
                  <h3 className="font-display text-base sm:text-lg font-semibold truncate">מערכות</h3>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:inline">{state.decks.length} מערכות</span>
                  <span className="text-xs text-muted-foreground sm:hidden">{state.decks.length}</span>
                  {/* Sort dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button" size="icon" variant="ghost"
                        className="h-7 w-7 border border-gold/40 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
                        title={`סיווג: ${deckSort === "manual" ? "ידני" : deckSort === "name" ? "שם" : deckSort === "size" ? "מס׳ כרטיסים" : deckSort === "due" ? "לחזרה" : "אחרון"}`}
                      >
                        <ArrowUpDown className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuLabel className="text-right">סיווג מערכות</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setDeckSort("manual")} className="justify-end">{deckSort === "manual" && "✓ "}ידני (מותאם)</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDeckSort("name")} className="justify-end">{deckSort === "name" && "✓ "}שם</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDeckSort("size")} className="justify-end">{deckSort === "size" && "✓ "}מס׳ כרטיסים</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDeckSort("due")} className="justify-end">{deckSort === "due" && "✓ "}לחזרה</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDeckSort("recent")} className="justify-end">{deckSort === "recent" && "✓ "}נוצר לאחרונה</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setDeckSortDir(deckSortDir === "asc" ? "desc" : "asc")} className="justify-end gap-2">
                        {deckSortDir === "asc" ? <>עולה <ArrowUp className="h-4 w-4" /></> : <>יורד <ArrowDown className="h-4 w-4" /></>}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 border border-gold/40 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
                        title="תצוגה"
                        aria-label="תצוגה"
                      >
                        {deckView === "grid" ? <LayoutGrid className="h-3.5 w-3.5" /> :
                         deckView === "compact" ? <Rows3 className="h-3.5 w-3.5" /> :
                         <ListIcon className="h-3.5 w-3.5" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-40 text-right">
                      <DropdownMenuLabel className="text-right">תצוגת מערכות</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => changeDeckView("list")} className="gap-2 flex-row-reverse justify-end text-right">
                        רשימה
                        <ListIcon className="h-4 w-4" />
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => changeDeckView("grid")} className="gap-2 flex-row-reverse justify-end text-right">
                        רשת
                        <LayoutGrid className="h-4 w-4" />
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => changeDeckView("compact")} className="gap-2 flex-row-reverse justify-end text-right">
                        טבלה צפופה
                        <Rows3 className="h-4 w-4" />
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => setDeckCreateOpen(true)}
                  className="bg-gradient-navy text-primary-foreground rounded-xl flex-1 gap-2"
                  title="הוסף מערכת חדשה"
                >
                  <Plus className="h-4 w-4" />
                  מערכת חדשה
                </Button>
              </div>

              {activeDeck && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    disabled={dueCount === 0}
                    onClick={() => setSession({
                      deckId: activeDeck.id,
                      mode: "srs",
                      cardIds: deckCards.map((c) => c.id),
                    })}
                    variant="outline"
                    className="border-2 border-gold rounded-xl text-navy"
                  >
                    <Brain className="h-4 w-4" /> חזרה ממוקדת ({dueCount})
                  </Button>
                  <Button
                    disabled={deckCards.length === 0}
                    onClick={() => setSession({
                      deckId: activeDeck.id,
                      mode: "practice",
                      cardIds: deckCards.map((c) => c.id),
                    })}
                    variant="outline"
                    className="border-2 border-gold rounded-xl text-navy"
                  >
                    <Play className="h-4 w-4" /> תרגול חופשי
                  </Button>
                </div>
              )}
              <DeckCreateDialog
                open={deckCreateOpen}
                onOpenChange={setDeckCreateOpen}
                onCreated={(id) => { setActiveDeckId(id); toast({ title: "המערכת נוספה" }); }}
              />
              <DeckEditDialog
                open={deckEditOpen}
                onOpenChange={(o) => { setDeckEditOpen(o); if (!o) setDeckEditingId(null); }}
                deckId={deckEditingId}
                onEditCard={(c) => { setEditingCard(c); setEditorOpen(true); }}
                onAddCard={() => {
                  if (deckEditingId) setActiveDeckId(deckEditingId);
                  setEditingCard(null);
                  setPrefillCategoryName(null);
                  setEditorOpen(true);
                }}
              />

              <div
                dir="rtl"
                className={cn(
                  "max-h-[300px] overflow-y-auto snap-list-y",
                  deckView === "grid"
                    ? "grid grid-cols-2 sm:grid-cols-3 gap-2 items-stretch"
                    : "space-y-2",
                  deckView === "compact" && "space-y-1",
                )}
              >
                {sortedDecks.map((deck) => {
                  const cards = getCardsForDeck(deck);
                  const due = cards.filter(isDue).length;
                  const isActive = deck.id === activeDeckId;

                  if (deckView === "grid") {
                    return (
                      <DeckDropTarget
                        key={deck.id}
                        deckId={deck.id}
                        isActive={isActive}
                        isDraggingCard={!!draggedCardId}
                        onClick={() => setActiveDeckId(deck.id)}
                      >
                <div className="flex flex-col items-center text-center gap-2 w-full h-full min-w-0">
                          <span className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-full border-2",
                            isActive ? "border-gold bg-card/10 text-gold" : "border-gold/70 bg-card text-navy",
                          )}>
                            <BookOpen className="h-5 w-5" />
                          </span>
                          <div className="font-medium text-xs leading-tight line-clamp-2 min-h-[2.4em] flex items-center justify-center break-words w-full">
                            {deck.name}
                          </div>
                          <div className={cn("text-[10px]", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            {cards.length} · {due} לחזרה
                          </div>
                          {(state.deckCategories?.[deck.id] ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1 justify-center">
                              {(state.deckCategories?.[deck.id] ?? []).slice(0, 3).map((cn2) => (
                                <Badge key={cn2} variant="outline" className="text-[9px] border-gold/40 px-1 py-0">
                                  {cn2}
                                </Badge>
                              ))}
                              {(state.deckCategories?.[deck.id] ?? []).length > 3 && (
                                <Badge variant="outline" className="text-[9px] border-gold/40 px-1 py-0">
                                  +{(state.deckCategories?.[deck.id] ?? []).length - 3}
                                </Badge>
                              )}
                            </div>
                          )}
                          <div className="absolute top-1 left-1 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); openDeckEdit(deck.id); }}
                              title="ערוך"
                              className={cn("h-5 w-5 rounded flex items-center justify-center hover:bg-card/30", isActive ? "text-primary-foreground" : "text-navy")}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); duplicateDeck(deck.id); }}
                              title="שכפל"
                              className={cn("h-5 w-5 rounded flex items-center justify-center hover:bg-card/30", isActive ? "text-primary-foreground" : "text-navy")}
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`למחוק את "${deck.name}"?`)) {
                                  deleteDeck(deck.id);
                                  if (activeDeckId === deck.id) setActiveDeckId(null);
                                }
                              }}
                              title="מחק"
                              className={cn("h-5 w-5 rounded flex items-center justify-center hover:bg-destructive/20", isActive ? "text-primary-foreground" : "text-destructive")}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </DeckDropTarget>
                    );
                  }

                  if (deckView === "compact") {
                    return (
                      <DeckDropTarget
                        key={deck.id}
                        deckId={deck.id}
                        isActive={isActive}
                        isDraggingCard={!!draggedCardId}
                        onClick={() => setActiveDeckId(deck.id)}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <BookOpen className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-gold" : "text-navy")} />
                          <span className="text-xs font-medium truncate flex-1 text-right">{deck.name}</span>
                          <span className={cn("text-[10px] shrink-0", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            {cards.length}/{due}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); openDeckEdit(deck.id); }}
                            title="ערוך"
                            className={cn("p-0.5 rounded hover:bg-card/30", isActive ? "text-primary-foreground" : "text-navy")}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); duplicateDeck(deck.id); }}
                            title="שכפל"
                            className={cn("p-0.5 rounded hover:bg-card/30", isActive ? "text-primary-foreground" : "text-navy")}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`למחוק את "${deck.name}"?`)) {
                                deleteDeck(deck.id);
                                if (activeDeckId === deck.id) setActiveDeckId(null);
                              }
                            }}
                            title="מחק"
                            className={cn("p-0.5 rounded hover:bg-destructive/20", isActive ? "text-primary-foreground" : "text-destructive")}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </DeckDropTarget>
                    );
                  }

                  return (
                    <DeckDropTarget
                      key={deck.id}
                      deckId={deck.id}
                      isActive={isActive}
                      isDraggingCard={!!draggedCardId}
                      onClick={() => setActiveDeckId(deck.id)}
                    >
                       <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2",
                          isActive ? "border-gold bg-card/10 text-gold" : "border-gold/70 bg-card text-navy")}>
                          <BookOpen className="h-4 w-4" />
                        </span>
                        <div className="text-right min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{deck.name}</div>
                          <div className={cn("text-xs truncate", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            {cards.length} כרטיסים · {due} לחזרה
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); openDeckEdit(deck.id); }}
                          title="ערוך"
                          className={cn("p-1 rounded hover:bg-card/30", isActive ? "text-primary-foreground" : "text-navy")}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); duplicateDeck(deck.id); }}
                          title="שכפל"
                          className={cn("p-1 rounded hover:bg-card/30", isActive ? "text-primary-foreground" : "text-navy")}
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`למחוק את "${deck.name}"?`)) {
                              deleteDeck(deck.id);
                              if (activeDeckId === deck.id) setActiveDeckId(null);
                            }
                          }}
                          title="מחק"
                          className={cn("p-1 rounded hover:bg-destructive/20", isActive ? "text-primary-foreground" : "text-destructive")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </DeckDropTarget>
                  );
                })}
                {state.decks.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6 col-span-full">אין מערכות עדיין</p>
                )}
              </div>
            </Card>
          ),
          "cards-pinned": (
            <PinnedCategoriesWidget
              onSelectCategory={(name) => {
                setCategoryFilter(name);
              }}
            />
          ),
          "cards-categories": (
            <CategoryManager
              selectedCategory={categoryFilter}
              onSelectCategory={setCategoryFilter}
              activeDeckId={activeDeckId}
              onAddCardToCategory={(catName) => {
                openNewCardForCategory(catName);
              }}
              onEditCard={(card) => openEditCard(card)}
            />
          ),
          "cards-toolbar": (
            <Card className="gold-frame p-3 sm:p-5 space-y-3 sm:space-y-4 min-w-0">
              {!activeDeck ? (
                <div className="text-center py-8 text-muted-foreground">בחר מערכת כדי להתחיל</div>
              ) : (
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="text-right min-w-0 flex-1">
                    <h3 className="font-display text-base sm:text-xl font-bold truncate">חזרות: {activeDeck.name}</h3>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {deckCards.length} שאלות
                      {categoryFilter ? ` · קטגוריה: ${categoryFilter}` : ""}
                      {isDateFilterActive ? " · מסונן לפי תאריך" : ""}
                      {" · "}{dueCount} מחכות לחזרה
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button onClick={openNewCard} className="bg-gradient-navy text-primary-foreground rounded-xl text-sm">
                      <Plus className="h-4 w-4" /> שאלה חדשה
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ),
          "cards-filters": (
            <Card className="gold-frame p-3 sm:p-5 space-y-3 min-w-0">
              {activeDeck ? <DateRangePicker value={dateFilter} onChange={setDateFilter} /> : null}
              <p className="text-[11px] text-muted-foreground text-right">💡 גרור רגיל = העברה · גרירה עם Ctrl = העתקה (שומר גם במיקום המקורי)</p>
            </Card>
          ),
          "cards-list": (
            <Card className="gold-frame p-3 sm:p-5 space-y-3 min-w-0">
              {!activeDeck ? (
                <div className="text-center py-12 text-muted-foreground">בחר מערכת כדי להתחיל</div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto snap-list-y">
                  <div className="flex items-center justify-between gap-2 pb-1 border-b border-gold/20">
                    <span className="text-xs text-muted-foreground">{sortedDeckCards.length} שאלות</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" size="sm" variant="ghost"
                          className="h-7 px-2 border border-gold/40 text-xs gap-1 hover:bg-secondary">
                          <ArrowUpDown className="h-3.5 w-3.5" />
                          סיווג: {cardSort === "manual" ? "ידני" : cardSort === "question" ? "שאלה" : cardSort === "difficulty" ? "קושי" : cardSort === "failed" ? "כישלונות" : cardSort === "created" ? "נוצר" : "לחזרה"}
                          {cardSortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuLabel className="text-right">סיווג שאלות</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setCardSort("manual")} className="justify-end">{cardSort === "manual" && "✓ "}ידני</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setCardSort("question")} className="justify-end">{cardSort === "question" && "✓ "}לפי שאלה</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setCardSort("difficulty")} className="justify-end">{cardSort === "difficulty" && "✓ "}לפי קושי</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setCardSort("failed")} className="justify-end">{cardSort === "failed" && "✓ "}לפי כישלונות</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setCardSort("created")} className="justify-end">{cardSort === "created" && "✓ "}לפי תאריך</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setCardSort("due")} className="justify-end">{cardSort === "due" && "✓ "}לפי חזרה</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setCardSortDir(cardSortDir === "asc" ? "desc" : "asc")} className="justify-end gap-2">
                          {cardSortDir === "asc" ? <>עולה <ArrowUp className="h-4 w-4" /></> : <>יורד <ArrowDown className="h-4 w-4" /></>}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {sortedDeckCards.map((c) => {
                    const categoryTags = c.tags.filter((t) => t.startsWith("cat:")).map((t) => t.slice(4));
                    const plainTags = c.tags.filter((t) => !t.startsWith("cat:"));
                    const cardDeckCount = (state.cardDecks ?? []).filter((l) => l.cardId === c.id).length || 1;
                    return (
                      <DraggableCardRow key={c.id} cardId={c.id}>
                        <div className="flex-1 text-right cursor-pointer" onClick={() => setHistoryCard(c)}>
                          <div className="flex items-center gap-1 justify-end mb-1 flex-wrap">
                            {cardDeckCount > 1 && <Badge className="text-[10px] bg-gold text-navy">📚 {cardDeckCount} מערכות</Badge>}
                            {categoryTags.map((t) => <Badge key={t} className="text-[10px] bg-navy text-primary-foreground">📁 {t}</Badge>)}
                            {plainTags.map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                            <Badge variant="outline" className="border-gold text-xs">{TYPE_LABEL[c.type] ?? c.type}</Badge>
                          </div>
                          <p className="text-sm font-medium text-foreground">{c.question}</p>
                          <div className="text-xs text-muted-foreground mt-1">
                            {c.stats.totalReviews} חזרות · {c.stats.totalReviews ? Math.round((c.stats.correct / c.stats.totalReviews) * 100) : 0}% נכון · הבא: {c.srs.interval}י׳
                          </div>
                        </div>
                        <div className="absolute bottom-1.5 left-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-0 group-hover:[transition-delay:2000ms]">
                          <button onClick={(e) => { e.stopPropagation(); if (confirm("למחוק שאלה זו?")) deleteCard(c.id); }} className="p-1 rounded hover:bg-destructive/10 text-destructive/70 hover:text-destructive" title="מחק"><Trash2 className="h-3.5 w-3.5" /></button>
                          <button onClick={(e) => { e.stopPropagation(); openEditCard(c); }} className="p-1 rounded hover:bg-navy/10 text-navy/70 hover:text-navy" title="ערוך"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={(e) => { e.stopPropagation(); setCopyCard(c); }} className="p-1 rounded hover:bg-navy/10 text-navy/70 hover:text-navy" title="העתק / העבר"><Copy className="h-3.5 w-3.5" /></button>
                          <button onClick={(e) => { e.stopPropagation(); setDecksDialogCard(c); }} className="p-1 rounded hover:bg-navy/10 text-navy/70 hover:text-navy" title="מערכות משויכות"><Layers className="h-3.5 w-3.5" /></button>
                          <button onClick={(e) => { e.stopPropagation(); setHistoryCard(c); }} className="p-1 rounded hover:bg-navy/10 text-navy/70 hover:text-navy" title="היסטוריית חזרות"><History className="h-3.5 w-3.5" /></button>
                        </div>
                      </DraggableCardRow>
                    );
                  })}
                  {deckCards.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      {categoryFilter ? `אין שאלות בקטגוריה "${categoryFilter}"` : "אין שאלות במערכת זו. הוסף שאלה ראשונה!"}
                    </p>
                  )}
                </div>
              )}
            </Card>
          ),
        }}
      />

      {/* Editor dialog */}
      <Dialog open={editorOpen} onOpenChange={(o) => { setEditorOpen(o); if (!o) { setEditingCard(null); setPrefillCategoryName(null); } }}>
        <DialogContent className="max-w-lg gold-frame max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="font-display text-right">
                {editingCard
                  ? "עריכת שאלה"
                  : `שאלה חדשה${prefillCategoryName ? ` · 📁 ${prefillCategoryName}` : ""}`}
              </DialogTitle>
              {!editingCard && activeDeck && (
                <button
                  type="button"
                  onClick={() => setBulkOpen(true)}
                  title="ייבוא מרוכז"
                  aria-label="ייבוא מרוכז"
                  className="flex items-center justify-center h-8 w-8 rounded-full border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
                >
                  <Upload className="h-4 w-4" />
                </button>
              )}
            </div>
          </DialogHeader>
          <CardEditor
            key={editingCard?.id ?? `new-${prefillCategoryName ?? "x"}`}
            deckId={activeDeck?.id ?? null}
            editCard={editingCard ?? undefined}
            prefillCategories={prefillCategoryName ? [prefillCategoryName] : undefined}
            onClose={() => { setEditorOpen(false); setEditingCard(null); setPrefillCategoryName(null); }}
          />
        </DialogContent>
      </Dialog>

      {/* Bulk import dialog (opened from new-card dialog) */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-2xl gold-frame max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="font-display text-right">ייבוא מרוכז{activeDeck ? ` ל${activeDeck.name}` : ""}</DialogTitle>
          </DialogHeader>
          {activeDeck && <BulkImporter deckId={activeDeck.id} onClose={() => setBulkOpen(false)} />}
        </DialogContent>
      </Dialog>

      <CardHistoryDialog card={historyCard} open={!!historyCard} onOpenChange={(o) => !o && setHistoryCard(null)} />
      <CopyCardDialog card={copyCard} open={!!copyCard} onOpenChange={(o) => !o && setCopyCard(null)} />
      <CardDecksDialog card={decksDialogCard} open={!!decksDialogCard} onOpenChange={(o) => !o && setDecksDialogCard(null)} />
    </div>
    <DragOverlay>
      {draggedCardId ? (
        <div className="rounded-xl border-2 border-gold bg-card p-3 shadow-elegant text-right max-w-md">
          <p className="text-sm font-medium truncate">{state.cards.find((c) => c.id === draggedCardId)?.question}</p>
        </div>
      ) : null}
      {draggedCategoryId ? (
        <div className="rounded-lg border-2 border-emerald-500 bg-card px-3 py-2 shadow-elegant flex items-center gap-2 text-right">
          <Folder className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold">{state.categories?.find((c) => c.id === draggedCategoryId)?.name ?? "קטגוריה"}</span>
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}

// === Drag/Drop helpers ===
function DraggableCardRow({ cardId, children }: { cardId: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `card:${cardId}` });
  return (
    <div ref={setNodeRef} className={cn("group relative rounded-xl border-2 border-gold/40 p-3 flex items-start justify-between gap-3 bg-card", isDragging && "opacity-30")}>
      <button {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none" title="גרור">
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

function DeckDropTarget({ deckId, isActive, onClick, children, isDraggingCard }: { deckId: string; isActive: boolean; onClick: () => void; children: React.ReactNode; isDraggingCard?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `deck:${deckId}` });
  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={cn(
        "group relative rounded-xl border-2 p-3 transition-colors duration-150 cursor-pointer flex items-center justify-between",
        isActive ? "border-gold bg-gradient-navy text-primary-foreground" : "border-gold/40 bg-card hover:bg-secondary",
        isDraggingCard && !isActive && "border-gold/70 border-dashed bg-gold/5",
        isOver && "ring-4 ring-gold/60 scale-[1.02] bg-gold/10 border-gold",
      )}
    >
      {children}
    </div>
  );
}
