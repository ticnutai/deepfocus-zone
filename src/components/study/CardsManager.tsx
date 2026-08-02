import { useState, useMemo, useRef, useEffect, memo } from "react";
import { Plus, BookOpen, Trash2, Brain, Library, Upload, History, Pencil, Copy, GripVertical, Layers, Play, Folder, List as ListIcon, LayoutGrid, Rows3, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown, Download, X, CheckSquare, Square, Search, CircleX } from "lucide-react";
import { useMultiSelect } from "@/hooks/useMultiSelect";
import { MultiSelectToolbar } from "@/components/study/MultiSelectToolbar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import type { Card as StudyCardType, ReviewLog } from "@/lib/study/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DraggableResizablePanel } from "@/components/ui/DraggableResizablePanel";
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
import { PATH_SEP, dafLabel } from "@/lib/study/shasGen";
import { toHebrewNum } from "@/lib/study/shasFormat";
import { useAuth } from "@/hooks/useAuth";
import { DeckCreationGuide } from "./DeckCreationGuide";

const IS_DEV = import.meta.env.DEV;
const DECK_CREATION_EXCLUDED_WIDGETS = [
  "cards-toolbar",
  "cards-pinned",
  "cards-categories",
  "cards-filters",
  "cards-list",
] as const;

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

function normalizeCategorySegment(seg: string): string {
  const s = seg.trim();
  if (!s) return s;
  const noPrefix = s.replace(/^דף\s+/, "").trim();
  const bookRefMatch = noPrefix.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/u);
  if (bookRefMatch) {
    const [, book, chapter, verse, verseEnd] = bookRefMatch;
    const c = toHebrewNum(Number(chapter)) || chapter;
    const v = toHebrewNum(Number(verse)) || verse;
    const ve = verseEnd ? `-${toHebrewNum(Number(verseEnd)) || verseEnd}` : "";
    return `${book.trim()} ${c}:${v}${ve}`;
  }
  if (/^ע["׳']?[אב]$/u.test(noPrefix)) {
    return noPrefix.includes('"') ? noPrefix : (noPrefix.includes("׳") ? noPrefix : noPrefix.replace(/^ע([אב])$/u, 'ע"$1'));
  }
  if (/^[א-ת]{1,3}\.?$/u.test(noPrefix)) {
    const base = noPrefix.replace(/\.$/u, "");
    return `${base}'`;
  }
  return noPrefix;
}

function formatRefTagLabel(tag: string): string {
  if (!tag.startsWith("ref:")) return tag;
  const raw = tag.slice(4).trim();
  const dotted = raw.match(/^(.+?)\.(\d+):(\d+)(?:-(\d+))?$/u);
  if (dotted) {
    const [, book, chapter, verse, verseEnd] = dotted;
    const c = toHebrewNum(Number(chapter)) || chapter;
    const v = toHebrewNum(Number(verse)) || verse;
    const ve = verseEnd ? `-${toHebrewNum(Number(verseEnd)) || verseEnd}` : "";
    return `${book.trim()} ${c}:${v}${ve}`;
  }

  const spaced = raw.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/u);
  if (spaced) {
    const [, book, chapter, verse, verseEnd] = spaced;
    const c = toHebrewNum(Number(chapter)) || chapter;
    const v = toHebrewNum(Number(verse)) || verse;
    const ve = verseEnd ? `-${toHebrewNum(Number(verseEnd)) || verseEnd}` : "";
    return `${book.trim()} ${c}:${v}${ve}`;
  }

  return raw;
}

