import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../services/ingenium-api/tests",
  testMatch: "runtime-gateway.browser.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
});
