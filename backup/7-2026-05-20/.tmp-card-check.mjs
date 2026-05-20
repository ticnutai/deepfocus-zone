import fs from "fs";
import { createClient } from "@supabase/supabase-js";
const envText = fs.readFileSync('.env', 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#')).map(l => {
  const i = l.indexOf('=');
  let v = l.slice(i+1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
  return [l.slice(0,i).trim(), v];
}));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });

const queries = [
  'מתי מצטרפין אוכלין ומשקין לשיעור אחד לחייב על אכילה ביוה"כ ? (פ)',
  'מה שיעור אוכל אוכלים טמאים לפסלו מלאכול בתמורה ? (פ)',
  'זר שאכל בשוגג תרומה אכילה גסה ? (פ)'
];

for (const q of queries) {
  const { data } = await sb.from('cards').select('id,question,tags,masechta,daf,amud,deck_id').ilike('question', `%${q.slice(0,20)}%`).limit(5);
  console.log('===', q, '===');
  for (const r of (data ?? [])) console.log(JSON.stringify(r));
}
