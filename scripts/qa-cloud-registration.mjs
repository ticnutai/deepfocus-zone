// Explicitly opt-in: creates the supplied test account against the configured cloud.
// Credentials stay in process/browser memory; never write a storageState or trace.
import { chromium } from '@playwright/test';
const email = process.env.LEMAAN_QA_EMAIL;
const password = process.env.LEMAAN_QA_PASSWORD;
if (!email || !password) throw new Error('Test credentials are required through environment variables');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://localhost:5000/auth');
  await page.evaluate(async () => { window.qaAccount = await import('/src/lib/auth/localAccount.ts'); });
  await context.setOffline(true);
  const local = await page.evaluate(async ({email,password}) => {
    const created = await window.qaAccount.createLocalAccount({ username: 'qa.cloud.registration', displayName: 'בדיקת סנכרון', email, password });
    const offline = await window.qaAccount.attemptDeferredRegistration();
    return { created: created.ok, offline: offline.status, secretPersisted: Boolean(window.qaAccount.listLocalAccounts()[0]?.passwordObf) };
  }, {email,password});
  console.log(JSON.stringify({ stage: 'offline', ...local }));
  if (!local.created || local.offline !== 'offline' || local.secretPersisted) throw new Error('Offline assertions failed');
  await context.setOffline(false);
  const result = await page.evaluate(async () => {
    const result = await window.qaAccount.attemptDeferredRegistration();
    const {supabase} = await import('/src/integrations/supabase/client.ts');
    const {data} = await supabase.auth.getSession();
    return {status:result.status, message:result.message, authenticated:Boolean(data.session)};
  });
  console.log(JSON.stringify({stage:'cloud',...result}));
  if (result.status !== 'registered' || !result.authenticated) throw new Error('Cloud registration did not complete; test failed');
} finally { await browser.close(); }
