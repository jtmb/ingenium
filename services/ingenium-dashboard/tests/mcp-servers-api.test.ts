import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

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
  it("uses /mcp-servers and preserves the backend command/args/vault-ref contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "server-id" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.mcpServers.create({
      name: "calendar",
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
    vi.stubGlobal("fetch", fetchMock);

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
    vi.stubGlobal("fetch", fetchMock);

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
    vi.stubGlobal("fetch", fetchMock);

    await api.mcpServers.listTools("mcp project");
    await api.mcpServers.listServerTools("calendar", "mcp project");
    await api.mcpServers.remove("calendar", "mcp project");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/mcp-servers/tools?project=mcp%20project");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/mcp-servers/calendar/tools?project=mcp%20project");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v1/mcp-servers/calendar?project=mcp%20project");
  });
});
