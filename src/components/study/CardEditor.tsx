import { useState, useMemo } from "react";
import { Plus, X, FolderTree, Search, Star, Trash2, ChevronUp, ChevronDown, Pin, PinOff, Sparkles, Loader2, BookOpen, Eye } from "lucide-react";
import { CategoryPickerDialog } from "./CategoryPickerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter, Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Card as StudyCardType, CardType } from "@/lib/study/types";
import { useStudy } from "@/lib/study/store";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/useConfirm";
import { SHAS_BAVLI, SEDARIM } from "@/lib/study/shasData";
import { dafLabel } from "@/lib/study/shasGen";
import { GemaraViewer } from "./GemaraViewer";

const RECENT_CATS_KEY = "card-editor:recent-cats";
const MAX_RECENT = 6;

// Helper: union-accessible card type for reading optional fields in state initializers
type AnyCard = StudyCardType & { answer?: string; options?: string[]; correctIndices?: number[]; explanation?: string; masechta?: string; daf?: number; amud?: 1 | 2 };

interface Props {
  deckId?: string | null; // optional – null means card belongs to categories only
  onClose?: () => void;
  editCard?: StudyCardType; // when provided, edit instead of create
  prefillCategories?: string[]; // pre-select category names when creating a new card
}

export function CardEditor({ deckId, onClose, editCard, prefillCategories }: Props) {
  const { addCard, updateCard, addCategory, deleteCategory, addDeck, updateDeckCategoryIds, setUiPref, state } = useStudy();
  const { confirm, dialog } = useConfirm();
  const isEdit = !!editCard;

  // Deck assignment (optional – category-owned cards have null)
  // For NEW cards: do NOT auto-assign to the active deck just because the user is viewing it.
  // The user must explicitly link the card's category to a deck via the "שייך קטגוריה למערכת" panel below.
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(
    editCard?.deckId ?? null,
  );

  const [type, setType] = useState<CardType>(editCard?.type ?? "flashcard");
  // Create-mode: which question types to generate at once (one card per type).
  // Default: only flashcard. In edit-mode this state is ignored (single type).
  const [createTypes, setCreateTypes] = useState<CardType[]>(
    editCard ? [editCard.type] : ["flashcard"],
  );
  const toggleCreateType = (t: CardType) => {
    setCreateTypes((arr) =>
      arr.includes(t)
        ? (arr.length > 1 ? arr.filter((x) => x !== t) : arr) // keep at least one
        : [...arr, t],
    );
  };
  const hasType = (t: CardType) => (isEdit ? type === t : createTypes.includes(t));
  const [question, setQuestion] = useState(editCard?.question ?? "");
  const [answer, setAnswer] = useState(
    editCard && (editCard.type === "flashcard" || editCard.type === "combo") ? (editCard as AnyCard).answer ?? "" : "",
  );
  const [options, setOptions] = useState<string[]>(
    editCard && (editCard.type === "multiple" || editCard.type === "combo")
      ? (editCard as AnyCard).options ?? ["", ""]
      : ["", ""],
  );
  const [correctIndices, setCorrectIndices] = useState<number[]>(
    editCard && (editCard.type === "multiple" || editCard.type === "combo")
      ? (editCard as AnyCard).correctIndices ?? []
      : [],
  );
  const [boolCorrect, setBoolCorrect] = useState<"true" | "false">(
    editCard?.type === "boolean" ? (editCard.correct ? "true" : "false") : "true",
  );
  const [explanation, setExplanation] = useState(
    editCard && (editCard.type === "boolean" || editCard.type === "combo") ? (editCard as AnyCard).explanation ?? "" : "",
  );

  // === Daf/Amud assignment ===
  const initMasechta = (editCard as AnyCard | undefined)?.masechta ?? "";
  const initDaf = (editCard as AnyCard | undefined)?.daf;
  const initAmud = ((editCard as AnyCard | undefined)?.amud ?? 1) as 1 | 2;
  const [masechta, setMasechta] = useState<string>(initMasechta);
  const [daf, setDaf] = useState<number | undefined>(initDaf);
  const [amud, setAmud] = useState<1 | 2>(initAmud);
  const [viewerOpen, setViewerOpen] = useState(false);
  const currentMasechetMeta = useMemo(() => SHAS_BAVLI.find((m) => m.name === masechta), [masechta]);

  // Tags - extract category tags (cat:NAME) separately
  const initialTags = editCard?.tags ?? [];
  const initialCategoryNames = initialTags.filter((t) => t.startsWith("cat:")).map((t) => t.slice(4));
  const initialPlainTags = initialTags.filter((t) => !t.startsWith("cat:"));
  const [tagsInput, setTagsInput] = useState(initialPlainTags.join(", "));
  const [selectedCategoryNames, setSelectedCategoryNames] = useState<string[]>(
    isEdit ? initialCategoryNames : (prefillCategories ?? initialCategoryNames),
  );

  // === AI category classification ===
  const [aiClassifying, setAiClassifying] = useState(false);

  // Combo: which modes to enable
  const [comboFlashEnabled, setComboFlashEnabled] = useState(
    editCard?.type === "combo" ? !!(editCard as AnyCard).answer : true,
  );
  const [comboMultiEnabled, setComboMultiEnabled] = useState(
    editCard?.type === "combo" ? !!((editCard as AnyCard).options?.length) : true,
  );

  // === Build category tree options for selector ===
  const categoryOptions = useMemo(() => {
    const categories = state.categories ?? [];
    const result: { id: string; label: string; name: string; path: string; depth: number; parentId: string | null }[] = [];
    const walk = (parentId: string | null, depth: number, parentPath: string) => {
      categories
        .filter((c) => c.parentId === parentId)
        .forEach((c) => {
          const path = parentPath ? `${parentPath} / ${c.name}` : c.name;
          result.push({ id: c.id, label: path, name: c.name, path, depth, parentId: c.parentId });
          walk(c.id, depth + 1, path);
        });
    };
    walk(null, 0, "");
    return result;
  }, [state.categories]);

  const pathByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const opt of categoryOptions) {
      if (!m.has(opt.name)) m.set(opt.name, opt.path);
    }
    return m;
  }, [categoryOptions]);

  // === Recently used categories (per-user localStorage) ===
  const [recentCats, setRecentCats] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_CATS_KEY);
      return raw ? (JSON.parse(raw) as string[]).slice(0, MAX_RECENT) : [];
    } catch { return []; }
  });
  const pushRecent = (names: string[]) => {
    if (names.length === 0) return;
    setRecentCats((prev) => {
      const next = [...names, ...prev.filter((n) => !names.includes(n))].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_CATS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // === Category picker dialog state ===
  const [showPicker, setShowPicker] = useState(false);

  // === Inline create-category form state ===
  const [showCreate, setShowCreate] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatParentId, setNewCatParentId] = useState<string>("__root__");
  const [catSearch, setCatSearch] = useState("");

  // Smart filter: tokenize query (whitespace-separated), every token must match
  // somewhere in the full hierarchical path (case-insensitive). Sort by best match:
  // exact name match > startsWith name > contains name > path-only match.
  const filteredCategoryOptions = useMemo(() => {
    const raw = catSearch.trim().toLowerCase();
    if (!raw) return categoryOptions;
    const tokens = raw.split(/\s+/).filter(Boolean);
    const scored = categoryOptions
      .map((c) => {
        const name = c.name.toLowerCase();
        const path = c.path.toLowerCase();
        const ok = tokens.every((t) => path.includes(t));
        if (!ok) return null;
        let score = 0;
        if (name === raw) score = 100;
        else if (name.startsWith(raw)) score = 80;
        else if (name.includes(raw)) score = 60;
        else score = 20;
        score -= c.depth; // prefer shallower matches when tied
        return { c, score };
      })
      .filter((x): x is { c: typeof categoryOptions[number]; score: number } => x !== null)
      .sort((a, b) => b.score - a.score);
    return scored.map((s) => s.c);
  }, [categoryOptions, catSearch]);

  // Pinned category names (synced via uiPrefs)
  const pinnedCats = state.uiPrefs?.pinnedCats ?? [];
  const togglePinCategory = (name: string) => {
    const cur = state.uiPrefs?.pinnedCats ?? [];
    const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
    setUiPref("pinnedCats", next);
  };

  // === Frequently-used categories (from existing cards) ===
  const frequentCats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of state.cards) {
      for (const t of c.tags ?? []) {
        if (t.startsWith("cat:")) {
          const name = t.slice(4);
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }, [state.cards]);

  // Recently-used names that exist as categories — combine localStorage history with frequent usage
  const recentExisting = useMemo(() => {
    const valid = new Set(categoryOptions.map((c) => c.name));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of [...recentCats, ...frequentCats]) {
      if (!valid.has(n)) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  }, [recentCats, frequentCats, categoryOptions]);

  // Pinned that still exist
  const pinnedExisting = useMemo(() => {
    const valid = new Set(categoryOptions.map((c) => c.name));
    return pinnedCats.filter((n) => valid.has(n));
  }, [pinnedCats, categoryOptions]);

  // Show the full chip list only when the user opens it (or starts searching)
  const [showAllCats, setShowAllCats] = useState(false);
  const expandFullList = !!catSearch.trim() || showAllCats;

  /**
   * Create a category from a slash-path: "חומש/שמות/כי תשא"
   * Walks the existing tree, creating missing nodes. Returns the leaf name.
   */
  const createFromPath = (path: string, baseParentId: string | null): string | null => {
    const parts = path.split("/").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    let pid: string | null = baseParentId;
    let leafName = "";
    for (const part of parts) {
      const existing = (state.categories ?? []).find((c) => c.parentId === pid && c.name === part);
      if (existing) {
        pid = existing.id;
        leafName = existing.name;
      } else {
        try {
          const cat = addCategory(part, pid);
          pid = cat.id;
          leafName = cat.name;
        } catch (e) {
          console.error("[CardEditor] addCategory failed", e);
          return null;
        }
      }
    }
    return leafName;
  };

  const handleCreateCategory = () => {
    const name = newCatName.trim();
    if (!name) return;
    const baseParentId = newCatParentId === "__root__" ? null : newCatParentId;
    const leaf = createFromPath(name, baseParentId);
    if (leaf) {
      setSelectedCategoryNames((arr) => arr.includes(leaf) ? arr : [...arr, leaf]);
      pushRecent([leaf]);
    }
    setNewCatName("");
    setShowCreate(false);
  };

  const createSubcategory = (parentId: string, parentName: string) => {
    const name = window.prompt(`שם תת-קטגוריה תחת "${parentName}":`)?.trim();
    if (!name) return;
    const leaf = createFromPath(name, parentId);
    if (leaf) {
      setSelectedCategoryNames((arr) => arr.includes(leaf) ? arr : [...arr, leaf]);
      pushRecent([leaf]);
    }
  };

  const toggleCategory = (name: string) => {
    setSelectedCategoryNames((arr) =>
      arr.includes(name) ? arr.filter((x) => x !== name) : [...arr, name],
    );
  };

  const handleSave = () => {
    if (!question.trim()) return;
    const plainTags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    const categoryTags = selectedCategoryNames.map((n) => `cat:${n}`);
    const tags = [...plainTags, ...categoryTags];
    if (selectedCategoryNames.length) pushRecent(selectedCategoryNames);

    type NewCard = Omit<StudyCardType, "id" | "createdAt" | "srs" | "stats">;
    const dId = selectedDeckId;
    const dafFields: { masechta?: string | null; daf?: number | null; amud?: 1 | 2 | null } = masechta && daf
      ? { masechta, daf, amud }
      : { masechta: null, daf: null, amud: null };

    // ---- EDIT MODE: keep single-card update ----
    if (isEdit && editCard) {
      const save = (card: Record<string, unknown>) => {
        updateCard(editCard.id, card);
        onClose?.();
      };
      if (type === "flashcard") {
        if (!answer.trim()) return;
        save({ deckId: dId, type, question, answer, tags, ...dafFields });
      } else if (type === "multiple") {
        const cleanOpts = options.map((o) => o.trim());
        if (cleanOpts.some((o) => !o) || correctIndices.length === 0) return;
        save({ deckId: dId, type, question, options: cleanOpts, correctIndices, tags, ...dafFields });
      } else if (type === "boolean") {
        save({ deckId: dId, type, question, correct: boolCorrect === "true", explanation, tags, ...dafFields });
      } else {
        // combo (legacy edit)
        if (!comboFlashEnabled && !comboMultiEnabled) return;
        let comboAnswer: string | undefined;
        let comboOptions: string[] | undefined;
        let comboCorrectIndices: number[] | undefined;
        if (comboFlashEnabled) {
          if (!answer.trim()) return;
          comboAnswer = answer;
        }
        if (comboMultiEnabled) {
          const cleanOpts = options.map((o) => o.trim());
          if (cleanOpts.some((o) => !o) || correctIndices.length === 0) return;
          comboOptions = cleanOpts;
          comboCorrectIndices = correctIndices;
        }
        save({ deckId: dId, type, question, tags, explanation, ...dafFields,
          answer: comboAnswer, options: comboOptions, correctIndices: comboCorrectIndices });
      }
      return;
    }

    // ---- CREATE MODE: one card per selected type, sharing question + tags ----
    if (createTypes.length === 0) return;
    const cards: NewCard[] = [];
    if (createTypes.includes("flashcard")) {
      if (!answer.trim()) return;
      cards.push({ deckId: dId, type: "flashcard", question, answer, tags, ...dafFields } as unknown as NewCard);
    }
    if (createTypes.includes("multiple")) {
      const cleanOpts = options.map((o) => o.trim());
      if (cleanOpts.some((o) => !o) || correctIndices.length === 0) return;
      cards.push({ deckId: dId, type: "multiple", question, options: cleanOpts, correctIndices, tags, ...dafFields } as unknown as NewCard);
    }
    if (createTypes.includes("boolean")) {
      cards.push({ deckId: dId, type: "boolean", question, correct: boolCorrect === "true", explanation, tags, ...dafFields } as unknown as NewCard);
    }
    for (const c of cards) addCard(c);
    onClose?.();
  };

  const showFlashFields = hasType("flashcard") || (type === "combo" && comboFlashEnabled && isEdit);
  const showMultiFields = hasType("multiple") || (type === "combo" && comboMultiEnabled && isEdit);
  const showBooleanFields = hasType("boolean");

  return (
    <div dir="rtl" className="space-y-4">
      {/* === Categories — moved to TOP === */}
      <div className="space-y-2 rounded-xl border-2 border-gold/40 bg-secondary/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="flex items-center gap-1.5">
            <FolderTree className="h-4 w-4" /> קטגוריות
            {selectedCategoryNames.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                ({selectedCategoryNames.length} נבחרו)
              </span>
            )}
          </Label>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={aiClassifying || !question.trim() || categoryOptions.length === 0}
              onClick={async () => {
                if (!question.trim() || categoryOptions.length === 0) return;
                setAiClassifying(true);
                try {
                  const paths = categoryOptions.map((c) => c.label || c.name);
                  const { data, error } = await supabase.functions.invoke("classify-category", {
                    body: {
                      question,
                      answer: answer || undefined,
                      categories: paths,
                      maxResults: 2,
                    },
                  });
                  if (error) throw error;
                  const matchPaths: string[] = Array.isArray(data?.matches) ? data.matches : [];
                  if (matchPaths.length === 0) {
                    toast({ title: "לא נמצאה קטגוריה מתאימה", description: "נסה לנסח את השאלה ביתר פירוט." });
                    return;
                  }
                  // Map full paths back to leaf names (selectedCategoryNames stores leaf names)
                  const pathToName = new Map(categoryOptions.map((c) => [c.label || c.name, c.name]));
                  const newNames = matchPaths
                    .map((p) => pathToName.get(p))
                    .filter((n): n is string => !!n);
                  setSelectedCategoryNames((prev) => Array.from(new Set([...prev, ...newNames])));
                  toast({ title: "סווג עם AI", description: `נבחרו: ${matchPaths.join(", ")}` });
                } catch (e) {
                  console.error("classify-category error", e);
                  const msg = (e as { message?: string })?.message || "שגיאה בסיווג";
                  toast({ title: "סיווג נכשל", description: msg, variant: "destructive" });
                } finally {
                  setAiClassifying(false);
                }
              }}
              title="סווג את השאלה לקטגוריה הנכונה לפי תוכנה"
              className="h-7 gap-1 px-2 text-xs border-gold/50 text-navy hover:border-gold hover:bg-gold/10"
            >
              {aiClassifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              סווג עם AI
            </Button>
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              title="בחר קטגוריה"
              className="h-7 w-7 rounded-full border-2 border-gold/50 bg-card text-navy hover:border-navy hover:bg-navy/10 flex items-center justify-center transition-all"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Inline create form */}
        {showCreate && (
          <div className="rounded-lg border-2 border-navy/40 bg-card p-2.5 space-y-2">
            <Input
              autoFocus
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleCreateCategory(); }
                if (e.key === "Escape") { setShowCreate(false); setNewCatName(""); }
              }}
              placeholder='שם קטגוריה — תומך בנתיב: חומש/שמות/כי תשא'
              className="h-8 text-sm border-gold/40"
              dir="auto"
            />
            <div className="flex items-center gap-2">
              <Select value={newCatParentId} onValueChange={setNewCatParentId}>
                <SelectTrigger className="h-8 text-xs flex-1 border-gold/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">— ללא הורה (קטגוריית שורש) —</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.label || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button" size="sm"
                onClick={handleCreateCategory}
                disabled={!newCatName.trim()}
                className="h-8 bg-gradient-navy text-primary-foreground"
              >
                צור
              </Button>
              <Button
                type="button" size="sm" variant="ghost"
                onClick={() => { setShowCreate(false); setNewCatName(""); }}
                className="h-8"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              טיפ: השתמש ב‑<code className="px-1 bg-secondary rounded">/</code> ליצירת היררכיה — למשל <code className="px-1 bg-secondary rounded">חומש/שמות/כי תשא</code>
            </p>
          </div>
        )}

        {/* Search */}
        {categoryOptions.length > 6 && (
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute right-2 top-2 text-muted-foreground pointer-events-none" />
            <Input
              value={catSearch}
              onChange={(e) => setCatSearch(e.target.value)}
              placeholder="חפש קטגוריה…"
              className="h-7 text-xs border-gold/30 pr-7"
              dir="auto"
            />
          </div>
        )}

        {/* Pinned row */}
        {pinnedExisting.length > 0 && !catSearch && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Pin className="h-3 w-3 text-navy" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">נעוצים:</span>
            {pinnedExisting.map((name) => {
              const active = selectedCategoryNames.includes(name);
              const fullPath = pathByName.get(name) ?? name;
              return (
                <Tooltip key={`pin-${name}`} delayDuration={500}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => toggleCategory(name)}
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[11px] border-2 transition-all",
                        active
                          ? "border-navy bg-gradient-navy text-primary-foreground"
                          : "border-navy/40 bg-card text-foreground hover:border-navy",
                      )}
                    >
                      {name}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs" dir="rtl">
                    {fullPath}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        )}

        {/* Recently used */}
        {recentExisting.length > 0 && !catSearch && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Star className="h-3 w-3 text-gold" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">לאחרונה:</span>
            {recentExisting.map((name) => {
              const active = selectedCategoryNames.includes(name);
              const isPinned = pinnedCats.includes(name);
              const fullPath = pathByName.get(name) ?? name;
              return (
                <span key={`recent-${name}`} className="group relative inline-flex items-center">
                  <Tooltip delayDuration={500}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => toggleCategory(name)}
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[11px] border-2 transition-all",
                          active
                            ? "border-navy bg-gradient-navy text-primary-foreground"
                            : "border-gold/60 bg-gold/10 text-foreground hover:border-gold",
                        )}
                      >
                        {name}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs" dir="rtl">
                      {fullPath}
                    </TooltipContent>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); togglePinCategory(name); }}
                    title={isPinned ? "בטל נעיצה" : "נעץ קטגוריה"}
                    className={cn(
                      "ml-0.5 h-4 w-4 rounded-full border flex items-center justify-center transition-opacity",
                      isPinned ? "opacity-100 border-navy bg-navy/10 text-navy"
                              : "opacity-0 group-hover:opacity-100 border-gold/50 bg-card text-navy hover:bg-gold/20",
                    )}
                  >
                    {isPinned ? <PinOff className="h-2.5 w-2.5" /> : <Pin className="h-2.5 w-2.5" />}
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Toggle show all (only when there's something compact to show) */}
        {categoryOptions.length > 0 && !catSearch && (pinnedExisting.length > 0 || recentExisting.length > 0) && (
          <button
            type="button"
            onClick={() => setShowAllCats((v) => !v)}
            className="text-[11px] text-navy hover:underline flex items-center gap-1"
          >
            {showAllCats ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showAllCats ? "הסתר רשימה מלאה" : `הצג הכל (${categoryOptions.length})`}
          </button>
        )}

        {/* Chip list — compact unless expanded or searching */}
        {categoryOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">
            אין קטגוריות עדיין. לחץ על <Plus className="inline h-3 w-3 mb-0.5" /> כדי ליצור.
          </p>
        ) : (expandFullList || (pinnedExisting.length === 0 && recentExisting.length === 0)) && (
          filteredCategoryOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">לא נמצאו קטגוריות</p>
          ) : (
          <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-gold/20 bg-card max-h-40 overflow-y-auto">
            {filteredCategoryOptions.map((c) => {
              const active = selectedCategoryNames.includes(c.name);
              const isPinned = pinnedCats.includes(c.name);
              return (
                <div key={c.id} className="group relative inline-flex items-center">
                  <Tooltip delayDuration={500}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => toggleCategory(c.name)}
                        className={cn(
                          "px-2 py-1 rounded-full text-xs border-2 transition-all pr-6",
                          active
                            ? "border-navy bg-gradient-navy text-primary-foreground"
                            : "border-gold/40 bg-secondary text-foreground hover:border-gold",
                        )}
                      >
                        {c.label || c.name}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs" dir="rtl">
                      {c.path}
                    </TooltipContent>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); togglePinCategory(c.name); }}
                    title={isPinned ? "בטל נעיצה" : "נעץ קטגוריה"}
                    className={cn(
                      "absolute left-1 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border flex items-center justify-center transition-opacity",
                      isPinned
                        ? "opacity-100 border-navy bg-navy/20 text-navy"
                        : "opacity-0 group-hover:opacity-100 " + (active
                            ? "border-primary-foreground/60 text-primary-foreground hover:bg-primary-foreground/20"
                            : "border-navy/50 bg-card text-navy hover:bg-gold/20"),
                    )}
                  >
                    {isPinned ? <PinOff className="h-2.5 w-2.5" /> : <Pin className="h-2.5 w-2.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); createSubcategory(c.id, c.name); }}
                    title={`+ תת-קטגוריה תחת "${c.name}"`}
                    className={cn(
                      "absolute left-6 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity",
                      active ? "border-primary-foreground/60 text-primary-foreground hover:bg-primary-foreground/20"
                             : "border-gold/60 bg-card text-navy hover:bg-gold/20",
                    )}
                  >
                    <Plus className="h-2.5 w-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirm(`למחוק קטגוריה "${c.name}"?\nהפעולה תמחק גם תת-קטגוריות ותסיר את התיוג מכל הכרטיסים.`)) {
                        deleteCategory(c.id);
                      }
                    }}
                    title={`מחק קטגוריה "${c.name}"`}
                    className={cn(
                      "absolute left-11 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity",
                      active ? "border-primary-foreground/60 text-primary-foreground hover:bg-destructive/40"
                             : "border-destructive/40 bg-card text-destructive hover:bg-destructive/15",
                    )}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
          )
        )}
      </div>

      <div className="space-y-2">
        <Label className="block text-right">סוג שאלה</Label>
        {isEdit ? (
          <Select value={type} onValueChange={(v) => setType(v as CardType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="flashcard">כרטיסיה (שאלה → תשובה)</SelectItem>
              <SelectItem value="multiple">אמריקאית (בחירה מרובה)</SelectItem>
              <SelectItem value="boolean">נכון / לא נכון</SelectItem>
              <SelectItem value="combo">משולבת (אמריקאית + תשובה פתוחה)</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <div className="flex flex-row-reverse gap-1.5" role="group" aria-label="סוגי שאלות">
            {([
              { id: "flashcard" as const, label: "כרטיסיה" },
              { id: "multiple"  as const, label: "אמריקאי" },
              { id: "boolean"   as const, label: "נכון/לא נכון" },
            ]).map(({ id, label }) => {
              const active = createTypes.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleCreateType(id)}
                  aria-pressed={active}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all",
                    active
                      ? "border-navy bg-gradient-navy text-primary-foreground shadow-sm"
                      : "border-gold/40 bg-card text-navy hover:border-gold hover:bg-gold/10",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {!isEdit && createTypes.length > 1 && (
          <p className="text-xs text-muted-foreground text-right">
            ייווצרו {createTypes.length} כרטיסים — אחד לכל סוג, עם אותה שאלה
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label className="block text-right">שאלה</Label>
        <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="כתוב את השאלה..." className="border-2 border-gold/40 text-right" />
      </div>

      {isEdit && type === "combo" && (
        <div className="rounded-xl border-2 border-gold/40 bg-secondary/30 p-3 space-y-2">
        <Label className="block text-right">אילו מצבי תרגול לכלול בשאלה זו?</Label>
          <div className="flex flex-row-reverse gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox checked={comboFlashEnabled} onCheckedChange={(c) => setComboFlashEnabled(!!c)} />
              תשובה פתוחה
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox checked={comboMultiEnabled} onCheckedChange={(c) => setComboMultiEnabled(!!c)} />
              בחירה מרובה
            </label>
          </div>
        </div>
      )}

      {showFlashFields && (
        <div className="space-y-2 rounded-lg border border-gold/30 bg-secondary/10 p-2">
          <Label className="block text-right text-xs text-muted-foreground">תשובה (כרטיסיה)</Label>
          <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="כתוב את התשובה..." className="border-2 border-gold/40 text-right" />
        </div>
      )}

      {showMultiFields && (
        <div className="space-y-2 rounded-lg border border-gold/30 bg-secondary/10 p-2">
        <Label className="block text-right text-xs text-muted-foreground">אפשרויות אמריקאיות (סמן את הנכונות · חצים לסידור)</Label>
          {options.map((opt, i) => {
            const move = (dir: -1 | 1) => {
              const j = i + dir;
              if (j < 0 || j >= options.length) return;
              setOptions((arr) => {
                const next = arr.slice();
                [next[i], next[j]] = [next[j], next[i]];
                return next;
              });
              setCorrectIndices((arr) =>
                arr.map((x) => (x === i ? j : x === j ? i : x)),
              );
            };
            return (
              <div key={i} className="flex items-center gap-2 flex-row-reverse">
                <Checkbox
                  checked={correctIndices.includes(i)}
                  onCheckedChange={(c) => {
                    setCorrectIndices((arr) => c ? [...arr, i] : arr.filter((x) => x !== i));
                  }}
                />
                <Input
                  value={opt}
                  onChange={(e) => setOptions((arr) => arr.map((o, idx) => idx === i ? e.target.value : o))}
                  placeholder={`אפשרות ${i + 1}`}
                  className="border-2 border-gold/40 text-right"
                />
                <div className="flex flex-col">
                  <Button
                    type="button" size="icon" variant="ghost"
                    className="h-5 w-5"
                    disabled={i === 0}
                    onClick={() => move(-1)}
                    title="העבר למעלה"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button" size="icon" variant="ghost"
                    className="h-5 w-5"
                    disabled={i === options.length - 1}
                    onClick={() => move(1)}
                    title="העבר למטה"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {options.length > 2 && (
                  <Button size="icon" variant="ghost" onClick={() => {
                    setOptions((arr) => arr.filter((_, idx) => idx !== i));
                    setCorrectIndices((arr) => arr.filter((x) => x !== i).map((x) => x > i ? x - 1 : x));
                  }}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={() => setOptions((arr) => [...arr, ""])}
            className="border-2 border-gold/40">
            <Plus className="h-3 w-3" /> הוסף אפשרות
          </Button>
        </div>
      )}

      {showBooleanFields && (
        <div className="space-y-3 rounded-lg border border-gold/30 bg-secondary/10 p-2">
          <div className="space-y-2">
          <Label className="block text-right text-xs text-muted-foreground">נכון/לא נכון — התשובה הנכונה</Label>
            <RadioGroup value={boolCorrect} onValueChange={(v) => setBoolCorrect(v as "true" | "false")} className="flex flex-row-reverse gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="true" /> נכון
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="false" /> לא נכון
              </label>
            </RadioGroup>
          </div>
        </div>
      )}

      {(showBooleanFields || (isEdit && type === "combo")) && (
        <div className="space-y-2">
        <Label className="block text-right">הסבר (אופציונלי)</Label>
          <Textarea value={explanation} onChange={(e) => setExplanation(e.target.value)}
            className="border-2 border-gold/40 text-right" />
        </div>
      )}

      {/* Categories selector moved to TOP */}

      <div className="space-y-2">
        <Label className="block text-right">תגיות (מופרד בפסיקים)</Label>
        <Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
          placeholder="לדוגמה: היסטוריה, מבחן" className="border-2 border-gold/40 text-right" />
      </div>

      {/* === שיוך לדף גמרא === */}
      <div className="space-y-2 rounded-xl border-2 border-gold/40 bg-secondary/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-gold" /> שיוך לדף גמרא (אופציונלי)
          </Label>
          {masechta && daf && (
            <Button type="button" size="sm" variant="outline" className="border-gold/50 gap-1" onClick={() => setViewerOpen(true)}>
              <Eye className="h-4 w-4" /> תצוגה מקדימה
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Select value={masechta} onValueChange={(v) => { setMasechta(v); setDaf(undefined); setAmud(1); }}>
            <SelectTrigger className="border-2 border-gold/40"><SelectValue placeholder="בחר מסכת" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {SEDARIM.map((s) => (
                <div key={s}>
                  <div className="px-2 py-1 text-xs font-bold text-gold">{s}</div>
                  {SHAS_BAVLI.filter((m) => m.seder === s).map((m) => (
                    <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
          <Select value={daf ? String(daf) : ""} onValueChange={(v) => setDaf(Number(v))} disabled={!currentMasechetMeta}>
            <SelectTrigger className="border-2 border-gold/40"><SelectValue placeholder="דף" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {currentMasechetMeta && Array.from({ length: currentMasechetMeta.pages }, (_, i) => i + 2).map((d) => (
                <SelectItem key={d} value={String(d)}>דף {dafLabel(d).replace(".", "")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup type="single" value={String(amud)} onValueChange={(v) => v && setAmud(Number(v) as 1 | 2)} className="w-full" disabled={!daf}>
            <ToggleGroupItem value="1" className="flex-1">ע&quot;א</ToggleGroupItem>
            <ToggleGroupItem value="2" className="flex-1">ע&quot;ב</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {masechta && daf && (
          <div className="rounded-lg border border-gold/30 overflow-hidden" style={{ height: 280 }}>
            <GemaraViewer masechta={masechta} daf={daf} amud={amud} className="h-full" />
          </div>
        )}
      </div>

      {/* תצוגה מקדימה במסך מלא */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-5xl h-[85vh] p-3 flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-gold" /> {masechta} · דף {daf ? dafLabel(daf).replace(".", "") : ""} · {amud === 1 ? 'ע"א' : 'ע"ב'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {masechta && daf && <GemaraViewer masechta={masechta} daf={daf} amud={amud} className="h-full" />}
          </div>
        </DialogContent>
      </Dialog>

      {/* Category picker dialog */}
      <CategoryPickerDialog
        open={showPicker}
        onOpenChange={setShowPicker}
        selected={selectedCategoryNames}
        onConfirm={(names) => setSelectedCategoryNames(names)}
      />

      {/* Deck linkage – appears only after a category is selected.
          New rule: cards live in categories, not decks. Decks (=systems)
          aggregate categories. So this block links the chosen CATEGORY
          to one or more systems, instead of attaching the card itself. */}
      {selectedCategoryNames.length > 0 && (
        <div className="space-y-2 rounded-xl border-2 border-navy/30 bg-secondary/10 p-3">
          <div className="flex items-center justify-between">
            <Label className="text-right text-sm font-medium">שייך קטגוריה למערכת</Label>
            <span className="text-[10px] text-muted-foreground">אופציונלי — הקטגוריה תזרום למערכת שתבחר</span>
          </div>
          {selectedCategoryNames.map((catName) => {
            const cat = (state.categories ?? []).find((c) => c.name === catName);
            if (!cat) return null;
            return (
              <div key={cat.id} className="flex flex-wrap items-center gap-1.5 border-t border-gold/20 pt-2 first:border-t-0 first:pt-0">
                <span className="text-xs font-semibold text-navy ml-1">{catName}:</span>
                {state.decks.map((d) => {
                  const isIn = (d.categoryIds ?? []).includes(cat.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        const cur = d.categoryIds ?? [];
                        const next = isIn ? cur.filter((x) => x !== cat.id) : [...cur, cat.id];
                        updateDeckCategoryIds(d.id, next, d.includeSubCategories ?? true);
                      }}
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[11px] border-2 transition-all",
                        isIn
                          ? "border-navy bg-gradient-navy text-primary-foreground"
                          : "border-gold/40 bg-card hover:border-navy",
                      )}
                      title={isIn ? "הסר מהמערכת" : "הוסף למערכת"}
                    >
                      {isIn ? "✓ " : "+ "}{d.name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    const name = window.prompt(`שם המערכת החדשה (תכלול את "${catName}"):`)?.trim();
                    if (!name) return;
                    const deck = addDeck(name, undefined, [catName]);
                    updateDeckCategoryIds(deck.id, [cat.id], true);
                  }}
                  className="px-2 py-0.5 rounded-full text-[11px] border-2 border-dashed border-gold/60 bg-card hover:border-gold hover:bg-secondary"
                >
                  + מערכת חדשה
                </button>
              </div>
            );
          })}
        </div>
      )}

      <DialogFooter>
        <Button onClick={handleSave} className="bg-gradient-navy text-primary-foreground rounded-xl">
          <Plus className="h-4 w-4" /> {isEdit ? "שמור שינויים" : (createTypes.length > 1 ? `הוסף ${createTypes.length} שאלות` : "הוסף שאלה")}
        </Button>
      </DialogFooter>
      {dialog}
    </div>
  );
}
