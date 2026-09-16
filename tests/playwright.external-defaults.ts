import type { PlaywrightTestConfig } from "@playwright/test";

export const externalPlaywrightDefaults = {
  testDir: ".",
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
} as const satisfies Pick<
  PlaywrightTestConfig,
  "testDir" | "retries" | "workers" | "fullyParallel" | "use"
>;
