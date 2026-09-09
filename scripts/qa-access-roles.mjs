import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
const require = createRequire(import.meta.url);
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/jj121/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(path.join(runtime, 'playwright'));
const { expect } = require(path.join(runtime, 'playwright/test'));
const runner = fs.readFileSync(new URL('./run-migration.mjs', import.meta.url), 'utf8');
const value = (name) => runner.match(new RegExp('const ' + name + ' = (?:process.env.[A-Z_]+ \\|\\| )?[\\x27\\x22]([^\\x27\\x22]+)'))?.[1];
const cloud = createClient(value('SUPABASE_URL'), value('SUPABASE_ANON_KEY'), {auth:{persistSession:false}});
const browser = await chromium.launch({headless:true,channel:'msedge'});
const results = [];
const startedAt = Date.now();
const auditMobileConflict = process.argv.includes('--audit-mobile-conflict');
const mobileViewport = process.argv.includes('--mobile');
const targetUrl = process.env.QA_URL || 'http://localhost:5000/';
const isolatedWrites = [];
fs.mkdirSync('output/access-roles', {recursive:true});
async function expectIdentity(page, label, timeout=60000) {
  const locator=page.getByText(label,{exact:true}).first();
  if(mobileViewport) {
    // The compact mobile shell intentionally omits the desktop identity card.
    // Assert the loaded shell here; role mapping itself is covered by unit tests
    // and by the protected admin-route assertion below.
    await expect(page.getByRole('tab',{name:'תרגול',exact:true}).first()).toBeAttached({timeout});
  } else await expect(locator).toBeVisible({timeout});
}
async function contextFor(identity, session = null, coldOffline = false) {
  const savedSettings = new Map();
  const savedPermissions = new Map();
  if(session) {
    const [settings,permissions]=await Promise.all([
      cloud.from('site_settings').select('key,value').in('key',[
        'role_layout_profiles_v1','role_layout_profile_assignments_v1','feature_blocklist_profiles_v1','feature_blocklist_role_assignments_v1',
        'role_layout_profiles_mobile_v1','role_layout_profile_assignments_mobile_v1','feature_blocklist_profiles_mobile_v1','feature_blocklist_role_assignments_mobile_v1']),
      cloud.from('role_permissions').select('role_id,module,action,allowed'),
    ]);
    if(settings.error||permissions.error) throw Error('Profile fixture read failed');
    for(const row of settings.data) savedSettings.set(row.key,row.value);
    for(const row of permissions.data) savedPermissions.set(row.role_id+':'+row.module+':'+row.action,row);
  }
  const context = await browser.newContext({viewport:mobileViewport?{width:390,height:844}:{width:1440,height:1000},isMobile:mobileViewport,hasTouch:mobileViewport,locale:'he-IL',timezoneId:'Asia/Jerusalem'});
  context.setDefaultTimeout(15000);
  await context.addInitScript(({identity,session,coldOffline}) => {
    localStorage.setItem('guides-seen:v1','1');
    localStorage.setItem('active-tab','daf');
    if(session) localStorage.setItem('sb-elfxevuxhffxskooppca-auth-token',JSON.stringify(session));
    else {
      localStorage.setItem('guest-mode','1');
      localStorage.setItem('local-identity-kind',identity);
    }
    if(coldOffline) Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
  },{identity,session,coldOffline});
  // QA is read-only in the cloud, including automatic tracking/sync requests.
  await context.route('**/rest/v1/**', async (route) => {
    if(coldOffline) return route.abort();
    const request=route.request();
    const table = new URL(request.url()).pathname.split('/').at(-1);
    if(session && ['site_settings','role_permissions'].includes(table)) {
      if(request.method()==='GET' && (savedSettings.size || savedPermissions.size)) {
        const keyFilter=new URL(request.url()).searchParams.get('key');
        let rows=table==='site_settings' ? [...savedSettings].map(([key,value])=>({key,value})) : [...savedPermissions.values()];
        if(table==='site_settings' && keyFilter?.startsWith('eq.')) rows=rows.filter((row)=>row.key===keyFilter.slice(3));
        if(table==='site_settings' && keyFilter?.startsWith('in.')) rows=rows.filter((row)=>keyFilter.includes(row.key));
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)});
      }
      if(request.method()==='POST') {
        const data=request.postDataJSON();
        const rows=Array.isArray(data)?data:[data];
        for(const row of rows) {
          if(table==='site_settings') savedSettings.set(row.key,row.value);
          else savedPermissions.set(row.role_id+':'+row.module+':'+row.action,row);
        }
        isolatedWrites.push({table,rows});
        return route.fulfill({status:200,contentType:'application/json',body:'null'});
      }
    }
    const rpc = request.url().split('/rpc/')[1]?.split('?')[0];
    if (session && rpc === 'admin_save_access_profile') {
      const p = request.postDataJSON();
      const suffix = p.p_scope === 'mobile' ? '_mobile_v1' : '_v1';
      const stamp = Date.now();
      for (const [prefix, profile] of [['role_layout_profiles', p.p_layout], ['feature_blocklist_profiles', p.p_block]]) {
        const key = prefix + suffix;
        savedSettings.set(key, [...(savedSettings.get(key) || []).filter(row => row.id !== profile.id), {...profile, updatedAt: stamp}]);
      }
      for (const prefix of ['role_layout_profile_assignments', 'feature_blocklist_role_assignments']) {
        const key = prefix + suffix;
        savedSettings.set(key, [...(savedSettings.get(key) || []).filter(row => row.profileId !== p.p_layout.id && !p.p_role_ids.includes(row.roleId)),
          ...p.p_role_ids.map(roleId => ({id: crypto.randomUUID(), roleId, profileId: p.p_layout.id}))]);
      }
      if (p.p_permissions !== null) {
        for (const row of p.p_permissions) savedPermissions.set(row.role_id+':'+row.module+':'+row.action,row);
        isolatedWrites.push({table:'role_permissions', rows:p.p_permissions});
      }
      return route.fulfill({status:200,contentType:'application/json',body:'null'});
    }
    if(request.method()==='GET' || rpc?.startsWith('get_') || ['is_admin','has_permission'].includes(rpc)) return route.continue();
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(null)});
  });
  return context;
}
try {
  for (const scenario of [
    {identity:'anonymous',label:'משתמש אנונימי אונליין',coldOffline:false},
    {identity:'account',label:'משתמש רשום אופליין',coldOffline:false},
    {identity:'anonymous',label:'משתמש אנונימי אופליין',coldOffline:true},
  ]) {
    console.log('QA:',scenario.label);
    const context=await contextFor(scenario.identity,null,scenario.coldOffline);
    const page=await context.newPage(); const errors=[];
    page.on('pageerror',(e)=>errors.push(e.message));
    try {
      await page.goto(targetUrl,{waitUntil:'domcontentloaded'});
      await expectIdentity(page,scenario.label);
      assert.equal(await page.locator('[data-sidebar-id="admin"]').count(),0);
      if(!scenario.coldOffline && scenario.identity==='anonymous') {
        await context.setOffline(true);
        await expectIdentity(page,'משתמש אנונימי אופליין',15000);
        await context.setOffline(false);
        await expectIdentity(page,'משתמש אנונימי אונליין',15000);
      }
      assert.deepEqual(errors,[]);
      results.push({scenario:scenario.label,passed:true,pageErrors:0});
    } catch(error) {
      await page.screenshot({path:'output/access-roles/failed-guest.png'});
      throw Error(scenario.label+': '+error.message+'; pageErrors='+JSON.stringify(errors));
    } finally { await context.close(); }
  }
  const login=await cloud.auth.signInWithPassword({email:process.env.ADMIN_EMAIL||value('ADMIN_EMAIL'),password:process.env.ADMIN_PASSWORD||value('ADMIN_PASSWORD')});
  if(login.error) throw Error('QA admin authentication failed');
  const context=await contextFor(null,login.data.session);
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',(e)=>errors.push(e.message));
  page.on('console',(message)=>{
    if(message.text().startsWith('[permissions]') || message.type()==='error') console.log('browser:',message.type(),message.text());
  });
  page.on('response',async(response)=>{
    if(response.url().includes('/rpc/is_admin') && response.status() >= 400) {
      console.log('is_admin response:',response.status(),await response.text().catch(()=>''));
    }
  });
  try {
    console.log('QA: administrator profiles');
    await page.goto(new URL('?section=admin',targetUrl).toString(),{waitUntil:'domcontentloaded'});
    await expect(page.getByRole('tab',{name:'גישה ותפקידים',exact:true})).toBeVisible({timeout:60000});
    assert.equal(await page.getByRole('tab',{name:'פרופילי אורח',exact:true}).count(),0);
    assert.equal(await page.getByRole('tab',{name:'תצוגה מקדימה',exact:true}).count(),0,'preview must not be a duplicate top-level tab');
    const adminTabs = await page.getByRole('tab').allTextContents();
    assert.equal(new Set(adminTabs.map(text=>text.trim())).size, adminTabs.length, 'duplicate admin tab labels');
    await page.getByRole('tab',{name:'גישה ותפקידים',exact:true}).click();
    await expect(page.getByRole('tab',{name:'פרופילי גישה',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.getByRole('heading',{name:'פרופילי גישה ותצוגה'})).toBeVisible();
    assert.equal(await page.getByRole('heading',{name:'ספריית תוכן משותפת',exact:true}).count(),0,'shared content must not appear inside access profiles');
    if (!mobileViewport) await page.screenshot({path:'output/access-roles/admin-access-redesign.png',fullPage:true});
    await expect(page.getByRole('tab',{name:'1. עריכת פרופיל',exact:true})).toHaveAttribute('aria-selected','true');
    await page.getByRole('tab',{name:'2. בדיקת התוצאה',exact:true}).click();
    await expect(page.getByRole('heading',{name:'בדיקת הרשאות ותצוגה לפי תפקיד'})).toBeVisible();
    await expect(page.getByText(/מצב בדיקה מוגן/)).toBeVisible();
    await page.getByRole('tab',{name:'1. עריכת פרופיל',exact:true}).click();
    await page.getByRole('tab',{name:'תוכן והדרכה',exact:true}).click();
    await page.getByRole('tab',{name:'ספרייה משותפת',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ספריית תוכן משותפת',exact:true})).toBeVisible();
    await expect(page.getByText(/אינה מעניקה הרשאות מנהל/)).toBeVisible();
    if (!mobileViewport) await page.screenshot({path:'output/access-roles/shared-library-redesign.png',fullPage:true});
    await page.getByRole('tab',{name:'גישה ותפקידים',exact:true}).click();
    for(const label of ['משתמש רשום','משתמש אנונימי אונליין','משתמש רשום אופליין','משתמש אנונימי אופליין'])
      await expect(page.locator('label').filter({hasText:label}).first()).toBeVisible({timeout:30000});
    assert.equal(await page.getByText('חשבון מקומי / אופליין',{exact:true}).count(),0);
    const picker = () => page.getByText('1. בחר או צור פרופיל',{exact:true}).locator('..').getByRole('combobox');
    console.log('QA: select offline role profile');
    await picker().click();
    await page.getByRole('option',{name:'משתמש אנונימי אופליין',exact:true}).click();
    await page.getByPlaceholder('לדוגמה: משתמש רגיל').fill('בדיקת פרופיל מבודדת');
    await expect(page.getByRole('tab',{name:'שמור לפני בדיקה',exact:true})).toBeDisabled();
    await expect(page.getByText(/טיוטה — יש שינויים שלא נשמרו/)).toBeVisible();
    await page.getByRole('button',{name:'הסתר הכול',exact:true}).first().click();
    await page.getByRole('button',{name:'שמור ופרסם את הפרופיל',exact:true}).click();
    console.log('QA: save clicked');
    await expect(page.getByText(/בדיקת פרופיל מבודדת.*נשמר/).first()).toBeVisible();
    const writes=isolatedWrites.filter((write)=>write.table==='role_permissions').flatMap((write)=>write.rows);
    console.log('QA saved role summary',JSON.stringify({roleIds:[...new Set(writes.map(row=>row.role_id))],allowed:writes.filter(row=>row.allowed).map(row=>row.module+':'+row.action)}));
    assert.equal(writes.length,30);
    assert(writes.every((row)=>row.role_id==='463ba43e-adbc-4d3f-9703-35918f63261c' && row.allowed===false));
    await page.reload({waitUntil:'domcontentloaded'});
    console.log('QA: reload after isolated save');
    await page.getByRole('tab',{name:'גישה ותפקידים',exact:true}).click();
    await expect(page.getByPlaceholder('לדוגמה: משתמש רגיל')).toHaveValue('בדיקת פרופיל מבודדת',{timeout:20000});
    // Profiles are mocked, while role metadata is a separate live server read.
    // Wait for that request before checking the mobile assignment list.
    await expect(page.locator('label').filter({hasText:'משתמש אנונימי אופליין'}).first()).toBeVisible({timeout:30000});
    results.push({scenario:'isolated profile save + reload, only selected role changed',passed:true,cloudWrites:0});
    await page.getByRole('tab',{name:'מובייל',exact:true}).click();
    await expect(page.getByRole('tab',{name:'מובייל',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('label').filter({hasText:'משתמש אנונימי אופליין'}).first()).toBeVisible({timeout:30000});
    assert.deepEqual(errors,[]);
    results.push({scenario:'admin unified profiles desktop/mobile',passed:true,pageErrors:0});
    if (auditMobileConflict) {
      await picker().click();
      await page.getByRole('option',{name:'משתמש אנונימי אופליין',exact:true}).click();
      await page.getByPlaceholder('לדוגמה: משתמש רגיל').fill('בדיקת שינוי שם במובייל בלבד');
      const beforeWrites = isolatedWrites.length;
      await page.getByRole('button',{name:'שמור ופרסם את הפרופיל',exact:true}).click();
      await expect(page.getByText(/בדיקת שינוי שם במובייל בלבד.*נשמר/).first()).toBeVisible();
      const changed=isolatedWrites.slice(beforeWrites).filter(w=>w.table==='role_permissions').flatMap(w=>w.rows);
      const reenabled=changed.filter(row=>row.role_id==='463ba43e-adbc-4d3f-9703-35918f63261c' && row.allowed)
        .map(row=>row.module+':'+row.action);
      results.push({scenario:'mobile rename must not reenable desktop-denied permissions',passed:reenabled.length===0,reenabled,cloudWrites:0});
      if(reenabled.length) process.exitCode=1;
    }
  } catch(error) {
    await page.screenshot({path:'output/access-roles/failed-admin.png'});
    throw error;
  } finally { await context.close(); }
} catch (error) {
  results.push({scenario:'incomplete browser scenario',passed:false,error:String(error.message).split('Call log:')[0]});
  process.exitCode=1;
} finally {
  await cloud.auth.signOut({scope:'local'}).catch(()=>{});
  await browser.close();
  fs.writeFileSync(`output/access-roles/${process.env.QA_URL?'ui-production-audit':mobileViewport?'ui-mobile-audit':auditMobileConflict?'ui-boundary-audit':'ui-report'}.json`,JSON.stringify({url:targetUrl,viewport:mobileViewport?'390x844':'1440x1000',durationMs:Date.now()-startedAt,results},null,2));
}
console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results}));
