import { createClient } from '../node_modules/@supabase/supabase-js/dist/module/index.js';
const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);
await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });
const { data: { user } } = await sb.auth.getUser();
console.log('user_id:', user.id);

const sql = `SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE srs IS NOT NULL AND (srs->>'repetitions')::int > 0) as reviewed,
  COUNT(*) FILTER (WHERE deck_id IS NOT NULL) as has_deck_id,
  COUNT(*) FILTER (WHERE srs IS NOT NULL) as has_srs
FROM public.cards WHERE user_id = '${user.id}'`;

const t0 = Date.now();
const { data, error } = await sb.rpc('exec_sql', { sql });
console.log('query ms:', Date.now() - t0);
if (error) { console.error(error); process.exit(1); }
console.log('counts:', JSON.stringify(data, null, 2));

// Also check deck categoryIds
const { data: decks, error: decksErr } = await sb.from('decks').select('id, name, category_ids').eq('user_id', user.id);
if (decks) {
  console.log('\nDecks:');
  for (const d of decks) console.log(' -', d.name, '| categoryIds:', d.category_ids?.length ?? 0);
}
process.exit(0);
