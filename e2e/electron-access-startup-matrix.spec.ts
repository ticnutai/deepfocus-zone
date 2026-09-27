import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const BASE_URL = 'http://127.0.0.1:5011';
const RELOADS_PER_SCENARIO = 3;
const denialPattern = /אין הרשאה|חשבון חסום|האזור זמין למנהלי המערכת בלבד/;
const bundledSeedVersion = String((JSON.parse(fs.readFileSync(
  new URL('../src/lib/study/offlineLibrary.generated.json', import.meta.url),
  'utf8',
)) as { seed: { seededAt: number } }).seed.seededAt);

type RunningElectron = {
  app: ElectronApplication;
  page: Page;
  pageErrors: string[];
  consoleErrors: string[];
  userDataPath: string;
};

async function launchHiddenElectron(name: string, production = false): Promise<RunningElectron> {
  const installedExecutable = process.env.ELECTRON_INSTALLED_EXECUTABLE;
  const reportDir = path.resolve('.codex-runtime', 'electron-access-matrix');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${name}-${Date.now()}.json`);
  const reportKey = crypto.createHash('sha256').update(reportPath).digest('hex').slice(0, 12);
  const userDataPath = path.join(os.tmpdir(), `lemaan-e2e-${reportKey}`);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_NO_DEVTOOLS: '1',
    ELECTRON_ACCESS_MATRIX_REPORT: reportPath,
  };
  if (production) {
    delete environment.ELECTRON_DEV;
    delete environment.ELECTRON_DEV_URL;
  } else {
    environment.ELECTRON_DEV = '1';
    environment.ELECTRON_DEV_URL = BASE_URL;
  }
  const app = await electron.launch(installedExecutable
    ? { executablePath: installedExecutable, env: environment }
    : { args: ['.'], cwd: process.cwd(), env: environment });
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('guides-seen:v1', '1');
    (window as Window & { __electronDenialFrames?: string[] }).__electronDenialFrames = [];
    const inspect = () => {
      const text = document.body?.innerText ?? '';
      const denied = text.match(/אין הרשאה[^\n]*|חשבון חסום[^\n]*|האזור זמין למנהלי המערכת בלבד[^\n]*/g) ?? [];
      (window as Window & { __electronDenialFrames?: string[] }).__electronDenialFrames?.push(...denied);
    };
    new MutationObserver(inspect).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return { app, page, pageErrors, consoleErrors, userDataPath };
}

async function closeRunningElectron(runtime: RunningElectron): Promise<void> {
  await runtime.app.close();
  // Each hidden run gets an isolated Chromium profile. It may include the
  // bundled offline library, so remove it after shutdown instead of leaking
  // hundreds of MB across repeated QA runs.
  fs.rmSync(runtime.userDataPath, { recursive: true, force: true });
}

async function denialFrames(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & { __electronDenialFrames?: string[] }).__electronDenialFrames ?? []);
}

async function expectSettledWorkspace(page: Page): Promise<void> {
  await expect(page.getByText("למען תהיה תורת ה' בפיך", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="silent-startup-wait"], [data-testid="silent-auth-wait"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(denialPattern)).toHaveCount(0);
}

async function repeatWarmStarts(page: Page): Promise<void> {
  for (let iteration = 0; iteration < RELOADS_PER_SCENARIO; iteration += 1) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectSettledWorkspace(page);
    expect(await denialFrames(page), `denial frame during Electron reload ${iteration + 1}`).toEqual([]);
  }
}

async function openAuth(page: Page): Promise<void> {
  if (page.url().startsWith('file:')) {
    const target = new URL(page.url());
    target.searchParams.delete('section');
    target.hash = '/auth';
    await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(`${BASE_URL}/auth`, { waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByPlaceholder('email או שם משתמש')).toBeVisible({ timeout: 15_000 });
}

async function openHome(page: Page): Promise<void> {
  if (page.url().startsWith('file:')) {
    const target = new URL(page.url());
    target.searchParams.delete('section');
    target.hash = '/';
    await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  }
}

async function openAdmin(page: Page): Promise<void> {
  if (page.url().startsWith('file:')) {
    // Index reads the active workspace from window.location.search. In the
    // packaged HashRouter build the query therefore belongs before `#/`.
    const target = new URL(page.url());
    target.searchParams.set('section', 'admin');
    target.hash = '/';
    await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  } else {
    await page.evaluate(() => {
      history.pushState({}, '', '/?section=admin');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  }
}

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function mockConnectedCloud(page: Page, role: 'admin' | 'registered'): Promise<void> {
  const userId = role === 'admin'
    ? 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    : 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
  const email = role === 'admin' ? 'electron-admin@example.com' : 'electron-learner@example.com';
  const registeredRoleId = '11111111-1111-4111-8111-111111111111';
  const adminRoleId = '99999999-9999-4999-8999-999999999999';
  const roleId = role === 'admin' ? adminRoleId : registeredRoleId;
  const now = Math.floor(Date.now() / 1000);
  const accessToken = `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({
    aud: 'authenticated', exp: now + 3600, iat: now, iss: 'electron-e2e', role: 'authenticated', sub: userId, email,
  })}.electron-e2e-signature`;
  const user = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
  };
  const matrix = {
    'cards:view': true, 'cards:create': true, 'cards:edit': true, 'cards:delete': false,
    'decks:view': true, 'decks:create': true, 'decks:edit': true, 'decks:delete': false,
    'goals:view': true, 'goals:create': true, 'goals:edit': true, 'goals:delete': false,
    'shas:view': true, 'shas:create': true, 'shas:edit': true, 'shas:delete': false,
    'analytics:view': true, 'analytics:create': false, 'analytics:edit': false, 'analytics:delete': false,
    'settings:view': true, 'settings:create': false, 'settings:edit': true, 'settings:delete': false,
  };
  const policy = Object.fromEntries(['registered', 'anonymous_online', 'registered_offline', 'anonymous_offline'].map(kind => [kind, {
    id: kind === 'registered' ? registeredRoleId : `22222222-2222-4222-8222-${kind.padEnd(12, '0').slice(0, 12)}`,
    name: kind,
    matrix,
  }]));
  const permissions = Object.entries(matrix).map(([key, allowed]) => {
    const [module, action] = key.split(':');
    return { module, action, allowed };
  });

  await page.route('**/*.supabase.co/**', async route => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/1' },
      body: JSON.stringify(body),
    });
    if (pathname.includes('/auth/v1/token')) return json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: `refresh-${userId}`,
      user,
    });
    if (pathname.endsWith('/auth/v1/user')) return json(user);
    if (pathname.includes('/auth/v1/logout')) return json({}, 204);
    if (pathname.endsWith('/rpc/get_access_role_policy')) return json(policy);
    if (pathname.endsWith('/rpc/get_bootstrap_snapshot')) return json({
      decks: [], cards: [], cards_total_count: 0, review_logs: [], goals: [], day_notes: [],
      card_decks: [], shas_reviews: [], learning_sessions: [], categories_roots: [], categories_tombstones: [],
    });
    if (pathname.endsWith('/rpc/get_my_role_layout_defaults')) return json({});
    if (pathname.includes('/rpc/')) return json({});
    if (pathname.endsWith('/profiles')) return json([{
      id: userId,
      display_name: role === 'admin' ? 'Electron admin' : 'Electron learner',
      username: null,
      email,
      created_at: new Date().toISOString(),
      status: 'approved',
      role_baseline_enabled: true,
    }]);
    if (pathname.endsWith('/user_roles')) {
      const select = requestUrl.searchParams.get('select') ?? '';
      if (select === 'role_id') return json([{ role_id: roleId }]);
      if (select.includes('user_id') && select.includes('role_id')) return json([{ user_id: userId, role_id: roleId }]);
      return json([{ app_roles: {
        id: roleId,
        name: role,
        access_kind: role === 'registered' ? 'registered' : null,
      } }]);
    }
    if (pathname.endsWith('/app_roles')) return json([{
      id: registeredRoleId,
      name: 'registered',
      access_kind: 'registered',
    }]);
    if (pathname.endsWith('/role_permissions')) return json(permissions);
    if (pathname.endsWith('/site_settings')) return json([]);
    return json([]);
  });
}

