/**
 * Pure diff computation for the interactive restore dialog.
 * Extracted into a standalone module so it can be imported by a Web Worker
 * without pulling in the heavy xlsx dependency from backup.ts.
 */
import type { StudyState } from "./types";
import type { BackupSnapshot } from "./backup";

export type DiffStatus = "new" | "exists";

export interface DiffItem {
  type: "deck" | "category" | "card";
  status: DiffStatus;
  label: string;
  /** ID from the snapshot (not current state) */
  snapshotId: string;
  /** ID in current state (only when status = "exists") */
  currentId?: string;
  /** Category name (from cat: tag) — only set on card items */
  categoryName?: string;
  /** Deck name — only set on card items */
  deckName?: string;
  /** Normalized dedup key — used by restore runtime as a final safety filter */
  dedupKey?: string;
}

export interface RestoreDiff {
  categories: DiffItem[];
  decks: DiffItem[];
  cards: DiffItem[];
}

/** Normalize text for duplicate detection: lowercase, collapse whitespace, strip Hebrew nikud. */
export function normalizeText(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "") // Hebrew niqqud
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildRestoreDiff(state: StudyState, snapshot: BackupSnapshot): RestoreDiff {
  const { data } = snapshot;

  // ── Existing-in-state lookups (normalized) ──────────────────────────────
  const existingCatNamesNorm = new Map<string, string>();
  state.categories.forEach((c) => existingCatNamesNorm.set(normalizeText(c.name), c.id));

  const existingDeckNamesNorm = new Map<string, string>();
  state.decks.forEach((d) => existingDeckNamesNorm.set(normalizeText(d.name), d.id));

  // Card key: normalized "cat::question" (first cat: tag).
  const existingCardKeys = new Map<string, string>();
  state.cards.forEach((c) => {
    const catTag = (c.tags ?? []).find((t) => t.startsWith("cat:"))?.slice(4) ?? "";
    const key = `${normalizeText(catTag)}::${normalizeText(c.question)}`;
    if (!existingCardKeys.has(key)) existingCardKeys.set(key, c.id);
  });

  const snapshotDeckMap = new Map((data.decks ?? []).map((d) => [d.id, d.name]));

  // ── Categories ─────────────────────────────────────────────────────────
  const seenCatKeys = new Set<string>();
  const categories: DiffItem[] = (data.categories ?? []).map((c) => {
    const norm = normalizeText(c.name);
    const existingId = existingCatNamesNorm.get(norm);
    const internalDup = seenCatKeys.has(norm);
    seenCatKeys.add(norm);
    const isExists = !!existingId || internalDup;
    return {
      type: "category",
      status: isExists ? "exists" : "new",
      label: c.name,
      snapshotId: c.id,
      currentId: existingId,
      dedupKey: norm,
    };
  });

  // ── Decks ──────────────────────────────────────────────────────────────
  const seenDeckKeys = new Set<string>();
  const decks: DiffItem[] = (data.decks ?? []).map((d) => {
    const norm = normalizeText(d.name);
    const existingId = existingDeckNamesNorm.get(norm);
    const internalDup = seenDeckKeys.has(norm);
    seenDeckKeys.add(norm);
    const isExists = !!existingId || internalDup;
    return {
      type: "deck",
      status: isExists ? "exists" : "new",
      label: d.name,
      snapshotId: d.id,
      currentId: existingId,
      dedupKey: norm,
    };
  });

  // ── Cards ──────────────────────────────────────────────────────────────
  const seenCardKeys = new Set<string>();
  const cards: DiffItem[] = (data.cards ?? []).map((c) => {
    const catTag = (c.tags ?? []).find((t) => t.startsWith("cat:"))?.slice(4) ?? "";
    const deckName = snapshotDeckMap.get(c.deckId ?? "") ?? "";
    const key = `${normalizeText(catTag)}::${normalizeText(c.question)}`;
    const existingId = existingCardKeys.get(key);
    const internalDup = seenCardKeys.has(key);
    seenCardKeys.add(key);
    const isExists = !!existingId || internalDup;
    const label = `${deckName ? `[${deckName}] ` : ""}${catTag ? `(${catTag}) ` : ""}${c.question.slice(0, 60)}${c.question.length > 60 ? "…" : ""}`;
    return {
      type: "card",
      status: isExists ? "exists" : "new",
      label,
      snapshotId: c.id,
      currentId: existingId,
      categoryName: catTag || undefined,
      deckName: deckName || undefined,
      dedupKey: key,
    };
  });

  return { categories, decks, cards };
}
