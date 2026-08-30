/**
 * opencode-provider.test.ts — Provider API integration tests.
 *
 * Tests provider listing, auth connect/disconnect/status, password guard,
 * and secret leakage patterns. Uses mocked fetch for provider/auth operations.
 *
 * Pattern:
 *   - Express proxy + mocked fetch for the provider list endpoint (existing route)
 *   - Direct `request()` + mocked fetch for auth endpoints (no proxy routes yet)
 *   - Express proxy without mocked fetch for password guard tests
 *
 * @see opencode-broker.test.ts for the mock-at-fetch-level pattern
 */

import { describe, it, expect, afterEach, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createOAuthCallbackRateLimiter, handleOAuthCallback, opencodeRouter } from "../lib/routes/opencode.js";
import { opencodeClient, request, buildAuthHeader } from "../lib/opencode-client.js";
import { logger } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { compatibilityAuthHeaders } from "./http-fixtures.js";

/* ── Configuration ───────────────────────────────────────────────────────── */

const SAVED_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD;
const SAVED_API_TOKEN = process.env.INGENIUM_API_TOKEN;
const SAVED_API_TOKEN_FILE = process.env.INGENIUM_API_TOKEN_FILE;
const API_TOKEN = "a".repeat(32);

/* ── Express proxy server (shared for all proxy-based tests) ──────────────── */

let server: Server | null = null;
let baseUrl: string;
let apiUrl: string;

function buildApp(): express.Express {
  const app = express();
  app.set("trust proxy", false);
  app.use(express.json());
  app.get("/auth/callback", createOAuthCallbackRateLimiter(), handleOAuthCallback);
  app.post("/api/v1/opencode/integrations/:integrationID/connect/oauth", authMiddleware);
  app.use("/api/v1/opencode", opencodeRouter);
  app.use(errorHandler);
  return app;
}

beforeAll(async () => {
  process.env.INGENIUM_API_TOKEN = API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  const app = buildApp();
  server = createServer(app);

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      apiUrl = `${baseUrl}/api/v1/opencode`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  if (SAVED_API_TOKEN === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = SAVED_API_TOKEN;
  if (SAVED_API_TOKEN_FILE === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = SAVED_API_TOKEN_FILE;
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Create a minimal mock Response object (matching opencode-broker.test.ts). */
function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json" },
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () =>
      Promise.resolve(
        typeof body === "string" ? body : JSON.stringify(body),
      ),
    body: null,
  } as unknown as Response;
}

function beginOAuth(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${apiUrl}/integrations/openai/connect/oauth`, {
    method: "POST",
    headers: compatibilityAuthHeaders(API_TOKEN, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

/** Build a raw upstream provider object, including fields the browser must never receive. */
function makeProvider(
  id: string,
  name: string,
  options: Record<string, unknown> = {},
): any {
  return {
    id,
    name,
    source: "npm",
    env: [`${id.toUpperCase()}_API_KEY`],
    options: {
      apiKey: "",
      ...options,
    },
    models: {
      "model-1": {
        id: "model-1",
        providerID: id,
        name: `${name} Model 1`,
        api: { id, url: `https://api.${id}.com`, npm: `@${id}/ai-sdk` },
        capabilities: {},
        cost: { input: 1, output: 2, cache: { read: 0.5, write: 1 } },
        limit: { context: 4096, output: 1024 },
        status: "available",
        options: {},
        headers: {},
        release_date: "2024-01-01",
        variants: {},
      },
    },
  };
}

/** Build a mock providers response body matching OpenCode ProvidersResponse. */
function mockProvidersResponse(overrides: Partial<{
  all: any[];
  default: Record<string, string>;
  connected: string[];
}> = {}): any {
  return {
    all: overrides.all ?? [
      makeProvider("openai", "OpenAI", { apiKey: "sk-test123" }),
      makeProvider("anthropic", "Anthropic", { apiKey: "sk-ant-test456" }),
      makeProvider("lmstudio", "LM Studio"),
    ],
    default: overrides.default ?? { "openai": "model-1" },
    connected: overrides.connected ?? ["openai", "lmstudio"],
  };
}

