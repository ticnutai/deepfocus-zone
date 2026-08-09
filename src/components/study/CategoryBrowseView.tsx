/**
 * CategoryBrowseView — "שורות + שאלות" layout
 *
 * Top section: a row of clickable category chips for the current drill-down level.
 * Clicking a chip enters that category and shows its children.
 * A breadcrumb bar lets you navigate back up.
 *
 * Bottom section: a bordered frame with virtual + lazy scroll showing all cards
 * that belong to the subtree of the currently selected root, in DFS/tree order
 * (categories ordered by sortOrder then createdAt).
 */

import { useMemo, useState, useRef, useCallback, useEffect, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Folder, FolderOpen, Home, ChevronLeft, ChevronRight, FileText, Pencil, Trash2, Plus,
  BookOpen, LayoutList, Edit3, Copy, Download, Star, Layers, FolderPlus,
  ArrowRightLeft, Sparkles, Check, X, Clipboard,
} from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
  ContextMenuTrigger, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { TextPromptDialog } from "./TextPromptDialog";
// (יצירת דפים/עמודים אוטומטית הוסרה — משתמשים בתבנית ש"ס במקום)
import { isUncategorized } from "@/lib/study/uncategorized";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudy } from "@/lib/study/store";
import { cn } from "@/lib/utils";
import { displayCategoryName } from "@/lib/study/shasGen";
import { buildCategoryIndex, getDisplayCategoryLabel } from "@/lib/study/categoryDisplay";
import type { Category, Card as StudyCard } from "@/lib/study/types";
import { useConfirm } from "@/hooks/useConfirm";

interface Props {
  selectedCategory: string | null;
  onSelectCategory: (name: string | null) => void;
  onAddCardToCategory: (catName: string) => void;
  onEditCard?: (card: StudyCard) => void;
}

/* ─── favorites helpers ────────────────────────────────────────── */
const BROWSE_PREFS_KEY = "category-explorer-prefs-v2";
function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(BROWSE_PREFS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as { favorites?: string[] }).favorites ?? [];
  } catch { return []; }
}
function saveFavorites(favs: string[]) {
  try {
    const raw = localStorage.getItem(BROWSE_PREFS_KEY);
    const prefs = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(BROWSE_PREFS_KEY, JSON.stringify({ ...prefs, favorites: favs }));
  } catch { /* ignore */ }
}

/* ─── inline rename input ──────────────────────────────────────── */
function ChipRenameInput({ cat, onSubmit }: { cat: Category; onSubmit: (name: string) => void }) {
  const [val, setVal] = useState(cat.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <Input
      ref={ref}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onSubmit(val);
        if (e.key === "Escape") onSubmit(cat.name);
      }}
      onBlur={() => onSubmit(val)}
      className="h-5 px-1 py-0 text-sm font-medium w-28 text-right bg-transparent border-none shadow-none focus-visible:ring-0"
    />
  );
}

/* ─── chip menu props interface ────────────────────────────────── */
interface ChipMenuProps {
  onEnterFolder: (cat: Category) => void;
  onAddQuestion: (catName: string) => void;
  onAddSubCat: (cat: Category) => void;
  onDelete: (cat: Category) => void;
  onStartRename: (id: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onAddToDeck: (cat: Category, deckId: string) => void;
  onCreateDeckFrom: (cat: Category) => void;
  onMoveTo: (id: string, parentId: string | null) => void;
  isFavorite: (id: string) => boolean;
  decks: { id: string; name: string; categoryIds?: string[] | null }[];
  allCategories: Category[];
}

/* ─── helpers ──────────────────────────────────────────────────── */

/** Sorted children of a given parent */
function sortedChildren(categories: Category[], parentId: string | null): Category[] {
  return categories
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt);
}

/** Card type label */
const TYPE_LABEL: Record<string, string> = {
  flashcard: "כרטיסיה",
  multiple: "אמריקאית",
  boolean: "נכון/לא נכון",
  combo: "משולבת",
};

