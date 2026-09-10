/**
 * Utilities for selective backup and restore.
 * Builds a selection tree (Shas by seder/masechta/daf + decks + general),
 * extracts a partial StudyState from a selection, and merges it back in (LWW).
 */
import type { StudyState } from "./types";
import { SHAS_BAVLI, SEDARIM } from "./shasData";

// ── Tree node types ───────────────────────────────────────────────────────────

export interface DafNode {
  /** "daf:{masechta}:{daf}" */
  groupId: string;
  daf: number;
  cardIds: string[];
}

export interface MasechtaNode {
  masechta: string;
  dafim: DafNode[];
  totalCards: number;
}

export interface SederNode {
  seder: string;
  masechtot: MasechtaNode[];
  totalCards: number;
}

export interface DeckGroupNode {
  /** "deck:{deckId}" */
  groupId: string;
  deckId: string;
  deckName: string;
  cardIds: string[];
}

export interface SelectionTree {
  shasTree: SederNode[];       // Shas cards grouped by seder → masechta → daf
  deckNodes: DeckGroupNode[];  // non-Shas cards grouped by deck
  generalCardIds: string[];    // non-Shas, no deck
  totalCards: number;
}

// ── Extras (non-card data checkboxes) ────────────────────────────────────────

export interface ExtrasSelection {
  decks: boolean;
  goals: boolean;
  plans: boolean;      // generalPlans, planReviews, quiz plans and canonical practice results
  shasPlans: boolean;  // shasPlans, shasReviews, shasPlan
  settings: boolean;   // uiPrefs, tabConfig, sidebarConfig, widgetLayout, reviewIntervals
  categories: boolean;
}

// ── Build tree ────────────────────────────────────────────────────────────────

export function buildSelectionTree(state: StudyState): SelectionTree {
  const cards = state.cards ?? [];
  const decks = state.decks ?? [];
  const cardDecks = state.cardDecks ?? [];

  // card → deckIds map
  const cardToDeckIds: Record<string, string[]> = {};
  for (const link of cardDecks) {
    (cardToDeckIds[link.cardId] ??= []).push(link.deckId);
  }
  for (const card of cards) {
    if (card.deckId && !(cardToDeckIds[card.id] ?? []).includes(card.deckId)) {
      (cardToDeckIds[card.id] ??= []).push(card.deckId);
    }
  }

  // --- Shas tree ---
  const shasCardIds = new Set<string>();
  const shasMap: Record<string, Record<number, string[]>> = {};
  for (const card of cards) {
    if (card.masechta && card.daf) {
      shasCardIds.add(card.id);
      ((shasMap[card.masechta] ??= {})[card.daf] ??= []).push(card.id);
    }
  }

  const shasTree: SederNode[] = [];
  for (const seder of SEDARIM) {
    const masechtot: MasechtaNode[] = [];
    for (const m of SHAS_BAVLI.filter((x) => x.seder === seder)) {
      const dafMap = shasMap[m.name];
      if (!dafMap) continue;
      const dafim: DafNode[] = Object.keys(dafMap)
        .map(Number)
        .sort((a, b) => a - b)
        .map((daf) => ({ daf, cardIds: dafMap[daf], groupId: `daf:${m.name}:${daf}` }));
      masechtot.push({ masechta: m.name, dafim, totalCards: dafim.reduce((s, d) => s + d.cardIds.length, 0) });
    }
    const totalCards = masechtot.reduce((s, m) => s + m.totalCards, 0);
    if (totalCards > 0) shasTree.push({ seder, masechtot, totalCards });
  }

  // --- Deck nodes (non-Shas) ---
  const deckCardMap: Record<string, string[]> = {};
  const assignedToDecks = new Set<string>();
  for (const card of cards) {
    if (shasCardIds.has(card.id)) continue;
    for (const deckId of cardToDeckIds[card.id] ?? []) {
      (deckCardMap[deckId] ??= []).push(card.id);
      assignedToDecks.add(card.id);
    }
  }
  const deckNodes: DeckGroupNode[] = Object.entries(deckCardMap)
    .filter(([, ids]) => ids.length > 0)
    .map(([deckId, cardIds]) => {
      const deck = decks.find((d) => d.id === deckId);
      return { deckId, deckName: deck?.name ?? deckId.slice(0, 8), cardIds, groupId: `deck:${deckId}` };
    });

  const generalCardIds = cards
    .filter((c) => !shasCardIds.has(c.id) && !assignedToDecks.has(c.id))
    .map((c) => c.id);

  return { shasTree, deckNodes, generalCardIds, totalCards: cards.length };
}

// ── Default selection (everything selected) ───────────────────────────────────

export function makeDefaultGroups(tree: SelectionTree): Set<string> {
  const s = new Set<string>();
  for (const seder of tree.shasTree)
    for (const m of seder.masechtot)
      for (const d of m.dafim) s.add(d.groupId);
  for (const deck of tree.deckNodes) s.add(deck.groupId);
  if (tree.generalCardIds.length > 0) s.add("general");
  return s;
}

export function makeDefaultExtras(state: StudyState): ExtrasSelection {
  return {
    decks: (state.decks?.length ?? 0) > 0,
    goals: (state.goals?.length ?? 0) > 0,
    plans: (state.generalPlans?.length ?? 0) > 0 || (state.quizPlans?.length ?? 0) > 0 || (state.practiceResults?.length ?? 0) > 0,
    shasPlans: !!(state.shasPlan || (state.shasPlans?.length ?? 0) > 0),
    settings: true,
    categories: (state.categories?.length ?? 0) > 0,
  };
}

