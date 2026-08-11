import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiHttpError } from "../lib/client.js";
import { stateGatedHandler } from "../lib/tool-state-gate.js";
import { emailOauthExchange } from "../lib/tools/emails.js";

function response(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
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
    const fetchMock = vi.fn().mockResolvedValue(response(status, {
      error: { code, message, details: { token: "must-not-escape" } },
    }));
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

  it("parses DELETE errors before throwing and falls back safely for malformed or oversized bodies", async () => {
    const parsed = vi.fn(async () => ({
      error: {
        code: "REVISION_CONFLICT",
        message: "Revision conflict",
        details: { token: "must-not-escape" },
      },
    }));
    const malformed = {
      ok: false,
      status: 422,
      text: async () => "{not-json",
    };
    const oversized = {
      ok: false,
      status: 429,
      text: async () => "x".repeat(8 * 1024 + 1),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: parsed })
      .mockResolvedValueOnce(malformed)
      .mockResolvedValueOnce(oversized);
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.del("/delete-fixture")).rejects.toMatchObject({
      status: 409,
      code: "REVISION_CONFLICT",
      message: "Revision conflict",
    });
    await expect(api.post("/malformed-fixture", {})).rejects.toMatchObject({
      status: 422,
      code: "API_REQUEST_FAILED",
      message: "The API request failed.",
    });
    await expect(api.post("/oversized-fixture", {})).rejects.toMatchObject({
      status: 429,
      code: "API_REQUEST_FAILED",
      message: "The API request failed.",
    });
    expect(parsed).toHaveBeenCalledTimes(1);
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
