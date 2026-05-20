/**
 * Dedupe categories by (parent_id, name) across the whole tree.
 *
 * Strategy per pass:
 * 1) Find duplicate sibling groups (same parent_id + name, count > 1)
 * 2) Keep one node (oldest/newest), map other IDs -> keep ID
 * 3) Reparent children of dropped IDs to keep IDs
 * 4) Remap deck.category_ids from dropped IDs to keep IDs
 * 5) Delete dropped IDs
 *
 * Repeats until no duplicate sibling groups remain.
 *
 * Usage:
 *   node scripts/dedupe-categories-by-parent-name.mjs
 *   node scripts/dedupe-categories-by-parent-name.mjs --execute
 *   node scripts/dedupe-categories-by-parent-name.mjs --execute --keep oldest --max-passes 20
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htsuoqvafayyffyxjhhh.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ';
const ADMIN_EMAIL = 'jj1212t@gmail.com';
const ADMIN_PASSWORD = '543211';

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const keepArg = args.includes('--keep') ? args[args.indexOf('--keep') + 1] : undefined;
const keepMode = keepArg === 'newest' ? 'newest' : 'oldest';
const maxPassesArg = args.includes('--max-passes') ? Number(args[args.indexOf('--max-passes') + 1]) : 20;
const maxPasses = Number.isFinite(maxPassesArg) && maxPassesArg > 0 ? Math.floor(maxPassesArg) : 20;

const sb = createClient(SUPABASE_URL, ANON_KEY);

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const dedupe = (arr) => Array.from(new Set(arr));

const sortByKeepPolicy = (a, b) => {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  return keepMode === 'oldest' ? ta - tb : tb - ta;
};

async function fetchAllPages(queryFactory, pageSize = 1000) {
  const rows = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function loadCategories() {
  return fetchAllPages(() =>
    sb.from('categories').select('id, name, parent_id, created_at').order('created_at')
  );
}

function analyzeDuplicateGroups(categories) {
  const grouped = new Map();
  for (const c of categories) {
    const key = `${c.parent_id ?? 'NULL'}\u0000${c.name}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(c);
  }

  const duplicateGroups = [];
  for (const [key, arr] of grouped.entries()) {
    if (arr.length <= 1) continue;
    const split = key.indexOf('\u0000');
    const parentIdRaw = key.slice(0, split);
    const name = key.slice(split + 1);
    const parentId = parentIdRaw === 'NULL' ? null : parentIdRaw;

    const sorted = [...arr].sort(sortByKeepPolicy);
    const keep = sorted[0];
    const drops = sorted.slice(1);

    duplicateGroups.push({
      parentId,
      name,
      keep,
      drops,
      count: arr.length,
      extra: arr.length - 1,
    });
  }

  duplicateGroups.sort((a, b) => b.count - a.count);
  const totalExtra = duplicateGroups.reduce((s, g) => s + g.extra, 0);

  return { duplicateGroups, totalExtra };
}

await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
console.log(`[auth] Logged in. mode=${execute ? 'EXECUTE' : 'DRY-RUN'}, keep=${keepMode}`);

if (!execute) {
  const categories = await loadCategories();
  const { duplicateGroups, totalExtra } = analyzeDuplicateGroups(categories);

  console.log(`[dry-run] categories=${categories.length}`);
  console.log(`[dry-run] duplicateGroups=${duplicateGroups.length}, extraRows=${totalExtra}`);
  for (const g of duplicateGroups.slice(0, 30)) {
    console.log(
      `[dry-run] x${g.count} name="${g.name}" parent=${g.parentId ?? 'NULL'} keep=${g.keep.id} drop=${g.drops.length}`
    );
  }
  console.log('[dry-run] No changes applied.');
  process.exit(0);
}

let pass = 0;
let totalDeleted = 0;
let totalDeckUpdates = 0;
let totalParentMoves = 0;

for (pass = 1; pass <= maxPasses; pass += 1) {
  const categories = await loadCategories();
  const { duplicateGroups, totalExtra } = analyzeDuplicateGroups(categories);

  if (duplicateGroups.length === 0) {
    console.log(`[pass ${pass}] no duplicates found; stopping.`);
    break;
  }

  const dropToKeep = new Map();
  for (const g of duplicateGroups) {
    for (const d of g.drops) dropToKeep.set(d.id, g.keep.id);
  }

  const dropIds = Array.from(dropToKeep.keys());

  console.log(
    `[pass ${pass}] categories=${categories.length}, duplicateGroups=${duplicateGroups.length}, ` +
      `toDelete=${dropIds.length}, extraRows=${totalExtra}`
  );

  // 1) Remap deck.category_ids
  const { data: decks, error: deckErr } = await sb.from('decks').select('id, name, category_ids');
  if (deckErr) throw deckErr;

  const deckUpdates = [];
  for (const d of decks ?? []) {
    const arr = Array.isArray(d.category_ids) ? d.category_ids : [];
    if (arr.length === 0) continue;
    let changed = false;
    const remapped = arr.map((id) => {
      if (dropToKeep.has(id)) {
        changed = true;
        return dropToKeep.get(id);
      }
      return id;
    });
    if (!changed) continue;
    deckUpdates.push({ id: d.id, category_ids: dedupe(remapped) });
  }

  for (const du of deckUpdates) {
    const { error } = await sb.from('decks').update({ category_ids: du.category_ids }).eq('id', du.id);
    if (error) throw new Error(`[decks.update] ${du.id}: ${error.message}`);
  }

  totalDeckUpdates += deckUpdates.length;

  // 2) Reparent children from dropped parent IDs to kept parent IDs
  let movedThisPass = 0;
  for (let i = 0; i < dropIds.length; i += 1) {
    const dropId = dropIds[i];
    const keepId = dropToKeep.get(dropId);
    const { error, count } = await sb
      .from('categories')
      .update({ parent_id: keepId }, { count: 'exact' })
      .eq('parent_id', dropId);
    if (error) throw new Error(`[categories.reparent] ${dropId} -> ${keepId}: ${error.message}`);
    movedThisPass += count ?? 0;

    if ((i + 1) % 500 === 0 || i + 1 === dropIds.length) {
      console.log(`[pass ${pass}] reparent progress ${i + 1}/${dropIds.length}`);
    }
  }
  totalParentMoves += movedThisPass;

  // 3) Delete dropped IDs
  const deleteBatches = chunk(dropIds, 500);
  let deletedThisPass = 0;
  for (let i = 0; i < deleteBatches.length; i += 1) {
    const batch = deleteBatches[i];
    const { error } = await sb.from('categories').delete().in('id', batch);
    if (error) throw new Error(`[categories.delete] pass=${pass} batch=${i + 1}: ${error.message}`);
    deletedThisPass += batch.length;

    if ((i + 1) % 20 === 0 || i + 1 === deleteBatches.length) {
      console.log(`[pass ${pass}] delete progress ${deletedThisPass}/${dropIds.length}`);
    }
  }

  totalDeleted += deletedThisPass;

  console.log(
    `[pass ${pass}] done. deleted=${deletedThisPass}, movedChildren=${movedThisPass}, deckUpdates=${deckUpdates.length}`
  );
}

const finalCategories = await loadCategories();
const finalAnalysis = analyzeDuplicateGroups(finalCategories);

console.log('--- SUMMARY ---');
console.log(`passesRun=${Math.min(pass, maxPasses)}`);
console.log(`totalDeleted=${totalDeleted}`);
console.log(`totalParentMoves=${totalParentMoves}`);
console.log(`totalDeckUpdates=${totalDeckUpdates}`);
console.log(`finalCategoryCount=${finalCategories.length}`);
console.log(`remainingDuplicateGroups=${finalAnalysis.duplicateGroups.length}`);
console.log(`remainingExtraRows=${finalAnalysis.totalExtra}`);
