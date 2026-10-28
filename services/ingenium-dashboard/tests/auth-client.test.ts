import { registerSessionReauthentication } from "../src/lib/session-reauthentication";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, dashboardFetch, resetAuthClientForTest, setSessionCsrfToken } from "../src/lib/api";

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

describe("expired step-up recovery", () => {
  beforeEach(() => { resetAuthClientForTest(); vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });
  it("shows one confirmation for concurrent rejected actions and retries with the rotated CSRF grant", async () => {
    resetAuthClientForTest();
    setSessionCsrfToken("before-confirmation");
    let confirm!: (value: boolean) => void;
    const prompt = vi.fn(() => new Promise<boolean>((resolve) => { confirm = resolve; }));
    const unregister = registerSessionReauthentication(prompt);
    const response = (code?: string) => new Response(JSON.stringify(code ? { error: { code } } : {}), { status: code ? 403 : 200 });
    const mock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response("STEP_UP_REQUIRED"))
      .mockResolvedValueOnce(response("STEP_UP_REQUIRED"))
      .mockImplementation(async () => response());
    try {
      const first = dashboardFetch("/api/v1/projects/a", { method: "DELETE" });
      const second = dashboardFetch("/api/v1/projects/b", { method: "DELETE" });
      await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
      setSessionCsrfToken("after-confirmation");
      confirm(true);
      await expect(Promise.all([first, second])).resolves.toMatchObject([{ status: 200 }, { status: 200 }]);
      expect(mock).toHaveBeenCalledTimes(4);
      for (const call of mock.mock.calls.slice(2)) expect(call[1]?.headers).toMatchObject({ "X-CSRF-Token": "after-confirmation" });
    } finally { unregister(); }
  });

  it("does not replay cancelled confirmation or unrelated authorization failures", async () => {
    resetAuthClientForTest();
    setSessionCsrfToken("fixture");
    const prompt = vi.fn(async () => false);
    const unregister = registerSessionReauthentication(prompt);
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      JSON.stringify({ error: { code: "STEP_UP_REQUIRED" } }), { status: 403 },
    ));
    try {
      await expect(dashboardFetch("/api/v1/projects/a", { method: "DELETE" })).rejects.toMatchObject({ name: "AbortError" });
      expect(mock).toHaveBeenCalledTimes(1);
      mock.mockImplementation(async () => new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), { status: 403 }));
      expect((await dashboardFetch("/api/v1/projects/a", { method: "DELETE" })).status).toBe(403);
      expect(mock).toHaveBeenCalledTimes(2);
      expect(prompt).toHaveBeenCalledTimes(1);
    } finally { unregister(); }
  });

  it("surfaces a second step-up rejection without looping", async () => {
    resetAuthClientForTest();
    const prompt = vi.fn(async () => true);
    const unregister = registerSessionReauthentication(prompt);
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      JSON.stringify({ error: { code: "STEP_UP_REQUIRED" } }), { status: 403 },
    ));
    try {
      expect((await dashboardFetch("/api/v1/opencode/sessions")).status).toBe(403);
      expect(mock).toHaveBeenCalledTimes(2);
      expect(prompt).toHaveBeenCalledTimes(1);
    } finally { unregister(); }
  });
});
