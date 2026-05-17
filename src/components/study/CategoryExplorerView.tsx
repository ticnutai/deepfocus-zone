import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useDroppable, useDndContext, useDraggable } from "@dnd-kit/core";
import {
  Folder, FolderOpen, ChevronLeft, ChevronRight, ChevronDown, FileText, Plus, Home,
  LayoutGrid, List as ListIcon, Columns3, Edit3, Copy, Trash2, FolderPlus,
  CheckSquare, Square, ArrowRightLeft, Star, Search, History, ArrowUpDown,
  Upload, Download, Sparkles, X, Eye, EyeOff, Layers, Pencil, ListChecks,
  ZoomIn, ZoomOut, Brain, BarChart2, Check, SlidersHorizontal,
} from "lucide-react";
import { CategoryTemplatesDialog } from "./CategoryTemplatesDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useStudy } from "@/lib/study/store";
import type { Category, Card as StudyCard } from "@/lib/study/types";
import { cn, toHebrewDate } from "@/lib/utils";
import { displayCategoryName } from "@/lib/study/shasGen";
import { isUncategorized } from "@/lib/study/uncategorized";
import { CategoryCardPickerDialog } from "./CategoryCardPickerDialog";
import { toast } from "@/hooks/use-toast";

interface Props {
  selectedCategory: string | null;
  onSelectCategory: (name: string | null) => void;
  onAddCardToCategory: (catName: string) => void;
  onEditCard?: (card: StudyCard) => void;
  activeDeckId?: string | null;
  onStudyCategory?: (catName: string) => void;
  onStudyMultipleCategories?: (catNames: string[], filter?: "all" | "due" | "failed") => void;
}

type LayoutMode = "grid" | "list" | "columns";
type IconSize = "sm" | "md" | "lg";
type SortKey = "manual" | "name" | "created" | "count" | "mastery";

const ICON_PX: Record<IconSize, { folder: number; tile: string; gridCols: string }> = {
  sm: { folder: 36, tile: "p-2",  gridCols: "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8" },
  md: { folder: 64, tile: "p-4",  gridCols: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" },
  lg: { folder: 96, tile: "p-6",  gridCols: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" },
};

/* === SmartFolder type === */
interface SmartFolder {
  id: string;
  name: string;
  query: string;          // text search
  scope: "all" | "failed" | "due" | "mastered" | "new";
  catName?: string | null;
}

/* === LocalStorage prefs === */
const PREFS_KEY = "category-explorer-prefs-v2";
interface ExplorerPrefs {
  favorites: string[];           // category ids
  smartFolders: SmartFolder[];
  layout: LayoutMode;
  iconSize: IconSize;
  sortKey: SortKey;
  sortDesc: boolean;
  showPreview: boolean;
  uiScale: number;
  showCounts: boolean;
  showMastery: boolean;
  favoritesFirst: boolean;
  hideEmpty: boolean;
  compactRows: boolean;
}
const defaultPrefs: ExplorerPrefs = {
  favorites: [], smartFolders: [], layout: "grid", iconSize: "md",
  sortKey: "manual", sortDesc: false, showPreview: true, uiScale: 1.0,
  showCounts: true, showMastery: true, favoritesFirst: true, hideEmpty: false, compactRows: false,
};
function loadPrefs(): ExplorerPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs;
    return { ...defaultPrefs, ...JSON.parse(raw) };
  } catch { return defaultPrefs; }
}
function savePrefs(p: ExplorerPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/* === Mastery % === */
function masteryOf(card: StudyCard): number {
  const t = card.stats.totalReviews;
  if (!t) return 0;
  return Math.round((card.stats.correct / t) * 100);
}

/* === Sidebar tree row === */
function SidebarRow({
  cat, depth, hasKids, isOpen, isSelected, count, isFavorite,
  isRenaming, onRenameSubmit, onCancelRename,
  onToggle, onSelect, onContext, onAdd,
}: {
  cat: Category; depth: number; hasKids: boolean; isOpen: boolean;
  isSelected: boolean; count: number; isFavorite: boolean;
  isRenaming?: boolean; onRenameSubmit?: (name: string) => void; onCancelRename?: () => void;
  onToggle: () => void; onSelect: () => void; onContext: (cat: Category) => void;
  onAdd?: () => void;
}) {
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `catparent:${cat.id}`, data: { catId: cat.id, kind: "into" },
  });
  const { setNodeRef: dragRef, listeners, attributes, isDragging } = useDraggable({
    id: `catdrag:${cat.id}`,
  });
  const setRefs = (el: HTMLDivElement | null) => { dropRef(el); dragRef(el); };
  const { active } = useDndContext();
  const draggingCard = active?.id?.toString().startsWith("card:");
  const [val, setVal] = useState(cat.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurReadyRef = useRef(false);
  useEffect(() => {
    if (isRenaming) {
      setVal(cat.name);
      blurReadyRef.current = false;
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
        blurReadyRef.current = true;
      }, 150);
      return () => clearTimeout(t);
    } else {
      blurReadyRef.current = false;
    }
  }, [isRenaming, cat.name]);
  return (
    <ContextMenuTrigger asChild onContextMenu={() => onContext(cat)}>
      <div
        ref={setRefs}
        {...(!isRenaming ? listeners : {})}
        {...(!isRenaming ? attributes : {})}
        onClick={!isRenaming ? onSelect : undefined}
        style={{ paddingRight: `${depth * 14 + 6}px` }}
        className={cn(
          "flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer transition-all group select-none",
          isSelected ? "bg-gradient-navy text-primary-foreground shadow-sm" : "hover:bg-secondary",
          isOver && draggingCard && "ring-2 ring-blue-500 bg-blue-500/15",
          isOver && !draggingCard && "ring-2 ring-emerald-500 bg-emerald-500/15",
          isDragging && "opacity-40",
        )}
      >
        {hasKids ? (
          <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="opacity-70 hover:opacity-100">
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        ) : <span className="w-3.5" />}
        {isOpen && hasKids
          ? <FolderOpen className={cn("h-4 w-4", isSelected ? "text-gold" : "text-gold/80")} />
          : <Folder className={cn("h-4 w-4", isSelected ? "text-gold" : "text-gold/70")} />}
        {isRenaming ? (
          <Input
            ref={inputRef}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") onRenameSubmit?.(val);
              if (e.key === "Escape") onCancelRename?.();
            }}
            onBlur={() => { if (blurReadyRef.current) onRenameSubmit?.(val); }}
            className="h-6 text-sm flex-1 text-right px-1"
          />
        ) : (
          <span className="flex-1 text-right text-sm truncate font-medium" title={cat.name}>{displayCategoryName(cat.name)}</span>
        )}
        {isFavorite && <Star className="h-3 w-3 fill-gold text-gold" />}
        {count > 0 && (
          <Badge variant="outline" className={cn(
            "text-[10px] h-4 px-1.5 font-bold",
            isSelected ? "border-gold text-gold bg-navy/40" : "border-gold/40 text-gold",
          )}>{count}</Badge>
        )}
        {onAdd && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            title="שאלה חדשה"
            className={cn(
              "h-4 w-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
              isSelected ? "bg-gold/30 text-primary-foreground hover:bg-gold/50" : "bg-gold/20 text-foreground hover:bg-gold/40",
            )}
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
    </ContextMenuTrigger>
  );
}

