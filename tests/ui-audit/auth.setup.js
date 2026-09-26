import { test as setup, expect } from "@playwright/test";

setup.setTimeout(120000);

setup("authenticate", async ({ page }) => {
  const email = process.env.ONEPOS_TEST_EMAIL;
  const password = process.env.ONEPOS_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "ONEPOS_TEST_EMAIL and ONEPOS_TEST_PASSWORD must be set"
    );
  }

  await page.goto("/app", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');
  const submitButton = page.locator('button[type="submit"]');

  await expect(emailInput).toBeVisible();
  await expect(passwordInput).toBeVisible();

  await emailInput.fill(email);
  await passwordInput.fill(password);

  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/") &&
      response.request().method() === "POST",
    { timeout: 60000 }
  );

  await submitButton.click();

  const loginResponse = await loginResponsePromise;

  console.log("LOGIN URL:", loginResponse.url());
  console.log("LOGIN STATUS:", loginResponse.status());

  let body = "";

  try {
    body = await loginResponse.text();
  } catch {
    body = "(unable to read response body)";
  }

  console.log("LOGIN RESPONSE:", loginResponse.ok() ? "Login successful" : body);

  if (!loginResponse.ok()) {
    throw new Error(
      `Login failed: HTTP ${loginResponse.status()} - ${body}`
    );
  }

  await page.waitForTimeout(2000);

  console.log("CURRENT URL:", page.url());

  await page.context().storageState({
    path: "playwright/.auth/user.json",
  });
});