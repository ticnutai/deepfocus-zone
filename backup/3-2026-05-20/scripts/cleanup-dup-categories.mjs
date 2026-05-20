/**
 * Cleans up duplicate categories by deleting them in small batches,
 * working from leaves upward to avoid cascade timeouts.
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);

await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });
console.log('Logged in');

// The duplicate root IDs to delete (and all their descendants)
const DUP_ROOTS = [
  '69dfc979-fd02-4f8c-8dbc-fb4bb4301ebd', // זרעים dup
  'a358e355-52f5-413b-b1ac-25fafddb5627', // רמב"ם dup 1
  'e3f0a78b-6d73-47c3-99c5-0c6e746d8d69', // רמב"ם dup 2
  '5bf71860-8f1b-417d-aad0-fa7097003052', // רמב"ם dup 3
  '235c4086-6fec-41b4-9bc2-83ea34c27788', // ש"ס dup 1
  'e2323337-d567-4e01-bb3c-d7cb6393dae8', // ש"ס dup 2
  '1c148799-23b9-41b5-bb5a-c68535e55a5b', // ש"ס dup 3
  '16dd98e6-bda7-4d72-9444-e40cccbe145b', // שולחן ערוך dup 1
  '5941762f-4a1b-42f2-a5b6-42e233399ac0', // שולחן ערוך dup 2
  '9bb81e66-c64b-4fe0-b2d6-934f2ebace04', // שולחן ערוך dup 3
];

// Build the full set of IDs to delete by fetching all descendants level by level
console.log('Building list of IDs to delete...');
const toDelete = new Set(DUP_ROOTS);
let frontier = [...DUP_ROOTS];
let level = 0;

while (frontier.length > 0) {
  level++;
  // Fetch children of current frontier in batches of 500
  const children = [];
  for (let i = 0; i < frontier.length; i += 500) {
    const batch = frontier.slice(i, i + 500);
    const { data, error } = await sb.from('categories')
      .select('id')
      .in('parent_id', batch);
    if (error) { console.error('Error fetching children:', error); break; }
    for (const row of data ?? []) {
      if (!toDelete.has(row.id)) {
        toDelete.add(row.id);
        children.push(row.id);
      }
    }
  }
  console.log(`  Level ${level}: found ${children.length} children (total to delete: ${toDelete.size})`);
  if (children.length === 0) break;
  frontier = children;
}

console.log(`\nTotal IDs to delete: ${toDelete.size}`);

// Delete from leaves upward — reverse the levels
// Since we collected level by level, we delete in reverse level order
// But we have a flat Set. Just delete in batches of 100 using .in()
// PostgREST will not cascade (we're deleting leaves first if we reverse)
// Build array in reverse order (leaves first = last added to toDelete)
const allIds = [...toDelete].reverse(); // reverse = leaves first

let deletedTotal = 0;
const BATCH_SIZE = 50;

for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
  const batch = allIds.slice(i, i + BATCH_SIZE);
  const { error } = await sb.from('categories').delete().in('id', batch);
  if (error) {
    console.error(`Batch ${i / BATCH_SIZE + 1} error:`, error.message);
    // Continue anyway
  } else {
    deletedTotal += batch.length;
  }
  if ((i / BATCH_SIZE + 1) % 20 === 0) {
    console.log(`  Deleted ${deletedTotal} / ${allIds.length}...`);
  }
}

console.log(`\nDone! Deleted ${deletedTotal} rows.`);

// Verify remaining count
const { count } = await sb.from('categories').select('*', { count: 'exact', head: true });
console.log('Remaining categories:', count);

// Show remaining roots
const { data: roots } = await sb.from('categories').select('name,created_at').is('parent_id', null).order('name');
console.log('Remaining root categories:', roots?.map(r => r.name));
