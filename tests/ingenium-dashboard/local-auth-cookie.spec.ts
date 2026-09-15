import { expect, test } from "@playwright/test";
import {
  FIXTURE_OWNER_EMAIL,
  FIXTURE_OWNER_PASSWORD,
  FIXTURE_SESSION_COOKIE_NAME,
} from "../test-server-lifecycle";

test("keeps a loopback login session through the Next proxy and revokes it on logout", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("Fixture dashboard URL is unavailable");
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const blockedCookieReasons: string[] = [];
  await cdp.send("Network.enable");
  cdp.on("Network.responseReceivedExtraInfo", (event) => {
    for (const blocked of event.blockedCookies ?? []) blockedCookieReasons.push(...blocked.blockedReasons);
  });

  try {
    await page.goto(new URL("/login", baseURL).toString());
    await page.getByLabel("Email").fill(FIXTURE_OWNER_EMAIL);
    await page.getByLabel("Password").fill(FIXTURE_OWNER_PASSWORD);
    const signIn = page.getByRole("button", { name: "Sign in" });
    await expect(signIn).toBeEnabled();
    const loginResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/auth/login");
    await signIn.click();
    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(200);
    expect(await loginResponse.headerValue("set-cookie")).toMatch(
      new RegExp(`^${FIXTURE_SESSION_COOKIE_NAME}=.+; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200$`),
    );

    await page.waitForURL((url) => url.pathname === "/");
    const cookie = (await context.cookies()).find((candidate) => candidate.name === FIXTURE_SESSION_COOKIE_NAME);
    if (!cookie) {
      throw new Error(`Chromium did not retain the loopback session cookie: ${JSON.stringify(blockedCookieReasons)}`);
    }
    expect(cookie.domain).toBe(new URL(baseURL).hostname);
    expect(cookie.path).toBe("/");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    expect(cookie.value.length).toBeGreaterThanOrEqual(32);
    const replayValue = cookie.value;

    expect(await page.evaluate(async () => (await fetch("/api/v1/auth/session")).status)).toBe(200);
    const csrfResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/auth/session/csrf", {
        method: "POST",
        headers: { "x-ingenium-ui": "dashboard" },
      });
      return { status: response.status, body: await response.json() };
    }) as { status: number; body: { data?: { csrfToken?: string } } };
    expect(csrfResponse.status).toBe(200);
    const csrfToken = csrfResponse.body.data?.csrfToken;
    if (!csrfToken) throw new Error("Session rotation did not return CSRF metadata");
    expect(await page.evaluate(async () => (await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "x-ingenium-ui": "dashboard", "x-csrf-token": "wrong-csrf" },
    })).status)).toBe(403);
    expect(await page.evaluate(async (csrf) => (await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "x-ingenium-ui": "dashboard", "x-csrf-token": csrf },
    })).status, csrfToken)).toBe(204);
    expect((await context.cookies()).some((candidate) => candidate.name === FIXTURE_SESSION_COOKIE_NAME)).toBe(false);

    await context.addCookies([{
      name: FIXTURE_SESSION_COOKIE_NAME,
      value: replayValue,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    }]);
    expect(await page.evaluate(async () => (await fetch("/api/v1/auth/session")).status)).toBe(401);
    expect(blockedCookieReasons).toEqual([]);
  } finally {
    await context.close();
  }
});
