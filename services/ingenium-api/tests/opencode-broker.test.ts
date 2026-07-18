/**
 * opencode-broker.test.ts — Lifecycle tests for the OpenCode broker execution.
 *
 * Tests the `brokerExecute()` function that orchestrates an ephemeral session:
 * create session → send prompt → poll for response → extract text → delete session.
 *
 * Pattern: isolated unit tests with mocked fetch for broker lifecycle, plus
 * optional real integration test (skipped when OPENCODE_SERVER_PASSWORD unset).
 * buildAuthHeader and redactHeaders are tested directly (imported from client).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildAuthHeader,
  redactHeaders,
  brokerExecute,
} from "../lib/opencode-client.js";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Create a minimal mock Response object (matching opencode-client.test.ts) */
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

/* ── buildAuthHeader ─────────────────────────────────────────────────────── */

describe("buildAuthHeader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when OPENCODE_SERVER_PASSWORD is not set", () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");
    expect(buildAuthHeader()).toBeNull();
  });

  it("returns Basic auth string when password is set", () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-secret");
    const auth = buildAuthHeader();
    expect(auth).not.toBeNull();
    expect(auth).toMatch(/^Basic /);

    // Decode and verify format: opencode:PASSWORD
    const encoded = auth!.replace("Basic ", "");
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    expect(decoded).toBe("opencode:test-secret");
  });

  it("produces distinct auth strings for different passwords", () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "pass-a");
    const authA = buildAuthHeader();
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "pass-b");
    const authB = buildAuthHeader();
    expect(authA).not.toBeNull();
    expect(authB).not.toBeNull();
    expect(authA).not.toBe(authB);
  });
});

/* ── redactHeaders ────────────────────────────────────────────────────────── */

