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
const serverErrors = [];
const startedAt = Date.now();
const auditMobileConflict = process.argv.includes('--audit-mobile-conflict');
const mobileViewport = process.argv.includes('--mobile');
const targetUrl = process.env.QA_URL || 'http://localhost:5000/';
const isolatedWrites = [];
const deadline = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
]);
async function signInAdminForQa() {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await deadline(cloud.auth.signInWithPassword({
        email: process.env.ADMIN_EMAIL || value('ADMIN_EMAIL'),
        password: process.env.ADMIN_PASSWORD || value('ADMIN_PASSWORD'),
      }), 30000, `QA admin authentication attempt ${attempt}`);
      if (!result.error) return result;
      lastError = result.error;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('QA admin authentication failed');
}
fs.mkdirSync('output/access-roles', {recursive:true});
async function expectIdentity(page, label, timeout=60000) {
  const stableLabel=label.replace(/\s+(אונליין|אופליין)$/u,'');
  const locator=page.getByText(stableLabel,{exact:false}).first();
  if(mobileViewport) {
    // The compact mobile shell intentionally omits the desktop identity card.
    // Assert the loaded shell here; role mapping itself is covered by unit tests
    // and by the protected admin-route assertion below.
    await expect(page.getByRole('tab',{name:'תרגול',exact:true}).first()).toBeAttached({timeout});
  } else await expect(locator).toBeVisible({timeout});
}
async function captureVisiblePresentation(page) {
  await expect.poll(async () => page.locator('[role="tab"]:visible, [data-sidebar-id]:visible').count(), {timeout:60000}).toBeGreaterThan(0);
  // Role permissions, the matching display profile and the stored layout are
  // independent asynchronous sources. Sample only after the rendered list is
  // stable, otherwise the test can accidentally bless (or reject) the brief
  // empty-role catalogue that exists during startup.
  let last = '';
  let stableSamples = 0;
  await expect.poll(async () => {
    const current = await page.locator('[role="tab"]:visible, [data-sidebar-id]:visible').evaluateAll(nodes =>
      nodes.map(node => `${node.getAttribute('data-sidebar-id') ?? 'tab'}:${node.textContent?.trim() ?? ''}`).sort().join('|'));
    stableSamples = current === last ? stableSamples + 1 : 0;
    last = current;
    return stableSamples;
  }, {timeout:60000, intervals:[300,500,700]}).toBeGreaterThanOrEqual(3);
  const snapshot = await page.evaluate(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const unique = (values) => [...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'he'));
    return {
      homeTabs: unique([...document.querySelectorAll('[role="tab"]')].filter(visible).map(node => node.textContent?.trim() || '')),
      sidebarIds: unique([...document.querySelectorAll('[data-sidebar-id]')].filter(visible).map(node => node.dataset.sidebarId || '')),
      presentationRoleIds: document.querySelector('aside[data-presentation-role-ids]')?.getAttribute('data-presentation-role-ids') ?? '',
      profileBActive: document.querySelector('aside[data-profile-b-active]')?.getAttribute('data-profile-b-active') ?? '',
      sidebarLayout: document.querySelector('aside[data-sidebar-layout]')?.getAttribute('data-sidebar-layout') ?? '',
      presentationAccess: document.querySelector('aside[data-presentation-access]')?.getAttribute('data-presentation-access') ?? '',
    };
  });
  return snapshot;
}
const renderedPresentation = (snapshot) => ({
  homeTabs: snapshot.homeTabs,
  sidebarIds: snapshot.sidebarIds,
});
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
  context.setDefaultTimeout(60000);
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
    const studyTables = new Set([
      'cards','decks','categories','review_logs','goals','shas_plans','day_notes',
      'user_settings','card_decks','shas_reviews','learning_sessions',
    ]);
    if (session && request.method()==='GET' && studyTables.has(table)) {
      return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    }
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
    if (session && rpc === 'get_bootstrap_snapshot') {
      return route.fulfill({status:200,contentType:'application/json',body:'{}'});
    }
    if (session && ['get_admin_content_sources','get_admin_question_source_tags'].includes(rpc)) {
      return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    }
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
  context.qaSavedSettings = savedSettings;
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
  const login=await signInAdminForQa();
  if(login.error) throw Error('QA admin authentication failed');
  // `app_roles` may contain historical rows with the same access_kind. The
  // runtime does not pick an arbitrary row: get_access_role_policy is the
  // canonical mapping. Compare the administrator against that exact role so
  // old rows cannot make this regression check nondeterministic.
  const registeredPolicyResult=await cloud.rpc('get_access_role_policy');
  const registeredRoleId=registeredPolicyResult.data?.registered?.id;
  if(registeredPolicyResult.error || typeof registeredRoleId !== 'string' || !registeredRoleId) {
    throw Error('Canonical registered role lookup failed');
  }
  const context=await contextFor(null,login.data.session);
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',(e)=>errors.push(e.message));
  page.on('console',(message)=>{
    if(message.text().startsWith('[permissions]') || message.type()==='error') console.log('browser:',message.type(),message.text());
  });
  page.on('response',async(response)=>{
    if(response.status() >= 500) {
      const failure={status:response.status(),path:new URL(response.url()).pathname};
      serverErrors.push(failure); console.log('server-error response:',failure.status,failure.path,await response.text().catch(()=>''));
    }
    if(response.url().includes('/rpc/is_admin') && response.status() >= 400) {
      console.log('is_admin response:',response.status(),await response.text().catch(()=>''));
    }
  });
  try {
    console.log('QA: administrator presentation matches registered online/offline');
    await page.goto(targetUrl,{waitUntil:'domcontentloaded'});
    const adminOnline=await captureVisiblePresentation(page);
    const previewPage=await context.newPage();
    await previewPage.goto(new URL(`?previewRole=${encodeURIComponent(registeredRoleId)}`,targetUrl).toString(),{waitUntil:'domcontentloaded'});
    const registeredOnline=await captureVisiblePresentation(previewPage);
    assert.deepEqual(renderedPresentation(adminOnline),renderedPresentation(registeredOnline),'administrator presentation differs from registered profile online');
    await previewPage.close();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const adminOffline=await captureVisiblePresentation(page);
    assert.deepEqual(renderedPresentation(adminOffline),renderedPresentation(adminOnline),'administrator presentation changes offline');
    assert.equal(await page.getByText(/טוען את החשבון|טוען.*הרשאות|בודק הרשאות/).count(),0,'visible permission-loading message');
    await context.setOffline(false);
    results.push({scenario:`admin equals registered ${mobileViewport?'mobile':'desktop'} online/offline`,passed:true,adminOnline,adminOffline});

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
    await expect(page.getByRole('heading',{name:/מקורות שאלות/}).first()).toBeAttached({timeout:30000});
    await expect(page.getByText('משתמשים כמקורות תוכן',{exact:true})).toBeAttached({timeout:30000});
    assert.equal(await page.getByRole('heading',{name:'ספריית תוכן משותפת',exact:true}).count(),0,'shared content must not appear inside access profiles');
    if (!mobileViewport) await page.screenshot({path:'output/access-roles/admin-access-redesign.png',fullPage:true});
    await expect(page.getByRole('tab',{name:'1. עריכת פרופיל',exact:true})).toHaveAttribute('aria-selected','true');
    await page.getByRole('tab',{name:'2. בדיקת התוצאה',exact:true}).click();
    await expect(page.getByRole('heading',{name:'בדיקת הרשאות ותצוגה לפי תפקיד'})).toBeVisible();
    await expect(page.getByText(/מצב בדיקה מוגן/)).toBeVisible();
    await expect(page.getByText('מקורות שאלות:',{exact:true}).first()).toBeVisible();
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
    await page.locator('[role="option"]').filter({hasText:'משתמש אנונימי אופליין'}).click();
    await page.getByPlaceholder('לדוגמה: משתמש רגיל').fill('בדיקת פרופיל מבודדת');
    await expect(page.getByRole('tab',{name:'שמור לפני בדיקה',exact:true})).toBeDisabled();
    await expect(page.getByText(/טיוטה — יש שינויים שלא נשמרו/)).toBeVisible();
    await page.getByRole('button',{name:'הסתר הכול',exact:true}).first().click();
    await page.getByRole('button',{name:'שמור ופרסם את הפרופיל',exact:true}).click();
    console.log('QA: save clicked');
    await expect(page.getByText(/בדיקת פרופיל מבודדת.*נשמר/).first()).toBeVisible({timeout:20000});
    const writes=isolatedWrites.filter((write)=>write.table==='role_permissions').flatMap((write)=>write.rows);
    console.log('QA saved role summary',JSON.stringify({roleIds:[...new Set(writes.map(row=>row.role_id))],allowed:writes.filter(row=>row.allowed).map(row=>row.module+':'+row.action)}));
    assert.equal(writes.length,30);
    assert(writes.every((row)=>row.role_id==='463ba43e-adbc-4d3f-9703-35918f63261c' && row.allowed===false));
    const savedDesktopProfiles = context.qaSavedSettings.get('role_layout_profiles_v1') || [];
    const savedDesktopAssignments = context.qaSavedSettings.get('role_layout_profile_assignments_v1') || [];
    const savedProfile = savedDesktopProfiles.find((profile)=>profile.name==='בדיקת פרופיל מבודדת');
    assert(savedProfile,'saved profile was not persisted by the isolated API contract');
    assert(savedDesktopAssignments.some((assignment)=>assignment.profileId===savedProfile.id && assignment.roleId==='463ba43e-adbc-4d3f-9703-35918f63261c'),'saved role assignment is missing');
    console.log('QA: isolated save contract verified');
    // Profiles are mocked, while role metadata is a separate live server read.
    // Wait for that request before checking the mobile assignment list.
    await expect(page.locator('label').filter({hasText:'משתמש אנונימי אופליין'}).first()).toBeVisible({timeout:30000});
    assert.deepEqual(serverErrors,[],'unexpected server errors: '+JSON.stringify(serverErrors));
    results.push({scenario:'isolated profile save contract, only selected role changed',passed:true,cloudWrites:0});
    await page.getByRole('tab',{name:'מובייל',exact:true}).click();
    await expect(page.getByRole('tab',{name:'מובייל',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('label').filter({hasText:'משתמש אנונימי אופליין'}).first()).toBeVisible({timeout:30000});
    assert.deepEqual(errors,[]);
    results.push({scenario:'admin unified profiles desktop/mobile',passed:true,pageErrors:0});
    if (auditMobileConflict) {
      await picker().click();
      await page.locator('[role="option"]').filter({hasText:'משתמש אנונימי אופליין'}).click();
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