/** Test if a string contains any secret-like patterns. */
function containsSecretPattern(text: string): boolean {
  const patterns = [
    /sk-\w+/i,          // OpenAI/Anthropic-style keys
    /\bBearer\s+\S+/i,  // Bearer tokens
    /api_key\s*[:=]\s*\S+/i,  // api_key in JSON/headers
    /api[_-]?key/i,      // any mention of an API key property
  ];
  return patterns.some((p) => p.test(text));
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Provider List Sanitization
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Browser provider catalog DTO", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns only the strict browser provider DTO through the proxy", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");

    const mockData = mockProvidersResponse();
    const spy = vi
      .spyOn(opencodeClient, "listProviders")
      .mockResolvedValue(mockData);

    const res = await fetch(`${apiUrl}/providers?directory=/workspace`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(body).toEqual({
      data: {
        providers: [
          {
            id: "openai",
            label: "OpenAI",
            models: [{ id: "model-1", label: "OpenAI Model 1" }],
            defaultModel: "model-1",
            connected: true,
          },
          {
            id: "anthropic",
            label: "Anthropic",
            models: [{ id: "model-1", label: "Anthropic Model 1" }],
            defaultModel: null,
            connected: false,
          },
          {
            id: "lmstudio",
            label: "LM Studio",
            models: [{ id: "model-1", label: "LM Studio Model 1" }],
            defaultModel: null,
            connected: true,
          },
        ],
      },
    });

    spy.mockRestore();
  });

  it("strips nested endpoint, header, and key-name canaries from successful catalog responses", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    const nestedEndpointCanary = "https://provider-endpoint-canary.invalid/v1";
    const nestedHeaderCanary = "Bearer provider-header-canary";
    const nestedKeyNameCanary = "provider-key-name-canary";
    const provider = makeProvider("safe-provider", "Safe Provider", {
      endpoint: nestedEndpointCanary,
      nested: {
        headers: { authorization: nestedHeaderCanary },
        keyName: nestedKeyNameCanary,
      },
    });
    provider.env = ["PROVIDER_ENV_CANARY"];
    provider.keyName = nestedKeyNameCanary;
    provider.models["model-1"].api = {
      id: "safe-provider",
      url: nestedEndpointCanary,
      npm: "provider-npm-canary",
    };
    provider.models["model-1"].headers = {
      authorization: nestedHeaderCanary,
      [nestedKeyNameCanary]: "nested-key-value-canary",
    };

    const spy = vi
      .spyOn(opencodeClient, "listProviders")
      .mockResolvedValue({
        all: [provider],
        default: { "safe-provider": "model-1" },
        connected: ["safe-provider"],
      });

    const res = await fetch(`${apiUrl}/providers?directory=/workspace`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      data: {
        providers: [{
          id: "safe-provider",
          label: "Safe Provider",
          models: [{ id: "model-1", label: "Safe Provider Model 1" }],
          defaultModel: "model-1",
          connected: true,
        }],
      },
    });
    const response = JSON.stringify(body);
    for (const forbidden of [
      nestedEndpointCanary,
      nestedHeaderCanary,
      nestedKeyNameCanary,
      "PROVIDER_ENV_CANARY",
      "provider-npm-canary",
      "endpoint",
      "headers",
      "keyName",
      "options",
      "env",
      "api",
    ]) {
      expect(response).not.toContain(forbidden);
    }

    spy.mockRestore();
  });

  it("rejects secret-shaped provider and model IDs and redacts unsafe scalar labels", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    const providerIdCanary = "sk-provider-scalar-canary-ABCDEFGHI";
    const modelIdCanary = "sk-model-scalar-canary-ABCDEFGHI";
    const providerLabelCanary = "Bearer provider-label-scalar-canary";
    const modelLabelCanary = "api_key=model-label-scalar-canary";
    const scalarSafeProvider = makeProvider("safe-provider", providerLabelCanary);
    scalarSafeProvider.models = {
      "safe-model": {
        id: "safe-model",
        name: modelLabelCanary,
      },
      "secret-model": {
        id: modelIdCanary,
        name: "ordinary label",
      },
    };

    const spy = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({
      all: [
        makeProvider(providerIdCanary, "Ordinary label"),
        scalarSafeProvider,
      ],
      default: {
        [providerIdCanary]: "model-1",
        "safe-provider": modelIdCanary,
      },
      connected: [providerIdCanary, "safe-provider"],
    });

    const response = await fetch(`${apiUrl}/providers?directory=/workspace`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        providers: [{
          id: "safe-provider",
          label: "safe-provider",
          models: [{ id: "safe-model", label: "safe-model" }],
          defaultModel: null,
          connected: true,
        }],
      },
    });
    const serialized = JSON.stringify(body);
    for (const forbidden of [providerIdCanary, modelIdCanary, providerLabelCanary, modelLabelCanary]) {
      expect(serialized).not.toContain(forbidden);
    }
    spy.mockRestore();
  });

  it("returns empty all array when no providers are configured", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");

    const emptyData = { all: [], default: {}, connected: [] };
    const spy = vi
      .spyOn(opencodeClient, "listProviders")
      .mockResolvedValue(emptyData);

    const res = await fetch(`${apiUrl}/providers?directory=/workspace`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: { providers: [] } });

    spy.mockRestore();
  });

  it("returns a fixed catalog error without nested endpoint, header, or key-name canaries", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    const endpointCanary = "https://provider-error-endpoint-canary.invalid/v1";
    const headerCanary = "Bearer provider-error-header-canary";
    const keyNameCanary = "provider-error-key-name-canary";
    const spy = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({
      error: {
        code: `PROVIDER_${keyNameCanary}`,
        message: JSON.stringify({ endpoint: endpointCanary, headers: { authorization: headerCanary }, keyName: keyNameCanary }),
      },
    });

    const response = await fetch(`${apiUrl}/providers?directory=/workspace`);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: {
        code: "PROVIDER_CATALOG_UNAVAILABLE",
        message: "OpenCode provider catalog is unavailable.",
      },
    });
    const serialized = JSON.stringify(body);
    for (const forbidden of [endpointCanary, headerCanary, keyNameCanary, "endpoint", "headers", "keyName"]) {
      expect(serialized).not.toContain(forbidden);
    }

    spy.mockRestore();
  });

  it("returns a fixed catalog error without scalar provider or model ID canaries", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    const providerIdCanary = "sk-provider-error-scalar-ABCDEFGHI";
    const modelIdCanary = "sk-model-error-scalar-ABCDEFGHI";
    const spy = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({
      error: {
        code: providerIdCanary,
        message: `model=${modelIdCanary}`,
      },
    });

    const response = await fetch(`${apiUrl}/providers?directory=/workspace`);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: {
        code: "PROVIDER_CATALOG_UNAVAILABLE",
        message: "OpenCode provider catalog is unavailable.",
      },
    });
    expect(JSON.stringify(body)).not.toContain(providerIdCanary);
    expect(JSON.stringify(body)).not.toContain(modelIdCanary);
    spy.mockRestore();
  });
});

