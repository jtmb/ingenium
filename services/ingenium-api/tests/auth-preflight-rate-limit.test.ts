import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";
import { isUnauthenticatedAuthPreflightRead } from "../lib/middleware/rate-limit.js";
import type { createRateLimiter } from "../lib/middleware/rate-limit.js";

const DEFAULT_RATE_LIMIT = 3;
const PREFLIGHT_RATE_LIMIT = 2;

type RateLimiter = ReturnType<typeof createRateLimiter>;
type CreateRateLimiter = typeof import("../lib/middleware/rate-limit.js").createRateLimiter;

type Client = {
  localAddress: string;
  forwardedFor?: string;
};

type FixtureResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};

let server: Server | undefined;
let baseUrl = "";
let defaultRateLimit: RateLimiter;
let createRateLimiter: CreateRateLimiter;
let preflightRateLimit: RateLimiter;

beforeAll(async () => {
  const rateLimit = await import("../lib/middleware/rate-limit.js");
  createRateLimiter = rateLimit.createRateLimiter;
});

beforeEach(async () => {
  defaultRateLimit = createRateLimiter(DEFAULT_RATE_LIMIT);
  preflightRateLimit = createRateLimiter(PREFLIGHT_RATE_LIMIT);

  const app = express();
  app.use((req, res, next) => {
    if (isUnauthenticatedAuthPreflightRead(req)) {
      preflightRateLimit(req, res, next);
      return;
    }
    defaultRateLimit(req, res, next);
  });
  app.get("/api/v1/auth/csrf", (_req, res) => res.json({ data: { csrfToken: "fixture-csrf" } }));
  app.get("/api/v1/auth/oidc/providers", (_req, res) => res.json({ data: [{ id: "fixture-oidc", name: "Fixture OIDC" }] }));
  app.post("/api/v1/auth/login", (_req, res) => res.status(204).end());
  app.get("/api/v1/strict", (_req, res) => res.json({ data: { ok: true } }));

  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterEach(async () => {
  if (server) await closeHttpServer(server);
  server = undefined;
  defaultRateLimit.clear();
  preflightRateLimit.clear();
});

function send(path: string, client: Client, method = "GET"): Promise<FixtureResponse> {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      agent: false,
      hostname: url.hostname,
      localAddress: client.localAddress,
      method,
      path: `${url.pathname}${url.search}`,
      port: Number(url.port),
      headers: client.forwardedFor === undefined ? {} : { "X-Forwarded-For": client.forwardedFor },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.once("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    request.once("error", reject);
    request.end();
  });
}

function header(response: FixtureResponse, name: string): string {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function saturateDefault(client: Client): Promise<void> {
  for (let index = 0; index < DEFAULT_RATE_LIMIT; index += 1) {
    expect((await send("/api/v1/strict", client)).status).toBe(200);
  }
}

async function saturatePreflight(client: Client): Promise<void> {
  for (let index = 0; index < PREFLIGHT_RATE_LIMIT; index += 1) {
    expect((await send("/api/v1/auth/csrf", client)).status).toBe(200);
  }
}

describe("auth preflight rate limiting", () => {
  it("does not starve exact CSRF or OIDC reads when the default bucket is saturated", async () => {
    const client = { localAddress: "127.0.0.2" };
    await saturateDefault(client);

    const csrf = await send("/api/v1/auth/csrf", client);
    const providers = await send("/api/v1/auth/oidc/providers", client);

    expect(csrf.status).toBe(200);
    expect(JSON.parse(csrf.body)).toEqual({ data: { csrfToken: "fixture-csrf" } });
    expect(providers.status).toBe(200);
    expect(JSON.parse(providers.body)).toEqual({ data: [{ id: "fixture-oidc", name: "Fixture OIDC" }] });
  });

  it("applies the dedicated shared preflight threshold and emits rate headers", async () => {
    const client = { localAddress: "127.0.0.3" };
    await saturatePreflight(client);

    const limited = await send("/api/v1/auth/oidc/providers", client);

    expect(limited.status).toBe(429);
    expect(header(limited, "retry-after")).toMatch(/^\d+$/);
    expect(header(limited, "x-ratelimit-limit")).toBe(String(PREFLIGHT_RATE_LIMIT));
    expect(header(limited, "x-ratelimit-remaining")).toBe("0");
    expect(header(limited, "x-ratelimit-reset")).toMatch(/^\d+$/);
    expect(JSON.parse(limited.body)).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("isolates trusted socket keys and ignores spoofed forwarding headers", async () => {
    const firstClient = { localAddress: "127.0.0.4" };
    const secondClient = { localAddress: "127.0.0.5" };
    await saturatePreflight(firstClient);

    expect((await send("/api/v1/auth/csrf", firstClient)).status).toBe(429);
    expect((await send("/api/v1/auth/csrf", secondClient)).status).toBe(200);

    const spoofedClient = { localAddress: "127.0.0.6", forwardedFor: "198.51.100.1" };
    await saturatePreflight(spoofedClient);
    const changedForward = await send("/api/v1/auth/csrf", {
      ...spoofedClient,
      forwardedFor: "203.0.113.99",
    });

    expect(changedForward.status).toBe(429);
  });

  it("keeps POST login strict", async () => {
    const client = { localAddress: "127.0.0.7" };
    await saturateDefault(client);

    const login = await send("/api/v1/auth/login", client, "POST");

    expect(login.status).toBe(429);
    expect(header(login, "x-ratelimit-limit")).toBe(String(DEFAULT_RATE_LIMIT));
    expect(JSON.parse(login.body)).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it.each([
    ["POST", "/api/v1/auth/csrf", "10"],
    ["OPTIONS", "/api/v1/auth/csrf", "11"],
    ["GET", "/api/v1/auth/csrf/", "12"],
    ["GET", "/api/v1/auth/%63srf", "13"],
    ["GET", "/api/v1/auth/csrf?cache=1", "14"],
  ] as const)("does not exempt %s %s", async (method, path, caseKey) => {
    const client = { localAddress: `127.0.0.${caseKey}` };
    await saturateDefault(client);

    const response = await send(path, client, method);

    expect(response.status).toBe(429);
    expect(header(response, "x-ratelimit-limit")).toBe(String(DEFAULT_RATE_LIMIT));
  });

  it("lets HEAD follow the GET route contract through the dedicated preflight bucket", async () => {
    const fresh = await send("/api/v1/auth/csrf", { localAddress: "127.0.0.20" }, "HEAD");
    expect(fresh.status).toBe(200);
    expect(fresh.body).toBe("");

    const saturatedClient = { localAddress: "127.0.0.21" };
    await saturateDefault(saturatedClient);
    const exempt = await send("/api/v1/auth/csrf", saturatedClient, "HEAD");

    expect(exempt.status).toBe(200);
    expect(exempt.body).toBe("");
  });
});
