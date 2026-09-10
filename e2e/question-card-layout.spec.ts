import { expect, test } from "@playwright/test";

test("desktop question card is compact and rounded", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "כניסה למצב אופליין" }).click();

  const dismissWelcome = page.getByRole("button", { name: /כבר קראתי/ });
  if (await dismissWelcome.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await dismissWelcome.click();
  }

  await page.getByRole("button", { name: "תרגול", exact: true }).first().click();
  if (await dismissWelcome.isVisible().catch(() => false)) await dismissWelcome.click();
  await page.getByText("תרגול כללי", { exact: true }).click();
  for (const label of ["מועד", "שבת", "ב", "עמוד א׳"]) {
    await page.getByText(label, { exact: true }).click();
  }
  await expect(page.getByText("שאלות זמינות לעמוד זה (8)", { exact: true })).toBeVisible();
  await expect(page.getByText(/שאלות ברמת הדף — זמינות לתרגול בעמוד א׳ ובעמוד ב׳ עד לסיווג \(8\)/)).toBeVisible();
  await page.getByRole("button", { name: "התקדמות לעמוד זה" }).click();
  const pageProgressDialog = page.getByTestId("page-progress-dialog");
  await expect(pageProgressDialog).toBeVisible();
  await expect(pageProgressDialog.getByText(/התקדמות — שבת · דף ב · עמוד א׳/)).toBeVisible();
  await pageProgressDialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "תרגול", exact: true }).last().click();

  const questionCard = page.getByTestId("study-question-card");
  await expect(questionCard).toBeVisible();
  const metrics = await questionCard.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: rect.width,
      height: rect.height,
      parentWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
      radius: Number.parseFloat(style.borderTopLeftRadius),
    };
  });

  expect(metrics.width / metrics.parentWidth).toBeGreaterThan(0.65);
  expect(metrics.width / metrics.parentWidth).toBeLessThan(0.84);
  expect(metrics.height).toBeLessThan(260);
  expect(metrics.radius).toBeGreaterThanOrEqual(40);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("Failed to load resource"))).toEqual([]);
});
