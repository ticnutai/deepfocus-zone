/**
 * RestoreDiffDialog
 * Shows an interactive diff of a backup snapshot vs. current state.
 * The user can toggle which items to include before confirming the restore.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useStudy } from "@/lib/study/store";
import { toast } from "@/hooks/use-toast";
import { buildRestoreDiff, saveCloudBackup, type BackupSnapshot, type DiffItem, type RestoreDiff } from "@/lib/study/backup";
import RestoreDiffWorker from "@/workers/restoreDiff.worker?worker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Card } from "@/lib/study/types";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, AlertTriangle, Plus, RefreshCw, FolderOpen, Layers, FileQuestion, PlayCircle, Minimize2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  snapshot: BackupSnapshot | null;
  onRuntimeStatusChange?: (status: RestoreRuntimeStatus) => void;
  backgroundCommand?: RestoreBackgroundCommand;
}

export interface RestoreRuntimeStatus {
  running: boolean;
  resumeAvailable: boolean;
  phase: string;
  percent: number;
  processed: number;
  total: number;
}

export interface RestoreBackgroundCommand {
  type: "none" | "stop" | "resume";
  nonce: number;
}

type RestorePerfMode = "safe" | "balanced" | "turbo";

interface RestorePerfConfig {
  minConcurrency: number;
  maxConcurrency: number;
  initialConcurrency: number;
  batchPauseMs: number;
  slowBatchMs: number;
  fastBatchMs: number;
  /** How many sequential items (cats/decks) to process before yielding to the browser */
  loopBatchSize: number;
}

type DiffSection = "categories" | "decks" | "cards";

const RESTORE_CHECKPOINT_PREFIX = "pashash_restore_checkpoint_v1:";

const PERF_CONFIGS: Record<RestorePerfMode, RestorePerfConfig> = {
  safe: {
    minConcurrency: 1,
    maxConcurrency: 2,
    initialConcurrency: 1,
    batchPauseMs: 20,
    slowBatchMs: 90,
    fastBatchMs: 35,
    loopBatchSize: 50,
  },
  balanced: {
    minConcurrency: 2,
    maxConcurrency: 4,
    initialConcurrency: 3,
    batchPauseMs: 10,
    slowBatchMs: 70,
    fastBatchMs: 25,
    loopBatchSize: 150,
  },
  turbo: {
    minConcurrency: 3,
    maxConcurrency: 6,
    initialConcurrency: 4,
    batchPauseMs: 6,
    slowBatchMs: 55,
    fastBatchMs: 18,
    loopBatchSize: 300,
  },
};

interface RestoreCheckpoint {
  snapshotKey: string;
  selectedCatIds: string[];
  selectedDeckIds: string[];
  selectedCardIds: string[];
  categoryIndex: number;
  deckIndex: number;
  cardIndex: number;
  addedCards: number;
  catIdMapEntries: [string, string][];
  deckIdMapEntries: [string, string][];
  updatedAt: number;
}

interface CloudVerifySummary {
  table: "categories" | "decks" | "cards";
  expected: number;
  found: number;
  missing: number;
}

