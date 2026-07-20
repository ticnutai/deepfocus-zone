import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const envText = await readFile(path.join(root, ".env"), "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^"|"$/g, "")];
    }),
);

const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !anonKey) throw new Error("Missing Supabase URL or publishable key");

async function rpc(name, body = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${name} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

const defaultSrs = () => ({
  ease: 2.5,
  interval: 0,
  repetitions: 0,
  dueAt: Date.now(),
  lastReviewedAt: null,
});

function normalizeCard(row) {
  const rawStats = row.stats && typeof row.stats === "object" ? row.stats : null;
  const stats = rawStats
    ? {
        totalReviews: rawStats.totalReviews ?? 0,
        correct: rawStats.correct ?? 0,
        incorrect: rawStats.incorrect ?? 0,
      }
    : { totalReviews: 0, correct: 0, incorrect: 0 };
  const base = {
    id: row.id,
    deckId: row.deck_id ?? null,
    question: row.question,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === "string") : [],
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : new Date(row.created_at).getTime(),
    srs: row.srs && typeof row.srs === "object" ? row.srs : defaultSrs(),
    stats,
    masechta: row.masechta ?? null,
    daf: row.daf ?? null,
    amud: row.amud === 1 || row.amud === 2 ? row.amud : null,
    ...(Array.isArray(rawStats?.editHistory) ? { editHistory: rawStats.editHistory } : {}),
  };
  if (row.type === "flashcard") return { ...base, type: "flashcard", answer: row.answer ?? "" };
  if (row.type === "boolean") {
    return { ...base, type: "boolean", correct: !!row.correct_boolean, explanation: row.explanation ?? undefined };
  }
  const options = Array.isArray(row.options) ? row.options : [];
  const correctIndices = Array.isArray(row.correct_indices) ? row.correct_indices : [];
  const answer = row.answer ?? (correctIndices.length ? options[correctIndices[0]] : undefined);
  return {
    ...base,
    type: "combo",
    answer,
    options,
    correctIndices,
    explanation: row.explanation ?? undefined,
  };
}

process.stdout.write("Loading the shared offline-library snapshot...\n");
const snapshot = await rpc("get_guest_bootstrap_snapshot_for");
if (!snapshot || typeof snapshot !== "object") throw new Error("No shared source is configured");

const sourceUserId = typeof snapshot.source_user_id === "string" ? snapshot.source_user_id : null;
const pageSize = 3000;
const cardRows = Array.isArray(snapshot.cards) ? [...snapshot.cards] : [];
for (let offset = 0; ; offset += pageSize) {
  const page = await rpc("get_guest_unreviewed_cards_page_for", {
    p_source_user_id: sourceUserId,
    p_offset: offset,
    p_limit: pageSize,
  });
  if (!Array.isArray(page) || page.length === 0) break;
  cardRows.push(...page);
  process.stdout.write(`Loaded ${cardRows.length} card rows\r`);
  if (page.length < pageSize) break;
}
process.stdout.write("\n");

const cardById = new Map();
for (const row of cardRows) {
  if (!row?.id || row.deleted_at) continue;
  cardById.set(row.id, normalizeCard(row));
}

const categories = (Array.isArray(snapshot.categories_roots) ? snapshot.categories_roots : [])
  .filter((row) => row?.id && !row.deleted_at)
  .map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? null,
    color: row.color ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : new Date(row.created_at).getTime(),
    sortOrder: row.sort_order ?? 0,
  }));

const decks = (Array.isArray(snapshot.decks) ? snapshot.decks : [])
  .filter((row) => row?.id && !row.deleted_at)
  .map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    color: row.color,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : new Date(row.created_at).getTime(),
    categoryIds: Array.isArray(row.category_ids) ? row.category_ids : [],
    includeSubCategories: row.include_sub_categories !== false,
  }));

const cardIds = new Set(cardById.keys());
const deckIds = new Set(decks.map((deck) => deck.id));
const cardDecks = (Array.isArray(snapshot.card_decks) ? snapshot.card_decks : [])
  .filter((row) => cardIds.has(row.card_id) && deckIds.has(row.deck_id))
  .map((row) => ({
    cardId: row.card_id,
    deckId: row.deck_id,
    sortOrder: row.sort_order ?? 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
  }));

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceUserId,
  seed: {
    seededAt: Date.now(),
    categories,
    decks,
    cards: [...cardById.values()],
    cardDecks,
    deckCategories: Object.fromEntries(decks.map((deck) => [deck.id, deck.categoryIds])),
  },
};

const outputDir = path.join(root, "src", "lib", "study");
await mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "offlineLibrary.generated.json");
await writeFile(outputPath, JSON.stringify(output), "utf8");
const sizeMb = Buffer.byteLength(JSON.stringify(output)) / 1024 / 1024;
process.stdout.write(
  `Offline library generated: ${categories.length} categories, ${decks.length} decks, ${cardById.size} cards (${sizeMb.toFixed(1)} MB)\n`,
);
