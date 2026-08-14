import { test as base, expect } from "@playwright/test";
import { createTestRunBrowserStorageState, resetTestRunChatFixture } from "../test-server-lifecycle";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

const test = base.extend({
  context: async ({ browser, contextOptions }, use) => {
    let storageState = contextOptions.storageState;
    if (process.env.INGENIUM_TEST_RUN_MANIFEST) {
      const runtime = getDefaultSuiteRuntime();
      await resetTestRunChatFixture(runtime.context);
      storageState = await createTestRunBrowserStorageState(runtime.context);
    }
    const context = await browser.newContext({ ...contextOptions, storageState });
    await use(context);
    await context.close();
  },
});

export { test, expect };
export type { APIRequestContext, APIResponse, Locator, Page, Request, Route } from "@playwright/test";
