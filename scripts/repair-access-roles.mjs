import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const runner=fs.readFileSync('scripts/run-migration.mjs','utf8');
const value=name=>runner.match(new RegExp('const '+name+' = (?:process.env.[A-Z_]+ \\|\\| )?[\\x27\\x22]([^\\x27\\x22]+)'))?.[1];
const url=value('SUPABASE_URL');
if(url!=='https://elfxevuxhffxskooppca.supabase.co') throw Error('Unexpected backend');
const cloud=createClient(url,value('SUPABASE_ANON_KEY'),{auth:{persistSession:false}});
const login=await cloud.auth.signInWithPassword({email:process.env.ADMIN_EMAIL||value('ADMIN_EMAIL'),password:process.env.ADMIN_PASSWORD||value('ADMIN_PASSWORD')});
if(login.error) throw Error('Administrator authentication failed');
try {
  const reads=await Promise.all([
    cloud.from('app_roles').select('*'),cloud.from('role_permissions').select('*'),
    cloud.from('user_roles').select('user_id,role_id'),cloud.from('user_permission_overrides').select('*'),
    cloud.from('site_settings').select('key,value').or('key.like.role_layout_%,key.like.feature_blocklist_%'),
  ]);
  if(reads.some(r=>r.error)) throw Error('Backup read failed');
  const [roles,permissions,memberships,overrides,settings]=reads.map(r=>r.data);
  const adminId=roles.find(r=>r.name==='admin')?.id, baselineId=roles.find(r=>r.access_kind==='registered')?.id;
  if(!adminId||!baselineId) throw Error('Canonical roles missing');
  const admins=new Set(memberships.filter(r=>r.role_id===adminId).map(r=>r.user_id));
  const baseline=new Map(permissions.filter(r=>r.role_id===baselineId).map(r=>[r.module+':'+r.action,r.allowed]));
  const targets=[...new Set(overrides.filter(r=>!admins.has(r.user_id)&&r.allowed&&!baseline.get(r.module+':'+r.action)).map(r=>r.user_id))];
  fs.mkdirSync('output/access-roles',{recursive:true});
  if(process.argv.includes('--backup')||process.argv.includes('--apply')) {
    if(targets.length!==2) throw Error('Target set changed: expected two non-admin override users; re-audit');
    const file='output/access-roles/pre-repair-'+Date.now()+'.json';
    fs.writeFileSync(file,JSON.stringify({project:url,targets,roles,permissions,memberships,overrides:overrides.filter(r=>targets.includes(r.user_id)),settings},null,2));
    console.log(JSON.stringify({backup:file,targetCount:targets.length,overrideRows:overrides.filter(r=>targets.includes(r.user_id)).length}));
  }
  if(process.argv.includes('--apply')) {
    const file='supabase/migrations/20260908010000_enforce_access_profiles.sql';
    const {data,error}=await cloud.rpc('exec_sql',{query:fs.readFileSync(file,'utf8')});
    if(error||!data?.success) throw Error('Migration failed: '+(error?.message||data?.error));
    console.log(JSON.stringify({migration:file,result:data}));
  }
  if(process.argv.includes('--verify')) {
    if(targets.length!==0) throw Error('Old elevated personal overrides remain');
    const queries=[
      [20,"SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname IN ('access_role_view','access_role_create','access_role_edit','access_role_delete') AND tablename IN ('cards','decks','categories','card_decks','goals') AND permissive='RESTRICTIVE'"],
      [0,"SELECT 1 FROM auth.users u WHERE NOT public.is_admin(u.id) AND EXISTS (SELECT 1 FROM public.role_permissions p JOIN public.app_roles r ON r.id=p.role_id WHERE r.access_kind='registered' AND NOT p.allowed AND public.has_permission(u.id,p.module,p.action))"],
      [1,"SELECT 1 FROM public.access_role_repair_backups WHERE id='20260908010000'"],
      [0,"SELECT 1 FROM public.site_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value) x WHERE s.key IN ('role_layout_profile_assignments_v1','feature_blocklist_role_assignments_v1','role_layout_profile_assignments_mobile_v1','feature_blocklist_role_assignments_mobile_v1') AND NOT EXISTS(SELECT 1 FROM public.app_roles r WHERE r.id::text=x->>'roleId')"],
      [0,"SELECT 1 FROM public.site_settings a JOIN public.site_settings b ON b.key=replace(a.key,'role_layout_profile_assignments','feature_blocklist_role_assignments') CROSS JOIN LATERAL jsonb_array_elements(a.value) x CROSS JOIN LATERAL jsonb_array_elements(b.value) y WHERE a.key IN ('role_layout_profile_assignments_v1','role_layout_profile_assignments_mobile_v1') AND x->>'roleId'=y->>'roleId' AND x->>'profileId'<>y->>'profileId'"],
    ];
    for(const [expected,query] of queries){const {data,error}=await cloud.rpc('exec_sql',{query});if(error||!data?.success||data.rows_affected!==expected)throw Error('Post-migration invariant failed');}
    console.log(JSON.stringify({verified:true,elevatedNonAdminUsers:0,restrictivePolicies:20,recoverableBackup:true}));
  }
} finally {await cloud.auth.signOut({scope:'local'});}
