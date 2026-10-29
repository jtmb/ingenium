import { defineConfig } from "@playwright/test";
import { isAbsolute, resolve } from "node:path";

const baseURL = process.env.VEYRA_CUSTOMIZE_TEST_BASE_URL;
if (!baseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) {
  throw new Error("Supply the coordinator-owned loopback fixture through VEYRA_CUSTOMIZE_TEST_BASE_URL.");
}

const ownedOutput = process.env.VEYRA_CUSTOMIZE_OUTPUT_ROOT;
if (!ownedOutput || !isAbsolute(ownedOutput)) {
  throw new Error("Supply the assigned Customize coordination root through VEYRA_CUSTOMIZE_OUTPUT_ROOT.");
}
const outputDir = resolve(ownedOutput, "playwright");
export default defineConfig({
  testDir: ".",
  testMatch: "veyra-customize-browser.browser.ts",
  outputDir,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL,
    storageState: process.env.VEYRA_CUSTOMIZE_TEST_STORAGE_STATE,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
