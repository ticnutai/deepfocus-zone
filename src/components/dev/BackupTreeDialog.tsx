/**
 * Tree-based selection dialog for selective backup and restore.
 * - mode="backup": shows current IndexedDB state, user picks what to export
 * - mode="restore": shows backup file's state, user picks what to merge in
 */
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronRight, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { toGematria } from "@/lib/study/shasGen";
import type { StudyState } from "@/lib/study/types";
import {
  buildSelectionTree,
  makeDefaultGroups,
  makeDefaultExtras,
  extractPartialState,
  type SelectionTree,
  type ExtrasSelection,
} from "@/lib/study/backupSelection";

// ── Checkbox tri-state helper ─────────────────────────────────────────────────

type CheckState = "checked" | "unchecked" | "indeterminate";

function groupsCheckState(groupIds: string[], selected: Set<string>): CheckState {
  if (groupIds.length === 0) return "unchecked";
  const cnt = groupIds.filter((id) => selected.has(id)).length;
  if (cnt === 0) return "unchecked";
  if (cnt === groupIds.length) return "checked";
  return "indeterminate";
}

function toCheckedProp(state: CheckState): boolean | "indeterminate" {
  if (state === "checked") return true;
  if (state === "indeterminate") return "indeterminate";
  return false;
}

// ── Daf row ───────────────────────────────────────────────────────────────────

function DafRow({
  groupId, daf, count, selected, onToggle,
}: { groupId: string; daf: number; count: number; selected: boolean; onToggle: (id: string, val: boolean) => void }) {
  const dafLabel = `${toGematria(daf)}'`;
  return (
    <div
      dir="rtl"
      className="flex items-center gap-2 py-0.5 pl-2 pr-8 hover:bg-muted/40 rounded cursor-pointer select-none"
      onClick={() => onToggle(groupId, !selected)}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(v) => onToggle(groupId, !!v)}
        onClick={(e) => e.stopPropagation()}
      />
      <span className="text-xs text-muted-foreground">דף {dafLabel}</span>
      <span className="text-[11px] text-muted-foreground/50 mr-auto">{count}</span>
    </div>
  );
}

// ── Masechta row ──────────────────────────────────────────────────────────────

