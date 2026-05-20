import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync('.env', 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#')).map(l => {
  const i = l.indexOf('=');
  const k = l.slice(0,i).trim();
  let v = l.slice(i+1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
  return [k,v];
}));

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
const { error: loginErr } = await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });
if (loginErr) {
  console.error('LOGIN_ERROR', loginErr.message);
  process.exit(1);
}

const { data: categories, error: catErr } = await sb
  .from('categories')
  .select('id,name,parent_id,deleted_at')
  .is('deleted_at', null)
  .order('name', { ascending: true })
  .limit(2000);

if (catErr) {
  console.error('CAT_ERROR', catErr.message);
  process.exit(1);
}

const interestingCats = (categories ?? []).filter((r) => /ש"ס|שס|מועד|יומא|פסחים|פ\.|דף פ|ע"א|ע"ב/.test(r.name));

const { data: cards, error: cardErr } = await sb
  .from('cards')
  .select('id,question,tags,masechta,daf,amud,updated_at')
  .order('updated_at', { ascending: false, nullsFirst: false })
  .limit(1000);

if (cardErr) {
  console.error('CARD_ERROR', cardErr.message);
  process.exit(1);
}

const interestingCards = (cards ?? []).filter((r) => {
  const tags = Array.isArray(r.tags) ? r.tags : [];
  return tags.some((t) => /^cat:/.test(t)) && tags.some((t) => /cat:יומא|cat:פסחים|cat:פ'|cat:פ\.|cat:דף פ/.test(t));
}).slice(0, 60);

console.log('=== CATEGORIES ===');
for (const r of interestingCats) console.log(JSON.stringify(r));
console.log('=== CARDS ===');
for (const r of interestingCards) console.log(JSON.stringify(r));