/* ─── sub-components ────────────────────────────────────────────── */

/** A single card row inside the virtual list */
const CardRow = memo(function CardRow({
  card,
  catLabel,
  onEdit,
  onDelete,
}: {
  card: StudyCard;
  catLabel: string;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className="group flex items-start gap-3 rounded-xl border-2 border-gold/25 bg-card px-4 py-3 hover:border-gold/55 hover:shadow-sm transition-all cursor-pointer"
      onClick={onEdit}
    >
      <FileText className="h-4 w-4 text-gold/70 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 text-right">
        <p className="text-sm font-medium leading-snug line-clamp-2">{card.question}</p>
        <div className="flex items-center justify-end gap-2 mt-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground">{catLabel}</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-gold/30 text-muted-foreground">
            {TYPE_LABEL[card.type] ?? card.type}
          </Badge>
          {(card.stats?.totalReviews ?? 0) > 0 && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 border-emerald-500/40 text-emerald-600">
              {Math.round((card.stats.correct / card.stats.totalReviews) * 100)}%
            </Badge>
          )}
        </div>
      </div>
      {/* action buttons — visible on hover */}
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 rounded-lg bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground"
            title="ערוך"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 rounded-lg bg-secondary/80 hover:bg-red-500 text-muted-foreground hover:text-white"
            title="מחק"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
});

