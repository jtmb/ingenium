import { afterEach, describe, expect, it, vi } from "vitest";
import { stateGatedHandler, TOOL_STATE_GATE_CODES } from "../lib/tool-state-gate.js";

const report = {
  schemaVersion: 1,
  provenance: "fixture",
  generatedAt: "2026-07-31T12:00:00.000Z",
  freshness: { status: "fresh", observedAt: "2026-07-31T12:00:00.000Z", durationMs: 60_000 },
  catalog: { status: "conformant", issues: [] },
  tools: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("mcp_report_get", () => {
  it("requires an enabled project state before a report adapter can run", async () => {
    const adapter = vi.fn(async () => ({ content: [{ type: "text" as const, text: "report" }] }));
    const reportHandler = stateGatedHandler(
      "ingenium_mcp_report_get",
      (args) => typeof args?.project === "string" ? args.project : null,
      vi.fn(async () => "disabled" as const),
      adapter,
    );

    await expect(reportHandler({})).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining(TOOL_STATE_GATE_CODES.project) }],
    });
    await expect(reportHandler({ project: "report-project" })).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining(TOOL_STATE_GATE_CODES.disabled) }],
    });
    expect(adapter).not.toHaveBeenCalled();
  });

  it("preserves the API envelope and forwards the route's exact bounded filters", async () => {
    const payload = { project: "report-project", project_id: "report-project-id", data: report };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../lib/client.js");
    const { mcpReportGet } = await import("../lib/tools/mcp-report.js");
    const response = await api.settled.getMcpReport("report-project", { q: "health", boundary: "mcp-stdio" });
    const result = await mcpReportGet("report-project", {
      category: "Health",
      enabled: true,
      visibility: "reachable",
    });

    expect(response.payload).toEqual(payload);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:4097/api/v1/mcp-tools/report?project=report-project&q=health&boundary=mcp-stdio",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:4097/api/v1/mcp-tools/report?project=report-project&category=Health&enabled=true&visibility=reachable",
    );
    expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify(report) }] });
  });

  it("returns fixed errors without exposing upstream response or transport details", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ error: { message: "https://private.example/report?token=secret-token" } }),
      })
      .mockRejectedValueOnce(new Error("https://private.example/report?token=secret-token"))
      .mockRejectedValueOnce(new Error("https://private.example/report?token=secret-token"))
      .mockRejectedValueOnce(new Error("https://private.example/report?token=secret-token"))
      .mockRejectedValueOnce(new Error("https://private.example/report?token=secret-token"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { error: { message: "https://private.example/report?token=secret-token" } } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { mcpReportGet } = await import("../lib/tools/mcp-report.js");
    const apiFailure = await mcpReportGet("report-project");
    const transportFailure = await mcpReportGet("report-project");
    const invalidResponse = await mcpReportGet("report-project");

    for (const result of [apiFailure, transportFailure]) {
      expect(result).toMatchObject({ isError: true });
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("MCP_REPORT_UNAVAILABLE");
      expect(text).not.toContain("private.example");
      expect(text).not.toContain("secret-token");
    }
    expect(invalidResponse).toMatchObject({ isError: true });
    expect(invalidResponse.content[0]?.text).toContain("MCP_REPORT_INVALID_RESPONSE");
    expect(invalidResponse.content[0]?.text).not.toContain("private.example");
  });

  it("keeps the collector health probe on the health endpoint rather than the report endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { status: "ok" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { healthCheck } = await import("../lib/tools/health.js");
    await healthCheck();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:4097/api/v1/health");
  });
});
