// Read-only deployment audit. Uses the project's existing migration-runner login.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const runner = fs.readFileSync(new URL('./run-migration.mjs', import.meta.url), 'utf8');
const value = (name) => runner.match(new RegExp('const ' + name + ' = (?:process.env.[A-Z_]+ \\|\\| )?[\\x27\\x22]([^\\x27\\x22]+)'))?.[1];
const url = value('SUPABASE_URL');
if (url !== 'https://elfxevuxhffxskooppca.supabase.co') throw Error('Unexpected backend');
const client = createClient(url, value('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
const anon = createClient(url, value('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
const { error } = await client.auth.signInWithPassword({
  email: process.env.ADMIN_EMAIL || value('ADMIN_EMAIL'),
  password: process.env.ADMIN_PASSWORD || value('ADMIN_PASSWORD'),
});
if (error) throw Error('Migration administrator authentication failed');
try {
  const keys = ['role_layout_profiles_v1','role_layout_profile_assignments_v1','feature_blocklist_profiles_v1','feature_blocklist_role_assignments_v1',
    'role_layout_profiles_mobile_v1','role_layout_profile_assignments_mobile_v1','feature_blocklist_profiles_mobile_v1','feature_blocklist_role_assignments_mobile_v1'];
  const reads = await Promise.all([
    client.from('app_roles').select('*'),
    client.from('role_permissions').select('*'),
    client.from('site_settings').select('key,value').in('key', keys),
  ]);
  if (reads.some((read) => read.error)) throw Error('Role audit read failed');
  const [roles, permissions, settings] = reads.map((read) => read.data);
  const baseline = roles.find((role) => role.name === 'משתמש רשום');
  if (!baseline) throw Error('Registered baseline missing');
  const matrix = (id) => Object.fromEntries(permissions.filter((p) => p.role_id === id)
    .sort((a,b) => `${a.module}:${a.action}`.localeCompare(`${b.module}:${b.action}`))
    .map((p) => [`${p.module}:${p.action}`, p.allowed]));
  fs.mkdirSync('output/access-roles', { recursive: true });
  if (process.argv.includes('--before')) {
    const path = `output/access-roles/before-${Date.now()}.json`;
    fs.writeFileSync(path, JSON.stringify({ project: url, roles, permissions, settings }, null, 2));
    console.log(JSON.stringify({ backup: path, roles: roles.map(({name,id}) => ({name,id})), baseline: matrix(baseline.id), settings: settings.map(({key,value}) => ({key,count:Array.isArray(value)?value.length:null})) }));
  } else {
    const { data: policy, error: policyError } = await anon.rpc('get_access_role_policy');
    if (policyError) throw Error(`Public role policy unavailable: ${policyError.code} ${policyError.message}`);
    const kinds = ['registered','anonymous_online','registered_offline','anonymous_offline'];
    for (const kind of kinds) {
      const role = roles.find((role) => role.access_kind === kind);
      if (!role || policy[kind]?.id !== role.id) throw Error(`Missing or duplicated kind: ${kind}`);
      if (process.argv.includes('--initial') && JSON.stringify(matrix(role.id)) !== JSON.stringify(matrix(baseline.id))) throw Error(`Initial permissions differ: ${kind}`);
      if (policy[kind].matrix['roles:manage'] || policy[kind].matrix['users:manage']) throw Error('Unexpected admin privileges');
    }
    if (policy.admin) throw Error('Administrator leaked into public policy');
    const { data: session } = await client.auth.getSession();
    const admin = await client.rpc('has_permission', {_user_id:session.session.user.id,_module:'roles',_action:'manage'});
    if (admin.error || admin.data !== true) throw Error('Administrator permission failed');
    const denied = await anon.rpc('has_permission', {_user_id:null,_module:'roles',_action:'manage'});
    if (!denied.error && denied.data === true) throw Error('Anonymous administrator access');
    fs.writeFileSync('output/access-roles/verified-policy.json', JSON.stringify(policy, null, 2));
    console.log(JSON.stringify({ verified: kinds, roleCount:roles.length, admin:true, anonymousAdmin:false, baseline:matrix(baseline.id), policy }));
  }
} finally { await client.auth.signOut({scope:'local'}); }
