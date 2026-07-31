/**
 * Protects the bundled offline study library from deletion.
 *
 * Local/offline accounts own their workspace and may delete freely — but the
 * ~22k-question library that ships inside the app is shared, read-only content.
 * Deleting it locally is silent data loss: there is no cloud copy to restore
 * from, so the only way back is a reinstall.
 *
 * The bundled seed is the source of truth for "what shipped with the app", so
 * any id present in it is treated as base content. Everything the user creates
 * afterwards gets a fresh id and stays fully deletable.
 */
import { loadBundledOfflineLibrary } from "./offlineLibrary";

export type ProtectedKind = "card" | "deck" | "category";

interface BundledIdSets {
  cards: Set<string>;
  decks: Set<string>;
  categories: Set<string>;
}

let idsPromise: Promise<BundledIdSets> | null = null;
// Populated once the async load resolves so the hot delete path stays sync.
let cachedIds: BundledIdSets | null = null;

const EMPTY: BundledIdSets = { cards: new Set(), decks: new Set(), categories: new Set() };

/**
 * Loads (once) the id sets of everything that shipped with the app. Safe to
 * call repeatedly; the underlying JSON import is itself memoised.
 */
export function loadBundledLibraryIds(): Promise<BundledIdSets> {
  if (!idsPromise) {
    idsPromise = loadBundledOfflineLibrary()
      .then((info) => {
        const seed = info?.seed;
        const sets: BundledIdSets = {
          cards: new Set((seed?.cards ?? []).map((c) => c.id).filter(Boolean)),
          decks: new Set((seed?.decks ?? []).map((d) => d.id).filter(Boolean)),
          categories: new Set((seed?.categories ?? []).map((c) => c.id).filter(Boolean)),
        };
        cachedIds = sets;
        return sets;
      })
      .catch(() => {
        // Never let a load failure block deletion — fail open rather than
        // locking the user out of their own content.
        cachedIds = EMPTY;
        return EMPTY;
      });
  }
  return idsPromise;
}

/** Warms the cache so `isBundledLibraryItem` can answer synchronously. */
export function primeBundledLibraryGuard(): void {
  void loadBundledLibraryIds();
}

/**
 * Whether the id belongs to the shipped library. Answers from cache; returns
 * false until the cache is warm (fail-open — a missed guard is recoverable,
 * a false positive would wrongly block the user's own content).
 */
export function isBundledLibraryItem(kind: ProtectedKind, id: string): boolean {
  if (!id || !cachedIds) return false;
  if (kind === "card") return cachedIds.cards.has(id);
  if (kind === "deck") return cachedIds.decks.has(id);
  return cachedIds.categories.has(id);
}

/** Splits ids into deletable (user-created) and protected (shipped) buckets. */
export function partitionDeletableIds(
  kind: ProtectedKind,
  ids: string[],
): { deletable: string[]; protectedIds: string[] } {
  const deletable: string[] = [];
  const protectedIds: string[] = [];
  for (const id of ids) {
    if (isBundledLibraryItem(kind, id)) protectedIds.push(id);
    else deletable.push(id);
  }
  return { deletable, protectedIds };
}

export const PROTECTED_DELETE_MESSAGE = {
  title: "פריט מהספרייה המובנית",
  description:
    "אי אפשר למחוק תוכן שהגיע עם האפליקציה — רק תוכן שהוספת בעצמך. אפשר להסתיר אותו במקום.",
} as const;