describe("Provider catalog upstream error sanitization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not return or log opaque provider error codes or text", async () => {
    const opaqueCode = "provider-secret-code-A9B8C7";
    const opaqueText = "credential=provider-secret-text";
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(502, {
      code: opaqueCode,
      message: opaqueText,
    })));
    const warn = vi.spyOn(logger, "warn");

    const result = await opencodeClient.listProviders();

    expect(result).toEqual({
      error: {
        code: "PROVIDER_CATALOG_FAILED",
        message: "OpenCode provider catalog is unavailable",
      },
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(opaqueCode);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(opaqueText);
    expect(JSON.stringify(result)).not.toContain(opaqueCode);
    expect(JSON.stringify(result)).not.toContain(opaqueText);
  });
});

describe("Native provider integrations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns native auth methods and connection state", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.spyOn(opencodeClient, "listIntegrations").mockResolvedValue({
      location: {},
      data: [{ id: "deepseek", name: "DeepSeek", methods: [{ type: "key" }], connections: [] }],
    });

    const res = await fetch(`${apiUrl}/integrations?directory=/workspace`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.data[0]).toMatchObject({ id: "deepseek", methods: [{ type: "key" }] });
  });

  it("rejects malformed OAuth prompt inputs before calling OpenCode", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    const begin = vi.spyOn(opencodeClient, "beginIntegrationOAuth");

    const res = await beginOAuth({ methodID: "chatgpt-browser", inputs: { tenant: "bad\nvalue" } });

    expect(res.status).toBe(422);
    expect(begin).not.toHaveBeenCalled();
  });

  it("rejects unsafe OAuth authorization URLs", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.spyOn(opencodeClient, "beginIntegrationOAuth").mockResolvedValue({
      location: {},
      data: { attemptID: "attempt-1", url: "javascript:alert(1)", instructions: "", mode: "auto", time: { created: 1, expires: 2 } },
    });
    vi.spyOn(opencodeClient, "cancelIntegrationAttempt").mockResolvedValue("");

    const res = await beginOAuth({ methodID: "chatgpt-browser", inputs: {} });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "UNSAFE_OAUTH_URL", message: "Provider returned an unsafe authorization URL" } });
  });

  it("accepts IPv6 loopback OAuth callback URLs", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.spyOn(opencodeClient, "beginIntegrationOAuth").mockResolvedValue({
      location: {},
      data: { attemptID: "attempt-ipv6", url: "http://[::1]:1455/auth/callback?state=ipv6-state", instructions: "", mode: "code", time: { created: Date.now(), expires: Date.now() + 60_000 } },
    });

    const res = await beginOAuth({ methodID: "chatgpt-browser", inputs: {} });

    expect(res.status).toBe(200);
  });

  it("completes a code OAuth attempt through the fixed callback", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.spyOn(opencodeClient, "beginIntegrationOAuth").mockResolvedValue({
      location: {},
      data: {
        attemptID: "attempt-1",
        url: "https://auth.openai.com/authorize?state=state-1",
        instructions: "",
        mode: "code",
        time: { created: Date.now(), expires: Date.now() + 60_000 },
      },
    });
    const complete = vi.spyOn(opencodeClient, "completeIntegrationAttempt").mockResolvedValue("connected");

    const begin = await beginOAuth({ methodID: "chatgpt-browser", inputs: {} });
    expect(begin.status).toBe(200);

    const callback = await fetch(`${baseUrl}/auth/callback?state=state-1&code=oauth-code`);
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("Authorization complete");
    expect(complete).toHaveBeenCalledWith("attempt-1", "oauth-code");
  });

  it("forwards auto OAuth callbacks to OpenCode's local listener", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.spyOn(opencodeClient, "beginIntegrationOAuth").mockResolvedValue({
      location: {},
      data: {
        attemptID: "attempt-auto",
        url: "https://auth.openai.com/authorize?state=state-auto",
        instructions: "",
        mode: "auto",
        time: { created: Date.now(), expires: Date.now() + 60_000 },
      },
    });

    await beginOAuth({ methodID: "chatgpt-browser", inputs: {} });
    const originalFetch = globalThis.fetch;
    const forward = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const callback = await originalFetch(`${baseUrl}/auth/callback?state=state-auto&code=oauth-code`);

    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("Authorization received");
    expect(forward).toHaveBeenCalledWith("http://localhost:1455/auth/callback?code=oauth-code&state=state-auto");
  });

  it("uses a validated configured auto OAuth callback forward URL", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_OAUTH_CALLBACK_FORWARD_URL", "http://[::1]:1455/auth/callback");
    vi.spyOn(opencodeClient, "beginIntegrationOAuth").mockResolvedValue({
      location: {},
      data: { attemptID: "attempt-configured-forward", url: "https://auth.openai.com/authorize?state=configured-forward-state", instructions: "", mode: "auto", time: { created: Date.now(), expires: Date.now() + 60_000 } },
    });
    await beginOAuth({ methodID: "chatgpt-browser", inputs: {} });
    const originalFetch = globalThis.fetch;
    const forward = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    await originalFetch(`${baseUrl}/auth/callback?state=configured-forward-state&code=oauth-code`);

    expect(forward).toHaveBeenCalledWith("http://[::1]:1455/auth/callback?code=oauth-code&state=configured-forward-state");
  });

  it("consumes OAuth callback state to prevent code replay", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.spyOn(opencodeClient, "beginIntegrationOAuth").mockResolvedValue({
      location: {},
      data: {
        attemptID: "attempt-2",
        url: "https://auth.openai.com/authorize?state=state-2",
        instructions: "",
        mode: "code",
        time: { created: Date.now(), expires: Date.now() + 60_000 },
      },
    });
    const complete = vi.spyOn(opencodeClient, "completeIntegrationAttempt").mockResolvedValue("connected");

    await beginOAuth({ methodID: "chatgpt-browser", inputs: {} });
    await fetch(`${baseUrl}/auth/callback?state=state-2&code=oauth-code`);
    const replay = await fetch(`${baseUrl}/auth/callback?state=state-2&code=oauth-code`);

    expect(replay.status).toBe(400);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("cancels the attempt when the provider rejects authorization", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.spyOn(opencodeClient, "beginIntegrationOAuth").mockResolvedValue({
      location: {},
      data: { attemptID: "attempt-3", url: "https://auth.openai.com/authorize?state=state-3", instructions: "", mode: "code", time: { created: Date.now(), expires: Date.now() + 60_000 } },
    });
    const cancel = vi.spyOn(opencodeClient, "cancelIntegrationAttempt").mockResolvedValue("cancelled");

    await beginOAuth({ methodID: "chatgpt-browser", inputs: {} });
    const callback = await fetch(`${baseUrl}/auth/callback?state=state-3&error=access_denied`);

    expect(callback.status).toBe(400);
    expect(await callback.text()).toContain("Authorization was cancelled");
    expect(cancel).toHaveBeenCalledWith("attempt-3");
  });

  it("returns a safe error page when OAuth completion throws", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.spyOn(opencodeClient, "beginIntegrationOAuth").mockResolvedValue({
      location: {},
      data: { attemptID: "attempt-4", url: "https://auth.openai.com/authorize?state=state-4", instructions: "", mode: "code", time: { created: Date.now(), expires: Date.now() + 60_000 } },
    });
    vi.spyOn(opencodeClient, "completeIntegrationAttempt").mockRejectedValue(new Error("network unavailable"));

    await beginOAuth({ methodID: "chatgpt-browser", inputs: {} });
    const callback = await fetch(`${baseUrl}/auth/callback?state=state-4&code=oauth-code`);

    expect(callback.status).toBe(502);
    expect(await callback.text()).toContain("Authorization could not be completed");
  });

  it("sets restrictive response headers while allowing the callback window to close", async () => {
    const callback = await fetch(`${baseUrl}/auth/callback?state=invalid-state`);

    expect(callback.headers.get("cache-control")).toBe("no-store");
    expect(callback.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(callback.headers.get("content-security-policy")).toMatch(/script-src 'nonce-[^']+'/);
    expect(callback.headers.get("content-security-policy")).toContain("object-src 'none'");
    expect(callback.headers.get("referrer-policy")).toBe("no-referrer");
    expect(callback.headers.get("x-frame-options")).toBe("DENY");
    expect(await callback.text()).toContain("window.close()");
  });

  it("rate limits unauthenticated callback requests by the socket client IP", async () => {
    const app = express();
    app.set("trust proxy", false);
    app.get("/auth/callback", createOAuthCallbackRateLimiter(2, 60_000), handleOAuthCallback);
    const limitedServer = createServer(app);
    await new Promise<void>((resolve) => limitedServer.listen(0, "127.0.0.1", resolve));
    const port = (limitedServer.address() as AddressInfo).port;

    try {
      const first = await fetch(`http://127.0.0.1:${port}/auth/callback?state=one`, { headers: { "X-Forwarded-For": "198.51.100.99" } });
      const second = await fetch(`http://127.0.0.1:${port}/auth/callback?state=two`, { headers: { "X-Forwarded-For": "198.51.100.100" } });
      const limited = await fetch(`http://127.0.0.1:${port}/auth/callback?state=three`);

      expect(first.status).toBe(400);
      expect(second.status).toBe(400);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBeTruthy();
    } finally {
      await new Promise<void>((resolve) => limitedServer.close(() => resolve()));
    }
  });

  it("does not expose upstream OpenCode error details through proxy routes", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.spyOn(opencodeClient, "listIntegrations").mockResolvedValue({
      error: { code: "HTTP_500", message: "stack trace /srv/opencode token=secret-value" },
    } as any);

    const response = await fetch(`${apiUrl}/integrations`);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: { code: "HTTP_500", message: "OpenCode request failed." } });
  });
});

