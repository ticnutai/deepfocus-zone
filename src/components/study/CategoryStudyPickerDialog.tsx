import { useState, useMemo, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown, ChevronLeft, CheckSquare, Square, Play, Brain, Search, Folder, FileText,
} from "lucide-react";
import { useStudy } from "@/lib/study/store";
import type { Category, Card as StudyCard } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { displayCategoryName } from "@/lib/study/shasGen";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The root category name to pick questions from */
  categoryName: string | null;
  onStart: (mode: "flashcard" | "multiple", cardIds: string[]) => void;
}

export function CategoryStudyPickerDialog({ open, onOpenChange, categoryName, onStart }: Props) {
  const { state } = useStudy();
  const [search, setSearch] = useState("");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Set<string>>(new Set());

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const getAllDescendantCatIds = useCallback(
    (catId: string): string[] => {
      const direct = state.categories.filter((c) => c.parentId === catId);
      return [catId, ...direct.flatMap((c) => getAllDescendantCatIds(c.id))];
    },
    [state.categories],
  );

  const getAllCardsInCatTree = useCallback(
    (catId: string): StudyCard[] => {
      const allIds = getAllDescendantCatIds(catId);
      const allCats = allIds
        .map((id) => state.categories.find((c) => c.id === id))
        .filter(Boolean) as Category[];
      return allCats.flatMap((cat) =>
        state.cards.filter((card) => card.tags.includes(`cat:${cat.name}`)),
      );
    },
    [getAllDescendantCatIds, state.categories, state.cards],
  );

  const getDirectCardsOfCat = useCallback(
    (catName: string): StudyCard[] =>
      state.cards.filter((c) => c.tags.includes(`cat:${catName}`)),
    [state.cards],
  );

  // ─── Root category ───────────────────────────────────────────────────────────

  const rootCat = useMemo(
    () => state.categories.find((c) => c.name === categoryName) ?? null,
    [state.categories, categoryName],
  );

  const allAvailableCards = useMemo(
    () => (rootCat ? getAllCardsInCatTree(rootCat.id) : []),
    [rootCat, getAllCardsInCatTree],
  );

  // ─── Init on dialog open ─────────────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => {
    if (open && rootCat) {
      // Select all by default
      setSelection(new Set(getAllCardsInCatTree(rootCat.id).map((c) => c.id)));
      // Expand direct children only
      const directKids = state.categories.filter((c) => c.parentId === rootCat.id);
      setExpandedCats(new Set(directKids.map((c) => c.id)));
      setSearch("");
    }
  }, [open]);

  // ─── Checkbox toggle helpers ─────────────────────────────────────────────────

  const toggleCat = (catId: string) => {
    const catCards = getAllCardsInCatTree(catId);
    const allSelected = catCards.length > 0 && catCards.every((c) => selection.has(c.id));
    setSelection((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        catCards.forEach((c) => next.delete(c.id));
      } else {
        catCards.forEach((c) => next.add(c.id));
      }
      return next;
    });
  };

  const toggleCard = (cardId: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      next.has(cardId) ? next.delete(cardId) : next.add(cardId);
      return next;
    });
  };

  const toggleExpand = (catId: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      next.has(catId) ? next.delete(catId) : next.add(catId);
      return next;
    });
  };

  const selectAll = () => setSelection(new Set(allAvailableCards.map((c) => c.id)));
  const deselectAll = () => setSelection(new Set());

  // ─── Search ──────────────────────────────────────────────────────────────────

  const searchQ = search.trim().toLowerCase();

  const flatFilteredCards = useMemo(() => {
    if (!searchQ || !rootCat) return [];
    return getAllCardsInCatTree(rootCat.id).filter((c) =>
      c.question.toLowerCase().includes(searchQ),
    );
  }, [searchQ, rootCat, getAllCardsInCatTree]);

  // ─── Render helpers ───────────────────────────────────────────────────────────

  const sortedChildren = (parentId: string) =>
    state.categories
      .filter((c) => c.parentId === parentId)
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt,
      );

  const renderCardRow = (card: StudyCard, depth: number) => {
    const isSelected = selection.has(card.id);
    return (
      <div
        key={card.id}
        className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-secondary/40 cursor-pointer"
        style={{ paddingRight: `${depth * 16 + 8}px` }}
        onClick={() => toggleCard(card.id)}
      >
        <span className="w-4 shrink-0" />
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => toggleCard(card.id)}
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
        />
        <FileText className="h-3 w-3 opacity-40 shrink-0" />
        <span className="flex-1 text-xs text-right truncate leading-snug">{card.question}</span>
      </div>
    );
  };

  const renderCatNode = (cat: Category, depth: number): React.ReactNode => {
    const children = sortedChildren(cat.id);
    const directCards = getDirectCardsOfCat(cat.name);
    const allCardsInTree = getAllCardsInCatTree(cat.id);
    const hasContent = allCardsInTree.length > 0;
    const allSelected = hasContent && allCardsInTree.every((c) => selection.has(c.id));
    const someSelected = !allSelected && allCardsInTree.some((c) => selection.has(c.id));
    const isExpanded = expandedCats.has(cat.id);
    const hasKids = children.length > 0 || directCards.length > 0;
    const selectedCount = allCardsInTree.filter((c) => selection.has(c.id)).length;

    return (
      <div key={cat.id}>
        {/* Category row */}
        <div
          className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-secondary/60 transition-colors cursor-pointer"
          style={{ paddingRight: `${depth * 16 + 8}px` }}
          onClick={() => toggleCat(cat.id)}
        >
          {/* Expand/collapse */}
          {hasKids ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpand(cat.id); }}
              className="h-4 w-4 flex items-center justify-center opacity-60 hover:opacity-100 shrink-0"
            >
              {isExpanded
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronLeft className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={() => toggleCat(cat.id)}
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
          />

          <Folder className="h-3.5 w-3.5 text-gold opacity-70 shrink-0" />

          <span className="flex-1 text-sm truncate text-right font-medium">
            {displayCategoryName(cat.name)}
          </span>

          {hasContent && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] h-4 px-1.5 border-gold/50 shrink-0 tabular-nums",
                allSelected && "border-green-500/60 text-green-600",
                someSelected && "border-blue-500/60 text-blue-600",
              )}
            >
              {selectedCount}/{allCardsInTree.length}
            </Badge>
          )}
        </div>

        {/* Children */}
        {isExpanded && (
          <div>
            {children.map((child) => renderCatNode(child, depth + 1))}
            {directCards.map((card) => renderCardRow(card, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // ─── Guards ───────────────────────────────────────────────────────────────────

  if (!rootCat) return null;

  const directChildren = sortedChildren(rootCat.id);
  const rootDirectCards = getDirectCardsOfCat(rootCat.name);
  const canStart = selection.size > 0;

  const handleStart = (mode: "flashcard" | "multiple") => {
    onStart(mode, Array.from(selection));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right text-base flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-gold" />
            בחר שאלות לתרגול
            <span className="text-xs text-muted-foreground font-normal">
              מ‑&quot;{displayCategoryName(rootCat.name)}&quot;
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Select all / deselect all row */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={selectAll}>
                <CheckSquare className="h-3.5 w-3.5" /> הכל ({allAvailableCards.length})
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={deselectAll}>
                <Square className="h-3.5 w-3.5" /> נקה
              </Button>
            </div>
            <span className="text-xs text-muted-foreground font-semibold">
              {selection.size} נבחרו
            </span>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש שאלה..."
              className="h-8 text-sm pr-7 text-right"
            />
          </div>

          {/* Tree or flat search results */}
          <div className="max-h-[340px] overflow-y-auto rounded-lg border border-gold/20 bg-background/50 p-1.5 space-y-0.5">
            {searchQ ? (
              /* Flat filtered list */
              flatFilteredCards.length > 0 ? (
                flatFilteredCards.map((card) => renderCardRow(card, 0))
              ) : (
                <p className="text-center text-xs text-muted-foreground py-8">
                  לא נמצאו תוצאות לחיפוש
                </p>
              )
            ) : (
              /* Hierarchical tree */
              <>
                {directChildren.map((cat) => renderCatNode(cat, 0))}
                {rootDirectCards.map((card) => renderCardRow(card, 0))}
                {allAvailableCards.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground py-8">
                    אין שאלות בקטגוריה זו
                  </p>
                )}
              </>
            )}
          </div>

          {/* Info hint */}
          {selection.size > 0 && selection.size < allAvailableCards.length && (
            <p className="text-[11px] text-blue-600 bg-blue-50 dark:bg-blue-950/30 rounded-lg px-3 py-1.5">
              {selection.size} שאלות נבחרו מתוך {allAvailableCards.length} — רק הנבחרות יכללו בתרגול
            </p>
          )}
          {selection.size === allAvailableCards.length && allAvailableCards.length > 0 && (
            <p className="text-[11px] text-green-600 bg-green-50 dark:bg-green-950/30 rounded-lg px-3 py-1.5">
              כל {allAvailableCards.length} השאלות נבחרו
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
          >
            ביטול
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canStart}
            onClick={() => handleStart("multiple")}
            className="h-8 text-xs gap-1 border-gold/50 hover:bg-gold/10"
          >
            <Brain className="h-3.5 w-3.5" /> אמריקאי
          </Button>
          <Button
            size="sm"
            disabled={!canStart}
            onClick={() => handleStart("flashcard")}
            className="h-8 text-xs gap-1 bg-gradient-navy text-primary-foreground"
          >
            <Play className="h-3.5 w-3.5" /> כרטיסיות
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