function buildCanonicalCategoryChips(
  rawCategoryTags: string[],
  categories: Array<{ id: string; name: string; parentId: string | null }>,
): string[] {
  if (rawCategoryTags.length === 0) return [];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const byName = new Map<string, { id: string; name: string; parentId: string | null }>();
  const depthOf = (cat: { id: string; name: string; parentId: string | null }): number => {
    let d = 0;
    let cur: { id: string; name: string; parentId: string | null } | undefined = cat;
    while (cur?.parentId) {
      d += 1;
      cur = byId.get(cur.parentId);
    }
    return d;
  };

  for (const cat of categories) {
    const prev = byName.get(cat.name);
    if (!prev || depthOf(cat) > depthOf(prev)) byName.set(cat.name, cat);
  }

  const pathFromTree = (leafName: string): string[] => {
    const leaf = byName.get(leafName);
    if (!leaf) return [leafName];
    const parts: string[] = [];
    let cur: { id: string; name: string; parentId: string | null } | undefined = leaf;
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts;
  };

  const paths = rawCategoryTags
    .map((t) => {
      const explicitPath = t.includes(PATH_SEP) ? t.split(PATH_SEP).map((x) => x.trim()).filter(Boolean) : null;
      const inferredPath = explicitPath && explicitPath.length > 1 ? explicitPath : pathFromTree(t);
      return inferredPath.map(normalizeCategorySegment).filter(Boolean);
    })
    .filter((parts) => parts.length > 0);
  if (paths.length === 0) return [];

  const longest = paths.reduce((best, cur) => (cur.length > best.length ? cur : best), paths[0]);
  if (longest.length >= 2) {
    return Array.from(new Set(longest));
  }

  const uniq = new Set<string>();
  paths.flat().forEach((p) => uniq.add(p));
  return [...uniq];
}

function buildShasHierarchyChips(card: Pick<StudyCardType, "masechta" | "daf" | "amud">): string[] | null {
  if (!card.masechta || !card.daf) return null;
  const chips = [
    'ש"ס',
    'מועד',
    card.masechta.trim(),
    dafLabel(card.daf).replace('.', "'"),
  ];
  if (card.amud === 1) chips.push('ע"א');
  else if (card.amud === 2) chips.push('ע"ב');
  return chips;
}

function DeckCreateLauncher({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-gradient-navy text-primary-foreground rounded-xl flex-1 gap-2"
        title="יצירת מבחן"
      >
        <Plus className="h-4 w-4" />
        יצירת מבחן
      </Button>

      <DeckCreateDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(id) => {
          onCreated(id);
          toast({ title: "המבחן נוסף" });
        }}
      />
    </>
  );
}

