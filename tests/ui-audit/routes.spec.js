import { test, expect } from "@playwright/test";

const routes = [
  "/app",
  "/app/settings",
  "/app/settings/platform",
  "/app/products",
  "/app/customers",
  "/app/suppliers",
  "/app/inventory",
  "/app/purchases",
  "/app/online-orders",
];

for (const route of routes) {
  test(`UI audit ${route}`, async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    page.on("requestfailed", (request) => {
      failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText || "unknown",
      });
    });

    const response = await page.goto(route, {
      waitUntil: "domcontentloaded",
    });

    if (response) {
      expect(response.status()).toBeLessThan(500);
    }

    await page.waitForTimeout(1500);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      );
    });

    console.log("\nROUTE:", route);
    console.log("Console errors:", consoleErrors);
    console.log("Page errors:", pageErrors);
    console.log("Failed requests:", failedRequests);
    console.log("Horizontal overflow:", hasHorizontalOverflow);

    await page.screenshot({
      path: `test-results/${route.replaceAll("/", "_")}.png`,
      fullPage: true,
    });

    expect(
      consoleErrors,
      `Console errors on ${route}`
    ).toEqual([]);

    expect(
      pageErrors,
      `Runtime errors on ${route}`
    ).toEqual([]);

    expect(
      failedRequests,
      `Failed network requests on ${route}`
    ).toEqual([]);

    expect(
      hasHorizontalOverflow,
      `Horizontal overflow detected on ${route}`
    ).toBe(false);
  });
}