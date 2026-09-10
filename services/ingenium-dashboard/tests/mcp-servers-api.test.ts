import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { installDashboardFetchMock } from "./dashboard-fetch-fixture";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("canonical child MCP API client", () => {
  it("requests the server-owned Playwright preset without a duplicated definition", async () => {
    const server = { name: "playwright", description: "Managed browser" };
    const fetchMock = vi.fn().mockResolvedValue(response({ data: server }, 201));
    installDashboardFetchMock(fetchMock);
    await expect(api.mcpServers.createPlaywrightPreset("dashboard project")).resolves.toEqual({ data: server });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mcp-servers/presets/playwright?project=dashboard%20project",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock.mock.calls[0]?.[1].body).toBeUndefined();
  });

  it("preserves a preset API failure without falling back to generic creation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: { code: "PRESET_UNAVAILABLE", message: "Managed browser is unavailable." } }, 503));
    installDashboardFetchMock(fetchMock);
    await expect(api.mcpServers.createPlaywrightPreset("project")).rejects.toMatchObject({ status: 503, message: "Managed browser is unavailable." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["", "Managed browser"])("forwards and returns explicit preset description %j", async (description) => {
    const server = { name: "playwright", description };
    const fetchMock = vi.fn().mockResolvedValue(response({ data: server }, 201));
    installDashboardFetchMock(fetchMock);
    await expect(api.mcpServers.createPlaywrightPreset("dashboard project", description)).resolves.toEqual({ data: server });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mcp-servers/presets/playwright?project=dashboard%20project",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ description }) }),
    );
    fetchMock.mockResolvedValue(response({ data: [server], total: 1 }));
    await expect(api.mcpServers.list("dashboard project")).resolves.toEqual({ data: [server], total: 1 });
  });

  it("uses /mcp-servers and preserves the backend command/args/vault-ref contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "server-id" } }));
    installDashboardFetchMock(fetchMock);

    await api.mcpServers.create({
      name: "calendar",
      description: "Team calendar",
      executable: "npx",
      args: ["--yes", "@example/calendar"],
      environment: { CALENDAR_TOKEN: { vault_item_id: "00000000-0000-0000-0000-000000000001" } },
      scope: "project",
    }, "dashboard project");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mcp-servers?project=dashboard%20project",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "calendar",
          description: "Team calendar",
          executable: "npx",
          args: ["--yes", "@example/calendar"],
          environment: { CALENDAR_TOKEN: { vault_item_id: "00000000-0000-0000-0000-000000000001" } },
          scope: "project",
        }),
      }),
    );
  });

  it("preserves the API-authoritative project on the tool-state response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      data: [],
      total: 0,
      project: "authoritative-project",
    }));
    installDashboardFetchMock(fetchMock);

    await expect(api.mcpTools.list("requested-project", true)).resolves.toMatchObject({
      project: "authoritative-project",
      data: [],
      total: 0,
    });
  });

  it("requests the project-scoped bounded MCP report with only explicit filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      project: "authoritative-project",
      project_id: "project-id",
      total: 0,
      data: { tools: [] },
    }));
    installDashboardFetchMock(fetchMock);

    await api.mcpTools.report("dashboard project", {
      enabled: true,
      boundary: "mcp-stdio",
      visibility: "unknown",
      invocation: "not-run",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mcp-tools/report?project=dashboard+project&enabled=true&boundary=mcp-stdio&visibility=unknown&invocation=not-run",
      expect.anything(),
    );
  });

  it("targets canonical discovery metadata and removal endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: [], total: 0 }))
      .mockResolvedValueOnce(response({ data: [], total: 0 }))
      .mockResolvedValueOnce(response(undefined, 204));
    installDashboardFetchMock(fetchMock);

    await api.mcpServers.listTools("mcp project");
    await api.mcpServers.listServerTools("calendar", "mcp project");
    await api.mcpServers.remove("calendar", "mcp project");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/mcp-servers/tools?project=mcp%20project");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/mcp-servers/calendar/tools?project=mcp%20project");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v1/mcp-servers/calendar?project=mcp%20project");
  });
});
