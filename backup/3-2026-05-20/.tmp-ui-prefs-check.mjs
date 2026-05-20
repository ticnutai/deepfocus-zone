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
const login = await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });
if (login.error) { console.error('LOGIN_ERR', login.error.message); process.exit(1); }
const uid = login.data.user?.id;
const { data, error } = await sb.from('user_settings').select('ui_prefs').eq('user_id', uid).maybeSingle();
if (error) { console.error('DB_ERR', error.message); process.exit(1); }
console.log(JSON.stringify(data?.ui_prefs ?? null));
