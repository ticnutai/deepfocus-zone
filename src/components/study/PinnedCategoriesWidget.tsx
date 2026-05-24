import { useEffect, useMemo, useState } from "react";
import { Pin, PinOff, FolderTree, Search, FileText, Pencil, LayoutGrid, Rows3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStudy } from "@/lib/study/store";
import type { Card as StudyCard } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface Props {
  onSelectCategory: (name: string) => void;
  onEditCard?: (card: StudyCard) => void;
}

type PinnedDisplayMode = "grid2" | "grid4" | "horizontal";

export function PinnedCategoriesWidget({ onSelectCategory, onEditCard }: Props) {
  const { state, setUiPref } = useStudy();
  const [query, setQuery] = useState("");
  const displayMode = (() => {
    const mode = state.uiPrefs?.pinnedDisplayMode;
    return mode === "grid2" || mode === "grid4" || mode === "horizontal" ? mode : "grid2";
  })();
  const pinned = useMemo(() => state.uiPrefs?.pinnedCategoryNames ?? [], [state.uiPrefs?.pinnedCategoryNames]);
  const pinnedCardIds = useMemo(() => state.uiPrefs?.pinnedCardIds ?? [], [state.uiPrefs?.pinnedCardIds]);

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

  const setDisplayMode = (value: string) => {
    if (value !== "grid2" && value !== "grid4" && value !== "horizontal") return;
    setUiPref("pinnedDisplayMode", value as PinnedDisplayMode);
  };

  const renderGridLikeItem = (
    item: {
      id: string;
      title: string;
      subtitle: string;
      countLabel?: string;
      isCard: boolean;
      onOpen: () => void;
      onUnpin: () => void;
      onEdit?: () => void;
    },
    compact = false,
  ) => (
    <div key={item.id} className={cn("rounded-xl border border-gold/30 bg-card p-3 hover:border-gold/60 transition-colors", compact && "min-w-[240px] max-w-[280px] shrink-0")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 text-right">
          <button type="button" onClick={item.onOpen} className="w-full text-right">
            <p className="text-sm font-semibold truncate">{item.title}</p>
            <p className="text-[11px] text-muted-foreground truncate">{item.subtitle}</p>
          </button>
          {item.countLabel && <p className="text-[11px] text-gold mt-1">{item.countLabel}</p>}
        </div>
        <div className="flex items-center gap-1">
          {item.isCard && item.onEdit && (
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={item.onEdit} title="ערוך שאלה">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={item.onUnpin} title="בטל הצמדה">
            <PinOff className="h-3.5 w-3.5" />
          </Button>
          {item.isCard ? <FileText className="h-4 w-4 text-gold/70" /> : <Pin className="h-4 w-4 text-gold/70" />}
        </div>
      </div>
    </div>
  );

  const gridItems = [
    ...filtered.map((cat) => ({
      id: `cat:${cat.name}`,
      title: cat.name,
      subtitle: cat.parentId ? "תת-קטגוריה" : "קטגוריה ראשית",
      countLabel: `${counts.get(cat.name) ?? 0} שאלות`,
      isCard: false,
      onOpen: () => onSelectCategory(cat.name),
      onUnpin: () => unpin(cat.name),
      onEdit: undefined,
    })),
    ...filteredCards.map((card) => {
      const firstTag = (card.tags ?? []).find((t) => t.startsWith("cat:"));
      const catName = firstTag ? firstTag.slice(4) : "ללא קטגוריה";
      return {
        id: `card:${card.id}`,
        title: card.question,
        subtitle: catName,
        countLabel: "שאלה מוצמדת",
        isCard: true,
        onOpen: () => onSelectCategory(catName),
        onUnpin: () => unpinCard(card.id),
        onEdit: onEditCard ? () => onEditCard(card) : undefined,
      };
    }),
  ];

  const renderGrid = (cols: 2 | 4) => (
    <div className={cn("grid gap-2", cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4")}>
      {gridItems.map((item) => renderGridLikeItem(item))}
    </div>
  );

  const renderHorizontal = () => (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {gridItems.map((item) => renderGridLikeItem(item, true))}
    </div>
  );

  return (
    <Card className="gold-frame p-4 space-y-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle h-7 w-7">
            <Pin className="h-3.5 w-3.5" />
          </span>
          <h3 className="font-display text-base font-semibold">קטגוריות מוצמדות</h3>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 border-gold/40 text-gold hover:bg-gold/10"
              title="תצוגת מוצמדים"
              aria-label="תצוגת מוצמדים"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 text-right" dir="rtl">
            <DropdownMenuRadioGroup value={displayMode} onValueChange={setDisplayMode}>
              <DropdownMenuRadioItem value="grid2">רשת 2</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="grid4">רשת 4</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="horizontal">
                <span className="inline-flex items-center gap-1">
                  <Rows3 className="h-3.5 w-3.5" />
                  אופקי
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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
          {displayMode === "grid2" && renderGrid(2)}
          {displayMode === "grid4" && renderGrid(4)}
          {displayMode === "horizontal" && renderHorizontal()}
        </div>
      )}
    </Card>
  );
}
