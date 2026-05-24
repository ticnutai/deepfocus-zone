import { useState, useMemo } from "react";
import { Search, CheckSquare, Square, Layers } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useStudy } from "@/lib/study/store";
import type { Category } from "@/lib/study/types";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  flashcard: "כרטיסיה",
  multiple: "אמריקאית",
  boolean: "נכון/לא",
  combo: "משולבת",
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  category: Category | null;
  deckId: string | null;
  defaultSelectMode?: "linked" | "unlinked-only";
  autoCloseOnSave?: boolean;
  onSaveComplete?: (payload: { selectedCount: number; allSelected: boolean }) => void;
}

export function CategoryCardPickerDialog({
  open,
  onOpenChange,
  category,
  deckId,
  defaultSelectMode = "linked",
  autoCloseOnSave = true,
  onSaveComplete,
}: Props) {
  const { state, addCardToDeck, removeCardFromDeck, updateDeckCategoryIds } = useStudy();
  const [search, setSearch] = useState("");

  const deck = useMemo(() => state.decks.find((d) => d.id === deckId) ?? null, [state.decks, deckId]);

  /** All cards that belong to this category (via cat: tag) */
  const categoryCards = useMemo(() => {
    if (!category) return [];
    const tag = `cat:${category.name}`;
    return state.cards.filter((c) => c.tags?.includes(tag));
  }, [state.cards, category]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categoryCards;
    return categoryCards.filter((c) => c.question.toLowerCase().includes(q));
  }, [categoryCards, search]);

  /** IDs of cards currently directly linked to this deck (via card_decks) */
  const linkedCardIds = useMemo(() => {
    if (!deckId) return new Set<string>();
    return new Set((state.cardDecks ?? []).filter((l) => l.deckId === deckId).map((l) => l.cardId));
  }, [state.cardDecks, deckId]);

  const unlinkedCategoryCardIds = useMemo(
    () => categoryCards.filter((c) => !linkedCardIds.has(c.id)).map((c) => c.id),
    [categoryCards, linkedCardIds],
  );

  /** Is the whole category already linked to this deck? */
  const categoryLinked = useMemo(() => {
    if (!deck || !category) return false;
    return (deck.categoryIds ?? []).includes(category.id);
  }, [deck, category]);

  // Local selection state — initialize from existing state
  const [selection, setSelection] = useState<Set<string>>(() => {
    if (categoryLinked) return new Set(categoryCards.map((c) => c.id));
    if (defaultSelectMode === "unlinked-only") return new Set(unlinkedCategoryCardIds);
    return new Set(Array.from(linkedCardIds));
  });

  // Re-sync when dialog opens
  useMemo(() => {
    if (open) {
      setSearch("");
      if (categoryLinked) {
        setSelection(new Set(categoryCards.map((c) => c.id)));
      } else if (defaultSelectMode === "unlinked-only") {
        setSelection(new Set(unlinkedCategoryCardIds));
      } else {
        setSelection(new Set(Array.from(linkedCardIds)));
      }
    }
  }, [open, categoryLinked, categoryCards, linkedCardIds, defaultSelectMode, unlinkedCategoryCardIds]);

  const toggle = (id: string) => {
    setSelection((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelection(new Set(categoryCards.map((c) => c.id)));
  const deselectAll = () => setSelection(new Set());

  const handleSave = () => {
    if (!deckId || !deck || !category) return;

    const allIds = new Set(categoryCards.map((c) => c.id));
    const allSelected = selection.size === allIds.size && [...allIds].every((id) => selection.has(id));

    if (allSelected) {
      // Link the whole category (clean approach — remove any individual card links first)
      const existingCatIds = deck.categoryIds ?? [];
      if (!existingCatIds.includes(category.id)) {
        updateDeckCategoryIds(deckId, [...existingCatIds, category.id], true);
      }
      // Remove stale individual card_decks entries for these cards (to avoid double-counting)
      for (const id of linkedCardIds) {
        if (allIds.has(id)) removeCardFromDeck(id, deckId);
      }
    } else {
      // Partial selection — remove category-level link if it exists, use card-level links
      if (categoryLinked) {
        const existingCatIds = (deck.categoryIds ?? []).filter((id) => id !== category.id);
        updateDeckCategoryIds(deckId, existingCatIds, true);
      }
      // Add newly selected cards
      for (const id of selection) {
        if (!linkedCardIds.has(id)) addCardToDeck(id, deckId);
      }
      // Remove deselected cards
      for (const id of linkedCardIds) {
        if (!selection.has(id) && allIds.has(id)) removeCardFromDeck(id, deckId);
      }
    }

    onSaveComplete?.({ selectedCount: selection.size, allSelected });
    if (autoCloseOnSave) onOpenChange(false);
  };

  if (!category || !deck) return null;

  const allSelected = categoryCards.length > 0 && categoryCards.every((c) => selection.has(c.id));
  const someSelected = selection.size > 0 && !allSelected;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-gold" />
            בחר שאלות מ‑"{category.name}"
            <span className="text-xs text-muted-foreground font-normal">למערכת "{deck.name}"</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Select all / deselect all */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={selectAll}>
                <CheckSquare className="h-3.5 w-3.5" /> הכל ({categoryCards.length})
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={deselectAll}>
                <Square className="h-3.5 w-3.5" /> נקה
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">{selection.size} נבחרו</span>
          </div>

          {/* Hint: selecting all = category-level link */}
          {allSelected && categoryCards.length > 0 && (
            <p className="text-[11px] text-green-600 bg-green-50 dark:bg-green-950/30 rounded-lg px-3 py-1.5">
              כל הקטגוריה תשויך למערכת — שאלות חדשות יתווספו אוטומטית
            </p>
          )}
          {someSelected && (
            <p className="text-[11px] text-blue-600 bg-blue-50 dark:bg-blue-950/30 rounded-lg px-3 py-1.5">
              {selection.size} שאלות ספציפיות בלבד — שאלות חדשות לא יתווספו אוטומטית
            </p>
          )}

          {/* Search */}
          {categoryCards.length > 5 && (
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute right-2 top-2 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חפש שאלה…"
                className="h-7 text-xs border-gold/30 pr-7"
              />
            </div>
          )}

          {/* Card list */}
          {categoryCards.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">אין שאלות בקטגוריה זו עדיין</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">לא נמצאו תוצאות</p>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-1 rounded-lg border border-gold/20 bg-card p-2">
              {filtered.map((card) => {
                const checked = selection.has(card.id);
                return (
                  <label
                    key={card.id}
                    className={cn(
                      "flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-colors",
                      checked ? "bg-navy/10 border border-navy/30" : "hover:bg-secondary/50",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(card.id)}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug line-clamp-2">{card.question}</p>
                      <span className="text-[10px] text-muted-foreground">
                        {TYPE_LABEL[card.type] ?? card.type}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-row-reverse">
          <Button
            onClick={handleSave}
            disabled={selection.size === 0 && !categoryLinked}
            className="bg-gradient-navy text-primary-foreground"
          >
            {allSelected && categoryCards.length > 0
              ? "שייך כל הקטגוריה"
              : selection.size > 0
              ? `הוסף ${selection.size} שאלות`
              : "שמור"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
