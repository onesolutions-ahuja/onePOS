import { test, expect } from "@playwright/test";

test("Uber Eats Settings exposes connector, store, and menu mapping configuration", async ({ page }) => {
  await page.goto("/app/settings/uber-eats", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Uber Eats", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Edit Uber Eats" }).click();

  await expect(page.getByLabel("Environment")).toBeVisible();
  await expect(page.getByLabel("Menu item name mapping type")).toBeVisible();
  await expect(page.getByLabel("Description mapping type")).toBeVisible();
  await expect(page.getByRole("button", { name: "Get available stores" })).toBeVisible();
});