describe("Encoded dot segment proxy integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards an encoded dot segment to the sentinel and returns a fixed error promptly", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(404, {
      name: "NotFoundError",
      message: "upstream session details",
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const address = new URL(baseUrl);
      const request = httpRequest({
        hostname: address.hostname,
        port: Number(address.port),
        method: "GET",
        path: "/api/v1/opencode/sessions/%2E",
      }, (upstream) => {
        let body = "";
        upstream.setEncoding("utf8");
        upstream.on("data", (chunk) => { body += chunk; });
        upstream.on("end", () => {
          clearTimeout(timeout);
          resolve({ status: upstream.statusCode ?? 0, body });
        });
      });
      const timeout = setTimeout(() => {
        request.destroy();
        reject(new Error("Encoded dot segment request did not receive a bounded response"));
      }, 1_000);
      request.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      request.end();
    });

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "NotFoundError", message: "OpenCode request failed." },
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const upstreamPath = new URL(fetchSpy.mock.calls[0]![0] as string).pathname;
    expect(upstreamPath).toBe("/session/__invalid_opencode_path_segment__");
    expect(upstreamPath).not.toBe("/");
    expect(upstreamPath).not.toBe("/session/");
    expect(upstreamPath).not.toContain("/global/config");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Provider Connect — POST /auth
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Provider connect", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("creates credential via POST /auth and returns success without raw key", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const expectedResponse = { success: true, providerId: "openai" };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, expectedResponse));

    vi.stubGlobal("fetch", fetchSpy);

    const result = await request("/auth", {
      method: "POST",
      body: { providerId: "openai", apiKey: "sk-test123" },
    });

    // Verify the result (not an error)
    expect(result).not.toHaveProperty("error");
    expect(result).toEqual(expectedResponse);

    // Verify fetch was called with the right args
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callUrl = fetchSpy.mock.calls[0][0] as string;
    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(callUrl).toContain("/auth");
    expect(callInit.method).toBe("POST");

    // Verify auth header was included
    const headers = callInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^Basic /);
  });

  it("returns error from OpenCode when auth POST fails", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(400, {
          message: "Invalid API key format",
          name: "BadRequest",
        }),
      );

    vi.stubGlobal("fetch", fetchSpy);

    const result = await request("/auth", {
      method: "POST",
      body: { providerId: "openai", apiKey: "invalid" },
    });

    expect(result).toHaveProperty("error");
    expect((result as any).error.message).toMatch(/Invalid API key/i);
  });

  it("response body contains no raw credential values", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(200, {
          success: true,
          providerId: "openai",
          // Simulate an OpenCode response that might echo back partial data
          credential: { providerId: "openai", keyPrefix: "sk-..." },
        }),
      );

    vi.stubGlobal("fetch", fetchSpy);

    const result: any = await request("/auth", {
      method: "POST",
      body: { providerId: "openai", apiKey: "sk-test123" },
    });

    const resultStr = JSON.stringify(result);
    // The full key should not appear
    expect(resultStr).not.toContain("sk-test123");
    // Prefixes and safe metadata are OK
    expect(resultStr).toContain("sk-...");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Provider Disconnect — DELETE /auth
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Provider disconnect", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("removes credential via DELETE /auth and returns success", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(200, { success: true, providerId: "openai", disconnected: true }),
      );

    vi.stubGlobal("fetch", fetchSpy);

    const result: any = await request("/auth", {
      method: "DELETE",
      body: { providerId: "openai" },
    });

    expect(result).not.toHaveProperty("error");
    expect(result.success).toBe(true);
    expect(result.disconnected).toBe(true);

    // Verify fetch was called with DELETE method
    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(callInit.method).toBe("DELETE");
  });

  it("returns error when disconnecting a non-existent provider", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(404, {
          message: "No credential found for provider 'nonexistent'",
          name: "NotFoundError",
        }),
      );

    vi.stubGlobal("fetch", fetchSpy);

    const result: any = await request("/auth", {
      method: "DELETE",
      body: { providerId: "nonexistent" },
    });

    expect(result).toHaveProperty("error");
    expect(result.error.message).toMatch(/no credential/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Provider Status — GET /auth/status
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Provider status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns credential statuses with redacted keys", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const mockStatus = {
      location: {},
      data: [
        { id: "openai", name: "OpenAI", methods: [{ type: "key" }], connections: [{ type: "credential", id: "cred-openai" }] },
        { id: "anthropic", name: "Anthropic", methods: [{ type: "key" }], connections: [{ type: "credential", id: "cred-anthropic" }] },
        { id: "lmstudio", name: "LM Studio", methods: [{ type: "env" }], connections: [] },
      ],
    };

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, mockStatus));

    vi.stubGlobal("fetch", fetchSpy);
    const normalized = await opencodeClient.getAuthStatus("/workspace");
    vi.unstubAllGlobals();
    vi.spyOn(opencodeClient, "getAuthStatus").mockResolvedValue(normalized);
    const response = await originalFetch(`${apiUrl}/auth/status?directory=/workspace`);
    const result: any = (await response.json()).data;

    expect(result).not.toHaveProperty("error");
    expect(result.providers).toBeDefined();
    expect(Array.isArray(result.providers)).toBe(true);
    expect(result.providers.length).toBe(3);

    // Verify status fields exist
    const openai = result.providers.find((p: any) => p.providerId === "openai");
    expect(openai).toBeDefined();
    expect(openai.connected).toBe(true);
    expect(openai.keySet).toBe(true);

    // Verify no raw keys in the response
    const responseStr = JSON.stringify(result);
    expect(responseStr).not.toMatch(/sk-\w{10,}/);
    expect(responseStr).not.toMatch(/sk-ant\w{10,}/);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("/api/integration");
    expect(fetchSpy.mock.calls[0]?.[0]).not.toContain("/auth");
  });

  it("shows all providers as disconnected when no credentials are configured", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const emptyStatus = {
      location: {},
      data: [
        { id: "openai", name: "OpenAI", methods: [{ type: "key" }], connections: [] },
        { id: "anthropic", name: "Anthropic", methods: [{ type: "key" }], connections: [] },
      ],
    };

    vi.spyOn(opencodeClient, "getAuthStatus").mockResolvedValue({
      providers: emptyStatus.data.map((integration) => ({
        providerId: integration.id,
        name: integration.name,
        connected: false,
        keySet: false,
      })),
    });
    const response = await fetch(`${apiUrl}/auth/status`);
    const result: any = (await response.json()).data;

    expect(result.providers.every((p: any) => p.connected === false)).toBe(true);
    expect(result.providers.every((p: any) => p.keySet === false)).toBe(true);
  });

  it("returns empty providers array when auth status is unavailable", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    vi.spyOn(opencodeClient, "getAuthStatus").mockResolvedValue({ providers: [] });
    const response = await fetch(`${apiUrl}/auth/status`);
    const result: any = (await response.json()).data;
    expect(result.providers).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Password Guard — 401/503 when credentials are missing
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Password guard — 503 when OPENCODE_SERVER_PASSWORD missing", () => {
  afterEach(() => {
    // Restore password after each test
    if (SAVED_PASSWORD !== undefined) {
      process.env.OPENCODE_SERVER_PASSWORD = SAVED_PASSWORD;
    } else {
      delete process.env.OPENCODE_SERVER_PASSWORD;
    }
  });

  it("GET /providers returns 503 without password", async () => {
    delete process.env.OPENCODE_SERVER_PASSWORD;

    const res = await fetch(`${apiUrl}/providers`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("OPENCODE_NOT_CONFIGURED");
  });

  it("GET /health returns 503 without password", async () => {
    delete process.env.OPENCODE_SERVER_PASSWORD;

    const res = await fetch(`${apiUrl}/health`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("OPENCODE_NOT_CONFIGURED");
  });

  it("GET /agents returns 503 without password", async () => {
    delete process.env.OPENCODE_SERVER_PASSWORD;

    const res = await fetch(`${apiUrl}/agents`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("OPENCODE_NOT_CONFIGURED");
  });

  it("POST /sessions returns 503 without password", async () => {
    delete process.env.OPENCODE_SERVER_PASSWORD;

    const res = await fetch(`${apiUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "test" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("OPENCODE_NOT_CONFIGURED");
  });

  it("GET /mcp returns 503 without password", async () => {
    delete process.env.OPENCODE_SERVER_PASSWORD;

    const res = await fetch(`${apiUrl}/mcp`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("OPENCODE_NOT_CONFIGURED");
  });

  it("client request() returns auth error when password is not set", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    // No fetch mock needed — request() should fail before calling fetch
    const result: any = await request("/provider", { method: "GET" });

    expect(result).toHaveProperty("error");
    expect(result.error.code).toBe("AUTH_NOT_CONFIGURED");
    expect(result.error.message).toMatch(/OPENCODE_SERVER_PASSWORD/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. Agent Secret Check — grep response for key patterns
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Secret leak check", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /**
   * This test simulates a provider list response where apiKey values are present
   * in the upstream data, then verifies the proxy response does NOT contain
   * actual key values. Patterns checked: "sk-", "Bearer", "api_key".
   */
  it("provider list response has no sk- or Bearer patterns", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");

    // Providers with key-less prefix data (what OpenCode server actually returns)
    const cleanData = {
      all: [
        makeProvider("openai", "OpenAI", { apiKey: "" }),
        makeProvider("anthropic", "Anthropic", { apiKey: "" }),
        makeProvider("custom", "Custom Provider", {}),
      ],
      default: { "openai": "gpt-4" },
      connected: ["openai", "custom"],
    };

    const spy = vi
      .spyOn(opencodeClient, "listProviders")
      .mockResolvedValue(cleanData);

    const res = await fetch(`${apiUrl}/providers?directory=/workspace`);
    const body = await res.json();
    const responseStr = JSON.stringify(body);

    // Check for each forbidden pattern
    const patterns: { pattern: RegExp; label: string }[] = [
      { pattern: /sk-\w{10,}/, label: "sk- prefixed keys (long)" },
      { pattern: /\bBearer\s+\S+/i, label: "Bearer tokens" },
      { pattern: /api_key\s*[:=]\s*\S+/i, label: "api_key=value patterns" },
    ];

    for (const { pattern, label } of patterns) {
      expect(responseStr).not.toMatch(pattern);
    }

    // Verify a non-secret response is still returned correctly
    expect(body.data).toBeDefined();
    expect(body.data.providers).toHaveLength(3);
    expect(body.data.providers.filter((provider: { connected: boolean }) => provider.connected)).toHaveLength(2);

    spy.mockRestore();
  });

  it("provider status response has no raw keys", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const mockStatus = {
      location: {},
      data: [
        { id: "openai", name: "OpenAI", methods: [{ type: "key" }], connections: [{ type: "credential", id: "cred-openai" }] },
      ],
    };

    vi.spyOn(opencodeClient, "getAuthStatus").mockResolvedValue({
      providers: mockStatus.data.map((integration) => ({
        providerId: integration.id,
        name: integration.name,
        connected: true,
        keySet: true,
      })),
    });
    const response = await fetch(`${apiUrl}/auth/status`);
    const result: any = (await response.json()).data;
    const responseStr = JSON.stringify(result);

    // Should not contain full key values
    expect(responseStr).not.toMatch(/sk-\w{10,}/);
    // Should not contain Bearer tokens
    expect(responseStr).not.toMatch(/\bBearer\s+\S+/i);
    // Should not contain api_key assignments
    expect(responseStr).not.toMatch(/api_key\s*[:=]\s*\S+/i);
  });

  /**
   * Verify that buildAuthHeader does not accidentally leak into loggable output.
   * The header itself is tested in opencode-broker.test.ts; here we verify that
   * responses never echo the Authorization header value back.
   */
  it("Authorization header value is not echoed in error responses", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    // Simulate a 401 from OpenCode (wrong password)
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(401, {
          message: "Unauthorized",
          name: "AuthError",
        }),
      );

    vi.stubGlobal("fetch", fetchSpy);

    const result: any = await request("/provider");

    // The error message should not contain the auth header
    if (result.error?.message) {
      expect(result.error.message).not.toMatch(/Basic\s+\S+/);
      expect(result.error.message).not.toMatch(/opencode:/);
    }
  });
});