function MasechtaRow({
  masechta, dafim, totalCards, selected, onToggleDaf, onToggleGroup,
}: {
  masechta: string;
  dafim: { groupId: string; daf: number; cardIds: string[] }[];
  totalCards: number;
  selected: Set<string>;
  onToggleDaf: (id: string, val: boolean) => void;
  onToggleGroup: (ids: string[], val: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const groupIds = dafim.map((d) => d.groupId);
  const state = groupsCheckState(groupIds, selected);

  return (
    <div className="pr-4" dir="rtl">
      <div
        className="flex items-center gap-1 py-0.5 pl-1 hover:bg-muted/40 rounded cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="p-0.5 text-muted-foreground" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <Checkbox
          checked={toCheckedProp(state)}
          onCheckedChange={(v) => onToggleGroup(groupIds, !!v)}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="text-xs font-medium">{masechta}</span>
        <span className="text-[11px] text-muted-foreground/50 mr-auto">{totalCards}</span>
      </div>
      {open && (
        <div className="pr-2">
          {dafim.map((d) => (
            <DafRow
              key={d.groupId}
              groupId={d.groupId}
              daf={d.daf}
              count={d.cardIds.length}
              selected={selected.has(d.groupId)}
              onToggle={onToggleDaf}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Seder row ─────────────────────────────────────────────────────────────────

function SederRow({
  seder, masechtot, totalCards, selected, onToggleDaf, onToggleGroup,
}: {
  seder: string;
  masechtot: { masechta: string; dafim: { groupId: string; daf: number; cardIds: string[] }[]; totalCards: number }[];
  totalCards: number;
  selected: Set<string>;
  onToggleDaf: (id: string, val: boolean) => void;
  onToggleGroup: (ids: string[], val: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const allGroupIds = masechtot.flatMap((m) => m.dafim.map((d) => d.groupId));
  const state = groupsCheckState(allGroupIds, selected);

  return (
    <div dir="rtl">
      <div
        className="flex items-center gap-1 py-0.5 pl-1 hover:bg-muted/40 rounded cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="p-0.5 text-muted-foreground" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <Checkbox
          checked={toCheckedProp(state)}
          onCheckedChange={(v) => onToggleGroup(allGroupIds, !!v)}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="text-sm font-bold">סדר {seder}</span>
        <span className="text-[11px] text-muted-foreground/50 mr-auto">{totalCards}</span>
      </div>
      {open && (
        <div className="pr-3">
          {masechtot.map((m) => (
            <MasechtaRow
              key={m.masechta}
              {...m}
              selected={selected}
              onToggleDaf={onToggleDaf}
              onToggleGroup={onToggleGroup}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Extras row ────────────────────────────────────────────────────────────────

function ExtrasRow({
  label, count, checked, onToggle,
}: { label: string; count: number | null; checked: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div
      dir="rtl"
      className="flex items-center gap-2 py-0.5 px-1 hover:bg-muted/40 rounded cursor-pointer select-none"
      onClick={() => onToggle(!checked)}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onToggle(!!v)}
        onClick={(e) => e.stopPropagation()}
      />
      <span className="text-sm">{label}</span>
      {count !== null && <span className="text-[11px] text-muted-foreground/50 mr-auto">{count}</span>}
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export interface BackupTreeDialogProps {
  open: boolean;
  onClose: () => void;
  /** "backup" = choosing what to export; "restore" = choosing what to import */
  mode: "backup" | "restore";
  /** The StudyState to build the tree from (current state for backup, file state for restore) */
  state: StudyState;
  onConfirm: (partial: Partial<StudyState>) => void;
}

export function BackupTreeDialog({ open, onClose, mode, state, onConfirm }: BackupTreeDialogProps) {
  const tree = useMemo(() => buildSelectionTree(state), [state]);

  const [groups, setGroups] = useState<Set<string>>(() => makeDefaultGroups(tree));
  const [extras, setExtras] = useState<ExtrasSelection>(() => makeDefaultExtras(state));

  // Reset selection whenever state changes (new file loaded, etc.)
  useEffect(() => {
    const newTree = buildSelectionTree(state);
    setGroups(makeDefaultGroups(newTree));
    setExtras(makeDefaultExtras(state));
  }, [state]);

  const toggleGroup = useCallback((id: string, val: boolean) => {
    setGroups((prev) => {
      const next = new Set(prev);
      if (val) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const toggleGroupBulk = useCallback((ids: string[], val: boolean) => {
    setGroups((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (val) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const allGroupIds = useMemo(() => [
    ...tree.shasTree.flatMap((s) => s.masechtot.flatMap((m) => m.dafim.map((d) => d.groupId))),
    ...tree.deckNodes.map((d) => d.groupId),
    ...(tree.generalCardIds.length > 0 ? ["general"] : []),
  ], [tree]);

  const globalState = groupsCheckState(allGroupIds, groups);

  const totalSelected = useMemo(() => {
    let n = 0;
    for (const seder of tree.shasTree)
      for (const m of seder.masechtot)
        for (const d of m.dafim)
          if (groups.has(d.groupId)) n += d.cardIds.length;
    for (const deck of tree.deckNodes)
      if (groups.has(deck.groupId)) n += deck.cardIds.length;
    if (groups.has("general")) n += tree.generalCardIds.length;
    return n;
  }, [groups, tree]);

  const hasAnySelection = totalSelected > 0 || Object.values(extras).some(Boolean);

  const handleConfirm = () => {
    const partial = extractPartialState(state, tree, groups, extras);
    onConfirm(partial);
  };

  const extrasRows: { key: keyof ExtrasSelection; label: string; count: number | null }[] = [
    { key: "decks", label: "קבוצות (decks)", count: state.decks?.length ?? 0 },
    { key: "goals", label: "מטרות", count: state.goals?.length ?? 0 },
    { key: "plans", label: "תוכניות לימוד", count: (state.generalPlans?.length ?? 0) + (state.quizPlans?.length ?? 0) },
    { key: "shasPlans", label: 'תוכנית ש"ס', count: state.shasPlans?.length ?? (state.shasPlan ? 1 : 0) },
    { key: "categories", label: "קטגוריות", count: state.categories?.length ?? 0 },
    { key: "settings", label: "הגדרות ממשק", count: null },
  ];

  const isEmpty = tree.totalCards === 0 && !Object.values(extras).some((_, i) => {
    const key = extrasRows[i]?.key;
    return key && (state[key as never] ? true : false);
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md flex flex-col max-h-[88vh]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "backup" ? <Download className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            {mode === "backup" ? "בחר מה לגבות" : "בחר מה לשחזר"}
          </DialogTitle>
        </DialogHeader>

        {/* Global select-all bar */}
        {allGroupIds.length > 0 && (
          <div
            dir="rtl"
            className="flex items-center gap-2 px-1 py-1.5 border-b cursor-pointer select-none hover:bg-muted/30 rounded"
            onClick={() => toggleGroupBulk(allGroupIds, globalState !== "checked")}
          >
            <Checkbox
              checked={toCheckedProp(globalState)}
              onCheckedChange={(v) => toggleGroupBulk(allGroupIds, !!v)}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="text-sm font-semibold">כל הכרטיסיות</span>
            <span className="text-xs text-muted-foreground mr-auto">
              {totalSelected} / {tree.totalCards} נבחרות
            </span>
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-1 py-1 px-1">

            {/* Shas tree */}
            {tree.shasTree.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 px-1">ש"ס בבלי</p>
                {tree.shasTree.map((s) => (
                  <SederRow
                    key={s.seder}
                    {...s}
                    selected={groups}
                    onToggleDaf={toggleGroup}
                    onToggleGroup={toggleGroupBulk}
                  />
                ))}
              </div>
            )}

            {/* Deck groups (non-Shas) */}
            {tree.deckNodes.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 px-1">לפי קבוצה</p>
                {tree.deckNodes.map((deck) => (
                  <div
                    key={deck.groupId}
                    dir="rtl"
                    className="flex items-center gap-2 py-0.5 px-1 hover:bg-muted/40 rounded cursor-pointer select-none"
                    onClick={() => toggleGroup(deck.groupId, !groups.has(deck.groupId))}
                  >
                    <Checkbox
                      checked={groups.has(deck.groupId)}
                      onCheckedChange={(v) => toggleGroup(deck.groupId, !!v)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="text-sm">{deck.deckName}</span>
                    <span className="text-[11px] text-muted-foreground/50 mr-auto">{deck.cardIds.length}</span>
                  </div>
                ))}
              </div>
            )}

            {/* General cards */}
            {tree.generalCardIds.length > 0 && (
              <div className="mb-2">
                <div
                  dir="rtl"
                  className="flex items-center gap-2 py-0.5 px-1 hover:bg-muted/40 rounded cursor-pointer select-none"
                  onClick={() => toggleGroup("general", !groups.has("general"))}
                >
                  <Checkbox
                    checked={groups.has("general")}
                    onCheckedChange={(v) => toggleGroup("general", !!v)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="text-sm">כרטיסיות כלליות</span>
                  <span className="text-[11px] text-muted-foreground/50 mr-auto">{tree.generalCardIds.length}</span>
                </div>
              </div>
            )}

            {tree.totalCards === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">אין כרטיסיות בנתונים</p>
            )}

            {/* Extras */}
            <div className="pt-3 mt-1 border-t space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 px-1">נתונים נוספים</p>
              {extrasRows.map(({ key, label, count }) => (
                <ExtrasRow
                  key={key}
                  label={label}
                  count={count}
                  checked={extras[key]}
                  onToggle={(v) => setExtras((p) => ({ ...p, [key]: v }))}
                />
              ))}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="flex gap-2 pt-2 border-t" dir="rtl">
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button
            onClick={handleConfirm}
            disabled={!hasAnySelection}
            className="gap-1.5"
          >
            {mode === "backup"
              ? <><Download className="h-3.5 w-3.5" />הורד גיבוי נבחר</>
              : <><Upload className="h-3.5 w-3.5" />שחזר נבחרים</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
