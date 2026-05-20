/**
 * Full health check: categories tree + cards integrity
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
    const { data, error } = await sb.from(table).select(select).order('created_at').order('id').range(offset, offset + PAGE - 1);
    if (error) { console.error(`  ❌ Error fetching ${table}:`, error.message); break; }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

let allOk = true;
const fail = (msg) => { console.log(`  ❌ ${msg}`); allOk = false; };
const ok   = (msg) => console.log(`  ✅ ${msg}`);

// ═══════════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════════
console.log('\n══ CATEGORIES ══════════════════════════════════════');
const cats = await fetchAll('categories', 'id, name, parent_id, user_id, created_at');
console.log(`  Total: ${cats.length}`);

const catById = new Map(cats.map(c => [c.id, c]));

// 1. Duplicates (same name + parent_id + user_id)
const catKey = c => `${c.user_id}|${c.name}|${c.parent_id ?? '__root__'}`;
const catGroups = {};
for (const c of cats) { const k = catKey(c); (catGroups[k] ??= []).push(c); }
const dupCats = Object.values(catGroups).filter(g => g.length > 1);
dupCats.length === 0 ? ok(`No duplicate categories`) : fail(`${dupCats.reduce((s,g)=>s+g.length-1,0)} duplicate categories in ${dupCats.length} groups`);

// 2. Orphaned categories (parent_id points to non-existent category)
const orphanCats = cats.filter(c => c.parent_id && !catById.has(c.parent_id));
orphanCats.length === 0 ? ok(`No orphaned categories (all parent_ids valid)`) : fail(`${orphanCats.length} categories reference non-existent parent`);
for (const c of orphanCats.slice(0,5)) console.log(`     "${c.name}" → missing parent ${c.parent_id}`);

// 3. Circular references (detect cycles in tree)
const visited = new Set();
const inStack = new Set();
let cycleCount = 0;
for (const c of cats) {
  if (visited.has(c.id)) continue;
  const path = [];
  let cur = c;
  while (cur && !visited.has(cur.id)) {
    if (inStack.has(cur.id)) { cycleCount++; break; }
    inStack.add(cur.id);
    path.push(cur.id);
    cur = cur.parent_id ? catById.get(cur.parent_id) : null;
  }
  path.forEach(id => { visited.add(id); inStack.delete(id); });
}
cycleCount === 0 ? ok(`No circular references in category tree`) : fail(`${cycleCount} circular reference(s) detected`);

// 4. Tree depth check (warn if > 6 levels deep)
let maxDepth = 0;
const getDepth = (id, depth = 0, seen = new Set()) => {
  if (seen.has(id)) return depth; // cycle guard
  seen.add(id);
  const cat = catById.get(id);
  if (!cat || !cat.parent_id) return depth;
  return getDepth(cat.parent_id, depth + 1, seen);
};
for (const c of cats) {
  const d = getDepth(c.id);
  if (d > maxDepth) maxDepth = d;
}
maxDepth <= 10 ? ok(`Max category depth: ${maxDepth} levels`) : fail(`Max depth ${maxDepth} — very deep tree`);

// 5. Depth distribution
const depthDist = {};
for (const c of cats) {
  const d = getDepth(c.id);
  depthDist[d] = (depthDist[d] ?? 0) + 1;
}
console.log('  Depth distribution:');
Object.entries(depthDist).sort(([a],[b])=>+a-+b).forEach(([d,n]) => console.log(`    Level ${d}: ${n} categories`));

// 6. Root categories (no parent)
const roots = cats.filter(c => !c.parent_id);
console.log(`  Root categories (${roots.length}): ${roots.map(c=>c.name).join(', ')}`);

// ═══════════════════════════════════════════════════════════════
// CARDS
// ═══════════════════════════════════════════════════════════════
console.log('\n══ CARDS ════════════════════════════════════════════');
const cards = await fetchAll('cards', 'id, question, answer, deck_id, user_id, type, created_at');
console.log(`  Total: ${cards.length}`);

// 1. Duplicates (same question + deck_id + user_id after trim)
const cardKey = c => `${c.user_id}|${c.deck_id ?? '__null__'}|${(c.question??'').trim()}`;
const cardGroups = {};
for (const c of cards) { const k = cardKey(c); (cardGroups[k] ??= []).push(c); }
const dupCards = Object.values(cardGroups).filter(g => g.length > 1);
const dupCardN = dupCards.reduce((s,g)=>s+g.length-1,0);
dupCardN === 0 ? ok(`No duplicate cards`) : fail(`${dupCardN} duplicate cards in ${dupCards.length} groups`);

// 2. Cards with empty question
const emptyQ = cards.filter(c => !c.question || c.question.trim() === '');
emptyQ.length === 0 ? ok(`No cards with empty question`) : fail(`${emptyQ.length} cards have empty question`);

// 3. Orphaned cards (deck_id references non-existent deck)
const { data: decks } = await sb.from('decks').select('id');
const deckIds = new Set((decks??[]).map(d=>d.id));
const orphanCards = cards.filter(c => c.deck_id && !deckIds.has(c.deck_id));
orphanCards.length === 0 ? ok(`No orphaned cards (all deck_ids valid or null)`) : fail(`${orphanCards.length} cards reference non-existent deck`);

// 4. Cards per type
const typeCount = {};
for (const c of cards) typeCount[c.type] = (typeCount[c.type]??0) + 1;
console.log(`  Types: ${Object.entries(typeCount).map(([t,n])=>`${t}(${n})`).join(', ')}`);

// 5. Card decks join table
const cardDecks = await fetchAll('card_decks', 'id, card_id, deck_id, user_id');
console.log(`\n══ CARD_DECKS (join table) ═══════════════════════════`);
console.log(`  Total rows: ${cardDecks.length}`);
const cardIds = new Set(cards.map(c=>c.id));
const orphanCdCards = cardDecks.filter(cd => !cardIds.has(cd.card_id));
const orphanCdDecks = cardDecks.filter(cd => !deckIds.has(cd.deck_id));
orphanCdCards.length === 0 ? ok(`No card_decks pointing to missing cards`) : fail(`${orphanCdCards.length} card_decks with missing card_id`);
orphanCdDecks.length === 0 ? ok(`No card_decks pointing to missing decks`) : fail(`${orphanCdDecks.length} card_decks with missing deck_id`);

// ═══════════════════════════════════════════════════════════════
// FINAL
// ═══════════════════════════════════════════════════════════════
console.log('\n══ RESULT ═══════════════════════════════════════════');
if (allOk) {
  console.log('  ✅ Everything is clean — no issues found.');
} else {
  console.log('  ❌ Issues found — see above.');
}
console.log('');
process.exit(allOk ? 0 : 1);
