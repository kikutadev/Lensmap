import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: ".e2e-artifacts/test-output",
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: "chrome",
    headless: true,
    viewport: { width: 1680, height: 1050 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/start-dev.mjs",
    url: "http://127.0.0.1:5173",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
