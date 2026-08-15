import { beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardFetch, resetAuthClientForTest } from "../src/lib/api";

describe("AUTH-103 browser API client", () => {
  beforeEach(() => { resetAuthClientForTest(); vi.restoreAllMocks(); });

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
});