/** The category chip row */
function CategoryChips({
  categories,
  activeId,
  counts,
  onSelect,
  menu,
  renamingId,
  onRenameSubmit,
  cardsFullyLoaded = true,
  multiSelected,
  onMultiSelect,
}: {
  categories: Category[];
  activeId: string | null;
  counts: Map<string, number>;
  onSelect: (cat: Category) => void;
  menu?: ChipMenuProps;
  renamingId?: string | null;
  onRenameSubmit?: (cat: Category, name: string) => void;
  cardsFullyLoaded?: boolean;
  multiSelected?: Set<string>;
  onMultiSelect?: (id: string, shiftKey: boolean) => void;
}) {
  if (categories.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-3">אין תת-קטגוריות</p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 py-2" dir="rtl">
      {categories.map((cat) => {
        const isActive = cat.id === activeId;
        const count = counts.get(cat.name) ?? 0;
        const isRenaming = renamingId === cat.id;
        const locked = isUncategorized(cat);

        const isChipSelected = multiSelected?.has(cat.id) ?? false;

        const chipButton = (
          <button
            type="button"
            onClick={() => !isRenaming && onSelect(cat)}
            className={cn(
              "group/chip relative inline-flex items-center gap-2 rounded-xl border-2 px-3 py-1.5 text-sm font-medium transition-all select-none",
              isChipSelected
                ? "border-gold bg-gold/10 shadow-sm"
                : isActive
                ? "border-gold bg-gradient-navy text-primary-foreground shadow-sm"
                : "border-gold/40 bg-card hover:border-gold/70 hover:bg-secondary",
            )}
          >
            {/* Multi-select checkbox — visible on hover or when selected */}
            {onMultiSelect && (
              <span
                role="checkbox"
                aria-checked={isChipSelected}
                onClick={(e) => { e.stopPropagation(); onMultiSelect(cat.id, e.shiftKey); }}
                className={cn(
                  "absolute -top-1.5 -right-1.5 h-4 w-4 rounded border-2 flex items-center justify-center z-10 transition-all cursor-pointer",
                  "opacity-0 group-hover/chip:opacity-100",
                  isChipSelected ? "opacity-100 border-gold bg-gold text-white" : "border-gold/50 bg-card/90",
                )}
                title={isChipSelected ? "בטל בחירה" : "בחר"}
              >
                {isChipSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
              </span>
            )}
            {isActive
              ? <FolderOpen className="h-4 w-4 text-gold shrink-0" />
              : <Folder className="h-4 w-4 text-gold/70 shrink-0" />}
            {isRenaming
              ? <ChipRenameInput cat={cat} onSubmit={(name) => onRenameSubmit?.(cat, name)} />
              : <span>{displayCategoryName(cat.name)}</span>}
            {count > 0 && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] h-4 px-1.5 font-bold",
                  isActive ? "border-gold text-gold bg-navy/30" : "border-gold/40 text-gold",
                )}
              >
                {count}
              </Badge>
            )}
            {/* Phase 2 backfill in progress: real count may still grow, show skeleton instead of "0". */}
            {count === 0 && !cardsFullyLoaded && (
              <Skeleton className="h-4 w-7 rounded-md" />
            )}
          </button>
        );

        if (!menu) {
          return <span key={cat.id}>{chipButton}</span>;
        }

        return (
          <ContextMenu key={cat.id}>
            <ContextMenuTrigger asChild>{chipButton}</ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              <ContextMenuItem onClick={() => menu.onEnterFolder(cat)}>
                <FolderOpen className="h-4 w-4 ml-2" /> פתח
              </ContextMenuItem>
              <ContextMenuItem onClick={() => menu.onAddQuestion(cat.name)}>
                <Plus className="h-4 w-4 ml-2" /> שאלה חדשה
              </ContextMenuItem>
              <ContextMenuItem onClick={() => menu.onAddSubCat(cat)} disabled={locked}>
                <FolderPlus className="h-4 w-4 ml-2" /> תת-קטגוריה
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => menu.onToggleFavorite(cat.id)}>
                <Star className={cn("h-4 w-4 ml-2", menu.isFavorite(cat.id) && "fill-gold text-gold")} />
                {menu.isFavorite(cat.id) ? "הסר ממועדפים" : "הוסף למועדפים"}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => menu.onStartRename(cat.id)} disabled={locked}>
                <Edit3 className="h-4 w-4 ml-2" /> שנה שם <span className="mr-auto text-[10px] text-muted-foreground">F2</span>
              </ContextMenuItem>
              <ContextMenuItem onClick={() => menu.onDuplicate(cat.id)} disabled={locked}>
                <Copy className="h-4 w-4 ml-2" /> שכפל
              </ContextMenuItem>
              <ContextMenuItem onClick={() => menu.onExport(cat.id)}>
                <Download className="h-4 w-4 ml-2" /> ייצא ענף
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Layers className="h-4 w-4 ml-2 text-gold" /> הוסף למערכת
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                  <ContextMenuItem onClick={() => menu.onCreateDeckFrom(cat)}>
                    <Plus className="h-4 w-4 ml-2" /> צור מערכת חדשה...
                  </ContextMenuItem>
                  {menu.decks.length > 0 && <ContextMenuSeparator />}
                  {menu.decks.map((d) => {
                    const already = (d.categoryIds ?? []).includes(cat.id);
                    return (
                      <ContextMenuItem key={d.id} onClick={() => menu.onAddToDeck(cat, d.id)} disabled={already}>
                        <Layers className={cn("h-4 w-4 ml-2", already ? "text-muted-foreground" : "text-gold")} />
                        {d.name} {already && <span className="mr-auto text-[10px] text-muted-foreground">כבר במערכת</span>}
                      </ContextMenuItem>
                    );
                  })}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSub>
                <ContextMenuSubTrigger disabled={locked}>
                  <ArrowRightLeft className="h-4 w-4 ml-2" /> העבר אל...
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                  <ContextMenuItem onClick={() => menu.onMoveTo(cat.id, null)}>
                    <Home className="h-4 w-4 ml-2" /> רמת הבסיס
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  {menu.allCategories.filter((c) => c.id !== cat.id).map((c) => (
                    <ContextMenuItem key={c.id} onClick={() => menu.onMoveTo(cat.id, c.id)}>
                      <Folder className="h-4 w-4 ml-2 text-gold" /> {displayCategoryName(c.name)}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                disabled={locked}
                onClick={() => { if (!locked) menu.onDelete(cat); }}
              >
                <Trash2 className="h-4 w-4 ml-2" /> מחק <span className="mr-auto text-[10px] text-muted-foreground">Del</span>
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}

/* ─── main component ─────────────────────────────────────────────── */

export function CategoryBrowseView({ selectedCategory, onSelectCategory, onAddCardToCategory, onEditCard }: Props) {
  const {
    state, deleteCard, loadCategoryChildren,
    addCategory, addCategoriesBulk, deleteCategory, renameCategory,
    duplicateCategory, moveCategory, addDeck, updateDeckCategoryIds,
    getHydrationSnapshot,
  } = useStudy();
  const { cardsFullyLoaded } = getHydrationSnapshot();
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();

  /* === Favorites === */
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const set = new Set(prev);
      if (set.has(id)) set.delete(id); else set.add(id);
      const next = [...set];
      saveFavorites(next);
      return next;
    });
  }, []);

  /* === Rename === */
  const [renamingId, setRenamingId] = useState<string | null>(null);

  /* === Text prompt dialog (replaces window.prompt) === */
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptTitle, setPromptTitle] = useState("");
  const [promptDefault, setPromptDefault] = useState("");
  const [promptCallback, setPromptCallback] = useState<((val: string) => void) | null>(null);
  const showPrompt = (title: string, defaultValue: string, cb: (val: string) => void) => {
    setPromptTitle(title);
    setPromptDefault(defaultValue);
    setPromptCallback(() => cb);
    setPromptOpen(true);
  };
  const handleRenameSubmit = useCallback((cat: Category, name: string) => {
    if (name.trim() && name !== cat.name) renameCategory(cat.id, name);
    setRenamingId(null);
  }, [renameCategory]);

  const categories = useMemo(
    () => [...(state.categories ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt,
    ),
    [state.categories],
  );
  const categoriesById = useMemo(() => buildCategoryIndex(categories), [categories]);
  const categoriesByName = useMemo(
    () => new Map(categories.map((c) => [c.name, c])),
    [categories],
  );
  const categoryLabel = useCallback(
    (cat: Category) => getDisplayCategoryLabel(cat, categoriesById),
    [categoriesById],
  );

  // Navigation path: array of category IDs (from root level to current folder)
  const [path, setPath] = useState<string[]>([]);
  // Active chip: the currently "selected" category chip within the current level
  const [activeCatId, setActiveCatId] = useState<string | null>(null);

  // Current parent = last item in path
  const currentParentId = path.length > 0 ? path[path.length - 1] : null;

  // Children at current level
  const currentLevelCats = useMemo(
    () => sortedChildren(categories, currentParentId),
    [categories, currentParentId],
  );

  // Load children when path changes
  useEffect(() => {
    void loadCategoryChildren(currentParentId, { reason: "user", prefetch: false });
  }, [currentParentId, loadCategoryChildren]);

  // Breadcrumb categories
  const breadcrumbs = useMemo(() => {
    return path.map((id) => categoriesById.get(id)).filter(Boolean) as Category[];
  }, [path, categoriesById]);

  const feedCategoryName = useMemo(() => {
    if (selectedCategory) return selectedCategory;
    if (!currentParentId) return null;
    return categoriesById.get(currentParentId)?.name ?? null;
  }, [selectedCategory, currentParentId, categoriesById]);

  // Build a name→cards map
  const cardsByName = useMemo(() => {
    const m = new Map<string, StudyCard[]>();
    state.cards.forEach((c) => {
      c.tags.forEach((t) => {
        if (t.startsWith("cat:")) {
          const name = t.slice(4);
          const arr = m.get(name) ?? [];
          arr.push(c);
          m.set(name, arr);
        }
      });
    });
    return m;
  }, [state.cards]);

  // All cards in direct classification category only
  const allOrderedCards = useMemo(() => {
    if (!feedCategoryName) return [];
    return (cardsByName.get(feedCategoryName) ?? []).map((card) => ({ card, catName: feedCategoryName }));
  }, [cardsByName, feedCategoryName]);

  // Counts map for chip badges (subtree counts)
  // Uses pre-built cardsByName so we iterate names not all cards (O(cats×subtree) vs O(cats×cards×tags))
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    const childrenByParent = new Map<string, Category[]>();
    categories.forEach((c) => {
      if (!c.parentId) return;
      const prev = childrenByParent.get(c.parentId) ?? [];
      prev.push(c);
      childrenByParent.set(c.parentId, prev);
    });
    const subtreeMemo = new Map<string, Set<string>>();
    function subtreeNames(cat: Category): Set<string> {
      const cached = subtreeMemo.get(cat.id);
      if (cached) return cached;
      const names = new Set<string>([cat.name]);
      for (const child of childrenByParent.get(cat.id) ?? []) {
        for (const n of subtreeNames(child)) names.add(n);
      }
      subtreeMemo.set(cat.id, names);
      return names;
    }
    categories.forEach((cat) => {
      const names = subtreeNames(cat);
      const seen = new Set<string>();
      for (const name of names) {
        for (const c of cardsByName.get(name) ?? []) {
          seen.add(c.id);
        }
      }
      map.set(cat.name, seen.size);
    });
    return map;
  }, [categories, cardsByName]);

  /* === Virtual scroll === */
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: allOrderedCards.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 80, // estimated row height
    overscan: 5,
  });

  /* === Export branch === */
  const exportBranch = useCallback((catId: string) => {
    const cats = state.categories ?? [];
    const collect = (pid: string): unknown => {
      const kids = cats.filter((c) => c.parentId === pid);
      return kids.map((c) => ({
        name: c.name,
        cards: state.cards.filter((card) => card.tags.includes(`cat:${c.name}`)).map((card) => ({
          question: card.question,
          type: card.type,
        })),
        children: collect(c.id),
      }));
    };
    const root = cats.find((c) => c.id === catId);
    const data = { exportedAt: new Date().toISOString(), root: root?.name ?? "root", tree: collect(catId) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `categories-${data.root}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "יצוא הושלם", description: data.root });
  }, [state.categories, state.cards, toast]);

  /* === Deck helpers === */
  const addCategoryToDeck = useCallback((cat: Category, deckId: string) => {
    const deck = state.decks.find((d) => d.id === deckId);
    if (!deck) return;
    const catIds = [...(deck.categoryIds ?? [])];
    if (!catIds.includes(cat.id)) catIds.push(cat.id);
    updateDeckCategoryIds(deckId, catIds, true);
    toast({ title: "קטגוריה נוספה למערכת", description: `"${displayCategoryName(cat.name)}" → "${deck.name}"` });
  }, [state.decks, updateDeckCategoryIds, toast]);

  const createDeckFromCategory = useCallback((cat: Category) => {
    showPrompt(`שם המערכת החדשה:`, displayCategoryName(cat.name), (name) => {
      const deck = addDeck(name, undefined, []);
      updateDeckCategoryIds(deck.id, [cat.id], true);
      toast({ title: "מערכת נוצרה", description: `"${name}"` });
    });
  }, [addDeck, updateDeckCategoryIds, toast]);

  /* === Multi-select === */
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [lastSelectedChipId, setLastSelectedChipId] = useState<string | null>(null);

  const handleChipMultiSelect = useCallback((id: string, shiftKey: boolean) => {
    if (shiftKey && lastSelectedChipId) {
      const ids = currentLevelCats.map((c) => c.id);
      const from = ids.indexOf(lastSelectedChipId);
      const to = ids.indexOf(id);
      if (from !== -1 && to !== -1) {
        setMultiSelected(new Set(ids.slice(Math.min(from, to), Math.max(from, to) + 1)));
        return;
      }
    }
    setMultiSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastSelectedChipId(id);
  }, [lastSelectedChipId, currentLevelCats]);

  // Clear selection when navigating
  useEffect(() => { setMultiSelected(new Set()); setLastSelectedChipId(null); }, [path, activeCatId]);

  // Keyboard: Escape = clear, Ctrl+A = select all visible chips
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && multiSelected.size > 0) {
        e.preventDefault();
        setMultiSelected(new Set());
      } else if ((e.ctrlKey || e.metaKey) && e.key === "a" && currentLevelCats.length > 0) {
        e.preventDefault();
        setMultiSelected(new Set(currentLevelCats.map((c) => c.id)));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multiSelected.size, currentLevelCats]);

  const selectedCats = useMemo(
    () => currentLevelCats.filter((c) => multiSelected.has(c.id)),
    [currentLevelCats, multiSelected],
  );

  const handleBulkCopyNames = useCallback(() => {
    const names = selectedCats.map((c) => displayCategoryName(c.name)).join("\n");
    navigator.clipboard.writeText(names);
    toast({ title: "הועתק", description: `${selectedCats.length} קטגוריות` });
  }, [selectedCats, toast]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedCats.length === 0) return;
    if (!await confirm(`למחוק ${selectedCats.length} קטגוריות?`)) return;
    selectedCats.forEach((c) => deleteCategory(c.id));
    setMultiSelected(new Set());
    toast({ title: "נמחקו", description: `${selectedCats.length} קטגוריות` });
  }, [selectedCats, confirm, deleteCategory, toast]);

  const handleBulkExport = useCallback(() => {
    selectedCats.forEach((c) => exportBranch(c.id));
    setMultiSelected(new Set());
  }, [selectedCats, exportBranch]);

  /* === Navigation handlers === */
  const enterFolder = useCallback((cat: Category) => {
    setPath((prev) => [...prev, cat.id]);
    setActiveCatId(null);
    onSelectCategory(cat.name);
  }, [onSelectCategory]);

  const navigateToIndex = useCallback((idx: number) => {
    setPath((prev) => {
      const next = prev.slice(0, idx + 1);
      const targetId = next[next.length - 1] ?? null;
      const targetName = targetId ? (categoriesById.get(targetId)?.name ?? null) : null;
      onSelectCategory(targetName);
      return next;
    });
    setActiveCatId(null);
  }, [categoriesById, onSelectCategory]);

  const goHome = useCallback(() => {
    setPath([]);
    setActiveCatId(null);
    onSelectCategory(null);
  }, [onSelectCategory]);

  const goBackOneLevel = useCallback(() => {
    if (path.length === 0) return;
    navigateToIndex(path.length - 2);
  }, [navigateToIndex, path.length]);

  const handleChipClick = useCallback((cat: Category) => {
    enterFolder(cat);
  }, [enterFolder]);

  // Sub-categories of the active chip (shown as a second row)
  const activeChipChildren = useMemo(() => {
    if (!activeCatId) return [];
    return sortedChildren(categories, activeCatId);
  }, [activeCatId, categories]);

  /* === Context menu handlers === */
  const menuProps: ChipMenuProps = useMemo(() => ({
    onEnterFolder: enterFolder,
    onAddQuestion: onAddCardToCategory,
    onAddSubCat: (cat) => addCategory("תת-קטגוריה חדשה", cat.id),
    onDelete: (cat) => {
      void (async () => {
        if (await confirm(`למחוק את "${displayCategoryName(cat.name)}"?`)) deleteCategory(cat.id);
      })();
    },
    onStartRename: (id) => setTimeout(() => setRenamingId(id), 50),
    onDuplicate: (id) => duplicateCategory(id),
    onExport: (id) => exportBranch(id),
    onToggleFavorite: toggleFavorite,
    onAddToDeck: addCategoryToDeck,
    onCreateDeckFrom: createDeckFromCategory,
    onMoveTo: (id, parentId) => moveCategory(id, parentId),
    isFavorite: (id) => favorites.includes(id),
    decks: state.decks,
    allCategories: categories,
  }), [
    enterFolder, onAddCardToCategory, addCategory, deleteCategory, confirm,
    duplicateCategory, exportBranch, toggleFavorite, addCategoryToDeck,
    createDeckFromCategory, moveCategory, favorites,
    state.decks, categories,
  ]);

  const totalCount = allOrderedCards.length;
  const feedLabel = useMemo(() => {
    if (!feedCategoryName) return "כל הקטגוריות";
    const cat = categoriesByName.get(feedCategoryName);
    return cat ? categoryLabel(cat) : feedCategoryName;
  }, [feedCategoryName, categoriesByName, categoryLabel]);

  return (
    <div dir="rtl" className="flex flex-col gap-0 h-full min-h-0">
      {/* ── Breadcrumb bar ── */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-1 flex-wrap">
        <button
          type="button"
          onClick={goBackOneLevel}
          disabled={path.length === 0}
          title="חזור לשלב הקודם"
          aria-label="חזור לשלב הקודם"
          className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-gold/40 bg-background/70 text-xs font-medium transition-colors hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="h-4 w-4" />
          חזרה
        </button>
        <button
          type="button"
          onClick={goHome}
          className={cn(
            "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors",
            path.length === 0 ? "text-gold font-bold" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Home className="h-3.5 w-3.5" />
          בית
        </button>
        {breadcrumbs.map((cat, i) => (
          <div key={cat.id} className="flex items-center gap-1">
            <ChevronLeft className="h-3 w-3 text-muted-foreground" />
            <button
              type="button"
              onClick={() => navigateToIndex(i)}
              className={cn(
                "text-xs px-2 py-1 rounded-md transition-colors",
                i === breadcrumbs.length - 1
                  ? "text-gold font-bold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {categoryLabel(cat)}
            </button>
          </div>
        ))}
      </div>

      {/* ── Multi-select action bar ── */}
      {multiSelected.size > 0 && (
        <div className="sticky top-0 z-20 mx-3 mt-2 flex items-center gap-2 flex-wrap rounded-xl border-2 border-gold/60 bg-card px-3 py-2 shadow-elegant" dir="rtl">
          <span className="text-xs font-bold text-gold">{multiSelected.size} נבחרו</span>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={handleBulkCopyNames}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-gold/40 hover:bg-secondary transition-colors"
              title="העתק שמות"
            >
              <Clipboard className="h-3 w-3" /> העתק שמות
            </button>
            <button
              onClick={handleBulkExport}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-gold/40 hover:bg-secondary transition-colors"
              title="ייצוא נבחרים"
            >
              <Download className="h-3 w-3" /> ייצוא
            </button>
            <button
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-red-400/40 text-red-500 hover:bg-red-500/10 transition-colors"
              title="מחק נבחרים"
            >
              <Trash2 className="h-3 w-3" /> מחק
            </button>
            <button
              onClick={() => setMultiSelected(new Set())}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-transparent hover:bg-secondary text-muted-foreground transition-colors"
              title="בטל בחירה"
            >
              <X className="h-3 w-3" /> בטל
            </button>
          </div>
        </div>
      )}

      {/* ── Category chips row(s) ── */}
      <div className="border-b border-gold/20 px-3 pb-2 space-y-1">
        {/* Current level chips */}
        {currentLevelCats.length > 0 ? (
          <CategoryChips
            categories={currentLevelCats}
            activeId={activeCatId}
            counts={counts}
            onSelect={handleChipClick}
            menu={menuProps}
            renamingId={renamingId}
            onRenameSubmit={handleRenameSubmit}
            cardsFullyLoaded={cardsFullyLoaded}
            multiSelected={multiSelected}
            onMultiSelect={handleChipMultiSelect}
          />
        ) : (
          <p className="text-xs text-muted-foreground py-2 text-center">אין קטגוריות ברמה זו</p>
        )}

        {/* Sub-chips: children of the active chip */}
        {activeChipChildren.length > 0 && (
          <div className="pt-1 border-t border-gold/10">
            <p className="text-[10px] text-muted-foreground mb-1 px-1">
              {categoryLabel(categoriesById.get(activeCatId!)!)} ←
            </p>
            <CategoryChips
              categories={activeChipChildren}
              activeId={null}
              counts={counts}
              onSelect={(cat) => {
                // Clicking a sub-chip enters that folder directly
                enterFolder(cat);
              }}
              menu={menuProps}
              renamingId={renamingId}
              onRenameSubmit={handleRenameSubmit}
              cardsFullyLoaded={cardsFullyLoaded}
            />
          </div>
        )}
      </div>

      {/* ── Card feed ── */}
      <div className="flex-1 min-h-0 px-3 pt-2 pb-3 flex flex-col gap-2">
        {/* Feed header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {feedCategoryName && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-gold/40 gap-1"
                onClick={() => onAddCardToCategory(
                  feedCategoryName ?? "",
                )}
              >
                <Plus className="h-3 w-3" /> הוסף שאלה
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <span className="text-xs text-muted-foreground">{totalCount} שאלות</span>
            )}
            <span className="text-xs font-semibold text-gold flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" />
              {feedLabel}
            </span>
          </div>
        </div>

        {/* Bordered scroll frame */}
        <div
          ref={scrollParentRef}
          className="flex-1 min-h-[340px] max-h-[560px] overflow-y-auto rounded-xl border-2 border-gold/35 bg-secondary/10"
        >
          {allOrderedCards.length === 0 ? (
            !cardsFullyLoaded && feedCategoryName ? (
              // Phase 2 backfill still loading — cards for this category may still arrive.
              // Show skeleton rows instead of "אין שאלות" to avoid flashing wrong empty state.
              <div className="p-2 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-lg border border-gold/20 bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-16 text-muted-foreground gap-3">
                <LayoutList className="h-14 w-14 opacity-15" />
                {feedCategoryName
                  ? <p className="text-sm">אין שאלות בקטגוריה הנבחרת</p>
                  : <p className="text-sm">בחר קטגוריה למעלה כדי לראות שאלות</p>
                }
                {feedCategoryName && (
                  <Button
                    size="sm"
                    className="bg-gradient-navy text-primary-foreground gap-1"
                    onClick={() => onAddCardToCategory(
                      feedCategoryName,
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" /> הוסף שאלה ראשונה
                  </Button>
                )}
              </div>
            )
          ) : (
            <div
              style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
              className="p-2"
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const { card, catName } = allOrderedCards[vItem.index];
                const catObj = categoriesByName.get(catName);
                const label = catObj ? categoryLabel(catObj) : catName;
                return (
                  <div
                    key={vItem.key}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      left: 0,
                      transform: `translateY(${vItem.start}px)`,
                    }}
                    className="pb-2"
                  >
                    <CardRow
                      card={card}
                      catLabel={label}
                      onEdit={() => onEditCard?.(card)}
                      onDelete={async () => {
                        if (await confirm(`מחק את "${card.question.slice(0, 50)}..."?`))
                          deleteCard(card.id);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* confirm dialog */}
      {dialog}
      {/* text prompt dialog (replaces window.prompt) */}
      <TextPromptDialog
        open={promptOpen}
        onOpenChange={setPromptOpen}
        title={promptTitle}
        defaultValue={promptDefault}
        onConfirm={(val) => promptCallback?.(val)}
      />
    </div>
  );
}
