import { chromium, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const username = `qa.ui.${Date.now()}`;
const password = randomBytes(14).toString('hex') + 'A7';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const errors = [];
try {
  const first = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he-IL' });
  const page = await first.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5000/auth');
  await page.getByRole('tab', { name: 'הרשמה', exact: true }).click();
  await page.getByPlaceholder('שם משתמש (אפשר בעברית)').fill(username);
  await page.getByPlaceholder('סיסמה', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'הירשם', exact: true }).click();
  await page.getByText('שמור את הקוד במקום בטוח.', { exact: false }).waitFor();
  await page.getByText('שמרתי את קוד השחזור', { exact: true }).click();
  await page.getByRole('button', { name: 'הירשם', exact: true }).click();
  await page.waitForURL((u) => u.pathname !== '/auth', { timeout: 30000 });
  await page.getByText('הוסף תוכנית לחומש, רמב״ם, שו״ע ועוד', { exact: true }).first().waitFor({ timeout: 30000 });
  assert.equal(await page.getByText('רמב&quot;ם', { exact: false }).count(), 0);
  const accountId = await page.evaluate(async () => {
    const {supabase} = await import('/src/integrations/supabase/client.ts');
    return (await supabase.auth.getSession()).data.session?.user.id;
  });
  assert.ok(accountId);
  const second = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL' });
  const mobile = await second.newPage();
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.goto('http://localhost:5000/auth');
  await mobile.getByPlaceholder('email או שם משתמש').fill(username);
  await mobile.getByPlaceholder('סיסמה', { exact: true }).fill(password);
  await mobile.getByRole('button', { name: 'התחבר', exact: true }).click();
  await mobile.waitForURL((u) => u.pathname !== '/auth', { timeout: 30000 });
  const secondId = await mobile.evaluate(async () => {
    const {supabase} = await import('/src/integrations/supabase/client.ts');
    return (await supabase.auth.getSession()).data.session?.user.id;
  });
  assert.equal(secondId, accountId);
  assert.deepEqual(errors, []);
  console.log('PASS: desktop signup without email, recovery-code acknowledgement, mobile login to same account, no page errors');
} finally {
  await browser.close();
  const sql = `DO $$ BEGIN DELETE FROM auth.users WHERE raw_user_meta_data->>'username'='${username}'; IF EXISTS(SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'username'='${username}') THEN RAISE EXCEPTION 'Cleanup failed'; END IF; END $$;`;
  const cleanup = spawnSync(process.execPath, ['scripts/run-migration.mjs', 'sql', sql, 'cleanup-exact-ui-fixture'], { encoding: 'utf8' });
  assert.equal(cleanup.status, 0, 'Test cleanup failed');
  console.log('Temporary UI account removed');
}
