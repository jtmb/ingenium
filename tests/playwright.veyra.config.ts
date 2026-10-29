import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Focused deterministic UI gate. The fixture is never provider/runtime proof. */
export default defineConfig(base, {
  testMatch: ["**/ingenium-dashboard/veyra-mvp.spec.ts", "**/ingenium-dashboard/veyra-contract-capture.spec.ts"],
  use: {
    ...base.use,
    viewport: { width: 1672, height: 941 },
    launchOptions: { executablePath: process.env.INGENIUM_TEST_BROWSER_EXECUTABLE_PATH, args: ["--disable-gpu"] },
  },
});
