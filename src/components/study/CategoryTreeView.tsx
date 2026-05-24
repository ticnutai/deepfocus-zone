/**
 * CategoryTreeView — pure hierarchical tree view for categories.
 * No toolbar, no view switcher — those live in CategoryManager.
 * Supports: collapse/expand, drag-to-reorder, drag-into (reparent),
 *   inline add, delete, card-count badges, study + shas auto-create buttons.
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown, ChevronLeft, Folder, FolderOpen, FolderPlus,
  Trash2, Plus, ListChecks, GripVertical,
  ArrowUp, ArrowDown,
} from "lucide-react";
import { useDraggable, useDroppable, useDndContext } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudy } from "@/lib/study/store";
import type { Category } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { buildCategoryIndex, getDisplayCategoryLabel } from "@/lib/study/categoryDisplay";
// (כפתורי "צור דפים/עמודים" הוסרו — משתמשים בתבנית ש"ס במקום)
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/useConfirm";

/* ── Sibling drop-zone: thin blue line shown between rows during cat drag ── */
function SiblingDropZone({ id, depth }: { id: string; depth: number }) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { kind: "sibling" } });
  const { active } = useDndContext();
  if (!active?.id?.toString().startsWith("catdrag:")) return null;
  return (
    <div
      ref={setNodeRef}
      style={{ paddingRight: `${depth * 14 + 4}px`, paddingLeft: 4 }}
      className="h-2 -my-0.5 flex items-center"
    >
      <div className={cn(
        "h-[3px] w-full rounded-full transition-all",
        isOver ? "bg-blue-500 shadow-[0_0_6px_hsl(217_91%_60%)]" : "bg-transparent",
      )} />
    </div>
  );
}

/* ── Root drop target: shows at bottom when dragging a category ── */
function RootDropTarget({ children, empty }: { children: React.ReactNode; empty?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "catparent:root", data: { catId: null, kind: "into" } });
  const { active } = useDndContext();
  if (!empty && !active?.id?.toString().startsWith("catdrag:")) return <>{children}</>;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg transition-all",
        isOver ? "ring-2 ring-emerald-500 bg-emerald-500/10" : "",
      )}
    >
      {children}
    </div>
  );
}

/* ── Single draggable + droppable row ── */
function CategoryRow({
  cat, isActive, depth, children,
}: {
  cat: Category; isActive: boolean; depth: number; children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } =
    useDraggable({ id: `catdrag:${cat.id}` });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `catparent:${cat.id}`, data: { catId: cat.id, kind: "into" },
  });
  const { active } = useDndContext();
  const draggingCard = active?.id?.toString().startsWith("card:");
  const setRef = (el: HTMLDivElement | null) => { setDragRef(el); setDropRef(el); };

  return (
    <div
      ref={setRef}
      {...listeners}
      {...attributes}
      style={{ paddingRight: `${depth * 14 + 6}px` }}
      className={cn(
        "flex items-center gap-1 py-1.5 px-2 rounded-md transition-all group select-none",
        isActive ? "bg-gradient-navy text-primary-foreground shadow-sm" : "hover:bg-secondary",
        isOver && draggingCard && "ring-2 ring-blue-500 bg-blue-500/15",
        isOver && !draggingCard && "ring-2 ring-emerald-500 bg-emerald-500/15",
        isDragging && "opacity-30",
      )}
    >
      <GripVertical className="h-3.5 w-3.5 opacity-20 group-hover:opacity-50 shrink-0 cursor-grab" />
      {children}
    </div>
  );
}

/* ── Inline add-subcategory input ── */
function AddInput({
  depth, onAdd, onCancel,
}: {
  depth: number; onAdd: (name: string) => void; onCancel: () => void;
}) {
  const [val, setVal] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="flex gap-1 my-0.5" style={{ paddingRight: `${depth * 14 + 10}px` }}>
      <Input
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="שם תת-קטגוריה..."
        className="h-7 text-xs border-2 border-gold/40 text-right"
        onKeyDown={(e) => {
          if (e.key === "Enter" && val.trim()) { onAdd(val.trim()); setVal(""); }
          else if (e.key === "Escape") onCancel();
        }}
      />
      <Button
        size="icon"
        onClick={() => { if (val.trim()) { onAdd(val.trim()); setVal(""); } }}
        type="button"
        className="h-7 w-7 bg-gradient-navy text-primary-foreground shrink-0"
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */

interface Props {
  selectedCategory: string | null;
  onSelectCategory: (name: string | null) => void;
  onAddCardToCategory?: (name: string) => void;
  onStudyCategory?: (name: string) => void;
  sortKey: "manual" | "name" | "count";
  sortDir: "asc" | "desc";
  /** When true, no max-height scroll cap */
  expanded?: boolean;
}

export function CategoryTreeView({
  selectedCategory, onSelectCategory, onAddCardToCategory, onStudyCategory,
  sortKey, sortDir, expanded,
}: Props) {
  const {
    state,
    addCategory,
    deleteCategory,
    reorderCategories,
    loadCategoryChildren,
    isCategoryChildrenLoading,
    getCategoryHasChildren,
    getCategoryPerfSnapshot,
    getHydrationSnapshot,
  } = useStudy();

  const { cardsFullyLoaded } = getHydrationSnapshot();

  useEffect(() => {
    void loadCategoryChildren(null, { prefetch: false, reason: "initial" });
  }, [loadCategoryChildren]);

  const categories = useMemo(
    () => [...(state.categories ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt),
    [state.categories],
  );
  const categoriesById = useMemo(() => buildCategoryIndex(categories), [categories]);

  const countsByName = useMemo(() => {
    const map = new Map<string, number>();
    state.cards.forEach((c) => {
      c.tags.forEach((t) => {
        if (t.startsWith("cat:")) map.set(t.slice(4), (map.get(t.slice(4)) ?? 0) + 1);
      });
    });
    return map;
  }, [state.cards]);

  /** O(n) parent→children index; avoids O(n²) filter calls in tree render */
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Category[]>();
    for (const cat of categories) {
      const pid = cat.parentId ?? null;
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(cat);
    }
    return map;
  }, [categories]);

  /** Rollup: total cards in subtree (self + all descendants) per category id. */
  const rollupByCatId = useMemo(() => {
    const map = new Map<string, number>();
    const visit = (cat: Category): number => {
      let total = countsByName.get(cat.name) ?? 0;
      const kids = childrenByParent.get(cat.id) ?? [];
      for (const k of kids) total += visit(k);
      map.set(cat.id, total);
      return total;
    };
    for (const root of childrenByParent.get(null) ?? []) visit(root);
    return map;
  }, [categories, childrenByParent, countsByName]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [addingUnder, setAddingUnder] = useState<string | "root" | null>(null);

  useEffect(() => {
    if (!selectedCategory) return;
    const target = categories.find((c) => c.name === selectedCategory);
    if (!target) return;

    const ancestors: string[] = [];
    let cur = target.parentId;
    while (cur) {
      ancestors.push(cur);
      cur = categoriesById.get(cur)?.parentId ?? null;
    }
    if (!ancestors.length) return;
    const ancestorsToOpen = ancestors.filter((id) => !!collapsed[id]);
    if (!ancestorsToOpen.length) return;

    setCollapsed((prev) => {
      let changed = false;
      const next = { ...prev };
      ancestorsToOpen.forEach((id) => {
        if (next[id]) {
          next[id] = false;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    ancestorsToOpen.forEach((id) => {
      void loadCategoryChildren(id, { reason: "user", prefetch: false });
    });
  }, [selectedCategory, categories, categoriesById, collapsed, loadCategoryChildren]);

  const perfStats = getCategoryPerfSnapshot();
  const cacheTotal = perfStats.cacheHits + perfStats.cacheMisses;
  const cacheHitRate = cacheTotal > 0 ? Math.round((perfStats.cacheHits / cacheTotal) * 100) : 0;

  const { confirm, dialog } = useConfirm();

  const handleAdd = (name: string, parentId: string | null) => {
    addCategory(name, parentId);
    toast({ title: "הקטגוריה נוספה", description: name });
    setAddingUnder(null);
  };

  const handleDelete = async (cat: Category) => {
    if (!await confirm(`למחוק את "${cat.name}" וכל תתי-הקטגוריות?`)) return;
    deleteCategory(cat.id);
    if (selectedCategory === cat.name) onSelectCategory(null);
    toast({ title: "נמחקה", description: cat.name });
  };

  const moveSibling = (cat: Category, dir: -1 | 1) => {
    const raw = childrenByParent.get(cat.parentId ?? null) ?? [];
    const siblings = [...raw].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt);
    const idx = siblings.findIndex((c) => c.id === cat.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const newOrder = [...siblings];
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    reorderCategories(newOrder.map((c) => c.id));
  };

  /** Flat list of all currently-visible tree nodes (respects collapse state). */
  type FlatRow = {
    type: "row";
    cat: Category;
    depth: number;
    isFirst: boolean;
    isLast: boolean;
    hasKids: boolean;
    isLoadingChildren: boolean;
  };
  type FlatAddInput = { type: "addinput"; parentId: string | null; depth: number };
  type FlatItem = FlatRow | FlatAddInput;

  const flatItems = useMemo<FlatItem[]>(() => {
    const sortList = (list: Category[]): Category[] => {
      if (sortKey === "manual") return list;
      return [...list].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "name") cmp = (a.name || "").localeCompare(b.name || "", "he");
        else if (sortKey === "count") cmp = (countsByName.get(a.name) ?? 0) - (countsByName.get(b.name) ?? 0);
        return sortDir === "asc" ? cmp : -cmp;
      });
    };
    const items: FlatItem[] = [];
    const walk = (parentId: string | null, depth: number) => {
      const sorted = sortList(childrenByParent.get(parentId) ?? []);
      for (let i = 0; i < sorted.length; i++) {
        const cat = sorted[i];
        const hasKids = getCategoryHasChildren(cat.id) !== false;
        const isLoadingChildren = isCategoryChildrenLoading(cat.id);
        items.push({ type: "row", cat, depth, isFirst: i === 0, isLast: i === sorted.length - 1, hasKids, isLoadingChildren });
        if (addingUnder === cat.id) items.push({ type: "addinput", parentId: cat.id, depth: depth + 1 });
        if (hasKids && !collapsed[cat.id]) walk(cat.id, depth + 1);
      }
    };
    walk(null, 0);
    return items;
  }, [childrenByParent, collapsed, addingUnder, sortKey, sortDir, countsByName, getCategoryHasChildren, isCategoryChildrenLoading]);

  /* ── Virtual scroll setup ── */
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (flatItems[i]?.type === "addinput" ? 40 : 34),
    overscan: 10,
  });

  if (categories.length === 0) {
    return (
      <RootDropTarget empty>
        <p className="text-xs text-muted-foreground text-center py-6">אין קטגוריות עדיין</p>
      </RootDropTarget>
    );
  }

  return (
    <div ref={scrollRef} className={cn("overflow-y-auto -mx-2 px-2", !expanded && "max-h-[420px]")}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const item = flatItems[vItem.index];
          return (
            <div
              key={item.type === "row" ? item.cat.id : `addinput-${vItem.index}`}
              style={{ position: "absolute", top: 0, width: "100%", transform: `translateY(${vItem.start}px)` }}
            >
              {item.type === "addinput" ? (
                <AddInput
                  depth={item.depth}
                  onAdd={(name) => handleAdd(name, item.parentId)}
                  onCancel={() => setAddingUnder(null)}
                />
              ) : (() => {
                const { cat, depth, isFirst, isLast, hasKids, isLoadingChildren } = item;
                const isActive = selectedCategory === cat.name;
                const count = rollupByCatId.get(cat.id) ?? 0;
                const label = getDisplayCategoryLabel(cat, categoriesById);
                return (
                  <>
                    <SiblingDropZone id={`before:${cat.id}`} depth={depth} />
                    <CategoryRow cat={cat} isActive={isActive} depth={depth}>
                      {hasKids ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const nextOpen = !!collapsed[cat.id];
                            setCollapsed((c) => ({ ...c, [cat.id]: !c[cat.id] }));
                            if (nextOpen) void loadCategoryChildren(cat.id, { reason: "user", prefetch: false });
                          }}
                          className="opacity-60 hover:opacity-100"
                        >
                          {collapsed[cat.id]
                            ? <ChevronLeft className="h-3.5 w-3.5" />
                            : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      ) : <span className="w-3.5" />}

                      {hasKids && !collapsed[cat.id]
                        ? <FolderOpen className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-gold" : "text-gold/70")} />
                        : <Folder className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-gold" : "text-gold/70")} />}

                      {isLoadingChildren && !collapsed[cat.id] ? (
                        <Skeleton className="h-3 w-12" />
                      ) : null}

                      <button
                        type="button"
                        onClick={() => onSelectCategory(isActive ? null : cat.name)}
                        className="flex-1 text-right text-sm truncate"
                        title={cat.name}
                      >
                        {label}
                      </button>

                      {count > 0 && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] h-4 px-1.5 border shrink-0",
                            isActive ? "border-gold/60 text-primary-foreground" : "border-gold/50",
                          )}
                        >
                          {count}
                        </Badge>
                      )}
                      {/* While Phase 2 backfill is loading more cards, show a tiny
                          skeleton instead of "0" — the real count may still grow. */}
                      {count === 0 && !cardsFullyLoaded && (
                        <Skeleton className="h-4 w-6 rounded-md shrink-0" />
                      )}

                      <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5">
                        <button
                          type="button" title="הזז למעלה" disabled={isFirst}
                          className="h-6 w-6 rounded-full flex items-center justify-center bg-secondary text-muted-foreground hover:bg-gold/20 hover:text-gold hover:scale-110 active:scale-95 transition-all shadow-sm shrink-0 disabled:opacity-20 disabled:cursor-default"
                          onClick={(e) => { e.stopPropagation(); moveSibling(cat, -1); }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button" title="הזז למטה" disabled={isLast}
                          className="h-6 w-6 rounded-full flex items-center justify-center bg-secondary text-muted-foreground hover:bg-gold/20 hover:text-gold hover:scale-110 active:scale-95 transition-all shadow-sm shrink-0 disabled:opacity-20 disabled:cursor-default"
                          onClick={(e) => { e.stopPropagation(); moveSibling(cat, 1); }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>

                        {onAddCardToCategory && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onAddCardToCategory(cat.name); }}
                            title={`שאלה חדשה ב"${label}"`}
                            className="h-6 w-6 rounded-full flex items-center justify-center bg-gold text-navy hover:brightness-110 hover:scale-110 active:scale-95 transition-all shadow-sm shrink-0"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {onStudyCategory && count > 0 && (
                          <button
                            type="button"
                            title={`תרגול מ"${cat.name}"`}
                            className="h-6 w-6 rounded-full flex items-center justify-center bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/30 hover:scale-110 active:scale-95 transition-all shadow-sm shrink-0"
                            onClick={(e) => { e.stopPropagation(); onStudyCategory(cat.name); }}
                          >
                            <ListChecks className="h-3.5 w-3.5" />
                          </button>
                        )}

                        <button
                          type="button" title="הוסף תת-קטגוריה"
                          className="h-6 w-6 rounded-full flex items-center justify-center bg-secondary text-muted-foreground hover:bg-gold/20 hover:text-gold hover:scale-110 active:scale-95 transition-all shadow-sm shrink-0"
                          onClick={(e) => { e.stopPropagation(); setAddingUnder(addingUnder === cat.id ? null : cat.id); }}
                        >
                          <FolderPlus className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button" title="מחק קטגוריה"
                          className="h-6 w-6 rounded-full flex items-center justify-center bg-destructive/10 text-destructive hover:bg-destructive/25 hover:scale-110 active:scale-95 transition-all shadow-sm shrink-0"
                          onClick={(e) => { e.stopPropagation(); handleDelete(cat); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </CategoryRow>
                    {isLast && <SiblingDropZone id={`after:${cat.id}`} depth={depth} />}
                  </>
                );
              })()}
            </div>
          );
        })}
      </div>

      <RootDropTarget>
        {addingUnder === "root" ? (
          <AddInput depth={0} onAdd={(name) => handleAdd(name, null)} onCancel={() => setAddingUnder(null)} />
        ) : (
          <div className="rounded-lg border-2 border-dashed border-gold/20 p-1 mt-1">
            <p className="text-[10px] text-muted-foreground text-center py-1">
              ⬇ גרור לכאן להפוך לקטגוריה ראשית
            </p>
          </div>
        )}
      </RootDropTarget>

      {import.meta.env.DEV ? (
        <div className="mt-2 text-[10px] text-muted-foreground text-center">
          קטגוריות: P50 {perfStats.p50Ms}ms | P95 {perfStats.p95Ms}ms | last {perfStats.lastMs ?? 0}ms | hit {cacheHitRate}% ({perfStats.persistedHits} persisted) | stale {perfStats.staleDropped} | aborted {perfStats.aborted} | prefetch-throttle {perfStats.prefetchThrottled} | in-flight {perfStats.inFlight}
        </div>
      ) : null}
      {dialog}
    </div>
  );
}