async function signInCloud(page: Page, email: string, password: string): Promise<void> {
  await openAuth(page);
  await page.getByPlaceholder('email או שם משתמש').fill(email);
  await page.getByPlaceholder('סיסמה').fill(password);
  await page.getByRole('button', { name: 'התחבר', exact: true }).click();
  await expectSettledWorkspace(page);
}

async function enterGuest(page: Page): Promise<void> {
  await openAuth(page);
  await page.getByRole('button', { name: /כניסה כאורח/ }).click();
  await expectSettledWorkspace(page);
}

async function seedInterruptedGuestLibrarySnapshot(page: Page): Promise<void> {
  await openAuth(page);
  await page.evaluate(({ seedVersion }) => {
    localStorage.setItem('guest-study-state', JSON.stringify({
      decks: [], cards: [], logs: [],
      categories: [{ id: 'stale-root', name: 'מעטפת ישנה', parentId: null, createdAt: 1 }],
      goals: [], shasPlan: null, notificationsEnabled: false, reminderTime: '20:00', dayNotes: [],
      shasPlans: [], activeShasPlanId: null, cardDecks: [], shasReviews: [], reviewIntervals: [1, 3, 7, 14, 30],
      learningSessions: [], tabConfig: [], sidebarConfig: [], uiPrefs: {}, generalPlans: [], planReviews: [],
      customCategoryTemplates: [], quizPlans: [], quizAttempts: [], practiceResults: [],
    }));
    localStorage.setItem('guest-study-seed-applied:local-offline', seedVersion);
  }, { seedVersion: bundledSeedVersion });
}

