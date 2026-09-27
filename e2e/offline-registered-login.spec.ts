import { expect, test } from "@playwright/test";
import fs from "node:fs";

const bundledSeedVersion = String((JSON.parse(fs.readFileSync(
  new URL("../src/lib/study/offlineLibrary.generated.json", import.meta.url),
  "utf8",
)) as { seed: { seededAt: number } }).seed.seededAt);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('guides-seen:v1', '1');
    (window as any).__denialFrames = [];
    const inspect = () => {
      const headings = [...document.querySelectorAll('h2')].map(node => node.textContent ?? '');
      for (const text of headings) if (/אין הרשאה|חשבון חסום/.test(text)) (window as any).__denialFrames.push(text);
    };
    new MutationObserver(inspect).observe(document, { subtree: true, childList: true, characterData: true });
  });
});
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as any).__denialFrames)).toEqual([]);
});

for (const admin of [false, true]) {
test(`a previously verified ${admin ? 'admin' : 'registered account'} can log in during a network outage`, async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/*.supabase.co/**", (route) => route.abort("internetdisconnected"));
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (admin) => {
    if (admin) localStorage.setItem('verified-offline-admin:v1:11111111-2222-4333-8444-555555555555', JSON.stringify({ userId: '11111111-2222-4333-8444-555555555555', verifiedAt: Date.now() }));
    const password = "offline-test-password";
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, key, 256);
    const toBase64 = (bytes: Uint8Array) => {
      let binary = "";
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      return btoa(binary);
    };
    localStorage.setItem("local-accounts:v1", JSON.stringify([{
      username: "offlinelearner",
      displayName: "לומד אופליין",
      email: "offlinelearner@example.com",
      passwordObf: "",
      passwordHash: toBase64(new Uint8Array(bits)),
      passwordSalt: toBase64(salt),
      passwordIterations: 210_000,
      status: "registered",
      createdAt: Date.now(),
      registeredAt: Date.now(),
      userId: "11111111-2222-4333-8444-555555555555",
    }]));
  }, admin);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("email או שם משתמש").fill("offlinelearner");
  await page.getByPlaceholder("סיסמה").fill("offline-test-password");
  await page.getByRole("button", { name: "התחבר", exact: true }).click();

  await expect.poll(() => page.evaluate(() => ({
    guest: localStorage.getItem("guest-mode"),
    identity: localStorage.getItem("local-identity-kind"),
  })), { timeout: 20_000 }).toEqual({ guest: "1", identity: "account" });
  await expect(page).toHaveURL(/\/$/);
  // An administrator's ordinary navigation deliberately mirrors a registered
  // learner. Administration remains an authority reached directly, not a
  // different default catalogue.
  await expect(page.getByText("ניהול משתמשים", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(5000);
  await expect(page.getByText("אין הרשאה לפעולה זו", { exact: true })).toHaveCount(0);
  if (admin) {
    expect(await page.evaluate(() => (window as any).__denialFrames)).toEqual([]);
    await page.evaluate(() => {
      history.pushState({}, '', '/?section=admin');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: 'מרכז ניהול', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('אין הרשאת גישה', { exact: true })).toHaveCount(0);
  }
  expect(pageErrors).toEqual([]);
});
}

test("fresh offline guest startup does not show permission errors", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*.supabase.co/**", route => route.abort("internetdisconnected"));
  await page.addInitScript(({ seedVersion }) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    // Reproduce an installation that previously used a restrictive cloud guest
    // content profile. Anonymous machine-local entry must not inherit this
    // cache and hide the bundled offline library.
    localStorage.setItem("content-access-policy:v1:guest", JSON.stringify({
      include_own: true,
      include_site_library: false,
      source_tags: [],
      source_user_ids: [],
    }));
    // Simulate the actual failure shape: a previous large guest save retained
    // the category shell but lost all cards, while the version marker claimed
    // that the bundled seed was already applied.
    localStorage.setItem("guest-study-state", JSON.stringify({
      decks: [],
      cards: [],
      logs: [],
      categories: [{ id: "stale-root", name: "מעטפת ישנה", parentId: null, createdAt: 1 }],
      goals: [],
      shasPlan: null,
      notificationsEnabled: false,
      reminderTime: "20:00",
      dayNotes: [],
      shasPlans: [],
      activeShasPlanId: null,
      cardDecks: [],
      shasReviews: [],
      reviewIntervals: [1, 3, 7, 14, 30],
      learningSessions: [],
      tabConfig: [],
      sidebarConfig: [],
      uiPrefs: {},
      generalPlans: [],
      planReviews: [],
      customCategoryTemplates: [],
      quizPlans: [],
      quizAttempts: [],
      practiceResults: [],
    }));
    localStorage.setItem("guest-study-seed-applied:local-offline", seedVersion);
  }, { seedVersion: bundledSeedVersion });
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "כניסה כאורח — ללא חשבון" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await page.waitForTimeout(5000);
  await expect(page.getByText("אין הרשאה לפעולה זו", { exact: true })).toHaveCount(0);
  const dismissWelcome = page.getByRole("button", { name: /כבר קראתי/ });
  if (await dismissWelcome.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
    await dismissWelcome.click();
  }
  await page.getByRole("button", { name: "תרגול", exact: true }).first().click();
  await page.getByText("תרגול כללי", { exact: true }).click();
  for (const label of ["מועד", "שבת", "ב", "עמוד א׳"]) {
    await page.getByText(label, { exact: true }).click();
  }
  await expect(page.getByTestId("daf-question-count")).toHaveText("(8)");
  expect(errors).toEqual([]);
});
