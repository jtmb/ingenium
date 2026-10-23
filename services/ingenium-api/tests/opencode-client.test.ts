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
  type CommandBody,
} from "../lib/opencode-client.js";
import { withOpenCodeRuntimeTarget } from "../lib/runtime-opencode-context.js";
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

  it("passes caller cancellation to credential transports and fails config patches closed", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    const controller = new AbortController();
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.addAuth("openai", { type: "api", key: "transport-canary" }, undefined, controller.signal);
    const configResult = await opencodeClient.updateGlobalConfig({ provider: { openai: { models: {} } } }, controller.signal);

    expect((fetchSpy.mock.calls[0]![1] as RequestInit).signal).toBe(controller.signal);
    // v2 has no arbitrary config patch; the method must not reach the transport.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(configResult).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: "OPENCODE_V2_CONFIG_PATCH_UNAVAILABLE" }),
    }));
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

  it("health() calls GET /api/info and projects the v2 identity document", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(mockResponse(200, { version: "2.0.11", pid: 1, urls: [], paths: {} }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.health();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/api/info");
    expect(result).toEqual({ healthy: true, version: "2.0.11" });
  });

  it("updateGlobalConfig() fails closed because v2 supports only a shell config patch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { provider: {} }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.updateGlobalConfig({ provider: { lmstudio: { models: {} } } });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: "OPENCODE_V2_CONFIG_PATCH_UNAVAILABLE" }),
    }));
  });

  it("listSessions() calls the v2 session endpoint with directory query", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: [v2Session()], cursor: { next: "session-next" } }))
      .mockResolvedValueOnce(mockResponse(200, { data: [v2Session("s2")], cursor: {} }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.listSessions("/workspace");

    const firstUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    const secondUrl = new URL(fetchSpy.mock.calls[1][0] as string);
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

  it("rejects path-traversal session IDs before transport and encodes dynamic path segments", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("session_a", "/workspace") }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }))
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("session_1", "/workspace") }))
      .mockResolvedValueOnce(mockResponse(200, {
        data: { id: "message_1", type: "user", time: { created: 1 }, text: "hi" },
      }));
    vi.stubGlobal("fetch", fetchSpy);

    const traversal = await opencodeClient.getSession("../global/config");
    expect(traversal).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: "INVALID_SESSION_ID" }),
    }));
    expect(fetchSpy).not.toHaveBeenCalled();

    await opencodeClient.getSession("session_a");
    await opencodeClient.replyPermission("session/a", "permission/b", { response: "once" });

    const urls = fetchSpy.mock.calls.map(([url]) => url as string);
    expect(urls).toEqual([
      expect.stringMatching(/\/api\/session\/session_a$/),
      expect.stringMatching(/\/api\/session\/session%2Fa\/permission\/permission%2Fb\/reply$/),
    ]);

    await opencodeClient.getSessionMessage("session_1", "message_1");
    // Binding validation reads the session first, then the message itself.
    const messageUrls = fetchSpy.mock.calls.slice(-2).map(([url]) => url as string);
    expect(messageUrls).toEqual([
      expect.stringMatching(/\/api\/session\/session_1$/),
      expect.stringMatching(/\/api\/session\/session_1\/message\/message_1$/),
    ]);
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

  it("maps v2 assistant text, reasoning, and tool content to the retained message envelope", async () => {
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
              {
                id: "part-tool", type: "tool", name: "websearch",
                state: { status: "completed", input: { query: "v2" }, content: [{ type: "text", text: "done" }] },
              },
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
        expect.objectContaining({
          type: "tool",
          tool: "websearch",
          callID: "part-tool",
          state: expect.objectContaining({ status: "completed", input: { query: "v2" } }),
        }),
        expect.objectContaining({ type: "step-finish", cost: 6 }),
      ]),
    }]);
  });

  it("keeps order only on the first v2 message request and carries opaque cursors unchanged", async () => {
    const nextCursor = "opaque.cursor/with?=+";
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses-1", "/workspace") }))
      .mockResolvedValueOnce(mockResponse(200, {
        data: [{
          id: "msg-1", type: "user", time: { created: 1 },
          text: "<untrusted-reference-data>hidden</untrusted-reference-data>\none",
          metadata: { ingeniumVisibleText: "one" },
        }],
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
    const firstMessageUrl = new URL(fetchSpy.mock.calls[1][0] as string);
    const secondMessageUrl = new URL(fetchSpy.mock.calls[3][0] as string);

    expect(first).toMatchObject({
      nextCursor,
      messages: [{ info: { id: "msg-1" }, parts: [expect.objectContaining({ text: "one" })] }],
    });
    expect(second).toMatchObject({ messages: [{ info: { id: "msg-2" } }] });
    expect(second).not.toHaveProperty("nextCursor");
    // v2 resolves the session location from the session itself; the message
    // list takes no directory query and must not invent one.
    expect(firstMessageUrl.pathname).toBe("/api/session/ses-1/message");
    expect(firstMessageUrl.searchParams.has("directory")).toBe(false);
    expect(firstMessageUrl.searchParams.get("limit")).toBe("100");
    expect(firstMessageUrl.searchParams.get("order")).toBe("asc");
    expect(firstMessageUrl.searchParams.has("cursor")).toBe(false);
    expect(secondMessageUrl.searchParams.has("directory")).toBe(false);
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
    // v2 location is an optional structured query; the embedded server has one
    // workspace location, so no location filter is invented here.
    expect(url).not.toContain("location");
  });

  it("beginIntegrationOAuth() forwards the method and form answer", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { location: {}, data: { attemptID: "attempt-1" } }));
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.beginIntegrationOAuth("openai", "chatgpt-browser", { tenant: "example" });

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/api/integration/openai/connect/oauth");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ methodID: "chatgpt-browser", answer: { tenant: "example" } }));
  });

  it("addAuth() stores an API key through the v2 integration key connection", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, true));
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.addAuth("openai", { type: "api", key: "credential-input" });

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/api/integration/openai/connect/key");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ key: "credential-input" }));
  });

  it("deleteAuth() removes the provider credential connections resolved from the integration", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, {
        location: {},
        data: [{ id: "openai", name: "OpenAI", connections: [{ type: "credential", id: "cred-1" }] }],
      }))
      .mockResolvedValueOnce(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.deleteAuth("openai");

    const urls = fetchSpy.mock.calls.map(([url]) => url as string);
    expect(urls).toEqual([
      expect.stringContaining("/api/integration"),
      expect.stringContaining("/api/credential/cred-1"),
    ]);
    expect((fetchSpy.mock.calls[1][1] as RequestInit).method).toBe("DELETE");
    expect(result).toBe(true);
  });

  it("disposeInstance() reloads the v2 server locations", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.disposeInstance("/workspace");

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/api/location/reload");
    expect(url).not.toContain("directory");
    expect(init.method).toBe("POST");
    expect(result).toBe(true);
  });

  it("sendPrompt() admits a v2 prompt with the retained parts projected to text", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses_123", "/workspace") }))
      .mockResolvedValueOnce(mockResponse(200, { data: { id: "msg_user", time: { created: 7 } } }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.sendPrompt("ses_123", {
      messageID: "msg_000000000001abcdefghijklmN",
      parts: [{ type: "text", text: "Hello" }],
    }, "/workspace");

    const url = fetchSpy.mock.calls[1][0] as string;
    const init = fetchSpy.mock.calls[1][1] as RequestInit;
    expect(url).toContain("/api/session/ses_123/prompt");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      id: "msg_000000000001abcdefghijklmN",
      text: "Hello",
    });
    expect(result).toMatchObject({ info: { id: "msg_user", role: "user" } });
  });

  it("sendPrompt() frames untrusted reference context and keeps the visible user text in metadata", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses_123", "/workspace") }))
      .mockResolvedValueOnce(mockResponse(200, { data: { id: "msg_user", time: { created: 7 } } }));
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.sendPrompt("ses_123", {
      parts: [{ type: "text", text: "Hello" }],
      context: "<untrusted-reference-data>Source excerpt.</untrusted-reference-data>",
    }, "/workspace");

    expect(JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body))).toEqual({
      text: "<untrusted-reference-data>Source excerpt.</untrusted-reference-data>\n\n<ingenium-user-message>\nHello\n</ingenium-user-message>",
      metadata: { ingeniumVisibleText: "Hello" },
    });
  });

  it("sendPrompt() fails closed for v2-inexpressible system and tool fields", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchSpy);

    const withSystem = await opencodeClient.sendPrompt("ses_123", {
      parts: [{ type: "text", text: "Hello" }],
      system: "You are helpful",
    });
    const withTools = await opencodeClient.sendPrompt("ses_123", {
      parts: [{ type: "text", text: "Hello" }],
      tools: { bash: true },
    });

    expect(withSystem).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: "OPENCODE_V2_SYSTEM_PROMPT_UNAVAILABLE" }),
    }));
    expect(withTools).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: "OPENCODE_V2_TOOLS_UNAVAILABLE" }),
    }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("createSession() calls POST /api/session with a v2 location body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse(200, { data: v2Session("ses_new", "/workspace") }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await opencodeClient.createSession({ title: "New" }, "/workspace");

    const url = fetchSpy.mock.calls[0][0] as string;
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(url).toContain("/api/session");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      title: "New",
      location: { directory: "/workspace" },
    });
  });

  it("deleteSession() validates the session before DELETE /api/session/:id", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses_abc") }))
      .mockResolvedValueOnce(mockResponse(204, "", {}));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.deleteSession("ses_abc", "/workspace");

    expect(fetchSpy.mock.calls.map(([url, init]) => [new URL(url).pathname, init.method])).toEqual([
      ["/api/session/ses_abc", "GET"],
      ["/api/session/ses_abc", "DELETE"],
    ]);
    expect(result).toBe(true);
  });

  it("updateSession() validates before PATCH and reads back the updated session", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses_abc") }))
      .mockResolvedValueOnce(mockResponse(204, "", {}))
      .mockResolvedValueOnce(mockResponse(200, { data: { ...v2Session("ses_abc"), title: "Renamed" } }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await opencodeClient.updateSession("ses_abc", { title: "Renamed" }, "/workspace");

    expect(fetchSpy.mock.calls.map(([url, init]) => [new URL(url).pathname, init.method])).toEqual([
      ["/api/session/ses_abc", "GET"],
      ["/api/session/ses_abc", "PATCH"],
      ["/api/session/ses_abc", "GET"],
    ]);
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1].body))).toEqual({ title: "Renamed" });
    expect(result).toMatchObject({ id: "ses_abc", title: "Renamed", directory: "/workspace" });
  });

  it.each(["updateSession", "deleteSession"] as const)("%s() rejects foreign requested and runtime directories before mutation", async (method) => {
    for (const directory of ["/workspace", undefined]) {
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { data: v2Session("ses_abc", "/foreign") }));
      vi.stubGlobal("fetch", fetchSpy);

      const result = await withOpenCodeRuntimeTarget({ baseUrl: "http://runtime.test", directory: "/workspace" }, () =>
        method === "updateSession"
          ? opencodeClient.updateSession("ses_abc", { title: "Renamed" }, directory)
          : opencodeClient.deleteSession("ses_abc", directory));

      expect(result).toMatchObject({ error: { code: "EXTERNAL_OBSERVATION_BINDING_REJECTED", status: 404 } });
      expect(fetchSpy.mock.calls.map(([, init]) => init.method)).toEqual(["GET"]);
      expect(fetchSpy.mock.calls[0][1].headers["x-opencode-directory"]).toBe("%2Fworkspace");
    }
  });

  it.each(["updateSession", "deleteSession"] as const)("%s() rejects mismatched session identity before mutation", async (method) => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { data: v2Session("ses_other", "/workspace") }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await (method === "updateSession"
      ? opencodeClient.updateSession("ses_target", { title: "Renamed" }, "/workspace")
      : opencodeClient.deleteSession("ses_target", "/workspace"));

    expect(result).toMatchObject({ error: { code: "EXTERNAL_OBSERVATION_BINDING_REJECTED", status: 404 } });
    expect(fetchSpy.mock.calls.map(([url, init]) => [new URL(url).pathname, init.method])).toEqual([
      ["/api/session/ses_target", "GET"],
    ]);
  });

  it.each(["updateSession", "deleteSession"] as const)("%s() rejects invalid identifiers without transport", async (method) => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchSpy);

    for (const id of ["", ".", "..", "../foreign", "ses/foreign", "ses%2Fforeign", "ses?query", "s".repeat(129)]) {
      const result = await (method === "updateSession"
        ? opencodeClient.updateSession(id, { title: "Renamed" }, "/workspace")
        : opencodeClient.deleteSession(id, "/workspace"));

      expect(result).toMatchObject({ error: { code: "INVALID_SESSION_ID" } });
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it.each(["updateSession", "deleteSession"] as const)("%s() propagates a failed session preflight without mutation", async (method) => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(404, { name: "NotFoundError" }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await (method === "updateSession"
      ? opencodeClient.updateSession("ses_missing", { title: "Renamed" }, "/workspace")
      : opencodeClient.deleteSession("ses_missing", "/workspace"));

    expect(result).toMatchObject({ error: { code: "NotFoundError", status: 404 } });
    expect(fetchSpy.mock.calls.map(([, init]) => init.method)).toEqual(["GET"]);
  });

  it.each(["/workspace", undefined])("getSessionChildren() follows opaque cursors with stable parent/directory filters (%s)", async (directory) => {
    const nextCursor = "opaque.cursor/with?=+";
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, {
        data: [
          { ...v2Session("ses_child1"), parentID: "ses_parent" },
          { ...v2Session("ses_other"), parentID: "ses_other_parent" },
        ],
        cursor: { next: nextCursor },
      }))
      .mockResolvedValueOnce(mockResponse(200, {
        data: [{ ...v2Session("ses_child2"), parentID: "ses_parent" }, v2Session("ses_root")],
        cursor: { next: null },
      }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await withOpenCodeRuntimeTarget({ baseUrl: "http://runtime.test", directory: "/workspace" }, () =>
      opencodeClient.getSessionChildren("ses_parent", directory));

    expect(result).toMatchObject([
      { id: "ses_child1", parentID: "ses_parent", directory: "/workspace" },
      { id: "ses_child2", parentID: "ses_parent", directory: "/workspace" },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const urls = fetchSpy.mock.calls.map(([url]) => new URL(url));
    for (const url of urls) {
      expect(url.pathname).toBe("/api/session");
      expect(url.searchParams.get("parentID")).toBe("ses_parent");
      expect(url.searchParams.get("directory")).toBe("/workspace");
      expect(url.searchParams.get("limit")).toBe("100");
    }
    expect(urls[0].searchParams.get("order")).toBe("desc");
    expect(urls[0].searchParams.has("cursor")).toBe(false);
    expect(urls[1].searchParams.get("cursor")).toBe(nextCursor);
    expect(urls[1].searchParams.has("order")).toBe(false);
  });

  it("getSessionChildren() fails closed on a foreign directory on a later page", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, {
        data: [{ ...v2Session("ses_child1"), parentID: "ses_parent" }], cursor: { next: "next" },
      }))
      .mockResolvedValueOnce(mockResponse(200, {
        data: [{ ...v2Session("ses_child2", "/foreign"), parentID: "ses_parent" }], cursor: {},
      }));
    vi.stubGlobal("fetch", fetchSpy);

    expect(await opencodeClient.getSessionChildren("ses_parent", "/workspace")).toMatchObject({
      error: { code: "EXTERNAL_OBSERVATION_BINDING_REJECTED" },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("getSessionChildren() fails closed on cursor loops instead of returning partial results", async () => {
    const fetchSpy = vi.fn();
    for (const next of ["cursor-a", "cursor-b", "cursor-a"]) {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, {
        data: [{ ...v2Session("ses_child"), parentID: "ses_parent" }], cursor: { next },
      }));
    }
    vi.stubGlobal("fetch", fetchSpy);

    expect(await opencodeClient.getSessionChildren("ses_parent", "/workspace")).toMatchObject({
      error: { code: "OPENCODE_V2_CURSOR_FAILED" },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("getSessionChildren() bounds pagination even when every cursor is new", async () => {
    let page = 0;
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(mockResponse(200, {
      data: [], cursor: { next: `page-${++page}` },
    })));
    vi.stubGlobal("fetch", fetchSpy);

    expect(await opencodeClient.getSessionChildren("ses_parent", "/workspace")).toMatchObject({
      error: { code: "OPENCODE_V2_CURSOR_FAILED" },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(100);
  });

  it.each<[CommandBody, string]>([
    [{ command: "review", arguments: "  --target \"a b\"\t\n  " }, "  --target \"a b\"\t\n  "],
    [{ command: "review", args: " \talpha\n " }, " \talpha\n "],
    [{ command: "review", args: ["--target", "a b"] }, "--target a b"],
    [{ command: "review", arguments: ["one", "two words"] }, "one two words"],
    [{ command: "review" }, ""],
    [{ command: "review", args: [] }, ""],
    [{ command: "review", arguments: [] }, ""],
    [{ command: "review", args: "", arguments: "ignored" }, ""],
    [{ command: "review", args: ["preferred"], arguments: "ignored" }, "preferred"],
  ])("sendCommand() maps string or array arguments to V2 name/text (%#)", async (body, text) => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses_cmd") }))
      .mockResolvedValueOnce(mockResponse(204, "", {}));
    vi.stubGlobal("fetch", fetchSpy);

    expect(await opencodeClient.sendCommand("ses_cmd", body, "/workspace")).toBe(true);
    expect(fetchSpy.mock.calls.map(([url, init]) => [new URL(url).pathname, init.method])).toEqual([
      ["/api/session/ses_cmd", "GET"],
      ["/api/session/ses_cmd/command", "POST"],
    ]);
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1].body))).toEqual({ name: "review", text });
  });

  it.each([
    undefined, null, [], "review", {}, { command: 42 }, { command: "" }, { command: " \t" },
    { command: "review", args: null },
    { command: "review", args: 42 },
    { command: "review", args: {} },
    { command: "review", args: ["one", false] },
    { command: "review", args: [["nested"]] },
    { command: "review", arguments: null },
    { command: "review", arguments: false },
    { command: "review", arguments: {} },
    { command: "review", arguments: ["one", 42] },
    { command: "review", arguments: [null] },
    { command: "review", args: 42, arguments: "valid" },
    { command: "review", args: "valid", arguments: 42 },
  ].map((body) => ({ body })))("sendCommand() rejects malformed bodies without transport or TypeError (%#)", async ({ body }) => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { data: v2Session("ses_cmd") }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(opencodeClient.sendCommand("ses_cmd", body as CommandBody, "/workspace")).resolves.toMatchObject({
      error: { code: "INVALID_COMMAND", status: 400 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps v2 session actions and queues to the retained route contracts", async () => {
    const fetchSpy = vi.fn()
      // abortSession → session.get, interrupt
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses_act", "/workspace") }))
      .mockResolvedValueOnce(mockResponse(200, { interrupted: true }))
      // getMCPStatus → mcp.list
      .mockResolvedValueOnce(mockResponse(200, {
        location: {},
        data: [
          { name: "ingenium", status: { status: "connected" } },
          { name: "lmstudio", status: { status: "failed", error: "upstream detail" } },
        ],
      }))
      // getPermissions → permission.request.list
      .mockResolvedValueOnce(mockResponse(200, {
        location: {},
        data: [{
          id: "perm_1", sessionID: "ses_act", action: "bash",
          resources: ["/workspace/*", "/tmp/*"], save: [], metadata: {}, source: {}, message: "ask",
        }],
      }))
      // getQuestions → form.list
      .mockResolvedValueOnce(mockResponse(200, {
        location: {},
        data: [{
          id: "frm_1", sessionID: "ses_act", title: "Pick a branch", metadata: {}, fields: [{
            key: "branch", type: "string", title: "Branch", required: true,
            options: [{ value: "main", label: "Main", description: "Stable" }],
          }],
        }],
      }))
      // listAgents → agent.list
      .mockResolvedValueOnce(mockResponse(200, {
        location: {},
        data: [{
          id: "agent_1", name: "ingenium-chat", mode: "primary", hidden: false,
          permissions: [{ action: "bash", resource: "*", effect: "ask" }],
        }],
      }))
      // replyQuestion → session.get, session.form.get, session.form.reply
      .mockResolvedValueOnce(mockResponse(200, { data: v2Session("ses_act", "/workspace") }))
      .mockResolvedValueOnce(mockResponse(200, { data: {
        id: "frm_1", sessionID: "ses_act", title: "Pick a branch", fields: [],
      } }))
      .mockResolvedValueOnce(mockResponse(204, "", {}));
    vi.stubGlobal("fetch", fetchSpy);

    const aborted = await opencodeClient.abortSession("ses_act", "/workspace");
    const mcp = await opencodeClient.getMCPStatus("/workspace");
    const permissions = await opencodeClient.getPermissions("/workspace");
    const questions = await opencodeClient.getQuestions("/workspace");
    const agents = await opencodeClient.listAgents();
    const replied = await opencodeClient.replyQuestion("ses_act", "frm_1", { branch: "main" }, "/workspace");

    expect(aborted).toBe(true);
    expect(mcp).toEqual({
      ingenium: { name: "ingenium", status: "connected" },
      lmstudio: { name: "lmstudio", status: "failed", error: "upstream detail" },
    });
    expect(permissions).toEqual([{
      id: "perm_1",
      permission: "bash",
      pattern: "/workspace/*\n/tmp/*",
      action: "bash",
      sessionID: "ses_act",
    }]);
    expect(questions).toEqual([{
      id: "frm_1",
      text: "Pick a branch",
      sessionID: "ses_act",
      questions: [{
        id: "branch",
        question: "Branch",
        type: "string",
        required: true,
        options: [{ value: "main", label: "Main", description: "Stable" }],
      }],
    }]);
    expect(agents).toEqual([{
      id: "agent_1",
      name: "ingenium-chat",
      description: "",
      mode: "primary",
      hidden: false,
      permission: [{ permission: "bash", pattern: "*", action: "ask" }],
      options: {},
    }]);
    expect(replied).toBe(true);
    const urls = fetchSpy.mock.calls.map(([url]) => url as string);
    expect(urls).toEqual([
      expect.stringContaining("/api/session/ses_act"),
      expect.stringContaining("/api/session/ses_act/interrupt"),
      expect.stringContaining("/api/mcp"),
      expect.stringContaining("/api/permission/request"),
      expect.stringContaining("/api/form"),
      expect.stringContaining("/api/agent"),
      expect.stringContaining("/api/session/ses_act"),
      expect.stringContaining("/api/session/ses_act/form/frm_1"),
      expect.stringContaining("/api/session/ses_act/form/frm_1/reply"),
    ]);
    expect(urls[3]).toContain("location%5Bdirectory%5D=%2Fworkspace");
    expect(urls[4]).toContain("location%5Bdirectory%5D=%2Fworkspace");
    expect(JSON.parse(String((fetchSpy.mock.calls[8][1] as RequestInit).body))).toEqual({ answer: { branch: "main" } });
  });

  it.each([true, false])("waits for a cold agent registry with a bounded startup failure (ready=%s)", async (ready) => {
    vi.useFakeTimers();
    try {
      const agent = { id: "plan", name: "Plan", mode: "primary", permissions: [] };
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { data: [] }));
      if (ready) {
        fetchSpy.mockResolvedValueOnce(mockResponse(200, { data: [] }))
          .mockResolvedValueOnce(mockResponse(200, { data: [agent] }));
      }
      vi.stubGlobal("fetch", fetchSpy);
      const pending = opencodeClient.listAgents();
      await vi.runAllTimersAsync();
      const result = await pending;
      if (ready) {
        expect(result).toEqual([expect.objectContaining({ id: "plan" })]);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      } else {
        expect(result).toMatchObject({ error: { code: "OPENCODE_STARTING" } });
        expect(fetchSpy).toHaveBeenCalledTimes(6);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["providers", "models", "both"])("waits for a cold %s catalog without replacing model choices", async (missing) => {
    vi.useFakeTimers();
    try {
      let attempt = 0;
      const model = { id: "flint-40b-free", modelID: "flint-40b-free", providerID: "opencode", name: "Flint Free" };
      const provider = { id: "opencode", name: "OpenCode", activation: "enabled" };
      const fetchSpy = vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/api/provider") {
          attempt += 1;
          return mockResponse(200, { data: attempt === 1 && missing !== "models" ? [] : [provider] });
        }
        if (path === "/api/model") return mockResponse(200, { data: attempt === 1 && missing !== "providers" ? [] : [model] });
        if (path === "/api/model/default") return mockResponse(200, { data: model });
        throw new Error("Unexpected catalog route");
      });
      vi.stubGlobal("fetch", fetchSpy);
      const pending = opencodeClient.listProviders();
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result).toMatchObject({
        connected: ["opencode"], default: { opencode: "flint-40b-free" },
        all: [{ id: "opencode", models: { "flint-40b-free": { id: "flint-40b-free" } } }],
      });
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    } finally { vi.useRealTimers(); }
  });

  it("bounds catalog startup retries instead of returning a false no-provider result", async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { data: [] }));
      vi.stubGlobal("fetch", fetchSpy);
      const pending = opencodeClient.listProviders();
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ error: { code: "OPENCODE_STARTING" } });
      expect(fetchSpy).toHaveBeenCalledTimes(12);
    } finally { vi.useRealTimers(); }
  });

  it("preserves an explicitly disabled catalog as a settled empty selection", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { data: [{ id: "opencode", activation: "disabled" }] }))
      .mockResolvedValueOnce(mockResponse(200, { data: [] }))
      .mockResolvedValueOnce(mockResponse(200, { data: null }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await opencodeClient.listProviders()).toMatchObject({ connected: [], default: {}, all: [{ id: "opencode", models: {} }] });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("documents removed v1 surfaces with typed errors", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchSpy);

    const share = await opencodeClient.shareSession("ses_1");
    const init = await opencodeClient.initSession("ses_1");
    const deleted = await opencodeClient.deleteMessage("ses_1", "msg_1");
    const revoked = await opencodeClient.revertSession("ses_1", { messageID: "msg_1", partID: "part_1" });
    const credentials = await opencodeClient.getIntegrationAttempt("attempt_1");

    for (const [result, code] of [
      [share, "OPENCODE_V2_SHARE_UNAVAILABLE"],
      [init, "OPENCODE_V2_SESSION_INIT_UNAVAILABLE"],
      [deleted, "OPENCODE_V2_MESSAGE_DELETE_UNAVAILABLE"],
      [revoked, "OPENCODE_V2_PART_REVERT_UNAVAILABLE"],
      [credentials, "OPENCODE_V2_INTEGRATION_ID_REQUIRED"],
    ] as const) {
      expect(result).toEqual(expect.objectContaining({ error: expect.objectContaining({ code }) }));
    }
    expect(fetchSpy).not.toHaveBeenCalled();
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