function pause(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunksOf<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function countFoundIds(table: "categories" | "decks" | "cards", ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  let found = 0;
  const batches = chunksOf(ids, 200);
  for (const batch of batches) {
    const { data, error } = await (supabase
      .from(table)
      .select("id")
      .in("id", batch) as unknown as Promise<{ data: Array<{ id: string }> | null; error: unknown }>);
    if (error) throw error;
    found += (data?.length ?? 0);
    await pause(0);
  }
  return found;
}

async function verifyCloudDiffWithRetry(input: {
  categoryIds: string[];
  deckIds: string[];
  cardIds: string[];
  retries?: number;
}): Promise<{ summaries: CloudVerifySummary[]; totalMissing: number }> {
  const retries = Math.max(1, input.retries ?? 3);
  let last: { summaries: CloudVerifySummary[]; totalMissing: number } = {
    summaries: [],
    totalMissing: 0,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    const catExpected = input.categoryIds.length;
    const deckExpected = input.deckIds.length;
    const cardExpected = input.cardIds.length;

    const [catFound, deckFound, cardFound] = await Promise.all([
      countFoundIds("categories", input.categoryIds),
      countFoundIds("decks", input.deckIds),
      countFoundIds("cards", input.cardIds),
    ]);

    const summaries: CloudVerifySummary[] = [
      { table: "categories", expected: catExpected, found: catFound, missing: Math.max(0, catExpected - catFound) },
      { table: "decks", expected: deckExpected, found: deckFound, missing: Math.max(0, deckExpected - deckFound) },
      { table: "cards", expected: cardExpected, found: cardFound, missing: Math.max(0, cardExpected - cardFound) },
    ];

    const totalMissing = summaries.reduce((acc, s) => acc + s.missing, 0);
    last = { summaries, totalMissing };
    if (totalMissing === 0) return last;

    if (attempt < retries) {
      await pause(attempt * 1200);
    }
  }

  return last;
}

function snapshotKey(s: BackupSnapshot): string {
  return [
    s.exportedAt,
    s.data.categories?.length ?? 0,
    s.data.decks?.length ?? 0,
    s.data.cards?.length ?? 0,
  ].join(":");
}

function checkpointStorageKey(key: string): string {
  return `${RESTORE_CHECKPOINT_PREFIX}${key}`;
}

function loadCheckpoint(key: string): RestoreCheckpoint | null {
  try {
    const raw = localStorage.getItem(checkpointStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RestoreCheckpoint;
    if (parsed?.snapshotKey !== key) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCheckpoint(data: RestoreCheckpoint): void {
  try {
    localStorage.setItem(checkpointStorageKey(data.snapshotKey), JSON.stringify(data));
  } catch {
    // ignore quota/storage issues
  }
}

function clearCheckpoint(key: string): void {
  try {
    localStorage.removeItem(checkpointStorageKey(key));
  } catch {
    // ignore
  }
}

function sortedIds(ids: Iterable<string>): string[] {
  return Array.from(ids).sort();
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function categoryKey(name: string, parentId: string | null | undefined): string {
  return `${parentId ?? ""}::${name}`;
}

function StatusBadge({ status }: { status: "new" | "exists" }) {
  if (status === "new") {
    return (
      <Badge variant="outline" className="text-xs border-emerald-500 text-emerald-600 gap-0.5 shrink-0">
        <Plus className="w-2.5 h-2.5" />
        חדש
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs border-amber-400 text-amber-600 gap-0.5 shrink-0">
      <RefreshCw className="w-2.5 h-2.5" />
      קיים
    </Badge>
  );
}

function DiffSectionView({
  title,
  Icon,
  items,
  selectedIds,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  items: DiffItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const newCount = items.filter((i) => i.status === "new").length;
  const existsCount = items.filter((i) => i.status === "exists").length;
  const selectedCount = items.filter((i) => selectedIds.has(i.snapshotId)).length;
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border rounded-md">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium text-sm flex-1">{title}</span>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {newCount > 0 && <span className="text-emerald-600 font-medium">{newCount} חדשים</span>}
          {newCount > 0 && existsCount > 0 && <span>·</span>}
          {existsCount > 0 && <span className="text-amber-600 font-medium">{existsCount} קיימים</span>}
        </div>
        <Badge variant="secondary" className="text-xs">{selectedCount}/{items.length} נבחרו</Badge>
      </div>
      {!collapsed && (
        <>
          <Separator />
          <div className="px-3 py-1.5 flex gap-2">
            <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); onSelectAll(); }}>בחר חדשים</Button>
            <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); onClearAll(); }}>נקה</Button>
            <span className="text-[10px] text-muted-foreground self-center mr-auto">פריטים קיימים מדולגים אוטומטית</span>
          </div>
          <div className="max-h-48 overflow-y-auto px-3 pb-2 space-y-0.5">
              {items.map((item) => {
                const isExists = item.status === "exists";
                return (
                <div
                  key={item.snapshotId}
                  className={`flex items-center gap-2 py-1 px-1 rounded ${isExists ? "opacity-50 bg-muted/30" : "hover:bg-muted/40"}`}
                  title={isExists ? "מדולג — כבר קיים במערכת" : undefined}
                >
                  <Checkbox
                    id={`diff-${item.snapshotId}`}
                    checked={!isExists && selectedIds.has(item.snapshotId)}
                    disabled={isExists}
                    onCheckedChange={() => { if (!isExists) onToggle(item.snapshotId); }}
                  />
                  <Label
                    htmlFor={`diff-${item.snapshotId}`}
                    className={`text-xs flex-1 leading-snug ${isExists ? "cursor-not-allowed line-through" : "cursor-pointer"}`}
                  >
                    {item.label}
                  </Label>
                  <StatusBadge status={item.status} />
                </div>
                );
              })}
            </div>
        </>
      )}
    </div>
  );
}

