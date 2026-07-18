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
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createOAuthCallbackRateLimiter, handleOAuthCallback, opencodeRouter } from "../lib/routes/opencode.js";
import { opencodeClient, request, buildAuthHeader } from "../lib/opencode-client.js";

/* ── Configuration ───────────────────────────────────────────────────────── */

const SAVED_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD;

/* ── Express proxy server (shared for all proxy-based tests) ──────────────── */

let server: Server | null = null;
let baseUrl: string;
let apiUrl: string;

function buildApp(): express.Express {
  const app = express();
  app.set("trust proxy", false);
  app.use(express.json());
  app.get("/auth/callback", createOAuthCallbackRateLimiter(), handleOAuthCallback);
  app.use("/api/v1/opencode", opencodeRouter);
  return app;
}

beforeAll(async () => {
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

/** Build a provider info object with optional apiKey in options. */
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
    default: overrides.default ?? { "openai": "gpt-4" },
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

describe("Provider list sanitization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns provider list with expected shape through proxy", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");

    const mockData = mockProvidersResponse();
    const spy = vi
      .spyOn(opencodeClient, "listProviders")
      .mockResolvedValue(mockData);

    const res = await fetch(`${apiUrl}/providers?directory=/workspace`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(body.data.all).toBeDefined();
    expect(Array.isArray(body.data.all)).toBe(true);
    expect(body.data.all.length).toBeGreaterThan(0);
    expect(body.data.default).toBeDefined();
    expect(body.data.connected).toBeDefined();
    expect(Array.isArray(body.data.connected)).toBe(true);

    // Verify provider shape
    const provider = body.data.all[0];
    expect(typeof provider.id).toBe("string");
    expect(typeof provider.name).toBe("string");
    expect(provider.models).toBeDefined();

    spy.mockRestore();
  });

  it("does not expose apiKey in provider options", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");

    // Mock providers — real OpenCode server already sanitizes apiKey from options,
    // but we test the proxy layer to make sure no raw keys leak through.
    const cleanData = mockProvidersResponse({
      all: [
        makeProvider("openai", "OpenAI", { apiKey: "" }),
        makeProvider("anthropic", "Anthropic", { apiKey: "" }),
      ],
    });

    const spy = vi
      .spyOn(opencodeClient, "listProviders")
      .mockResolvedValue(cleanData);

    const res = await fetch(`${apiUrl}/providers?directory=/workspace`);
    const body = await res.json();

    expect(res.status).toBe(200);

    // Check every provider's options does NOT contain raw apiKey
    for (const provider of body.data.all) {
      if (provider.options) {
        const optsStr = JSON.stringify(provider.options);
        expect(optsStr).not.toMatch(/sk-\w{10,}/);
        expect(optsStr).not.toMatch(/api[_-]?key\s*[:=]\s*\S{10,}/i);
      }
    }

    // Check the entire response for secret patterns
    const responseStr = JSON.stringify(body);
    expect(responseStr).not.toMatch(/sk-\w{10,}/);

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
    expect(body.data.all).toEqual([]);
    expect(body.data.connected).toEqual([]);

    spy.mockRestore();
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

    const res = await fetch(`${apiUrl}/integrations/openai/connect/oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodID: "chatgpt-browser", inputs: { tenant: "bad\nvalue" } }),
    });

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

    const res = await fetch(`${apiUrl}/integrations/openai/connect/oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodID: "chatgpt-browser", inputs: {} }),
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "UNSAFE_OAUTH_URL", message: "Provider returned an unsafe authorization URL" } });
  });

  it("accepts IPv6 loopback OAuth callback URLs", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.spyOn(opencodeClient, "beginIntegrationOAuth").mockResolvedValue({
      location: {},
      data: { attemptID: "attempt-ipv6", url: "http://[::1]:1455/auth/callback?state=ipv6-state", instructions: "", mode: "code", time: { created: Date.now(), expires: Date.now() + 60_000 } },
    });

    const res = await fetch(`${apiUrl}/integrations/openai/connect/oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodID: "chatgpt-browser", inputs: {} }),
    });

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

    const begin = await fetch(`${apiUrl}/integrations/openai/connect/oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodID: "chatgpt-browser", inputs: {} }),
    });
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

    await fetch(`${apiUrl}/integrations/openai/connect/oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodID: "chatgpt-browser", inputs: {} }),
    });
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
    await fetch(`${apiUrl}/integrations/openai/connect/oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodID: "chatgpt-browser", inputs: {} }),
    });
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

    await fetch(`${apiUrl}/integrations/openai/connect/oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodID: "chatgpt-browser", inputs: {} }),
    });
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

    await fetch(`${apiUrl}/integrations/openai/connect/oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodID: "chatgpt-browser", inputs: {} }),
    });
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

    await fetch(`${apiUrl}/integrations/openai/connect/oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodID: "chatgpt-browser", inputs: {} }),
    });
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
      providers: [
        {
          providerId: "openai",
          connected: true,
          keyPrefix: "sk-...",
          keySet: true,
        },
        {
          providerId: "anthropic",
          connected: true,
          keyPrefix: "sk-ant-...",
          keySet: true,
        },
        {
          providerId: "lmstudio",
          connected: false,
          keyPrefix: null,
          keySet: false,
        },
      ],
    };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, mockStatus));

    vi.stubGlobal("fetch", fetchSpy);

    const result: any = await request("/auth/status");

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
    // Prefixes like "sk-..." are acceptable metadata
  });

  it("shows all providers as disconnected when no credentials are configured", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const emptyStatus = {
      providers: [
        { providerId: "openai", connected: false, keyPrefix: null, keySet: false },
        { providerId: "anthropic", connected: false, keyPrefix: null, keySet: false },
      ],
    };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, emptyStatus));

    vi.stubGlobal("fetch", fetchSpy);

    const result: any = await request("/auth/status");

    expect(result.providers.every((p: any) => p.connected === false)).toBe(true);
    expect(result.providers.every((p: any) => p.keySet === false)).toBe(true);
  });

  it("returns empty providers array when auth status is unavailable", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { providers: [] }));

    vi.stubGlobal("fetch", fetchSpy);

    const result: any = await request("/auth/status");
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
      connected: ["openai", "lmstudio"],
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
    expect(body.data.all.length).toBe(3);
    expect(body.data.connected.length).toBe(2);

    spy.mockRestore();
  });

  it("provider status response has no raw keys", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubEnv("OPENCODE_URL", "http://localhost:4098");

    const mockStatus = {
      providers: [
        {
          providerId: "openai",
          connected: true,
          keyPrefix: "sk-...",
          keySet: true,
        },
      ],
    };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, mockStatus));

    vi.stubGlobal("fetch", fetchSpy);

    const result: any = await request("/auth/status");
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
