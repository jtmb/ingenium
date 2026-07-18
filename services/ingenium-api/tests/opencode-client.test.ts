/**
 * opencode-client.test.ts — Unit tests for the OpenCode HTTP client module.
 *
 * Tests the server-side HTTP client (`opencode-client.ts`) in isolation using
 * a mocked `globalThis.fetch`. Verifies:
 *   - buildAuthHeader() produces correct Basic auth string (opencode:password)
 *   - redactHeaders() replaces Authorization with REDACTED
 *   - request() constructs correct URLs with query params
 *   - Error normalization: non-OK response → {error: {message, code}}
 *   - AbortError is re-thrown, not normalized
 *   - isOpenCodeError() correctly identifies error shapes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildAuthHeader,
  redactHeaders,
  request,
  isOpenCodeError,
  opencodeClient,
} from "../lib/opencode-client.js";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Create a minimal mock Response object */
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
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    body: null,
  } as unknown as Response;
}

/** Create a mock fetch that throws an AbortError */
function mockAbortError(): Error {
  const err = new Error("The operation was aborted") as Error & { name: string };
  err.name = "AbortError";
  return err;
}

/** Create a mock fetch that throws a TypeError (network failure) */
function mockNetworkError(): Error {
  const err = new Error("fetch failed") as Error & { name: string };
  err.name = "TypeError";
  return err;
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("buildAuthHeader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when OPENCODE_SERVER_PASSWORD is not set", () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");
    expect(buildAuthHeader()).toBeNull();
  });

  it("produces correct Basic auth string with opencode:password format", () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-secret");
    const auth = buildAuthHeader();
    expect(auth).not.toBeNull();
    expect(auth).toMatch(/^Basic /);

    // Decode and verify format: opencode:PASSWORD
    const encoded = auth!.replace("Basic ", "");
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    expect(decoded).toBe("opencode:test-secret");
  });

  it("produces a distinct auth string for different passwords", () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "pass-a");
    const authA = buildAuthHeader();
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "pass-b");
    const authB = buildAuthHeader();
    expect(authA).not.toBeNull();
    expect(authB).not.toBeNull();
    expect(authA).not.toBe(authB);
  });
});

describe("redactHeaders", () => {
  it("replaces authorization header with REDACTED", () => {
    const result = redactHeaders({
      "Content-Type": "application/json",
      Authorization: "Basic b3BlbmNvZGU6cGFzcw==",
      Accept: "application/json",
    });
    expect(result["Content-Type"]).toBe("application/json");
    expect(result.Authorization).toBe("***REDACTED***");
    expect(result.Accept).toBe("application/json");
  });

  it("handles lowercase authorization key", () => {
    const result = redactHeaders({
      authorization: "Bearer token123",
    });
    expect(result.authorization).toBe("***REDACTED***");
  });

  it("returns empty object for empty input", () => {
    expect(redactHeaders({})).toEqual({});
  });

  it("does not modify non-authorization headers", () => {
    const headers = { "X-Custom": "value", Host: "localhost" };
    expect(redactHeaders(headers)).toEqual(headers);
  });
});

describe("isOpenCodeError", () => {
  it("returns true for objects with error property", () => {
    expect(isOpenCodeError({ error: { message: "fail", code: "ERR" } })).toBe(true);
  });

  it("returns false for plain objects without error", () => {
    expect(isOpenCodeError({ data: "ok" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isOpenCodeError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isOpenCodeError(undefined)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isOpenCodeError("string")).toBe(false);
    expect(isOpenCodeError(123)).toBe(false);
    expect(isOpenCodeError(true)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isOpenCodeError([])).toBe(false);
    expect(isOpenCodeError([{ error: "x" }])).toBe(false);
  });

  it("returns false for Error instances", () => {
    expect(isOpenCodeError(new Error("fail"))).toBe(false);
  });
});

describe("request — URL construction", () => {
  beforeEach(() => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("constructs a URL with query parameters", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchSpy);

    await request("/session", {
      query: { directory: "/workspace", limit: 10 },
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("directory=%2Fworkspace");
    expect(url).toContain("limit=10");
  });

  it("excludes undefined query params", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchSpy);

    await request("/session", {
      query: { directory: "/workspace", limit: undefined },
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("directory=%2Fworkspace");
    expect(url).not.toContain("limit");
  });

  it("constructs URL without query string when no query provided", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchSpy);

    await request("/global/health");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/global/health");
    expect(url).not.toContain("?");
  });

  it("sends correct method and auth headers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchSpy);

    await request("/session", { method: "POST", body: { title: "Test" } });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toHaveProperty("Authorization");
    expect(init.headers).toHaveProperty("Content-Type", "application/json");
    expect(init.body).toBe(JSON.stringify({ title: "Test" }));
  });
});

