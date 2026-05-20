/**
 * TopicBackupWizard
 * 3-step wizard: (1) pick topics (categories + decks), (2) pick content & format, (3) preview & download/cloud-save
 */
import { useState, useMemo } from "react";
import { useStudy } from "@/lib/study/store";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import {
  buildTopicSnapshot,
  exportJson, exportXlsx, exportCsv, exportTxt,
  saveCloudBackup,
  type CloudTransferProgress, type TopicBackupOptions,
} from "@/lib/study/backup";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ChevronRight, ChevronDown, FolderOpen, Layers, FileJson,
  FileSpreadsheet, FileText, Cloud, Download, CheckCircle2,
} from "lucide-react";
import type { Category } from "@/lib/study/types";

// ─── Helpers ─────────────────────────────────────────────────────────────

function getAllDescendantIds(rootId: string, allCats: Category[]): string[] {
  const ids: string[] = [rootId];
  for (const c of allCats) {
    if (c.parentId === rootId) ids.push(...getAllDescendantIds(c.id, allCats));
  }
  return ids;
}

function getDirectChildren(parentId: string | null, allCats: Category[]): Category[] {
  return allCats
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "he"));
}

// ─── CategoryTreeNode ─────────────────────────────────────────────────────

function CategoryTreeNode({
  cat,
  allCats,
  cardCounts,
  selectedCatIds,
  onToggle,
  depth = 0,
}: {
  cat: Category;
  allCats: Category[];
  cardCounts: Map<string, number>;
  selectedCatIds: Set<string>;
  onToggle: (id: string, descendantIds: string[]) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const children = getDirectChildren(cat.id, allCats);
  const allDescendants = getAllDescendantIds(cat.id, allCats);
  const selectedDescendants = allDescendants.filter((id) => selectedCatIds.has(id));
  const checked = selectedDescendants.length === allDescendants.length;
  const indeterminate = !checked && selectedDescendants.length > 0;

  const count = allDescendants.reduce((s, id) => s + (cardCounts.get(id) ?? 0), 0);

  return (
    <div className="select-none">
      <div
        className="flex items-center gap-1.5 py-1 px-2 rounded hover:bg-muted/60 cursor-pointer group"
        style={{ paddingRight: `${(depth + 1) * 16}px` }}
      >
        <button
          type="button"
          className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground"
          onClick={() => children.length > 0 && setExpanded((e) => !e)}
        >
          {children.length > 0 ? (
            expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          ) : null}
        </button>
        <Checkbox
          checked={indeterminate ? "indeterminate" : checked}
          onCheckedChange={() => onToggle(cat.id, allDescendants)}
          id={`cat-${cat.id}`}
          className="shrink-0"
        />
        <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500" />
        <Label htmlFor={`cat-${cat.id}`} className="flex-1 text-sm cursor-pointer truncate">
          {cat.name}
        </Label>
        {count > 0 && (
          <Badge variant="secondary" className="text-xs shrink-0">
            {count}
          </Badge>
        )}
      </div>
      {expanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <CategoryTreeNode
              key={child.id}
              cat={child}
              allCats={allCats}
              cardCounts={cardCounts}
              selectedCatIds={selectedCatIds}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Called when a backup was downloaded or saved to cloud */
  onComplete?: () => void;
}

type Step = 1 | 2 | 3;
type Format = "json" | "xlsx" | "csv" | "txt";

export function TopicBackupWizard({ open, onOpenChange, onComplete }: Props) {
  const { state } = useStudy();
  const { user } = useAuth();

  // Step 1 state
  const [selectedCatIds, setSelectedCatIds] = useState<Set<string>>(new Set());
  const [selectedDeckIds, setSelectedDeckIds] = useState<Set<string>>(new Set());
  const [scopeMode, setScopeMode] = useState<"all" | "topic">("all");

  // Step 2 state
  const [includeSrs, setIncludeSrs] = useState(true);
  const [includeGoals, setIncludeGoals] = useState(true);
  const [includePlans, setIncludePlans] = useState(true);
  const [includeSessions, setIncludeSessions] = useState(true);
  const [includeDayNotes, setIncludeDayNotes] = useState(true);
  const [includeShasPlan, setIncludeShasPlan] = useState(true);
  const [format, setFormat] = useState<Format>("json");

  // Step 3 state
  const [snapshotName, setSnapshotName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedToCloud, setSavedToCloud] = useState(false);
  const [cloudProgress, setCloudProgress] = useState<CloudTransferProgress | null>(null);

  const [step, setStep] = useState<Step>(1);

  const allCats = state.categories ?? [];
  const allDecks = state.decks ?? [];
  const allCards = state.cards ?? [];

  // Build a map of cardCount per category (by name match in tags)
  const cardCountsByCatId = useMemo(() => {
    const catNameToId = new Map(allCats.map((c) => [c.name, c.id]));
    const counts = new Map<string, number>();
    for (const card of allCards) {
      for (const tag of card.tags ?? []) {
        if (tag.startsWith("cat:")) {
          const catId = catNameToId.get(tag.slice(4));
          if (catId) counts.set(catId, (counts.get(catId) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [allCats, allCards]);

  const rootCats = getDirectChildren(null, allCats);

  // ── Topic toggles ──────────────────────────────────────────────────

  function toggleCat(catId: string, descendantIds: string[]) {
    setSelectedCatIds((prev) => {
      const next = new Set(prev);
      const allSelected = descendantIds.every((id) => next.has(id));
      if (allSelected) descendantIds.forEach((id) => next.delete(id));
      else descendantIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleDeck(deckId: string) {
    setSelectedDeckIds((prev) => {
      const next = new Set(prev);
      if (next.has(deckId)) next.delete(deckId);
      else next.add(deckId);
      return next;
    });
  }

  function selectAllCats() {
    setSelectedCatIds(new Set(allCats.map((c) => c.id)));
  }
  function clearAllCats() {
    setSelectedCatIds(new Set());
  }
  function selectAllDecks() {
    setSelectedDeckIds(new Set(allDecks.map((d) => d.id)));
  }
  function clearAllDecks() {
    setSelectedDeckIds(new Set());
  }

  // ── Build preview snapshot ─────────────────────────────────────────

  const previewSnapshot = useMemo(() => {
    const opts: TopicBackupOptions = {
      categoryIds: scopeMode === "topic" ? Array.from(selectedCatIds) : null,
      deckIds: scopeMode === "topic" ? Array.from(selectedDeckIds) : null,
      includeSrs,
      includeGoals,
      includePlans,
      includeSessions,
      includeDayNotes,
      includeShasPlan,
      exportedBy: user?.email,
      snapshotName,
    };
    return buildTopicSnapshot(state, opts);
  }, [state, scopeMode, selectedCatIds, selectedDeckIds, includeSrs, includeGoals, includePlans, includeSessions, includeDayNotes, includeShasPlan, user, snapshotName]);

  const previewStats = {
    cards: previewSnapshot.data.cards?.length ?? 0,
    decks: previewSnapshot.data.decks?.length ?? 0,
    categories: previewSnapshot.data.categories?.length ?? 0,
    goals: previewSnapshot.data.goals?.length ?? 0,
    sessions: previewSnapshot.data.learningSessions?.length ?? 0,
    plans: previewSnapshot.data.generalPlans?.length ?? 0,
  };

  const previewSizeKb = useMemo(() => {
    return Math.round(new Blob([JSON.stringify(previewSnapshot)]).size / 1024);
  }, [previewSnapshot]);

  // ── Default name ───────────────────────────────────────────────────
  function defaultName() {
    const d = new Date();
    const suffix = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    if (scopeMode === "topic") {
      const catNames = Array.from(selectedCatIds)
        .map((id) => allCats.find((c) => c.id === id)?.name ?? "")
        .filter(Boolean)
        .slice(0, 2)
        .join(", ");
      return catNames ? `גיבוי: ${catNames} — ${suffix}` : `גיבוי נושאי — ${suffix}`;
    }
    return `גיבוי מלא — ${suffix}`;
  }

  // ── Download ───────────────────────────────────────────────────────
  async function handleDownload() {
    setIsSaving(true);
    try {
      if (format === "json") exportJson(previewSnapshot);
      else if (format === "xlsx") await exportXlsx(previewSnapshot);
      else if (format === "csv") exportCsv(previewSnapshot);
      else if (format === "txt") exportTxt(previewSnapshot);
      toast({ title: "גיבוי הורד בהצלחה", description: `${previewStats.cards} שאלות, ${previewSizeKb} KB` });
      onComplete?.();
    } catch (err: unknown) {
      toast({ title: "שגיאה בהורדה", description: err instanceof Error ? err.message : "שגיאה", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  // ── Cloud save ─────────────────────────────────────────────────────
  async function handleCloudSave() {
    if (!user) return;
    setIsSaving(true);
    setCloudProgress({ phase: "מכין גיבוי לענן", processed: 0, total: 1, percent: 0 });
    try {
      const name = snapshotName.trim() || defaultName();
      await saveCloudBackup(
        supabase,
        user.id,
        name,
        previewSnapshot,
        scopeMode === "topic" ? [...Array.from(selectedCatIds), ...Array.from(selectedDeckIds)] : [],
        (p) => setCloudProgress(p),
      );
      setSavedToCloud(true);
      toast({ title: "גיבוי נשמר בענן", description: name });
      onComplete?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "שגיאה";
      const isMissingTable = msg.includes("user_backups") && (msg.includes("does not exist") || msg.includes("42P01"));
      const isRls = msg.toLowerCase().includes("row-level") || msg.includes("permission denied") || msg.includes("42501");
      const friendly = isMissingTable
        ? "טבלת user_backups לא קיימת בפרויקט Supabase הפעיל. צריך להריץ migration של backups."
        : isRls
          ? "אין הרשאה לשמור גיבוי בענן עבור המשתמש הנוכחי (RLS/Policy)."
          : msg;
      toast({ title: "שגיאה בשמירה לענן", description: friendly, variant: "destructive" });
    } finally {
      setIsSaving(false);
      setTimeout(() => setCloudProgress(null), 700);
    }
  }

  // ── Reset on close ─────────────────────────────────────────────────
  function handleClose() {
    setStep(1);
    setSelectedCatIds(new Set());
    setSelectedDeckIds(new Set());
    setScopeMode("all");
    setSavedToCloud(false);
    setSnapshotName("");
    setCloudProgress(null);
    onOpenChange(false);
  }

  const canProceedStep1 =
    scopeMode === "all" || selectedCatIds.size > 0 || selectedDeckIds.size > 0;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            ויזארד גיבוי
            <span className="text-muted-foreground text-sm font-normal mr-2">
              שלב {step} מתוך 3
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            תהליך גיבוי בשלושה שלבים: בחירת נושאים, בחירת תוכן ופורמט, ואז שמירה מקומית או בענן.
          </DialogDescription>
          {/* Step indicator */}
          <div className="flex gap-2 mt-2">
            {([1, 2, 3] as Step[]).map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {/* ── Step 1: Choose scope ───────────────────────────────── */}
          {step === 1 && (
            <div className="flex flex-col gap-4 min-h-full pb-2">
              <div className="flex gap-2">
                <Button
                  variant={scopeMode === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScopeMode("all")}
                >
                  גיבוי מלא
                </Button>
                <Button
                  variant={scopeMode === "topic" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScopeMode("topic")}
                >
                  לפי נושאים
                </Button>
              </div>

              {scopeMode === "topic" && (
                <div className="flex flex-col gap-3">
                  {/* Categories */}
                  {allCats.length > 0 && (
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium flex items-center gap-1">
                          <FolderOpen className="w-4 h-4 text-amber-500" />
                          קטגוריות
                          <Badge variant="secondary" className="text-xs">{selectedCatIds.size} נבחרו</Badge>
                        </span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="xs" onClick={selectAllCats}>בחר הכל</Button>
                          <Button variant="ghost" size="xs" onClick={clearAllCats}>נקה</Button>
                        </div>
                      </div>
                      <ScrollArea className="flex-1 border rounded-md min-h-0 max-h-56">
                        <div className="p-1">
                          {rootCats.map((cat) => (
                            <CategoryTreeNode
                              key={cat.id}
                              cat={cat}
                              allCats={allCats}
                              cardCounts={cardCountsByCatId}
                              selectedCatIds={selectedCatIds}
                              onToggle={toggleCat}
                            />
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  {/* Decks */}
                  {allDecks.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium flex items-center gap-1">
                          <Layers className="w-4 h-4 text-blue-500" />
                          מערכות לימוד
                          <Badge variant="secondary" className="text-xs">{selectedDeckIds.size} נבחרו</Badge>
                        </span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="xs" onClick={selectAllDecks}>בחר הכל</Button>
                          <Button variant="ghost" size="xs" onClick={clearAllDecks}>נקה</Button>
                        </div>
                      </div>
                      <ScrollArea className="border rounded-md max-h-32">
                        <div className="p-1 flex flex-col gap-0.5">
                          {allDecks.map((deck) => {
                            const cnt = allCards.filter((c) => c.deckId === deck.id).length;
                            return (
                              <div
                                key={deck.id}
                                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/60"
                              >
                                <Checkbox
                                  id={`deck-${deck.id}`}
                                  checked={selectedDeckIds.has(deck.id)}
                                  onCheckedChange={() => toggleDeck(deck.id)}
                                />
                                <Layers className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                                <Label htmlFor={`deck-${deck.id}`} className="flex-1 text-sm cursor-pointer truncate">
                                  {deck.name}
                                </Label>
                                {cnt > 0 && <Badge variant="secondary" className="text-xs">{cnt}</Badge>}
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              )}

              {scopeMode === "all" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-md p-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  הגיבוי יכלול את כל הנתונים — {allCards.length} שאלות, {allDecks.length} מערכות, {allCats.length} קטגוריות
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Content & format ───────────────────────────── */}
          {step === 2 && (
            <div className="flex flex-col gap-4 min-h-full pb-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">מה לכלול?</p>
                  {[
                    { id: "srs", label: "נתוני SRS (ציון + מרווחי חזרה)", state: includeSrs, set: setIncludeSrs },
                    { id: "goals", label: "יעדי לימוד", state: includeGoals, set: setIncludeGoals },
                    { id: "plans", label: "תוכניות לימוד", state: includePlans, set: setIncludePlans },
                    { id: "sessions", label: "סשנים לימודיים", state: includeSessions, set: setIncludeSessions },
                    { id: "notes", label: "הערות יומיות", state: includeDayNotes, set: setIncludeDayNotes },
                    { id: "shas", label: "תוכנית ש\"ס + חזרות", state: includeShasPlan, set: setIncludeShasPlan },
                  ].map(({ id, label, state: val, set }) => (
                    <div key={id} className="flex items-center gap-2">
                      <Checkbox id={`inc-${id}`} checked={val} onCheckedChange={(c) => set(Boolean(c))} />
                      <Label htmlFor={`inc-${id}`} className="text-sm cursor-pointer">{label}</Label>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">פורמט קובץ</p>
                  {([
                    { value: "json" as Format, label: "JSON (גיבוי מלא)", Icon: FileJson, recommended: true },
                    { value: "xlsx" as Format, label: "Excel (.xlsx)", Icon: FileSpreadsheet },
                    { value: "csv" as Format, label: "CSV (שאלות בלבד)", Icon: FileText },
                    { value: "txt" as Format, label: "טקסט קריא", Icon: FileText },
                  ]).map(({ value, label, Icon, recommended }) => (
                    <div
                      key={value}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer border transition-colors ${
                        format === value
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-muted/40"
                      }`}
                      onClick={() => setFormat(value)}
                    >
                      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm flex-1">{label}</span>
                      {recommended && <Badge variant="secondary" className="text-xs">מומלץ</Badge>}
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Preview stats */}
              <div className="bg-muted/40 rounded-md p-3 text-sm space-y-1">
                <p className="font-medium text-muted-foreground mb-2">תצוגה מקדימה:</p>
                <div className="grid grid-cols-3 gap-2">
                  <span>{previewStats.cards} שאלות</span>
                  <span>{previewStats.decks} מערכות</span>
                  <span>{previewStats.categories} קטגוריות</span>
                  {includeGoals && <span>{previewStats.goals} יעדים</span>}
                  {includeSessions && <span>{previewStats.sessions} סשנים</span>}
                  {includePlans && <span>{previewStats.plans} תוכניות</span>}
                </div>
                <p className="text-muted-foreground text-xs mt-1">גודל משוער: {previewSizeKb} KB</p>
              </div>
            </div>
          )}

          {/* ── Step 3: Name & download/cloud ─────────────────────── */}
          {step === 3 && (
            <div className="flex flex-col gap-4 min-h-full pb-2">
              {cloudProgress && (
                <div className="rounded-md border border-gold/30 bg-card/70 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{cloudProgress.percent}%</span>
                    <span>{cloudProgress.phase}</span>
                  </div>
                  <Progress value={cloudProgress.percent} className="h-2" />
                  <div className="text-[11px] text-muted-foreground text-right">
                    {cloudProgress.processed}/{cloudProgress.total}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="snap-name" className="text-sm font-medium">שם הגיבוי</Label>
                <Input
                  id="snap-name"
                  placeholder={defaultName()}
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                  dir="rtl"
                />
              </div>

              <div className="bg-muted/40 rounded-md p-4 space-y-2 text-sm">
                <p className="font-medium mb-2">סיכום גיבוי:</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                  <span>שאלות</span><span className="font-medium text-foreground">{previewStats.cards}</span>
                  <span>מערכות</span><span className="font-medium text-foreground">{previewStats.decks}</span>
                  <span>קטגוריות</span><span className="font-medium text-foreground">{previewStats.categories}</span>
                  <span>גודל</span><span className="font-medium text-foreground">{previewSizeKb} KB</span>
                  <span>פורמט</span><span className="font-medium text-foreground">{format.toUpperCase()}</span>
                  <span>נושאים</span><span className="font-medium text-foreground">
                    {scopeMode === "all" ? "מלא" : `${selectedCatIds.size} קטגוריות, ${selectedDeckIds.size} מערכות`}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full gap-2"
                  onClick={handleDownload}
                  disabled={isSaving}
                >
                  <Download className="w-4 h-4" />
                  הורד קובץ ({format.toUpperCase()})
                </Button>
                {user && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={handleCloudSave}
                    disabled={isSaving || savedToCloud}
                  >
                    <Cloud className={`w-4 h-4 ${isSaving ? "animate-pulse" : ""}`} />
                    {savedToCloud ? "נשמר בענן ✓" : isSaving ? "שומר לענן..." : "שמור בענן (Supabase)"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row-reverse gap-2 sm:flex-row-reverse">
          <Button variant="outline" onClick={handleClose}>ביטול</Button>
          {step > 1 && (
            <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)}>
              חזור
            </Button>
          )}
          {step < 3 ? (
            <Button
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={step === 1 && !canProceedStep1}
            >
              המשך
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
