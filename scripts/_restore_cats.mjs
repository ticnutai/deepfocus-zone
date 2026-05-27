import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const sb=createClient('https://elfxevuxhffxskooppca.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVsZnhldnV4aGZmeHNrb29wcGNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MDY4NjgsImV4cCI6MjA5NTM4Mjg2OH0.5Rc6aZWpWeuvbO49paAXR1qNXdQk_H3stxb60Fce6TM');
const { data:auth, error } = await sb.auth.signInWithPassword({email:'jj1212t@gmail.com',password:'543211'});
if(error){console.error(error);process.exit(1);}
const UID=auth.user.id;
const D=JSON.parse(fs.readFileSync('/tmp/backup.json','utf8')).data;
const byId=new Map(D.categories.map(c=>[c.id,c]));
// compute depth
const depth=new Map();
function d(id){
  if(depth.has(id))return depth.get(id);
  const c=byId.get(id); if(!c||!c.parentId||!byId.has(c.parentId)){depth.set(id,0);return 0;}
  const r=d(c.parentId)+1; depth.set(id,r); return r;
}
D.categories.forEach(c=>d(c.id));
const sorted=[...D.categories].sort((a,b)=>depth.get(a.id)-depth.get(b.id));
console.log('max depth:',Math.max(...depth.values()),'total:',sorted.length);
const toIso=(t)=> t?new Date(t).toISOString():new Date().toISOString();
const rows=sorted.map(c=>({
  id:c.id,user_id:UID,name:c.name,parent_id:c.parentId??null,
  color:c.color??null,sort_order:c.sortOrder??0,
  created_at:toIso(c.createdAt),updated_at:toIso(c.updatedAt),deleted_at:null,
}));
// Insert level by level to respect FK
const byDepth=new Map();
rows.forEach(r=>{const dd=depth.get(r.id);if(!byDepth.has(dd))byDepth.set(dd,[]);byDepth.get(dd).push(r);});
const levels=[...byDepth.keys()].sort((a,b)=>a-b);
let totalOk=0,totalFail=0;
for(const lvl of levels){
  const arr=byDepth.get(lvl);
  console.log(`Depth ${lvl}: ${arr.length} rows`);
  for(let i=0;i<arr.length;i+=500){
    const chunk=arr.slice(i,i+500);
    const { error } = await sb.from('categories').upsert(chunk,{onConflict:'id'});
    if(error){console.error(`  err depth ${lvl} chunk ${i}: ${error.message}`); totalFail+=chunk.length;}
    else totalOk+=chunk.length;
  }
}
console.log(`✅ ${totalOk}  ❌ ${totalFail}`);
const { count } = await sb.from('categories').select('*',{count:'exact',head:true}).is('deleted_at',null);
console.log('categories in cloud now:',count);