describe("request — error normalization", () => {
  beforeEach(() => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns AUTH_NOT_CONFIGURED when password is not set", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");

    const result = await request("/session");
    expect(isOpenCodeError(result)).toBe(true);
    if (isOpenCodeError(result)) {
      expect(result.error.code).toBe("AUTH_NOT_CONFIGURED");
    }
  });

  it("normalizes 4xx JSON response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(404, { message: "Not found", name: "NotFoundError" }),
      ),
    );

    const result = await request("/session/x");
    expect(isOpenCodeError(result)).toBe(true);
    if (isOpenCodeError(result)) {
      expect(result.error.message).toBe("Not found");
      expect(result.error.code).toBe("NotFoundError");
    }
  });

  it("normalizes 5xx JSON response body with default HTTP_500 code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(500, { message: "Internal error" }),
      ),
    );

    const result = await request("/session");
    expect(isOpenCodeError(result)).toBe(true);
    if (isOpenCodeError(result)) {
      expect(result.error.code).toBe("HTTP_500");
    }
  });

  it("normalizes non-JSON error responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(500, "plain text error", { "content-type": "text/plain" }),
      ),
    );

    const result = await request("/session");
    expect(isOpenCodeError(result)).toBe(true);
    if (isOpenCodeError(result)) {
      expect(result.error.code).toBe("HTTP_500");
    }
  });

  it("uses fallback error message when body parsing fails", async () => {
    const badResponse = {
      ok: false,
      status: 500,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.reject(new Error("parse error")),
      text: () => Promise.reject(new Error("text parse error")),
      body: null,
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(badResponse));

    const result = await request("/session");
    expect(isOpenCodeError(result)).toBe(true);
    if (isOpenCodeError(result)) {
      expect(result.error.message).toContain("HTTP 500");
    }
  });

  it("normalizes network errors to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(mockNetworkError()));

    const result = await request("/session");
    expect(isOpenCodeError(result)).toBe(true);
    if (isOpenCodeError(result)) {
      expect(result.error.code).toBe("NETWORK_ERROR");
      expect(result.error.message).toBeDefined();
    }
  });

  it("extracts error code from _tag field when name is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(404, {
          _tag: "McpServerNotFoundError",
          message: "MCP server not found: lmstudio",
        }),
      ),
    );

    const result = await request("/mcp/lmstudio/connect");
    expect(isOpenCodeError(result)).toBe(true);
    if (isOpenCodeError(result)) {
      expect(result.error.code).toBe("McpServerNotFoundError");
    }
  });

  it("extracts error code from name field (OpenCode v1.18.3 errors)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(400, {
          name: "BadRequest",
          data: { message: "Missing key", kind: "Payload" },
        }),
      ),
    );

    const result = await request("/session/x/message");
    expect(isOpenCodeError(result)).toBe(true);
    if (isOpenCodeError(result)) {
      expect(result.error.code).toBe("BadRequest");
    }
  });
});

describe("request — AbortError", () => {
  beforeEach(() => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("re-throws AbortError instead of normalizing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(mockAbortError()));

    await expect(request("/session")).rejects.toThrow("The operation was aborted");
    await expect(request("/session")).rejects.toHaveProperty("name", "AbortError");
  });
});

describe("opencodeClient — method routing", () => {
  beforeEach(() => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("health() calls GET /global/health", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(mockResponse(200, { healthy: true, version: "1.18.3" }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.health();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/global/health");
    expect(result).toEqual({ healthy: true, version: "1.18.3" });
  });

  it("updateGlobalConfig() patches the running global configuration", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { provider: {} }));
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.updateGlobalConfig({ provider: { lmstudio: { models: {} } } });

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/global/config");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ config: { provider: { lmstudio: { models: {} } } } }));
  });

  it("listSessions() calls GET /session with directory query", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, [{ id: "s1" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.listSessions("/workspace");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/session");
    expect(url).toContain("directory=%2Fworkspace");
    expect(Array.isArray(result)).toBe(true);
  });

  it("listIntegrations() discovers native authentication methods", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { location: {}, data: [] }));
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.listIntegrations("/workspace");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/api/integration");
    expect(url).toContain("location.directory=%2Fworkspace");
  });

  it("beginIntegrationOAuth() forwards only the method and prompt inputs", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { location: {}, data: { attemptID: "attempt-1" } }));
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.beginIntegrationOAuth("openai", "chatgpt-browser", { tenant: "example" });

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/api/integration/openai/connect/oauth");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ methodID: "chatgpt-browser", inputs: { tenant: "example" } }));
  });

  it("sendPrompt() calls POST /session/:id/message with parts body", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(mockResponse(200, { info: { id: "msg_1" }, parts: [] }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.sendPrompt("ses_123", {
      text: "Hello",
      parts: [{ type: "text", text: "Hello" }],
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/session/ses_123/message");
    expect(init.method).toBe("POST");
    expect(init.body).toContain("Hello");
  });

  it("createSession() calls POST /session", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse(200, { id: "ses_new", title: "New" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.createSession({ title: "New" });

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/session");
    expect(init.method).toBe("POST");
  });

  it("deleteSession() calls DELETE /session/:id", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, true));
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.deleteSession("ses_abc");

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/session/ses_abc");
    expect(init.method).toBe("DELETE");
  });

  it("returns error shape when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(mockNetworkError()));

    const result = await opencodeClient.health();
    expect(isOpenCodeError(result)).toBe(true);
    if (isOpenCodeError(result)) {
      expect(result.error.code).toBe("NETWORK_ERROR");
    }
  });
});