/** Quick-pick panel: select / deselect all NEW cards belonging to one or more categories. */
function CategoryQuickPicker({
  cards,
  selectedIds,
  onSelect,
}: {
  cards: DiffItem[];
  selectedIds: Set<string>;
  onSelect: (ids: string[]) => void;
}) {
  // Group: categoryName → { all: DiffItem[], newOnly: DiffItem[] }
  const groups = (() => {
    const map = new Map<string, { all: DiffItem[]; newItems: DiffItem[] }>();
    for (const c of cards) {
      const key = c.categoryName || "(ללא קטגוריה)";
      let g = map.get(key);
      if (!g) { g = { all: [], newItems: [] }; map.set(key, g); }
      g.all.push(c);
      if (c.status === "new") g.newItems.push(c);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "he"));
  })();
  const [collapsed, setCollapsed] = useState(true);
  if (groups.length === 0) return null;

  const toggleCategory = (catName: string, mode: "newOnly" | "clear") => {
    const g = groups.find(([n]) => n === catName);
    if (!g) return;
    const next = new Set(selectedIds);
    if (mode === "clear") {
      g[1].all.forEach((c) => next.delete(c.snapshotId));
    } else {
      // Only NEW items are ever added — existing duplicates are permanently skipped.
      g[1].newItems.forEach((c) => next.add(c.snapshotId));
    }
    onSelect([...next]);
  };

  return (
    <div className="border rounded-md border-gold/30 bg-card/50">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <FolderOpen className="w-4 h-4 text-amber-600" />
        <span className="font-medium text-sm flex-1">שחזור לפי קטגוריה ({groups.length})</span>
        <span className="text-xs text-muted-foreground">{collapsed ? "הצג" : "הסתר"}</span>
      </div>
      {!collapsed && (
        <div className="max-h-56 overflow-y-auto px-3 pb-2 space-y-1">
          {groups.map(([name, g]) => {
            const newCount = g.newItems.length;
            const totalCount = g.all.length;
            const selectedInCat = g.all.filter((c) => selectedIds.has(c.snapshotId)).length;
            return (
              <div key={name} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/40 text-xs">
                <span className="flex-1 truncate" title={name}>{name}</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">{selectedInCat}/{totalCount}</Badge>
                {newCount > 0 && (
                  <Button size="xs" variant="ghost" className="h-6 text-[10px] text-emerald-600"
                    onClick={() => toggleCategory(name, "newOnly")}>
                    + {newCount} חדשים
                  </Button>
                )}
                <Button size="xs" variant="ghost" className="h-6 text-[10px] text-muted-foreground"
                  onClick={() => toggleCategory(name, "clear")}>נקה</Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RestoreDiffDialog({ open, onOpenChange, snapshot, onRuntimeStatusChange, backgroundCommand }: Props) {
  const { state, bulkAddDecks, bulkAddCards, addCategory, requestCloudSyncNow } = useStudy();
  const { user } = useAuth();
  const [isRestoring, setIsRestoring] = useState(false);
  const [isComputing, setIsComputing] = useState(false);
  const [diff, setDiff] = useState<ReturnType<typeof buildRestoreDiff>>({ categories: [], decks: [], cards: [] });
  const [restorePhase, setRestorePhase] = useState("");
  const [restorePercent, setRestorePercent] = useState(0);
  const [restoreProcessed, setRestoreProcessed] = useState(0);
  const [restoreTotal, setRestoreTotal] = useState(0);
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const [perfMode, setPerfMode] = useState<RestorePerfMode>("balanced");
  const [activeCardConcurrency, setActiveCardConcurrency] = useState(PERF_CONFIGS.balanced.initialConcurrency);
  const stopRequestedRef = useRef(false);

  // Compute diff off the main thread via Web Worker so the dialog opens without freezing
  useEffect(() => {
    if (!open || !snapshot) {
      setDiff({ categories: [], decks: [], cards: [] });
      return;
    }
    setIsComputing(true);
    const worker = new RestoreDiffWorker();
    worker.onmessage = (e: MessageEvent<RestoreDiff>) => {
      setDiff(e.data);
      setIsComputing(false);
      worker.terminate();
    };
    worker.onerror = () => {
      // Fallback: run synchronously on the main thread
      setDiff(buildRestoreDiff(state, snapshot));
      setIsComputing(false);
      worker.terminate();
    };
    worker.postMessage({ state, snapshot });
    return () => worker.terminate();
  }, [open, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!snapshot) return;
    const key = snapshotKey(snapshot);
    const cp = loadCheckpoint(key);
    setResumeAvailable(!!cp);
    if (cp) {
      setSelectedCatIds(new Set(cp.selectedCatIds));
      setSelectedDeckIds(new Set(cp.selectedDeckIds));
      setSelectedCardIds(new Set(cp.selectedCardIds));
      return;
    }
    setSelectedCatIds(new Set(diff.categories.filter((i) => i.status === "new").map((i) => i.snapshotId)));
    setSelectedDeckIds(new Set(diff.decks.filter((i) => i.status === "new").map((i) => i.snapshotId)));
    setSelectedCardIds(new Set(diff.cards.filter((i) => i.status === "new").map((i) => i.snapshotId)));
  }, [diff, snapshot]);

  // Selected IDs per section (default: select "new" items only)
  const [selectedCatIds, setSelectedCatIds] = useState<Set<string>>(() =>
    new Set(diff.categories.filter((i) => i.status === "new").map((i) => i.snapshotId)),
  );
  const [selectedDeckIds, setSelectedDeckIds] = useState<Set<string>>(() =>
    new Set(diff.decks.filter((i) => i.status === "new").map((i) => i.snapshotId)),
  );
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(() =>
    new Set(diff.cards.filter((i) => i.status === "new").map((i) => i.snapshotId)),
  );

  function toggle(section: DiffSection, id: string) {
    const items = diff[section];
    const item = items.find((i) => i.snapshotId === id);
    // Safety: never allow selecting a duplicate/existing item.
    if (item && item.status === "exists") return;
    const setter =
      section === "categories" ? setSelectedCatIds : section === "decks" ? setSelectedDeckIds : setSelectedCardIds;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(section: DiffSection) {
    // Only NEW items — existing duplicates are permanently skipped.
    const items = diff[section].filter((i) => i.status === "new");
    const setter =
      section === "categories" ? setSelectedCatIds : section === "decks" ? setSelectedDeckIds : setSelectedCardIds;
    setter(new Set(items.map((i) => i.snapshotId)));
  }

  function clearAll(section: DiffSection) {
    const setter =
      section === "categories" ? setSelectedCatIds : section === "decks" ? setSelectedDeckIds : setSelectedCardIds;
    setter(new Set());
  }

  const totalSelected = selectedCatIds.size + selectedDeckIds.size + selectedCardIds.size;

  const handleConfirm = useCallback(async () => {
    if (!snapshot) return;
    stopRequestedRef.current = false;
    setIsRestoring(true);
    setRestorePercent(0);
    setRestoreProcessed(0);
    setRestoreTotal(0);
    try {
      const { data } = snapshot;
      const key = snapshotKey(snapshot);

      // Safety: filter again to status==="new" so duplicates can never sneak through
      // (e.g. via a stale checkpoint or a manual selection bypass).
      const selectedCats = diff.categories.filter((i) => i.status === "new" && selectedCatIds.has(i.snapshotId));
      const selectedDecks = diff.decks.filter((i) => i.status === "new" && selectedDeckIds.has(i.snapshotId));
      const selectedCards = diff.cards.filter((i) => i.status === "new" && selectedCardIds.has(i.snapshotId));

      const selectedCatSorted = sortedIds(selectedCatIds);
      const selectedDeckSorted = sortedIds(selectedDeckIds);
      const selectedCardSorted = sortedIds(selectedCardIds);

      const total = selectedCats.length + selectedDecks.length + selectedCards.length;
      setRestoreTotal(total);

      const snapCatMap = new Map((data.categories ?? []).map((c) => [c.id, c]));
      const snapDeckMap = new Map((data.decks ?? []).map((d) => [d.id, d]));
      const snapCardMap = new Map((data.cards ?? []).map((c) => [c.id, c]));

      const existingCatsByParentName = new Map(
        state.categories.map((c) => [categoryKey(c.name, c.parentId), c.id]),
      );
      const existingDeckNames = new Map(state.decks.map((d) => [d.name, d.id]));
      // Dedup key for cards: normalized "cat::question" — matches restoreDiff.ts logic.
      const { normalizeText } = await import("@/lib/study/restoreDiff");
      const cardDedupKey = (catTag: string, question: string) =>
        `${normalizeText(catTag)}::${normalizeText(question)}`;
      const existingQs = new Set(
        state.cards.map((c) => {
          const catTag = (c.tags ?? []).find((t) => t.startsWith("cat:"))?.slice(4) ?? "";
          return cardDedupKey(catTag, c.question);
        }),
      );

      const cp = loadCheckpoint(key);
      const validCp = cp
        && sameIds(cp.selectedCatIds, selectedCatSorted)
        && sameIds(cp.selectedDeckIds, selectedDeckSorted)
        && sameIds(cp.selectedCardIds, selectedCardSorted);

      // Build ID remapping (snapshot id → current state id)
      const catIdMap = new Map<string, string>(validCp ? cp.catIdMapEntries : []);
      const deckIdMap = new Map<string, string>(validCp ? cp.deckIdMapEntries : []);

      let categoryIndex = validCp ? cp.categoryIndex : 0;
      let deckIndex = validCp ? cp.deckIndex : 0;
      let cardIndex = validCp ? cp.cardIndex : 0;
      let addedCards = validCp ? cp.addedCards : 0;
      const addedCardIds = new Set<string>();
      let processed = categoryIndex + deckIndex + cardIndex;
      setRestoreProcessed(processed);
      setRestorePercent(total > 0 ? Math.round((processed / total) * 100) : 0);

      const checkpoint = () => {
        const dataToSave: RestoreCheckpoint = {
          snapshotKey: key,
          selectedCatIds: selectedCatSorted,
          selectedDeckIds: selectedDeckSorted,
          selectedCardIds: selectedCardSorted,
          categoryIndex,
          deckIndex,
          cardIndex,
          addedCards,
          catIdMapEntries: Array.from(catIdMap.entries()),
          deckIdMapEntries: Array.from(deckIdMap.entries()),
          updatedAt: Date.now(),
        };
        saveCheckpoint(dataToSave);
      };

      const perf = PERF_CONFIGS[perfMode];
      let cardConcurrency = perf.initialConcurrency;
      setActiveCardConcurrency(cardConcurrency);

      const maybeThrottle = async () => {
        await pause(perf.batchPauseMs);
      };

      const progress = (phase: string) => {
        setRestorePhase(phase);
        setRestoreProcessed(processed);
        setRestorePercent(total > 0 ? Math.round((processed / total) * 100) : 100);
      };

      const maybeStop = () => {
        if (stopRequestedRef.current) {
          checkpoint();
          void requestCloudSyncNow("restore-paused");
          setResumeAvailable(true);
          throw new Error("RESTORE_PAUSED_BY_USER");
        }
      };

      if (!validCp) checkpoint();

      // ── Restore categories ────────────────────────────────────────
      progress("משחזר קטגוריות...");
      for (; categoryIndex < selectedCats.length; categoryIndex++) {
        maybeStop();
        const diffCat = selectedCats[categoryIndex];
        const snapshotCat = snapCatMap.get(diffCat.snapshotId);
        if (snapshotCat) {
          const mappedParentId = snapshotCat.parentId ? (catIdMap.get(snapshotCat.parentId) ?? null) : null;
          const keyByParent = categoryKey(snapshotCat.name, mappedParentId);
          if (existingCatsByParentName.has(keyByParent)) {
            catIdMap.set(diffCat.snapshotId, existingCatsByParentName.get(keyByParent)!);
          } else {
            const created = addCategory(snapshotCat.name, mappedParentId);
            catIdMap.set(diffCat.snapshotId, created.id);
            existingCatsByParentName.set(keyByParent, created.id);
          }
        }
        processed++;
        // Only yield/checkpoint every loopBatchSize items to avoid per-item overhead
        const isLast = categoryIndex === selectedCats.length - 1;
        if (isLast || (categoryIndex + 1) % perf.loopBatchSize === 0) {
          progress("משחזר קטגוריות...");
          checkpoint();
          await maybeThrottle();
        }
      }
      checkpoint();
      await pause();

      // ── Restore decks (BULK) ─────────────────────────────────────
      progress("משחזר מערכות לימוד...");
      {
        const toCreate: Array<{ snapshotId: string; name: string; description?: string }> = [];
        for (let i = deckIndex; i < selectedDecks.length; i++) {
          const diffDeck = selectedDecks[i];
          const snapshotDeck = snapDeckMap.get(diffDeck.snapshotId);
          if (!snapshotDeck) continue;
          const existingId = existingDeckNames.get(snapshotDeck.name);
          if (existingId) {
            deckIdMap.set(diffDeck.snapshotId, existingId);
          } else {
            toCreate.push({ snapshotId: diffDeck.snapshotId, name: snapshotDeck.name, description: snapshotDeck.description });
          }
        }
        if (toCreate.length) {
          const created = bulkAddDecks(toCreate.map((d) => ({ name: d.name, description: d.description })));
          created.forEach((c, i) => {
            deckIdMap.set(toCreate[i].snapshotId, c.id);
            existingDeckNames.set(c.name, c.id);
          });
        }
        processed += selectedDecks.length - deckIndex;
        deckIndex = selectedDecks.length;
        progress("משחזר מערכות לימוד...");
        checkpoint();
        await pause(0);
      }

      // ── Restore cards (BULK, chunked for progress + checkpoints) ──
      progress("משחזר שאלות...");
      const CARD_BULK_CHUNK = 2000;
      while (cardIndex < selectedCards.length) {
        maybeStop();
        const batchEnd = Math.min(selectedCards.length, cardIndex + CARD_BULK_CHUNK);
        const slice = selectedCards.slice(cardIndex, batchEnd);
        const toInsert: Array<Omit<Card, "id" | "createdAt" | "srs" | "stats">> = [];
        for (const diffCard of slice) {
          const card = snapCardMap.get(diffCard.snapshotId);
          if (!card) continue;
          const newDeckId = card.deckId ? (deckIdMap.get(card.deckId) ?? card.deckId) : null;
          const catTag = (card.tags ?? []).find((t) => t.startsWith("cat:"))?.slice(4) ?? "";
          const qKey = cardDedupKey(catTag, card.question);
          if (existingQs.has(qKey)) continue;
          existingQs.add(qKey);
          const { id: _i, createdAt: _c, srs: _s, stats: _st, ...rest } = card;
          toInsert.push({ ...rest, deckId: newDeckId } as Omit<Card, "id" | "createdAt" | "srs" | "stats">);
        }
        if (toInsert.length) {
          const created = bulkAddCards(toInsert);
          created.forEach((c) => addedCardIds.add(c.id));
          addedCards += created.length;
        }
        processed += slice.length;
        cardIndex = batchEnd;
        progress(`משחזר שאלות... (${cardIndex}/${selectedCards.length})`);
        checkpoint();
        await pause(perf.batchPauseMs);
      }

      clearCheckpoint(key);
      setResumeAvailable(false);
      setRestorePercent(100);
      setRestorePhase("הושלם");

      if (user?.id) {
        const restoredSnapshot: BackupSnapshot = {
          version: snapshot.version,
          exportedAt: new Date().toISOString(),
          exportedBy: user.email ?? snapshot.exportedBy,
          data: {
            decks: selectedDecks
              .map((i) => snapDeckMap.get(i.snapshotId))
              .filter((d): d is NonNullable<typeof d> => !!d),
            cards: selectedCards
              .map((i) => snapCardMap.get(i.snapshotId))
              .filter((c): c is NonNullable<typeof c> => !!c),
            categories: selectedCats
              .map((i) => snapCatMap.get(i.snapshotId))
              .filter((c): c is NonNullable<typeof c> => !!c),
            goals: [],
            shasPlan: null,
            dayNotes: [],
            shasReviews: [],
            learningSessions: [],
            generalPlans: [],
            reviewIntervals: snapshot.data.reviewIntervals ?? [1, 3, 7, 14, 30],
          },
        };

        try {
          await saveCloudBackup(
            supabase,
            user.id,
            `שחזור אוטומטי ${new Date().toLocaleString("he-IL")}`,
            restoredSnapshot,
          );
        } catch {
          toast({
            title: "השחזור הושלם",
            description: "השחזור נשמר מקומית, אבל שמירת הגיבוי לענן נכשלה",
            variant: "destructive",
          });
        }
      }

      void (async () => {
        try {
          await pause(300);
          const syncResult = await requestCloudSyncNow("restore-complete");

          if (syncResult?.deleteFlush?.empty) {
            toast({
              title: "בקרת מחיקות",
              description: "אין מחיקות ממתינות (מחיקה ריקה)",
            });
          } else if ((syncResult?.deleteFlush?.failed ?? 0) > 0) {
            toast({
              title: "בקרת מחיקות: יש כשלים",
              description: `בוצע: ${syncResult.deleteFlush.success} · נכשל: ${syncResult.deleteFlush.failed}`,
              variant: "destructive",
            });
          } else {
            toast({
              title: "בקרת מחיקות: הושלמה",
              description: `בוצע: ${syncResult?.deleteFlush?.success ?? 0} · נכשל: 0`,
            });
          }

          const categoryIdsToVerify = Array.from(new Set(
            selectedCats
              .map((i) => catIdMap.get(i.snapshotId))
              .filter((v): v is string => !!v),
          ));
          const deckIdsToVerify = Array.from(new Set(
            selectedDecks
              .map((i) => deckIdMap.get(i.snapshotId))
              .filter((v): v is string => !!v),
          ));
          const cardIdsToVerify = Array.from(addedCardIds);

          const verify = await verifyCloudDiffWithRetry({
            categoryIds: categoryIdsToVerify,
            deckIds: deckIdsToVerify,
            cardIds: cardIdsToVerify,
            retries: 3,
          });

          if (verify.totalMissing > 0) {
            const details = verify.summaries
              .filter((s) => s.missing > 0)
              .map((s) => `${s.table}: חסרים ${s.missing}/${s.expected}`)
              .join(" | ");
            toast({
              title: "בקרת העלאה לענן מצאה פערים",
              description: details,
              variant: "destructive",
            });
          } else {
            toast({
              title: "בקרת העלאה לענן הצליחה",
              description: "Diff מתקדם מאשר שכל הפריטים המשוחזרים עלו לענן",
            });
          }
        } catch {
          toast({
            title: "בקרת ענן לא הושלמה",
            description: "השחזור הצליח, אבל אימות העלאה לענן נכשל וירוץ שוב בטעינה הבאה",
            variant: "destructive",
          });
        }
      })();

      toast({
        title: "שחזור הסתיים",
        description: `הוספו: ${selectedCatIds.size} קטגוריות, ${selectedDeckIds.size} מערכות, ${addedCards} שאלות`,
      });
      onOpenChange(false);
    } catch (err: unknown) {
      if (snapshot) {
        const cp = loadCheckpoint(snapshotKey(snapshot));
        if (cp) setResumeAvailable(true);
      }
      if (err instanceof Error && err.message === "RESTORE_PAUSED_BY_USER") {
        toast({
          title: "השחזור הושהה",
          description: "אפשר להמשיך מאותה נקודה בכל רגע",
        });
        return;
      }
      toast({
        title: "שגיאה בשחזור",
        description: err instanceof Error ? `${err.message} (אפשר להמשיך מאותה נקודה)` : "שגיאה (אפשר להמשיך מאותה נקודה)",
        variant: "destructive",
      });
    } finally {
      setIsRestoring(false);
    }
  }, [
    snapshot,
    diff,
    selectedCatIds,
    selectedDeckIds,
    selectedCardIds,
    state.categories,
    state.decks,
    state.cards,
    addCategory,
    bulkAddDecks,
    bulkAddCards,
    onOpenChange,
    perfMode,
  ]);

  useEffect(() => {
    onRuntimeStatusChange?.({
      running: isRestoring,
      resumeAvailable,
      phase: restorePhase,
      percent: restorePercent,
      processed: restoreProcessed,
      total: restoreTotal,
    });
  }, [
    isRestoring,
    resumeAvailable,
    restorePhase,
    restorePercent,
    restoreProcessed,
    restoreTotal,
    onRuntimeStatusChange,
  ]);

  useEffect(() => {
    if (!backgroundCommand || !snapshot) return;
    if (backgroundCommand.type === "stop" && isRestoring) {
      stopRequestedRef.current = true;
      return;
    }
    if (backgroundCommand.type === "resume" && !isRestoring && resumeAvailable) {
      void handleConfirm();
    }
  }, [backgroundCommand, isRestoring, resumeAvailable, handleConfirm, snapshot]);

  if (!snapshot) return null;

  const snapshotDate = new Date(snapshot.exportedAt).toLocaleString("he-IL");
  const totalNew =
    diff.categories.filter((i) => i.status === "new").length +
    diff.decks.filter((i) => i.status === "new").length +
    diff.cards.filter((i) => i.status === "new").length;
  const totalExisting =
    diff.categories.filter((i) => i.status === "exists").length +
    diff.decks.filter((i) => i.status === "exists").length +
    diff.cards.filter((i) => i.status === "exists").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onOpenChange(false)}
              title="מזער ועבוד ברקע"
              aria-label="מזער ועבוד ברקע"
            >
              <Minimize2 className="w-4 h-4" />
            </Button>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              שחזור אינטראקטיבי
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            סקירת הבדלים בין הגיבוי למצב הנוכחי, בחירה מה לשחזר והרצה מדורגת עם אפשרות המשך מתקלה.
          </DialogDescription>
          <div className="text-sm text-muted-foreground">
            קובץ מ-{snapshotDate}
            {snapshot.exportedBy && ` · ${snapshot.exportedBy}`}
          </div>
          {resumeAvailable && !isRestoring && (
            <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-md inline-flex self-start">
              נמצאה נקודת המשך קודמת. בלחיצה על "שחזר" המערכת תמשיך מאותה נקודה.
            </div>
          )}
          {/* Summary */}
          <div className="flex gap-2 mt-2 flex-wrap">
            {totalNew > 0 && (
              <div className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                {totalNew} פריטים חדשים
              </div>
            )}
            {totalExisting > 0 && (
              <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-full">
                <AlertTriangle className="w-3 h-3" />
                {totalExisting} כפילויות — מדולגות אוטומטית
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 mt-2">
            <select
              value={perfMode}
              onChange={(e) => setPerfMode(e.target.value as RestorePerfMode)}
              disabled={isRestoring}
              className="rounded-md border border-gold/30 bg-background px-2 py-1 text-xs"
            >
              <option value="safe">Safe</option>
              <option value="balanced">Balanced</option>
              <option value="turbo">Turbo</option>
            </select>
            <span className="text-xs text-muted-foreground">פרופיל עומס</span>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="space-y-3 p-1 pb-2">
            {isRestoring && (
              <div className="space-y-2 rounded-md border border-gold/30 bg-card/70 p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{restoreTotal > 0 ? `${restoreProcessed}/${restoreTotal}` : "0/0"}</span>
                  <span>{restorePhase || "משחזר..."}</span>
                </div>
                <Progress value={restorePercent} className="h-2" />
                <div className="text-[11px] text-muted-foreground text-right">{restorePercent}%</div>
                <div className="text-[11px] text-muted-foreground text-right">
                  שחזור מקבילי מבוקר · פרופיל {perfMode.toUpperCase()} · מקביליות כרטיסים x{activeCardConcurrency}
                </div>
              </div>
            )}
            {isComputing ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                <RefreshCw className="w-4 h-4 animate-spin" />
                מחשב הבדלים...
              </div>
            ) : (
              <>
              {diff.categories.length > 0 && (
              <DiffSectionView
                title="קטגוריות"
                Icon={FolderOpen}
                items={diff.categories}
                selectedIds={selectedCatIds}
                onToggle={(id) => toggle("categories", id)}
                onSelectAll={() => selectAll("categories")}
                onClearAll={() => clearAll("categories")}
              />
            )}
            {diff.decks.length > 0 && (
              <DiffSectionView
                title="מערכות לימוד"
                Icon={Layers}
                items={diff.decks}
                selectedIds={selectedDeckIds}
                onToggle={(id) => toggle("decks", id)}
                onSelectAll={() => selectAll("decks")}
                onClearAll={() => clearAll("decks")}
              />
            )}
            {diff.cards.length > 0 && (
              <>
                <CategoryQuickPicker
                  cards={diff.cards}
                  selectedIds={selectedCardIds}
                  onSelect={(ids) => setSelectedCardIds(new Set(ids))}
                />
                <DiffSectionView
                  title="שאלות"
                  Icon={FileQuestion}
                  items={diff.cards}
                  selectedIds={selectedCardIds}
                  onToggle={(id) => toggle("cards", id)}
                  onSelectAll={() => selectAll("cards")}
                  onClearAll={() => clearAll("cards")}
                />
              </>
            )}
            {diff.categories.length === 0 && diff.decks.length === 0 && diff.cards.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-500 opacity-60" />
                <p className="text-sm font-medium">הכל עדכני!</p>
                <p className="text-xs mt-1">כל הנתונים בגיבוי כבר קיימים במערכת</p>
              </div>
            )}
            </>
            )}
          </div>
        </div>

        <DialogFooter className="flex-row-reverse gap-2 sm:flex-row-reverse border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isRestoring ? "עבוד ברקע" : "ביטול"}
          </Button>
          {isRestoring && (
            <Button
              variant="outline"
              onClick={() => {
                stopRequestedRef.current = true;
              }}
              className="gap-1"
            >
              עצור
            </Button>
          )}
          <Button
            onClick={handleConfirm}
            disabled={isRestoring || isComputing || totalSelected === 0}
            className="gap-1"
          >
            {resumeAvailable && !isRestoring ? (
              <PlayCircle className="w-4 h-4" />
            ) : (
              <RefreshCw className={`w-4 h-4 ${isRestoring ? "animate-spin" : ""}`} />
            )}
            {resumeAvailable && !isRestoring ? "המשך שחזור" : `שחזר ${totalSelected > 0 ? `(${totalSelected} פריטים)` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
