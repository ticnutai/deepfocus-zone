/**
 * Finds and deletes root-level Shas masechta categories that were incorrectly
 * created by the study plan dialog (ensureShasCategories bug).
 *
 * Safe: only deletes categories that have NO flashcards assigned to them
 * (either directly or in any descendant).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hgjfpwdugvvtrfhycejv.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYsImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc';

const sb = createClient(SUPABASE_URL, ANON_KEY);

const EMAIL = 'jj1212t@gmail.com';
const PASS = '543211';

// All Talmud Bavli masechta names — these should never appear at root level
const SHAS_BAVLI_NAMES = [
  'ברכות','שבת','עירובין','פסחים','שקלים','יומא','סוכה','ביצה','ראש השנה',
  'תענית','מגילה','מועד קטן','חגיגה','יבמות','כתובות','נדרים','נזיר','סוטה',
  'גיטין','קידושין','בבא קמא','בבא מציעא','בבא בתרא','סנהדרין','מכות',
  'שבועות','עבודה זרה','הוריות','זבחים','מנחות','חולין','בכורות','ערכין',
  'תמורה','כריתות','מעילה','תמיד','מידות','קינים','נידה'
];

async function main() {
  const { data: authData, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (authErr) { console.error('Auth failed:', authErr.message); process.exit(1); }
  const userId = authData.user.id;
  console.log('Logged in. user_id:', userId);

  // 1. Find root-level categories with Shas masechta names
  const { data: roots, error: findErr } = await sb
    .from('categories')
    .select('id, name, created_at')
    .is('parent_id', null)
    .in('name', SHAS_BAVLI_NAMES)
    .eq('user_id', userId)
    .order('created_at', { ascending: false }); console.log('Roots found:', roots?.length);

  if (findErr) { console.error('Find error:', findErr); process.exit(1); }

  if (!roots || roots.length === 0) {
    console.log('No wrongly-created root-level Shas categories found. Nothing to delete.');
    process.exit(0);
  }

  console.log(`\nFound ${roots.length} root-level Shas category(ies):`);
  for (const r of roots) {
    console.log(`  - id=${r.id}  name="${r.name}"  created_at=${r.created_at}`);
  }

  // 2. Recursively collect all descendant IDs (BFS, chunked)
  const allIds = new Set(roots.map(r => r.id));
  let frontier = [...allIds];
  while (frontier.length > 0) {
    const nextFrontier = [];
    for (let i = 0; i < frontier.length; i += 50) {
      const chunk = frontier.slice(i, i + 50);
      const { data: children, error: childErr } = await sb
        .from('categories')
        .select('id')
        .in('parent_id', chunk)
        .eq('user_id', userId);
      if (childErr) { console.error('Child fetch error:', childErr); process.exit(1); }
      for (const c of (children ?? [])) {
        if (!allIds.has(c.id)) {
          allIds.add(c.id);
          nextFrontier.push(c.id);
        }
      }
    }
    frontier = nextFrontier;
  }
  console.log(`Total categories (including descendants): ${allIds.size}`);

  // 3. Check no cards exist under these categories (chunked)
  let totalCardCount = 0;
  const idArray = [...allIds];
  for (let i = 0; i < idArray.length; i += 50) {
    const chunk = idArray.slice(i, i + 50);
    const { count, error: cardErr } = await sb
      .from('cards')
      .select('id', { count: 'exact', head: true })
      .in('category_id', chunk)
      .eq('user_id', userId);
    if (cardErr && cardErr.message !== "") { console.error('Full cardErr object:', JSON.stringify(cardErr, null, 2)); process.exit(1); }
    totalCardCount += count ?? 0;
  }

  if (totalCardCount > 0) {
    console.error(`ERROR: Found ${totalCardCount} card(s) under these categories — refusing to delete.`);
    process.exit(1);
  }
  console.log('No cards found — safe to delete.');

  // 4. Delete in batches (leaves first — multiple passes handle FK ordering)
  const BATCH = 50;
  let deleted = 0;
  let remaining = [...idArray];
  let passes = 0;
  while (remaining.length > 0 && passes < 20) {
    passes++;
    const nextRemaining = [];
    for (let i = 0; i < remaining.length; i += BATCH) {
      const chunk = remaining.slice(i, i + BATCH);
      const { error: delErr, count } = await sb
        .from('categories')
        .delete({ count: 'exact' })
        .in('id', chunk)
        .eq('user_id', userId);
      if (delErr) {
        console.log(`  Pass ${passes}: ${delErr.message}`);
        nextRemaining.push(...chunk);
      } else {
        deleted += count ?? 0;
      }
    }
    remaining = nextRemaining;
  }

  if (remaining.length > 0) {
    console.error(`Could not delete ${remaining.length} categories after ${passes} passes.`);
  } else {
    console.log(`Done. Deleted ${deleted} categories.`);
    console.log(`Removed: ${roots.map(r => '"' + r.name + '"').join(', ')}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });




