/**
 * CategoryPickerDialog — select one or more existing categories from a tree.
 * Used from CardEditor's "+" button so the user can pick categories without
 * leaving the card creation flow.
 */
import { useState, useMemo } from "react";
import { Search, Folder, FolderOpen, ChevronDown, ChevronLeft, Pin, PinOff, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStudy } from "@/lib/study/store";
import type { Category } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { displayCategoryName } from "@/lib/study/shasGen";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Currently-selected category names (controlled from outside) */
  selected: string[];
  /** Called when the user confirms their selection */
  onConfirm: (names: string[]) => void;
}

export function CategoryPickerDialog({ open, onOpenChange, selected: initialSelected, onConfirm }: Props) {
  const { state, setUiPref } = useStudy();

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [localSelected, setLocalSelected] = useState<string[]>(initialSelected);

  // Reset local state when dialog opens
  const handleOpenChange = (o: boolean) => {
    if (o) {
      setLocalSelected(initialSelected);
      setSearch("");
      setExpanded({});
    }
    onOpenChange(o);
  };

  const categories = useMemo(
    () => [...(state.categories ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt),
    [state.categories],
  );

  const childrenOf = (pid: string | null) => categories.filter((c) => c.parentId === pid);

  const pinnedCats = state.uiPrefs?.pinnedCats ?? [];

  const togglePin = (name: string) => {
    const cur = state.uiPrefs?.pinnedCats ?? [];
    setUiPref("pinnedCats", cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]);
  };

  const toggle = (name: string) => {
    setLocalSelected((arr) => arr.includes(name) ? arr.filter((x) => x !== name) : [...arr, name]);
  };

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
          <span className="flex-1 text-sm text-right truncate" title={cat.name}>{label}</span>

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

  const pinnedExisting = pinnedCats.filter((n) => categories.some((c) => c.name === n));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2">
            <Folder className="h-4 w-4 text-gold" />
            סיווג
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Pinned */}
          {pinnedExisting.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border-2 border-navy/30 bg-secondary/20 p-1.5">
              <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <Pin className="h-3 w-3 text-navy" /> נעוצים:
              </span>
              {pinnedExisting.map((n) => {
                const active = localSelected.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggle(n)}
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[11px] border-2 transition-all",
                      active ? "border-navy bg-gradient-navy text-primary-foreground" : "border-navy/40 bg-card hover:border-navy",
                    )}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          )}

          {/* Search */}
          <div className="relative rounded-lg border-2 border-gold/40 overflow-hidden focus-within:border-gold">
            <Search className="h-3.5 w-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חפש קטגוריה..."
              className="h-9 text-sm border-0 pr-8 focus-visible:ring-0"
              autoFocus
            />
          </div>

          {/* Tree */}
          <div className="rounded-lg border-2 border-gold/30 bg-card max-h-72 overflow-y-auto p-1.5">
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">אין קטגוריות עדיין</p>
            ) : (
              childrenOf(null).map((cat) => renderNode(cat, 0))
            )}
          </div>

          {/* Selected chips */}
          {localSelected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground self-center">נבחרו:</span>
              {localSelected.map((n) => (
                <span key={n} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border-2 border-navy bg-gradient-navy text-primary-foreground">
                  {n}
                  <button type="button" onClick={() => toggle(n)} className="hover:opacity-70">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row-reverse gap-2 sm:gap-2">
          <Button
            onClick={() => { onConfirm(localSelected); onOpenChange(false); }}
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
