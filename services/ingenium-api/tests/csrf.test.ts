import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { config, getDashboardAllowedOrigins } from "../config/index.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";

function makeRequest(method: string, headers: Record<string, string> = {}): Request {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    method,
    get: (name: string) => normalizedHeaders[name.toLowerCase()],
  } as unknown as Request;
}

function invoke(request: Request): { next: NextFunction; error: unknown } {
  const next = vi.fn<NextFunction>();
  let error: unknown;
  try {
    csrfMiddleware(request, {} as Response, next);
  } catch (caught) {
    error = caught;
  }
  return { next, error };
}

describe("csrfMiddleware", () => {
  it("allows authenticated MCP and server mutations without browser headers", () => {
    const { next, error } = invoke(makeRequest("POST"));

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "allows the gateway-validated dashboard %s mutation with a trusted origin and marker",
    (method) => {
      const { next, error } = invoke(makeRequest(method, {
        origin: "http://localhost:3000",
        "x-ingenium-ui": "dashboard",
      }));

      expect(error).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
    },
  );

  it("accepts every explicit local dashboard allowlist entry", () => {
    expect(config.dashboardOrigins).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);

    for (const origin of config.dashboardOrigins) {
      const { next, error } = invoke(makeRequest("PATCH", {
        origin,
        "x-ingenium-ui": "dashboard",
      }));

      expect(error).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("fails closed for malformed explicit allowlist configuration", () => {
    expect(getDashboardAllowedOrigins({
      DASHBOARD_ALLOWED_ORIGINS: "http://localhost:3000,https://user:secret@example.test",
    })).toEqual([]);
    expect(getDashboardAllowedOrigins({
      DASHBOARD_ALLOWED_ORIGINS: "http://localhost:3000/",
    })).toEqual([]);
  });

  it("retains CORS_ORIGIN only as a single-origin compatibility fallback", () => {
    expect(getDashboardAllowedOrigins({ CORS_ORIGIN: "https://dashboard.example.test" })).toEqual([
      "https://dashboard.example.test",
    ]);
  });

  it("rejects browser mutations without the dashboard marker", () => {
    const { next, error } = invoke(makeRequest("DELETE", { origin: config.dashboardOrigins[0]! }));

    expect(error).toMatchObject({ statusCode: 403, code: "CSRF_REJECTED" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a forged marker from an untrusted origin", () => {
    const { next, error } = invoke(makeRequest("POST", {
      origin: "https://attacker.example",
      "x-ingenium-ui": "dashboard",
    }));

    expect(error).toMatchObject({ statusCode: 403, code: "CSRF_REJECTED" });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not impose CSRF headers on safe methods", () => {
    const { next, error } = invoke(makeRequest("GET", { origin: "https://attacker.example" }));

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});
