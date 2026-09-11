import { expect, test } from "@playwright/test";

test("a regular user can choose a theme and the choice survives reload without admin tools", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  const guestButton = page.getByRole("button", { name: /אורח|ללא הרשמה|מצב אופליין/ }).first();
  const navigation = page.getByRole("navigation").first();
  await Promise.race([
    guestButton.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    navigation.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
  ]);
  if (await guestButton.isVisible()) {
    await guestButton.click();
    await navigation.waitFor({ state: "visible", timeout: 15_000 });
  }

  await page.getByRole("button", { name: "בחר ערכת נושא" }).first().click();
  await expect(page.getByText("ערכות נושא", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /פרסם כברירת מחדל/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /עריכה חיה/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Midnight Gold/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight-gold");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight-gold");
  expect(pageErrors).toEqual([]);
});
