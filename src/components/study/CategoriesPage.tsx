import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { FolderTree, BookOpen, Tag, Plus, Pencil, Trash2, Play, ArrowDownAZ, Calendar, Star, Pin, Hand, ArrowUpDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CategoryManager } from "./CategoryManager";
const CardEditor = lazy(() => import("./CardEditor").then(m => ({ default: m.CardEditor })));
const StudySession = lazy(() => import("./StudySession").then(m => ({ default: m.StudySession })));
import { WidgetGrid } from "./WidgetGrid";
import { CategoryStudyPickerDialog } from "./CategoryStudyPickerDialog";
import { PinnedCategoriesWidget } from "./PinnedCategoriesWidget";
import { QuickRunDialog } from "./QuickRunDialog";
import { useStudy } from "@/lib/study/store";
import { cn } from "@/lib/utils";
import { displayCategoryName, PATH_SEP } from "@/lib/study/shasGen";
import { toast } from "@/hooks/use-toast";
import type { Card as StudyCardType } from "@/lib/study/types";

type CategorySortMode = "name" | "createdNew" | "createdOld" | "favorites" | "manual";

const SORT_LABELS: Record<CategorySortMode, string> = {
  name: "לפי שם",
  createdNew: "לפי תאריך הוספה — חדש קודם",
  createdOld: "לפי תאריך הוספה — ישן קודם",
  favorites: "מועדפים תחילה",
  manual: "ידני (ללא מיון)",
};

const FAV_TAG = "sys:fav";
const PIN_TAG = "sys:pin";

// Hebrew-aware collator with natural numeric ordering so "דף ב." < "דף ג." < "דף ד."
// and "דף 2" < "דף 10". Compares natural order in both Hebrew & Latin.
const heCollator = new Intl.Collator(["he", "en"], { numeric: true, sensitivity: "base" });

const TYPE_LABEL: Record<string, string> = {
  flashcard: "כרטיסיה",
  multiple: "אמריקאית",
  boolean: "נכון/לא נכון",
  combo: "משולבת",
};

