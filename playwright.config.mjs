import { defineConfig } from "@playwright/test";

// The tests drive the organ through its controls and measure the audio it
// produces, so they run one at a time: parallel workers would compete for CPU
// and make the real-time audio measurements noisy.
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: "http://localhost:8123/",
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: {
    command: "node scripts/serve.mjs 8123",
    url: "http://localhost:8123/",
    reuseExistingServer: !process.env.CI,
  },
});
