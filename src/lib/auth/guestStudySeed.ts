import { supabase } from "@/integrations/supabase/client";
import { hasUsableGuestCategoryTree, isGuestStudySeedStructurallyUsable, type GuestStudySeed } from "@/lib/auth/guestViewProfile";
import { defaultSrs } from "@/lib/study/srs";
import type { Card, CardDeckLink, Category, Deck, StudyState } from "@/lib/study/types";

type CategoryRow = { id: string; name: string; parent_id: string | null; color: string | null; created_at: string; updated_at: string | null; sort_order: number | null };
type DeckRow = { id: string; name: string; description: string | null; color: string; created_at: string; updated_at: string | null; category_ids: unknown; include_sub_categories: boolean };
type CardRow = { id: string; deck_id: string | null; type: string; question: string; tags: unknown; created_at: string; updated_at: string | null; srs: unknown; stats: unknown; answer: string | null; options: unknown; correct_indices: unknown; correct_boolean: boolean | null; explanation: string | null; masechta: string | null; daf: number | null; amud: number | null };
type CardDeckRow = { card_id: string; deck_id: string; sort_order: number | null; updated_at: string | null };

const PAGE_SIZE = 1000;
const MAX_ROWS = 50_000;

async function fetchAllPages<T>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await queryPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message ?? `Failed loading ${label}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  throw new Error(`Seed fetch exceeded safety limit for ${label} (${MAX_ROWS} rows)`);
}

/** Single source of truth for building the guest/offline study snapshot. */
export async function buildGuestStudySeed(studyState: StudyState): Promise<GuestStudySeed | undefined> {
  const hasLocalData = studyState.categories.length > 0 || studyState.decks.length > 0
    || studyState.cards.length > 0 || studyState.cardDecks.length > 0;
  if (hasLocalData && hasUsableGuestCategoryTree(studyState.categories)) {
    return {
      seededAt: Date.now(), categories: [...studyState.categories], decks: [...studyState.decks],
      cards: [...studyState.cards], cardDecks: [...studyState.cardDecks],
      deckCategories: { ...studyState.deckCategories },
    };
  }

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return undefined;

  const [categoryRows, deckRows, cardRows, cardDeckRows] = await Promise.all([
    fetchAllPages<CategoryRow>((from, to) => supabase.from("categories")
      .select("id,name,parent_id,color,created_at,updated_at,sort_order").eq("user_id", userId).is("deleted_at", null)
      .order("sort_order", { ascending: true }).order("id", { ascending: true }).range(from, to), "categories"),
    fetchAllPages<DeckRow>((from, to) => supabase.from("decks")
      .select("id,name,description,color,created_at,updated_at,category_ids,include_sub_categories").eq("user_id", userId).is("deleted_at", null)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to), "decks"),
    fetchAllPages<CardRow>((from, to) => supabase.from("cards")
      .select("id,deck_id,type,question,tags,created_at,updated_at,srs,stats,answer,options,correct_indices,correct_boolean,explanation,masechta,daf,amud")
      .eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to), "cards"),
    fetchAllPages<CardDeckRow>((from, to) => supabase.from("card_decks")
      .select("card_id,deck_id,sort_order,updated_at").eq("user_id", userId)
      .order("card_id", { ascending: true }).order("deck_id", { ascending: true }).range(from, to), "card_decks"),
  ]);

  const categories: Category[] = categoryRows.map((row) => ({
    id: row.id, name: row.name, parentId: row.parent_id, color: row.color ?? undefined,
    createdAt: new Date(row.created_at).getTime(), updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
    sortOrder: row.sort_order ?? 0,
  }));
  const decks: Deck[] = deckRows.map((row) => ({
    id: row.id, name: row.name, description: row.description ?? undefined, color: row.color,
    createdAt: new Date(row.created_at).getTime(), updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
    categoryIds: Array.isArray(row.category_ids) ? row.category_ids.filter((value): value is string => typeof value === "string") : [],
    includeSubCategories: row.include_sub_categories !== false,
  }));
  const cards: Card[] = cardRows.map((row) => {
    const base = {
      id: row.id, deckId: row.deck_id, question: row.question,
      tags: Array.isArray(row.tags) ? row.tags.filter((value): value is string => typeof value === "string") : [],
      createdAt: new Date(row.created_at).getTime(), updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
      srs: row.srs && typeof row.srs === "object" ? row.srs as Card["srs"] : defaultSrs(),
      stats: row.stats && typeof row.stats === "object" ? row.stats as Card["stats"] : { totalReviews: 0, correct: 0, incorrect: 0 },
      masechta: row.masechta ?? null, daf: row.daf ?? null,
      amud: row.amud === 2 ? 2 as const : (row.amud === 1 ? 1 as const : null),
    };
    if (row.type === "flashcard") return { ...base, type: "flashcard", answer: row.answer ?? "" } as Card;
    if (row.type === "boolean") return { ...base, type: "boolean", correct: !!row.correct_boolean, explanation: row.explanation ?? undefined } as Card;
    const options = Array.isArray(row.options) ? row.options.filter((value): value is string => typeof value === "string") : [];
    const correctIndices = Array.isArray(row.correct_indices) ? row.correct_indices.filter((value): value is number => typeof value === "number") : [];
    return { ...base, type: "combo", answer: row.answer ?? (correctIndices.length ? options[correctIndices[0]] : undefined),
      options: options.length ? options : undefined, correctIndices: correctIndices.length ? correctIndices : undefined,
      explanation: row.explanation ?? undefined } as Card;
  });
  const cardDecks: CardDeckLink[] = cardDeckRows.map((row) => ({
    cardId: row.card_id, deckId: row.deck_id, sortOrder: row.sort_order ?? 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
  }));
  const seed: GuestStudySeed = { seededAt: Date.now(), categories, decks, cards, cardDecks,
    deckCategories: Object.fromEntries(decks.map((deck) => [deck.id, deck.categoryIds])) };
  if (!isGuestStudySeedStructurallyUsable(seed)) throw new Error("Guest seed snapshot is structurally invalid");
  return seed;
}