describe("redactHeaders", () => {
  it("replaces Authorization header with REDACTED", () => {
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

/* ── brokerExecute — auth error ──────────────────────────────────────────── */

describe("brokerExecute — auth guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns ok:false with auth error when OPENCODE_SERVER_PASSWORD is unset", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");

    const result = await brokerExecute({
      providerID: "lmstudio",
      modelID: "test-model",
      system: "You are a helpful assistant",
      user: "say hello",
    });

    expect(result.ok).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toBeDefined();
    expect(result.error).toBe("broker session unavailable");
  });
});

/* ── brokerExecute — mocked lifecycle ────────────────────────────────────── */

describe("brokerExecute — mocked lifecycle", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("creates session, sends prompt, polls messages, extracts text, deletes session", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");

    const fetchSpy = vi
      .fn()
      // 1. createSession → POST /session
      .mockResolvedValueOnce(
        mockResponse(200, { id: "ses_123", title: "Broker Session" }),
      )
      // 2. sendPrompt → POST /session/ses_123/message
      .mockResolvedValueOnce(
        mockResponse(200, {
          info: { id: "msg_user", sessionID: "ses_123", role: "user" },
          parts: [
            {
              id: "p1",
              sessionID: "ses_123",
              messageID: "msg_user",
              type: "text",
              text: "say hello",
            },
          ],
        }),
      )
      // 3. getMessages (first poll) → GET /session/ses_123/message
      .mockResolvedValueOnce(
        mockResponse(200, [
          {
            info: {
              id: "msg_user",
              sessionID: "ses_123",
              role: "user",
            },
            parts: [],
          },
          {
            info: {
              id: "msg_asst",
              sessionID: "ses_123",
              role: "assistant",
              finish: "stop",
            },
            parts: [
              {
                id: "p2",
                sessionID: "ses_123",
                messageID: "msg_asst",
                type: "text",
                text: "Hello from the broker",
              },
            ],
          },
        ]),
      )
      // 4. deleteSession → DELETE /session/ses_123
      .mockResolvedValueOnce(mockResponse(200, true));

    vi.stubGlobal("fetch", fetchSpy);

    const result = await brokerExecute({
      providerID: "lmstudio",
      modelID: "test-model",
      system: "You are helpful",
      user: "say hello",
    });

    // Verify success result
    expect(result.ok).toBe(true);
    expect(result.content).toBe("Hello from the broker");

    // Verify all 4 fetch calls were made in order
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    // Verify session was deleted (4th call → DELETE)
    const deleteCall = fetchSpy.mock.calls[3];
    const deleteUrl = deleteCall[0] as string;
    const deleteInit = deleteCall[1] as RequestInit;
    expect(deleteUrl).toContain("/session/ses_123");
    expect(deleteInit.method).toBe("DELETE");
  });

  it("deletes session even when sendPrompt fails", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");

    const fetchSpy = vi
      .fn()
      // 1. createSession → succeeds
      .mockResolvedValueOnce(
        mockResponse(200, { id: "ses_456", title: "Broker Session" }),
      )
      // 2. sendPrompt → fails with 500
      .mockResolvedValueOnce(
        mockResponse(500, {
          message: "LLM provider error",
          name: "InternalError",
        }),
      )
      // 3. deleteSession → succeeds (cleanup in finally)
      .mockResolvedValueOnce(mockResponse(200, true));

    vi.stubGlobal("fetch", fetchSpy);

    const result = await brokerExecute({
      providerID: "lmstudio",
      modelID: "test-model",
      system: "You are helpful",
      user: "say hello",
    });

    // Verify error result
    expect(result.ok).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toBe("broker request failed");
    expect(JSON.stringify(result)).not.toContain("LLM provider error");

    // Verify 3 fetch calls: create + send + delete
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Verify session was deleted despite error
    const deleteCall = fetchSpy.mock.calls[2];
    const deleteUrl = deleteCall[0] as string;
    const deleteInit = deleteCall[1] as RequestInit;
    expect(deleteUrl).toContain("/session/ses_456");
    expect(deleteInit.method).toBe("DELETE");
  });

  it("does not attempt delete when session creation fails", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");

    const fetchSpy = vi
      .fn()
      // 1. createSession → fails
      .mockResolvedValueOnce(
        mockResponse(500, {
          message: "OpenCode unavailable",
          name: "InternalError",
        }),
      );

    vi.stubGlobal("fetch", fetchSpy);

    const result = await brokerExecute({
      providerID: "lmstudio",
      modelID: "test-model",
      system: "You are helpful",
      user: "say hello",
    });

    expect(result.ok).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toBe("broker session unavailable");
    expect(JSON.stringify(result)).not.toContain("OpenCode unavailable");

    // Only one fetch call — no delete attempted
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("deletes session when getMessages polling fails", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");

    const fetchSpy = vi
      .fn()
      // 1. createSession → succeeds
      .mockResolvedValueOnce(
        mockResponse(200, { id: "ses_789", title: "Broker Session" }),
      )
      // 2. sendPrompt → succeeds
      .mockResolvedValueOnce(
        mockResponse(200, {
          info: { id: "msg_u", sessionID: "ses_789", role: "user" },
          parts: [],
        }),
      )
      // 3. getMessages → fails
      .mockResolvedValueOnce(
        mockResponse(500, {
          message: "Poll failed",
          name: "PollError",
        }),
      )
      // 4. deleteSession → succeeds (cleanup)
      .mockResolvedValueOnce(mockResponse(200, true));

    vi.stubGlobal("fetch", fetchSpy);

    const result = await brokerExecute({
      providerID: "lmstudio",
      modelID: "test-model",
      system: "You are helpful",
      user: "say hello",
    });

    expect(result.ok).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toBeDefined();

    // 4 fetch calls including delete
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    // Verify session was deleted
    const deleteCall = fetchSpy.mock.calls[3];
    expect(deleteCall[0]).toContain("/session/ses_789");
    expect(deleteCall[1]).toHaveProperty("method", "DELETE");
  });

  it("returns timeout when no assistant finish is received within deadline", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");

    // Provide a response that has no assistant finish — broker should eventually time out.
    // Use a very short timeout (the function clamps to 0..30000).
    const fetchSpy = vi
      .fn()
      // 1. createSession → succeeds
      .mockResolvedValueOnce(
        mockResponse(200, { id: "ses_tmo", title: "Broker Session" }),
      )
      // 2. sendPrompt → succeeds
      .mockResolvedValueOnce(
        mockResponse(200, {
          info: { id: "msg_u", sessionID: "ses_tmo", role: "user" },
          parts: [],
        }),
      );

    // getMessages polling — each call returns only user messages (no assistant finish).
    // We need enough calls to exhaust the timeout. The broker polls with backoff:
    // delay starts at 500ms, doubles each iteration up to 4000ms.
    // With timeoutMs=1, the deadline will be in the past immediately after sendPrompt,
    // so the first poll check (Date.now() <= deadline) will fail and we'll return timeout.
    for (let i = 0; i < 10; i++) {
      fetchSpy.mockResolvedValueOnce(
        mockResponse(200, [
          {
            info: { id: "msg_u", sessionID: "ses_tmo", role: "user" },
            parts: [],
          },
        ]),
      );
    }

    // final deleteSession
    fetchSpy.mockResolvedValueOnce(mockResponse(200, true));

    vi.stubGlobal("fetch", fetchSpy);

    const result = await brokerExecute({
      providerID: "lmstudio",
      modelID: "test-model",
      system: "You are helpful",
      user: "say hello",
      timeoutMs: 1,
    });

    // Should time out
    expect(result.ok).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toBe("timeout");

    // Session should still be deleted
    const calls = fetchSpy.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toContain("/session/ses_tmo");
    expect(lastCall[1]).toHaveProperty("method", "DELETE");
  });
});

/* ── brokerExecute — real integration (skipped without password) ──────────── */

describe("brokerExecute — real integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.skipIf(!process.env.OPENCODE_SERVER_PASSWORD)(
    "creates session, sends prompt, extracts text, deletes session (real OpenCode server)",
    async () => {
      // This test exercises the full broker lifecycle against a real OpenCode
      // server. Requires OPENCODE_SERVER_PASSWORD to be set in the environment
      // and an OpenCode server running at the configured URL.
      //
      // Working pattern (verified against OpenCode v1.18.3):
      //   - No agent parameter (brokerExecute omits it via tools:{})
      //   - providerID: "opencode" (the only connected provider)
      //   - modelID: "big-pickle" (available in opencode free tier)
      //   - system: custom system prompt
      //   - tools: {} (empty object to deny tools, set inside brokerExecute)
      const result = await brokerExecute({
        providerID: "opencode",
        modelID: "big-pickle",
        system: "You are a precise assistant. Output only what is requested.",
        user: "Print exactly: HELLO_WORLD",
        timeoutMs: 30_000,
      });

      expect(result.ok).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content.trim()).toBe("HELLO_WORLD");
    },
  );
});
