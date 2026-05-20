import { useEffect, useMemo, useState } from "react";
import { Pin, PinOff, FolderTree, ChevronLeft, GripVertical, Search, FileText, Pencil } from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useStudy } from "@/lib/study/store";
import type { Card as StudyCard } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface Props {
  onSelectCategory: (name: string) => void;
  onEditCard?: (card: StudyCard) => void;
}

interface SortablePinnedRowProps {
  id: string;
  name: string;
  isSubCategory: boolean;
  count: number;
  onSelectCategory: (name: string) => void;
  onUnpin: (name: string) => void;
}

function SortablePinnedRow({ id, name, isSubCategory, count, onSelectCategory, onUnpin }: SortablePinnedRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-xl border border-gold/30 bg-card px-3 py-2.5 flex items-center gap-2 hover:border-gold/60 transition-colors"
    >
      <button
        type="button"
        onClick={() => onSelectCategory(name)}
        className="flex-1 min-w-0 text-right"
      >
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {isSubCategory ? "תת-קטגוריה" : "קטגוריה ראשית"}
        </p>
      </button>
      <Badge variant="outline" className={cn("text-[10px]", count > 0 && "border-gold/50 text-gold")}>
        {count} שאלות
      </Badge>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={() => onUnpin(name)}
        title="בטל הצמדה"
      >
        <PinOff className="h-3.5 w-3.5" />
      </Button>
      <button
        type="button"
        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
        title="גרור לסידור"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <ChevronLeft className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

export function PinnedCategoriesWidget({ onSelectCategory, onEditCard }: Props) {
  const { state, setUiPref } = useStudy();
  const [query, setQuery] = useState("");
  const pinned = useMemo(() => state.uiPrefs?.pinnedCategoryNames ?? [], [state.uiPrefs?.pinnedCategoryNames]);
  const pinnedCardIds = useMemo(() => state.uiPrefs?.pinnedCardIds ?? [], [state.uiPrefs?.pinnedCardIds]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!pinned.length) return;
    const existing = new Set((state.categories ?? []).map((c) => c.name));
    const missing = pinned.filter((name) => !existing.has(name));
    if (!missing.length) return;
    const next = pinned.filter((name) => existing.has(name));
    setUiPref("pinnedCategoryNames", next);
    toast({
      title: "עודכנו מוצמדים",
      description: `הוסרו ${missing.length} קטגוריות שלא קיימות יותר`,
    });
  }, [pinned, setUiPref, state.categories]);

  useEffect(() => {
    if (!pinnedCardIds.length) return;
    const existing = new Set((state.cards ?? []).map((c) => c.id));
    const missing = pinnedCardIds.filter((id) => !existing.has(id));
    if (!missing.length) return;
    const next = pinnedCardIds.filter((id) => existing.has(id));
    setUiPref("pinnedCardIds", next);
    toast({
      title: "עודכנו מוצמדים",
      description: `הוסרו ${missing.length} שאלות שלא קיימות יותר`,
    });
  }, [pinnedCardIds, setUiPref, state.cards]);

  const categories = useMemo(() => {
    const byName = new Map((state.categories ?? []).map((c) => [c.name, c] as const));
    return pinned
      .map((name) => byName.get(name))
      .filter((c): c is NonNullable<typeof c> => !!c);
  }, [pinned, state.categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  const pinnedCards = useMemo(() => {
    const byId = new Map((state.cards ?? []).map((c) => [c.id, c] as const));
    return pinnedCardIds
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c);
  }, [pinnedCardIds, state.cards]);

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pinnedCards;
    return pinnedCards.filter((c) => c.question.toLowerCase().includes(q));
  }, [pinnedCards, query]);

  const counts = new Map<string, number>();
  (state.cards ?? []).forEach((card) => {
    (card.tags ?? []).forEach((tag) => {
      if (!tag.startsWith("cat:")) return;
      const name = tag.slice(4);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
  });

  const unpin = (name: string) => {
    const next = pinned.filter((x) => x !== name);
    setUiPref("pinnedCategoryNames", next);
  };

  const unpinCard = (cardId: string) => {
    const next = pinnedCardIds.filter((id) => id !== cardId);
    setUiPref("pinnedCardIds", next);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = pinned.indexOf(String(active.id));
    const to = pinned.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setUiPref("pinnedCategoryNames", arrayMove(pinned, from, to));
  };

  return (
    <Card className="gold-frame p-4 space-y-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle h-7 w-7">
            <Pin className="h-3.5 w-3.5" />
          </span>
          <h3 className="font-display text-base font-semibold">קטגוריות מוצמדות</h3>
        </div>
        <span className="text-xs text-muted-foreground">{categories.length + pinnedCards.length} מוצמדים</span>
      </div>

      <div className="relative">
        <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש במוצמדים..."
          className="h-8 pr-7 text-sm border-gold/30"
        />
      </div>

      {categories.length === 0 && pinnedCards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
          <FolderTree className="h-10 w-10 opacity-25" />
          <p className="text-sm">אין פריטים מוצמדים</p>
          <p className="text-xs">אפשר להצמיד קטגוריה או שאלה ולהגיע אליה מהר</p>
        </div>
      ) : filtered.length === 0 && filteredCards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
          <Search className="h-8 w-8 opacity-30" />
          <p className="text-sm">לא נמצאו תוצאות לחיפוש</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[420px] overflow-y-auto">
          {filtered.length > 0 && (
            <>
              <div className="text-[11px] font-bold text-muted-foreground">קטגוריות מוצמדות</div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={filtered.map((c) => c.name)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {filtered.map((cat) => (
                      <SortablePinnedRow
                        key={cat.name}
                        id={cat.name}
                        name={cat.name}
                        isSubCategory={!!cat.parentId}
                        count={counts.get(cat.name) ?? 0}
                        onSelectCategory={onSelectCategory}
                        onUnpin={unpin}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </>
          )}

          {filteredCards.length > 0 && (
            <>
              <div className="text-[11px] font-bold text-muted-foreground">שאלות מוצמדות</div>
              <div className="space-y-2">
                {filteredCards.map((card) => {
                  const firstTag = (card.tags ?? []).find((t) => t.startsWith("cat:"));
                  const catName = firstTag ? firstTag.slice(4) : "ללא קטגוריה";
                  return (
                    <div key={card.id} className="rounded-xl border border-gold/30 bg-card px-3 py-2.5 flex items-start gap-2 hover:border-gold/60 transition-colors">
                      <button
                        type="button"
                        onClick={() => onSelectCategory(catName)}
                        className="flex-1 min-w-0 text-right"
                        title={card.question}
                      >
                        <p className="text-sm font-medium truncate">{card.question}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{catName}</p>
                      </button>
                      {onEditCard && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => onEditCard(card)}
                          title="ערוך שאלה"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => unpinCard(card.id)}
                        title="בטל הצמדה"
                      >
                        <PinOff className="h-3.5 w-3.5" />
                      </Button>
                      <FileText className="h-4 w-4 text-gold/70 mt-1" />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
