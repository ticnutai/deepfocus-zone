/**
 * Diagnose duplicate categories and cards.
 * Uses exec_sql-style RPC — runs as authenticated user.
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);
await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });

// ── Count ALL categories ──────────────────────────────────────────────────────
const { data: cats } = await sb.from('categories').select('id, name, parent_id, created_at').order('created_at');
console.log(`\nTotal categories: ${cats?.length ?? 0}`);

// ── Find duplicate categories (same name + parent_id) ────────────────────────
const catKey = (c) => `${c.name}|${c.parent_id ?? '__root__'}`;
const catGroups = {};
for (const c of (cats ?? [])) {
  const k = catKey(c);
  (catGroups[k] ??= []).push(c);
}
const dupCats = Object.entries(catGroups).filter(([, g]) => g.length > 1);
console.log(`\nDuplicate category groups (same name + parent): ${dupCats.length}`);
for (const [key, group] of dupCats.slice(0, 20)) {
  const [name, parent] = key.split('|');
  console.log(`  "${name}" (parent=${parent === '__root__' ? 'ROOT' : parent.slice(0,8)+'...'}) × ${group.length} — keeping ${group[0].id.slice(0,8)}...`);
}
if (dupCats.length > 20) console.log(`  ... and ${dupCats.length - 20} more`);

// ── Count ALL cards ──────────────────────────────────────────────────────────
const { data: cards } = await sb.from('cards').select('id, question, answer, deck_id, created_at').order('created_at');
console.log(`\nTotal cards: ${cards?.length ?? 0}`);

// ── Find duplicate cards (same question + answer + deck_id) ──────────────────
const cardKey = (c) => `${c.deck_id}|${(c.question ?? '').trim()}|${(c.answer ?? '').trim()}`;
const cardGroups = {};
for (const c of (cards ?? [])) {
  const k = cardKey(c);
  (cardGroups[k] ??= []).push(c);
}
const dupCards = Object.entries(cardGroups).filter(([, g]) => g.length > 1);
const dupCardCount = dupCards.reduce((s, [, g]) => s + g.length - 1, 0);
console.log(`\nDuplicate card groups (same question+answer+deck): ${dupCards.length}`);
console.log(`Cards to delete: ${dupCardCount}`);
for (const [, group] of dupCards.slice(0, 10)) {
  console.log(`  Q: "${group[0].question?.slice(0,60)}" × ${group.length}`);
}
if (dupCards.length > 10) console.log(`  ... and ${dupCards.length - 10} more groups`);

// ── Summary ───────────────────────────────────────────────────────────────────
const dupCatCount = dupCats.reduce((s, [, g]) => s + g.length - 1, 0);
console.log('\n══ Summary ══════════════════════════════════════');
console.log(`  Duplicate categories to delete: ${dupCatCount}`);
console.log(`  Duplicate cards to delete:      ${dupCardCount}`);
console.log('');
process.exit(0);
