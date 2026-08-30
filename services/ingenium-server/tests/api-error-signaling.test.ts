import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiHttpError } from "../lib/client.js";
import { stateGatedHandler } from "../lib/tool-state-gate.js";
import { emailOauthExchange } from "../lib/tools/emails.js";

const MAX_API_ERROR_BODY_BYTES = 8 * 1024;

function response(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function streamedResponse(status: number, chunks: Uint8Array[]): Response {
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
  }), { status });
}

function resultBody(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]!.text);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("centralized MCP API error signaling", () => {
  it.each([
    [404, "NOT_FOUND", "Resource not found", 1],
    [409, "REVISION_CONFLICT", "Revision conflict", 1],
    [422, "VALIDATION_ERROR", "Value is invalid", 1],
    [429, "RATE_LIMITED", "Too many requests", 1],
    [502, "UPSTREAM_FAILURE", "Upstream unavailable", 4],
  ])("throws bounded typed errors for HTTP %i", async (status, code, message, attempts) => {
    const fetchMock = vi.fn(() => Promise.resolve(response(status, {
      error: { code, message, details: { token: "must-not-escape" } },
    })));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Math, "random").mockReturnValue(0);

    let caught: unknown;
    try {
      if (status === 502) await api.get("/error-fixture");
      else await api.post("/error-fixture", {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiHttpError);
    expect(caught).toMatchObject({ status, code, message });
    expect(caught).not.toHaveProperty("details");
    expect(JSON.stringify(caught)).not.toContain("must-not-escape");
    expect(fetchMock).toHaveBeenCalledTimes(attempts);
  });

  it("cancels a declared at-cap error body before acquiring a reader", async () => {
    const body = {
      getReader: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const text = vi.fn();
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "content-length": String(MAX_API_ERROR_BODY_BYTES) }),
      body,
      text,
      json,
    }));
    const gated = stateGatedHandler(
      "ingenium_declared_oversized_fixture",
      () => "fixture-project",
      async () => "enabled",
      async () => api.post("/declared-oversized-fixture", {}),
    );

    const result = await gated({ project: "fixture-project" });

    expect(resultBody(result)).toEqual({
      error: { status: 429, code: "API_REQUEST_FAILED", message: "The API request failed." },
    });
    expect(body.getReader).not.toHaveBeenCalled();
    expect(body.cancel).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it("cancels a chunked at-cap error body before later data is read", async () => {
    const secret = "must-not-read-after-cap";
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(MAX_API_ERROR_BODY_BYTES) })
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(secret) }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const body = {
      getReader: vi.fn(() => reader),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const text = vi.fn();
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(),
      body,
      text,
      json,
    }));

    await expect(api.post("/chunked-oversized-fixture", {})).rejects.toMatchObject({
      status: 429,
      code: "API_REQUEST_FAILED",
      message: "The API request failed.",
    });

    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it("parses an error body exactly below the raw cap", async () => {
    const prefix = '{"error":{"code":"RATE_LIMITED","message":"Retry later","padding":"';
    const suffix = '"}}';
    const body = `${prefix}${"x".repeat(MAX_API_ERROR_BODY_BYTES - 1 - Buffer.byteLength(prefix + suffix))}${suffix}`;
    expect(Buffer.byteLength(body)).toBe(MAX_API_ERROR_BODY_BYTES - 1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      status: 429,
      headers: { "content-length": String(MAX_API_ERROR_BODY_BYTES - 1) },
    })));

    const result = await api.settled.post("/under-cap-fixture", {});

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      data: { error: { code: "RATE_LIMITED", message: "Retry later" } },
      payload: { error: { code: "RATE_LIMITED", message: "Retry later" } },
    });
  });

  it("decodes valid UTF-8 split across error-body chunks", async () => {
    const payload = { error: { code: "VALIDATION_ERROR", message: "Value ☃ is invalid" } };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const snowman = Buffer.from("☃", "utf8");
    const split = Buffer.from(bytes).indexOf(snowman) + 1;
    expect(split).toBeGreaterThan(0);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamedResponse(422, [
      bytes.slice(0, split),
      bytes.slice(split),
    ])));

    await expect(api.post("/multibyte-fixture", {})).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      message: "Value ☃ is invalid",
    });
  });

  it("uses the fixed fallback for malformed JSON and missing error bodies", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{not-json", { status: 422 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.post("/malformed-fixture", {})).rejects.toMatchObject({
      status: 422,
      code: "API_REQUEST_FAILED",
      message: "The API request failed.",
    });
    await expect(api.post("/missing-body-fixture", {})).rejects.toMatchObject({
      status: 404,
      code: "API_REQUEST_FAILED",
      message: "The API request failed.",
    });
  });

  it("returns one schema-valid bounded MCP error with no nested API details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(422, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Value is invalid",
        details: { token: "must-not-escape", nested: { path: "/private" } },
      },
    })));
    const gated = stateGatedHandler(
      "ingenium_error_fixture",
      () => "fixture-project",
      async () => "enabled",
      async () => api.post("/error-fixture", {}),
    );

    const result = await gated({ project: "fixture-project" });

    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ isError: true });
    expect(result.content).toHaveLength(1);
    expect(Buffer.byteLength(result.content[0]!.text, "utf8")).toBeLessThanOrEqual(512);
    expect(resultBody(result)).toEqual({
      error: {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Value is invalid",
      },
    });
    expect(JSON.stringify(result)).not.toContain("details");
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    expect(JSON.stringify(result)).not.toContain("/private");
  });

  it.each([
    [404, "NOT_FOUND", "Resource not found"],
    [429, "RATE_LIMITED", "Too many requests"],
    [502, "UPSTREAM_FAILURE", "Upstream unavailable"],
  ])("marks HTTP %i as an MCP error without relaying API details", async (status, code, message) => {
    const secret = `token=must-not-escape-${status}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status, {
      error: { code, message, details: { token: secret } },
    })));
    const gated = stateGatedHandler(
      "ingenium_status_error_fixture",
      () => "fixture-project",
      async () => "enabled",
      async () => api.post("/status-error-fixture", {}),
    );

    const result = await gated({ project: "fixture-project" });

    expect(result).toMatchObject({ isError: true });
    expect(resultBody(result)).toEqual({ error: { status, code, message } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("details");
  });

  it("keeps settled error payloads bounded and successful payloads unchanged", async () => {
    const errorPayload = { error: { code: "RATE_LIMITED", message: "Too many requests" } };
    const successPayload = { data: { success: false, reason: "domain result" } };
    const rawSuccess = new Response("download body", { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(429, errorPayload))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => successPayload })
      .mockResolvedValueOnce(response(429, errorPayload))
      .mockResolvedValueOnce(rawSuccess);
    vi.stubGlobal("fetch", fetchMock);

    const error = await api.settled.post("/settled-error-fixture", {});
    const success = await api.settled.post("/settled-success-fixture", {});
    const octetError = await api.settled.postOctetStream(
      "/settled-octet-error-fixture",
      Buffer.from("{}"),
    );
    const raw = await api.settled.getRaw("/settled-raw-success-fixture");

    expect(error).toEqual({ ok: false, status: 429, data: errorPayload, payload: errorPayload });
    expect(success).toEqual({ ok: true, status: 200, data: successPayload.data, payload: successPayload });
    expect(octetError).toEqual({ ok: false, status: 429, data: errorPayload, payload: errorPayload });
    expect(raw).toMatchObject({ ok: true, status: 200, response: rawSuccess });
    await expect(raw.response.text()).resolves.toBe("download body");
  });

  it("keeps successful 2xx domain failure objects out of the MCP error channel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      data: { success: false, reason: "domain result" },
    })));
    const gated = stateGatedHandler(
      "ingenium_domain_fixture",
      () => "fixture-project",
      async () => "enabled",
      async () => {
        const result = await api.post("/domain-fixture", {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result.data) }] };
      },
    );

    const result = await gated({ project: "fixture-project" });

    expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify({ success: false, reason: "domain result" }) }] });
    expect(result).not.toHaveProperty("isError");
  });

  it("does not relay unsafe API error messages through the MCP boundary", async () => {
    const secret = "/private/path token=must-not-escape";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(404, {
      error: { code: "NOT_FOUND", message: secret },
    })));
    const gated = stateGatedHandler(
      "ingenium_sanitized_error_fixture",
      () => "fixture-project",
      async () => "enabled",
      async () => api.get("/sanitized-error-fixture"),
    );

    const result = await gated({ project: "fixture-project" });

    expect(resultBody(result)).toEqual({
      error: {
        status: 404,
        code: "NOT_FOUND",
        message: "The API request failed.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("maps exhausted API transport failures to a fixed safe MCP error", async () => {
    const secret = "https://private.example/request?token=must-not-escape";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError(secret));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const gated = stateGatedHandler(
      "ingenium_unavailable_fixture",
      () => "fixture-project",
      async () => "enabled",
      async () => api.get("/network-fixture"),
    );

    const result = await gated({ project: "fixture-project" });

    expect(resultBody(result)).toEqual({
      error: { code: "API_UNAVAILABLE", message: "The API is unavailable." },
    });
    expect(JSON.stringify(result)).not.toContain("private.example");
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps OAuth's settled success/failure contract without relaying API errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(409, {
        error: { code: "OAUTH_STATE_INVALID", message: "token=must-not-escape" },
      }))
      .mockResolvedValueOnce(response(200, {
        data: { success: false, error: "domain failure" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const rejected = await emailOauthExchange("fixture-project", "google", "code", "state");
    const domainFailure = await emailOauthExchange("fixture-project", "google", "code", "state");

    for (const result of [rejected, domainFailure]) {
      expect(resultBody(result)).toEqual({ success: false, error: "OAuth exchange failed" });
      expect(result).not.toHaveProperty("isError");
      expect(JSON.stringify(result)).not.toContain("must-not-escape");
    }
  });
});
