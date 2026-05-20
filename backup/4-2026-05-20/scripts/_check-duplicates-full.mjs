/**
 * Full duplicate scan with pagination (Supabase default limit = 1000).
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);
await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });

async function fetchAll(table, select) {
  const PAGE = 1000;
  let offset = 0;
  const rows = [];
  while (true) {
    // Order by created_at + id (id is unique) to get deterministic pagination without page-boundary duplicates
    const { data, error } = await sb.from(table).select(select).order('created_at').order('id').range(offset, offset + PAGE - 1);
    if (error) { console.error(`Error fetching ${table}:`, error); break; }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
    process.stdout.write(`\r  ${table}: ${rows.length} rows loaded...`);
  }
  process.stdout.write(`\r  ${table}: ${rows.length} rows total    \n`);
  return rows;
}

// ── Categories ───────────────────────────────────────────────────────────────
console.log('\nLoading categories...');
const cats = await fetchAll('categories', 'id, name, parent_id, created_at');

const catKey = (c) => `${c.name}|${c.parent_id ?? '__root__'}`;
const catGroups = {};
for (const c of cats) {
  const k = catKey(c);
  (catGroups[k] ??= []).push(c);
}
const dupCats = Object.entries(catGroups).filter(([, g]) => g.length > 1);
const dupCatCount = dupCats.reduce((s, [, g]) => s + g.length - 1, 0);
console.log(`Duplicate category groups: ${dupCats.length} (${dupCatCount} to delete)`);
for (const [key, group] of dupCats.slice(0, 20)) {
  const [name, parent] = key.split('|');
  console.log(`  "${name}" (parent=${parent === '__root__' ? 'ROOT' : parent.slice(0,8)+'...'}) × ${group.length}`);
}
if (dupCats.length > 20) console.log(`  ... and ${dupCats.length - 20} more groups`);

// ── Cards ────────────────────────────────────────────────────────────────────
console.log('\nLoading cards...');
const cards = await fetchAll('cards', 'id, question, answer, deck_id, created_at');

const cardKey = (c) => `${c.deck_id}|${(c.question ?? '').trim()}|${(c.answer ?? '').trim()}`;
const cardGroups = {};
for (const c of cards) {
  const k = cardKey(c);
  (cardGroups[k] ??= []).push(c);
}
const dupCards = Object.entries(cardGroups).filter(([, g]) => g.length > 1);
const dupCardCount = dupCards.reduce((s, [, g]) => s + g.length - 1, 0);
console.log(`Duplicate card groups: ${dupCards.length} (${dupCardCount} to delete)`);
for (const [, group] of dupCards.slice(0, 10)) {
  console.log(`  Q: "${group[0].question?.slice(0, 70)}" × ${group.length}`);
}
if (dupCards.length > 10) console.log(`  ... and ${dupCards.length - 10} more groups`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══ Summary ══════════════════════════════════════');
console.log(`  Total categories:               ${cats.length}`);
console.log(`  Duplicate categories to delete: ${dupCatCount}`);
console.log(`  Total cards:                    ${cards.length}`);
console.log(`  Duplicate cards to delete:      ${dupCardCount}`);
console.log('');
process.exit(0);
