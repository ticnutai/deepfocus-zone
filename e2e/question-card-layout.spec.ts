import { expect, test } from "@playwright/test";

test("desktop question card is compact and rounded", async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "כניסה כאורח — ללא חשבון" }).click();

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
  await expect(page.getByTestId("daf-question-count")).toHaveText("(8)");
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

test("mobile starts at the rounded practice row and keeps metadata below the question", async ({ page }) => {
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");
  await page.getByRole("button", { name: "כניסה כאורח — ללא חשבון" }).click();

  const dismissWelcome = page.getByRole("button", { name: /כבר קראתי/ });
  if (await dismissWelcome.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)) {
    await dismissWelcome.click();
  }

  await page.getByRole("tab", { name: "תרגול", exact: true }).click();
  if (await dismissWelcome.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await dismissWelcome.click();
  }
  await page.getByText("תרגול כללי", { exact: true }).click();
  for (const label of ["מועד", "שבת", "ב", "עמוד א׳"]) {
    await page.getByText(label, { exact: true }).click();
  }

  const practice = page.getByTestId("daf-start-practice");
  const addQuestion = page.getByRole("button", { name: "הוספת שאלות לעמוד זה" });
  await expect(practice).toBeVisible();
  await expect(addQuestion).toBeVisible();
  const [practiceBox, addBox, practiceStyle] = await Promise.all([
    practice.boundingBox(),
    addQuestion.boundingBox(),
    practice.evaluate((element) => {
      const style = getComputedStyle(element);
      const play = element.querySelector("span");
      const playRect = play?.getBoundingClientRect();
      return {
        radius: Number.parseFloat(style.borderTopLeftRadius),
        playWidth: playRect?.width ?? 0,
        playHeight: playRect?.height ?? 0,
      };
    }),
  ]);
  expect(practiceBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(addBox?.y ?? 0);
  expect(practiceStyle.radius).toBeGreaterThanOrEqual(24);
  expect(practiceStyle.playWidth).toBeGreaterThanOrEqual(32);
  expect(practiceStyle.playHeight).toBeGreaterThanOrEqual(32);

  await practice.click();
  const questionCard = page.getByTestId("study-question-card");
  await expect(questionCard).toBeVisible();
  const metadata = page.getByTestId("study-question-metadata");
  await expect(metadata).toBeVisible();
  await expect(metadata.getByLabel("מקור השאלה")).toBeVisible();
  const question = questionCard.locator("h3");
  const [questionBox, metadataBox] = await Promise.all([question.boundingBox(), metadata.boundingBox()]);
  expect(questionBox?.y ?? 0).toBeLessThan(metadataBox?.y ?? Number.POSITIVE_INFINITY);
  expect((questionBox?.y ?? 0) + (questionBox?.height ?? 0)).toBeLessThanOrEqual((metadataBox?.y ?? Number.POSITIVE_INFINITY) + 1);
  const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width + 1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("Failed to load resource"))).toEqual([]);
});
