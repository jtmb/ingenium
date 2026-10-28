import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, request as httpRequest, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authentication, bootstrap, identity, resetDbForTest } from "ingenium-core";
import { issueCompatibilityLaunch, exchangeCompatibilityLaunch, validateCompatibilityAccess, isAuthenticatedCompatibilityRuntimeAccess } from "../lib/compatibility-runtime-access.js";
import { authMiddleware } from "../lib/middleware/auth.js";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";
import { config } from "../config/index.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let directory = "", baseUrl = "", server: Server, ownerId = "";
const root = "ingenium.example.test", origin = `https://${root}`;
const originalDb = process.env.INGENIUM_CORE_DB_PATH;
const originalToken = process.env.INGENIUM_API_TOKEN;
const originalRoot = process.env.INGENIUM_COMPATIBILITY_RUNTIME_ROOT_DOMAIN;
const originalMode = process.env.INGENIUM_DEPLOYMENT_MODE;

beforeEach(async () => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-runtime-lan-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_API_TOKEN = "a".repeat(32);
  process.env.INGENIUM_COMPATIBILITY_RUNTIME_ROOT_DOMAIN = root;
  process.env.INGENIUM_DEPLOYMENT_MODE = "compatibility";
  config.dashboardOrigins.push(origin);
  ({ userId: ownerId } = await bootstrap.claimBootstrap({
    email: "owner@example.test", displayName: "Owner", password: "correct horse battery staple",
  }));
  const app = express();
  app.use(express.json(), authMiddleware, csrfMiddleware, authorizationMiddleware);
  app.post("/api/v1/runtimes/browser/compatibility-launch", issueCompatibilityLaunch);
  app.post("/api/v1/auth/lan-runtime/exchange", exchangeCompatibilityLaunch);
  app.get("/api/v1/auth/lan-runtime/access", validateCompatibilityAccess);
  app.get("/api/v1/auth/session", (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterEach(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  config.dashboardOrigins.splice(config.dashboardOrigins.indexOf(origin), 1);
  for (const [key, value] of Object.entries({
    INGENIUM_CORE_DB_PATH: originalDb, INGENIUM_API_TOKEN: originalToken,
    INGENIUM_COMPATIBILITY_RUNTIME_ROOT_DOMAIN: originalRoot, INGENIUM_DEPLOYMENT_MODE: originalMode,
  })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  vi.useRealTimers();
});

async function probe(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: init.method ?? "GET", headers: init.headers as Record<string, string> }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) {
          for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
        }
        resolve(new Response(incoming.statusCode === 204 ? null : Buffer.concat(chunks), { status: incoming.statusCode, headers }));
      });
    });
    req.on("error", reject);
    req.end(init.body);
  });
}

async function launch(userId = ownerId) {
  const session = authentication.createSession(userId);
  const proof = randomBytes(32).toString("base64url");
  const response = await probe(baseUrl + "/api/v1/runtimes/browser/compatibility-launch", {
    method: "POST", headers: {
      host: root, origin, "content-type": "application/json", "x-ingenium-ui": "dashboard",
      cookie: `${authentication.SESSION_COOKIE_NAME}=${session.token}`, "x-csrf-token": session.csrfToken,
    }, body: JSON.stringify({ audience: "web", exchangeProof: proof }),
  });
  return { session, proof, response };
}
async function exchange(proof: string, host = `opencode.${root}`, callerOrigin = origin) {
  return probe(baseUrl + "/api/v1/auth/lan-runtime/exchange", {
    method: "POST", headers: { host, origin: callerOrigin, "content-type": "application/json" },
    body: JSON.stringify({ proof }),
  });
}
async function access(cookie = "", host = `opencode.${root}`) {
  return probe(baseUrl + "/api/v1/auth/lan-runtime/access", { headers: { host, cookie } });
}

describe("LAN runtime audience grants", () => {
  it("exchanges one administrator proof for a host-only HttpOnly cookie without exposing dashboard credentials", async () => {
    const issued = await launch();
    expect(issued.response.status).toBe(201);
    const body = await issued.response.json();
    expect(body).toEqual({ data: { status: "ready", launchUrl: `https://opencode.${root}/__ingenium/exchange` } });
    expect(JSON.stringify(body)).not.toContain(issued.session.token);
    const exchanged = await exchange(issued.proof);
    expect(exchanged.status).toBe(204);
    const cookie = exchanged.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Host-ingenium_runtime=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800$/);
    expect((await access(cookie.split(";")[0])).status).toBe(204);
    expect((await exchange(issued.proof)).status).toBe(401);
    expect((await probe(baseUrl + "/api/v1/auth/session", { headers: { cookie } })).status).toBe(401);
  });

  it("rejects anonymous access, wrong audience and foreign origins without consuming a valid proof", async () => {
    expect((await access()).status).toBe(401);
    const issued = await launch();
    expect((await exchange(issued.proof, `vscode.${root}`)).status).toBe(401);
    expect((await exchange(issued.proof, `opencode.${root}`, "https://foreign.example")).status).toBe(401);
    const exchanged = await exchange(issued.proof);
    const cookie = exchanged.headers.get("set-cookie")!.split(";")[0];
    expect((await access(cookie, `vscode.${root}`)).status).toBe(401);
    expect((await access(cookie)).status).toBe(204);
  });

  it("revokes runtime access with the parent session and rejects non-administrators", async () => {
    const memberId = identity.createUser("member@example.test", "Member").id;
    expect((await launch(memberId)).response.status).toBe(403);
    const issued = await launch();
    const exchanged = await exchange(issued.proof);
    const cookie = exchanged.headers.get("set-cookie")!.split(";")[0];
    expect(authentication.revokeSession(ownerId, issued.session.session.id)).toBe(true);
    expect((await access(cookie)).status).toBe(401);
  });

  it("expires short-lived exchange proofs and confines the read budget to valid exact probes", async () => {
    const issued = await launch();
    vi.setSystemTime(Date.now() + 61_000);
    expect((await exchange(issued.proof)).status).toBe(401);
    vi.useRealTimers();
    const next = await launch();
    const exchanged = await exchange(next.proof);
    const cookie = exchanged.headers.get("set-cookie")!.split(";")[0];
    const req = { method: "GET", path: "/api/v1/auth/lan-runtime/access", originalUrl: "/api/v1/auth/lan-runtime/access",
      headers: { cookie }, get: (name: string) => name === "host" ? `opencode.${root}` : undefined } as any;
    expect(isAuthenticatedCompatibilityRuntimeAccess(req)).toBe(true);
    expect(isAuthenticatedCompatibilityRuntimeAccess({ ...req, originalUrl: req.originalUrl + "?spoof=1" })).toBe(false);
    expect(isAuthenticatedCompatibilityRuntimeAccess({ ...req, path: "/api/v1/config" })).toBe(false);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(isAuthenticatedCompatibilityRuntimeAccess(req)).toBe(false);
  });
});
