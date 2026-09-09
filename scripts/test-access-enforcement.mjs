// Real RLS checks against one explicitly created, disposable QA account.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const runner=fs.readFileSync('scripts/run-migration.mjs','utf8');
const value=name=>runner.match(new RegExp('const '+name+' = (?:process.env.[A-Z_]+ \\|\\| )?[\\x27\\x22]([^\\x27\\x22]+)'))?.[1];
const url=value('SUPABASE_URL');
assert.equal(url,'https://elfxevuxhffxskooppca.supabase.co');
const client=()=>createClient(url,value('SUPABASE_ANON_KEY'),{auth:{persistSession:false}});
const admin=client(), user=client();
const login=await admin.auth.signInWithPassword({email:process.env.ADMIN_EMAIL||value('ADMIN_EMAIL'),password:process.env.ADMIN_PASSWORD||value('ADMIN_PASSWORD')});
if(login.error) throw Error('Admin authentication failed');
const results=[]; let uid=null, testRole=null; const pid='qa-access-'+randomUUID(); let profileCreated=false;
const check=(name)=>results.push({name,passed:true});
const ok=r=>{if(r.error)throw Error(r.error.message);return r.data;};
const override=async(action,allowed)=>ok(await admin.from('user_permission_overrides').upsert({user_id:uid,module:'cards',action,allowed,set_by:login.data.user.id},{onConflict:'user_id,module,action'}));
try {
  const email='qa-access-'+randomUUID()+'@example.invalid', password=randomUUID()+'aA9!';
  uid=ok(await admin.rpc('admin_create_user',{p_email:email,p_password:password,p_display_name:'בדיקת הרשאות זמנית',p_role_name:'משתמש רשום',p_status:'approved',p_username:null}));
  fs.mkdirSync('output/access-roles',{recursive:true});
  fs.writeFileSync('output/access-roles/temporary-qa-account.json',JSON.stringify({id:uid,cleanupRequired:true}));
  ok(await user.auth.signInWithPassword({email,password}));
  assert.equal(ok(await user.rpc('has_permission',{_user_id:uid,_module:'roles',_action:'manage'})),false);
  check('registered account has no administrator access');
  const id=randomUUID();
  ok(await user.from('cards').insert({id,user_id:uid,question:'QA disposable card',type:'flashcard'}));
  check('baseline permits own card creation');
  await override('create',false);
  assert((await user.from('cards').insert({id:randomUUID(),user_id:uid,question:'Must be rejected',type:'flashcard'})).error);
  check('server rejects disabled create');
  await override('edit',false);
  assert((await user.from('cards').update({question:'Must not change'}).eq('id',id)).error);
  check('server rejects disabled content edit');
  ok(await user.from('cards').update({stats:{reviews:1}}).eq('id',id));
  check('view-only learning progress remains writable');
  await override('delete',false);
  assert((await user.from('cards').update({deleted_at:new Date().toISOString()}).eq('id',id)).error);
  assert.equal(ok(await user.from('cards').delete().eq('id',id).select('id')).length,0);
  check('server rejects both soft and hard deletion');
  await override('view',false);
  assert.equal(ok(await user.from('cards').select('id').eq('id',id)).length,0);
  check('server hides data when view is denied');
  await override('view',true); await override('delete',true);
  ok(await user.from('cards').update({deleted_at:new Date().toISOString()}).eq('id',id));
  check('delete permission works without content-edit permission');
  assert((await user.rpc('admin_save_access_profile',{p_scope:'desktop',p_layout:{id:pid,name:'Forbidden'},p_block:{id:pid},p_role_ids:[]})).error);
  check('nonadministrator cannot save access profiles');
  const payload={p_scope:'desktop',p_layout:{id:pid,name:'בדיקת שמירה אטומית',widgetLayout:{},sidebarConfig:[],categoryTemplate:[],actionPermissions:{}},p_block:{id:pid,name:'בדיקה',blocklist:{sections:[],widgets:{}}},p_role_ids:[],p_permissions:null,p_expected_permissions:null,p_expected_updated_at:null};
  ok(await admin.rpc('admin_save_access_profile',payload)); profileCreated=true;
  const stored=ok(await admin.from('site_settings').select('value').eq('key','role_layout_profiles_v1').single()).value.find(p=>p.id===pid);
  assert(stored?.updatedAt);
  const stale=await admin.rpc('admin_save_access_profile',payload);
  assert(stale.error); check('stale profile writes rejected atomically');
  ok(await admin.rpc('admin_save_access_profile',{...payload,p_layout:{...payload.p_layout,name:'שם חדש בלבד'},p_expected_updated_at:stored.updatedAt}));
  check('profile rename uses one atomic server writer');
  const direct=await admin.from('site_settings').update({value:[]}).eq('key','role_layout_profiles_v1').select('key');
  assert(direct.error || direct.data.length===0);
  check('legacy direct profile writer cannot overwrite profiles');
  testRole=ok(await admin.from('app_roles').insert({name:'qa-role-'+randomUUID(),is_system:false}).select('id').single()).id;
  const initial=['view','edit'].map(action=>({role_id:testRole,module:'cards',action,allowed:true}));
  ok(await admin.from('role_permissions').insert(initial));
  const expected=Object.fromEntries(initial.map(r=>[r.role_id+':'+r.module+':'+r.action,r.allowed]));
  const current=ok(await admin.from('site_settings').select('value').eq('key','role_layout_profiles_v1').single()).value.find(p=>p.id===pid);
  ok(await admin.rpc('admin_save_access_profile',{...payload,p_role_ids:[testRole],p_permissions:initial.map(r=>({...r,allowed:false})),p_expected_permissions:expected,p_expected_updated_at:current.updatedAt}));
  assert(ok(await admin.from('role_permissions').select('allowed').eq('role_id',testRole)).every(r=>!r.allowed));
  check('assigned profile atomically changes only its role permissions');
  const updated=ok(await admin.from('site_settings').select('value').eq('key','role_layout_profiles_v1').single()).value.find(p=>p.id===pid);
  const conflict=await admin.rpc('admin_save_access_profile',{...payload,p_role_ids:[testRole],p_permissions:initial,p_expected_permissions:expected,p_expected_updated_at:updated.updatedAt});
  assert(conflict.error);
  assert(ok(await admin.from('role_permissions').select('allowed').eq('role_id',testRole)).every(r=>!r.allowed));
  check('stale permission snapshot cannot reenable denied actions');
} catch(error) {
  results.push({name:'live enforcement',passed:false,error:error.message}); process.exitCode=1;
} finally {
  if(profileCreated) {
    if(testRole) {
      const current=ok(await admin.from('site_settings').select('value').eq('key','role_layout_profiles_v1').single()).value.find(p=>p.id===pid);
      ok(await admin.rpc('admin_save_access_profile',{p_scope:'desktop',p_layout:current,p_block:{id:pid,name:'QA',blocklist:{sections:[],widgets:{}}},p_role_ids:[],p_permissions:[],p_expected_permissions:{},p_expected_updated_at:current.updatedAt}));
    }
    ok(await admin.rpc('admin_delete_access_profile',{p_scope:'desktop',p_profile_id:pid}));
  }
  if(testRole) ok(await admin.from('app_roles').delete().eq('id',testRole));
  if(uid) {
    ok(await admin.rpc('admin_delete_user',{p_user_id:uid}));
    assert.equal(ok(await admin.from('profiles').select('id').eq('id',uid)).length,0);
    assert.equal(ok(await admin.from('user_permission_overrides').select('id').eq('user_id',uid)).length,0);
    check('deleted account leaves no personal permission overrides');
    fs.writeFileSync('output/access-roles/temporary-qa-account.json',JSON.stringify({id:uid,cleanupRequired:false,deleted:true}));
  }
  await user.auth.signOut({scope:'local'}); await admin.auth.signOut({scope:'local'});
  fs.writeFileSync('output/access-roles/live-enforcement.json',JSON.stringify({results,temporaryDataRemoved:true},null,2));
}
console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results}));
