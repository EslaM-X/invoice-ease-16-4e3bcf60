import { defineConfig, devices } from "@playwright/test";

// Playwright config for chat E2E. Assumes the dev server is already running
// at http://localhost:8080 (Lovable sandbox default). Run with:
//   bunx playwright test
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PW_BASE_URL ?? "http://localhost:8080",
    headless: true,
    trace: "retain-on-failure",
    viewport: { width: 390, height: 844 },
  },
  projects: [
    { name: "iphone-12",  use: { ...devices["iPhone 12"] } },
    { name: "pixel-5",    use: { ...devices["Pixel 5"] } },
    { name: "iphone-se",  use: { ...devices["iPhone SE"] } },
  ],
});
