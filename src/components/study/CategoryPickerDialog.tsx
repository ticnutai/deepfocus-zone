/**
 * CategoryPickerDialog — select one or more existing categories from a tree.
 * Used from CardEditor's "+" button so the user can pick categories without
 * leaving the card creation flow.
 */
import { useState, useMemo, useEffect, useCallback } from "react";
import { Search, Folder, FolderOpen, ChevronDown, ChevronLeft, Pin, PinOff, Check, LayoutGrid, FolderTree, ChevronsDown, Plus, Clock3 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useStudy } from "@/lib/study/store";
import type { Category } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { displayCategoryName } from "@/lib/study/shasGen";

const RECENT_KEY = "category-picker:recent-cats";
const MAX_RECENT = 6;

type ClassificationViewMode = "tree" | "cards";

interface Props {
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  inline?: boolean;
  /** Currently-selected category names (controlled from outside) */
  selected: string[];
  /** Called when the user confirms their selection */
  onConfirm: (names: string[]) => void;
}

export function CategoryPickerDialog({ open, onOpenChange, inline = false, selected: initialSelected, onConfirm }: Props) {
  const { state, setUiPref } = useStudy();
  const isOpen = inline ? true : !!open;

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [classificationView, setClassificationView] = useState<ClassificationViewMode>("cards");
  const [cardsPath, setCardsPath] = useState<string[]>([]);
  const [localSelected, setLocalSelected] = useState<string[]>(initialSelected);
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      return raw ? (JSON.parse(raw) as string[]).slice(0, MAX_RECENT) : [];
    } catch {
      return [];
    }
  });

  const pushRecent = useCallback((names: string[]) => {
    if (!names.length) return;
    setRecent((prev) => {
      const next = [...names, ...prev.filter((n) => !names.includes(n))].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // ignore localStorage failures
      }
      return next;
    });
  }, []);

  // Reset local state when dialog opens
  const handleOpenChange = (o: boolean) => {
    if (inline) return;
    if (o) {
      setLocalSelected(initialSelected);
      setSearch("");
      setExpanded({});
      setCardsPath([]);
      setClassificationView("cards");
    }
    onOpenChange?.(o);
  };

  useEffect(() => {
    if (!isOpen || inline) return;
    setLocalSelected(initialSelected);
  }, [isOpen, inline, initialSelected]);

  const categories = useMemo(
    () => [...(state.categories ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt),
    [state.categories],
  );

  const HVAL: Record<string, number> = {
    "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
    "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50, "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90,
    "ק": 100, "ר": 200, "ש": 300, "ת": 400,
  };
  const hebrewToNum = (s: string) => [...s].reduce((sum, ch) => sum + (HVAL[ch] ?? 0), 0);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Category[]>();
    for (const c of categories) {
      const arr = map.get(c.parentId) ?? [];
      arr.push(c);
      map.set(c.parentId, arr);
    }
    for (const [pid, list] of map.entries()) {
      const sorted = [...list].sort((a, b) => {
        const an = hebrewToNum(displayCategoryName(a.name));
        const bn = hebrewToNum(displayCategoryName(b.name));
        if (an !== 0 || bn !== 0) return an - bn;
        return displayCategoryName(a.name).localeCompare(displayCategoryName(b.name), "he");
      });
      map.set(pid, sorted);
    }
    return map;
  }, [categories]);

  const childrenOf = useCallback((pid: string | null) => childrenByParent.get(pid) ?? [], [childrenByParent]);

  const pinnedCats = state.uiPrefs?.pinnedCats ?? [];

  const togglePin = (name: string) => {
    const cur = state.uiPrefs?.pinnedCats ?? [];
    setUiPref("pinnedCats", cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]);
  };

  const toggle = (name: string) => {
    setLocalSelected((arr) => {
      const next = arr.includes(name) ? arr.filter((x) => x !== name) : [...arr, name];
      if (inline) onConfirm(next);
      return next;
    });
  };

  const validNames = useMemo(() => new Set(categories.map((c) => c.name)), [categories]);
  const recentExisting = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of recent) {
      if (!validNames.has(n) || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  }, [recent, validNames]);

  const countsMap = useMemo(() => {
    if (categories.length === 0) return new Map<string, number>();

    const direct = new Map<string, number>();
    for (const card of state.cards ?? []) {
      for (const tag of card.tags ?? []) {
        if (tag.startsWith("cat:")) {
          const n = tag.slice(4);
          direct.set(n, (direct.get(n) ?? 0) + 1);
        }
      }
    }

    const total = new Map<string, number>();
    const byId = new Map<string, Category>();
    for (const c of categories) byId.set(c.id, c);

    const countFor = (cat: Category): number => {
      if (total.has(cat.id)) return total.get(cat.id)!;
      const d = direct.get(cat.name) ?? 0;
      const kids = childrenByParent.get(cat.id) ?? [];
      const sum = d + kids.reduce((acc, k) => acc + countFor(k), 0);
      total.set(cat.id, sum);
      return sum;
    };

    for (const cat of byId.values()) countFor(cat);
    return total;
  }, [state.cards, categories, childrenByParent]);

  const matchesSearch = (cat: Category, q: string): boolean => {
    if (!q) return true;
    if (displayCategoryName(cat.name).toLowerCase().includes(q)) return true;
    return childrenOf(cat.id).some((child) => matchesSearch(child, q));
  };

  const renderNode = (cat: Category, depth: number) => {
    const q = search.trim().toLowerCase();
    if (q && !matchesSearch(cat, q)) return null;
    const kids = childrenOf(cat.id);
    const hasKids = kids.length > 0;
    const isExpanded = q ? true : !!expanded[cat.id];
    const isSelected = localSelected.includes(cat.name);
    const isPinned = pinnedCats.includes(cat.name);
    const label = displayCategoryName(cat.name);

    return (
      <div key={cat.id}>
        <div
          style={{ paddingRight: `${depth * 16 + 4}px` }}
          className={cn(
            "flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer transition-all group select-none",
            isSelected ? "bg-navy/10 ring-1 ring-navy/30" : "hover:bg-secondary",
          )}
          onClick={() => toggle(cat.name)}
        >
          {/* expand toggle */}
          {hasKids ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((p) => ({ ...p, [cat.id]: !p[cat.id] }));
              }}
              className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {/* folder icon */}
          {isExpanded && hasKids
            ? <FolderOpen className="h-3.5 w-3.5 text-gold shrink-0" />
            : <Folder className="h-3.5 w-3.5 text-gold/70 shrink-0" />}

          {/* name */}
          <span className={cn("flex-1 text-sm text-right truncate", (countsMap.get(cat.id) ?? 0) === 0 && "text-muted-foreground")} title={cat.name}>{label}</span>

          {/* question count badge */}
          {(countsMap.get(cat.id) ?? 0) > 0
            ? <span className="text-[10px] font-semibold text-white bg-navy rounded px-1.5 py-0.5 shrink-0 tabular-nums leading-none">{countsMap.get(cat.id)}</span>
            : <span className="text-[10px] text-muted-foreground/40 shrink-0">-</span>
          }

          {/* pin button */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); togglePin(cat.name); }}
            title={isPinned ? "בטל נעיצה" : "נעץ קטגוריה"}
            className={cn(
              "h-5 w-5 rounded flex items-center justify-center transition-all shrink-0",
              isPinned ? "text-navy opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground",
            )}
          >
            {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3 fill-navy" />}
          </button>

          {/* checkbox */}
          <div className={cn(
            "h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-all",
            isSelected ? "border-navy bg-navy" : "border-muted-foreground/40",
          )}>
            {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
          </div>
        </div>

        {isExpanded && kids.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const topLevelCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return childrenOf(null).filter((cat) => !q || matchesSearch(cat, q));
  }, [childrenOf, search]);

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  const normalizedCardsPath = useMemo(() => {
    const out: string[] = [];
    let expectedParent: string | null = null;
    for (const id of cardsPath) {
      const cat = categoryById.get(id);
      if (!cat || cat.parentId !== expectedParent) break;
      out.push(id);
      expectedParent = id;
    }
    return out;
  }, [cardsPath, categoryById]);

  useEffect(() => {
    if (normalizedCardsPath.length !== cardsPath.length) {
      setCardsPath(normalizedCardsPath);
    }
  }, [normalizedCardsPath, cardsPath.length]);

  const cardsParentId = normalizedCardsPath.length > 0 ? normalizedCardsPath[normalizedCardsPath.length - 1] : null;
  const cardsLevelCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    const level = childrenOf(cardsParentId);
    return q ? level.filter((cat) => matchesSearch(cat, q)) : level;
  }, [cardsParentId, childrenOf, search]);

  const cardsBreadcrumb = useMemo(
    () => normalizedCardsPath.map((id) => categoryById.get(id)).filter((c): c is Category => !!c),
    [normalizedCardsPath, categoryById],
  );

  const enterCardsCategory = useCallback((cat: Category) => {
    if (childrenOf(cat.id).length === 0) return;
    setCardsPath([...normalizedCardsPath, cat.id]);
  }, [childrenOf, normalizedCardsPath]);

  const expandFirstLevel = useCallback(() => {
    setExpanded(Object.fromEntries(topLevelCategories.map((cat) => [cat.id, true])));
    setCardsPath([]);
  }, [topLevelCategories]);

  const hasExpandedBranches = useMemo(() => Object.values(expanded).some(Boolean), [expanded]);

  const pickerContent = (
    <>
      <div className="space-y-1.5">
        <div className="flex flex-row-reverse items-center justify-between gap-2">
          <div className="flex items-center gap-2 opacity-0 pointer-events-none translate-y-0.5 transition-all duration-150 group-hover/classification:opacity-100 group-hover/classification:pointer-events-auto group-hover/classification:translate-y-0 focus-within:opacity-100 focus-within:pointer-events-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="h-8 gap-1 rounded-full border-2 border-gold/50 px-2" title="תצוגות ופריסות סיווג">
                  <LayoutGrid className="h-4 w-4" />
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                <DropdownMenuItem className="gap-2" onClick={() => setClassificationView("cards")}>
                  <LayoutGrid className="h-4 w-4" /> כרטיסיות ענפים {classificationView === "cards" ? "✓" : ""}
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={() => setClassificationView("tree")}>
                  <FolderTree className="h-4 w-4" /> עץ קומפקטי {classificationView === "tree" ? "✓" : ""}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-7 w-7 rounded-full border-2 border-gold/40"
              onClick={expandFirstLevel}
              title="פתח רמה ראשונה בלבד"
            >
              <ChevronsDown className="h-3.5 w-3.5" />
            </Button>

            <Button
              type="button"
              size="icon"
              variant="outline"
              className={cn(
                "h-7 w-7 rounded-full border-2 transition-all",
                hasExpandedBranches ? "border-navy bg-navy/10 text-navy" : "border-gold/40",
              )}
              onClick={() => setExpanded({})}
              title="כווץ את כל הענפים"
            >
              <Plus className={cn("h-3.5 w-3.5 transition-transform duration-200", hasExpandedBranches && "rotate-45")} />
            </Button>
          </div>

          <h3 className="text-right text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
            <Folder className="h-4 w-4 text-gold" />
            סיווג {localSelected.length > 0 && <span className="text-xs text-muted-foreground">({localSelected.length} נבחרו)</span>}
          </h3>
        </div>
      </div>

      <div className="space-y-3">
        <div className="relative rounded-lg border-2 border-gold/40 overflow-hidden focus-within:border-gold">
          <Search className="h-3.5 w-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חפש קטגוריה..."
            className="h-9 text-sm border-0 pr-8 focus-visible:ring-0"
            autoFocus={!inline}
          />
        </div>

        <div className="space-y-3">
          <section className="space-y-3">
            <div className="text-xs text-muted-foreground border border-gold/20 rounded-md px-2 py-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button type="button" className="hover:underline" onClick={() => setCardsPath([])}>סיווג</button>
                <span>/</span>
                <button type="button" className="hover:underline" onClick={() => setCardsPath([])}>ראשי</button>
                {cardsBreadcrumb.map((cat, idx) => (
                  <span key={cat.id} className="inline-flex items-center gap-1.5">
                    <span>/</span>
                    <button type="button" className="hover:underline" onClick={() => setCardsPath(normalizedCardsPath.slice(0, idx + 1))}>
                      {displayCategoryName(cat.name)}
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {classificationView === "cards" && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 max-h-[52vh] overflow-y-auto pr-0.5">
                {cardsLevelCategories.map((root) => {
                  const isSelected = localSelected.includes(root.name);
                  const count = countsMap.get(root.id) ?? 0;
                  const hasChildren = childrenOf(root.id).length > 0;
                  const isPinned = pinnedCats.includes(root.name);
                  return (
                    <div key={root.id} className="group/card relative rounded-xl border-2 border-gold/30 bg-card overflow-hidden">
                      <div className="absolute top-2 left-2 z-20 flex items-center gap-1 opacity-0 pointer-events-none transition-opacity duration-150 group-hover/card:opacity-100 group-hover/card:pointer-events-auto group-focus-within/card:opacity-100 group-focus-within/card:pointer-events-auto">
                        <button
                          type="button"
                          title={isSelected ? "הסר בחירה" : "בחר קטגוריה"}
                          className={cn(
                            "h-7 w-7 rounded-full border flex items-center justify-center bg-background/95 backdrop-blur-sm transition-colors",
                            isSelected ? "border-navy text-navy" : "border-gold/50 text-muted-foreground hover:text-foreground hover:border-gold",
                          )}
                          onClick={(e) => { e.stopPropagation(); toggle(root.name); }}
                        >
                          <Check className={cn("h-3.5 w-3.5", isSelected && "fill-navy text-navy")} />
                        </button>
                        <button
                          type="button"
                          title={isPinned ? "בטל נעיצה" : "נעץ קטגוריה"}
                          className={cn(
                            "h-7 w-7 rounded-full border flex items-center justify-center bg-background/95 backdrop-blur-sm transition-colors",
                            isPinned ? "border-navy text-navy" : "border-gold/50 text-muted-foreground hover:text-foreground hover:border-gold",
                          )}
                          onClick={(e) => { e.stopPropagation(); togglePin(root.name); }}
                        >
                          {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <button
                        type="button"
                        className={cn("w-full p-3 text-right transition-colors hover:bg-secondary/30", isSelected && "bg-navy/10")}
                        onClick={() => enterCardsCategory(root)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-7 w-7 rounded-full border border-gold/50 flex items-center justify-center shrink-0">
                            {hasChildren ? <ChevronLeft className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                          </span>
                          <Folder className="h-4 w-4 text-gold shrink-0" />
                          <span className="flex-1 font-semibold truncate">{displayCategoryName(root.name)}</span>
                          {count > 0 ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-navy text-white">{count}</span> : null}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {classificationView === "tree" && (
              <div className="rounded-lg border-2 border-gold/30 bg-card overflow-hidden">
                <div className="max-h-[52vh] overflow-y-auto p-1.5">
                  {categories.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">אין קטגוריות עדיין</p>
                  ) : (
                    childrenOf(null).map((cat) => renderNode(cat, 0))
                  )}
                </div>
              </div>
            )}

            <aside className="space-y-3 rounded-xl border-2 border-gold/25 bg-card p-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">מוצמדים</div>
                <div className="flex flex-wrap gap-1.5">
                  {pinnedCats.length === 0 ? (
                    <span className="text-xs text-muted-foreground">אין נעיצות</span>
                  ) : (
                    pinnedCats.map((catName) => (
                      <button
                        key={catName}
                        type="button"
                        onClick={() => toggle(catName)}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border",
                          localSelected.includes(catName) ? "border-navy bg-navy/10 text-navy" : "border-gold/40 hover:border-gold",
                        )}
                      >
                        <Pin className="h-3 w-3" />
                        <span className="truncate max-w-[120px]">{catName}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">נבחרו לאחרונה</div>
                <div className="flex flex-wrap gap-1.5">
                  {recentExisting.length === 0 ? (
                    <span className="text-xs text-muted-foreground">אין היסטוריה</span>
                  ) : (
                    recentExisting.map((catName) => (
                      <button
                        key={catName}
                        type="button"
                        onClick={() => toggle(catName)}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border",
                          localSelected.includes(catName) ? "border-navy bg-navy/10 text-navy" : "border-gold/40 hover:border-gold",
                        )}
                      >
                        <Clock3 className="h-3 w-3" />
                        <span className="truncate max-w-[120px]">{catName}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </aside>
          </section>

        </div>
      </div>
    </>
  );

  if (inline) {
    return <div className="space-y-3">{pickerContent}</div>;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal={false}>
      <DialogContent
        showOverlay={false}
        onEscapeKeyDown={() => onOpenChange?.(false)}
        className="max-w-5xl w-[min(95vw,1200px)]"
        dir="rtl"
      >
        {pickerContent}

        <DialogFooter className="flex-row-reverse gap-2 sm:gap-2">
          <Button
            onClick={() => {
              onConfirm(localSelected);
              pushRecent(localSelected);
              onOpenChange(false);
            }}
            className="bg-gradient-navy text-primary-foreground"
          >
            <Check className="h-4 w-4 ml-1" /> אישור
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
