import { createClient } from '@supabase/supabase-js';
const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);
await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });

console.log('\n=== Phase 1: Bootstrap (reviewed cards only) ===');
const t0 = Date.now();
const { data, error } = await sb.rpc('get_bootstrap_snapshot');
const t1 = Date.now();
if (error) { console.error('Error:', error); process.exit(1); }
console.log(`Time: ${t1 - t0}ms`);
console.log(`Cards loaded (Phase 1): ${data?.cards?.length ?? 0}`);
console.log(`Cards total: ${data?.cards_total_count ?? 'N/A'}`);
console.log(`Categories (roots): ${data?.categories_roots?.length ?? 0}`);
console.log(`Decks: ${data?.decks?.length ?? 0}`);

const unreviewedCount = (data?.cards_total_count ?? 0) - (data?.cards?.length ?? 0);
console.log(`Unreviewed cards (Phase 2 backfill): ${unreviewedCount}`);

console.log('\n=== Phase 2: First page of unreviewed cards ===');
const t2 = Date.now();
const { data: page1, error: err2 } = await sb.rpc('get_unreviewed_cards_page', { p_offset: 0, p_limit: 500 });
const t3 = Date.now();
if (err2) { console.error('Error:', err2); process.exit(1); }
const p1 = Array.isArray(page1) ? page1 : [];
console.log(`Time: ${t3 - t2}ms`);
console.log(`Cards in page 1: ${p1.length}`);
console.log(`\nTotal pages needed: ~${Math.ceil(unreviewedCount / 500)}`);
console.log(`Estimated Phase 2 total time: ~${Math.ceil(unreviewedCount / 500) * (t3-t2)}ms (sequential)`);

process.exit(0);
