import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const runner=fs.readFileSync('scripts/run-migration.mjs','utf8');
const value=name=>runner.match(new RegExp('const '+name+' = (?:process.env.[A-Z_]+ \\|\\| )?[\\x27\\x22]([^\\x27\\x22]+)'))?.[1];
if(value('SUPABASE_URL')!=='https://elfxevuxhffxskooppca.supabase.co')throw Error('Unexpected backend');
const cloud=createClient(value('SUPABASE_URL'),value('SUPABASE_ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const login=await cloud.auth.signInWithPassword({email:process.env.ADMIN_EMAIL||value('ADMIN_EMAIL'),password:process.env.ADMIN_PASSWORD||value('ADMIN_PASSWORD')});
if(login.error)throw Error('Authentication failed');
try{for(let i=0;i<3;i++){const start=performance.now();const {data,error,status}=await cloud.rpc('get_admin_question_source_tags');console.log(JSON.stringify({attempt:i+1,milliseconds:Math.round(performance.now()-start),status,rows:data?.length,error:error?{code:error.code,message:error.message}:null}));}}finally{await cloud.auth.signOut();}
