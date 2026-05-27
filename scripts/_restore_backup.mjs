import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const URL='https://elfxevuxhffxskooppca.supabase.co';
const KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVsZnhldnV4aGZmeHNrb29wcGNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MDY4NjgsImV4cCI6MjA5NTM4Mjg2OH0.5Rc6aZWpWeuvbO49paAXR1qNXdQk_H3stxb60Fce6TM';
const EMAIL=process.env.EMAIL||'jj1212t@gmail.com';
const PASS=process.env.PASS||'543211';

const sb=createClient(URL,KEY);
const { data:auth, error:aerr } = await sb.auth.signInWithPassword({email:EMAIL,password:PASS});
if(aerr){console.error('login fail:',aerr.message);process.exit(1);}
const UID=auth.user.id;
console.log('Logged in as',UID,EMAIL);

const raw=JSON.parse(fs.readFileSync('/tmp/backup.json','utf8'));
const D=raw.data;
console.log('Loaded backup: cats=',D.categories.length,'decks=',D.decks.length,'cards=',D.cards.length);

const toIso=(ts)=> ts ? new Date(typeof ts==='number'?ts:ts).toISOString() : new Date().toISOString();

async function batchUpsert(table, rows, size, onConflict){
  let ok=0,fail=0;
  for(let i=0;i<rows.length;i+=size){
    const chunk=rows.slice(i,i+size);
    const { error } = await sb.from(table).upsert(chunk,{onConflict});
    if(error){
      console.error(`  ${table} chunk ${i}: ${error.message}`);
      fail+=chunk.length;
    } else ok+=chunk.length;
    if(i%(size*10)===0) console.log(`  ${table} ${i+chunk.length}/${rows.length}`);
  }
  console.log(`${table}: ✅${ok} ❌${fail}`);
}

// Categories
const cats=D.categories.map(c=>({
  id:c.id,user_id:UID,name:c.name,parent_id:c.parentId??null,
  color:c.color??null,sort_order:c.sortOrder??0,
  created_at:toIso(c.createdAt),updated_at:toIso(c.updatedAt),deleted_at:null,
}));
console.log('Upserting categories...');
await batchUpsert('categories',cats,500,'id');

// Decks
const decks=D.decks.map(d=>({
  id:d.id,user_id:UID,name:d.name,color:d.color??'gold',
  description:d.description??null,
  category_ids:d.categoryIds??[],
  include_sub_categories:d.includeSubCategories!==false,
  created_at:toIso(d.createdAt),updated_at:toIso(d.updatedAt),deleted_at:null,
}));
console.log('Upserting decks...');
await batchUpsert('decks',decks,200,'id');

// Cards
const cards=D.cards.map(c=>({
  id:c.id,user_id:UID,deck_id:c.deckId??null,type:c.type,
  question:c.question,answer:c.answer??null,options:c.options??null,
  correct_indices:c.correctIndices??null,correct_boolean:c.correctBoolean??null,
  explanation:c.explanation??null,tags:c.tags??[],srs:c.srs??{},stats:c.stats??{correct:0,incorrect:0,totalReviews:0},
  masechta:c.masechta??null,daf:c.daf??null,amud:c.amud??null,
  sort_order:c.sortOrder??0,
  created_at:toIso(c.createdAt),updated_at:toIso(c.updatedAt),
}));
console.log('Upserting cards...');
await batchUpsert('cards',cards,150,'id');

// Verification
const { count: catC } = await sb.from('categories').select('*',{count:'exact',head:true}).is('deleted_at',null);
const { count: deckC } = await sb.from('decks').select('*',{count:'exact',head:true}).is('deleted_at',null);
const { count: cardC } = await sb.from('cards').select('*',{count:'exact',head:true});
console.log('═══════════════════════');
console.log(`Cloud now has: categories=${catC} decks=${deckC} cards=${cardC}`);
