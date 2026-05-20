/**
 * Deep analysis of categories volume and duplication hotspots.
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);

await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });
console.log('Logged in');

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

const categories = await fetchAllPages(() =>
  sb.from('categories').select('id, name, parent_id, created_at').order('created_at')
);

console.log('Total categories:', categories.length);

const byId = new Map(categories.map((c) => [c.id, c]));
const children = new Map();
for (const c of categories) {
  const p = c.parent_id ?? '__ROOT__';
  if (!children.has(p)) children.set(p, []);
  children.get(p).push(c.id);
}

const roots = categories.filter((c) => c.parent_id == null);

function subtreeSize(rootId) {
  let count = 0;
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    count += 1;
    const kids = children.get(id) ?? [];
    for (const k of kids) stack.push(k);
  }
  return count;
}

const rootStats = roots
  .map((r) => ({
    id: r.id,
    name: r.name,
    created_at: r.created_at,
    size: subtreeSize(r.id),
  }))
  .sort((a, b) => b.size - a.size);

console.log('\nTop root subtrees by size:');
for (const r of rootStats.slice(0, 20)) {
  console.log(`  ${r.size.toString().padStart(5)}  ${r.name}  [${r.id}]  ${r.created_at}`);
}

const siblingKeyCounts = new Map();
for (const c of categories) {
  const key = `${c.parent_id ?? 'NULL'}\u0000${c.name}`;
  siblingKeyCounts.set(key, (siblingKeyCounts.get(key) ?? 0) + 1);
}

const duplicateSiblingGroups = Array.from(siblingKeyCounts.entries())
  .filter(([, count]) => count > 1)
  .map(([key, count]) => {
    const splitAt = key.indexOf('\u0000');
    const parentId = key.slice(0, splitAt);
    const name = key.slice(splitAt + 1);
    return {
      parentId: parentId === 'NULL' ? null : parentId,
      name,
      count,
      extra: count - 1,
    };
  })
  .sort((a, b) => b.count - a.count);

const totalDuplicateExtra = duplicateSiblingGroups.reduce((s, g) => s + g.extra, 0);

console.log('\nDuplicate sibling groups (same parent_id + name):', duplicateSiblingGroups.length);
console.log('Extra duplicate rows from these groups:', totalDuplicateExtra);
console.log('Top 30 duplicate sibling groups:');
for (const g of duplicateSiblingGroups.slice(0, 30)) {
  console.log(`  x${g.count}  name="${g.name}"  parent=${g.parentId ?? 'NULL'}`);
}

const byMinute = new Map();
for (const c of categories) {
  const minute = new Date(c.created_at).toISOString().slice(0, 16);
  byMinute.set(minute, (byMinute.get(minute) ?? 0) + 1);
}

const spikes = Array.from(byMinute.entries())
  .map(([minute, count]) => ({ minute, count }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 20);

console.log('\nTop creation spikes by minute:');
for (const s of spikes) {
  console.log(`  ${s.count.toString().padStart(5)}  ${s.minute}`);
}
