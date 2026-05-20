/**
 * Cleanup duplicate category roots safely.
 *
 * What it does:
 * 1) Detects duplicate root names (same name, parent_id = null).
 * 2) Keeps one root per name (oldest/newest policy).
 * 3) Re-maps deck.category_ids from deleted IDs to kept IDs by relative path.
 * 4) Deletes duplicate subtrees leaf-first to avoid FK errors.
 *
 * Usage:
 *   node scripts/cleanup-duplicate-category-roots.mjs
 *   node scripts/cleanup-duplicate-category-roots.mjs --execute
 *   node scripts/cleanup-duplicate-category-roots.mjs --execute --keep newest
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htsuoqvafayyffyxjhhh.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ';
const ADMIN_EMAIL = 'jj1212t@gmail.com';
const ADMIN_PASSWORD = '543211';

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const keepModeArg = args.includes('--keep') ? args[args.indexOf('--keep') + 1] : undefined;
const keepMode = keepModeArg === 'newest' ? 'newest' : 'oldest';

const sb = createClient(SUPABASE_URL, ANON_KEY);

const toIso = (v) => (v ? new Date(v).toISOString() : '');

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dedupe(arr) {
  return Array.from(new Set(arr));
}

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

await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
console.log('[auth] Logged in');

const categories = await fetchAllPages(() =>
  sb.from('categories').select('id, name, parent_id, created_at').order('created_at')
);

const { data: decks, error: deckErr } = await sb
  .from('decks')
  .select('id, name, category_ids');
if (deckErr) throw deckErr;

const byId = new Map(categories.map((c) => [c.id, c]));
const children = new Map();
for (const c of categories) {
  const pid = c.parent_id ?? '__ROOT__';
  if (!children.has(pid)) children.set(pid, []);
  children.get(pid).push(c.id);
}

const roots = categories.filter((c) => c.parent_id == null);
const rootGroups = groupBy(roots, (r) => r.name);
const duplicateGroups = Array.from(rootGroups.entries()).filter(([, arr]) => arr.length > 1);

console.log(`[scan] categories=${categories.length}, roots=${roots.length}, duplicateRootNames=${duplicateGroups.length}`);
if (duplicateGroups.length === 0) {
  console.log('[done] No duplicate root names found.');
  process.exit(0);
}

const subtreeIds = (rootId) => {
  const out = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    out.push(id);
    const kids = children.get(id) ?? [];
    for (const k of kids) stack.push(k);
  }
  return out;
};

const relPath = (id, rootId) => {
  if (id === rootId) return '';
  const parts = [];
  let cur = byId.get(id);
  while (cur && cur.id !== rootId) {
    parts.push(cur.name);
    if (!cur.parent_id) break;
    cur = byId.get(cur.parent_id);
  }
  return parts.reverse().join(' > ');
};

const policySort = (a, b) => {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  return keepMode === 'oldest' ? ta - tb : tb - ta;
};

const deleteIds = new Set();
const deleteToKeep = new Map();

for (const [name, group] of duplicateGroups) {
  const sorted = [...group].sort(policySort);
  const keep = sorted[0];
  const drops = sorted.slice(1);

  const keepSubtree = subtreeIds(keep.id);
  const keepPathMap = new Map();
  for (const id of keepSubtree) {
    keepPathMap.set(relPath(id, keep.id), id);
  }

  let totalDropNodes = 0;
  for (const dropRoot of drops) {
    const dropSubtree = subtreeIds(dropRoot.id);
    totalDropNodes += dropSubtree.length;
    for (const id of dropSubtree) {
      deleteIds.add(id);
      const p = relPath(id, dropRoot.id);
      const mapped = keepPathMap.get(p) ?? keep.id;
      deleteToKeep.set(id, mapped);
    }
  }

  console.log(
    `[plan] "${name}" keep=${keep.id} (${toIso(keep.created_at)}), ` +
      `dropRoots=${drops.length}, dropNodes=${totalDropNodes}`
  );
}

const deckUpdates = [];
for (const d of decks ?? []) {
  const arr = Array.isArray(d.category_ids) ? d.category_ids : [];
  if (arr.length === 0) continue;
  let changed = false;
  const mapped = arr.map((id) => {
    if (deleteIds.has(id)) {
      changed = true;
      return deleteToKeep.get(id) ?? id;
    }
    return id;
  });
  const cleaned = dedupe(mapped.filter((id) => !deleteIds.has(id) && byId.has(id)));
  if (changed) {
    deckUpdates.push({ id: d.id, name: d.name, category_ids: cleaned });
  }
}

console.log(`[plan] IDs to delete: ${deleteIds.size}`);
console.log(`[plan] Decks to remap: ${deckUpdates.length}`);

if (!execute) {
  console.log('[dry-run] No changes were applied. Run with --execute to apply.');
  process.exit(0);
}

// Apply deck remaps first.
for (const du of deckUpdates) {
  const { error } = await sb.from('decks').update({ category_ids: du.category_ids }).eq('id', du.id);
  if (error) {
    throw new Error(`[decks.update] ${du.id}: ${error.message}`);
  }
}
console.log(`[apply] Deck remaps applied: ${deckUpdates.length}`);

// Build leaf-first deletion order inside the delete-set.
const parentById = new Map(categories.map((c) => [c.id, c.parent_id]));
const childCount = new Map();
for (const id of deleteIds) childCount.set(id, 0);
for (const id of deleteIds) {
  const kids = children.get(id) ?? [];
  let count = 0;
  for (const k of kids) {
    if (deleteIds.has(k)) count += 1;
  }
  childCount.set(id, count);
}

const queue = [];
for (const [id, cnt] of childCount.entries()) {
  if (cnt === 0) queue.push(id);
}

const order = [];
while (queue.length) {
  const id = queue.pop();
  order.push(id);
  const p = parentById.get(id);
  if (p && deleteIds.has(p)) {
    const next = (childCount.get(p) ?? 0) - 1;
    childCount.set(p, next);
    if (next === 0) queue.push(p);
  }
}

if (order.length !== deleteIds.size) {
  throw new Error(`[delete-order] expected ${deleteIds.size}, got ${order.length}`);
}

let deleted = 0;
const batches = chunk(order, 200);
for (let i = 0; i < batches.length; i += 1) {
  const b = batches[i];
  const { error } = await sb.from('categories').delete().in('id', b);
  if (error) {
    throw new Error(`[categories.delete] batch ${i + 1}/${batches.length}: ${error.message}`);
  }
  deleted += b.length;
  if ((i + 1) % 10 === 0 || i === batches.length - 1) {
    console.log(`[apply] Deleted ${deleted}/${order.length}`);
  }
}

const { count: finalCount, error: finalErr } = await sb
  .from('categories')
  .select('*', { count: 'exact', head: true });
if (finalErr) throw finalErr;

console.log(`[done] Deleted ${deleted} categories. Remaining: ${finalCount}`);
