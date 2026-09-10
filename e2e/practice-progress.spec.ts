import { expect, test } from "@playwright/test";

test("progress and direct-practice navigation stay connected", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  const guestButton = page.getByRole("button", { name: /אורח|ללא הרשמה|מצב אופליין/ }).first();
  const appShell = page.getByRole("navigation").first();
  await Promise.race([
    guestButton.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    appShell.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
  ]);
  if (await guestButton.isVisible()) {
    await guestButton.click();
    await appShell.waitFor({ state: "visible", timeout: 15_000 });
  }

  const progressButton = page.locator("button:visible").filter({ hasText: /^התקדמות$/ }).first();
  await expect(progressButton).toBeVisible();
  await progressButton.click();
  await expect(page.getByRole("heading", { name: "התקדמות ותוצאות" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "תרגול כללי" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "מבחנים" })).toBeVisible();
  await expect(page.getByLabel("חיפוש בתוצאות")).toBeVisible();
  await page.getByRole("tab", { name: "מבחנים" }).click();
  await expect(page.getByRole("tab", { name: "מבחנים" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "תרגול כללי" }).click();
  await expect(page.getByRole("tab", { name: "תרגול כללי" })).toHaveAttribute("aria-selected", "true");

  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("Failed to load resource"))).toEqual([]);
});