// ── Extract partial state based on selection ─────────────────────────────────

export function extractPartialState(
  state: StudyState,
  tree: SelectionTree,
  groups: Set<string>,
  extras: ExtrasSelection,
): Partial<StudyState> {
  const selectedCardIds = new Set<string>();
  for (const seder of tree.shasTree)
    for (const m of seder.masechtot)
      for (const d of m.dafim)
        if (groups.has(d.groupId)) d.cardIds.forEach((id) => selectedCardIds.add(id));
  for (const deck of tree.deckNodes)
    if (groups.has(deck.groupId)) deck.cardIds.forEach((id) => selectedCardIds.add(id));
  if (groups.has("general")) tree.generalCardIds.forEach((id) => selectedCardIds.add(id));

  const partial: Partial<StudyState> = {
    cards: (state.cards ?? []).filter((c) => selectedCardIds.has(c.id)),
    logs: (state.logs ?? []).filter((l) => selectedCardIds.has(l.cardId)),
    cardDecks: (state.cardDecks ?? []).filter((l) => selectedCardIds.has(l.cardId)),
  };

  if (extras.decks) partial.decks = state.decks ?? [];
  if (extras.goals) partial.goals = state.goals ?? [];
  if (extras.plans) {
    partial.generalPlans = state.generalPlans ?? [];
    partial.planReviews = state.planReviews ?? [];
    partial.quizPlans = state.quizPlans ?? [];
    partial.quizAttempts = state.quizAttempts ?? [];
    partial.practiceResults = state.practiceResults ?? [];
  }
  if (extras.shasPlans) {
    partial.shasPlan = state.shasPlan;
    partial.shasPlans = state.shasPlans ?? [];
    partial.shasReviews = state.shasReviews ?? [];
  }
  if (extras.settings) {
    partial.uiPrefs = state.uiPrefs;
    partial.tabConfig = state.tabConfig;
    partial.sidebarConfig = state.sidebarConfig;
    partial.widgetLayout = state.widgetLayout;
    partial.reviewIntervals = state.reviewIntervals;
    partial.planReviewIntervals = state.planReviewIntervals;
  }
  if (extras.categories) partial.categories = state.categories ?? [];

  return partial;
}

// ── Merge partial backup into current state (LWW) ────────────────────────────

export function mergePartialIntoState(current: StudyState, partial: Partial<StudyState>): StudyState {
  const result: StudyState = { ...current };

  if (partial.cards) {
    const byId = new Map((current.cards ?? []).map((c) => [c.id, c]));
    for (const bc of partial.cards) {
      const existing = byId.get(bc.id);
      byId.set(bc.id, !existing || (bc.updatedAt ?? 0) >= (existing.updatedAt ?? 0) ? bc : existing);
    }
    result.cards = [...byId.values()];
  }

  if (partial.logs) {
    const existingIds = new Set((current.logs ?? []).map((l) => l.id));
    result.logs = [...(current.logs ?? []), ...partial.logs.filter((l) => !existingIds.has(l.id))];
  }

  if (partial.cardDecks) {
    const existingLinks = new Set((current.cardDecks ?? []).map((l) => `${l.cardId}:${l.deckId}`));
    result.cardDecks = [
      ...(current.cardDecks ?? []),
      ...partial.cardDecks.filter((l) => !existingLinks.has(`${l.cardId}:${l.deckId}`)),
    ];
  }

  if (partial.decks) {
    const byId = new Map((current.decks ?? []).map((d) => [d.id, d]));
    for (const bd of partial.decks) {
      const existing = byId.get(bd.id);
      byId.set(bd.id, !existing || (bd.updatedAt ?? 0) >= (existing.updatedAt ?? 0) ? bd : existing);
    }
    result.decks = [...byId.values()];
  }

  if (partial.categories) {
    const byId = new Map((current.categories ?? []).map((c) => [c.id, c]));
    for (const bc of partial.categories) {
      const existing = byId.get(bc.id);
      byId.set(bc.id, !existing || (bc.updatedAt ?? 0) >= (existing.updatedAt ?? 0) ? bc : existing);
    }
    result.categories = [...byId.values()];
  }

  if (partial.goals !== undefined) result.goals = partial.goals;
  if (partial.generalPlans !== undefined) result.generalPlans = partial.generalPlans;
  if (partial.planReviews !== undefined) result.planReviews = partial.planReviews;
  if (partial.quizPlans !== undefined) result.quizPlans = partial.quizPlans;
  if (partial.quizAttempts !== undefined) result.quizAttempts = partial.quizAttempts;
  if (partial.practiceResults !== undefined) result.practiceResults = partial.practiceResults;
  if (partial.shasPlan !== undefined) result.shasPlan = partial.shasPlan;
  if (partial.shasPlans !== undefined) result.shasPlans = partial.shasPlans;
  if (partial.shasReviews !== undefined) result.shasReviews = partial.shasReviews;
  if (partial.uiPrefs !== undefined) result.uiPrefs = partial.uiPrefs;
  if (partial.tabConfig !== undefined) result.tabConfig = partial.tabConfig;
  if (partial.sidebarConfig !== undefined) result.sidebarConfig = partial.sidebarConfig;
  if (partial.widgetLayout !== undefined) result.widgetLayout = partial.widgetLayout;
  if (partial.reviewIntervals !== undefined) result.reviewIntervals = partial.reviewIntervals;
  if (partial.planReviewIntervals !== undefined) result.planReviewIntervals = partial.planReviewIntervals;

  return result;
}
