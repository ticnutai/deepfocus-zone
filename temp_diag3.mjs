import { createClient } from '@supabase/supabase-js';
const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);
await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });

// 1. Sample cards with cat:ש"ס tag
const { data: shas } = await sb.from('cards').select('id,question,tags').contains('tags', ['cat:ש"ס']).limit(3);
console.log('=== Cards tagged cat:ש"ס ===');
for (const c of shas ?? []) console.log(JSON.stringify({ q: c.question?.slice(0, 60), tags: c.tags }));

// 2. Sample cards with cat:תלמוד בבלי tag
const { data: bavli } = await sb.from('cards').select('id,question,tags').contains('tags', ['cat:תלמוד בבלי']).limit(3);
console.log('\n=== Cards tagged cat:תלמוד בבלי ===');
for (const c of bavli ?? []) console.log(JSON.stringify({ q: c.question?.slice(0, 60), tags: c.tags }));

// 3. Total count each
const { count: c1 } = await sb.from('cards').select('*', { count: 'exact', head: true }).contains('tags', ['cat:ש"ס']);
const { count: c2 } = await sb.from('cards').select('*', { count: 'exact', head: true }).contains('tags', ['cat:תלמוד בבלי']);
console.log('\nCards with cat:ש"ס tag:', c1);
console.log('Cards with cat:תלמוד בבלי tag:', c2);

// 4. Direct children of תלמוד בבלי with their children
const { data: bavliCats } = await sb.from('categories')
  .select('id,name,parent_id')
  .eq('parent_id', '6952809f-6e27-4171-8975-f938a164c014');
console.log('\n=== Direct children of תלמוד בבלי ===');
for (const cat of bavliCats ?? []) {
  const { data: kids } = await sb.from('categories').select('id,name').eq('parent_id', cat.id);
  console.log(JSON.stringify({ seder: cat.name, id: cat.id.slice(0,8), masechtos: kids?.map(k => k.name) }));
}

// 5. Direct children of ש"ס (sedarim) with masechtos
const { data: shasCats } = await sb.from('categories')
  .select('id,name,parent_id')
  .eq('parent_id', '7dcb6fcf-49b0-4660-ae3a-e9081e6e3f42');
console.log('\n=== Direct children of ש"ס (sedarim) ===');
for (const seder of shasCats ?? []) {
  const { data: masechtos } = await sb.from('categories').select('id,name').eq('parent_id', seder.id);
  console.log(JSON.stringify({ seder: seder.name, id: seder.id.slice(0,8), masechtos: masechtos?.map(k => k.name) }));
}

// 6. Cards with BOTH root tags
const { count: cBoth } = await sb.from('cards').select('*', { count: 'exact', head: true })
  .contains('tags', ['cat:ש"ס']).contains('tags', ['cat:תלמוד בבלי']);
console.log('\nCards with BOTH cat:ש"ס AND cat:תלמוד בבלי:', cBoth);

// 7. Cards with cat:תלמוד בבלי AND cat:ברכות
const { count: c3 } = await sb.from('cards').select('*', { count: 'exact', head: true })
  .contains('tags', ['cat:תלמוד בבלי']).contains('tags', ['cat:ברכות']);
console.log('Cards with cat:תלמוד בבלי AND cat:ברכות:', c3);

const { count: c4 } = await sb.from('cards').select('*', { count: 'exact', head: true })
  .contains('tags', ['cat:ש"ס']).contains('tags', ['cat:ברכות']);
console.log('Cards with cat:ש"ס AND cat:ברכות:', c4);

let allCats = [];
let offset = 0;
while (true) {
  const { data } = await sb.from('categories').select('id,name,parent_id').range(offset, offset+999);
  if (!data?.length) break;
  allCats = [...allCats, ...data];
  if (data.length < 1000) break;
  offset += 1000;
}

const shasRoot  = allCats.find(c=>!c.parent_id && (c.name.includes('ש"ס') || c.name.includes('שס')));
const bavliRoot = allCats.find(c=>!c.parent_id && c.name.includes('תלמוד בבלי'));

const getSubtree = (rootId) => {
  const items = [];
  const stack = [rootId];
  while(stack.length) {
    const id = stack.pop();
    const children = allCats.filter(c=>c.parent_id === id);
    items.push(...children);
    stack.push(...children.map(c=>c.id));
  }
  return items;
};

const shasSub = getSubtree(shasRoot.id);
const bavliSub = getSubtree(bavliRoot.id);

console.log(`Shas Tree: ${shasSub.length} items`);
console.log(`Bavli Tree: ${bavliSub.length} items`);

const shasNames = new Set(shasSub.map(c=>c.name));
const bavliNames = new Set(bavliSub.map(c=>c.name));
const overlap = [...bavliNames].filter(n => shasNames.has(n));

console.log(`Overlap count: ${overlap.length}`);
console.log(`Overlap sample: ${overlap.slice(0,20).join(', ')}`);

// Look for specific masechet name comparison
const target = "עירובין";
const shasTarget = shasSub.filter(c=>c.name === target);
const bavliTarget = bavliSub.filter(c=>c.name === target);

console.log(`\nTarget "${target}":`);
console.log(`  In Shas: ${shasTarget.length} nodes`);
shasTarget.forEach(t => {
  const p = allCats.find(c=>c.id === t.parent_id);
  console.log(`    - ID: ${t.id}, Parent: ${p?.name} (${p?.id})`);
});
console.log(`  In Bavli: ${bavliTarget.length} nodes`);
bavliTarget.forEach(t => {
  const p = allCats.find(c=>c.id === t.parent_id);
  console.log(`    - ID: ${t.id}, Parent: ${p?.name} (${p?.id})`);
});
