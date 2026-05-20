import { createClient } from '@supabase/supabase-js';
const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);
await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });

// Check actual SRS distribution — use exec_sql RPC
const { data, error } = await sb.rpc('exec_sql', {
  sql: `
    SELECT 
      COUNT(*) FILTER (WHERE srs IS NULL) as srs_null,
      COUNT(*) FILTER (WHERE srs IS NOT NULL AND (srs->>'repetitions')::int > 0) as rep_gt0,
      COUNT(*) FILTER (WHERE srs IS NOT NULL AND srs->>'lastReviewedAt' != 'null') as has_last_reviewed,
      COUNT(*) FILTER (WHERE srs IS NOT NULL AND (srs->>'interval')::int > 0) as interval_gt0,
      COUNT(*) as total
    FROM cards
  `
});
if (error) { console.error('Error:', error); process.exit(1); }
console.log('SRS distribution:', JSON.stringify(data, null, 2));

// Also peek at a few cards
const { data: samples } = await sb.rpc('exec_sql', {
  sql: `SELECT id, srs FROM cards WHERE srs IS NOT NULL LIMIT 3`
});
console.log('\nSample card SRS data:', JSON.stringify(samples, null, 2));

process.exit(0);
