import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type CloudflareTunnelConfig } from "../src/lib/api";
import { installDashboardFetchMock } from "./dashboard-fetch-fixture";

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare dashboard API contract", () => {
  it("uses the protected service routes and sends no lifecycle arguments", async () => {
    const config: CloudflareTunnelConfig = {
      enabled: false,
      tunnelName: "ingenium-production",
      services: {
        dashboard: { enabled: true, publicUrl: "https://dashboard.example.com/" },
        opencode: { enabled: false, publicUrl: "" },
        cli: { enabled: false, publicUrl: "" },
        vscode: { enabled: false, publicUrl: "" },
        api: { enabled: false, publicUrl: "" },
      },
    };
    const status = {
      desired: { enabled: false, configuration: "valid" },
      config,
      token: { configured: false, readiness: "missing" },
      connector: { state: "absent", observedAt: "2026-09-05T00:00:00.000Z" },
      routes: [],
    };
    const requestMock = vi.fn(async () => new Response(JSON.stringify({ data: status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    installDashboardFetchMock(requestMock);

    await api.cloudflare.get();
    await api.cloudflare.update(config, { action: "preserve" });
    await api.cloudflare.validate();
    await api.cloudflare.connect();
    await api.cloudflare.disconnect();

    expect(requestMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/services/cloudflare",
      "/api/v1/services/cloudflare",
      "/api/v1/services/cloudflare/validate",
      "/api/v1/services/cloudflare/connect",
      "/api/v1/services/cloudflare/disconnect",
    ]);
    expect(requestMock.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ config, token: { action: "preserve" } }),
    });
    for (const call of requestMock.mock.calls.slice(2)) {
      expect(call[1]).toMatchObject({ method: "POST" });
      expect(call[1]?.body).toBeUndefined();
    }
  });
});
