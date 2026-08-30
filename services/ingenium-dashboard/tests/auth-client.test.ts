import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, dashboardFetch, resetAuthClientForTest } from "../src/lib/api";

describe("AUTH-103 browser API client", () => {
  beforeEach(() => { resetAuthClientForTest(); vi.restoreAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  it("bootstraps and reuses session CSRF without browser authorization", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { csrfToken: "csrf-fixture" } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await dashboardFetch("/api/v1/projects", { method: "POST", headers: { Authorization: "Bearer browser-token" }, body: "{}" });
    await dashboardFetch("/api/v1/tasks", { method: "POST", body: "{}" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin" });
    for (const call of fetchMock.mock.calls.slice(1)) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect(headers["X-CSRF-Token"]).toBe("csrf-fixture");
    }
  });

  it("uses pre-auth CSRF directly without probing an authenticated session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await dashboardFetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "X-CSRF-Token": "pre-auth-csrf" },
      body: "{}",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-CSRF-Token": "pre-auth-csrf",
    });
  });

  it("shares one CSRF bootstrap across concurrent unsafe requests", async () => {
    let releaseBootstrap!: (response: Response) => void;
    const bootstrap = new Promise<Response>((resolve) => { releaseBootstrap = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => bootstrap)
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const requests = [
      dashboardFetch("/api/v1/projects", { method: "POST", body: "{}" }),
      dashboardFetch("/api/v1/tasks", { method: "POST", body: "{}" }),
    ];
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    releaseBootstrap(new Response(JSON.stringify({ data: { csrfToken: "csrf-shared" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await Promise.all(requests);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(call[1]?.headers).toMatchObject({ "X-CSRF-Token": "csrf-shared" });
    }
  });

  it("honors one valid Retry-After before retrying session bootstrap", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Wait" } }), {
        status: 429,
        headers: { "content-type": "application/json", "Retry-After": "1" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { csrfToken: "csrf-retried" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { user: { id: "user" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));

    const session = api.auth.session();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(session).resolves.toMatchObject({ data: { user: { id: "user" } } });
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://dashboard.invalid").pathname)).toEqual([
      "/api/v1/auth/session/csrf",
      "/api/v1/auth/session/csrf",
      "/api/v1/auth/session",
    ]);
  });
});
