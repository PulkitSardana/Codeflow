import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/playwright",
  timeout: 30000,
  expect: {
    timeout: 7000
  },
  fullyParallel: false,
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure"
  },
  reporter: [["list"]]
});