/* === Folder tile (grid view) === */
function FolderTile({
  cat, count, mastery, iconSize, isMultiSelected, isRenaming, isFavorite,
  onOpen, onSelect, onAdd, onStudy, onRenameSubmit, onCancelRename,
  showCount = true, showMastery = true,
}: {
  cat: Category; count: number; mastery: number | null; iconSize: IconSize;
  isMultiSelected: boolean; isRenaming: boolean; isFavorite: boolean;
  onOpen: (e: React.MouseEvent) => void; onSelect: (e: React.MouseEvent) => void;
  onAdd: () => void;
  onStudy?: () => void;
  onRenameSubmit: (name: string) => void; onCancelRename: () => void;
  showCount?: boolean; showMastery?: boolean;
}) {
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `catparent:${cat.id}`, data: { catId: cat.id, kind: "into" },
  });
  const { setNodeRef: dragRef, listeners, attributes, isDragging } = useDraggable({
    id: `catdrag:${cat.id}`,
  });
  const setRefs = (el: HTMLDivElement | null) => { dropRef(el); dragRef(el); };
  const { active } = useDndContext();
  const draggingCard = active?.id?.toString().startsWith("card:");
  const cfg = ICON_PX[iconSize];
  const [val, setVal] = useState(cat.name);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurReadyRef = useRef(false);
  useEffect(() => {
    if (isRenaming) {
      setVal(cat.name);
      blurReadyRef.current = false;
      const t = setTimeout(() => {
        console.log('[rename] FolderTile focusing input, ref=', inputRef.current);
        inputRef.current?.focus();
        inputRef.current?.select();
        blurReadyRef.current = true;
      }, 150);
      return () => clearTimeout(t);
    } else {
      blurReadyRef.current = false;
    }
  }, [isRenaming, cat.name]);

  const masteryColor = mastery == null ? "bg-muted" :
    mastery >= 80 ? "bg-emerald-500" : mastery >= 50 ? "bg-amber-500" : "bg-red-500";

  return (
    <div
      ref={setRefs}
      {...(!isRenaming ? listeners : {})}
      {...(!isRenaming ? attributes : {})}
      onClick={onSelect}
      onDoubleClick={(e) => { e.stopPropagation(); onOpen(e); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      dir="rtl"
      className={cn(
        "group relative cursor-pointer rounded-2xl border-2 bg-card transition-all select-none overflow-hidden h-full flex",
        cfg.tile,
        "hover:border-gold/70 hover:shadow-elegant hover:-translate-y-0.5",
        isMultiSelected ? "border-gold bg-gold/10 shadow-elegant" : "border-gold/30",
        isOver && draggingCard && "ring-2 ring-blue-500 bg-blue-500/10 scale-[1.02]",
        isOver && !draggingCard && "ring-2 ring-emerald-500 bg-emerald-500/10",
        isDragging && "opacity-40",
      )}
    >
      {/* Count badge — top right */}
      {showCount && count > 0 && (
        <span className="absolute top-1.5 right-1.5 bg-white text-navy border border-gold text-[10px] font-bold rounded-full h-5 min-w-5 px-1 flex items-center justify-center z-10 shadow-sm">
          {count}
        </span>
      )}
      {/* Favorite star — top left */}
      {isFavorite && (
        <Star className="absolute top-2 left-2 h-3.5 w-3.5 fill-gold text-gold" />
      )}
      {/* Plus button — bottom right, hover only */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onAdd(); }}
        title="שאלה חדשה"
        className={cn(
          "absolute bottom-1.5 right-1.5 h-5 w-5 rounded-full bg-white text-navy border border-gold flex items-center justify-center shadow-sm hover:scale-110 transition-all z-10",
          hovered ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
      {onStudy && count > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStudy(); }}
          title="בחר שאלות לתרגול"
          className={cn(
            "absolute bottom-1.5 left-1.5 h-5 w-5 rounded-full bg-navy text-white flex items-center justify-center shadow-sm hover:scale-110 transition-all z-10",
            hovered ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        >
          <ListChecks className="h-2.5 w-2.5" />
        </button>
      )}
      <div className="flex flex-col items-center text-center gap-2 w-full">
        <div className="relative">
          <Folder
            style={{ width: cfg.folder, height: cfg.folder }}
            className="text-gold drop-shadow-sm" strokeWidth={1.4}
          />
        </div>
        {isRenaming ? (
          <Input
            ref={inputRef}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") onRenameSubmit(val);
              if (e.key === "Escape") onCancelRename();
            }}
            onBlur={() => { if (blurReadyRef.current) onRenameSubmit(val); }}
            className="h-7 text-xs text-center border-gold"
          />
        ) : (
          <span className="font-display font-bold text-sm leading-tight line-clamp-2 min-h-[2.4em] flex items-center justify-center text-center break-words w-full" title={cat.name}>{displayCategoryName(cat.name)}</span>
        )}
        {/* Mastery bar */}
        {showMastery && mastery != null && count > 0 && (
          <div className="w-full h-1 rounded-full bg-muted overflow-hidden mt-1">
            <div className={cn("h-full transition-all", masteryColor)} style={{ width: `${mastery}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* === List row === */
function FolderListRow({
  cat, count, mastery, isMultiSelected, isRenaming, isFavorite,
  onOpen, onSelect, onAdd, onStudy, onRenameSubmit, onCancelRename,
  showCount = true, showMastery = true, compact = false,
}: {
  cat: Category; count: number; mastery: number | null;
  isMultiSelected: boolean; isRenaming: boolean; isFavorite: boolean;
  onOpen: (e: React.MouseEvent) => void; onSelect: (e: React.MouseEvent) => void;
  onAdd: () => void;
  onStudy?: () => void;
  onRenameSubmit: (name: string) => void; onCancelRename: () => void;
  showCount?: boolean; showMastery?: boolean; compact?: boolean;
}) {
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `catparent:${cat.id}`, data: { catId: cat.id, kind: "into" },
  });
  const { setNodeRef: dragRef, listeners, attributes, isDragging } = useDraggable({
    id: `catdrag:${cat.id}`,
  });
  const setRefs = (el: HTMLDivElement | null) => { dropRef(el); dragRef(el); };
  const [val, setVal] = useState(cat.name);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurReadyRef = useRef(false);
  useEffect(() => {
    if (isRenaming) {
      setVal(cat.name);
      blurReadyRef.current = false;
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
        blurReadyRef.current = true;
      }, 150);
      return () => clearTimeout(t);
    } else {
      blurReadyRef.current = false;
    }
  }, [isRenaming, cat.name]);
  const masteryColor = mastery == null ? "" :
    mastery >= 80 ? "text-emerald-600" : mastery >= 50 ? "text-amber-600" : "text-red-600";

  return (
    <div
      ref={setRefs}
      {...(!isRenaming ? listeners : {})}
      {...(!isRenaming ? attributes : {})}
      onClick={onSelect}
      onDoubleClick={(e) => { e.stopPropagation(); onOpen(e); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group flex items-center gap-2 rounded-lg border cursor-pointer transition-all select-none",
        compact ? "px-2 py-1" : "px-3 py-2",
        isMultiSelected ? "border-gold bg-gold/10" : "border-gold/20 hover:border-gold/50 hover:bg-secondary",
        isOver && "ring-2 ring-emerald-500 bg-emerald-500/10",
        isDragging && "opacity-40",
      )}
    >
      <Folder className="h-5 w-5 text-gold shrink-0" />
      {isFavorite && <Star className="h-3 w-3 fill-gold text-gold shrink-0" />}
      {isRenaming ? (
        <Input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") onRenameSubmit(val);
            if (e.key === "Escape") onCancelRename();
          }}
          onBlur={() => { if (blurReadyRef.current) onRenameSubmit(val); }}
          className="h-7 text-sm flex-1 text-right"
        />
      ) : (
        <span className="flex-1 text-right text-sm font-medium truncate" title={cat.name}>{displayCategoryName(cat.name)}</span>
      )}
      {showMastery && mastery != null && count > 0 && (
        <span className={cn("text-[11px] font-bold", masteryColor)}>{mastery}%</span>
      )}
      {showCount && count > 0 && <Badge variant="outline" className="text-[10px] h-5">{count}</Badge>}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onAdd(); }}
        title="שאלה חדשה"
        className={cn(
          "h-5 w-5 rounded-full bg-gold/90 text-navy flex items-center justify-center hover:scale-110 transition-all",
          hovered ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
      {onStudy && count > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStudy(); }}
          title="בחר שאלות לתרגול"
          className={cn(
            "h-5 w-5 rounded-full bg-navy text-white flex items-center justify-center hover:scale-110 transition-all",
            hovered ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        >
          <ListChecks className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

function CardTile({ card, query, onEdit, onDelete, selected, onToggleSelect, selectionMode }: {
  card: StudyCard;
  query?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  selectionMode?: boolean;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `card:${card.id}`, disabled: selectionMode });
  const highlighted = useMemo(() => {
    if (!query?.trim()) return card.question;
    const q = query.trim();
    const idx = card.question.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return card.question;
    return (
      <>
        {card.question.slice(0, idx)}
        <mark className="bg-gold/30 text-foreground rounded px-0.5">{card.question.slice(idx, idx + q.length)}</mark>
        {card.question.slice(idx + q.length)}
      </>
    );
  }, [card.question, query]);
  return (
    <div
      ref={setNodeRef} {...(!selectionMode ? listeners : {})} {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        if (selectionMode && onToggleSelect) { onToggleSelect(); }
        else { onEdit?.(); }
      }}
      className={cn(
        "group relative rounded-xl border-2 bg-card p-3 hover:shadow-md transition-all cursor-pointer",
        selected ? "border-gold bg-gold/5" : "border-gold/30 hover:border-gold/60",
        isDragging && "opacity-40",
      )}
    >
      {/* selection checkbox — always in top-right corner */}
      {onToggleSelect && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className={cn(
            "absolute top-1.5 right-1.5 z-20 p-0.5 transition-opacity",
            selectionMode ? "opacity-100" : "opacity-0 group-hover:opacity-60",
          )}
          title={selected ? "בטל בחירה" : "בחר שאלה"}
        >
          {selected
            ? <CheckSquare className="h-4 w-4 text-gold" />
            : <Square className="h-4 w-4 text-muted-foreground" />}
        </button>
      )}
      {/* hover action buttons (edit/delete) — only shown when not in selection mode */}
      {!selectionMode && (
        <div className="absolute top-1.5 left-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1 rounded bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground"
              title="ערוך שאלה"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded bg-secondary/80 hover:bg-red-500 text-muted-foreground hover:text-white"
              title="מחק שאלה"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      <div className={cn("flex items-start gap-2", onToggleSelect && "pr-5")}>
        <FileText className="h-4 w-4 text-gold/70 shrink-0 mt-0.5" />
        <p className="text-sm font-medium text-right flex-1 leading-snug line-clamp-3">{highlighted}</p>
      </div>
    </div>
  );
}

/* ===================== MAIN ===================== */
export function CategoryExplorerView({ selectedCategory, onSelectCategory, onAddCardToCategory, onEditCard, activeDeckId, onStudyCategory, onStudyMultipleCategories }: Props) {
  const { state, addCategory, deleteCategory, renameCategory, duplicateCategory, moveCategory, addCategoriesBulk, addCard, deleteCard, addDeck, updateDeckCategoryIds, addCardToDeck } = useStudy();

  // === Persistent prefs ===
  const [prefs, setPrefsState] = useState<ExplorerPrefs>(() => loadPrefs());
  const setPrefs = (patch: Partial<ExplorerPrefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  };

  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [currentParentId, setCurrentParentId] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([null]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameBlurReady = useRef<Map<string, boolean>>(new Map());
  const [moveTargetOpen, setMoveTargetOpen] = useState(false);
  const [smartDialogOpen, setSmartDialogOpen] = useState(false);
  const [editingSmart, setEditingSmart] = useState<SmartFolder | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [activeSmartId, setActiveSmartId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogMulti, setAddDialogMulti] = useState(false);
  const [addDialogText, setAddDialogText] = useState("");
  // Quick add-questions dialog state
  const [addQOpen, setAddQOpen] = useState(false);
  const [addQCategory, setAddQCategory] = useState<string | null>(null);
  const [addQTab, setAddQTab] = useState<"quick" | "bulk">("quick");
  const [addQSingleQ, setAddQSingleQ] = useState("");
  const [addQSingleA, setAddQSingleA] = useState("");
  const [addQBulkText, setAddQBulkText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [multiSummaryOpen, setMultiSummaryOpen] = useState(false);

  // Card picker dialog (selective card → deck assignment)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCat, setPickerCat] = useState<Category | null>(null);
  const [pickerDeckId, setPickerDeckId] = useState<string | null>(null);

  // Multi-select for card tiles
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [classifyDialogOpen, setClassifyDialogOpen] = useState(false);
  const [classifyDeckIds, setClassifyDeckIds] = useState<Set<string>>(new Set());
  const [newDeckNameForClassify, setNewDeckNameForClassify] = useState("");

  const openCardPicker = (cat: Category, deckId: string) => {
    setPickerCat(cat);
    setPickerDeckId(deckId);
    setPickerOpen(true);
  };

  const categories = useMemo(
    () => [...(state.categories ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt,
    ),
    [state.categories],
  );

  /* === Per-category aggregates === */
  const aggregates = useMemo(() => {
    // Map: catName -> { count, mastered, totalReviews, correct }
    const m = new Map<string, { count: number; correct: number; total: number }>();
    state.cards.forEach((c) => {
      c.tags.forEach((t) => {
        if (!t.startsWith("cat:")) return;
        const n = t.slice(4);
        const cur = m.get(n) ?? { count: 0, correct: 0, total: 0 };
        cur.count += 1;
        cur.correct += c.stats.correct;
        cur.total += c.stats.totalReviews;
        m.set(n, cur);
      });
    });
    return m;
  }, [state.cards]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    aggregates.forEach((v, k) => map.set(k, v.count));
    // Build parent->children map for recursion
    const childrenByParent = new Map<string | null, Category[]>();
    categories.forEach((c) => {
      const k = c.parentId;
      if (!childrenByParent.has(k)) childrenByParent.set(k, []);
      childrenByParent.get(k)!.push(c);
    });
    // Set of cat-names per subtree
    const subtreeNames = (cat: Category): Set<string> => {
      const set = new Set<string>([cat.name]);
      (childrenByParent.get(cat.id) ?? []).forEach((k) =>
        subtreeNames(k).forEach((n) => set.add(n)),
      );
      return set;
    };
    // Pre-extract cat:NAME tags per card
    const cardCatNames = state.cards.map((c) =>
      c.tags.filter((t) => t.startsWith("cat:")).map((t) => t.slice(4)),
    );
    // For each category, count UNIQUE cards whose any cat: tag is in subtree
    categories.forEach((cat) => {
      const names = subtreeNames(cat);
      let count = 0;
      for (const tags of cardCatNames) {
        if (tags.some((n) => names.has(n))) count++;
      }
      map.set(cat.name, count);
    });
    return map;
  }, [aggregates, categories, state.cards]);

  const masteryOfCat = useCallback((name: string): number | null => {
    const a = aggregates.get(name);
    if (!a || !a.total) return null;
    return Math.round((a.correct / a.total) * 100);
  }, [aggregates]);

  const childrenOf = useCallback(
    (pid: string | null) => {
      const list = categories.filter((c) => c.parentId === pid);
      // Dedupe by name within the same parent — guards against stale local
      // cache entries that share a name with a cloud category but have a
      // different id (e.g. after a category rebuild).
      const byName = new Map<string, typeof list[number]>();
      for (const c of list) {
        const existing = byName.get(c.name);
        if (!existing) { byName.set(c.name, c); continue; }
        // Prefer the entry with the larger createdAt (cloud bootstrap is
        // typically newer than legacy local rows).
        if ((c.createdAt ?? 0) > (existing.createdAt ?? 0)) byName.set(c.name, c);
      }
      return [...byName.values()];
    },
    [categories],
  );

  const breadcrumbs = useMemo(() => {
    const arr: Category[] = [];
    let cur = currentParentId;
    while (cur) {
      const c = categories.find((x) => x.id === cur);
      if (!c) break;
      arr.unshift(c);
      cur = c.parentId;
    }
    return arr;
  }, [currentParentId, categories]);

  /* === Sorting === */
  const applySort = useCallback((list: Category[]): Category[] => {
    const arr = [...list];
    const dir = prefs.sortDesc ? -1 : 1;
    switch (prefs.sortKey) {
      case "name":    arr.sort((a, b) => a.name.localeCompare(b.name, "he") * dir); break;
      case "created": arr.sort((a, b) => (a.createdAt - b.createdAt) * dir); break;
      case "count":   arr.sort((a, b) => ((counts.get(a.name) ?? 0) - (counts.get(b.name) ?? 0)) * dir); break;
      case "mastery": arr.sort((a, b) => ((masteryOfCat(a.name) ?? -1) - (masteryOfCat(b.name) ?? -1)) * dir); break;
      default: break; // manual
    }
    // Favorites first (optional)
    if (prefs.favoritesFirst) {
      arr.sort((a, b) => {
        const af = prefs.favorites.includes(a.id) ? 0 : 1;
        const bf = prefs.favorites.includes(b.id) ? 0 : 1;
        return af - bf;
      });
    }
    return arr;
  }, [prefs.sortKey, prefs.sortDesc, prefs.favorites, prefs.favoritesFirst, counts, masteryOfCat]);

  /* === Smart folder evaluation === */
  const smartFolderCards = useMemo(() => {
    if (!activeSmartId) return null;
    const sf = prefs.smartFolders.find((s) => s.id === activeSmartId);
    if (!sf) return null;
    const now = Date.now();
    const q = sf.query.trim().toLowerCase();
    return state.cards.filter((c) => {
      if (sf.catName && !c.tags.includes(`cat:${sf.catName}`)) return false;
      if (q && !c.question.toLowerCase().includes(q)) return false;
      switch (sf.scope) {
        case "failed":   return c.stats.totalReviews > 0 && c.stats.correct / c.stats.totalReviews < 0.5;
        case "due":      return c.srs.dueAt <= now;
        case "mastered": return c.stats.totalReviews >= 3 && c.stats.correct / c.stats.totalReviews >= 0.85;
        case "new":      return c.stats.totalReviews === 0;
        default:         return true;
      }
    });
  }, [activeSmartId, prefs.smartFolders, state.cards]);

  /* === Visible folders === */
  const visibleFolders = useMemo(() => {
    if (activeSmartId) return [];
    const kids = childrenOf(currentParentId);
    let result = !search.trim()
      ? applySort(kids)
      : applySort(categories.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())));
    if (prefs.hideEmpty) {
      result = result.filter((c) => (counts.get(c.name) ?? 0) > 0);
    }
    return result;
  }, [currentParentId, categories, search, childrenOf, applySort, activeSmartId, prefs.hideEmpty, counts]);

  /* === Cards visible in main area === */
  const cardsOfSelected = useMemo(() => {
    if (smartFolderCards) return smartFolderCards;
    let base: StudyCard[] = [];
    if (selectedCategory) {
      base = state.cards.filter((c) => c.tags.includes(`cat:${selectedCategory}`));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matched = state.cards.filter((c) => c.question.toLowerCase().includes(q));
      // Merge with current-category base so folder results don't hide card results
      const seen = new Set(base.map((c) => c.id));
      matched.forEach((c) => { if (!seen.has(c.id)) base.push(c); });
    }
    return base;
  }, [state.cards, selectedCategory, smartFolderCards, search]);

  const toggleOpen = (id: string) => setOpenIds((s) => ({ ...s, [id]: !s[id] }));

  /* === History navigation === */
  const navigateTo = useCallback((parentId: string | null, push = true) => {
    setCurrentParentId(parentId);
    setActiveSmartId(null);
    setMultiSelected(new Set());
    if (push) {
      setHistory((h) => {
        const cut = h.slice(0, historyIdx + 1);
        return [...cut, parentId];
      });
      setHistoryIdx((i) => i + 1);
    }
  }, [historyIdx]);

  const goBack = () => {
    if (historyIdx <= 0) return;
    const target = history[historyIdx - 1];
    setHistoryIdx(historyIdx - 1);
    setCurrentParentId(target);
    setActiveSmartId(null);
    setMultiSelected(new Set());
  };
  const goForward = () => {
    if (historyIdx >= history.length - 1) return;
    const target = history[historyIdx + 1];
    setHistoryIdx(historyIdx + 1);
    setCurrentParentId(target);
    setActiveSmartId(null);
    setMultiSelected(new Set());
  };

  const handleSelectFolder = (cat: Category, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey && lastSelectedId) {
      const ids = visibleFolders.map((c) => c.id);
      const a = ids.indexOf(lastSelectedId);
      const b = ids.indexOf(cat.id);
      if (a >= 0 && b >= 0) {
        const [from, to] = [Math.min(a, b), Math.max(a, b)];
        setMultiSelected(new Set(ids.slice(from, to + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setMultiSelected((s) => {
        const n = new Set(s);
        if (n.has(cat.id)) n.delete(cat.id); else n.add(cat.id);
        return n;
      });
      setLastSelectedId(cat.id);
      return;
    }
    setMultiSelected(new Set([cat.id]));
    setLastSelectedId(cat.id);
    onSelectCategory(cat.name);
  };

  const enterFolder = (cat: Category) => {
    navigateTo(cat.id);
    if (!openIds[cat.id]) toggleOpen(cat.id);
    onSelectCategory(cat.name);
  };

  const handleAddHere = () => {
    const n = newName.trim();
    if (!n) return;
    addCategory(n, currentParentId);
    setNewName("");
  };

  const openAddDialog = (multi: boolean) => {
    setAddDialogMulti(multi);
    setAddDialogText("");
    setAddDialogOpen(true);
  };

  const openAddQuestions = (catName: string) => {
    // Open the full card editor directly (default behavior).
    onAddCardToCategory(catName);
  };
  const submitAddQuestions = () => {
    if (!addQCategory) return;
    // Categories own cards now; deck is optional (acts like a tag)
    const deckIdForCard = activeDeckId ?? null;
    const tag = `cat:${addQCategory}`;
    if (addQTab === "quick") {
      const q = addQSingleQ.trim();
      const a = addQSingleA.trim();
      if (!q) { toast({ title: "חסרה שאלה" }); return; }
      addCard({ deckId: deckIdForCard, type: "flashcard", question: q, answer: a, tags: [tag] } as Parameters<typeof addCard>[0]);
      toast({ title: "השאלה נוספה", description: addQCategory });
      setAddQOpen(false);
      return;
    }
    // bulk: each line "question | answer"
    const lines = addQBulkText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let added = 0;
    for (const line of lines) {
      const [q, ...rest] = line.split("|");
      const question = (q ?? "").trim();
      const answer = rest.join("|").trim();
      if (!question) continue;
      addCard({ deckId: deckIdForCard, type: "flashcard", question, answer, tags: [tag] } as Parameters<typeof addCard>[0]);
      added++;
    }
    if (!added) { toast({ title: "לא נוספו שאלות", description: "כל שורה: שאלה | תשובה" }); return; }
    toast({ title: `נוספו ${added} שאלות`, description: addQCategory });
    setAddQOpen(false);
  };
  const submitAddDialog = () => {
    const raw = addDialogText;
    const names = (addDialogMulti ? raw.split(/\r?\n/) : [raw])
      .map((s) => s.trim()).filter(Boolean);
    if (!names.length) { setAddDialogOpen(false); return; }
    if (names.length === 1) {
      addCategory(names[0], currentParentId);
      toast({ title: "קטגוריה נוספה", description: names[0] });
    } else {
      const created = addCategoriesBulk(names.map((n) => ({ name: n })), currentParentId);
      toast({ title: `נוצרו ${created} קטגוריות` });
    }
    setAddDialogOpen(false);
    setAddDialogText("");
  };

  const handleBulkDelete = () => {
    if (!multiSelected.size) return;
    if (!confirm(`למחוק ${multiSelected.size} קטגוריות?`)) return;
    multiSelected.forEach((id) => deleteCategory(id));
    setMultiSelected(new Set());
    onSelectCategory(null);
    toast({ title: "נמחקו", description: `${multiSelected.size} קטגוריות` });
  };

  const handleBulkMove = (targetParentId: string | null) => {
    multiSelected.forEach((id) => {
      let p = targetParentId, safe = true;
      while (p) { if (p === id) { safe = false; break; } p = categories.find((c) => c.id === p)?.parentId ?? null; }
      if (safe) moveCategory(id, targetParentId);
    });
    const n = multiSelected.size;
    setMoveTargetOpen(false);
    setMultiSelected(new Set());
    toast({ title: "הועברו", description: `${n} קטגוריות` });
  };

  const toggleFavorite = (id: string) => {
    const set = new Set(prefs.favorites);
    if (set.has(id)) set.delete(id); else set.add(id);
    setPrefs({ favorites: [...set] });
  };

  /* === Export / Import === */
  const exportBranch = (rootId: string | null) => {
    const collect = (pid: string | null): unknown => {
      const kids = categories.filter((c) => c.parentId === pid);
      return kids.map((c) => ({
        name: c.name,
        cards: state.cards.filter((card) => card.tags.includes(`cat:${c.name}`)).map((card) => ({
          question: card.question,
          answer: (card as { answer?: string }).answer ?? "",
          type: card.type,
        })),
        children: collect(c.id),
      }));
    };
    const data = {
      exportedAt: new Date().toISOString(),
      root: rootId ? categories.find((c) => c.id === rootId)?.name ?? "root" : "all",
      tree: collect(rootId),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `categories-${data.root}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "יצוא הושלם", description: data.root });
  };

  const importTree = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as { tree: { name: string; children?: unknown[] }[] };
      const walk = (nodes: { name: string; children?: unknown[] }[], pid: string | null) => {
        for (const n of nodes) {
          const cat = addCategory(n.name, pid);
          if (n.children?.length) walk(n.children as { name: string; children?: unknown[] }[], cat.id);
        }
      };
      walk(data.tree ?? [], currentParentId);
      toast({ title: "ייבוא הצליח" });
    } catch (e) {
      toast({ title: "שגיאת ייבוא", description: String(e), variant: "destructive" });
    }
  };

  /* === Smart folder save === */
  const saveSmartFolder = (sf: SmartFolder) => {
    const list = prefs.smartFolders;
    const idx = list.findIndex((x) => x.id === sf.id);
    const next = idx >= 0 ? list.map((x, i) => i === idx ? sf : x) : [...list, sf];
    setPrefs({ smartFolders: next });
  };
  const deleteSmartFolder = (id: string) => {
    setPrefs({ smartFolders: prefs.smartFolders.filter((s) => s.id !== id) });
    if (activeSmartId === id) setActiveSmartId(null);
  };

  /* === Keyboard shortcuts === */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!containerRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return;

      if (e.key === "Delete" && multiSelected.size > 0) { e.preventDefault(); handleBulkDelete(); }
      else if (e.key === "F2" && multiSelected.size === 1) { e.preventDefault(); setRenamingId([...multiSelected][0]); }
      else if (e.key === "Enter" && multiSelected.size === 1) {
        e.preventDefault();
        const cat = categories.find((c) => c.id === [...multiSelected][0]);
        if (cat) enterFolder(cat);
      }
      else if (e.key === "Backspace" && currentParentId) {
        e.preventDefault();
        const parent = categories.find((c) => c.id === currentParentId);
        navigateTo(parent?.parentId ?? null);
      }
      else if (e.key === "Escape") { setMultiSelected(new Set()); setRenamingId(null); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setMultiSelected(new Set(visibleFolders.map((c) => c.id)));
      }
      else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); goBack(); } // RTL: right=back
      else if (e.altKey && e.key === "ArrowLeft")  { e.preventDefault(); goForward(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiSelected, visibleFolders, categories, currentParentId, history, historyIdx]);

  /* === Add category to a "מערכת" (deck) — opens card picker === */
  const addCategoryToDeck = useCallback((cat: Category, deckId: string) => {
    const deck = state.decks.find((d) => d.id === deckId);
    if (!deck) return;
    // Open the card picker — user can choose all or specific cards
    openCardPicker(cat, deckId);
  }, [state.decks]);

  const createDeckFromCategory = useCallback((cat: Category) => {
    const name = window.prompt(`שם המערכת החדשה:`, cat.name)?.trim();
    if (!name) return;
    const deck = addDeck(name, undefined, []);
    // Open picker so user can choose all or specific cards
    openCardPicker(cat, deck.id);
    toast({ title: "מערכת נוצרה", description: `"${name}" — בחר שאלות לשיוך` });
  }, [addDeck, updateDeckCategoryIds]);

  /* === Folder context menu === */
  const FolderContextMenu = ({ cat }: { cat: Category }) => {
    const locked = isUncategorized(cat);
    return (
    <ContextMenuContent className="w-56">
      {onStudyCategory && (
        <>
          <ContextMenuItem onClick={() => onStudyCategory(cat.name)}>
            <ListChecks className="h-4 w-4 ml-2 text-emerald-600" /> בחר שאלות לתרגול
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onClick={() => enterFolder(cat)}>
        <FolderOpen className="h-4 w-4 ml-2" /> פתח
      </ContextMenuItem>
      <ContextMenuItem onClick={() => openAddQuestions(cat.name)}>
        <Plus className="h-4 w-4 ml-2" /> שאלה חדשה
      </ContextMenuItem>
      <ContextMenuItem onClick={() => addCategory("תת-קטגוריה חדשה", cat.id)} disabled={locked}>
        <FolderPlus className="h-4 w-4 ml-2" /> תת-קטגוריה
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => toggleFavorite(cat.id)}>
        <Star className={cn("h-4 w-4 ml-2", prefs.favorites.includes(cat.id) && "fill-gold text-gold")} />
        {prefs.favorites.includes(cat.id) ? "הסר ממועדפים" : "הוסף למועדפים"}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => setTimeout(() => { console.log('[rename] setRenamingId', cat.id); setRenamingId(cat.id); }, 50)} disabled={locked}>
        <Edit3 className="h-4 w-4 ml-2" /> שנה שם <span className="mr-auto text-[10px] text-muted-foreground">F2</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={() => duplicateCategory(cat.id)} disabled={locked}>
        <Copy className="h-4 w-4 ml-2" /> שכפל
      </ContextMenuItem>
      <ContextMenuItem onClick={() => exportBranch(cat.id)}>
        <Download className="h-4 w-4 ml-2" /> ייצא ענף
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger><Layers className="h-4 w-4 ml-2 text-gold" /> הוסף למערכת</ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-72 overflow-y-auto">
          <ContextMenuItem onClick={() => createDeckFromCategory(cat)}>
            <Plus className="h-4 w-4 ml-2" /> צור מערכת חדשה...
          </ContextMenuItem>
          {state.decks.length > 0 && <ContextMenuSeparator />}
          {state.decks.map((d) => {
            const already = (d.categoryIds ?? []).includes(cat.id);
            return (
              <ContextMenuItem key={d.id} onClick={() => addCategoryToDeck(cat, d.id)} disabled={already}>
                <Layers className={cn("h-4 w-4 ml-2", already ? "text-muted-foreground" : "text-gold")} />
                {d.name} {already && <span className="mr-auto text-[10px] text-muted-foreground">כבר במערכת</span>}
              </ContextMenuItem>
            );
          })}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={locked}><ArrowRightLeft className="h-4 w-4 ml-2" /> העבר אל...</ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-72 overflow-y-auto">
          <ContextMenuItem onClick={() => moveCategory(cat.id, null)}>
            <Home className="h-4 w-4 ml-2" /> רמת הבסיס
          </ContextMenuItem>
          <ContextMenuSeparator />
          {categories.filter((c) => c.id !== cat.id).map((c) => (
            <ContextMenuItem key={c.id} onClick={() => moveCategory(cat.id, c.id)}>
              <Folder className="h-4 w-4 ml-2 text-gold" /> {c.name}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        className="text-destructive focus:text-destructive"
        disabled={locked}
        onClick={() => { if (locked) return; if (confirm(`למחוק את "${cat.name}"?`)) deleteCategory(cat.id); }}
      >
        <Trash2 className="h-4 w-4 ml-2" /> מחק <span className="mr-auto text-[10px] text-muted-foreground">Del</span>
      </ContextMenuItem>
    </ContextMenuContent>
    );
  };

  /* === Multi-selection context menu === */
  const MultiSelectionContextMenu = () => {
    const selectedCats = categories.filter((c) => multiSelected.has(c.id));
    const selectedCatNames = selectedCats.map((c) => c.name);
    const now = Date.now();
    const totalCards = selectedCats.reduce((s, c) => s + (counts.get(c.name) ?? 0), 0);
    const totalDue = selectedCats.reduce((s, c) => {
      return s + state.cards.filter((card) =>
        card.tags.includes(`cat:${c.name}`) && card.srs.dueAt <= now,
      ).length;
    }, 0);
    return (
      <ContextMenuContent className="w-64">
        <div className="px-3 py-2 border-b border-border mb-1">
          <p className="font-bold text-sm text-right">{multiSelected.size} תיקיות נבחרו</p>
          <p className="text-xs text-muted-foreground text-right">{totalCards} שאלות · {totalDue} לחזרה</p>
        </div>
        {(onStudyCategory || onStudyMultipleCategories) && (
          <>
            <ContextMenuItem onClick={() => onStudyMultipleCategories?.(selectedCatNames, "all")}>
              <Brain className="h-4 w-4 ml-2 text-emerald-600" /> תשאל — תרגל את כל הנבחרים
            </ContextMenuItem>
            {totalDue > 0 && (
              <ContextMenuItem onClick={() => onStudyMultipleCategories?.(selectedCatNames, "due")}>
                <ListChecks className="h-4 w-4 ml-2 text-amber-600" /> תמליץ — חזרה על {totalDue} שאלות לחזרה
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => setMultiSummaryOpen(true)}>
              <BarChart2 className="h-4 w-4 ml-2 text-blue-500" /> תסכם — סיכום הבחירה
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuSub>
          <ContextMenuSubTrigger><ArrowRightLeft className="h-4 w-4 ml-2" /> העבר ({multiSelected.size})</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 overflow-y-auto">
            <ContextMenuItem onClick={() => handleBulkMove(null)}>
              <Home className="h-4 w-4 ml-2" /> רמת הבסיס
            </ContextMenuItem>
            <ContextMenuSeparator />
            {categories.filter((c) => !multiSelected.has(c.id)).map((c) => (
              <ContextMenuItem key={c.id} onClick={() => handleBulkMove(c.id)}>
                <Folder className="h-4 w-4 ml-2 text-gold" /> {c.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={handleBulkDelete}>
          <Trash2 className="h-4 w-4 ml-2" /> מחק ({multiSelected.size})
        </ContextMenuItem>
        <ContextMenuItem onClick={() => setMultiSelected(new Set())}>
          <X className="h-4 w-4 ml-2" /> נקה בחירה
        </ContextMenuItem>
      </ContextMenuContent>
    );
  };

  const renderSidebar = (pid: string | null, depth: number): React.ReactNode => {
    return childrenOf(pid).map((cat) => {
      const hasKids = categories.some((c) => c.parentId === cat.id);
      const isOpen = !!openIds[cat.id];
      return (
        <div key={cat.id}>
          <ContextMenu>
            <SidebarRow
              cat={cat} depth={depth} hasKids={hasKids} isOpen={isOpen}
              isSelected={selectedCategory === cat.name}
              count={counts.get(cat.name) ?? 0}
              isFavorite={prefs.favorites.includes(cat.id)}
              isRenaming={renamingId === cat.id}
              onRenameSubmit={(name) => {
                if (name.trim() && name !== cat.name) renameCategory(cat.id, name);
                setRenamingId(null);
              }}
              onCancelRename={() => setRenamingId(null)}
              onToggle={() => toggleOpen(cat.id)}
              onSelect={() => {
                navigateTo(cat.id);
                if (!isOpen && hasKids) toggleOpen(cat.id);
                setMultiSelected(new Set([cat.id]));
                setLastSelectedId(cat.id);
                onSelectCategory(cat.name);
              }}
              onContext={() => { /* no-op, context handled by trigger */ }}
              onAdd={() => openAddQuestions(cat.name)}
            />
            <FolderContextMenu cat={cat} />
          </ContextMenu>
          {isOpen && hasKids && renderSidebar(cat.id, depth + 1)}
        </div>
      );
    });
  };

  const millerCols = useMemo(() => {
    const cols: { parentId: string | null; items: Category[] }[] = [{ parentId: null, items: applySort(childrenOf(null)) }];
    for (const b of breadcrumbs) cols.push({ parentId: b.id, items: applySort(childrenOf(b.id)) });
    return cols;
  }, [breadcrumbs, childrenOf, applySort]);

  const cfg = ICON_PX[prefs.iconSize];
  const favoriteCats = categories.filter((c) => prefs.favorites.includes(c.id));

  /* === Preview pane content === */
  const previewCategory = useMemo(() => {
    if (multiSelected.size !== 1) return null;
    return categories.find((c) => c.id === [...multiSelected][0]) ?? null;
  }, [multiSelected, categories]);

  const previewStats = useMemo(() => {
    if (!previewCategory) return null;
    const cards = state.cards.filter((c) => c.tags.includes(`cat:${previewCategory.name}`));
    const total = cards.reduce((s, c) => s + c.stats.totalReviews, 0);
    const correct = cards.reduce((s, c) => s + c.stats.correct, 0);
    const due = cards.filter((c) => c.srs.dueAt <= Date.now()).length;
    const lastReview = cards.reduce((m, c) => Math.max(m, c.srs.lastReviewedAt ?? 0), 0);
    const subCats = categories.filter((c) => c.parentId === previewCategory.id);
    return {
      cards: cards.length, mastery: total ? Math.round((correct / total) * 100) : null,
      due, lastReview: lastReview ? toHebrewDate(new Date(lastReview)) : "—",
      subs: subCats.length,
    };
  }, [previewCategory, state.cards, categories]);

  return (
    <div dir="rtl" className="rounded-xl border-2 border-gold/30 bg-card overflow-hidden">
      {/* ── Unified title bar (NOT zoomed — always readable) ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gold/30 bg-gradient-to-l from-gold/10 to-transparent">
        <span className="flex items-center justify-center h-7 w-7 rounded-full bg-gold/20 text-gold shrink-0">
          <Layers className="h-4 w-4" />
        </span>
        <div className="flex-1" />
        {/* Zoom slider */}
        <div className="flex items-center gap-1.5 select-none" title="גודל תצוגה">
          <ZoomOut className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="range" min={0.6} max={1.45} step={0.05}
            value={prefs.uiScale}
            onChange={(e) => setPrefs({ uiScale: parseFloat(e.target.value) })}
            className="w-24 accent-[hsl(var(--gold,45_90%_55%))] cursor-pointer h-1.5"
          />
          <ZoomIn className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <button type="button" title="אפס גודל"
            onClick={() => setPrefs({ uiScale: 1.0 })}
            className="text-[10px] text-muted-foreground hover:text-foreground w-7 text-center tabular-nums">
            {Math.round(prefs.uiScale * 100)}%
          </button>
        </div>
        {/* Templates button */}
        <button type="button" onClick={() => setTemplatesOpen(true)}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs border border-gold/50 hover:bg-gold/10 transition-colors">
          <Sparkles className="h-3.5 w-3.5 text-gold" /> תבניות
        </button>
      </div>

      {/* ── Everything below is zoomed ── */}
      <div ref={containerRef} tabIndex={-1} style={{ zoom: prefs.uiScale }} className="focus:outline-none">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-gold/20 bg-gradient-to-l from-secondary/40 to-transparent px-3 py-2 flex-wrap">
        {/* History */}
        <div className="flex items-center gap-0.5 border border-gold/40 rounded-md p-0.5">
          <button onClick={goBack} disabled={historyIdx <= 0} title="חזור (Alt+→)"
            className="h-8 w-8 rounded flex items-center justify-center hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={goForward} disabled={historyIdx >= history.length - 1} title="קדימה (Alt+←)"
            className="h-8 w-8 rounded flex items-center justify-center hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={() => { navigateTo(null); onSelectCategory(null); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-gold transition-colors"
        >
          <Home className="h-3.5 w-3.5" /> בית
        </button>
        {breadcrumbs.map((c, i) => (
          <div key={c.id} className="flex items-center gap-1">
            <ChevronLeft className="h-3 w-3 text-muted-foreground" />
            <button
              onClick={() => { navigateTo(c.id); onSelectCategory(c.name); }}
              className={cn("text-xs hover:text-gold transition-colors",
                i === breadcrumbs.length - 1 ? "text-gold font-bold" : "text-foreground")}
            >
              {c.name}
            </button>
          </div>
        ))}
        <div className="flex-1" />

        {/* Search (covers folders + cards together) */}
        <div className="relative">
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש בתיקיות ובשאלות..."
            className="h-9 text-sm w-64 border-gold/30 text-right pr-7"
          />
        </div>

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" className="h-9 w-9 border-gold/40" title="מיון">
              <ArrowUpDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>מיון לפי</DropdownMenuLabel>
            {([
              ["manual", "ידני"], ["name", "שם"], ["created", "תאריך יצירה"],
              ["count", "כמות שאלות"], ["mastery", "אחוז שליטה"],
            ] as [SortKey, string][]).map(([k, label]) => (
              <DropdownMenuCheckboxItem key={k} checked={prefs.sortKey === k}
                onCheckedChange={() => setPrefs({ sortKey: k })}>
                {label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={prefs.sortDesc}
              onCheckedChange={(v) => setPrefs({ sortDesc: !!v })}>
              סדר יורד
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Layout switcher */}
        <div className="inline-flex border border-gold/40 rounded-md p-0.5 gap-0.5">
          {([
            { id: "grid", icon: LayoutGrid, label: "כרטיסים" },
            { id: "list", icon: ListIcon, label: "רשימה" },
            { id: "columns", icon: Columns3, label: "עמודות" },
          ] as const).map(({ id, icon: Icon, label }) => (
            <button key={id} title={label} onClick={() => setPrefs({ layout: id })}
              className={cn("h-8 w-8 rounded flex items-center justify-center transition-all",
                prefs.layout === id ? "bg-gradient-navy text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        {/* Icon size dropdown (single control to save space) */}
        <div
          className={cn(
            "min-w-[126px] transition-opacity",
            prefs.layout !== "grid" && "opacity-0 pointer-events-none",
          )}
          aria-hidden={prefs.layout !== "grid"}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-9 w-full border-gold/40 px-2.5 text-xs justify-between"
                title="גודל אייקונים"
              >
                <span className="inline-flex items-center gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  {prefs.iconSize === "sm" ? "קטן" : prefs.iconSize === "md" ? "בינוני" : "גדול"}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              <DropdownMenuLabel>גודל אייקונים</DropdownMenuLabel>
              {([
                ["sm", "קטן"],
                ["md", "בינוני"],
                ["lg", "גדול"],
              ] as [IconSize, string][]).map(([size, label]) => (
                <DropdownMenuCheckboxItem
                  key={size}
                  checked={prefs.iconSize === size}
                  onCheckedChange={() => setPrefs({ iconSize: size })}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Preview toggle */}
        <button onClick={() => setPrefs({ showPreview: !prefs.showPreview })}
          title={prefs.showPreview ? "הסתר חלונית תצוגה" : "הצג חלונית תצוגה"}
          className="h-9 w-9 rounded border border-gold/40 flex items-center justify-center hover:bg-secondary">
          {prefs.showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>

        {/* View options — extra display toggles */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title="אפשרויות תצוגה"
              className="h-9 w-9 rounded border border-gold/40 flex items-center justify-center hover:bg-secondary"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuLabel>אפשרויות תצוגה</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={prefs.showCounts}
              onCheckedChange={(v) => setPrefs({ showCounts: !!v })}
            >
              הצג מספר שאלות
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={prefs.showMastery}
              onCheckedChange={(v) => setPrefs({ showMastery: !!v })}
            >
              הצג רמת שליטה
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={prefs.favoritesFirst}
              onCheckedChange={(v) => setPrefs({ favoritesFirst: !!v })}
            >
              מועדפים בראש הרשימה
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={prefs.hideEmpty}
              onCheckedChange={(v) => setPrefs({ hideEmpty: !!v })}
            >
              הסתר תיקיות ריקות
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={prefs.compactRows}
              onCheckedChange={(v) => setPrefs({ compactRows: !!v })}
            >
              שורות צפופות (רשימה)
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={prefs.showPreview}
              onCheckedChange={(v) => setPrefs({ showPreview: !!v })}
            >
              חלונית תצוגה מקדימה
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Add category (single / bulk) */}
        {!activeSmartId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="h-9 w-9 bg-gradient-navy text-primary-foreground" title="הוסף קטגוריה / שאלה">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-right">קטגוריות</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => openAddDialog(false)}>
                <Plus className="h-4 w-4 ml-2" /> הוסף קטגוריה
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAddDialog(true)}>
                <FolderPlus className="h-4 w-4 ml-2" /> הוסף קטגוריות מרובות
              </DropdownMenuItem>
              {(() => {
                const cur = currentParentId ? categories.find((c) => c.id === currentParentId) : null;
                if (!cur) return null;
                return (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-right">שאלות ל-{displayCategoryName(cur.name)}</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => openAddQuestions(cur.name)}>
                      <Plus className="h-4 w-4 ml-2" /> הוסף שאלה
                    </DropdownMenuItem>
                  </>
                );
              })()}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Export / Import */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" className="h-9 w-9 border-gold/40" title="ייצוא / ייבוא">
              <Download className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => exportBranch(currentParentId)}>
              <Download className="h-4 w-4 ml-2" /> ייצא תיקייה נוכחית
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportBranch(null)}>
              <Download className="h-4 w-4 ml-2" /> ייצא הכל
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 ml-2" /> ייבא JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={fileInputRef} type="file" accept=".json,application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importTree(f); e.target.value = ""; }} />
      </div>

      {/* Bulk action bar */}
      {multiSelected.size > 1 && (
        <div className="flex items-center gap-2 bg-gold/10 border-b border-gold/30 px-3 py-1.5 text-xs">
          <CheckSquare className="h-3.5 w-3.5 text-gold" />
          <span className="font-bold">{multiSelected.size} נבחרו</span>
          <div className="flex-1" />
          {onStudyMultipleCategories && (
            <>
              <Button size="sm" variant="outline" className="h-6 text-xs text-emerald-700 border-emerald-300"
                onClick={() => onStudyMultipleCategories(categories.filter((c) => multiSelected.has(c.id)).map((c) => c.name), "all")}>
                <Brain className="h-3 w-3 ml-1" /> תשאל
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-xs text-blue-600 border-blue-300"
                onClick={() => setMultiSummaryOpen(true)}>
                <BarChart2 className="h-3 w-3 ml-1" /> תסכם
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setMoveTargetOpen((v) => !v)}>
            <ArrowRightLeft className="h-3 w-3 ml-1" /> העבר
          </Button>
          <Button size="sm" variant="destructive" className="h-6 text-xs" onClick={handleBulkDelete}>
            <Trash2 className="h-3 w-3 ml-1" /> מחק
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setMultiSelected(new Set())}>נקה</Button>
        </div>
      )}
      {moveTargetOpen && multiSelected.size > 0 && (
        <div className="bg-secondary/50 border-b border-gold/20 px-3 py-2 max-h-40 overflow-y-auto">
          <p className="text-[10px] text-muted-foreground mb-1">בחר יעד:</p>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleBulkMove(null)}>
              <Home className="h-3 w-3 ml-1" /> רמת הבסיס
            </Button>
            {categories.filter((c) => !multiSelected.has(c.id)).map((c) => (
              <Button key={c.id} size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleBulkMove(c.id)}>
                <Folder className="h-3 w-3 ml-1 text-gold" /> {c.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div className={cn(
        "grid min-h-[480px]",
        prefs.layout === "columns"
          ? "grid-cols-1"
          : prefs.showPreview ? "grid-cols-[220px_1fr_240px]" : "grid-cols-[220px_1fr]",
      )}>
        {/* Sidebar */}
        {prefs.layout !== "columns" && (
          <aside className="border-l border-gold/20 bg-secondary/20 p-2 overflow-y-auto max-h-[640px] space-y-2">
            {/* Favorites */}
            {favoriteCats.length > 0 && (
              <div>
                <div className="text-[10px] font-bold text-muted-foreground px-2 py-1 uppercase tracking-wider flex items-center gap-1">
                  <Star className="h-3 w-3 fill-gold text-gold" /> מועדפים
                </div>
                {favoriteCats.map((c) => (
                  <div key={c.id}
                    onClick={() => { navigateTo(c.id); onSelectCategory(c.name); }}
                    className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-xs hover:bg-secondary",
                      selectedCategory === c.name && "bg-gradient-navy text-primary-foreground")}>
                    <Folder className="h-3 w-3 text-gold" />
                    <span className="flex-1 text-right truncate">{c.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Smart folders */}
            <div>
              <div className="flex items-center justify-between px-2 py-1">
                <button onClick={() => { setEditingSmart(null); setSmartDialogOpen(true); }}
                  className="opacity-60 hover:opacity-100" title="תיקייה חכמה חדשה">
                  <Plus className="h-3 w-3" />
                </button>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-gold" /> תיקיות חכמות
                </div>
              </div>
              {prefs.smartFolders.length === 0 && (
                <p className="text-[10px] text-muted-foreground text-center py-1">אין עדיין</p>
              )}
              {prefs.smartFolders.map((sf) => (
                <ContextMenu key={sf.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      onClick={() => { setActiveSmartId(sf.id); setCurrentParentId(null); onSelectCategory(null); }}
                      className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-xs hover:bg-secondary",
                        activeSmartId === sf.id && "bg-gradient-navy text-primary-foreground")}>
                      <Sparkles className="h-3 w-3 text-gold" />
                      <span className="flex-1 text-right truncate">{sf.name}</span>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => { setEditingSmart(sf); setSmartDialogOpen(true); }}>
                      <Edit3 className="h-4 w-4 ml-2" /> ערוך
                    </ContextMenuItem>
                    <ContextMenuItem className="text-destructive focus:text-destructive"
                      onClick={() => deleteSmartFolder(sf.id)}>
                      <Trash2 className="h-4 w-4 ml-2" /> מחק
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>

            <div className="border-t border-gold/20 my-1" />

            <div
              onClick={() => { navigateTo(null); onSelectCategory(null); }}
              className={cn("flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-xs font-bold",
                currentParentId === null && !activeSmartId ? "bg-gradient-navy text-primary-foreground" : "hover:bg-secondary")}
            >
              <Home className="h-3.5 w-3.5" /> כל הקטגוריות
            </div>
            {renderSidebar(null, 0)}
          </aside>
        )}

        {/* Main pane */}
        <main className="p-3 overflow-y-auto max-h-[640px] space-y-3" onClick={() => setMultiSelected(new Set())}>
          {/* Smart folder banner */}
          {activeSmartId && (
            <div className="flex items-center gap-2 bg-gold/10 border border-gold/40 rounded-lg px-3 py-2">
              <Sparkles className="h-4 w-4 text-gold" />
              <span className="text-sm font-bold flex-1">
                {prefs.smartFolders.find((s) => s.id === activeSmartId)?.name}
              </span>
              <Badge variant="outline">{cardsOfSelected.length} שאלות</Badge>
              <button onClick={() => setActiveSmartId(null)} className="opacity-60 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}



          {/* COLUMNS LAYOUT */}
          {prefs.layout === "columns" && !activeSmartId ? (
            <div className="flex gap-2 overflow-x-auto pb-2" onClick={(e) => e.stopPropagation()}>
              {millerCols.map((col, idx) => {
                const colParent = idx === 0 ? null : breadcrumbs[idx - 1] ?? null;
                // Direct cards of this column's parent category
                const directCards = colParent
                  ? state.cards.filter((c) => (c.tags ?? []).includes(`cat:${colParent.name}`))
                  : [];
                const isEmpty = col.items.length === 0 && directCards.length === 0;
                return (
                <div key={idx} className="w-56 shrink-0 border border-gold/30 rounded-lg bg-secondary/30 max-h-[560px] overflow-y-auto">
                  <div className="text-[10px] text-muted-foreground p-2 border-b border-gold/20 sticky top-0 bg-secondary/80 backdrop-blur">
                    {idx === 0 ? "בית" : breadcrumbs[idx - 1]?.name}
                  </div>
                  {isEmpty ? (
                    <p className="text-xs text-muted-foreground p-3 text-center">ריק</p>
                  ) : (
                    <>
                      {col.items.map((cat) => {
                    const isInPath = breadcrumbs.some((b) => b.id === cat.id);
                    const isColRenaming = renamingId === cat.id;
                    return (
                      <ContextMenu key={cat.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            onClick={(e) => { if (isColRenaming) return; e.stopPropagation(); enterFolder(cat); }}
                            className={cn(
                              "flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-sm transition-all",
                              isInPath ? "bg-gradient-navy text-primary-foreground" : "hover:bg-secondary",
                            )}
                          >
                            <Folder className="h-3.5 w-3.5 text-gold shrink-0" />
                            {isColRenaming ? (
                              <Input
                                ref={(el) => {
                                  if (el) {
                                    renameBlurReady.current.set(cat.id, false);
                                    setTimeout(() => {
                                      el.focus();
                                      el.select();
                                      renameBlurReady.current.set(cat.id, true);
                                    }, 150);
                                  }
                                }}
                                defaultValue={cat.name}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === "Enter") {
                                    const v = (e.target as HTMLInputElement).value;
                                    if (v.trim() && v !== cat.name) renameCategory(cat.id, v);
                                    setRenamingId(null);
                                  }
                                  if (e.key === "Escape") setRenamingId(null);
                                }}
                                onBlur={(e) => {
                                  if (!renameBlurReady.current.get(cat.id)) return;
                                  const v = e.target.value;
                                  if (v.trim() && v !== cat.name) renameCategory(cat.id, v);
                                  renameBlurReady.current.delete(cat.id);
                                  setRenamingId(null);
                                }}
                                className="h-6 text-sm flex-1 text-right px-1"
                              />
                            ) : (
                              <span className="flex-1 text-right truncate">{cat.name}</span>
                            )}
                            {!isColRenaming && prefs.favorites.includes(cat.id) && <Star className="h-2.5 w-2.5 fill-gold text-gold" />}
                            {!isColRenaming && (counts.get(cat.name) ?? 0) > 0 && (
                              <Badge variant="outline" className={cn(
                                "text-[9px] h-3.5 px-1 font-bold",
                                isInPath ? "border-gold text-gold bg-navy/40" : "border-gold/40 text-gold",
                              )}>{counts.get(cat.name)}</Badge>
                            )}
                            {!isColRenaming && <ChevronLeft className="h-3 w-3 opacity-50" />}
                          </div>
                        </ContextMenuTrigger>
                        <FolderContextMenu cat={cat} />
                      </ContextMenu>
                    );
                  })}
                      {/* Direct cards of this column's parent — shown inline with subfolders */}
                      {directCards.length > 0 && (
                        <>
                          {col.items.length > 0 && (
                            <div className="border-t border-gold/20 my-1" />
                          )}
                          {directCards.map((card) => (
                            <div
                              key={card.id}
                              onClick={(e) => { e.stopPropagation(); onEditCard?.(card); }}
                              className="group relative flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-sm hover:bg-secondary transition-all"
                              title={card.question}
                            >
                              <FileText className="h-3.5 w-3.5 text-gold/80 shrink-0" />
                              <span className="flex-1 text-right truncate text-xs">{card.question}</span>
                              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {onEditCard && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onEditCard(card); }}
                                    className="p-0.5 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                                    title="ערוך שאלה"
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`מחק את השאלה "${card.question.slice(0, 40)}..."?`)) deleteCard(card.id);
                                  }}
                                  className="p-0.5 rounded hover:bg-red-500/80 text-muted-foreground hover:text-white"
                                  title="מחק שאלה"
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  )}
                </div>
              );})}
            </div>
          ) : null}

          {/* GRID / LIST */}
          {prefs.layout !== "columns" && !activeSmartId && (
            visibleFolders.length === 0 && cardsOfSelected.length === 0 && !search.trim() ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Folder className="h-14 w-14 opacity-20" />
                <p className="text-sm">תיקייה ריקה</p>
                {(() => {
                  const cur = currentParentId ? categories.find((c) => c.id === currentParentId) : null;
                  if (!cur) return null;
                  return (
                    <div className="flex flex-wrap gap-2 mt-2 justify-center">
                      <Button
                        size="sm"
                        onClick={() => openAddQuestions(cur.name)}
                        className="bg-gradient-navy text-primary-foreground gap-1"
                      >
                        <Plus className="h-4 w-4" /> הוסף שאלה ל-{displayCategoryName(cur.name)}
                      </Button>
                    </div>
                  );
                })()}
                <p className="text-[10px]">Ctrl+A לבחור הכל · F2 לשנות שם · Del למחוק · Alt+→ לחזור</p>
              </div>
            ) : (
              <>
                {visibleFolders.length > 0 && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {currentParentId && (() => {
                          const cur = categories.find((c) => c.id === currentParentId);
                          if (!cur) return null;
                          return (
                            <Button
                              size="sm"
                              onClick={() => openAddQuestions(cur.name)}
                              className="h-7 text-xs gap-1 bg-gradient-navy text-primary-foreground"
                            >
                              <Plus className="h-3.5 w-3.5" /> הוסף שאלה כאן
                            </Button>
                          );
                        })()}
                        {(() => {
                        const cur = currentParentId ? categories.find((c) => c.id === currentParentId) : null;
                        if (!cur) return <span />;
                        return <span />;
                      })()}
                      </div>
                      <h4 className="text-[11px] font-bold text-muted-foreground text-right uppercase tracking-wider">
                        תיקיות ({visibleFolders.length})
                      </h4>
                    </div>
                    {prefs.layout === "grid" ? (
                      <div dir="rtl" className={cn("grid gap-3 items-stretch", cfg.gridCols)}>
                        {visibleFolders.map((cat) => (
                          <ContextMenu key={cat.id}>
                            <ContextMenuTrigger asChild>
                              <div>
                                <FolderTile
                                  cat={cat} count={counts.get(cat.name) ?? 0}
                                  mastery={masteryOfCat(cat.name)}
                                  iconSize={prefs.iconSize}
                                  isMultiSelected={multiSelected.has(cat.id)}
                                  isRenaming={renamingId === cat.id}
                                  isFavorite={prefs.favorites.includes(cat.id)}
                                  onOpen={() => enterFolder(cat)}
                                  onSelect={(e) => handleSelectFolder(cat, e)}
                                  onAdd={() => openAddQuestions(cat.name)}
                                  onStudy={onStudyCategory ? () => onStudyCategory(cat.name) : undefined}
                                  onRenameSubmit={(name) => {
                                    if (name.trim() && name !== cat.name) renameCategory(cat.id, name);
                                    setRenamingId(null);
                                  }}
                                  onCancelRename={() => setRenamingId(null)}
                                  showCount={prefs.showCounts}
                                  showMastery={prefs.showMastery}
                                />
                              </div>
                            </ContextMenuTrigger>
                            {multiSelected.has(cat.id) && multiSelected.size > 1
                              ? <MultiSelectionContextMenu />
                              : <FolderContextMenu cat={cat} />}
                          </ContextMenu>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {visibleFolders.map((cat) => (
                          <ContextMenu key={cat.id}>
                            <ContextMenuTrigger asChild>
                              <div>
                                <FolderListRow
                                  cat={cat} count={counts.get(cat.name) ?? 0}
                                  mastery={masteryOfCat(cat.name)}
                                  isMultiSelected={multiSelected.has(cat.id)}
                                  isRenaming={renamingId === cat.id}
                                  isFavorite={prefs.favorites.includes(cat.id)}
                                  onOpen={() => enterFolder(cat)}
                                  onSelect={(e) => handleSelectFolder(cat, e)}
                                  onAdd={() => openAddQuestions(cat.name)}
                                  onStudy={onStudyCategory ? () => onStudyCategory(cat.name) : undefined}
                                  onRenameSubmit={(name) => {
                                    if (name.trim() && name !== cat.name) renameCategory(cat.id, name);
                                    setRenamingId(null);
                                  }}
                                  onCancelRename={() => setRenamingId(null)}
                                  showCount={prefs.showCounts}
                                  showMastery={prefs.showMastery}
                                  compact={prefs.compactRows}
                                />
                              </div>
                            </ContextMenuTrigger>
                            {multiSelected.has(cat.id) && multiSelected.size > 1
                              ? <MultiSelectionContextMenu />
                              : <FolderContextMenu cat={cat} />}
                          </ContextMenu>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )
          )}

          {/* Cards (selected category, smart folder, or in-card search) */}
          {cardsOfSelected.length > 0 && (
            <div className="pt-2" onClick={(e) => e.stopPropagation()}>
              {/* Header row */}
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  {selectedCategory && !activeSmartId && (
                    <Button size="sm" onClick={() => openAddQuestions(selectedCategory)}
                      className="h-7 px-2 text-xs gap-1 bg-gradient-navy text-primary-foreground">
                      <Plus className="h-3 w-3" /> שאלה חדשה
                    </Button>
                  )}
                  {/* Select all / deselect all */}
                  <button
                    onClick={() => {
                      if (selectedCardIds.size === cardsOfSelected.length) {
                        setSelectedCardIds(new Set());
                      } else {
                        setSelectedCardIds(new Set(cardsOfSelected.map((c) => c.id)));
                      }
                    }}
                    className="flex items-center gap-1 h-7 px-2 text-xs rounded-lg border border-gold/40 bg-card text-muted-foreground hover:text-foreground hover:border-gold/70 transition-colors"
                    title={selectedCardIds.size === cardsOfSelected.length ? "בטל בחירת הכל" : "בחר הכל"}
                  >
                    {selectedCardIds.size === cardsOfSelected.length
                      ? <><CheckSquare className="h-3.5 w-3.5 text-gold" /> בטל הכל</>
                      : <><Square className="h-3.5 w-3.5" /> בחר הכל</>}
                  </button>
                </div>
                <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  {activeSmartId ? "תוצאות" : search.trim() ? "תוצאות חיפוש" : `שאלות ב"${selectedCategory}"`}
                  {" "}({cardsOfSelected.length})
                </h4>
              </div>
              {/* Action bar — visible when any cards are selected */}
              {selectedCardIds.size > 0 && (
                <div className="flex items-center gap-2 mb-2 rounded-xl border-2 border-gold/50 bg-gold/5 px-3 py-1.5">
                  <span className="text-xs font-bold text-gold">{selectedCardIds.size} נבחרו</span>
                  <Button
                    size="sm"
                    onClick={() => { setClassifyDeckIds(new Set()); setNewDeckNameForClassify(""); setClassifyDialogOpen(true); }}
                    className="h-7 px-2 text-xs gap-1 bg-gradient-navy text-primary-foreground mr-auto"
                  >
                    <Layers className="h-3 w-3" /> סווג למערכת
                  </Button>
                  <button
                    onClick={() => setSelectedCardIds(new Set())}
                    className="h-7 px-2 text-xs rounded-lg border border-gold/40 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {/* Cards grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {cardsOfSelected.map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    query={search.trim() || undefined}
                    selected={selectedCardIds.has(card.id)}
                    selectionMode={selectedCardIds.size > 0}
                    onToggleSelect={() => setSelectedCardIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(card.id)) next.delete(card.id); else next.add(card.id);
                      return next;
                    })}
                    onEdit={onEditCard ? () => onEditCard(card) : undefined}
                    onDelete={() => {
                      if (confirm(`מחק את השאלה "${card.question.slice(0, 40)}..."?`)) deleteCard(card.id);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Preview pane */}
        {prefs.showPreview && prefs.layout !== "columns" && (
          <aside className="border-r border-gold/20 bg-secondary/10 p-3 overflow-y-auto max-h-[640px]">
            {previewCategory && previewStats ? (
              <div className="space-y-3">
                <div className="text-center">
                  <Folder className="h-16 w-16 text-gold mx-auto mb-2" strokeWidth={1.4} />
                  <h3 className="font-display font-bold text-base">{previewCategory.name}</h3>
                  {prefs.favorites.includes(previewCategory.id) && (
                    <Badge variant="outline" className="mt-1 text-[10px] border-gold/50">
                      <Star className="h-2.5 w-2.5 fill-gold text-gold ml-1" /> מועדף
                    </Badge>
                  )}
                </div>
                <div className="space-y-2">
                  <PreviewStat label="שאלות" value={previewStats.cards} />
                  <PreviewStat label="תתי-קטגוריות" value={previewStats.subs} />
                  <PreviewStat label="לחזרה היום" value={previewStats.due} highlight={previewStats.due > 0} />
                  {previewStats.mastery != null && (
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-bold">{previewStats.mastery}%</span>
                        <span className="text-muted-foreground">אחוז שליטה</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className={cn("h-full",
                          previewStats.mastery >= 80 ? "bg-emerald-500" :
                          previewStats.mastery >= 50 ? "bg-amber-500" : "bg-red-500",
                        )} style={{ width: `${previewStats.mastery}%` }} />
                      </div>
                    </div>
                  )}
                  <PreviewStat label="לימוד אחרון" value={previewStats.lastReview} />
                </div>
                <div className="space-y-1 pt-2 border-t border-gold/20">
                  <Button size="sm" variant="outline" className="w-full h-7 text-xs"
                    onClick={() => openAddQuestions(previewCategory.name)}>
                    <Plus className="h-3 w-3 ml-1" /> שאלה חדשה
                  </Button>
                  <Button size="sm" variant="outline" className="w-full h-7 text-xs"
                    onClick={() => toggleFavorite(previewCategory.id)}>
                    <Star className={cn("h-3 w-3 ml-1",
                      prefs.favorites.includes(previewCategory.id) && "fill-gold text-gold")} />
                    {prefs.favorites.includes(previewCategory.id) ? "הסר ממועדפים" : "הוסף למועדפים"}
                  </Button>
                  <Button size="sm" variant="outline" className="w-full h-7 text-xs"
                    onClick={() => exportBranch(previewCategory.id)}>
                    <Download className="h-3 w-3 ml-1" /> ייצא ענף
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center gap-2 py-8">
                <Eye className="h-10 w-10 opacity-30" />
                <p className="text-xs">בחר תיקייה לתצוגת פרטים</p>
              </div>
            )}
          </aside>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground text-right px-3 py-1.5 border-t border-gold/20 bg-secondary/20">
        💡 דאבל-קליק לפתיחה · קליק ימני לתפריט · Ctrl+קליק / Shift לבחירה מרובה · F2 שם · Del מחק · Backspace חזור · Alt+→/← היסטוריה
      </p>

      {/* Classify selected cards to deck dialog */}
      <Dialog open={classifyDialogOpen} onOpenChange={(o) => { setClassifyDialogOpen(o); if (!o) setSelectedCardIds(new Set()); }}>
        <DialogContent className="max-w-sm gold-frame" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right flex items-center gap-2">
              <Layers className="h-4 w-4 text-gold" />
              סווג שאלות למערכת
            </DialogTitle>
            <DialogDescription className="text-right text-xs">
              {selectedCardIds.size} שאלות נבחרו · בחר מערכת קיימת או צור מערכת חדשה
            </DialogDescription>
          </DialogHeader>

          {/* Existing decks list */}
          <div className="space-y-1 max-h-52 overflow-y-auto py-1">
            {state.decks.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">אין מערכות קיימות</p>
            )}
            {state.decks.map((deck) => {
              const checked = classifyDeckIds.has(deck.id);
              const cardCount = (state.cardDecks ?? []).filter((l) => l.deckId === deck.id).length;
              return (
                <button
                  key={deck.id}
                  onClick={() => setClassifyDeckIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(deck.id)) next.delete(deck.id); else next.add(deck.id);
                    return next;
                  })}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-right text-sm transition-colors",
                    checked ? "border-gold bg-gold/10 text-foreground" : "border-gold/25 bg-card hover:border-gold/50",
                  )}
                >
                  {checked
                    ? <CheckSquare className="h-4 w-4 text-gold shrink-0" />
                    : <Square className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="flex-1 truncate">{deck.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{cardCount} שאלות</span>
                </button>
              );
            })}
          </div>

          {/* New deck section */}
          <div className="border-t border-gold/20 pt-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">+ מערכת חדשה</p>
            <div className="flex gap-2">
              <Input
                dir="rtl"
                placeholder="שם המערכת החדשה..."
                value={newDeckNameForClassify}
                onChange={(e) => setNewDeckNameForClassify(e.target.value)}
                className="text-sm h-8 flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newDeckNameForClassify.trim()) {
                    const deck = addDeck(newDeckNameForClassify.trim(), undefined, []);
                    setClassifyDeckIds((prev) => new Set([...prev, deck.id]));
                    setNewDeckNameForClassify("");
                  }
                }}
              />
              <Button
                size="sm"
                disabled={!newDeckNameForClassify.trim()}
                onClick={() => {
                  const deck = addDeck(newDeckNameForClassify.trim(), undefined, []);
                  setClassifyDeckIds((prev) => new Set([...prev, deck.id]));
                  setNewDeckNameForClassify("");
                }}
                className="h-8 text-xs bg-gradient-navy text-primary-foreground"
              >
                צור
              </Button>
            </div>
          </div>

          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
            <Button
              disabled={classifyDeckIds.size === 0}
              onClick={() => {
                const cardIds = [...selectedCardIds];
                const deckIds = [...classifyDeckIds];
                for (const cardId of cardIds) {
                  for (const deckId of deckIds) {
                    addCardToDeck(cardId, deckId);
                  }
                }
                toast({
                  title: "שאלות שויכו למערכות",
                  description: `${cardIds.length} שאלות → ${deckIds.length} מערכות`,
                });
                setClassifyDialogOpen(false);
                setSelectedCardIds(new Set());
              }}
              className="bg-gradient-navy text-primary-foreground gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              שייך ({classifyDeckIds.size > 0 ? classifyDeckIds.size : ""} מערכות)
            </Button>
            <Button variant="outline" onClick={() => setClassifyDialogOpen(false)}>בטל</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Smart folder dialog */}
      <SmartFolderDialog
        open={smartDialogOpen}
        onOpenChange={setSmartDialogOpen}
        editing={editingSmart}
        categories={categories}
        onSave={(sf) => { saveSmartFolder(sf); setSmartDialogOpen(false); }}
      />

      {/* Add categories dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-right">
              {addDialogMulti ? "הוספת קטגוריות מרובות" : "הוספת קטגוריה"}
            </DialogTitle>
            <DialogDescription className="text-right">
              {addDialogMulti
                ? "הקלד שם בכל שורה — כל שורה תיווצר כקטגוריה נפרדת."
                : currentParentId ? "תת-קטגוריה תיווצר תחת התיקייה הנוכחית." : "קטגוריה ראשית חדשה."}
            </DialogDescription>
          </DialogHeader>
          {addDialogMulti ? (
            <Textarea
              autoFocus
              value={addDialogText}
              onChange={(e) => setAddDialogText(e.target.value)}
              placeholder={"שם 1\nשם 2\nשם 3"}
              className="min-h-[160px] text-right"
              dir="rtl"
            />
          ) : (
            <Input
              autoFocus
              value={addDialogText}
              onChange={(e) => setAddDialogText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitAddDialog(); }}
              placeholder={currentParentId ? "תת-קטגוריה חדשה..." : "קטגוריה ראשית חדשה..."}
              className="text-right"
              dir="rtl"
            />
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>ביטול</Button>
            <Button onClick={submitAddDialog} className="bg-gradient-navy text-primary-foreground">
              <Plus className="h-4 w-4 ml-1" /> הוסף
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add questions dialog (quick / bulk) */}
      <Dialog open={addQOpen} onOpenChange={setAddQOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-right flex items-center gap-2">
              <Plus className="h-4 w-4 text-gold" />
              הוסף שאלות ל-{addQCategory ? displayCategoryName(addQCategory) : ""}
            </DialogTitle>
            <DialogDescription className="text-right">
              שאלה מהירה או מספר שאלות בבת אחת. בכל מצב אפשר לפתוח את העורך המלא.
            </DialogDescription>
          </DialogHeader>

          <div className="flex border border-gold/30 rounded-md p-0.5 gap-0.5 mb-2">
            {([
              ["quick", "מהיר"],
              ["bulk", "מרובה (שאלה | תשובה)"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setAddQTab(id)}
                className={cn("flex-1 h-8 text-xs rounded transition-all",
                  addQTab === id ? "bg-gradient-navy text-primary-foreground" : "hover:bg-secondary")}>
                {label}
              </button>
            ))}
          </div>

          {addQTab === "quick" ? (
            <div className="space-y-2">
              <Label className="text-right block text-xs">שאלה</Label>
              <Input autoFocus value={addQSingleQ} onChange={(e) => setAddQSingleQ(e.target.value)}
                placeholder="כתוב את השאלה..." className="text-right" dir="rtl" />
              <Label className="text-right block text-xs">תשובה (אופציונלי)</Label>
              <Textarea value={addQSingleA} onChange={(e) => setAddQSingleA(e.target.value)}
                placeholder="כתוב את התשובה..." className="min-h-[100px] text-right" dir="rtl"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitAddQuestions(); }} />
              <p className="text-[10px] text-muted-foreground">Ctrl+Enter לשמירה</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-right block text-xs">שורה לכל שאלה: <span className="font-mono">שאלה | תשובה</span></Label>
              <Textarea autoFocus value={addQBulkText} onChange={(e) => setAddQBulkText(e.target.value)}
                placeholder={"מה זה X? | תשובה 1\nמה זה Y? | תשובה 2"}
                className="min-h-[200px] text-right font-mono text-xs" dir="rtl" />
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2 flex-row-reverse">
            <Button onClick={submitAddQuestions} className="bg-gradient-navy text-primary-foreground">
              <Plus className="h-4 w-4 ml-1" /> {addQTab === "bulk" ? "הוסף הכל" : "הוסף שאלה"}
            </Button>
            <Button variant="outline" onClick={() => {
              if (addQCategory) { setAddQOpen(false); onAddCardToCategory(addQCategory); }
            }}>
              <Edit3 className="h-4 w-4 ml-1" /> פתח עורך מלא
            </Button>
            <Button variant="ghost" onClick={() => setAddQOpen(false)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Card picker for selective deck assignment */}
      <CategoryCardPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        category={pickerCat}
        deckId={pickerDeckId}
      />

      {/* Templates dialog */}
      <CategoryTemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />

      {/* Multi-select summary dialog */}
      <Dialog open={multiSummaryOpen} onOpenChange={setMultiSummaryOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-blue-500" />
              סיכום בחירה — {multiSelected.size} תיקיות
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto max-h-96">
            <table className="w-full text-sm text-right">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs">
                  <th className="py-1 px-2 font-medium">תיקייה</th>
                  <th className="py-1 px-2 font-medium text-center">שאלות</th>
                  <th className="py-1 px-2 font-medium text-center">שליטה</th>
                  <th className="py-1 px-2 font-medium text-center">לחזרה</th>
                </tr>
              </thead>
              <tbody>
                {categories.filter((c) => multiSelected.has(c.id)).map((c) => {
                  const now = Date.now();
                  const catCards = state.cards.filter((card) => card.tags.includes(`cat:${c.name}`));
                  const due = catCards.filter((card) => card.srs.dueAt <= now).length;
                  const mastery = masteryOfCat(c.name);
                  return (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="py-1.5 px-2">{displayCategoryName(c.name)}</td>
                      <td className="py-1.5 px-2 text-center">{catCards.length}</td>
                      <td className="py-1.5 px-2 text-center">
                        <span className={cn("font-medium", mastery >= 80 ? "text-emerald-600" : mastery >= 50 ? "text-amber-600" : "text-red-500")}>
                          {mastery}%
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {due > 0 ? <span className="text-amber-600 font-medium">{due}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t border-border">
                  <td className="py-2 px-2">סה"כ</td>
                  <td className="py-2 px-2 text-center">
                    {categories.filter((c) => multiSelected.has(c.id)).reduce((s, c) => s + state.cards.filter((card) => card.tags.includes(`cat:${c.name}`)).length, 0)}
                  </td>
                  <td className="py-2 px-2 text-center text-muted-foreground">—</td>
                  <td className="py-2 px-2 text-center text-amber-600">
                    {categories.filter((c) => multiSelected.has(c.id)).reduce((s, c) => s + state.cards.filter((card) => card.tags.includes(`cat:${c.name}`) && card.srs.dueAt <= Date.now()).length, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <DialogFooter className="flex gap-2">
            {onStudyMultipleCategories && (
              <>
                <Button variant="outline" onClick={() => {
                  onStudyMultipleCategories(categories.filter((c) => multiSelected.has(c.id)).map((c) => c.name), "due");
                  setMultiSummaryOpen(false);
                }}>
                  <ListChecks className="h-4 w-4 ml-1 text-amber-600" /> תמליץ (לחזרה בלבד)
                </Button>
                <Button onClick={() => {
                  onStudyMultipleCategories(categories.filter((c) => multiSelected.has(c.id)).map((c) => c.name), "all");
                  setMultiSummaryOpen(false);
                }}>
                  <Brain className="h-4 w-4 ml-1" /> תשאל הכל
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>{/* end zoom wrapper */}
    </div>
  );
}

function PreviewStat({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className={cn("font-bold", highlight && "text-gold")}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

/* === Smart folder dialog === */
function SmartFolderDialog({
  open, onOpenChange, editing, categories, onSave,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  editing: SmartFolder | null; categories: Category[];
  onSave: (sf: SmartFolder) => void;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SmartFolder["scope"]>("all");
  const [catName, setCatName] = useState<string>("");
  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setQuery(editing?.query ?? "");
      setScope(editing?.scope ?? "all");
      setCatName(editing?.catName ?? "");
    }
  }, [open, editing]);

  const submit = () => {
    if (!name.trim()) return;
    onSave({
      id: editing?.id ?? `sf-${Date.now()}`,
      name: name.trim(), query, scope,
      catName: catName || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{editing ? "ערוך תיקייה חכמה" : "תיקייה חכמה חדשה"}</DialogTitle>
          <DialogDescription>שמירת חיפוש כתיקייה דינמית שמתעדכנת אוטומטית.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">שם</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-right" />
          </div>
          <div>
            <Label className="text-xs">סינון לפי</Label>
            <select value={scope} onChange={(e) => setScope(e.target.value as SmartFolder["scope"])}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="all">הכל</option>
              <option value="failed">שאלות שנכשלתי בהן (פחות מ-50%)</option>
              <option value="due">שאלות לחזרה היום</option>
              <option value="mastered">שאלות שנשלטו (מעל 85%)</option>
              <option value="new">שאלות חדשות (לא נלמדו)</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">מילת חיפוש (אופציונלי)</Label>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="טקסט בשאלה..."
              className="text-right" />
          </div>
          <div>
            <Label className="text-xs">קטגוריה (אופציונלי)</Label>
            <select value={catName} onChange={(e) => setCatName(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">כל הקטגוריות</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={submit} disabled={!name.trim()}
            className="bg-gradient-navy text-primary-foreground">שמור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
