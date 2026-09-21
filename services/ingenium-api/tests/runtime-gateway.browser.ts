import { chromium, expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntimeGatewayServer } from "../scripts/runtime-gateway";

const runtimeId = "11111111-1111-4111-8111-111111111111";
const runtimeHost = `web--${runtimeId}.runtime.localhost`;
const runtimeOrigin = `http://${runtimeHost}`;
const gatewayPort = Number(process.env.INGENIUM_RUNTIME_BROWSER_GATEWAY_PORT ?? "43880");
const sessionToken = `rbs_${"a".repeat(43)}`;
const gatewayToken = "g".repeat(43);
const browserProfiles = [
  { name: "default off-the-record", blockThirdPartyCookies: false },
  { name: "strict third-party-cookie blocking", blockThirdPartyCookies: true },
] as const;

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function gatewayRequest(port: number, origin: string): Promise<{ status: number; allowOrigin: string | null }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.2",
      port,
      method: "OPTIONS",
      path: "/__ingenium/exchange",
      headers: {
        Host: runtimeHost,
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve({
        status: response.statusCode ?? 0,
        allowOrigin: typeof response.headers["access-control-allow-origin"] === "string"
          ? response.headers["access-control-allow-origin"] : null,
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

for (const profile of browserProfiles) test(`redeems a local runtime cookie through ${profile.name}`, async () => {
  const originalEnvironment = { ...process.env };
  const tempDirectory = mkdtempSync(join(tmpdir(), "ingenium-runtime-browser-"));
  const tokenFile = join(tempDirectory, "gateway-token");
  writeFileSync(tokenFile, gatewayToken, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);

  let redeemed = false;
  let launcherOrigin = "";
  const apiServer = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>;
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/runtimes/gateway/exchange") {
        if (redeemed || body.exchangeProof !== "proof") {
          response.writeHead(401).end(JSON.stringify({ error: "expired" }));
          return;
        }
        redeemed = true;
        launcherOrigin = body.launcherOrigin;
        response.end(JSON.stringify({
          data: {
            sessionToken,
            session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
          },
        }));
        return;
      }
      if (request.url === "/runtimes/gateway/validate"
        && body.sessionToken === sessionToken
        && body.audience === "web"
        && body.origin === runtimeOrigin
        && body.host === runtimeHost) {
        response.end(JSON.stringify({
          data: {
            backendName: "127.0.0.2",
            session: { expiresAt: new Date(Date.now() + 60_000).toISOString(), launcherOrigin },
          },
        }));
        return;
      }
      if (request.url === "/runtimes/gateway/activity") {
        response.end(JSON.stringify({ data: { accepted: true } }));
        return;
      }
      response.writeHead(401).end(JSON.stringify({ error: "invalid" }));
    });
  });
  const backendServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Runtime ready</title>");
  });
  const dashboardServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Dashboard probe</title>");
  });

  let gatewayServer: Server | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    await listen(apiServer, 0, "127.0.0.1");
    await listen(backendServer, 4098, "127.0.0.2");
    await listen(dashboardServer, 0, "127.0.0.1");
    const dashboardOrigin = `http://localhost:${(dashboardServer.address() as AddressInfo).port}`;
    Object.assign(process.env, {
      DASHBOARD_ALLOWED_ORIGINS: dashboardOrigin,
      INGENIUM_RUNTIME_API_URL: `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}/`,
      INGENIUM_RUNTIME_GATEWAY_BIND_ADDRESS: "127.0.0.1",
      INGENIUM_RUNTIME_GATEWAY_HOST_PORT: "80",
      INGENIUM_RUNTIME_GATEWAY_PORT: "8080",
      INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE: tokenFile,
      INGENIUM_RUNTIME_ROOT_DOMAIN: "runtime.localhost",
      INGENIUM_RUNTIME_SCHEME: "http",
    });
    gatewayServer = createRuntimeGatewayServer().server;
    await listen(gatewayServer, gatewayPort, "127.0.0.2");

    const launchArgs = [
      `--host-resolver-rules=MAP ${runtimeHost} 127.0.0.2:${gatewayPort},MAP localhost 127.0.0.1`,
      "--disable-save-password-bubble",
      "--password-store=basic",
    ];
    if (profile.blockThirdPartyCookies) {
      const userDataDirectory = join(tempDirectory, "chrome-profile");
      const defaultProfile = join(userDataDirectory, "Default");
      mkdirSync(defaultProfile, { recursive: true });
      writeFileSync(join(defaultProfile, "Preferences"), JSON.stringify({
        credentials_enable_service: false,
        profile: {
          block_third_party_cookies: true,
          cookie_controls_mode: 1,
          password_manager_enabled: false,
        },
      }), { mode: 0o600 });
      context = await chromium.launchPersistentContext(userDataDirectory, {
        channel: "chromium",
        headless: true,
        args: launchArgs,
      });
    } else {
      browser = await chromium.launch({ channel: "chromium", headless: true, args: launchArgs });
      context = await browser.newContext();
    }
    const page = await context.newPage();

    const requestMetadata: Array<{ url: string; cookie: string | null; site: string | null }> = [];
    const requestFailures: Array<{ url: string; method: string; error: string | null }> = [];
    page.on("request", async (request) => {
      if (request.url().startsWith(runtimeOrigin)) {
        const headers = await request.allHeaders();
        requestMetadata.push({ url: request.url(), cookie: headers.cookie ?? null, site: headers["sec-fetch-site"] ?? null });
      }
    });
    page.on("requestfailed", (request) => {
      requestFailures.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText ?? null });
    });
    await page.goto(dashboardOrigin);
    const exchangeResponsePromise = page.waitForResponse((response) =>
      response.url() === `${runtimeOrigin}/__ingenium/exchange` && response.request().method() === "POST");
    const exchange = await page.evaluate(async (origin) => {
      const response = await fetch(`${origin}/__ingenium/exchange`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: "proof" }),
      });
      return { status: response.status, location: response.headers.get("location") };
    }, runtimeOrigin);
    const exchangeResponse = await exchangeResponsePromise;
    const setCookieHeaders = await exchangeResponse.headerValues("set-cookie");

    const cookies = await context.cookies(runtimeOrigin);
    const healthStatus = await page.evaluate(async (origin) => (await fetch(`${origin}/__ingenium/health`, {
      credentials: "include",
      cache: "no-store",
    })).status, runtimeOrigin);
    const healthRequest = requestMetadata.find(({ url }) => url.endsWith("/__ingenium/health"));
    const sentCookieNames = new Set((healthRequest?.cookie ?? "").split(";")
      .map((cookie) => cookie.trim().split("=", 1)[0]).filter(Boolean));
    const storedCookieNames = new Set(cookies.map(({ name }) => name));
    const blockedReasons = setCookieHeaders.flatMap((header) => {
      const name = header.split("=", 1)[0]!;
      if (!storedCookieNames.has(name)) return [{ name, reason: "set-cookie-rejected" }];
      if (!sentCookieNames.has(name)) return [{ name, reason: "third-party-cookie-withheld" }];
      return [];
    });
    await page.evaluate((origin) => {
      const iframe = document.createElement("iframe");
      iframe.src = origin;
      document.body.append(iframe);
    }, runtimeOrigin);

    await expect(page.locator("iframe")).toHaveCount(1);
    await expect.poll(async () => page.frames().find((frame) => frame !== page.mainFrame())?.title())
      .toBe("Runtime ready");
    expect(exchange).toEqual({ status: 204, location: null });
    expect(setCookieHeaders).toEqual([
      expect.stringMatching(new RegExp(`^__Host-ingenium_runtime_web=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=[1-9][0-9]*$`)),
      expect.stringMatching(new RegExp(`^__Host-ingenium_runtime_web_partitioned=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=[1-9][0-9]*$`)),
    ]);
    expect(cookies).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: runtimeHost, httpOnly: true, name: "__Host-ingenium_runtime_web_partitioned", path: "/", sameSite: "None", secure: true, value: sessionToken }),
    ]));
    expect(healthStatus).toBe(204);
    expect(healthRequest?.cookie).toContain(`__Host-ingenium_runtime_web_partitioned=${sessionToken}`);
    if (profile.blockThirdPartyCookies) {
      expect(healthRequest?.cookie).not.toContain(`__Host-ingenium_runtime_web=${sessionToken}`);
      expect(blockedReasons).toEqual([{ name: "__Host-ingenium_runtime_web", reason: "set-cookie-rejected" }]);
    } else {
      expect(cookies).toEqual(expect.arrayContaining([
        expect.objectContaining({ domain: runtimeHost, httpOnly: true, name: "__Host-ingenium_runtime_web", path: "/", sameSite: "None", secure: true, value: sessionToken }),
      ]));
      expect(healthRequest?.cookie).toContain(`__Host-ingenium_runtime_web=${sessionToken}`);
      expect(blockedReasons).toEqual([]);
    }
    expect(requestMetadata.find(({ url }) => url.endsWith("/__ingenium/health"))?.site).toBe("cross-site");
    expect(requestMetadata.find(({ url }) => url === `${runtimeOrigin}/`)?.cookie)
      .toContain(`__Host-ingenium_runtime_web_partitioned=${sessionToken}`);

    await close(backendServer);
    const unavailableHealthStatus = await page.evaluate(async (origin) => (await fetch(`${origin}/__ingenium/health`, {
      credentials: "include",
      cache: "no-store",
    })).status, runtimeOrigin);
    const replayStatus = await page.evaluate(async (origin) => (await fetch(`${origin}/__ingenium/exchange`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof: "proof" }),
    })).status, runtimeOrigin);
    const untrustedPage = await context.newPage();
    await untrustedPage.goto(`http://127.0.0.1:${(dashboardServer.address() as AddressInfo).port}`);
    const untrustedResult = await untrustedPage.evaluate(async (origin) => {
      try {
        await fetch(`${origin}/__ingenium/exchange`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proof: "proof" }),
        });
        return "unexpected-success";
      } catch (error) {
        return error instanceof TypeError ? "cors-blocked" : "unexpected-error";
      }
    }, runtimeOrigin);
    const untrustedResponse = await gatewayRequest(gatewayPort, `http://127.0.0.1:${(dashboardServer.address() as AddressInfo).port}`);
    expect(unavailableHealthStatus).toBe(503);
    expect(replayStatus).toBe(401);
    expect(untrustedResult).toBe("cors-blocked");
    expect(untrustedResponse).toEqual({ status: 403, allowOrigin: null });
    console.log(JSON.stringify({
      profile: profile.name,
      setCookieNames: setCookieHeaders.map((header) => header.split("=", 1)[0]),
      storedCookieNames: [...storedCookieNames].sort(),
      sentCookieNames: [...sentCookieNames].sort(),
      blockedReasons,
      healthStatus,
      iframeReady: true,
      replayStatus,
      untrustedStatus: untrustedResponse.status,
    }));
    expect(requestFailures).toEqual(expect.arrayContaining([
      { url: `${runtimeOrigin}/__ingenium/exchange`, method: "POST", error: "net::ERR_ABORTED" },
      { url: `${runtimeOrigin}/__ingenium/health`, method: "GET", error: "net::ERR_ABORTED" },
    ]));
  } finally {
    await context?.close();
    await browser?.close();
    await Promise.all([
      ...(gatewayServer?.listening ? [close(gatewayServer)] : []),
      ...(apiServer.listening ? [close(apiServer)] : []),
      ...(backendServer.listening ? [close(backendServer)] : []),
      ...(dashboardServer.listening ? [close(dashboardServer)] : []),
    ]);
    process.env = originalEnvironment;
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
