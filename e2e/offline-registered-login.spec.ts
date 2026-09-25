import { expect, test } from "@playwright/test";

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
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  });
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "כניסה כאורח — ללא חשבון" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await page.waitForTimeout(5000);
  await expect(page.getByText("אין הרשאה לפעולה זו", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
