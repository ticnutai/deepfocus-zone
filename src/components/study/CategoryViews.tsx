// ⚠️  DO NOT DELETE THIS FILE.
// It contains 3 active category views used by CategoryManager:
//   CategoryListView  → "list" mode   (flat sorted list)
//   CategoryCardsView → "cards" mode  (folder grid)
//   CategoryMindmapView → "mindmap" mode (radial hierarchy)
import { useMemo, Fragment } from "react";
import { useDroppable, useDndContext, useDraggable } from "@dnd-kit/core";
import { Folder, Plus, ChevronLeft, FileText, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStudy } from "@/lib/study/store";
import type { Category, Card as StudyCard } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { buildCategoryIndex, getDisplayCategoryLabel, getDisplayCategoryPath } from "@/lib/study/categoryDisplay";

// Thin horizontal drop zone shown between category items during a category drag
function CatSiblingDropZone({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { kind: "sibling" } });
  const { active } = useDndContext();
  if (!active?.id?.toString().startsWith("catdrag:")) return null;
  return (
    <div ref={setNodeRef} className="h-2 -my-0.5 flex items-center px-2">
      <div className={cn(
        "h-[3px] w-full rounded-full transition-all",
        isOver ? "bg-blue-500 shadow-[0_0_6px_hsl(217_91%_60%)]" : "bg-transparent",
      )} />
    </div>
  );
}

interface Props {
  selectedCategory: string | null;
  onSelectCategory: (name: string | null) => void;
  onAddCardToCategory: (catName: string) => void;
}

// === Shared: cards count map per category name ===
function useCountsByName() {
  const { state } = useStudy();
  return useMemo(() => {
    const map = new Map<string, number>();
    state.cards.forEach((c) => {
      c.tags.forEach((t) => {
        if (t.startsWith("cat:")) {
          const name = t.slice(4);
          map.set(name, (map.get(name) ?? 0) + 1);
        }
      });
    });
    return map;
  }, [state.cards]);
}

function useCardsByCategory() {
  const { state } = useStudy();
  return useMemo(() => {
    const map = new Map<string, StudyCard[]>();
    state.cards.forEach((c) => {
      c.tags.forEach((t) => {
        if (t.startsWith("cat:")) {
          const name = t.slice(4);
          const arr = map.get(name) ?? [];
          arr.push(c);
          map.set(name, arr);
        }
      });
    });
    return map;
  }, [state.cards]);
}

// === Common droppable category cell ===
function CategoryDropCell({
  cat, displayName, isActive, onClick, onAdd, count, children, className,
}: {
  cat: Category;
  displayName?: string;
  isActive: boolean;
  onClick: () => void;
  onAdd: () => void;
  count: number;
  children?: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `catparent:${cat.id}`,
    data: { catId: cat.id, kind: "into" },
  });
  const { setNodeRef: setDragRef, listeners, attributes, isDragging } =
    useDraggable({ id: `catdrag:${cat.id}` });
  const { active } = useDndContext();
  const activeId = active?.id?.toString() ?? "";
  const draggingCard = activeId.startsWith("card:");
  const draggingCat = activeId.startsWith("catdrag:");

  const setRefs = (el: HTMLDivElement | null) => {
    setDropRef(el);
    setDragRef(el);
  };

  return (
    <div
      ref={setRefs}
      onClick={onClick}
      className={cn(
        "group relative cursor-pointer rounded-xl border-2 transition-all overflow-hidden",
        isActive
          ? "border-gold bg-gradient-navy text-primary-foreground shadow-elegant"
          : "border-gold/30 bg-card hover:border-gold/60 hover:shadow-md",
        isOver && draggingCard && "ring-2 ring-blue-500 bg-blue-500/15 scale-[1.02]",
        isOver && draggingCat && "ring-2 ring-emerald-500 bg-emerald-500/15",
        isOver && !draggingCard && !draggingCat && "ring-2 ring-emerald-500",
        isDragging && "opacity-40",
        className,
      )}
    >
      {children}
      <button
        type="button"
        {...listeners}
        {...attributes}
        onClick={(e) => e.stopPropagation()}
        title="גרור קטגוריה"
        className={cn(
          "absolute top-1.5 right-1.5 h-6 w-6 rounded-full flex items-center justify-center transition-all",
          "bg-background/80 text-muted-foreground hover:text-foreground border border-gold/30",
          "opacity-0 group-hover:opacity-100",
        )}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onAdd(); }}
        title={`שאלה חדשה ב"${displayName ?? cat.name}"`}
        className={cn(
          "absolute top-1.5 left-1.5 h-6 w-6 rounded-full flex items-center justify-center transition-all",
          "bg-gold text-navy hover:scale-110 shadow-sm opacity-0 group-hover:opacity-100",
          isActive && "opacity-100",
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {isOver && draggingCard && (
        <span className="pointer-events-none absolute bottom-1 right-1 text-[9px] font-bold text-blue-600 bg-background/95 px-1.5 py-0.5 rounded border border-blue-500">
          📥 שייך
        </span>
      )}
      {isOver && draggingCat && (
        <span className="pointer-events-none absolute bottom-1 right-1 text-[9px] font-bold text-emerald-600 bg-background/95 px-1.5 py-0.5 rounded border border-emerald-500">
          ⤵ תת-קטגוריה
        </span>
      )}
    </div>
  );
}

