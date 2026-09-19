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
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAuthHeader,
  redactHeaders,
  request,
  isOpenCodeError,
  opencodeClient,
  verifyOpenCodeNativeMessage,
} from "../lib/opencode-client.js";
import { logger } from "ingenium-core";

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

function v2Session(id = "s1", directory = "/workspace") {
  return {
    id,
    projectID: "project-1",
    title: "Session",
    location: { directory },
    time: { created: 1, updated: 2 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("buildAuthHeader", () => {
  const directories: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
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

  it("prefers a protected file and rejects conflicts or unsafe files", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-opencode-password-"));
    directories.push(directory);
    chmodSync(directory, 0o700);
    const file = join(directory, "password");
    writeFileSync(file, `${"e".repeat(64)}\n`, { mode: 0o600 });
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD_FILE", file);
    expect(buildAuthHeader()).toMatch(/^Basic /);
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "conflict");
    expect(buildAuthHeader()).toBeNull();
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");
    chmodSync(file, 0o640);
    expect(buildAuthHeader()).toBeNull();
    chmodSync(file, 0o600);
    const link = `${file}.link`;
    symlinkSync(file, link);
    vi.stubEnv("OPENCODE_SERVER_PASSWORD_FILE", link);
    expect(() => buildAuthHeader()).toThrow();
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

  it("passes caller cancellation to credential and config HTTP transports", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    const controller = new AbortController();
    const configController = new AbortController();
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.addAuth("openai", { type: "api", key: "transport-canary" }, undefined, controller.signal);
    await opencodeClient.updateGlobalConfig({ provider: { openai: { models: {} } } }, configController.signal);

    expect((fetchSpy.mock.calls[0]![1] as RequestInit).signal).toBe(controller.signal);
    expect((fetchSpy.mock.calls[1]![1] as RequestInit).signal).toBe(configController.signal);
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

  it("extracts error code from name field (OpenCode errors)", async () => {
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

describe("credential operation error sanitization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not return or log reflected upstream credential error fields", async () => {
    const canary = "reflected-credential-canary";
    const submittedCredential = "submitted-credential-canary";
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(mockResponse(502, {
      name: canary,
      _tag: canary,
      code: canary,
      message: canary,
      body: canary,
      data: { name: canary, _tag: canary, code: canary, message: canary, body: canary },
    }))));
    const debug = vi.spyOn(logger, "debug");
    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");

    const results = await Promise.all([
      opencodeClient.connectIntegrationKey("openai", submittedCredential),
      opencodeClient.addAuth("openai", { type: "api", key: submittedCredential }),
      opencodeClient.deleteAuth("openai"),
      opencodeClient.getAuthStatus(),
    ]);

    const codes = [
      "PROVIDER_INTEGRATION_CONNECT_FAILED",
      "PROVIDER_AUTH_APPLY_FAILED",
      "PROVIDER_AUTH_REMOVE_FAILED",
      "PROVIDER_AUTH_STATUS_FAILED",
    ];
    for (const [index, result] of results.entries()) {
      expect(isOpenCodeError(result)).toBe(true);
      if (isOpenCodeError(result)) {
        expect(result.error.code).toBe(codes[index]);
        expect(result.error.status).toBe(502);
      }
    }

    const output = JSON.stringify([results, debug.mock.calls, warn.mock.calls, error.mock.calls]);
    expect(output).not.toContain(canary);
    expect(output).not.toContain(submittedCredential);
  });

  it("normalizes credential abort errors without exposing abort text", async () => {
    const canary = "credential-abort-canary";
    const aborted = new Error(canary) as Error & { name: string };
    aborted.name = "AbortError";
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));

    const result = await opencodeClient.addAuth("openai", { type: "api", key: "credential-input" });

    expect(result).toEqual({
      error: {
        code: "PROVIDER_AUTH_APPLY_FAILED",
        message: "Provider authentication update failed",
      },
    });
    expect(JSON.stringify(result)).not.toContain(canary);
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
      .mockResolvedValue(mockResponse(200, { healthy: true, version: "1.18.31" }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.health();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/global/health");
    expect(result).toEqual({ healthy: true, version: "1.18.31" });
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

  it("listSessions() calls the official v2 session endpoint with directory query", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: [v2Session()], cursor: { next: "session-next" } }))
      .mockResolvedValueOnce(mockResponse(200, { data: [v2Session("s2")], cursor: {} }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.listSessions("/workspace");

    const firstUrl = new URL((fetchSpy.mock.calls[0][0] as Request).url);
    const secondUrl = new URL((fetchSpy.mock.calls[1][0] as Request).url);
    expect(firstUrl.pathname).toBe("/api/session");
    expect(firstUrl.searchParams.get("directory")).toBe("/workspace");
    expect(firstUrl.searchParams.get("order")).toBe("desc");
    expect(secondUrl.searchParams.get("directory")).toBe("/workspace");
    expect(secondUrl.searchParams.get("limit")).toBe("100");
    expect(secondUrl.searchParams.get("cursor")).toBe("session-next");
    expect(secondUrl.searchParams.has("order")).toBe(false);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      expect.objectContaining({ id: "s1", directory: "/workspace" }),
      expect.objectContaining({ id: "s2", directory: "/workspace" }),
    ]);
  });

  it("encodes dynamic v2 session IDs and preserves legacy action path safety", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.getSession("../global/config");
    await opencodeClient.getSession("session_a");
    await opencodeClient.getSessionMessage("session/a", "message/b");
    await opencodeClient.abortSession("session/a");
    await opencodeClient.replyPermission("session/a", "permission/b", { response: "once" });

    const urls = fetchSpy.mock.calls.map(([url]) => typeof url === "string" ? url : (url as Request).url);
    expect(urls).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/api\/session\/session_a$/),
      expect.stringMatching(/\/session\/session%2Fa\/message\/message%2Fb$/),
      expect.stringMatching(/\/session\/session%2Fa\/abort$/),
      expect.stringMatching(/\/session\/session%2Fa\/permissions\/permission%2Fb$/),
    ]));

    await opencodeClient.getSessionMessage("session_1", "message_1");
    expect(fetchSpy.mock.calls.at(-1)![0]).toMatch(/\/session\/session_1\/message\/message_1$/);
  });

  it("rejects unsafe v2 session identifiers before transport", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchSpy);

    for (const segment of ["", ".", ".."]) {
      const result = await opencodeClient.getSession(segment);
      expect(result).toEqual(expect.objectContaining({ error: expect.objectContaining({ code: "INVALID_SESSION_ID" }) }));
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a native session whose directory does not match the requested worktree", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { data: v2Session("ses-1", "/foreign") }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.getSession("ses-1", "/workspace");

    expect(result).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: "EXTERNAL_OBSERVATION_BINDING_REJECTED" }),
    }));
  });

  it("maps v2 assistant content to the retained message envelope without leaking non-text parts", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses-1") }))
      .mockResolvedValueOnce(mockResponse(200, {
        data: [{
            id: "msg-1",
            type: "assistant",
            agent: "agent-1",
            model: { providerID: "provider-1", id: "model-1" },
            time: { created: 10, completed: 20 },
            finish: "stop",
            tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
            cost: 6,
            content: [
              { id: "part-text", type: "text", text: "visible" },
              { id: "part-reasoning", type: "reasoning", text: "private" },
              { id: "part-tool", type: "tool", name: "secret-tool", state: { status: "completed" } },
            ],
        }],
        cursor: { previous: null, next: null },
      }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.getMessages("ses-1", 100, undefined, "/workspace");

    expect(result).toMatchObject([{
      info: expect.objectContaining({ role: "assistant", finish: "stop", providerID: "provider-1", modelID: "model-1" }),
      parts: expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "visible" }),
        expect.objectContaining({ type: "step-finish", cost: 6 }),
      ]),
    }]);
    expect(JSON.stringify(result)).not.toContain("secret-tool");
  });

  it("keeps order only on the first v2 message request and carries opaque cursors unchanged", async () => {
    const nextCursor = "opaque.cursor/with?=+";
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses-1", "/workspace") }))
      .mockResolvedValueOnce(mockResponse(200, {
        data: [{ id: "msg-1", type: "user", time: { created: 1 }, text: "one" }],
        cursor: { next: nextCursor },
      }))
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses-1", "/workspace") }))
      .mockResolvedValueOnce(mockResponse(200, {
        data: [{ id: "msg-2", type: "user", time: { created: 2 }, text: "two" }],
        cursor: {},
      }));
    vi.stubGlobal("fetch", fetchSpy);

    const first = await opencodeClient.getMessagesPage("ses-1", 100, undefined, "/workspace");
    const second = await opencodeClient.getMessagesPage("ses-1", 100, nextCursor, "/workspace");
    const firstMessageUrl = new URL((fetchSpy.mock.calls[1][0] as Request).url);
    const secondMessageUrl = new URL((fetchSpy.mock.calls[3][0] as Request).url);

    expect(first).toMatchObject({ nextCursor, messages: [{ info: { id: "msg-1" } }] });
    expect(second).toMatchObject({ messages: [{ info: { id: "msg-2" } }] });
    expect(second).not.toHaveProperty("nextCursor");
    expect(firstMessageUrl.searchParams.get("directory")).toBe("/workspace");
    expect(firstMessageUrl.searchParams.get("limit")).toBe("100");
    expect(firstMessageUrl.searchParams.get("order")).toBe("asc");
    expect(firstMessageUrl.searchParams.has("cursor")).toBe(false);
    expect(secondMessageUrl.searchParams.get("directory")).toBe("/workspace");
    expect(secondMessageUrl.searchParams.get("limit")).toBe("100");
    expect(secondMessageUrl.searchParams.get("cursor")).toBe(nextCursor);
    expect(secondMessageUrl.searchParams.has("order")).toBe(false);
  });

  it("verifies a hashed native session and exact user message binding", async () => {
    const nativeSessionId = "ses-native";
    const sessionId = `session-${createHash("sha256").update(nativeSessionId, "utf8").digest("hex")}`;
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: [v2Session(nativeSessionId, "/workspace")], cursor: {} }))
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session(nativeSessionId, "/workspace") }))
      .mockResolvedValueOnce(mockResponse(200, {
        data: [{ id: "msg-user", type: "user", time: { created: 10 }, text: "visible" }], cursor: {},
      }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyOpenCodeNativeMessage({
      worktree: "/workspace", sessionId, messageId: "msg-user", role: "user", text: "visible",
    });

    expect(result).toMatchObject({ nativeSessionId, message: { info: { id: "msg-user", role: "user" } } });
    expect(fetchSpy.mock.calls.map(([url]) => typeof url === "string" ? url : (url as Request).url)).toEqual([
      expect.stringContaining("/api/session"),
      expect.stringContaining(`/api/session/${nativeSessionId}`),
      expect.stringContaining(`/api/session/${nativeSessionId}/message`),
    ]);
  });

  it("rejects an invalid native session binding before transport", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyOpenCodeNativeMessage({ worktree: "/workspace", sessionId: "unknown" });

    expect(result).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: "EXTERNAL_OBSERVATION_BINDING_REJECTED" }),
    }));
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it("addAuth() uses the OpenCode credential-set method", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, true));
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.addAuth("openai", { type: "api", key: "credential-input" });

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/auth/openai");
    expect(init.method).toBe("PUT");
  });

  it("disposeInstance() invalidates the selected OpenCode workspace instance", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, true));
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.disposeInstance("/workspace");

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/instance/dispose?directory=%2Fworkspace");
    expect(init.method).toBe("POST");
  });

  it("sendPrompt() calls POST /session/:id/message with parts body", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(mockResponse(200, { info: { id: "msg_1" }, parts: [] }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.sendPrompt("ses_123", {
      messageID: "msg_000000000001abcdefghijklmN",
      parts: [{ type: "text", text: "Hello" }],
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/session/ses_123/message");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      messageID: "msg_000000000001abcdefghijklmN",
      parts: [{ type: "text", text: "Hello" }],
    });
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
