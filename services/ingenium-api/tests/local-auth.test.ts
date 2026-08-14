import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authentication, bootstrap, invitations, projects, resetDbForTest, runtimes, securityTokens } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { clearAuthAttemptRateLimit } from "../lib/middleware/auth-rate-limit.js";
import { authPreflightRouter } from "../lib/routes/auth-preflight.js";
import { organizationsRouter } from "../lib/routes/organizations.js";

let directory = "";
let server: Server;
let baseUrl = "";
let ownerId = "";
let organizationId = "";
const origin = "http://localhost:3000";
const originalDb = process.env.INGENIUM_CORE_DB_PATH;
const originalToken = process.env.INGENIUM_API_TOKEN;
const originalTestMode = process.env.INGENIUM_API_TEST_MODE;
const originalRunNonce = process.env.INGENIUM_TEST_RUN_NONCE;
const originalProject = process.env.INGENIUM_PROJECT;

beforeEach(async () => {
  resetDbForTest();
  clearAuthAttemptRateLimit();
  directory = mkdtempSync(join(tmpdir(), "ingenium-local-auth-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_API_TOKEN = "a".repeat(32);
  ({ userId: ownerId, organizationId } = await bootstrap.claimBootstrap({ email: "owner@example.test", displayName: "Owner", password: "correct horse battery staple" }));
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use(csrfMiddleware);
  app.use("/api/v1/auth", authPreflightRouter);
  app.use("/api/v1/organizations", organizationsRouter);
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
  if (originalTestMode === undefined) delete process.env.INGENIUM_API_TEST_MODE; else process.env.INGENIUM_API_TEST_MODE = originalTestMode;
  if (originalRunNonce === undefined) delete process.env.INGENIUM_TEST_RUN_NONCE; else process.env.INGENIUM_TEST_RUN_NONCE = originalRunNonce;
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT; else process.env.INGENIUM_PROJECT = originalProject;
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

  it("issues a test-only browser session only through the manifest-bound internal fixture contract", async () => {
    const nonce = "10000000-0000-4000-8000-000000000108";
    process.env.INGENIUM_API_TEST_MODE = "1";
    process.env.INGENIUM_TEST_RUN_NONCE = nonce;
    process.env.INGENIUM_PROJECT = "playwright-test-auth108";
    const headers = {
      authorization: `Bearer ${"a".repeat(32)}`,
      "x-ingenium-internal-service": "1",
    };

    const rejected = await fetch(`${baseUrl}/api/v1/auth/fixture-session`, { method: "POST", headers });
    expect(rejected.status).toBe(404);

    const accepted = await fetch(`${baseUrl}/api/v1/auth/fixture-session`, {
      method: "POST",
      headers: {
        ...headers,
        "x-ingenium-fixture-run-nonce": nonce,
        "x-ingenium-fixture-project": "playwright-test-auth108",
      },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("set-cookie")).toMatch(/__Host-ingenium_session=.*Secure; HttpOnly; SameSite=Strict/);
    expect(await accepted.json()).toEqual({ data: { authenticated: true } });
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
    const authToken = sessionCookie.split("=")[1]!;
    const authSession = authentication.resolveSession(authToken)!;
    const project = projects.createProject("logout-runtime", false, organizationId);
    runtimes.authorizeWorkspace({ id: "logout-runtime", organizationId, projectId: project.id, ownerUserId: ownerId, storagePath: "/srv/logout-runtime" });
    let runtime = runtimes.createRuntimeInstance("logout-runtime", { cpuMillis: 1_000, memoryBytes: 1_073_741_824, pidsLimit: 256, diskBytes: 2_147_483_648, processLimit: 128 });
    runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "PROVISIONING", actorType: "manager", actorId: "test" });
    runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "STARTING", actorType: "manager", actorId: "test" });
    runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "test" });
    const exchangeProof = "p".repeat(43);
    const ticket = runtimes.issueRuntimeBrowserLaunchTicket({ runtimeId: runtime.id, ownerUserId: ownerId, authSessionId: authSession.id, audience: "web", rootDomain: "runtime.example.test", launcherOrigin: origin, exchangeProof });
    const browser = runtimes.consumeRuntimeBrowserLaunchTicket({ exchangeProof, audience: "web", origin: ticket.origin, host: ticket.host, launcherOrigin: origin })!;
    expect(runtimes.resolveRuntimeBrowserSession({ token: browser.token, audience: "web", origin: ticket.origin, host: ticket.host })).toBeDefined();
    const accepted = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: "POST", headers: { origin, cookie: sessionCookie, "x-csrf-token": sessionCsrf } });
    expect(accepted.status).toBe(204);
    expect(runtimes.resolveRuntimeBrowserSession({ token: browser.token, audience: "web", origin: ticket.origin, host: ticket.host })).toBeUndefined();
  });

  it("returns standardized 401 and WWW-Authenticate for missing credentials", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/session`);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="ingenium"');
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("returns public OIDC provider labels and session security metadata without secrets", async () => {
    const providers = await fetch(`${baseUrl}/api/v1/auth/oidc/providers`);
    expect(providers.status).toBe(200);
    expect(await providers.json()).toEqual({ data: [] });

    const session = await login();
    const response = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { cookie: session.cookie } });
    const body = await response.json();
    expect(body.data).toMatchObject({ session: { mfaEnabled: false }, installationAdmin: true });
    expect(JSON.stringify(body)).not.toMatch(/token_hash|csrf_hash|password/i);
  });

  it("bootstraps session CSRF and revokes other sessions after step-up", async () => {
    const session = await login();
    const csrf = await fetch(`${baseUrl}/api/v1/auth/session/csrf`, { method: "POST", headers: { origin, "x-ingenium-ui": "dashboard", cookie: session.cookie } });
    expect(csrf.status).toBe(200);
    expect((await csrf.json()).data.csrfToken).toHaveLength(43);
  });

  it("denies undeclared session and scoped-token routes and enforces exact scopes", async () => {
    const session = await login();
    expect((await fetch(`${baseUrl}/api/v1/unknown`, { headers: { cookie: session.cookie } })).status).toBe(404);

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

  it("requires recent step-up to create and revoke invitations", async () => {
    const stale = await login();
    const createBody = JSON.stringify({ email: "invitee@example.test", role: "member" });
    const staleCreate = await fetch(`${baseUrl}/api/v1/organizations/${organizationId}/invitations`, { method: "POST", headers: { "content-type": "application/json", origin, cookie: stale.cookie, "x-csrf-token": stale.csrfToken }, body: createBody });
    expect(staleCreate.status).toBe(403);
    expect((await staleCreate.json()).error.code).toBe("STEP_UP_REQUIRED");

    const elevated = await fetch(`${baseUrl}/api/v1/auth/step-up`, { method: "POST", headers: { "content-type": "application/json", origin, cookie: stale.cookie, "x-csrf-token": stale.csrfToken }, body: JSON.stringify({ credential: "correct horse battery staple" }) });
    const elevatedBody = await elevated.json();
    const cookie = elevated.headers.get("set-cookie")!.split(";")[0]!;
    const headers = { "content-type": "application/json", origin, cookie, "x-csrf-token": elevatedBody.data.csrfToken };
    const created = await fetch(`${baseUrl}/api/v1/organizations/${organizationId}/invitations`, { method: "POST", headers, body: createBody });
    expect(created.status).toBe(201);
    const invitationId = invitations.listInvitations(organizationId)[0]!.id;
    const revoked = await fetch(`${baseUrl}/api/v1/organizations/${organizationId}/invitations/${invitationId}`, { method: "DELETE", headers });
    expect(revoked.status).toBe(204);

    const staleSession = authentication.createSession(ownerId);
    const staleRevoke = await fetch(`${baseUrl}/api/v1/organizations/${organizationId}/invitations/${invitationId}`, { method: "DELETE", headers: { origin, cookie: `${authentication.SESSION_COOKIE_NAME}=${staleSession.token}`, "x-csrf-token": staleSession.csrfToken } });
    expect(staleRevoke.status).toBe(403);
    expect((await staleRevoke.json()).error.code).toBe("STEP_UP_REQUIRED");
  });

  it("rejects an OIDC callback without the initiating browser transaction cookie", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/oidc/callback?state=${"s".repeat(43)}&code=fixture`);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("OIDC_AUTHENTICATION_FAILED");
  });
});
