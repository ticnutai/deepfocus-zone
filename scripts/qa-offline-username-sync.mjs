import { chromium } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const username = `qa.offline.${Date.now()}`, password = randomBytes(14).toString('hex') + 'X8', cardId = randomUUID();
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const network = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if(m.type()==='error') errors.push(m.text()); });
  page.on('response', (response) => { if (response.url().includes('/rest/v1/cards')) network.push({method:response.request().method(),url:response.url(),status:response.status()}); });
  await page.goto('http://localhost:5000/auth');
  await page.getByRole('tab', { name: 'הרשמה', exact: true }).waitFor();
  await page.evaluate(async () => {
    window.qaLocal = await import('/src/lib/auth/localAccount.ts');
    window.qaRecovery = await import('/src/lib/auth/usernameRegistration.ts');
  });
  await context.setOffline(true);
  const local = await page.evaluate(async ({username,password,cardId}) => {
    const result = await window.qaLocal.createLocalAccount({ username, password, recoveryHash: await window.qaRecovery.recoveryHash(window.qaRecovery.createRecoveryCode()) });
    const state = { cards:[{id:cardId,deckId:null,type:'flashcard',question:'QA offline durable card',answer:'safe',tags:[],createdAt:Date.now(),srs:{ease:2.5,interval:0,repetitions:0,dueAt:Date.now(),lastReviewedAt:null},stats:{totalReviews:0,correct:0,incorrect:0}}],decks:[],logs:[],categories:[],goals:[],shasPlan:null,notificationsEnabled:false,reminderTime:'20:00',dayNotes:[],cardDecks:[],shasReviews:[],learningSessions:[],generalPlans:[],planReviews:[],quizPlans:[],quizAttempts:[],practiceResults:[] };
    localStorage.setItem('guest-study-state',JSON.stringify(state));
    return {ok:result.ok,offline:(await window.qaLocal.attemptDeferredRegistration()).status};
  }, {username,password,cardId});
  assert.deepEqual(local,{ok:true,offline:'offline'});
  await context.setOffline(false);
  const registered = await page.evaluate(async () => await window.qaLocal.attemptDeferredRegistration());
  assert.equal(registered.status,'registered',JSON.stringify(registered));
  await page.waitForURL((url) => url.pathname === '/', { timeout: 30000 });
  const firstUser = await page.evaluate(async () => { const {supabase}=await import('/src/integrations/supabase/client.ts'); return (await supabase.auth.getSession()).data.session?.user.id; });
  let uploaded = false;
  for (let attempt=0; attempt<90 && !uploaded; attempt++) {
    uploaded = await page.evaluate(async (id) => {
      const {supabase} = await import('/src/integrations/supabase/client.ts');
      return (await supabase.from('cards').select('id').eq('id',id)).data?.length === 1;
    },cardId).catch((error) => {
      if (error.message.includes('Execution context was destroyed')) return false;
      throw error;
    });
    if (!uploaded) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if(!uploaded) {
    const storage = await page.evaluate(async (uid) => {
      const cache = await import('/src/lib/study/indexedStateCache.ts');
      const state = await cache.loadStudyStateCache(uid);
      const control = await import('/src/lib/study/profileBMode.ts');
      return {jobs:await cache.listSyncJobs(uid),cards:state?.cards?.length,canPush:control.canPushToCloud()};
    },firstUser);
    console.log('Runtime diagnostic',JSON.stringify({url:page.url(),errors,storage,network}));
  }
  assert.equal(uploaded,true,'Offline card must reach real cloud before second-device read');
  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto('http://localhost:5000/auth');
  const found = await other.evaluate(async ({username,password,cardId}) => {
    const {supabase} = await import('/src/integrations/supabase/client.ts');
    const email = await supabase.rpc('email_for_username',{p_username:username});
    const login = await supabase.auth.signInWithPassword({email:email.data,password});
    if(login.error) return { ok:false, stage:'login', message:login.error.message };
    const card = await supabase.from('cards').select('question').eq('id',cardId).single();
    return { ok:card.data?.question === 'QA offline durable card',stage:'read',message:card.error?.message,question:card.data?.question,user:login.data.user.id };
  },{username,password,cardId});
  assert.equal(found.user,firstUser,'Account identity must match across clients');
  if (!found.ok) {
    const firstRead = await page.evaluate(async (id) => { const {supabase}=await import('/src/integrations/supabase/client.ts'); return await supabase.from('cards').select('id,user_id,deleted_at').eq('id',id); },cardId);
    console.log('Read diagnostic',JSON.stringify({firstRead}));
    console.log('QA requests',JSON.stringify(network));
    const diagnostic = spawnSync(process.execPath,['scripts/run-migration.mjs','sql',`DO $$ BEGIN RAISE EXCEPTION '%', (SELECT json_build_object('owner',user_id,'deleted',deleted_at) FROM public.cards WHERE id='${cardId}'); END $$;`,'qa-fixture-diagnostic'],{encoding:'utf8'});
    console.log(diagnostic.stdout,diagnostic.stderr);
  }
  assert.equal(found.ok,true,JSON.stringify(found));
  console.log('PASS: offline account + local question -> automatic cloud sync -> independent browser account read');
} catch (error) {
  console.error('Offline scenario failed', error);
  throw error;
} finally {
  await browser.close();
  const sql = `DELETE FROM auth.users WHERE raw_user_meta_data->>'username'='${username}';`;
  let cleanup;
  for (let attempt=0; attempt<3; attempt++) {
    cleanup = spawnSync(process.execPath,['scripts/run-migration.mjs','sql',sql,'cleanup-exact-offline-fixture'],{encoding:'utf8'});
    if (cleanup.status === 0) break;
    await new Promise((resolve) => setTimeout(resolve,1000));
  }
  assert.equal(cleanup.status,0,cleanup.stdout + cleanup.stderr);
  console.log('Temporary offline test account removed');
}
