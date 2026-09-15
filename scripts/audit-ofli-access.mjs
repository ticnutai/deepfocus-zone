// Read-only cloud audit. No role/profile/content writes and no session changes on devices.
import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const runner=fs.readFileSync('scripts/run-migration.mjs','utf8');
const value=name=>runner.match(new RegExp('const '+name+' = (?:process.env.[A-Z_]+ \\|\\| )?[\\x27\\x22]([^\\x27\\x22]+)'))?.[1];
const url=value('SUPABASE_URL');
if(url!=='https://elfxevuxhffxskooppca.supabase.co') throw Error('Unexpected project');
const cloud=createClient(url,value('SUPABASE_ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const login=await cloud.auth.signInWithPassword({email:process.env.ADMIN_EMAIL||value('ADMIN_EMAIL'),password:process.env.ADMIN_PASSWORD||value('ADMIN_PASSWORD')});
if(login.error) throw Error('Administrator audit authentication failed');
async function read(query){const {data,error}=await query;if(error)throw Error(error.message);return data;}
try{
 const roles=await read(cloud.from('app_roles').select('id,name,access_kind'));
 const target=roles.find(r=>r.name==='אופלי');
 if(!target) throw Error('Ofli role not found');
 const memberships=await read(cloud.from('user_roles').select('user_id,role_id'));
 const ids=memberships.filter(u=>u.role_id===target.id).map(u=>u.user_id);
 const profiles=ids.length?await read(cloud.from('profiles').select('id,display_name,role_baseline_enabled').in('id',ids)):[];
 const relevantIds=[target.id,...roles.filter(r=>r.access_kind==='registered').map(r=>r.id)];
 const rules=await read(cloud.from('role_content_access').select('*').in('role_id',relevantIds));
 const layouts=await read(cloud.from('site_settings').select('key,value').in('key',['role_layout_profiles_v1','role_layout_profiles_mobile_v1','role_layout_profile_assignments_v1','role_layout_profile_assignments_mobile_v1']));
 const selectedLayouts=['v1','mobile_v1'].map(scope=>{
  const links=layouts.find(l=>l.key===`role_layout_profile_assignments_${scope}`)?.value??[];
  const link=links.find(l=>l.roleId===target.id);
  const profile=layouts.find(l=>l.key===`role_layout_profiles_${scope}`)?.value?.find(p=>p.id===link?.profileId);
  return {scope,profile:profile?{id:profile.id,name:profile.name,contentAccess:profile.contentAccess}:null};
 });
 console.log(JSON.stringify({role:target,users:profiles.map(p=>({...p,assignedRoles:memberships.filter(u=>u.user_id===p.id).map(u=>roles.find(r=>r.id===u.role_id)?.name)})),rules,layouts:selectedLayouts},null,2));
 const catalog=process.argv.includes('--sources')?await read(cloud.rpc('get_admin_question_source_tags')):[];
 for(const profile of profiles){
  if(!/^[a-f0-9-]{36}$/.test(profile.id))throw Error('Invalid target');
  const prefix=`SELECT set_config('request.jwt.claim.sub','${profile.id}',true); SELECT set_config('request.jwt.claims','${JSON.stringify({sub:profile.id,role:'authenticated'})}',true);`;
  for(const [check,sql] of [
   ['effective_role_count',`SELECT 1 FROM public.effective_access_role_ids('${profile.id}')`],
   ['shemesh_explicitly_selected',`SELECT 1 WHERE 'shemesh'=ANY(public.get_effective_question_source_tags())`],
   ['central_library_enabled',`SELECT 1 WHERE (public.get_effective_content_access()->>'include_site_library')::boolean`],
   ['first_page_total',`SELECT 1 FROM jsonb_array_elements(public.get_content_unreviewed_cards_page(0,1000)) c`],
   ['first_page_shemesh',`SELECT 1 FROM jsonb_array_elements(public.get_content_unreviewed_cards_page(0,1000)) c WHERE public.question_source_ids(c->'tags') && ARRAY['shemesh']`],
   ['bootstrap_shemesh',`SELECT 1 FROM jsonb_array_elements(public.get_content_overlay_snapshot()->'cards') c WHERE public.question_source_ids(c->'tags') && ARRAY['shemesh']`],
   ['all_shared_matching_shemesh',`SELECT 1 FROM public.cards c WHERE c.deleted_at IS NULL AND c.tags ? 'source:shemesh' AND public.matches_shared_question_access(c.tags,coalesce(c.created_by,c.user_id),c.user_id,c.moderation_status::text,(SELECT public.get_effective_content_access()))`],
  ]){
   if(process.argv.includes('--source-counts-only'))continue;
   const {data,error}=await cloud.rpc('exec_sql',{query:prefix+sql});
   if(error||data?.success!==true)throw Error(check+': '+(error?.message??data?.error));
   console.log(JSON.stringify({user:profile.display_name,check,count:data.rows_affected}));
   if(process.argv.includes('--verify') && ['first_page_shemesh','bootstrap_shemesh','all_shared_matching_shemesh'].includes(check) && data.rows_affected!==0) throw Error('Unexpected Shemesh access');
  }
  for(const source of catalog){
   const literal="'"+source.source_id.replaceAll("'","''")+"'";
   const sql=`SELECT 1 FROM public.cards c WHERE c.deleted_at IS NULL AND ${literal}=ANY(public.question_source_ids(c.tags)) AND public.matches_shared_question_access(c.tags,coalesce(c.created_by,c.user_id),c.user_id,c.moderation_status::text,(SELECT public.get_effective_content_access()))`;
   const {data,error}=await cloud.rpc('exec_sql',{query:prefix+sql});
   if(error||data?.success!==true)throw Error('source audit: '+(error?.message??data?.error));
   console.log(JSON.stringify({user:profile.display_name,source:source.source_id,total:Number(source.question_count),allowed:data.rows_affected}));
   if(source.source_id==='yeshiva'){
    for(const [diagnostic,extra] of [
     ['approved',"c.moderation_status::text IN ('reviewed','published')"],
     ['allowed_without_approval_filter',"public.matches_shared_question_access(c.tags,coalesce(c.created_by,c.user_id),c.user_id,c.moderation_status::text,(SELECT public.get_effective_content_access()) || '{\"approved_only\":false}'::jsonb)"],
    ]){
     const result=await cloud.rpc('exec_sql',{query:prefix+`SELECT 1 FROM public.cards c WHERE c.deleted_at IS NULL AND ${literal}=ANY(public.question_source_ids(c.tags)) AND ${extra}`});
     if(result.error||result.data?.success!==true)throw Error('Diagnostic failed');
     console.log(JSON.stringify({source:source.source_id,diagnostic,count:result.data.rows_affected}));
    }
   }
  }
 }
}finally{await cloud.auth.signOut();}