async function expectBundledGuestQuestions(page: Page): Promise<void> {
  const dismissWelcome = page.getByRole('button', { name: /כבר קראתי/ });
  if (await dismissWelcome.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false)) {
    await dismissWelcome.click();
  }
  await page.getByRole('button', { name: 'תרגול', exact: true }).first().click();
  await page.getByText('תרגול כללי', { exact: true }).click();
  for (const label of ['מועד', 'שבת', 'ב', 'עמוד א׳']) {
    await page.getByText(label, { exact: true }).click();
  }
  await expect(page.getByTestId('daf-question-count')).toHaveText('(8)', { timeout: 20_000 });
}

async function seedOfflineRegisteredAccount(page: Page, admin = false): Promise<void> {
  await openAuth(page);
  await page.evaluate(async () => {
    const password = 'offline-electron-test-password';
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 }, key, 256);
    const toBase64 = (bytes: Uint8Array) => {
      let binary = '';
      bytes.forEach(byte => { binary += String.fromCharCode(byte); });
      return btoa(binary);
    };
    localStorage.setItem('local-accounts:v1', JSON.stringify([{
      username: 'electronoffline',
      displayName: 'Electron offline learner',
      email: 'electronoffline@example.com',
      passwordObf: '',
      passwordHash: toBase64(new Uint8Array(bits)),
      passwordSalt: toBase64(salt),
      passwordIterations: 210_000,
      status: 'registered',
      createdAt: Date.now(),
      registeredAt: Date.now(),
      userId: '22222222-3333-4444-8555-666666666666',
    }]));
  });
  if (admin) {
    await page.evaluate(() => {
      const userId = '22222222-3333-4444-8555-666666666666';
      localStorage.setItem(`verified-offline-admin:v1:${userId}`, JSON.stringify({ userId, verifiedAt: Date.now() }));
    });
  }
}

function assertCleanRuntime(runtime: RunningElectron): void {
  expect(runtime.pageErrors).toEqual([]);
  const unexpectedConsole = runtime.consoleErrors.filter(line => {
    return !/Failed to load resource|ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED)|NetworkError|WebSocket connection|fetch/i.test(line);
  });
  expect(unexpectedConsole).toEqual([]);
}

