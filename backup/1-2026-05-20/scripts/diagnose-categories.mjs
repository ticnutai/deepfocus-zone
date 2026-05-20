/**
 * Diagnose the current state of categories in the DB.
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);

await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });
console.log('Logged in');

// Total count
const { count: total } = await sb.from('categories').select('*', { count: 'exact', head: true });
console.log('Total categories:', total);

// Root categories (parent_id is null)
const { data: roots, count: rootCount } = await sb.from('categories')
  .select('id, name, created_at', { count: 'exact' })
  .is('parent_id', null)
  .order('name');
console.log('Root category count:', rootCount);
console.log('Root categories:');
for (const r of roots ?? []) {
  console.log(`  [${r.id}] "${r.name}" (created: ${r.created_at})`);
}

// Check for duplicate root names
const nameCounts = {};
for (const r of roots ?? []) {
  nameCounts[r.name] = (nameCounts[r.name] || 0) + 1;
}
const dups = Object.entries(nameCounts).filter(([, c]) => c > 1);
if (dups.length > 0) {
  console.log('\nDuplicate root names:');
  for (const [name, count] of dups) {
    console.log(`  "${name}" appears ${count} times`);
  }
} else {
  console.log('\nNo duplicate root names found.');
}

// Sample first 10 categories by created_at to see if there was a mass import
const { data: newest } = await sb.from('categories')
  .select('id, name, parent_id, created_at')
  .order('created_at', { ascending: false })
  .limit(10);
console.log('\n10 newest categories:');
for (const r of newest ?? []) {
  console.log(`  [${r.id}] "${r.name}" parent=${r.parent_id ?? 'NULL'} created=${r.created_at}`);
}
