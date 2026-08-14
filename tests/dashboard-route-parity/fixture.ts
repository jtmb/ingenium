import { expect, test as base } from "../ingenium-dashboard/external-suite-navigation-governor";
import { getDefaultSuiteRuntime } from "../ingenium-dashboard/default-suite-runtime";

export const test = base.extend<{ fixtureBrowserSession: void }>({
  fixtureBrowserSession: [async ({ context, page, baseURL }, use) => {
    if (!baseURL) throw new Error("Route parity fixture dashboard URL is unavailable");
    const previousSession = (await context.cookies(baseURL)).find((cookie) => cookie.name === "__Host-ingenium_session")?.value;
    await page.goto(new URL("/test-fixture/session", baseURL).toString(), { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).searchParams.has("project")).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("ingenium_global_project"))).toBe(getDefaultSuiteRuntime().project);
    const session = (await context.cookies(baseURL)).find((cookie) => cookie.name === "__Host-ingenium_session")?.value;
    expect(session).toBeTruthy();
    expect(session).not.toBe(previousSession);
    await use();
  }, { auto: true }],
});

export { expect };
export type { BrowserContext, Page, Request } from "@playwright/test";
