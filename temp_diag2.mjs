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

// Fetch all cards
let allCards = [];
offset = 0;
while (true) {
  const { data } = await sb.from('cards').select('id,tags,question').range(offset, offset+999);
  if (!data?.length) break;
  allCards = [...allCards, ...data];
  if (data.length < 1000) break;
  offset += 1000;
}

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

const shasRoot  = allCats.find(c=>!c.parent_id && (c.name.includes('ש"ס') || c.name.includes('שס')));
const bavliRoot = allCats.find(c=>!c.parent_id && c.name.includes('תלמוד בבלי'));

console.log('=== ש"ס TREE STRUCTURE (levels 2 & 3) ===');
for (const seder of childrenOf(shasRoot.id)) {
  const masechtos = childrenOf(seder.id);
  console.log(`  Seder: "${seder.name}" — ${masechtos.length} masechtos`);
  for (const m of masechtos) {
    const dapim = childrenOf(m.id);
    // count cards under this masechet
    const mNames = new Set([m.name, ...dapim.map(d=>d.name)]);
    const cardCount = allCards.filter(c=>(c.tags||[]).some(t=>t.startsWith('cat:')&&mNames.has(t.slice(4)))).length;
    console.log(`    Masechet: "${m.name}" — ${dapim.length} dapim — ${cardCount} cards`);
  }
}

console.log('\n=== תלמוד בבלי TREE STRUCTURE (levels 2 & 3) ===');
for (const seder of childrenOf(bavliRoot.id)) {
  const masechtos = childrenOf(seder.id);
  console.log(`  Seder: "${seder.name}" — ${masechtos.length} masechtos`);
  for (const m of masechtos) {
    const dapim = childrenOf(m.id);
    const mNames = new Set([m.name, ...dapim.map(d=>d.name)]);
    const cardCount = allCards.filter(c=>(c.tags||[]).some(t=>t.startsWith('cat:')&&mNames.has(t.slice(4)))).length;
    console.log(`    Masechet: "${m.name}" — ${dapim.length} dapim — ${cardCount} cards`);
  }
}

// KEY QUESTION: do the same masechet names appear in BOTH trees?
const shasNames = subtreeNames(shasRoot.id);
const bavliNames = subtreeNames(bavliRoot.id);
const overlap = [...bavliNames].filter(n=>shasNames.has(n));
console.log(`\n=== ALL 51 OVERLAPPING CATEGORY NAMES ===`);
console.log(overlap.join(', '));

// Are there ANY cards with BOTH a ש"ס tag AND a תלמוד בבלי tag?
const cardsBothTrees = allCards.filter(c=>{
  const tags = c.tags||[];
  const hasShas = tags.some(t=>t.startsWith('cat:')&&shasNames.has(t.slice(4)));
  const hasBavli = tags.some(t=>t.startsWith('cat:')&&bavliNames.has(t.slice(4)));
  return hasShas && hasBavli;
});
console.log(`\n=== CARDS WITH TAGS IN BOTH TREES ===`);
console.log(`Count: ${cardsBothTrees.length}`);
if (cardsBothTrees.length > 0) {
  for (const c of cardsBothTrees.slice(0,5)) {
    console.log(`  "${c.question?.slice(0,50)}" tags=${JSON.stringify(c.tags)}`);
  }
}

// Check: same category NAME, different parent trees — how many cards on each side?
// For each overlapping name, which tree's version has more cards?
console.log('\n=== MASECHET-LEVEL CARD COUNT: ש"ס vs תלמוד בבלי ===');
const shasSedarim = childrenOf(shasRoot.id);
const bavliSedarim = childrenOf(bavliRoot.id);

// For each masechet in bavli tree, find same-named masechet in shas tree
for (const bSeder of bavliSedarim) {
  const bMasechtos = childrenOf(bSeder.id);
  for (const bM of bMasechtos) {
    // Find matching shas masechet
    const sSeder = shasSedarim.find(s=>s.name===bSeder.name);
    if (!sSeder) { console.log(`  SEDER NOT IN SHAS: ${bSeder.name}`); continue; }
    const sM = childrenOf(sSeder.id).find(m=>m.name===bM.name);
    
    const bDapim = childrenOf(bM.id);
    const bAllNames = new Set([bM.name, ...bDapim.map(d=>d.name)]);
    const bCards = allCards.filter(c=>(c.tags||[]).some(t=>t.startsWith('cat:')&&bAllNames.has(t.slice(4))));
    
    let sCardsCount = 0;
    let sDapimCount = 0;
    if (sM) {
      const sDapim = childrenOf(sM.id);
      sDapimCount = sDapim.length;
      const sAllNames = new Set([sM.name, ...sDapim.map(d=>d.name)]);
      sCardsCount = allCards.filter(c=>(c.tags||[]).some(t=>t.startsWith('cat:')&&sAllNames.has(t.slice(4)))).length;
    }
    
    if (bCards.length > 0 || sCardsCount > 0) {
      console.log(`  ${bM.name}: bavli_dapim=${bDapim.length} bavli_cards=${bCards.length} | shas_dapim=${sDapimCount} shas_cards=${sCardsCount}`);
    }
  }
}