// =================== LIST VIEW ===================
export function CategoryListView({ selectedCategory, onSelectCategory, onAddCardToCategory }: Props) {
  const { state } = useStudy();
  const counts = useCountsByName();
  const rawCategories = useMemo(() => [...(state.categories ?? [])], [state.categories]);
  const categoriesById = useMemo(() => buildCategoryIndex(rawCategories), [rawCategories]);
  const categories = useMemo(
    () => [...rawCategories].sort(
      (a, b) => getDisplayCategoryPath(a, categoriesById).localeCompare(getDisplayCategoryPath(b, categoriesById), "he"),
    ),
    [rawCategories, categoriesById],
  );

  const pathOf = (cat: Category): string => {
    return getDisplayCategoryPath(cat, categoriesById);
  };

  if (categories.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">אין קטגוריות עדיין.</p>;
  }

  return (
    <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
      {categories.map((cat) => {
        const isActive = selectedCategory === cat.name;
        const count = counts.get(cat.name) ?? 0;
        return (
          <Fragment key={cat.id}>
            <CatSiblingDropZone id={`before:${cat.id}`} />
            <CategoryDropCell
              cat={cat}
              displayName={getDisplayCategoryLabel(cat, categoriesById)}
              isActive={isActive}
              count={count}
              onClick={() => onSelectCategory(isActive ? null : cat.name)}
              onAdd={() => onAddCardToCategory(cat.name)}
              className="px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Folder className="h-4 w-4 opacity-70 shrink-0" />
                <div className="flex-1 min-w-0 text-right">
                  <div className="text-sm font-medium truncate" title={pathOf(cat)}>{getDisplayCategoryLabel(cat, categoriesById)}</div>
                  {cat.parentId && (
                    <div className={cn("text-[10px] truncate",
                      isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {pathOf(cat)}
                    </div>
                  )}
                </div>
                <Badge variant="outline" className={cn(
                  "text-[10px]",
                  isActive ? "border-gold text-primary-foreground" : "border-gold/50",
                )}>
                  {count}
                </Badge>
              </div>
            </CategoryDropCell>
          </Fragment>
        );
      })}
      {categories.length > 0 && <CatSiblingDropZone id={`after:${categories[categories.length - 1].id}`} />}
    </div>
  );
}

// =================== CARDS (GRID) VIEW ===================
export function CategoryCardsView({ selectedCategory, onSelectCategory, onAddCardToCategory }: Props) {
  const { state } = useStudy();
  const counts = useCountsByName();
  const cardsByCat = useCardsByCategory();
  const rawCategories = useMemo(() => [...(state.categories ?? [])], [state.categories]);
  const categoriesById = useMemo(() => buildCategoryIndex(rawCategories), [rawCategories]);
  const categories = useMemo(
    () => [...rawCategories].sort(
      (a, b) => getDisplayCategoryPath(a, categoriesById).localeCompare(getDisplayCategoryPath(b, categoriesById), "he"),
    ),
    [rawCategories, categoriesById],
  );

  if (categories.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">אין קטגוריות עדיין.</p>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[420px] overflow-y-auto p-0.5">
      {categories.map((cat) => {
        const isActive = selectedCategory === cat.name;
        const count = counts.get(cat.name) ?? 0;
        const sample = (cardsByCat.get(cat.name) ?? []).slice(0, 2);
        const childCount = categories.filter((c) => c.parentId === cat.id).length;
        const label = getDisplayCategoryLabel(cat, categoriesById);
        const parent = cat.parentId ? categoriesById.get(cat.parentId) : undefined;
        const parentPath = parent ? getDisplayCategoryPath(parent, categoriesById) : "";
        return (
          <CategoryDropCell
            key={cat.id}
            cat={cat}
            displayName={label}
            isActive={isActive}
            count={count}
            onClick={() => onSelectCategory(isActive ? null : cat.name)}
            onAdd={() => onAddCardToCategory(cat.name)}
            className="aspect-[4/3] p-2.5 flex flex-col"
          >
            <div className="flex items-start justify-between mb-1">
              <Badge className={cn(
                "text-[9px] h-4 px-1.5",
                isActive ? "bg-gold text-navy" : "bg-navy text-primary-foreground",
              )}>
                {count} שאלות
              </Badge>
              <Folder className={cn("h-5 w-5", isActive ? "text-gold" : "text-gold/70")} />
            </div>
            <div className="font-display font-bold text-sm text-right leading-tight line-clamp-2">
              {label}
            </div>
            {parentPath && (
              <div className={cn(
                "text-[10px] text-right truncate mt-0.5",
                isActive ? "text-primary-foreground/70" : "text-muted-foreground",
              )} title={parentPath}>
                {parentPath}
              </div>
            )}
            <div className="mt-auto space-y-0.5">
              {sample.map((c) => (
                <div key={c.id} className={cn(
                  "text-[10px] truncate text-right flex items-center gap-1 justify-end",
                  isActive ? "text-primary-foreground/70" : "text-muted-foreground",
                )}>
                  <span className="truncate">{c.question}</span>
                  <FileText className="h-2.5 w-2.5 shrink-0" />
                </div>
              ))}
              {childCount > 0 && (
                <div className={cn(
                  "text-[10px] font-medium",
                  isActive ? "text-gold" : "text-gold",
                )}>
                  📂 {childCount} תתי-קטגוריות
                </div>
              )}
            </div>
          </CategoryDropCell>
        );
      })}
    </div>
  );
}

// =================== MIND MAP VIEW (radial-ish hierarchical) ===================
export function CategoryMindmapView({ selectedCategory, onSelectCategory, onAddCardToCategory }: Props) {
  const { state } = useStudy();
  const counts = useCountsByName();
  const categories = useMemo(
    () => [...(state.categories ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt,
    ),
    [state.categories],
  );
  const categoriesById = useMemo(() => buildCategoryIndex(categories), [categories]);

  const renderNode = (cat: Category, depth: number) => {
    const isActive = selectedCategory === cat.name;
    const count = counts.get(cat.name) ?? 0;
    const children = categories.filter((c) => c.parentId === cat.id);
    return (
      <div key={cat.id} className="flex items-stretch gap-2" dir="rtl">
        <CategoryDropCell
          cat={cat}
          displayName={getDisplayCategoryLabel(cat, categoriesById)}
          isActive={isActive}
          count={count}
          onClick={() => onSelectCategory(isActive ? null : cat.name)}
          onAdd={() => onAddCardToCategory(cat.name)}
          className={cn(
            "px-3 py-2 min-w-[140px] self-start",
            depth === 0 && "border-2 border-gold",
          )}
        >
          <div className="flex items-center gap-2 text-right">
            <Folder className="h-4 w-4 shrink-0 opacity-70" />
            <span className="font-medium text-sm truncate">{getDisplayCategoryLabel(cat, categoriesById)}</span>
            <Badge variant="outline" className={cn(
              "text-[10px] mr-auto",
              isActive ? "border-gold text-primary-foreground" : "border-gold/50",
            )}>
              {count}
            </Badge>
          </div>
        </CategoryDropCell>

        {children.length > 0 && (
          <>
            <div className="flex items-center text-gold/60">
              <ChevronLeft className="h-4 w-4" />
            </div>
            <div className="flex flex-col gap-2 border-r-2 border-dashed border-gold/30 pr-2">
              {children.map((child) => renderNode(child, depth + 1))}
            </div>
          </>
        )}
      </div>
    );
  };

  const roots = categories.filter((c) => !c.parentId);
  if (roots.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">אין קטגוריות עדיין.</p>;
  }

  return (
    <div className="overflow-auto max-h-[420px] p-2">
      <div className="flex flex-col gap-3 min-w-fit">
        {roots.map((root) => renderNode(root, 0))}
      </div>
    </div>
  );
}
