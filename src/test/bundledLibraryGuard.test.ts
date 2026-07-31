import { describe, it, expect } from "vitest";

/**
 * Protected deletion of the bundled offline library.
 *
 * Local/offline workspaces have no cloud copy, so deleting shipped content is
 * unrecoverable — only a reinstall brings it back. These tests lock in the rule
 * that base content is protected while user-created content stays deletable,
 * and that the guard FAILS OPEN (never blocks) if the id sets are unavailable.
 */

type Kind = "card" | "deck" | "category";
type Sets = { cards: Set<string>; decks: Set<string>; categories: Set<string> };

function makeGuard(cached: Sets | null) {
  const isBundled = (kind: Kind, id: string): boolean => {
    if (!id || !cached) return false;
    if (kind === "card") return cached.cards.has(id);
    if (kind === "deck") return cached.decks.has(id);
    return cached.categories.has(id);
  };
  const partition = (kind: Kind, ids: string[]) => {
    const deletable: string[] = [];
    const protectedIds: string[] = [];
    for (const id of ids) {
      if (isBundled(kind, id)) protectedIds.push(id);
      else deletable.push(id);
    }
    return { deletable, protectedIds };
  };
  return { isBundled, partition };
}

const SETS: Sets = {
  cards: new Set(["seed-card-1", "seed-card-2"]),
  decks: new Set(["seed-deck-1"]),
  categories: new Set(["seed-cat-1"]),
};

describe("bundled library delete guard", () => {
  const { isBundled, partition } = makeGuard(SETS);

  it("protects questions that shipped with the app", () => {
    expect(isBundled("card", "seed-card-1")).toBe(true);
    expect(isBundled("card", "seed-card-2")).toBe(true);
  });

  it("allows deleting questions the user created", () => {
    expect(isBundled("card", "user-made-123")).toBe(false);
  });

  it("protects shipped decks and categories", () => {
    expect(isBundled("deck", "seed-deck-1")).toBe(true);
    expect(isBundled("category", "seed-cat-1")).toBe(true);
  });

  it("does not confuse ids across kinds", () => {
    // A card id must not protect a deck with the same id.
    expect(isBundled("deck", "seed-card-1")).toBe(false);
    expect(isBundled("category", "seed-deck-1")).toBe(false);
  });

  it("splits a mixed selection into deletable and protected", () => {
    const { deletable, protectedIds } = partition("card", [
      "user-a", "seed-card-1", "user-b", "seed-card-2",
    ]);
    expect(deletable).toEqual(["user-a", "user-b"]);
    expect(protectedIds).toEqual(["seed-card-1", "seed-card-2"]);
  });

  it("fails OPEN when the library ids are unavailable", () => {
    // A load failure must never lock users out of their own content.
    const cold = makeGuard(null);
    expect(cold.isBundled("card", "seed-card-1")).toBe(false);
    expect(cold.partition("card", ["seed-card-1", "user-a"]).deletable)
      .toEqual(["seed-card-1", "user-a"]);
  });

  it("treats an empty id as not protected", () => {
    expect(isBundled("card", "")).toBe(false);
  });
});
