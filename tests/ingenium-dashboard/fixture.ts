import { test as base, expect } from "@playwright/test";
import { getDashboardStorageStatePath, writeDashboardStorageState } from "./fixture-credentials";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

const test = base.extend<{}, { authenticatedStatePath?: string }>({
  authenticatedStatePath: [async ({}, use) => {
    await use(process.env.INGENIUM_TEST_RUN_MANIFEST
      ? getDashboardStorageStatePath(getDefaultSuiteRuntime().context)
      : undefined);
  }, { scope: "worker" }],
  context: async ({ browser, contextOptions, authenticatedStatePath }, use) => {
    const context = await browser.newContext({
      ...contextOptions,
      storageState: authenticatedStatePath ?? contextOptions.storageState,
    });
    await use(context);
    if (authenticatedStatePath) {
      writeDashboardStorageState(getDefaultSuiteRuntime().context, await context.storageState());
    }
    await context.close();
  },
});

export { test, expect };
export type { APIRequestContext, APIResponse, Locator, Page, Request, Route } from "@playwright/test";