function CardsManager() {
  const { isGuest } = useAuth();
  const { state, addDeck, deleteDeck, deleteCard, moveCardToDeck, addCardToDeck, setCardCategories, setDeckCategories, duplicateCard, moveCategory, reorderCategories, duplicateCategoryUnder, setUiPref, setWidgetLayout } = useStudy();
  const [activeDeckId, setActiveDeckId] = useState<string | null>(state.decks[0]?.id ?? null);
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
      try { localStorage.setItem(DECK_VIEW_KEY, syncedPref); } catch { /* storage unavailable */ }
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
  useEffect(() => {
    if (!IS_DEV) return;
    const w = window as Window & {
      __addQuestionTrace?: {
        id: string;
        catName: string;
        clickedAt: number;
      };
      __cardsManagerEditorOpenTrace?: Array<{
        at: number;
        iso: string;
        editorOpen: boolean;
        editingCardId: string | null;
        prefillCategoryName: string | null;
        traceId: string | null;
      }>;
      __lastEditorOwner?: string;
    };
    const trace = w.__addQuestionTrace;
    const item = {
      at: performance.now(),
      iso: new Date().toISOString(),
      editorOpen,
      editingCardId: editingCard?.id ?? null,
      prefillCategoryName,
      traceId: trace?.id ?? null,
    };
    const prev = Array.isArray(w.__cardsManagerEditorOpenTrace) ? w.__cardsManagerEditorOpenTrace : [];
    w.__cardsManagerEditorOpenTrace = [...prev, item].slice(-50);
    w.__lastEditorOwner = "CardsManager";
    console.info("[trace][cards-manager] editorOpen changed", item);
  }, [editorOpen, editingCard?.id, prefillCategoryName]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [session, setSession] = useState<{ deckId: string; mode: StudyMode; cardIds?: string[] } | null>(null);
  const [historyCard, setHistoryCard] = useState<StudyCardType | null>(null);
  const [copyCard, setCopyCard] = useState<StudyCardType | null>(null);
  const [decksDialogCard, setDecksDialogCard] = useState<StudyCardType | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [categoryRevealRequest, setCategoryRevealRequest] = useState<{ name: string; requestId: number } | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>({
    field: "createdAt", from: null, to: null,
  });
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [visibleCardsCount, setVisibleCardsCount] = useState(60);
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
    // Pre-build a parent→children map for sub-category expansion
    const childrenOf = new Map<string | null, string[]>();
    (state.categories ?? []).forEach((c) => {
      const key = c.parentId ?? null;
      const arr = childrenOf.get(key) ?? [];
      arr.push(c.id);
      childrenOf.set(key, arr);
    });
    const expandCatIds = (rootIds: string[], includeSubs: boolean): Set<string> => {
      const result = new Set<string>(rootIds);
      if (!includeSubs) return result;
      const stack = [...rootIds];
      while (stack.length) {
        const id = stack.pop()!;
        (childrenOf.get(id) ?? []).forEach((childId) => {
          if (!result.has(childId)) { result.add(childId); stack.push(childId); }
        });
      }
      return result;
    };
    return (deck: { id: string; categoryIds?: string[]; includeSubCategories?: boolean }) => {
      const linkedIds = cardDecksByDeck.get(deck.id) ?? new Set<string>();
      const rootCatIds = deck.categoryIds ?? [];
      const effectiveCatIds = expandCatIds(rootCatIds, deck.includeSubCategories !== false);
      const catNames = new Set(
        [...effectiveCatIds].map((id) => catNameById.get(id)).filter(Boolean) as string[]
      );
      return state.cards.filter((c) =>
        c.deckId === deck.id ||
        linkedIds.has(c.id) ||
        (catNames.size > 0 && c.tags?.some((t) => t.startsWith("cat:") && catNames.has(t.slice(4))))
      );
    };
  }, [state.cards, state.cardDecks, state.categories]);

  const deckStatsById = useMemo(() => {
    const stats = new Map<string, { size: number; due: number }>();
    state.decks.forEach((deck) => {
      const cards = getCardsForDeck(deck);
      let due = 0;
      for (const card of cards) {
        if (isDue(card)) due += 1;
      }
      stats.set(deck.id, { size: cards.length, due });
    });
    return stats;
  }, [state.decks, getCardsForDeck]);

  const startDeckPractice = (deckId: string) => {
    const deck = state.decks.find((candidate) => candidate.id === deckId);
    if (!deck) return;

    const cards = getCardsForDeck(deck);
    setActiveDeckId(deckId);

    if (cards.length === 0) {
      toast({
        title: "אין שאלות לתרגול",
        description: `במערכת "${deck.name}" עדיין אין שאלות.`,
      });
      return;
    }

    setSession({
      deckId,
      mode: "practice",
      cardIds: cards.map((card) => card.id),
    });
  };

  // Sorted decks for display
  const sortedDecks = useMemo(() => {
    if (deckSort === "manual") return state.decks;
    const arr = [...state.decks];
    arr.sort((a, b) => {
      let cmp = 0;
      if (deckSort === "name") cmp = (a.name || "").localeCompare(b.name || "", "he");
      else if (deckSort === "size") {
        cmp = (deckStatsById.get(a.id)?.size ?? 0) - (deckStatsById.get(b.id)?.size ?? 0);
      } else if (deckSort === "due") {
        cmp = (deckStatsById.get(a.id)?.due ?? 0) - (deckStatsById.get(b.id)?.due ?? 0);
      } else if (deckSort === "recent") {
        cmp = ((a as { createdAt?: number }).createdAt ?? 0) - ((b as { createdAt?: number }).createdAt ?? 0);
      }
      return deckSortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [state.decks, deckStatsById, deckSort, deckSortDir]);
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
    if (typeFilter.size > 0) {
      result = result.filter((c) => typeFilter.has(c.type));
    }
    result = applyDateFilter(result, dateFilter);
    return result;
  }, [allDeckCards, categoryFilter, typeFilter, dateFilter]);
  const dueCount = useMemo(() => {
    let total = 0;
    for (const card of deckCards) {
      if (isDue(card)) total += 1;
    }
    return total;
  }, [deckCards]);
  const wrongCardIds = useMemo(() => {
    if (!activeDeckId || allDeckCards.length === 0) return [];
    const deckCardIds = new Set(allDeckCards.map((card) => card.id));
    const latestByCard = new Map<string, ReviewLog>();

    for (const log of state.logs ?? []) {
      if (log.deckId !== activeDeckId || !deckCardIds.has(log.cardId)) continue;
      const previous = latestByCard.get(log.cardId);
      if (!previous || log.at > previous.at) latestByCard.set(log.cardId, log);
    }

    return allDeckCards
      .filter((card) => latestByCard.get(card.id)?.correct === false)
      .map((card) => card.id);
  }, [activeDeckId, allDeckCards, state.logs]);
  const isDateFilterActive = dateFilter.from !== null || dateFilter.to !== null;
  const isTypeFilterActive = typeFilter.size > 0;

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

  // Guest role previews may hide all cards widgets via saved layout.
  // Ensure core widgets stay visible so systems/questions are actually accessible.
  useEffect(() => {
    if (!isGuest) return;
    const full = state.widgetLayout ?? {};
    const cardsLayout = full.cards;
    if (!cardsLayout || cardsLayout.length === 0) return;

    const requiredIds = ["cards-decks", "cards-list", "cards-categories"] as const;
    let changed = false;
    const next = [...cardsLayout];

    requiredIds.forEach((id) => {
      const idx = next.findIndex((w) => w.id === id);
      if (idx === -1) {
        next.push({ id, visible: true, size: "full", order: next.length });
        changed = true;
        return;
      }
      if (!next[idx].visible) {
        next[idx] = { ...next[idx], visible: true };
        changed = true;
      }
    });

    if (!changed) return;
    const normalized = next.map((w, i) => ({ ...w, order: i }));
    setWidgetLayout({ ...full, cards: normalized });
  }, [isGuest, state.widgetLayout, setWidgetLayout]);

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

  const [cardSearch, setCardSearch] = useState("");

  const searchedDeckCards = useMemo(() => {
    if (!cardSearch.trim()) return sortedDeckCards;
    const q = cardSearch.trim().toLowerCase();
    return sortedDeckCards.filter((c) => c.question.toLowerCase().includes(q));
  }, [sortedDeckCards, cardSearch]);

  useEffect(() => {
    setVisibleCardsCount(60);
  }, [activeDeckId, categoryFilter, typeFilter, dateFilter, cardSort, cardSortDir, cardSearch]);

  const visibleDeckCards = useMemo(
    () => searchedDeckCards.slice(0, visibleCardsCount),
    [searchedDeckCards, visibleCardsCount],
  );

  // ── Multi-select for cards ────────────────────────────────────────────
  const cardMs = useMultiSelect(searchedDeckCards, (c) => c.id);
  const [confirmBulkDeleteCards, setConfirmBulkDeleteCards] = useState(false);

  const bulkDeleteCards = () => {
    const ids = Array.from(cardMs.selected);
    for (const id of ids) deleteCard(id);
    toast({ title: `${ids.length} שאלות נמחקו` });
    cardMs.clear();
    setConfirmBulkDeleteCards(false);
  };

  const bulkDuplicateCards = () => {
    const items = cardMs.selectedItems;
    for (const c of items) duplicateCard(c.id);
    toast({ title: `${items.length} שאלות הועתקו` });
    cardMs.clear();
  };

  const bulkExportCards = () => {
    const items = cardMs.selectedItems;
    if (!items.length) return;
    const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), cards: items }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cards_export_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `${items.length} שאלות יוצאו` });
  };

  if (session) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden md:static md:inset-auto md:z-auto md:flex-none md:overflow-visible">
        {/* Mobile-only sticky header with exit button */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gold/30 bg-background sticky top-0 z-10 md:hidden" dir="rtl">
          <span className="font-semibold text-navy text-sm">
            {session.mode === "srs" ? "חזרה ממוקדת" : "תרגול חופשי"}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setSession(null)}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        {/* Session content */}
        <div className="flex-1 overflow-y-auto p-3 md:p-0 md:overflow-visible md:space-y-4">
          <StudySession
            deckId={session.deckId}
            mode={session.mode}
            cardIds={session.cardIds}
            onExit={() => setSession(null)}
          />
        </div>
      </div>
    );
  }

  const openNewCard = () => { setEditingCard(null); setPrefillCategoryName(null); setEditorOpen(true); };
  const openNewCardForCategory = (catName: string) => {
    if (IS_DEV) console.info("[trace][cards-manager] openNewCardForCategory called", { catName });
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
        excludedWidgetIds={DECK_CREATION_EXCLUDED_WIDGETS}
        widgetMap={{
          "cards-decks": (
            <Card className="gold-frame p-3 sm:p-5 space-y-3 sm:space-y-4 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="gold-icon-circle"><Library className="h-4 w-4" /></span>
                  <h3 className="font-display text-base sm:text-lg font-semibold truncate">מבחנים</h3>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:inline">{state.decks.length} מבחנים</span>
                  <DeckCreationGuide />
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
                      <DropdownMenuLabel className="text-right">סיווג מבחנים</DropdownMenuLabel>
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
                      <DropdownMenuLabel className="text-right">תצוגת מבחנים</DropdownMenuLabel>
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
                <DeckCreateLauncher onCreated={(id) => { setActiveDeckId(id); }} />
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
                  <Button
                    disabled={wrongCardIds.length === 0}
                    onClick={() => {
                      if (!activeDeck) return;
                      setSession({
                        deckId: activeDeck.id,
                        mode: "practice",
                        cardIds: wrongCardIds,
                      });
                    }}
                    variant="outline"
                    className="border-2 border-red-300 rounded-xl text-red-700 disabled:text-muted-foreground"
                    title={wrongCardIds.length > 0 ? "תרגל רק שאלות שהתשובה האחרונה עליהן הייתה שגויה" : "הכפתור יופעל לאחר שתענה תשובה שגויה במבחן הזה"}
                  >
                    <CircleX className="h-4 w-4" /> תרגול טעויות ({wrongCardIds.length})
                  </Button>
                </div>
              )}
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
                  const deckStats = deckStatsById.get(deck.id) ?? { size: 0, due: 0 };
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
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              startDeckPractice(deck.id);
                            }}
                            title={`התחל תרגול: ${deck.name}`}
                            aria-label={`התחל תרגול: ${deck.name}`}
                            className={cn(
                              "group/practice flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-gold shadow-sm transition-all hover:scale-105 hover:bg-gold hover:text-navy hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2",
                              isActive ? "bg-card/10 text-gold" : "bg-gold/10 text-navy",
                            )}
                          >
                            <BookOpen className="h-6 w-6 group-hover/practice:hidden group-focus-visible/practice:hidden" />
                            <Play className="hidden h-6 w-6 fill-current group-hover/practice:block group-focus-visible/practice:block" />
                          </button>
                          <div className="font-medium text-xs leading-tight line-clamp-2 min-h-[2.4em] flex items-center justify-center break-words w-full">
                            {deck.name}
                          </div>
                          <div className={cn("text-[10px]", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            {deckStats.size} · {deckStats.due} לחזרה
                          </div>
                          {(state.deckCategories?.[deck.id] ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1 justify-center">
                              {(state.deckCategories?.[deck.id] ?? []).slice(0, 3).map((cn2) => (
                                <Badge
                                  key={cn2}
                                  variant="outline"
                                  className={cn(
                                    "text-[9px] px-1 py-0",
                                    isActive
                                      ? "bg-transparent text-primary-foreground border-gold/50"
                                      : "bg-transparent text-navy border-navy/45",
                                  )}
                                >
                                  {cn2}
                                </Badge>
                              ))}
                              {(state.deckCategories?.[deck.id] ?? []).length > 3 && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[9px] px-1 py-0",
                                    isActive
                                      ? "bg-transparent text-primary-foreground border-gold/50"
                                      : "bg-transparent text-navy border-navy/45",
                                  )}
                                >
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
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              startDeckPractice(deck.id);
                            }}
                            title={`התחל תרגול: ${deck.name}`}
                            aria-label={`התחל תרגול: ${deck.name}`}
                            className={cn(
                              "group/practice flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold transition-all hover:bg-gold hover:text-navy",
                              isActive ? "text-gold" : "bg-gold/10 text-navy",
                            )}
                          >
                            <BookOpen className="h-3.5 w-3.5 group-hover/practice:hidden" />
                            <Play className="hidden h-3.5 w-3.5 fill-current group-hover/practice:block" />
                          </button>
                          <span className="text-xs font-medium truncate flex-1 text-right">{deck.name}</span>
                          <span className={cn("text-[10px] shrink-0", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            {deckStats.size}/{deckStats.due}
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
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            startDeckPractice(deck.id);
                          }}
                          title={`התחל תרגול: ${deck.name}`}
                          aria-label={`התחל תרגול: ${deck.name}`}
                          className={cn(
                            "group/practice flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-gold transition-all hover:scale-105 hover:bg-gold hover:text-navy",
                            isActive ? "bg-card/10 text-gold" : "bg-gold/10 text-navy",
                          )}
                        >
                          <BookOpen className="h-4 w-4 group-hover/practice:hidden" />
                          <Play className="hidden h-4 w-4 fill-current group-hover/practice:block" />
                        </button>
                        <div className="text-right min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{deck.name}</div>
                          <div className={cn("text-xs truncate", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            {deckStats.size} כרטיסים · {deckStats.due} לחזרה
                          </div>
                          {(state.deckCategories?.[deck.id] ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {(state.deckCategories?.[deck.id] ?? []).slice(0, 2).map((catLabel) => (
                                <Badge
                                  key={catLabel}
                                  variant="outline"
                                  className={cn(
                                    "text-[9px] px-1 py-0",
                                    isActive
                                      ? "bg-transparent text-primary-foreground border-gold/50"
                                      : "bg-transparent text-navy border-navy/45",
                                  )}
                                >
                                  {catLabel}
                                </Badge>
                              ))}
                              {(state.deckCategories?.[deck.id] ?? []).length > 2 && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[9px] px-1 py-0",
                                    isActive
                                      ? "bg-transparent text-primary-foreground border-gold/50"
                                      : "bg-transparent text-navy border-navy/45",
                                  )}
                                >
                                  +{(state.deckCategories?.[deck.id] ?? []).length - 2}
                                </Badge>
                              )}
                            </div>
                          )}
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
                  <p className="text-sm text-muted-foreground text-center py-6 col-span-full">אין מבחנים עדיין</p>
                )}
              </div>
            </Card>
          ),
          "cards-pinned": (
            <PinnedCategoriesWidget
              onSelectCategory={(name) => {
                setCategoryFilter(name);
                setCategoryRevealRequest((previous) => ({
                  name,
                  requestId: (previous?.requestId ?? 0) + 1,
                }));
              }}
              onEditCard={(card) => openEditCard(card)}
            />
          ),
          "cards-categories": (
            <CategoryManager
              selectedCategory={categoryFilter}
              onSelectCategory={setCategoryFilter}
              revealCategory={categoryRevealRequest}
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
                <div className="text-center py-8 text-muted-foreground">בחר מבחן כדי להתחיל</div>
              ) : (
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="text-right min-w-0 flex-1">
                    <h3 className="font-display text-base sm:text-xl font-bold truncate">חזרות: {activeDeck.name}</h3>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {deckCards.length} שאלות
                      {categoryFilter ? ` · קטגוריה: ${categoryFilter}` : ""}
                      {isDateFilterActive ? " · מסונן לפי תאריך" : ""}
                      {isTypeFilterActive ? ` · סוג: ${Array.from(typeFilter).map((t) => TYPE_LABEL[t] ?? t).join(", ")}` : ""}
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
              {activeDeck && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-right">סוג שאלה:</span>
                    {isTypeFilterActive && (
                      <button
                        onClick={() => setTypeFilter(new Set())}
                        className="text-[10px] text-muted-foreground hover:text-foreground underline"
                      >
                        נקה
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {(["flashcard", "multiple", "boolean", "combo"] as const).map((t) => {
                      const active = typeFilter.has(t);
                      const count = allDeckCards.filter((c) => c.type === t).length;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            setTypeFilter((prev) => {
                              const next = new Set(prev);
                              if (next.has(t)) next.delete(t); else next.add(t);
                              return next;
                            });
                          }}
                          disabled={count === 0 && !active}
                          className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                            active
                              ? "bg-gold text-navy border-gold font-semibold"
                              : "bg-card border-gold/30 text-foreground hover:border-gold disabled:opacity-40 disabled:cursor-not-allowed"
                          }`}
                        >
                          {TYPE_LABEL[t]} <span className="opacity-70">({count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground text-right">💡 גרור רגיל = העברה · גרירה עם Ctrl = העתקה (שומר גם במיקום המקורי)</p>
            </Card>
          ),
          "cards-list": (
            <Card className="gold-frame p-3 sm:p-5 space-y-3 min-w-0">
              {!activeDeck ? (
                <div className="text-center py-12 text-muted-foreground">בחר מערכת כדי להתחיל</div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto snap-list-y">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-gold/20">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground shrink-0">
                        {cardSearch.trim() ? `${searchedDeckCards.length}/${sortedDeckCards.length}` : sortedDeckCards.length} שאלות
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={cardMs.toggleAll}
                        className="h-6 px-1.5 text-xs gap-1 text-muted-foreground hover:text-gold shrink-0"
                      >
                        {cardMs.allSelected
                          ? <CheckSquare className="h-3.5 w-3.5" />
                          : <Square className="h-3.5 w-3.5" />}
                        בחר הכל
                      </Button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="relative">
                        <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                        <Input
                          value={cardSearch}
                          onChange={(e) => setCardSearch(e.target.value)}
                          placeholder="חיפוש..."
                          className="h-7 w-28 text-xs pr-6 pl-2"
                        />
                      </div>
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
                  </div>

                  {cardMs.count > 0 && <MultiSelectToolbar
                    count={cardMs.count}
                    total={cardMs.total}
                    allSelected={cardMs.allSelected}
                    onToggleAll={cardMs.toggleAll}
                    onClear={cardMs.clear}
                    actions={[
                      { icon: Copy, label: "שכפל", onClick: bulkDuplicateCards },
                      { icon: Download, label: "ייצא", onClick: bulkExportCards },
                      { icon: Trash2, label: "מחק", onClick: () => setConfirmBulkDeleteCards(true), variant: "destructive" },
                    ]}
                  />}

                  {visibleDeckCards.map((c) => {
                    const categoryTags = c.tags.filter((t) => t.startsWith("cat:")).map((t) => t.slice(4));
                    const shasChips = buildShasHierarchyChips(c);
                    const categoryChips = shasChips ?? buildCanonicalCategoryChips(categoryTags, state.categories ?? []);
                    const plainTags = c.tags.filter((t) => !t.startsWith("cat:"));
                    const cardDeckCount = (state.cardDecks ?? []).filter((l) => l.cardId === c.id).length || 1;
                    const isSel = cardMs.isSelected(c.id);
                    return (
                      <DraggableCardRow key={c.id} cardId={c.id}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={(e) => { e.stopPropagation(); cardMs.toggle(c.id); }}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 h-4 w-4 rounded border-gold/40 cursor-pointer accent-gold shrink-0"
                          aria-label="בחר שאלה"
                        />
                        <div className="flex-1 text-right cursor-pointer" onClick={() => setHistoryCard(c)}>
                          <div className="flex items-center gap-1 justify-end mb-1 flex-wrap">
                            {cardDeckCount > 1 && <Badge className="text-[10px] bg-gold text-navy">📚 {cardDeckCount} מערכות</Badge>}
                            {categoryChips.map((t) => <Badge key={t} className="text-[10px] bg-navy text-primary-foreground">📁 {t}</Badge>)}
                            {plainTags.map((t) =>
                              t === "source:yeshiva" ? (
                                <span
                                  key={t}
                                  title="yeshiva.org.il"
                                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                                  style={{
                                    color: "#60b4ff",
                                    boxShadow: "0 0 5px 1px #3b9eff66",
                                    border: "1px solid #3b9eff88",
                                    background: "transparent",
                                  }}
                                >
                                  y
                                </span>
                              ) : t === "source:shemesh" ? (
                                <span
                                  key={t}
                                  title="שמש בגבעון"
                                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                                  style={{
                                    color: "#4ade80",
                                    boxShadow: "0 0 5px 1px #22c55e66",
                                    border: "1px solid #22c55e88",
                                    background: "transparent",
                                  }}
                                >
                                  s
                                </span>
                              ) : t === "source:ai" ? (
                                <span
                                  key={t}
                                  title="נוצר על ידי AI"
                                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                                  style={{
                                    color: "#f87171",
                                    boxShadow: "0 0 5px 1px #ef444466",
                                    border: "1px solid #ef444488",
                                    background: "transparent",
                                  }}
                                >
                                  a
                                </span>
                              ) : t === "source:custom" ? (
                                <span
                                  key={t}
                                  title="כרטיס מותאם אישית"
                                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                                  style={{
                                    color: "#fde047",
                                    boxShadow: "0 0 5px 1px #eab30866",
                                    border: "1px solid #eab30888",
                                    background: "transparent",
                                  }}
                                >
                                  c
                                </span>
                              ) : t.startsWith("ref:") ? (
                                <Badge key={t} variant="secondary" className="text-xs">{formatRefTagLabel(t)}</Badge>
                              ) : (
                                <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                              )
                            )}
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
                  {searchedDeckCards.length > visibleDeckCards.length && (
                    <div className="flex items-center justify-center pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-gold/40"
                        onClick={() => setVisibleCardsCount((n) => n + 60)}
                      >
                        טען עוד ({searchedDeckCards.length - visibleDeckCards.length} נותרו)
                      </Button>
                    </div>
                  )}
                  {deckCards.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      {categoryFilter
                        ? `אין שאלות בקטגוריה "${categoryFilter}"`
                        : (activeDeck && (!activeDeck.categoryIds || activeDeck.categoryIds.length === 0))
                          ? 'מערכת זו אינה משויכת לקטגוריה. לחץ על עריכת מערכת כדי לשייך קטגוריה.'
                          : 'אין שאלות במערכת זו. הוסף שאלה ראשונה!'}
                    </p>
                  )}
                </div>
              )}
            </Card>
          ),
        }}
      />

      {/* Editor panel — floating draggable/resizable */}
      <DraggableResizablePanel
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditingCard(null); setPrefillCategoryName(null); }}
        title={editingCard
          ? "עריכת שאלה"
          : `שאלה חדשה${prefillCategoryName ? ` · 📁 ${prefillCategoryName}` : ""}`}
        titleExtra={!editingCard && activeDeck ? (
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            title="ייבוא מרוכז"
            aria-label="ייבוא מרוכז"
            className="flex items-center justify-center h-8 w-8 rounded-full border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
          >
            <Upload className="h-4 w-4" />
          </button>
        ) : undefined}
      >
        <CardEditor
          key={editingCard?.id ?? `new-${prefillCategoryName ?? "x"}`}
          deckId={activeDeck?.id ?? null}
          editCard={editingCard ?? undefined}
          prefillCategories={prefillCategoryName ? [prefillCategoryName] : undefined}
          onClose={() => { setEditorOpen(false); setEditingCard(null); setPrefillCategoryName(null); }}
        />
      </DraggableResizablePanel>

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

      <AlertDialog open={confirmBulkDeleteCards} onOpenChange={setConfirmBulkDeleteCards}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת {cardMs.count} שאלות?</AlertDialogTitle>
            <AlertDialogDescription>פעולה זו תמחק לצמיתות את כל השאלות הנבחרות.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={bulkDeleteCards} className="bg-destructive hover:bg-destructive/90">
              מחק {cardMs.count}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

const CardsManagerMemo = memo(CardsManager);
export { CardsManagerMemo as CardsManager };
