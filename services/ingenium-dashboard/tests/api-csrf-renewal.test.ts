import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardFetch, request, resetAuthClientForTest, setSessionCsrfToken } from "../src/lib/api";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
beforeEach(() => { resetAuthClientForTest(); setSessionCsrfToken("expired-grant"); });
afterEach(() => { resetAuthClientForTest(); vi.unstubAllGlobals(); });

describe("expired browser CSRF grants", () => {
  it("refreshes once after an explicit pre-handler rejection and replays the same mutation", async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      if (url.endsWith("/auth/session/csrf")) return response({ data: { csrfToken: "fresh-grant" } });
      if (new Headers(options.headers).get("X-CSRF-Token") === "expired-grant") return response({ error: { code: "CSRF_REJECTED" } }, 403);
      return response({ data: { saved: true } });
    }));
    const body = JSON.stringify({ expected_revision: 1, request_count: 1000 });
    expect(await request("/usage/thresholds?project=ingenium", { method: "PUT", body })).toEqual({ data: { saved: true } });
    expect(calls.map((call) => call.url)).toEqual([
      "/api/v1/usage/thresholds?project=ingenium", "/api/v1/auth/session/csrf", "/api/v1/usage/thresholds?project=ingenium",
    ]);
    expect(calls[0]!.options.body).toBe(body);
    expect(calls[2]!.options.body).toBe(body);
    expect(new Headers(calls[2]!.options.headers).get("X-CSRF-Token")).toBe("fresh-grant");
    expect(new Headers(calls[2]!.options.headers).get("x-ingenium-ui")).toBe("dashboard");
    expect(calls.every((call) => call.options.credentials === "same-origin")).toBe(true);
  });

  it.each([
    [403, "FORBIDDEN"], [403, "STEP_UP_REQUIRED"], [403, "DASHBOARD_API_PROXY_CSRF_REJECTED"],
    [401, "UNAUTHORIZED"], [500, "CSRF_REJECTED"],
  ])("does not retry unrelated authorization, proxy, or server errors (%s %s)", async (status, code) => {
    const fetch = vi.fn(async () => response({ error: { code } }, status));
    vi.stubGlobal("fetch", fetch);
    const result = await dashboardFetch("/api/v1/usage/attention/evaluate", { method: "POST" });
    expect(result.status).toBe(status);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops after one renewal if the replacement grant is also rejected", async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith("/auth/session/csrf")
      ? response({ data: { csrfToken: "fresh-grant" } })
      : response({ error: { code: "CSRF_REJECTED" } }, 403));
    vi.stubGlobal("fetch", fetch);
    const result = await dashboardFetch("/api/v1/usage/attention/evaluate", { method: "POST" });
    expect(result.status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never replays sign-in or a streamed body", async () => {
    const fetch = vi.fn(async () => response({ error: { code: "CSRF_REJECTED" } }, 403));
    vi.stubGlobal("fetch", fetch);
    await dashboardFetch("/api/v1/auth/login", { method: "POST", body: "{}" });
    await dashboardFetch("/api/v1/upload", { method: "POST", body: new ReadableStream() });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the failed response readable when it is not a CSRF error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: { code: "FORBIDDEN" } }, 403)));
    const result = await dashboardFetch("/api/v1/usage/attention/evaluate", { method: "POST" });
    expect(await result.json()).toEqual({ error: { code: "FORBIDDEN" } });
  });
});
