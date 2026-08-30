import { describe, expect, it } from "vitest";
import {
  buildMcpUsefulnessReport,
  createFixtureMcpUsefulnessCollector,
  McpUsefulnessCollectionError,
  serverOwnedLaunchOptions,
  type McpUsefulnessConnection,
} from "../lib/mcp-usefulness-collector.js";

const CLOCK = { now: () => new Date("2026-07-31T12:00:00.000Z") };
const PROJECT_A = { project: "mcp104-a", projectId: "00000000-0000-4000-8000-000000000001", toolNames: ["ingenium_health_check"] };
const PROJECT_B = { project: "mcp104-b", projectId: "00000000-0000-4000-8000-000000000002", toolNames: ["ingenium_health_check"] };
const PROJECT_C = { project: "mcp104-c", projectId: "00000000-0000-4000-8000-000000000003", toolNames: ["ingenium_health_check"] };

const HEALTH_CATALOG = [{
  name: "ingenium_health_check",
  category: "System",
  description: "Health",
  projectScope: "per-project" as const,
  defaultEnabled: true,
  apiEndpoints: [],
  enabled: true,
}];

function connection(overrides: Partial<McpUsefulnessConnection> = {}): McpUsefulnessConnection {
  return {
    connect: async () => undefined,
    listTools: async () => ({ tools: [{ name: "health_check", inputSchema: { secret: "discarded" } }] }),
    callHealthCheck: async () => ({ content: [{ type: "text", text: "discarded" }] }),
    close: async () => undefined,
    ...overrides,
  };
}

describe("MCP usefulness collector", () => {
  it("uses only the API-owned report credential and exact report binding", () => {
    const options = serverOwnedLaunchOptions(
      "/app/packages/ingenium-extension/dist/scripts/mcp-transport.js",
      "/run/ingenium-secrets/api/mcp-report-11111111-1111-4111-8111-111111111111",
      PROJECT_A,
    );

    expect(options.cwd).toBe("/app");
    expect(options.env).toMatchObject({
      INGENIUM_MCP_CREDENTIAL_FILE: "/run/ingenium-secrets/api/mcp-report-11111111-1111-4111-8111-111111111111",
      INGENIUM_MCP_AUDIENCE: "mcp-report",
      INGENIUM_WORKSPACE_ID: PROJECT_A.projectId,
      INGENIUM_WORKTREE: "/app",
      INGENIUM_API_URL: "http://127.0.0.1:4097/api/v1",
      INGENIUM_MCP_REPORT_MODE: "1",
      INGENIUM_PROJECT: PROJECT_A.project,
      HOME: "/home/ingenium-api",
      XDG_CONFIG_HOME: "/home/ingenium-api/.config",
    });
    expect(options.env).not.toHaveProperty("INGENIUM_API_TOKEN_FILE");
    expect(options.env).not.toHaveProperty("INGENIUM_INTERNAL_SERVICE");
    expect(JSON.stringify(options)).not.toContain(".opencode/.ingenium-api-token");
  });

  it("single-flights per project and caches only completed listed observations", async () => {
    let launches = 0;
    let releaseConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => { releaseConnect = resolve; });
    const collector = createFixtureMcpUsefulnessCollector({
      clock: CLOCK,
      launch: () => {
        launches += 1;
        return connection({ connect: () => connectGate });
      },
    });

    const first = collector.collect(PROJECT_A);
    const second = collector.collect(PROJECT_A);
    await Promise.resolve();
    expect(launches).toBe(1);
    releaseConnect();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    await collector.collect(PROJECT_A);
    expect(launches).toBe(1);
  });

  it("does not share a cached transport projection across authorization-filtered catalogs", async () => {
    let launches = 0;
    const collector = createFixtureMcpUsefulnessCollector({
      clock: CLOCK,
      launch: () => { launches += 1; return connection(); },
    });

    await collector.collect(PROJECT_A);
    await collector.collect({ ...PROJECT_A, toolNames: ["ingenium_health_check", "ingenium_project_list"] });

    expect(launches).toBe(2);
  });

  it("enforces the global two-project collection limit", async () => {
    const releases: Array<() => void> = [];
    const collector = createFixtureMcpUsefulnessCollector({
      clock: CLOCK,
      launch: () => {
        const gate = new Promise<void>((resolve) => releases.push(resolve));
        return connection({ connect: () => gate });
      },
    });

    const first = collector.collect(PROJECT_A);
    const second = collector.collect(PROJECT_B);
    await expect(collector.collect(PROJECT_C)).rejects.toMatchObject({ code: "MCP_REPORT_BUSY" });
    releases.forEach((release) => release());
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("fails unavailable after a bounded connect timeout and always attempts cleanup", async () => {
    let closed = 0;
    const collector = createFixtureMcpUsefulnessCollector({
      clock: CLOCK,
      timeoutMs: 1,
      launch: () => connection({
        connect: () => new Promise<void>(() => undefined),
        close: async () => { closed += 1; },
      }),
    });

    await expect(collector.collect(PROJECT_A)).rejects.toMatchObject({ code: "MCP_REPORT_UNAVAILABLE" });
    expect(closed).toBe(1);
  });

  it("treats cleanup uncertainty as fixed unavailable without retaining diagnostics", async () => {
    const secret = "Bearer fixture-secret https://private.invalid/cleanup";
    const collector = createFixtureMcpUsefulnessCollector({
      clock: CLOCK,
      launch: () => connection({ close: async () => { throw new Error(secret); } }),
    });

    await expect(collector.collect(PROJECT_A)).rejects.toEqual(expect.objectContaining({
      name: McpUsefulnessCollectionError.name,
      code: "MCP_REPORT_UNAVAILABLE",
      message: "MCP_REPORT_UNAVAILABLE",
    }));
  });

  it("keeps invalid and opaque health results out of the core report", async () => {
    const collector = createFixtureMcpUsefulnessCollector({
      clock: CLOCK,
      launch: () => connection({
        callHealthCheck: async () => ({ content: [{ type: "text" }], result: "Bearer fixture-secret" }),
      }),
    });

    const observation = await collector.collect(PROJECT_A);
    const report = buildMcpUsefulnessReport(observation, HEALTH_CATALOG, collector.provenance, collector.freshnessDurationMs);
    expect(report.catalog).toEqual({ status: "conformant", issues: [] });
    expect(report.tools[0]?.invocation).toEqual({ status: "unknown", reason: "invalid-response" });
    expect(JSON.stringify(report)).not.toContain("fixture-secret");
    expect(JSON.stringify(report)).not.toContain("inputSchema");
  });

  it("rejects report/catalog state mismatches instead of producing a partial report", () => {
    expect(() => buildMcpUsefulnessReport({
      generatedAt: "2026-07-31T12:00:00.000Z",
      observedAt: null,
      transport: { state: "listed", transportNames: [], healthCheck: "not-run" },
    }, [{ ...HEALTH_CATALOG[0]!, name: "ingenium_duplicate" }, { ...HEALTH_CATALOG[0]!, name: "ingenium_duplicate" }], "fixture", 30_000))
      .toThrow(McpUsefulnessCollectionError);
  });
});
