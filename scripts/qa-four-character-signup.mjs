// Live, isolated test accounts only. No credentials or sessions are printed.
import fs from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const runner=fs.readFileSync('scripts/run-migration.mjs','utf8');
const value=name=>runner.match(new RegExp('const '+name+' = (?:process.env.[A-Z_]+ \\|\\| )?[\\x27\\x22]([^\\x27\\x22]+)'))?.[1];
const url=value('SUPABASE_URL');if(url!=='https://elfxevuxhffxskooppca.supabase.co')throw Error('Unexpected backend');
const make=()=>createClient(url,value('SUPABASE_ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const admin=make();const auth=await admin.auth.signInWithPassword({email:process.env.ADMIN_EMAIL||value('ADMIN_EMAIL'),password:process.env.ADMIN_PASSWORD||value('ADMIN_PASSWORD')});
if(auth.error)throw Error('Admin authentication failed');
const password='1234';const suffix=randomBytes(8).toString('hex');
try{
 for(const mode of ['email','username']){
  const client=make(),second=make();const username=`qa.short.${mode}.${suffix}`;let email=`${username}@example.com`;let id;
  try{
   if(mode==='email'){
    const result=await client.auth.signUp({email,password,options:{data:{username,display_name:'Temporary signup QA'}}});
    id=result.data.user?.id;
    if(result.error){console.log(JSON.stringify({mode,stage:'signup',passed:false,message:result.error.message}));continue;}
    console.log(JSON.stringify({mode,stage:'signup',passed:true,immediateSession:Boolean(result.data.session),emailConfirmed:Boolean(result.data.user?.email_confirmed_at)}));
   }else{
    const result=await client.rpc('register_username_account',{p_username:username,p_password:password,p_display_name:'Temporary signup QA',p_recovery_hash:createHash('sha256').update(randomBytes(24)).digest('hex')});
    if(result.error){console.log(JSON.stringify({mode,stage:'signup',passed:false,message:result.error.message}));continue;}
    email=result.data;
   }
   const login=await second.auth.signInWithPassword({email,password});id??=login.data.user?.id;
   console.log(JSON.stringify({mode,stage:'independent-login',passed:!login.error,session:Boolean(login.data.session),emailConfirmed:Boolean(login.data.user?.email_confirmed_at),message:login.error?.message}));
  }finally{
   // Resolve this exact random fixture even if signup succeeded but login failed.
   if(!id){const result=await admin.from('profiles').select('id').eq('username',username).maybeSingle();if(result.error)throw Error('Cannot resolve fixture for cleanup');id=result.data?.id;}
   if(id){const result=await admin.rpc('admin_delete_user',{p_user_id:id});if(result.error)throw Error('Fixture cleanup failed');const verify=await admin.from('profiles').select('id').eq('id',id);if(verify.error||verify.data.length)throw Error('Cleanup verification failed');console.log(JSON.stringify({mode,cleanup:'verified'}));}
   await client.auth.signOut();await second.auth.signOut();
  }
 }
}finally{await admin.auth.signOut();}