export function CategoriesPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { state, deleteCard, setWidgetLayout, updateCard, setUiPref, addDeck, addCardToDeck } = useStudy();

  // Per-category sort mode (persisted in uiPrefs, synced to cloud)
  const sortMode: CategorySortMode = selectedCategory
    ? (state.uiPrefs?.categorySortOrders?.[selectedCategory] ?? "name")
    : "name";

  const setSortMode = (mode: CategorySortMode) => {
    if (!selectedCategory) return;
    const next = { ...(state.uiPrefs?.categorySortOrders ?? {}), [selectedCategory]: mode };
    setUiPref("categorySortOrders", next);
  };

  const toggleCardTag = (card: StudyCardType, tag: string) => {
    const has = card.tags.includes(tag);
    const next = has ? card.tags.filter((t) => t !== tag) : [...card.tags, tag];
    updateCard(card.id, { tags: next });
  };

  const DIFF_COLORS = ["", "#94a3b8", "#4ade80", "#fbbf24", "#f97316", "#ef4444"];
  const DIFF_TITLES = ["", "קל מאוד", "קל", "בינוני", "קשה", "קשה מאוד"];

  const setDifficulty = (card: StudyCardType, level: number) => {
    const noOldDiff = card.tags.filter((t) => !t.startsWith("diff:"));
    const next = level === 0 ? noOldDiff : [...noOldDiff, `diff:${level}`];
    updateCard(card.id, { tags: next });
  };

  // Ensure pinned widget is visible when user actually has pinned categories.
  useEffect(() => {
    const pinnedCount = state.uiPrefs?.pinnedCategoryNames?.length ?? 0;
    if (pinnedCount === 0) return;

    const full = state.widgetLayout ?? {};
    const categoriesLayout = full.categories;
    if (!categoriesLayout || categoriesLayout.length === 0) return;

    const idx = categoriesLayout.findIndex((w) => w.id === "cat-pinned");
    if (idx >= 0 && categoriesLayout[idx].visible) return;

    const next = [...categoriesLayout];
    if (idx === -1) {
      next.unshift({ id: "cat-pinned", visible: true, size: "full", order: 0 });
    } else {
      next[idx] = { ...next[idx], visible: true };
    }
    const normalized = next.map((w, i) => ({ ...w, order: i }));
    setWidgetLayout({ ...full, categories: normalized });
  }, [state.uiPrefs?.pinnedCategoryNames, state.widgetLayout, setWidgetLayout]);

  // editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<StudyCardType | null>(null);

  // delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<StudyCardType | null>(null);

  // study session
  const [studyMode, setStudyMode] = useState<"flashcard" | "multiple" | null>(null);
  const [studyCardIds, setStudyCardIds] = useState<string[] | null>(null);

  // study picker dialog
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCategoryName, setPickerCategoryName] = useState<string | null>(null);

  // Quick-run dialog state
  const [quickRunOpen, setQuickRunOpen] = useState(false);
  const [quickRunCat, setQuickRunCat] = useState<{ id: string; name: string } | null>(null);
  // After session ends — offer to save as deck
  const [postSessionPrompt, setPostSessionPrompt] = useState<{ cardIds: string[]; categoryName: string } | null>(null);

  const rawCategoryCards = useMemo(() => (
    selectedCategory
      ? state.cards.filter((c) => c.tags.includes(`cat:${selectedCategory}`))
      : []
  ), [selectedCategory, state.cards]);

  // Sort + pinned-on-top
  const filteredCards = useMemo(() => {
    const arr = [...rawCategoryCards];
    const cmpByMode = (a: StudyCardType, b: StudyCardType): number => {
      switch (sortMode) {
        case "name":
          return heCollator.compare(a.question ?? "", b.question ?? "");
        case "createdNew":
          return (b.createdAt ?? 0) - (a.createdAt ?? 0);
        case "createdOld":
          return (a.createdAt ?? 0) - (b.createdAt ?? 0);
        case "favorites": {
          const fa = a.tags.includes(FAV_TAG) ? 0 : 1;
          const fb = b.tags.includes(FAV_TAG) ? 0 : 1;
          if (fa !== fb) return fa - fb;
          return heCollator.compare(a.question ?? "", b.question ?? "");
        }
        case "manual":
        default:
          return 0;
      }
    };
    arr.sort((a, b) => {
      const pa = a.tags.includes(PIN_TAG) ? 0 : 1;
      const pb = b.tags.includes(PIN_TAG) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return cmpByMode(a, b);
    });
    return arr;
  }, [rawCategoryCards, sortMode]);

  const defaultDeckId = state.decks[0]?.id ?? null;
  const getDeck = (deckId: string) => state.decks.find((d) => d.id === deckId);

  const openNew = () => { setEditingCard(null); setEditorOpen(true); };
  const openEdit = (card: StudyCardType) => { setEditingCard(card); setEditorOpen(true); };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteCard(deleteTarget.id);
    toast({ title: "השאלה נמחקה" });
    setDeleteTarget(null);
  };

  // If a study session is active, render it fullscreen
  if (studyMode && studyCardIds && studyCardIds.length > 0) {
    const firstDeckId = state.cards.find((c) => studyCardIds.includes(c.id))?.deckId ?? null;
    const sessionIds = [...studyCardIds];
    const sessionCatName = quickRunCat?.name ?? "";
    return (
      <Suspense fallback={null}>
      <StudySession
        deckId={firstDeckId}
        mode={studyMode as never}
        cardIds={studyCardIds}
        onExit={() => {
          // If session came from QuickRun, offer save-as-deck
          if (quickRunCat) {
            setPostSessionPrompt({ cardIds: sessionIds, categoryName: sessionCatName });
            setQuickRunCat(null);
          }
          setStudyMode(null);
          setStudyCardIds(null);
        }}
      />
      </Suspense>
    );
  }

  // ── widget: category tree ──────────────────────────────────────────────────
  const catManagerWidget = (
    <CategoryManager
      selectedCategory={selectedCategory}
      onSelectCategory={setSelectedCategory}
      expanded
      onStudyCategory={(catName) => {
        setPickerCategoryName(catName);
        setPickerOpen(true);
      }}
      onStudyMultipleCategories={(catNames, filter) => {
        const getAllDescendantCards = (catName: string): string[] => {
          const cat = state.categories.find((c) => c.name === catName);
          if (!cat) return [];
          const direct = state.cards.filter((c) => c.tags.includes(`cat:${cat.name}`));
          const kids = state.categories.filter((c) => c.parentId === cat.id);
          const directIds = direct.map((c) => c.id);
          const childIds = kids.flatMap((k) => getAllDescendantCards(k.name));
          return [...directIds, ...childIds];
        };
        const seen = new Set<string>();
        let allIds = catNames.flatMap((n) => getAllDescendantCards(n)).filter((id) => !seen.has(id) && seen.add(id));
        if (filter === "due") {
          const now = Date.now();
          allIds = allIds.filter((id) => {
            const card = state.cards.find((c) => c.id === id);
            return card && card.srs.dueAt <= now;
          });
        }
        if (allIds.length === 0) return;
        setStudyCardIds(allIds);
        setStudyMode("multiple");
      }}
      onStudyCardIds={(ids) => {
        if (!ids.length) return;
        setStudyCardIds(ids);
        setStudyMode("multiple");
      }}
      onQuickRun={(id, name) => {
        setQuickRunCat({ id, name });
        setQuickRunOpen(true);
      }}
    />
  );

  // ── widget: cards of selected category ────────────────────────────────────
  const catCardsWidget = (
    <Card className="gold-frame p-4 space-y-3 h-full">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {selectedCategory && (
                <Button size="sm" onClick={openNew}
                  className="bg-gradient-navy text-primary-foreground h-7 px-2 text-xs gap-1">
                  <Plus className="h-3.5 w-3.5" /> הוסף שאלה
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {selectedCategory ? `${filteredCards.length} שאלות` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-semibold">
                {selectedCategory ? (
                  <span className="flex items-center gap-1 flex-wrap justify-end">
                    {selectedCategory.split(PATH_SEP).map((part, i, arr) => (
                      <span key={i} className={cn(i === arr.length - 1 ? "" : "text-xs text-muted-foreground font-normal")}>
                        {i > 0 && <span className="text-muted-foreground mx-1">›</span>}
                        {part}
                      </span>
                    ))}
                  </span>
                ) : "בחר קטגוריה"}
              </h3>
              <span className="gold-icon-circle h-7 w-7">
                <BookOpen className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>

          {/* Practice buttons + sort menu */}
          {selectedCategory && (
            <div className="flex gap-2 justify-end items-center flex-wrap">
              {filteredCards.length > 0 && (
                <Button size="sm" variant="outline"
                  onClick={() => { setPickerCategoryName(selectedCategory); setPickerOpen(true); }}
                  className="border-gold/50 text-xs gap-1 h-7">
                  <Play className="h-3 w-3" /> תרגול עם בחירה
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="border-gold/50 text-xs gap-1 h-7" title="סיווג השאלות">
                    <ArrowUpDown className="h-3 w-3" />
                    {SORT_LABELS[sortMode]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-right" style={{ direction: "rtl" }}>
                  <DropdownMenuLabel>סיווג השאלות</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSortMode("name")}>
                    <ArrowDownAZ className="h-3.5 w-3.5 ml-2" /> לפי שם (טבעי — ב. ג. ד.)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortMode("createdNew")}>
                    <Calendar className="h-3.5 w-3.5 ml-2" /> תאריך — חדש קודם
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortMode("createdOld")}>
                    <Calendar className="h-3.5 w-3.5 ml-2" /> תאריך — ישן קודם
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortMode("favorites")}>
                    <Star className="h-3.5 w-3.5 ml-2" /> מועדפים תחילה
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortMode("manual")}>
                    <Hand className="h-3.5 w-3.5 ml-2" /> ידני (ללא מיון)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">
                    כרטיסים מוצמדים מופיעים תמיד למעלה
                  </DropdownMenuLabel>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Empty: no category selected */}
          {!selectedCategory && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FolderTree className="h-14 w-14 mb-3 opacity-20" />
              <p className="text-sm">בחר קטגוריה מהעץ כדי לראות את השאלות שלה</p>
            </div>
          )}

          {/* Empty: category has no cards */}
          {selectedCategory && filteredCards.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <BookOpen className="h-14 w-14 opacity-20" />
              <p className="text-sm">אין שאלות בקטגוריה זו עדיין</p>
              <Button size="sm" onClick={openNew}
                className="bg-gradient-navy text-primary-foreground gap-1">
                <Plus className="h-3.5 w-3.5" /> הוסף שאלה ראשונה
              </Button>
            </div>
          )}

          {/* Card list */}
          {filteredCards.length > 0 && (
            <div className="space-y-2 max-h-[560px] overflow-y-auto">
              {filteredCards.map((card) => {
                const deck = getDeck(card.deckId);
                const diffTag = card.tags.find((t) => t.startsWith("diff:"));
                const diffLevel = diffTag ? parseInt(diffTag.split(":")[1]) : 0;
                const nonCatTags = card.tags.filter((t) => !t.startsWith("cat:") && !t.startsWith("sys:") && !t.startsWith("diff:"));
                const isFav = card.tags.includes(FAV_TAG);
                const isPinned = card.tags.includes(PIN_TAG);
                return (
                  <div
                    key={card.id}
                    className={cn(
                      "rounded-xl border-2 bg-card p-3 space-y-1.5 hover:border-gold/60 transition-colors",
                      isPinned ? "border-gold/80 bg-gold/5" : "border-gold/30",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      {/* action buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className={cn("h-6 w-6", isPinned ? "text-gold" : "hover:text-gold")}
                          title={isPinned ? "בטל הצמדה" : "הצמד למעלה"}
                          onClick={() => toggleCardTag(card, PIN_TAG)}>
                          <Pin className={cn("h-3.5 w-3.5", isPinned && "fill-current")} />
                        </Button>
                        <Button size="icon" variant="ghost" className={cn("h-6 w-6", isFav ? "text-amber-500" : "hover:text-amber-500")}
                          title={isFav ? "הסר ממועדפים" : "סמן כמועדף"}
                          onClick={() => toggleCardTag(card, FAV_TAG)}>
                          <Star className={cn("h-3.5 w-3.5", isFav && "fill-current")} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 hover:text-gold"
                          onClick={() => openEdit(card)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 hover:text-destructive"
                          onClick={() => setDeleteTarget(card)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground text-right leading-snug flex-1">
                          {card.question}
                        </p>
                        <Badge variant="outline" className="text-[10px] border-gold/50 shrink-0">
                          {TYPE_LABEL[card.type] ?? card.type}
                        </Badge>
                      </div>
                    </div>
                    {/* Difficulty stars */}
                    <div className="flex items-center gap-0.5" title={diffLevel ? DIFF_TITLES[diffLevel] : "הגדר רמת קושי"}>
                      {[1, 2, 3, 4, 5].map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setDifficulty(card, diffLevel === lvl ? 0 : lvl)}
                          className="text-[13px] leading-none transition-transform hover:scale-125 focus:outline-none"
                          style={{
                            color: lvl <= diffLevel ? DIFF_COLORS[diffLevel] : "#ffffff22",
                            textShadow: lvl <= diffLevel ? `0 0 6px ${DIFF_COLORS[diffLevel]}` : "none",
                          }}
                          title={DIFF_TITLES[lvl]}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1 flex-wrap">
                        {nonCatTags.map((t) =>
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
                          ) : (
                            <span key={t} className={cn("inline-flex items-center gap-0.5 text-[10px] text-muted-foreground")}>
                              <Tag className="h-2.5 w-2.5" />{t}
                            </span>
                          )
                        )}
                      </div>
                      {deck && (
                        <span className="text-[10px] text-muted-foreground border border-gold/30 rounded px-1.5 py-0.5">
                          {deck.name}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
  );

  const pinnedCategoriesWidget = (
    <PinnedCategoriesWidget onSelectCategory={setSelectedCategory} />
  );

  return (
    <div dir="rtl" className="space-y-6">
      <WidgetGrid
        tabId="categories"
        widgetMap={{
          "cat-pinned": pinnedCategoriesWidget,
          "cat-manager": catManagerWidget,
          "cat-cards": catCardsWidget,
        }}
      />

      {/* Card editor dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingCard ? "עריכת שאלה" : "הוספת שאלה"}</DialogTitle>
          </DialogHeader>
          {editorOpen && (
            <Suspense fallback={null}>
            <CardEditor
              deckId={editingCard?.deckId ?? defaultDeckId}
              editCard={editingCard ?? undefined}
              prefillCategories={!editingCard && selectedCategory ? [selectedCategory] : undefined}
              onClose={() => setEditorOpen(false)}
            />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת שאלה</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך למחוק את השאלה הזו? לא ניתן לשחזר.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Study picker dialog */}
      <CategoryStudyPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        categoryName={pickerCategoryName}
        onStart={(mode, cardIds) => {
          setStudyCardIds(cardIds);
          setStudyMode(mode);
        }}
      />

      <QuickRunDialog
        open={quickRunOpen}
        onOpenChange={setQuickRunOpen}
        categoryId={quickRunCat?.id ?? null}
        categoryName={quickRunCat?.name ?? null}
        onStart={(cardIds, mode) => {
          setStudyCardIds(cardIds);
          setStudyMode(mode);
        }}
      />
    </div>
  );
}
