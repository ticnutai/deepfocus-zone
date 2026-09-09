// Read-only role audit: live metadata/counts plus isolated execution of current callbacks.
import fs from 'node:fs';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
const output = 'output/access-roles/boundary-audit.json';
const findings = [];
const storeText = fs.readFileSync('src/lib/study/store.ts', 'utf8');
const source = ts.createSourceFile('store.ts', storeText, ts.ScriptTarget.Latest, true);
function declaration(name) {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found?.initializer) throw Error('Audit target not found: ' + name);
  return found;
}
function callback(name, dependencies) {
  const decl = declaration(name);
  const js = ts.transpileModule('const target = ' + decl.initializer.getText(source) + ';', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), js + '\nreturn target;')(...Object.values(dependencies));
}
let state = { cardDecks: [{cardId:'audit-card',deckId:'audit-deck'}], decks:[{id:'audit-deck',categoryIds:['old'],includeSubCategories:true}] };
const query = new Proxy({}, {get: (_target,key) => key === 'then' ? undefined : () => query});
const dependencies = {
  useCallback: fn => fn, setState: fn => {state = fn(state);}, requireUser: () => 'guest',
  supabase: {from: () => query}, bg: () => {}, can: () => false,
};
for (const [operation,args,read] of [
  ['removeCardFromDeck',['audit-card','audit-deck'],() => state.cardDecks],
  ['updateDeckCategoryIds',['audit-deck',['new'],false],() => state.decks],
]) {
  // Check the actual exported hook entry is unwrapped, not just the inner callback.
  const hook = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'useStudy');
  const exported = hook.body.statements.filter(ts.isReturnStatement).at(-1).expression.properties
    .find(p => p.name?.getText(source) === operation);
  if (!exported || !ts.isPropertyAssignment(exported) || !ts.isCallExpression(exported.initializer) || exported.initializer.expression.getText(source) !== 'guard') throw Error(operation + ' is not guarded');
  const before=JSON.stringify(read());
  const guardSource = fs.readFileSync('src/lib/auth/studyActionGuard.ts','utf8').replace(/^import .*$/gm, '').replace(/export /g,'');
  const guardJs = ts.transpileModule(guardSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const guard = new Function('isRolePreview',guardJs+';return createStudyActionGuard;')(() => false)(() => () => false, () => {});
  const fn = new Function('guard',operation,'return '+exported.initializer.getText(source))(guard, callback(operation,dependencies));
  let blocked=false; try { fn(...args); } catch { blocked=true; }
  if(!blocked || JSON.stringify(read())!==before) throw Error(operation+' mutated denied data');
  findings.push({check:operation,permissionGranted:false,mutated:JSON.stringify(read())!==before,
    line:source.getLineAndCharacterOfPosition(declaration(operation).pos).line+1});
}
if(storeText.includes('persistPreviewRoleScopedLayout') || storeText.includes('__previewRoleId')) throw Error('Legacy preview writer remains');
findings.push({check:'preview writer removed',passed:true});

const runner=fs.readFileSync('scripts/run-migration.mjs','utf8');
const value=name=>runner.match(new RegExp('const '+name+' = (?:process.env.[A-Z_]+ \\|\\| )?[\\x27\\x22]([^\\x27\\x22]+)'))?.[1];
const url=value('SUPABASE_URL');
if(url!=='https://elfxevuxhffxskooppca.supabase.co') throw Error('Unexpected backend');
const cloud=createClient(url,value('SUPABASE_ANON_KEY'),{auth:{persistSession:false}});
const login=await cloud.auth.signInWithPassword({email:process.env.ADMIN_EMAIL||value('ADMIN_EMAIL'),password:process.env.ADMIN_PASSWORD||value('ADMIN_PASSWORD')});
if(login.error) throw Error('Administrator audit login failed');
const reads=[];
try {
  const checks=[
    ['non_admin_users_exceeding_registered_baseline', `SELECT 1 FROM auth.users u WHERE NOT public.is_admin(u.id) AND EXISTS (SELECT 1 FROM public.role_permissions p JOIN public.app_roles r ON r.id=p.role_id WHERE r.access_kind='registered' AND NOT p.allowed AND public.has_permission(u.id,p.module,p.action))`],
    ['non_admin_users_with_admin_module_permissions', `SELECT 1 FROM auth.users u WHERE NOT public.is_admin(u.id) AND (public.has_permission(u.id,'users','manage') OR public.has_permission(u.id,'roles','manage'))`],
    ['non_admin_custom_role_assignments', `SELECT 1 FROM public.user_roles ur JOIN public.app_roles r ON r.id=ur.role_id WHERE r.access_kind IS NULL AND NOT public.is_admin(ur.user_id)`],
    ['personal_overrides_for_non_admins', `SELECT 1 FROM public.user_permission_overrides p WHERE NOT public.is_admin(p.user_id)`],
  ];
  for(const table of ['cards','decks','categories','card_decks','goals','role_permissions','app_roles','user_roles','site_settings']) {
    checks.push([table+':rls_enabled',`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='${table}' AND c.relrowsecurity`]);
    checks.push([table+':write_policies_using_permissions',`SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='${table}' AND cmd<>'SELECT' AND (COALESCE(qual,'')||COALESCE(with_check,'')) ILIKE '%has_permission%'`]);
    checks.push([table+':ownership_only_write_policies',`SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='${table}' AND cmd<>'SELECT' AND (COALESCE(qual,'')||COALESCE(with_check,'')) ILIKE '%auth.uid()%user_id%' AND (COALESCE(qual,'')||COALESCE(with_check,'')) NOT ILIKE '%has_permission%' AND (COALESCE(qual,'')||COALESCE(with_check,'')) NOT ILIKE '%is_admin%'`]);
    checks.push([table+':permissive_all_owner_only',`SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='${table}' AND cmd='ALL' AND permissive='PERMISSIVE' AND replace(qual,' ','') IN ('(auth.uid()=user_id)','(user_id=auth.uid())') AND (with_check IS NULL OR replace(with_check,' ','') IN ('(auth.uid()=user_id)','(user_id=auth.uid())'))`]);
    checks.push([table+':restrictive_write_policies',`SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='${table}' AND cmd<>'SELECT' AND permissive='RESTRICTIVE'`]);
    checks.push([table+':write_policies_using_admin_check',`SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='${table}' AND cmd<>'SELECT' AND (COALESCE(qual,'')||COALESCE(with_check,'')) ILIKE '%is_admin%'`]);
  }
  for(const [check,query] of checks) {
    const {data,error}=await cloud.rpc('exec_sql',{query});
    if(error || !data?.success) throw Error('Read-only catalog audit failed: '+check);
    reads.push({check,matches:data.rows_affected});
  }
} finally { await cloud.auth.signOut({scope:'local'}); }
fs.mkdirSync('output/access-roles',{recursive:true});
fs.writeFileSync(output,JSON.stringify({checkedAt:new Date().toISOString(),sourceMutations:0,cloudMutations:0,findings,reads},null,2));
console.log(JSON.stringify({findings,reads,report:output},null,2));
