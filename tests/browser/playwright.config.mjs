import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const baseURL = "http://127.0.0.1:4188";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  outputDir: "../../test-results",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  globalTimeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    browserName: "chromium",
    baseURL,
    viewport: { width: 1280, height: 960 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview",
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { PORT: "4188" },
    url: baseURL,
    reuseExistingServer: false,
  },
});
