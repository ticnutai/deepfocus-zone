import { useState, useMemo, useEffect } from "react";
import { Plus, Search, X, FolderTree, Check, Pin, PinOff, ChevronDown, ChevronLeft, Folder, FolderOpen } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useStudy } from "@/lib/study/store";
import type { Category } from "@/lib/study/types";
import { UNCATEGORIZED_NAME } from "@/lib/study/uncategorized";
import { cn } from "@/lib/utils";
import { displayCategoryName } from "@/lib/study/shasGen";

const RECENT_KEY = "deck-create:recent-cats";
const MAX_RECENT = 6;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (deckId: string) => void;
}

export function DeckCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const { state, addDeck, updateDeckCategoryIds, setUiPref, ensureUncategorized } = useStudy();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [noClassification, setNoClassification] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const [treeSearch, setTreeSearch] = useState("");
  const [treeExpanded, setTreeExpanded] = useState<Record<string, boolean>>({});

  // Recent (localStorage)
  const [recent, setRecent] = useState<string[]>(() => {
    try { const raw = localStorage.getItem(RECENT_KEY); return raw ? (JSON.parse(raw) as string[]).slice(0, MAX_RECENT) : []; }
    catch { return []; }
  });
  const pushRecent = (names: string[]) => {
    if (!names.length) return;
    setRecent((prev) => {
      const next = [...names, ...prev.filter((n) => !names.includes(n))].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Pinned (synced via uiPrefs.pinnedCats)
  const pinnedCats = state.uiPrefs?.pinnedCats ?? [];
  const togglePinCategory = (n: string) => {
    const cur = state.uiPrefs?.pinnedCats ?? [];
    setUiPref("pinnedCats", cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]);
  };

  useEffect(() => {
    if (open) {
      setName(""); setSelected([]); setNoClassification(false);
      setShowTree(false); setTreeSearch(""); setTreeExpanded({});
    }
  }, [open]);

  const categories = useMemo(
    () => [...(state.categories ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt),
    [state.categories],
  );
  const childrenOf = (pid: string | null) => categories.filter((c) => c.parentId === pid);
  const validNames = useMemo(() => new Set(categories.map((c) => c.name)), [categories]);
  const pinnedExisting = useMemo(() => pinnedCats.filter((n) => validNames.has(n)), [pinnedCats, validNames]);
  const recentExisting = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of recent) {
      if (!validNames.has(n) || seen.has(n)) continue;
      seen.add(n); out.push(n);
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  }, [recent, validNames]);

  const toggle = (catName: string) => {
    setSelected((arr) => arr.includes(catName) ? arr.filter((x) => x !== catName) : [...arr, catName]);
    setNoClassification(false);
  };

  // Does this category or any descendant match the search?
  const matchesSearch = (cat: Category, q: string): boolean => {
    if (!q) return true;
    if (displayCategoryName(cat.name).toLowerCase().includes(q)) return true;
    return childrenOf(cat.id).some((child) => matchesSearch(child, q));
  };

  const renderTreeNode = (cat: Category, depth: number) => {
    const q = treeSearch.trim().toLowerCase();
    if (q && !matchesSearch(cat, q)) return null;
    const allKids = childrenOf(cat.id);
    const hasKids = allKids.length > 0;
    const isExpanded = q ? true : !!treeExpanded[cat.id];
    const isSelected = selected.includes(cat.name);
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
              onClick={(e) => { e.stopPropagation(); setTreeExpanded((p) => ({ ...p, [cat.id]: !p[cat.id] })); }}
              className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-4 shrink-0" />}

          {/* folder icon */}
          {isExpanded && hasKids
            ? <FolderOpen className="h-3.5 w-3.5 text-gold shrink-0" />
            : <Folder className="h-3.5 w-3.5 text-gold/70 shrink-0" />}

          {/* name */}
          <span className="flex-1 text-sm text-right truncate" title={cat.name}>{label}</span>

          {/* pin button */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); togglePinCategory(cat.name); }}
            title={isPinned ? "בטל נעיצה" : "נעץ קטגוריה"}
            className={cn(
              "h-5 w-5 rounded flex items-center justify-center transition-all shrink-0",
              isPinned ? "text-navy opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground",
            )}
          >
            <Pin className={cn("h-3 w-3", isPinned && "fill-navy")} />
          </button>

          {/* checkbox */}
          <div className={cn(
            "h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-all",
            isSelected ? "border-navy bg-navy" : "border-muted-foreground/40",
          )}>
            {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
          </div>
        </div>
        {/* recursive children */}
        {isExpanded && allKids.map((child) => renderTreeNode(child, depth + 1))}
      </div>
    );
  };

  const canSave = name.trim().length > 0 && (noClassification || selected.length > 0);

  const handleSave = () => {
    if (!canSave) return;
    let cats: string[];
    let catIds: string[] = [];
    if (noClassification) {
      ensureUncategorized();
      cats = [UNCATEGORIZED_NAME];
      const uncatId = (state.categories ?? []).find((c) => c.parentId === null && c.name === UNCATEGORIZED_NAME)?.id;
      if (uncatId) catIds = [uncatId];
    } else {
      cats = selected;
      catIds = categories.filter((c) => selected.includes(c.name)).map((c) => c.id);
    }
    const deck = addDeck(name.trim(), undefined, cats);
    if (catIds.length > 0) updateDeckCategoryIds(deck.id, catIds, true);
    if (!noClassification && selected.length > 0) pushRecent(selected);
    onCreated?.(deck.id);
    onOpenChange(false);
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">מערכת חדשה</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Deck name */}
          <div className="space-y-2">
            <Label className="block text-right">שם המערכת</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="לדוג: גמרא, מסכת ברכות..."
              className="border-2 border-gold/40 text-right"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && canSave) handleSave(); }}
            />
          </div>

          {/* Classification */}
          <div className="space-y-2">
            {/* Header row */}
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button" size="icon" variant="outline"
                className={cn(
                  "h-7 w-7 rounded-full border-2 transition-all",
                  showTree ? "border-navy bg-navy/10 text-navy" : "border-gold/40",
                )}
                onClick={() => setShowTree((v) => !v)}
                title="בחר קטגוריה מהעץ"
              >
                <Plus className={cn("h-3.5 w-3.5 transition-transform duration-200", showTree && "rotate-45")} />
              </Button>
              <Label className="text-right flex items-center gap-2">
                <FolderTree className="h-4 w-4 text-gold" />
                סיווג {selected.length > 0 && <span className="text-xs text-muted-foreground">({selected.length} נבחרו)</span>}
              </Label>
            </div>

            {/* Pinned row */}
            {pinnedExisting.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border-2 border-navy/40 bg-secondary/20 p-1.5">
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Pin className="h-3 w-3 text-navy" /> נעוצים:
                </span>
                {pinnedExisting.map((n) => {
                  const active = selected.includes(n);
                  return (
                    <span key={n} className="inline-flex items-center group">
                      <button
                        type="button"
                        onClick={() => toggle(n)}
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[11px] border-2 transition-all",
                          active ? "border-navy bg-gradient-navy text-primary-foreground" : "border-navy/40 bg-card hover:border-navy",
                        )}
                      >
                        {n}
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePinCategory(n)}
                        title="בטל נעיצה"
                        className="opacity-0 group-hover:opacity-100 -mr-1 p-0.5 rounded hover:bg-secondary"
                      >
                        <PinOff className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Recent row (hidden when tree is open) */}
            {recentExisting.length > 0 && !showTree && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gold/30 bg-card p-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">לאחרונה:</span>
                {recentExisting.map((n) => {
                  const active = selected.includes(n);
                  const isPinned = pinnedCats.includes(n);
                  return (
                    <span key={n} className="inline-flex items-center group">
                      <button
                        type="button"
                        onClick={() => toggle(n)}
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[11px] border-2 transition-all",
                          active ? "border-navy bg-gradient-navy text-primary-foreground" : "border-gold/40 bg-secondary hover:border-gold",
                        )}
                      >
                        {n}
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePinCategory(n)}
                        title={isPinned ? "בטל נעיצה" : "נעץ"}
                        className="opacity-0 group-hover:opacity-100 -mr-1 p-0.5 rounded hover:bg-secondary"
                      >
                        {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Tree picker panel */}
            {showTree && (
              <div className="rounded-lg border-2 border-gold/30 bg-card overflow-hidden">
                {/* Search bar */}
                <div className="relative border-b border-gold/20 p-2">
                  <Search className="h-3.5 w-3.5 absolute right-4 top-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={treeSearch}
                    onChange={(e) => setTreeSearch(e.target.value)}
                    placeholder="חפש קטגוריה..."
                    className="h-7 text-xs border-gold/30 pr-7"
                    autoFocus
                  />
                </div>
                {/* Tree */}
                <div className="max-h-56 overflow-y-auto p-1.5">
                  {categories.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">אין קטגוריות עדיין</p>
                  ) : (
                    childrenOf(null).map((cat) => renderTreeNode(cat, 0))
                  )}
                </div>
              </div>
            )}

            {/* Selected chips */}
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground self-center">נבחרו:</span>
                {selected.map((n) => (
                  <span key={n} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border-2 border-navy bg-gradient-navy text-primary-foreground">
                    {n}
                    <button type="button" onClick={() => toggle(n)} className="hover:opacity-70">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* ללא סיווג */}
            <label className={cn(
              "flex items-center gap-2 cursor-pointer rounded-lg border-2 px-3 py-2 transition-all",
              noClassification ? "border-gold bg-gold/10" : "border-gold/30 hover:border-gold/60",
            )}>
              <Checkbox
                checked={noClassification}
                onCheckedChange={(c) => { const next = !!c; setNoClassification(next); if (next) setSelected([]); }}
              />
              <span className="text-sm">ללא סיווג <span className="text-[10px] text-muted-foreground">(הוסף את הקטגוריה המיוחדת "ללא סיווג")</span></span>
            </label>

            {!canSave && name.trim() && (
              <p className="text-xs text-destructive text-right">יש לבחור לפחות קטגוריה אחת או לסמן "ללא סיווג"</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-row-reverse">
          <Button onClick={handleSave} disabled={!canSave} className="bg-gradient-navy text-primary-foreground">
            <Check className="h-4 w-4 ml-1" /> צור מערכת
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
