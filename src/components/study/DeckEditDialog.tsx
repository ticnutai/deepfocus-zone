import { lazy, Suspense, useMemo, useState } from "react";
import { Pencil, Trash2, Plus, Search, X, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStudy } from "@/lib/study/store";
import type { Card as StudyCardType, Category } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { CategoryCardPickerDialog } from "./CategoryCardPickerDialog";
import { CategoryPickerDialog } from "./CategoryPickerDialog";
import { useToast } from "@/hooks/use-toast";

const StudyPlansCard = lazy(() => import("./StudyPlansCard").then((m) => ({ default: m.StudyPlansCard })));

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
  const { state, deleteCard, duplicateCard, renameDeck } = useStudy();
  const { toast } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"questions" | "reviews">("questions");
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCategoryQueue, setPickerCategoryQueue] = useState<string[]>([]);
  const [pickerQueueIndex, setPickerQueueIndex] = useState(0);
  const [classifiedCategoriesCount, setClassifiedCategoriesCount] = useState(0);
  const [classifiedQuestionsCount, setClassifiedQuestionsCount] = useState(0);
  const [reviewsCreateSignal, setReviewsCreateSignal] = useState(0);

  const deck = useMemo(() => state.decks.find((d) => d.id === deckId) ?? null, [state.decks, deckId]);

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
  const catIdNames = (state.categories ?? []).filter((c) => deck.categoryIds.includes(c.id)).map((c) => c.name);
  const pickerCat: Category | null = pickerCategoryQueue[pickerQueueIndex]
    ? (state.categories ?? []).find((c) => c.id === pickerCategoryQueue[pickerQueueIndex]) ?? null
    : null;

  return (
    <>
    <CategoryCardPickerDialog
      open={pickerOpen}
      onOpenChange={(nextOpen) => {
        setPickerOpen(nextOpen);
        if (!nextOpen) {
          setPickerCategoryQueue([]);
          setPickerQueueIndex(0);
        }
      }}
      category={pickerCat}
      deckId={deckId}
      defaultSelectMode="unlinked-only"
      autoCloseOnSave={false}
      onSaveComplete={({ selectedCount }) => {
        const nextCategories = classifiedCategoriesCount + 1;
        const nextQuestions = classifiedQuestionsCount + selectedCount;
        setClassifiedCategoriesCount(nextCategories);
        setClassifiedQuestionsCount(nextQuestions);

        if (pickerQueueIndex < pickerCategoryQueue.length - 1) {
          setPickerQueueIndex((i) => i + 1);
          return;
        }

        setPickerOpen(false);
        setPickerCategoryQueue([]);
        setPickerQueueIndex(0);
        toast({
          title: "הסיווג עודכן",
          description: `סווגו ${nextQuestions} שאלות ב-${nextCategories} קטגוריות למערכת זו.`,
        });
        setClassifiedCategoriesCount(0);
        setClassifiedQuestionsCount(0);
      }}
    />

    <CategoryPickerDialog
      open={classifyOpen}
      onOpenChange={setClassifyOpen}
      selected={[]}
      onConfirm={(names) => {
        const nextQueue = (state.categories ?? [])
          .filter((c) => names.includes(c.name))
          .map((c) => c.id);

        if (nextQueue.length === 0) {
          setClassifyOpen(false);
          return;
        }

        setClassifiedCategoriesCount(0);
        setClassifiedQuestionsCount(0);
        setPickerCategoryQueue(nextQueue);
        setPickerQueueIndex(0);
        setClassifyOpen(false);
        setPickerOpen(true);
      }}
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
            className="border-gold/40"
            onClick={() => {
              setClassifyOpen(true);
            }}
          >
            סווג שאלות
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "questions" | "reviews")} className="flex-1 min-h-0 flex flex-col">
          <div className="px-3 pt-2 flex items-center justify-between gap-2">
            <TabsList className="grid grid-cols-2 w-full max-w-xs">
              <TabsTrigger value="questions">שאלות</TabsTrigger>
              <TabsTrigger value="reviews">חזרות</TabsTrigger>
            </TabsList>
            {activeTab === "reviews" && (
              <Button
                size="sm"
                className="bg-gradient-navy text-primary-foreground rounded-xl gap-1"
                onClick={() => setReviewsCreateSignal((v) => v + 1)}
              >
                <Plus className="h-3.5 w-3.5" /> הוסף תוכנית חזרות
              </Button>
            )}
          </div>

          <TabsContent value="questions" className="flex-1 overflow-y-auto p-3 space-y-2">
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
          </TabsContent>

          <TabsContent value="reviews" className="flex-1 overflow-y-auto p-3">
            <div className="rounded-lg border border-gold/30 p-2">
              <Suspense fallback={<div className="text-sm text-muted-foreground p-4 text-center">טוען חזרות...</div>}>
                <StudyPlansCard
                  contextDeckId={deck.id}
                  showOnlyContextDeckReview={true}
                  createDeckReviewSignal={reviewsCreateSignal}
                />
              </Suspense>
            </div>
          </TabsContent>
        </Tabs>

        <div className="p-3 border-t border-gold/20 flex items-center justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 ml-1" /> סגור
          </Button>
          <div className="text-xs text-muted-foreground">
            {activeTab === "questions" ? `${filtered.length} מתוך ${cards.length} שאלות` : "חזרות על מערכות"}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
