import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui-audit",

  timeout: 60000,

  expect: {
    timeout: 10000,
  },

  use: {
    baseURL: "https://onepos.onrender.com",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],

  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.js/,
    },

    {
      name: "desktop",
      dependencies: ["setup"],
      use: {
        storageState: "playwright/.auth/user.json",
        viewport: { width: 1440, height: 900 },
      },
    },

    {
      name: "tablet",
      dependencies: ["setup"],
      use: {
        storageState: "playwright/.auth/user.json",
        viewport: { width: 1024, height: 768 },
      },
    },

    {
      name: "mobile",
      dependencies: ["setup"],
      use: {
        storageState: "playwright/.auth/user.json",
        ...devices["iPhone 13"],
      },
    },
  ],
});