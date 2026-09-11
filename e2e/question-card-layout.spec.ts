import { expect, test } from "@playwright/test";

test("desktop question card is compact and rounded", async ({ page }) => {
  test.setTimeout(60_000);
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
  if (await dismissWelcome.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await dismissWelcome.click();
  }
  await page.getByText("תרגול כללי", { exact: true }).click();
  for (const label of ["מועד", "שבת", "ב", "עמוד א׳"]) {
    await page.getByText(label, { exact: true }).click();
  }
  await expect(page.getByText("שאלות זמינות לעמוד זה (8)", { exact: true })).toBeVisible();
  await expect(page.getByText(/שאלות ברמת הדף — זמינות לתרגול בעמוד א׳ ובעמוד ב׳ עד לסיווג \(8\)/)).toBeVisible();
  const questionList = page.getByTestId("daf-question-list");
  const firstQuestion = questionList.locator(".group").first();
  const editQuestion = firstQuestion.locator('button[aria-label^="ערוך שאלה:"]');
  await expect(editQuestion).toHaveCSS("opacity", "0");
  await expect(editQuestion).toHaveCSS("pointer-events", "none");
  await firstQuestion.hover();
  await expect(editQuestion).toHaveCSS("opacity", "1");
  await expect(editQuestion).toHaveCSS("pointer-events", "auto");
  await editQuestion.click();
  const questionEditor = page.getByTestId("practice-question-editor");
  await expect(questionEditor).toBeVisible();
  await expect(questionEditor.getByRole("heading", { name: "עריכת שאלה ותשובות" })).toBeVisible();
  await expect(questionEditor.getByLabel("שאלה")).not.toHaveValue("");
  await questionEditor.getByRole("button", { name: "סגור" }).click();
  await expect(questionEditor).toBeHidden();
  await page.getByRole("button", { name: "התקדמות לעמוד זה" }).click();
  const pageProgressDialog = page.getByTestId("page-progress-dialog");
  await expect(pageProgressDialog).toBeVisible();
  await expect(pageProgressDialog.getByText(/התקדמות — שבת · דף ב · עמוד א׳/)).toBeVisible();
  await pageProgressDialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "תרגול", exact: true }).last().click();

  const questionCard = page.getByTestId("study-question-card");
  await expect(questionCard).toBeVisible();
  await expect(page.getByTestId("admin-practice-amud-targets")).toHaveCount(0);
  await expect(questionCard).toHaveAttribute("draggable", "false");
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
