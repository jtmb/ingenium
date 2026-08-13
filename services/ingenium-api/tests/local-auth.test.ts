import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, resetDbForTest, securityTokens } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { clearAuthAttemptRateLimit } from "../lib/middleware/auth-rate-limit.js";
import { authPreflightRouter } from "../lib/routes/auth-preflight.js";

let directory = "";
let server: Server;
let baseUrl = "";
let ownerId = "";
const origin = "http://localhost:3000";
const originalDb = process.env.INGENIUM_CORE_DB_PATH;
const originalToken = process.env.INGENIUM_API_TOKEN;

beforeEach(async () => {
  resetDbForTest();
  clearAuthAttemptRateLimit();
  directory = mkdtempSync(join(tmpdir(), "ingenium-local-auth-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_API_TOKEN = "a".repeat(32);
  ownerId = (await bootstrap.claimBootstrap({ email: "owner@example.test", displayName: "Owner", password: "correct horse battery staple" })).userId;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use(csrfMiddleware);
  app.use("/api/v1/auth", authPreflightRouter);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  if (originalDb === undefined) delete process.env.INGENIUM_CORE_DB_PATH; else process.env.INGENIUM_CORE_DB_PATH = originalDb;
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN; else process.env.INGENIUM_API_TOKEN = originalToken;
});

async function preAuth(): Promise<{ token: string; cookie: string }> {
  const response = await fetch(`${baseUrl}/api/v1/auth/csrf`);
  return { token: (await response.json()).data.csrfToken, cookie: response.headers.get("set-cookie")!.split(";")[0]! };
}

async function login(): Promise<{ csrfToken: string; cookie: string }> {
  const csrf = await preAuth();
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: csrf.cookie, "x-csrf-token": csrf.token },
    body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery staple" }),
  });
  return {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    csrfToken: (await response.json()).data.csrfToken,
  };
}

describe("AUTH-101 local API", () => {
  it("requires exact pre-auth CSRF and creates a secure session cookie", async () => {
    const rejected = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery staple" }),
    });
    expect(rejected.status).toBe(403);

    const csrf = await preAuth();
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: csrf.cookie, "x-csrf-token": csrf.token },
      body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery staple" }),
    });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toMatch(/__Host-ingenium_session=.*Secure; HttpOnly; SameSite=Strict/);
    const body = await login.json();
    expect(JSON.stringify(body)).not.toContain("token_hash");
  });

  it("requires session-bound CSRF for unsafe cookie-authenticated requests", async () => {
    const csrf = await preAuth();
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: csrf.cookie, "x-csrf-token": csrf.token },
      body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery staple" }),
    });
    const sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const sessionCsrf = (await login.json()).data.csrfToken;
    const rejected = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: "POST", headers: { origin, cookie: sessionCookie } });
    expect(rejected.status).toBe(403);
    const accepted = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: "POST", headers: { origin, cookie: sessionCookie, "x-csrf-token": sessionCsrf } });
    expect(accepted.status).toBe(204);
  });

  it("returns standardized 401 and WWW-Authenticate for missing credentials", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/session`);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="ingenium"');
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("denies undeclared session and scoped-token routes and enforces exact scopes", async () => {
    const session = await login();
    expect((await fetch(`${baseUrl}/api/v1/unknown`, { headers: { cookie: session.cookie } })).status).toBe(403);

    const wrongScope = securityTokens.createScopedApiToken({ userId: ownerId }, ["projects:read"], new Date(Date.now() + 60_000));
    expect((await fetch(`${baseUrl}/api/v1/auth/preflight`, { headers: { authorization: `Bearer ${wrongScope.token}` } })).status).toBe(403);
    const allowed = securityTokens.createScopedApiToken({ userId: ownerId }, ["auth:preflight"], new Date(Date.now() + 60_000));
    expect((await fetch(`${baseUrl}/api/v1/auth/preflight`, { headers: { authorization: `Bearer ${allowed.token}` } })).status).toBe(200);
  });

  it("requires a fresh step-up before creating API tokens", async () => {
    const session = await login();
    const tokenBody = JSON.stringify({ name: "test", scopes: ["auth:preflight"], expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const stale = await fetch(`${baseUrl}/api/v1/auth/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: session.cookie, "x-csrf-token": session.csrfToken },
      body: tokenBody,
    });
    expect(stale.status).toBe(403);
    expect((await stale.json()).error.code).toBe("STEP_UP_REQUIRED");

    const elevated = await fetch(`${baseUrl}/api/v1/auth/step-up`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: session.cookie, "x-csrf-token": session.csrfToken },
      body: JSON.stringify({ credential: "correct horse battery staple" }),
    });
    const elevatedBody = await elevated.json();
    const elevatedCookie = elevated.headers.get("set-cookie")!.split(";")[0]!;
    const created = await fetch(`${baseUrl}/api/v1/auth/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: elevatedCookie, "x-csrf-token": elevatedBody.data.csrfToken },
      body: tokenBody,
    });
    expect(created.status).toBe(201);
  });

  it("rejects an OIDC callback without the initiating browser transaction cookie", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/oidc/callback?state=${"s".repeat(43)}&code=fixture`);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("OIDC_AUTHENTICATION_FAILED");
  });
});
