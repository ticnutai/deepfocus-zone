import { expect, test } from "@playwright/test";

test("a previously verified registered account can log in during a network outage", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/auth");
  await page.evaluate(async () => {
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
  });

  await page.route("**/*.supabase.co/**", (route) => route.abort("internetdisconnected"));
  await page.reload();
  await page.getByPlaceholder("email או שם משתמש").fill("offlinelearner");
  await page.getByPlaceholder("סיסמה").fill("offline-test-password");
  await page.getByRole("button", { name: "התחבר", exact: true }).click();

  await expect.poll(() => page.evaluate(() => ({
    guest: localStorage.getItem("guest-mode"),
    identity: localStorage.getItem("local-identity-kind"),
  })), { timeout: 20_000 }).toEqual({ guest: "1", identity: "account" });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("ניהול משתמשים", { exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
