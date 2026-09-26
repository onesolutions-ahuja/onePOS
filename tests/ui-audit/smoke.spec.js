import { test, expect } from "@playwright/test";

test("onePOS smoke audit", async ({ page }) => {
  const consoleErrors = [];
  const failedRequests = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText || "unknown",
    });
  });

  const response = await page.goto("/app", {
    waitUntil: "domcontentloaded",
  });

  expect(response).not.toBeNull();

  await page.screenshot({
    path: "test-results/app-home.png",
    fullPage: true,
  });

  console.log("Console errors:", consoleErrors);
  console.log("Failed requests:", failedRequests);
});