for (const production of [false, true]) test.describe(`Electron access startup matrix (${production ? 'production bundle' : 'development server'})`, () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('online administrator stays authorized without a denial frame', async () => {
    const runtime = await launchHiddenElectron(`online-admin-${production ? 'prod' : 'dev'}`, production);
    try {
      await mockConnectedCloud(runtime.page, 'admin');
      await signInCloud(runtime.page, 'electron-admin@example.com', 'electron-test-password');
      expect(await denialFrames(runtime.page)).toEqual([]);
      await openAdmin(runtime.page);
      await expect(runtime.page.getByRole('heading', { name: 'מרכז ניהול', exact: true })).toBeVisible({ timeout: 20_000 });
      await openHome(runtime.page);
      await repeatWarmStarts(runtime.page);
      assertCleanRuntime(runtime);
    } finally {
      await closeRunningElectron(runtime);
    }
  });

  test('online registered learner stays authorized without admin presentation', async () => {
    const runtime = await launchHiddenElectron(`online-registered-${production ? 'prod' : 'dev'}`, production);
    try {
      await mockConnectedCloud(runtime.page, 'registered');
      await signInCloud(runtime.page, 'electron-learner@example.com', 'electron-test-password');
      await expect(runtime.page.getByText('ניהול משתמשים', { exact: true })).toHaveCount(0);
      await repeatWarmStarts(runtime.page);
      assertCleanRuntime(runtime);
    } finally {
      await closeRunningElectron(runtime);
    }
  });

  test('online anonymous guest starts repeatedly without permission disorder', async () => {
    const runtime = await launchHiddenElectron(`online-anonymous-${production ? 'prod' : 'dev'}`, production);
    try {
      await mockConnectedCloud(runtime.page, 'registered');
      await seedInterruptedGuestLibrarySnapshot(runtime.page);
      await enterGuest(runtime.page);
      await expectBundledGuestQuestions(runtime.page);
      await openHome(runtime.page);
      await repeatWarmStarts(runtime.page);
      assertCleanRuntime(runtime);
    } finally {
      await closeRunningElectron(runtime);
    }
  });

  test('network-reported-online administrator falls back quickly when cloud DNS is unavailable', async () => {
    const runtime = await launchHiddenElectron(`degraded-online-admin-${production ? 'prod' : 'dev'}`, production);
    try {
      await seedOfflineRegisteredAccount(runtime.page, true);
      await runtime.page.route('**/*.supabase.co/**', route => route.abort('namenotresolved'));
      await runtime.page.reload({ waitUntil: 'domcontentloaded' });
      const startedAt = Date.now();
      await runtime.page.getByPlaceholder('email או שם משתמש').fill('electronoffline');
      await runtime.page.getByPlaceholder('סיסמה').fill('offline-electron-test-password');
      await runtime.page.getByRole('button', { name: 'התחבר', exact: true }).click();
      await expectSettledWorkspace(runtime.page);
      expect(Date.now() - startedAt).toBeLessThan(12_000);
      expect(await denialFrames(runtime.page)).toEqual([]);
      // The administrator's default catalogue mirrors a registered learner,
      // while direct navigation must still retain full administration rights.
      await expect(runtime.page.getByText('ניהול משתמשים', { exact: true })).toHaveCount(0);
      await runtime.page.evaluate(() => {
        history.pushState({}, '', '/?section=admin');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(runtime.page.getByRole('heading', { name: 'מרכז ניהול', exact: true })).toBeVisible({ timeout: 20_000 });
      assertCleanRuntime(runtime);
    } finally {
      await closeRunningElectron(runtime);
    }
  });

  test('offline registered learner starts repeatedly from verified local data', async () => {
    const runtime = await launchHiddenElectron(`offline-registered-${production ? 'prod' : 'dev'}`, production);
    try {
      await seedOfflineRegisteredAccount(runtime.page);
      await runtime.page.addInitScript(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      });
      await runtime.page.route('**/*', route => {
        if (route.request().url().startsWith(BASE_URL) || route.request().url().startsWith('file:')) return route.continue();
        return route.abort('internetdisconnected');
      });
      await runtime.page.reload({ waitUntil: 'domcontentloaded' });
      await runtime.page.getByPlaceholder('email או שם משתמש').fill('electronoffline');
      await runtime.page.getByPlaceholder('סיסמה').fill('offline-electron-test-password');
      await runtime.page.getByRole('button', { name: 'התחבר', exact: true }).click();
      await expectSettledWorkspace(runtime.page);
      await repeatWarmStarts(runtime.page);
      assertCleanRuntime(runtime);
    } finally {
      await closeRunningElectron(runtime);
    }
  });

  test('offline anonymous guest starts repeatedly without permission disorder', async () => {
    const runtime = await launchHiddenElectron(`offline-anonymous-${production ? 'prod' : 'dev'}`, production);
    try {
      await runtime.page.addInitScript(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      });
      await runtime.page.route('**/*', route => {
        if (route.request().url().startsWith(BASE_URL) || route.request().url().startsWith('file:')) return route.continue();
        return route.abort('internetdisconnected');
      });
      await seedInterruptedGuestLibrarySnapshot(runtime.page);
      await enterGuest(runtime.page);
      await expectBundledGuestQuestions(runtime.page);
      await openHome(runtime.page);
      await repeatWarmStarts(runtime.page);
      assertCleanRuntime(runtime);
    } finally {
      await closeRunningElectron(runtime);
    }
  });
});
