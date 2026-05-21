import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);

await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });

// Fetch all categories 
let allCats = [];
let offset = 0;
while (true) {
  const { data } = await sb.from('categories').select('id,name,parent_id,created_at').range(offset, offset+999);
  if (!data?.length) break;
  allCats = [...allCats, ...data];
  if (data.length < 1000) break;
  offset += 1000;
}
console.log('Total categories:', allCats.length);

// Find roots
const roots = allCats.filter(c => !c.parent_id);
console.log('\n=== ROOT CATEGORIES ===');
for (const r of roots.sort((a,b)=>a.name.localeCompare(b.name,'he'))) {
  const directKids = allCats.filter(c=>c.parent_id===r.id);
  console.log(`  [${r.id.slice(0,8)}] "${r.name}" — direct children: ${directKids.length} — created: ${r.created_at}`);
}

// Build subtree function
const byId = new Map(allCats.map(c=>[c.id,c]));
const childrenOf = pid => allCats.filter(c=>c.parent_id===pid);
function subtreeIds(rootId) {
  const ids = new Set();
  const stack = [rootId];
  while(stack.length) {
    const id = stack.pop();
    ids.add(id);
    for (const c of childrenOf(id)) stack.push(c.id);
  }
  return ids;
}
function subtreeNames(rootId) {
  return new Set([...subtreeIds(rootId)].map(id=>byId.get(id)?.name).filter(Boolean));
}

// Find ש"ס and תלמוד בבלי roots
const shasRoot  = roots.find(r => r.name.includes('ש"ס') || r.name.includes('שס'));
const bavliRoot = roots.find(r => r.name.includes('תלמוד בבלי'));

if (shasRoot) {
  const sIds = subtreeIds(shasRoot.id);
  const sNames = subtreeNames(shasRoot.id);
  const kids = childrenOf(shasRoot.id);
  console.log(`\n=== ש"ס TREE ===`);
  console.log(`  ID: ${shasRoot.id}`);
  console.log(`  created: ${shasRoot.created_at}`);
  console.log(`  total subtree categories: ${sIds.size}`);
  console.log(`  direct children (${kids.length}): ${kids.slice(0,8).map(c=>c.name).join(', ')}`);
  // level 3
  const lvl3 = kids.flatMap(k=>childrenOf(k.id));
  console.log(`  level 3 sample (${lvl3.length}): ${lvl3.slice(0,6).map(c=>c.name).join(', ')}`);
}

if (bavliRoot) {
  const bIds = subtreeIds(bavliRoot.id);
  const bNames = subtreeNames(bavliRoot.id);
  const kids = childrenOf(bavliRoot.id);
  console.log(`\n=== תלמוד בבלי TREE ===`);
  console.log(`  ID: ${bavliRoot.id}`);
  console.log(`  created: ${bavliRoot.created_at}`);
  console.log(`  total subtree categories: ${bIds.size}`);
  console.log(`  direct children (${kids.length}): ${kids.slice(0,8).map(c=>c.name).join(', ')}`);
  const lvl3 = kids.flatMap(k=>childrenOf(k.id));
  console.log(`  level 3 sample (${lvl3.length}): ${lvl3.slice(0,6).map(c=>c.name).join(', ')}`);
}

// Name overlap between the two trees
if (shasRoot && bavliRoot) {
  const sNames = subtreeNames(shasRoot.id);
  const bNames = subtreeNames(bavliRoot.id);
  const overlap = [...sNames].filter(n=>bNames.has(n));
  console.log(`\n=== CATEGORY NAME OVERLAP ===`);
  console.log(`  ש"ס subtree categories: ${sNames.size}`);
  console.log(`  תלמוד בבלי subtree categories: ${bNames.size}`);
  console.log(`  Names in BOTH: ${overlap.length}`);
  console.log(`  Sample overlap: ${overlap.slice(0,10).join(', ')}`);
}

// Fetch card count per root
let allCards = [];
offset = 0;
while (true) {
  const { data } = await sb.from('cards').select('id,tags').range(offset, offset+999);
  if (!data?.length) break;
  allCards = [...allCards, ...data];
  if (data.length < 1000) break;
  offset += 1000;
}
console.log(`\nTotal cards in DB: ${allCards.length}`);

if (shasRoot && bavliRoot) {
  const sNames = subtreeNames(shasRoot.id);
  const bNames = subtreeNames(bavliRoot.id);
  const sCards = allCards.filter(c=>(c.tags||[]).some(t=>t.startsWith('cat:')&&sNames.has(t.slice(4))));
  const bCards = allCards.filter(c=>(c.tags||[]).some(t=>t.startsWith('cat:')&&bNames.has(t.slice(4))));
  const sIds = new Set(sCards.map(c=>c.id));
  const bIds = new Set(bCards.map(c=>c.id));
  const both = [...sIds].filter(id=>bIds.has(id));
  console.log(`\n=== CARD DISTRIBUTION ===`);
  console.log(`  Cards tagged under ש"ס tree: ${sIds.size}`);
  console.log(`  Cards tagged under תלמוד בבלי tree: ${bIds.size}`);
  console.log(`  Cards tagged under BOTH trees: ${both.length}`);
  console.log(`  Cards not in either tree: ${allCards.length - new Set([...sIds,...bIds]).size}`);
  
  // Sample 3 cards that are in BOTH to understand
  if (both.length > 0) {
    console.log(`\n  Sample cards in BOTH:`);
    for (const id of both.slice(0,3)) {
      const card = allCards.find(c=>c.id===id);
      console.log(`    ${id.slice(0,8)}: tags=${JSON.stringify(card.tags)}`);
    }
  }
}
