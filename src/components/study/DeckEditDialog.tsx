import { useState, useMemo } from "react";
import { Pencil, Trash2, Plus, Search, X, Copy, FolderTree, List } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useStudy } from "@/lib/study/store";
import type { Card as StudyCardType } from "@/lib/study/types";
import { CategoryCardPickerDialog } from "./CategoryCardPickerDialog";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  deckId: string | null;
  /** Open existing CardEditor in edit mode for this card */
  onEditCard: (card: StudyCardType) => void;
  /** Open existing CardEditor in add mode for this deck */
  onAddCard: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  flashcard: "כרטיסיה",
  multiple: "אמריקאית",
  boolean: "נכון/לא",
  combo: "משולבת",
};

export function DeckEditDialog({ open, onOpenChange, deckId, onEditCard, onAddCard }: Props) {
  const { state, deleteCard, duplicateCard, updateDeckCategoryIds, renameDeck } = useStudy();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [search, setSearch] = useState("");
  const [catSearch, setCatSearch] = useState("");
  const [showCatEditor, setShowCatEditor] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCatId, setPickerCatId] = useState<string | null>(null);

  const deck = useMemo(() => state.decks.find((d) => d.id === deckId) ?? null, [state.decks, deckId]);

  // Build category options
  const categoryOptions = useMemo(() => {
    const cats = state.categories ?? [];
    const out: { id: string; name: string; path: string }[] = [];
    const walk = (parentId: string | null, parentPath: string) => {
      cats.filter((c) => c.parentId === parentId).forEach((c) => {
        const path = parentPath ? `${parentPath} / ${c.name}` : c.name;
        out.push({ id: c.id, name: c.name, path });
        walk(c.id, path);
      });
    };
    walk(null, "");
    return out;
  }, [state.categories]);

  // Selected category IDs for this deck
  const [selectedCatIds, setSelectedCatIds] = useState<string[]>(() => deck?.categoryIds ?? []);
  // Sync when deck changes
  useMemo(() => { if (deck) setSelectedCatIds(deck.categoryIds); }, [deck?.id]);

  const filteredCats = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    if (!q) return categoryOptions;
    return categoryOptions.filter((c) => c.path.toLowerCase().includes(q));
  }, [categoryOptions, catSearch]);

  const toggleCat = (id: string) => {
    setSelectedCatIds((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  };

  const saveCategoryIds = () => {
    if (!deckId) return;
    updateDeckCategoryIds(deckId, selectedCatIds, true);
    setShowCatEditor(false);
  };

  const cards = useMemo(() => {
    if (!deckId || !deck) return [];
    const linkedIds = new Set(
      (state.cardDecks ?? []).filter((l) => l.deckId === deckId).map((l) => l.cardId),
    );
    // Build category-name lookup for this deck (same logic as getCardsForDeck in CardsManager)
    const catNameById = new Map((state.categories ?? []).map((c) => [c.id, c.name]));
    // Expand to sub-categories when includeSubCategories is true
    const rootCatIds = deck.categoryIds ?? [];
    let effectiveCatIds: string[];
    if (deck.includeSubCategories !== false && rootCatIds.length > 0) {
      const expanded = new Set<string>(rootCatIds);
      const addSubs = (parentId: string) => {
        (state.categories ?? []).filter((c) => c.parentId === parentId).forEach((c) => {
          expanded.add(c.id);
          addSubs(c.id);
        });
      };
      rootCatIds.forEach(addSubs);
      effectiveCatIds = [...expanded];
    } else {
      effectiveCatIds = rootCatIds;
    }
    const catNames = new Set(
      effectiveCatIds.map((id) => catNameById.get(id)).filter(Boolean) as string[],
    );
    return state.cards.filter((c) =>
      c.deckId === deckId ||
      linkedIds.has(c.id) ||
      (catNames.size > 0 && c.tags?.some((t) => t.startsWith("cat:") && catNames.has(t.slice(4)))),
    );
  }, [state.cards, state.cardDecks, state.categories, deckId, deck]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => c.question.toLowerCase().includes(q));
  }, [cards, search]);

  if (!deck) return null;

  const cats = state.deckCategories?.[deck.id] ?? [];
  const catIdNames = categoryOptions.filter((c) => deck.categoryIds.includes(c.id)).map((c) => c.name);
  const pickerCat = pickerCatId ? (state.categories ?? []).find((c) => c.id === pickerCatId) ?? null : null;

  return (
    <>
    <CategoryCardPickerDialog
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      category={pickerCat}
      deckId={deckId}
    />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0"
        dir="rtl"
        // Allow interaction with elements outside (non-modal feel) - keep modal but very wide
      >
        <DialogHeader className="p-4 pl-12 border-b border-gold/30 bg-gradient-to-l from-gold/10 via-secondary/30 to-transparent">
          <DialogTitle className="text-right text-xl font-display font-bold flex items-center justify-between gap-2 group" dir="rtl">
            {/* Title on the RIGHT (first child in RTL) */}
            <span className="inline-flex items-center gap-1.5 order-first">
              {renaming ? (
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = renameValue.trim();
                      if (v && v !== deck.name) renameDeck(deck.id, v);
                      setRenaming(false);
                    } else if (e.key === "Escape") {
                      setRenaming(false);
                    }
                  }}
                  onBlur={() => {
                    const v = renameValue.trim();
                    if (v && v !== deck.name) renameDeck(deck.id, v);
                    setRenaming(false);
                  }}
                  className="h-8 text-lg font-display font-bold border-2 border-gold/60 bg-card text-right w-64"
                  dir="rtl"
                />
              ) : (
                <>
                  <span>עריכת מערכת: {deck.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameValue(deck.name);
                      setRenaming(true);
                    }}
                    title="שנה שם מערכת"
                    aria-label="שנה שם מערכת"
                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </>
              )}
            </span>
            {/* Badges + counter on the LEFT */}
            <div className="flex items-center gap-2 flex-wrap">
              {(catIdNames.length > 0 ? catIdNames : cats).slice(0, 4).map((c) => (
                <Badge key={c} variant="outline" className="text-[10px] border-gold/40">{c}</Badge>
              ))}
              {(catIdNames.length > 0 ? catIdNames : cats).length > 4 && (
                <Badge variant="outline" className="text-[10px] border-gold/40">+{(catIdNames.length > 0 ? catIdNames : cats).length - 4}</Badge>
              )}
              <span className="text-muted-foreground text-sm font-normal">
                ({cards.length} כרטיסים)
              </span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 p-3 border-b border-gold/20">
          <div className="relative flex-1">
            <Search className="h-3.5 w-3.5 absolute right-2 top-2.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חפש שאלה…"
              className="h-9 border-2 border-gold/40 pr-7 text-right"
            />
          </div>
          <Button onClick={onAddCard} className="bg-gradient-navy text-primary-foreground gap-2">
            <Plus className="h-4 w-4" />
            שאלה חדשה
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-2 border-gold/40 gap-1"
            onClick={() => setShowCatEditor((v) => !v)}
          >
            <FolderTree className="h-3.5 w-3.5" /> קטגוריות
          </Button>
        </div>

        {/* Category editor panel */}
        {showCatEditor && (
          <div className="border-b border-gold/30 bg-secondary/20 p-3 space-y-2" dir="rtl">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm">
                <FolderTree className="h-4 w-4 text-gold" /> קטגוריות שהמערכת אוספת
                <span className="text-xs text-muted-foreground">({selectedCatIds.length} נבחרו)</span>
              </Label>
              <div className="flex gap-2">
                <Button size="sm" onClick={saveCategoryIds} className="h-7 bg-gradient-navy text-primary-foreground">שמור</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowCatEditor(false)} className="h-7">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {categoryOptions.length > 6 && (
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute right-2 top-2 text-muted-foreground pointer-events-none" />
                <Input value={catSearch} onChange={(e) => setCatSearch(e.target.value)} placeholder="חפש קטגוריה…" className="h-7 text-xs border-gold/30 pr-7" />
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1.5 rounded-lg border border-gold/20 bg-card">
              {filteredCats.map((c) => {
                const active = selectedCatIds.includes(c.id);
                return (
                  <span key={c.id} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => toggleCat(c.id)}
                      className={cn(
                        "px-2 py-0.5 rounded-full text-xs border-2 transition-all",
                        active ? "border-navy bg-gradient-navy text-primary-foreground" : "border-gold/40 bg-secondary text-foreground hover:border-gold",
                      )}
                    >
                      {c.path}
                    </button>
                    {active && (
                      <button
                        type="button"
                        title="בחר שאלות ספציפיות"
                        onClick={() => { setPickerCatId(c.id); setPickerOpen(true); }}
                        className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                      >
                        <List className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                );
              })}
              {filteredCats.length === 0 && <p className="text-xs text-muted-foreground py-2 text-center w-full">לא נמצאו קטגוריות</p>}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              {cards.length === 0 ? "אין שאלות במערכת הזו עדיין." : "לא נמצאו שאלות התואמות לחיפוש."}
            </div>
          ) : (
            filtered.map((c, idx) => {
              const cardCats = c.tags.filter((t) => t.startsWith("cat:")).map((t) => t.slice(4));
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg border-2 border-gold/30 bg-card p-3 hover:border-gold hover:shadow-md transition-all cursor-pointer",
                  )}
                  onClick={() => onEditCard(c)}
                >
                  <div className="flex flex-col items-center text-[10px] text-muted-foreground shrink-0 pt-1 min-w-[2rem]">
                    <span className="font-semibold">#{idx + 1}</span>
                    <Badge variant="outline" className="text-[9px] mt-1 border-gold/40">
                      {TYPE_LABEL[c.type] ?? c.type}
                    </Badge>
                  </div>
                  <div className="flex-1 min-w-0 text-right">
                    <div className="text-sm font-medium leading-tight line-clamp-2">{c.question}</div>
                    {cardCats.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5 justify-end">
                        {cardCats.slice(0, 5).map((cc) => (
                          <Badge key={cc} variant="outline" className="text-[9px] border-gold/30">
                            {cc}
                          </Badge>
                        ))}
                        {cardCats.length > 5 && (
                          <span className="text-[9px] text-muted-foreground">+{cardCats.length - 5}</span>
                        )}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {c.stats.totalReviews > 0
                        ? `${c.stats.totalReviews} חזרות · ${Math.round((c.stats.correct / c.stats.totalReviews) * 100)}% הצלחה`
                        : "טרם נלמדה"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                    <Button
                      type="button" size="icon" variant="ghost"
                      className="h-7 w-7 text-navy hover:bg-navy/10"
                      onClick={(e) => { e.stopPropagation(); onEditCard(c); }}
                      title="ערוך"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button" size="icon" variant="ghost"
                      className="h-7 w-7 text-navy hover:bg-navy/10"
                      onClick={(e) => { e.stopPropagation(); duplicateCard(c.id); }}
                      title="שכפל"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button" size="icon" variant="ghost"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`למחוק את השאלה "${c.question.slice(0, 60)}"?`)) deleteCard(c.id);
                      }}
                      title="מחק"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t border-gold/20 flex items-center justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 ml-1" /> סגור
          </Button>
          <div className="text-xs text-muted-foreground">
            {filtered.length} מתוך {cards.length} שאלות
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
