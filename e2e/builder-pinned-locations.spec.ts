import { expect, test } from "@playwright/test";

test("a practice pin opens the same location in question and exam builders", async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "כניסה למצב אופליין" }).click();
  const appShell = page.getByRole("navigation").first();
  await appShell.waitFor({ state: "visible", timeout: 15_000 });
  const dismissWelcome = page.getByRole("button", { name: /כבר קראתי/ });
  if (await dismissWelcome.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await dismissWelcome.click();
  }
  await page.evaluate(() => {
    localStorage.setItem("question-creation-guide-hidden-v1", "1");
    localStorage.removeItem("question-creation-layout-v1");
    localStorage.removeItem("daf-learning-navigation-view");
    localStorage.removeItem("daf-learning-state");
  });

  await page.getByRole("button", { name: "תרגול", exact: true }).first().click();
  await page.getByText("תרגול כללי", { exact: true }).click();
  for (const label of ["מועד", "שבת", "ב", "עמוד א׳"]) {
    await page.getByText(label, { exact: true }).click();
  }
  await page.getByRole("button", { name: "הוסף הצמדה" }).click();

  await page.getByRole("button", { name: "בניית שאלות", exact: true }).first().click();
  const questionPins = page.locator('[data-testid="builder-pinned-locations"]:visible');
  await expect(questionPins).toBeVisible();
  const questionBuilder = questionPins.locator("xpath=ancestor::section[1]");
  await expect(questionBuilder.getByRole("button", { name: "בחר פריסת בניית שאלות" })).toBeVisible();
  await expect(questionBuilder.getByRole("button", { name: "מועד", exact: true })).toBeVisible();
  await expect(questionBuilder.getByRole("button", { name: "שבת", exact: true })).toHaveCount(0);
  await questionPins.getByRole("button", { name: /עבור להצמדה שבת/ }).click();
  await expect(page.getByText(/הסיווג שנבחר: שבת · דף ב · עמוד א/)).toBeVisible();

  await page.getByRole("button", { name: "בניית מבחנים", exact: true }).first().click();
  const skipBuilderGuide = page.getByRole("button", { name: /דלג על המדריך/ });
  if (await skipBuilderGuide.waitFor({ state: "visible", timeout: 2_000 }).then(() => true).catch(() => false)) await skipBuilderGuide.click();
  const examPins = page.locator('[data-testid="builder-pinned-locations"]:visible');
  await expect(examPins).toBeVisible();
  const examBuilder = examPins.locator("xpath=ancestor::section[1]");
  await expect(examBuilder.getByRole("combobox")).toContainText("עץ ש״ס מרווח");
  await expect(examBuilder.getByRole("button", { name: "מועד", exact: true })).toBeVisible();
  await expect(examBuilder.getByRole("button", { name: "שבת", exact: true })).toHaveCount(0);
  await examPins.getByRole("button", { name: /עבור להצמדה שבת/ }).click();
  await expect(examBuilder.getByText(/בחר עמוד — דף ב/)).toBeVisible();
  await expect(examBuilder.getByText("גרור לכאן מסכת, דף או עמוד")).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("Failed to load resource"))).toEqual([]);
});
