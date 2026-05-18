/**
 * QuickRunDialog — runs a quiz session from a category without needing a deck.
 *
 * Flow:
 *  1. User picks scope (this category only / include sub-categories)
 *  2. User picks mode (multiple-choice / flashcard / mixed-auto)
 *  3. User optionally picks specific cards
 *  4. Triggers onStart with chosen cardIds + mode
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, BookOpen, Layers, Play, Filter, ListChecks, FolderTree, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStudy } from "@/lib/study/store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Mode = "multiple" | "flashcard" | "mixed";
type Scope = "self" | "withChildren";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string | null;
  categoryName: string | null;
  onStart: (cardIds: string[], mode: "multiple" | "flashcard") => void;
}

export function QuickRunDialog({ open, onOpenChange, categoryId, categoryName, onStart }: Props) {
  const { state } = useStudy();
  const [scope, setScope] = useState<Scope>("withChildren");
  const [mode, setMode] = useState<Mode>("mixed");
  const [manualPick, setManualPick] = useState(false);
  const [cloudCardIds, setCloudCardIds] = useState<string[]>([]);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"setup" | "pick">("setup");

  // Reset on open
  useEffect(() => {
    if (open) {
      setScope("withChildren");
      setMode("mixed");
      setManualPick(false);
      setPickedIds(new Set());
      setStep("setup");
    }
  }, [open]);

  // Compute descendant category ids (in-state)
  const targetCategoryIds = useMemo(() => {
    if (!categoryId) return new Set<string>();
    const set = new Set<string>([categoryId]);
    if (scope === "withChildren") {
      let changed = true;
      while (changed) {
        changed = false;
        for (const c of state.categories ?? []) {
          if (c.parentId && set.has(c.parentId) && !set.has(c.id)) {
            set.add(c.id); changed = true;
          }
        }
      }
    }
    return set;
  }, [categoryId, scope, state.categories]);

  // Fetch matching card ids from card_categories cloud table
  useEffect(() => {
    if (!open || !categoryId || targetCategoryIds.size === 0) {
      setCloudCardIds([]);
      return;
    }
    setLoadingCloud(true);
    (async () => {
      try {
        const ids = Array.from(targetCategoryIds);
        const all: string[] = [];
        // chunk to keep URL/IN clause sane
        const chunkSize = 100;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const { data, error } = await supabase
            .from("card_categories")
            .select("card_id")
            .in("category_id", chunk);
          if (error) throw error;
          for (const r of (data ?? [])) all.push(r.card_id as string);
        }
        setCloudCardIds(Array.from(new Set(all)));
      } catch (err) {
        console.warn("[QuickRun] cloud lookup failed", err);
        setCloudCardIds([]);
      } finally {
        setLoadingCloud(false);
      }
    })();
  }, [open, categoryId, targetCategoryIds]);

  // Also include locally-tagged cards (legacy tag system)
  const candidateCardIds = useMemo(() => {
    const out = new Set<string>(cloudCardIds);
    const targetNames = new Set<string>();
    for (const c of state.categories ?? []) {
      if (targetCategoryIds.has(c.id)) targetNames.add(c.name);
    }
    for (const card of state.cards ?? []) {
      for (const t of card.tags ?? []) {
        if (t.startsWith("cat:") && targetNames.has(t.slice(4))) {
          out.add(card.id); break;
        }
      }
    }
    return Array.from(out);
  }, [cloudCardIds, state.categories, state.cards, targetCategoryIds]);

  const candidateCards = useMemo(
    () => state.cards.filter((c) => candidateCardIds.includes(c.id)),
    [candidateCardIds, state.cards],
  );

  // Resolve effective mode (mixed → choose dominant or use multiple if possible)
  const resolveMode = (ids: string[]): "multiple" | "flashcard" => {
    if (mode === "multiple" || mode === "flashcard") return mode;
    // mixed → if any card has multiple-choice options use multiple, else flashcard
    const cards = state.cards.filter((c) => ids.includes(c.id));
    const hasMulti = cards.some((c) => c.type === "multiple" || c.type === "boolean");
    return hasMulti ? "multiple" : "flashcard";
  };

  const startNow = () => {
    let ids = candidateCardIds;
    if (manualPick) {
      ids = Array.from(pickedIds);
      if (ids.length === 0) {
        toast({ title: "לא נבחרו שאלות", variant: "destructive" });
        return;
      }
    }
    if (ids.length === 0) {
      toast({ title: "אין שאלות לקטגוריה זו", variant: "destructive" });
      return;
    }
    const finalMode = resolveMode(ids);
    onOpenChange(false);
    onStart(ids, finalMode);
  };

  const onContinueToPicker = () => {
    if (candidateCards.length === 0) {
      toast({ title: "אין שאלות לקטגוריה זו" });
      return;
    }
    setPickedIds(new Set(candidateCardIds));
    setStep("pick");
  };

  const togglePicked = (id: string) => {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllPicked = () => {
    setPickedIds((prev) => {
      if (prev.size === candidateCardIds.length) return new Set();
      return new Set(candidateCardIds);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gold-frame max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right font-display flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-gold" />
            הפעל שאלות {categoryName ? `· ${categoryName}` : ""}
          </DialogTitle>
          <DialogDescription className="text-right text-xs">
            הרצה מהירה ללא צורך ביצירת מערכת
          </DialogDescription>
        </DialogHeader>

        {step === "setup" && (
          <div className="space-y-4 py-2">
            {/* Scope */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-right text-foreground flex items-center gap-2 justify-end">
                <FolderTree className="h-4 w-4 text-gold" />
                טווח שאלות
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: "self" as Scope, label: "רק הקטגוריה הזו", icon: BookOpen },
                  { key: "withChildren" as Scope, label: "כולל תתי-קטגוריות", icon: Layers },
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setScope(key)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border-2 p-2 transition-all text-right",
                      scope === key ? "border-gold bg-gold/10" : "border-gold/20 hover:border-gold/50",
                    )}
                  >
                    <Icon className="h-4 w-4 text-gold shrink-0" />
                    <span className="text-xs font-medium flex-1">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Mode */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-right text-foreground flex items-center gap-2 justify-end">
                <Brain className="h-4 w-4 text-gold" />
                מצב הרצה
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: "multiple" as Mode, label: "אמריקאי", desc: "רב-ברירה" },
                  { key: "flashcard" as Mode, label: "כרטיסיה", desc: "הפוך תשובה" },
                  { key: "mixed" as Mode, label: "מעורב", desc: "אוטומטי" },
                ].map(({ key, label, desc }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    className={cn(
                      "rounded-lg border-2 p-2 transition-all text-center",
                      mode === key ? "border-gold bg-gold/10" : "border-gold/20 hover:border-gold/50",
                    )}
                  >
                    <p className="text-xs font-bold text-foreground">{label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Manual select toggle */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setManualPick(!manualPick)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg border-2 p-2.5 transition-all text-right",
                  manualPick ? "border-gold bg-gold/10" : "border-gold/20 hover:border-gold/50",
                )}
              >
                <Filter className="h-4 w-4 text-gold shrink-0" />
                <span className="text-xs font-medium flex-1">בחר ידנית אילו שאלות להריץ</span>
                <Badge variant="outline" className="text-[10px] border-gold/40">
                  {manualPick ? "פעיל" : "כבוי"}
                </Badge>
              </button>
            </div>

            {/* Count summary */}
            <div className="rounded-lg bg-card/60 border border-gold/20 p-3 text-right">
              <div className="text-xs text-muted-foreground">
                {loadingCloud ? "טוען..." : (
                  <>
                    <span className="text-gold font-bold text-lg">{candidateCardIds.length.toLocaleString("he-IL")}</span>
                    <span> שאלות נמצאו לטווח זה</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {step === "pick" && (
          <div className="space-y-2 py-2">
            <div className="flex items-center justify-between">
              <Button size="sm" variant="outline" onClick={toggleAllPicked} className="text-xs">
                {pickedIds.size === candidateCardIds.length ? "נקה הכל" : "בחר הכל"}
              </Button>
              <p className="text-xs text-muted-foreground">
                <span className="text-gold font-bold">{pickedIds.size}</span> / {candidateCardIds.length} נבחרו
              </p>
            </div>
            <ScrollArea className="h-72 rounded-lg border border-gold/20 bg-card/40">
              <div className="p-2 space-y-1">
                {candidateCards.map((c) => (
                  <label
                    key={c.id}
                    className={cn(
                      "flex items-start gap-2 rounded-md p-2 cursor-pointer transition-colors text-right",
                      pickedIds.has(c.id) ? "bg-gold/10" : "hover:bg-secondary/50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={pickedIds.has(c.id)}
                      onChange={() => togglePicked(c.id)}
                      className="mt-1 h-4 w-4 accent-gold cursor-pointer shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground line-clamp-2">{c.question}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {c.type === "multiple" ? "אמריקאי" : c.type === "flashcard" ? "כרטיסיה" : c.type === "boolean" ? "נכון/לא" : "משולבת"}
                      </p>
                    </div>
                  </label>
                ))}
                {candidateCards.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground py-4">אין שאלות</p>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="flex flex-row justify-between gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>ביטול</Button>
          {step === "setup" && manualPick ? (
            <Button onClick={onContinueToPicker} className="bg-gold hover:bg-gold/90 text-background gap-2">
              <ListChecks className="h-4 w-4" />
              בחר שאלות
            </Button>
          ) : (
            <Button
              onClick={startNow}
              disabled={loadingCloud || (step === "setup" ? candidateCardIds.length === 0 : pickedIds.size === 0)}
              className="bg-gold hover:bg-gold/90 text-background gap-2"
            >
              <Play className="h-4 w-4" />
              {step === "pick" ? `הפעל ${pickedIds.size} שאלות` : `הפעל ${candidateCardIds.length} שאלות`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
