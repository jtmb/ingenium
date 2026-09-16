import { expect, test } from "./external-suite-navigation-governor";
import type { Browser, BrowserContext, Page } from "@playwright/test";

const dashboardOrigin = new URL(process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000").origin;
const cliOrigin = new URL(process.env.INGENIUM_E2E_OPENCODE_CLI_URL ?? "http://cli.localhost:3000").origin;
const cliWebSocketUrl = `${cliOrigin.replace(/^http/, "ws")}/ws`;
const probePath = "/__ttyd-websocket-regression-probe";

// Chromium otherwise blocks the deliberately cross-origin probe before it
// reaches Nginx, which would test the browser's local-network guard rather
// than the gateway's trusted-Origin rejection.
test.use({ launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] } });

async function openWebSocket(page: Page): Promise<"open" | "error"> {
  return page.evaluate(async (url) =>
    new Promise<"open" | "error">((resolve) => {
      const socket = new WebSocket(url, "tty");
      const timeout = window.setTimeout(() => {
        socket.close();
        resolve("error");
      }, 5_000);

      socket.addEventListener("open", () => {
        window.clearTimeout(timeout);
        socket.close();
        resolve("open");
      }, { once: true });
      socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        resolve("error");
      }, { once: true });
    }),
    cliWebSocketUrl,
  );
}

async function pageAtOrigin(browser: Browser, origin: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const probeUrl = `${origin}${probePath}`;

  await page.route(probeUrl, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>ttyd WebSocket probe</title>",
    }),
  );
  await page.goto(probeUrl);
  expect(await page.evaluate(() => window.location.origin)).toBe(origin);

  return { context, page };
}

test("ttyd WebSocket accepts trusted local origins and rejects an untrusted Origin", async ({ browser }) => {
  const trustedDashboard = await pageAtOrigin(browser, dashboardOrigin);
  const cliFrame = await pageAtOrigin(browser, cliOrigin);
  const untrusted = await pageAtOrigin(browser, "http://untrusted-origin.test");

  try {
    expect(await openWebSocket(trustedDashboard.page)).toBe("open");
    expect(await openWebSocket(cliFrame.page)).toBe("open");
    expect(await openWebSocket(untrusted.page)).toBe("error");
  } finally {
    await Promise.all([trustedDashboard.context.close(), cliFrame.context.close(), untrusted.context.close()]);
  }
});
