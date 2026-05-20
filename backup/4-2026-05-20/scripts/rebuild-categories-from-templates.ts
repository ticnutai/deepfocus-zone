import { createClient } from '@supabase/supabase-js';
import { CATEGORY_TEMPLATES } from '../src/lib/study/categoryTemplates.ts';

type TemplateNode = {
  name: string;
  children?: TemplateNode[];
};

type CategoryInsertRow = {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
};

const SUPABASE_URL = 'https://htsuoqvafayyffyxjhhh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jj1212t@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '543211';

const args = process.argv.slice(2);
const execute = args.includes('--execute');

const templateArgIndex = args.indexOf('--templates');
const templateIds = templateArgIndex >= 0 && args[templateArgIndex + 1]
  ? args[templateArgIndex + 1].split(',').map((s) => s.trim()).filter(Boolean)
  : CATEGORY_TEMPLATES.map((t) => t.id);

const userArgIndex = args.indexOf('--user');
const userOverride = userArgIndex >= 0 ? args[userArgIndex + 1] : undefined;

const batchSize = 500;
const deleteBatchSize = 40;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function fetchAllCategoriesForUser<T>(
  sb: ReturnType<typeof createClient>,
  userId: string,
  columns: string,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await sb
      .from('categories')
      .select(columns)
      .eq('user_id', userId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`[fetch categories page] ${error.message}`);
    const page = (data as T[] | null) ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function buildLeafFirstDeleteOrder(rows: Array<{ id: string; parent_id: string | null }>): string[] {
  const byParent = new Map<string, string[]>();
  const parentById = new Map<string, string | null>();

  for (const r of rows) {
    parentById.set(r.id, r.parent_id);
    const k = r.parent_id ?? 'NULL';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(r.id);
  }

  const ids = new Set(rows.map((r) => r.id));
  const childCount = new Map<string, number>();
  for (const id of ids) {
    const kids = byParent.get(id) ?? [];
    let count = 0;
    for (const k of kids) {
      if (ids.has(k)) count += 1;
    }
    childCount.set(id, count);
  }

  const stack: string[] = [];
  for (const [id, c] of childCount.entries()) {
    if (c === 0) stack.push(id);
  }

  const order: string[] = [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    order.push(id);
    const p = parentById.get(id);
    if (p && childCount.has(p)) {
      const next = (childCount.get(p) ?? 0) - 1;
      childCount.set(p, next);
      if (next === 0) stack.push(p);
    }
  }

  if (order.length !== rows.length) {
    throw new Error(`[delete-order] expected ${rows.length}, got ${order.length}`);
  }

  return order;
}

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: authData, error: authError } = await sb.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (authError || !authData.user) {
    throw new Error(`[auth] ${authError?.message ?? 'login failed'}`);
  }

  const userId = userOverride || authData.user.id;
  console.log(`[auth] Logged in as ${authData.user.email}`);
  console.log(`[config] mode=${execute ? 'EXECUTE' : 'DRY-RUN'}, user=${userId}`);
  console.log(`[config] templates=${templateIds.join(',')}`);

  const selectedTemplates = CATEGORY_TEMPLATES.filter((t) => templateIds.includes(t.id));
  if (selectedTemplates.length === 0) {
    throw new Error('[config] no valid templates selected');
  }

  const siblingKeyToId = new Map<string, string>();
  const nextSortByParent = new Map<string, number>();
  const rows: CategoryInsertRow[] = [];

  const ensureNode = (name: string, parentId: string | null): string => {
    const key = `${parentId ?? 'NULL'}\u0000${name}`;
    const existing = siblingKeyToId.get(key);
    if (existing) return existing;

    const parentKey = parentId ?? 'NULL';
    const sortOrder = nextSortByParent.get(parentKey) ?? 0;
    nextSortByParent.set(parentKey, sortOrder + 1);

    const id = crypto.randomUUID();
    siblingKeyToId.set(key, id);
    rows.push({
      id,
      user_id: userId,
      name,
      parent_id: parentId,
      sort_order: sortOrder,
    });
    return id;
  };

  const buildRec = (node: TemplateNode, parentId: string | null) => {
    const id = ensureNode(node.name, parentId);
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      buildRec(child, id);
    }
  };

  for (const template of selectedTemplates) {
    for (const root of template.roots as TemplateNode[]) {
      buildRec(root, null);
    }
  }

  console.log(`[plan] rowsToInsert=${rows.length}`);

  const { count: existingCount, error: existingErr } = await sb
    .from('categories')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (existingErr) throw new Error(`[count existing] ${existingErr.message}`);
  console.log(`[plan] existingRowsForUser=${existingCount ?? 0}`);

  if (!execute) {
    console.log('[dry-run] no changes applied. use --execute to run.');
    return;
  }

  // Reset deck linked category IDs to avoid stale references.
  const { error: resetDecksErr } = await sb
    .from('decks')
    .update({ category_ids: [] })
    .eq('user_id', userId);
  if (resetDecksErr) throw new Error(`[decks reset] ${resetDecksErr.message}`);
  console.log('[apply] deck.category_ids reset for user');

  // Delete all user categories in leaf-first batches to avoid statement timeout.
  const existingRows = await fetchAllCategoriesForUser<{ id: string; parent_id: string | null }>(
    sb,
    userId,
    'id,parent_id',
  );

  const deleteOrder = buildLeafFirstDeleteOrder(existingRows);
  const deleteBatches = chunk(deleteOrder, deleteBatchSize);
  let deleted = 0;
  for (let i = 0; i < deleteBatches.length; i += 1) {
    const batch = deleteBatches[i];
    const { error } = await sb.from('categories').delete().in('id', batch);
    if (error) {
      console.warn(`[warn] delete batch ${i + 1}/${deleteBatches.length} failed: ${error.message}. Retrying row-by-row...`);
      for (const id of batch) {
        const { error: oneErr } = await sb.from('categories').delete().eq('id', id);
        if (oneErr) throw new Error(`[delete row ${id}] ${oneErr.message}`);
        deleted += 1;
      }
    } else {
      deleted += batch.length;
    }
    if ((i + 1) % 10 === 0 || i + 1 === deleteBatches.length) {
      console.log(`[apply] deleted ${deleted}/${deleteOrder.length}`);
    }
  }
  console.log('[apply] deleted existing categories');

  // Insert rebuilt tree in chunks.
  const batches = chunk(rows, batchSize);
  let inserted = 0;
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const { error } = await sb.from('categories').insert(batch);
    if (error) throw new Error(`[insert batch ${i + 1}/${batches.length}] ${error.message}`);
    inserted += batch.length;
    if ((i + 1) % 10 === 0 || i + 1 === batches.length) {
      console.log(`[apply] inserted ${inserted}/${rows.length}`);
    }
  }

  // Validate final count and duplicates.
  const allRows = await fetchAllCategoriesForUser<{
    id: string;
    parent_id: string | null;
    name: string;
    user_id: string;
  }>(sb, userId, 'id,parent_id,name,user_id');

  const dupKey = new Map<string, number>();
  for (const r of allRows) {
    const k = `${r.user_id}|${r.parent_id ?? 'NULL'}|${r.name}`;
    dupKey.set(k, (dupKey.get(k) ?? 0) + 1);
  }
  let dupGroups = 0;
  let dupExtra = 0;
  for (const c of dupKey.values()) {
    if (c > 1) {
      dupGroups += 1;
      dupExtra += c - 1;
    }
  }

  console.log(`[done] inserted=${inserted}, finalCount=${allRows.length}, dupGroups=${dupGroups}, dupExtra=${dupExtra}`);
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
