import { describe, expect, it } from "vitest";

import {
  buildMcpToolUsefulnessEvidenceReport,
} from "../../lib/tools/mcp-usefulness-evidence.js";
import { MCP_TOOL_CATALOG } from "../../lib/tools/mcp-tool-catalog.js";
import {
  MCP_TOOL_USEFULNESS_MAX_JSON_BYTES,
  McpToolUsefulnessReportError,
} from "../../lib/tools/mcp-usefulness-report.js";

const CATALOG = [
  {
    name: "ingenium_health_check",
    category: "Health",
    description: "Health",
    projectScope: "per-project",
    defaultEnabled: true,
    apiEndpoints: [],
  },
  {
    name: "ingenium_alpha",
    category: "Alpha",
    description: "Alpha",
    projectScope: "per-project",
    defaultEnabled: true,
    apiEndpoints: [],
  },
  {
    name: "auto_observe_now",
    category: "Extension",
    description: "Extension",
    projectScope: "per-project",
    defaultEnabled: true,
    apiEndpoints: [],
  },
] as const;

function fixture() {
  return {
    provenance: "fixture" as const,
    generatedAt: "2026-07-31T12:00:10.000Z",
    observedAt: "2026-07-31T12:00:00.000Z",
    freshnessDurationMs: 60_000,
    catalog: CATALOG,
    effectiveState: {
      status: "known" as const,
      states: [
        { toolName: "ingenium_health_check", enabled: true },
        { toolName: "ingenium_alpha", enabled: false },
        { toolName: "auto_observe_now", enabled: true },
      ],
    },
    transport: {
      state: "listed" as const,
      transportNames: ["health_check"],
      healthCheck: "success" as const,
    },
  };
}

describe("MCP usefulness evidence adapter", () => {
  it("maps extension boundaries, effective state, listed visibility, and a safe health result", () => {
    const report = buildMcpToolUsefulnessEvidenceReport(fixture());

    expect(report.catalog).toEqual({ status: "unknown", issues: [] });
    expect(report.tools).toEqual([
      {
        name: "auto_observe_now",
        boundary: "opencode-extension",
        visibility: { status: "not-applicable", reason: "not-requested" },
        invocation: { status: "not-run", reason: "not-requested" },
      },
      {
        name: "ingenium_alpha",
        boundary: "mcp-stdio",
        visibility: { status: "not-applicable", reason: "TOOL_DISABLED" },
        invocation: { status: "not-run", reason: "TOOL_DISABLED" },
      },
      {
        name: "ingenium_health_check",
        boundary: "mcp-stdio",
        visibility: { status: "reachable", reason: null },
        invocation: { status: "success", reason: null },
      },
    ]);
  });

  it.each([
    ["failed", { status: "failed", reason: "invocation-failed" }],
    ["invalid", { status: "unknown", reason: "invalid-response" }],
    ["not-run", { status: "not-run", reason: "unsafe-invocation" }],
  ] as const)("maps the safe health %s state", (healthCheck, expected) => {
    const input = fixture();
    const health = buildMcpToolUsefulnessEvidenceReport({
      ...input,
      transport: { ...input.transport, healthCheck },
    }).tools.find(({ name }) => name === "ingenium_health_check");

    expect(health?.invocation).toEqual(expected);
  });

  it("keeps unavailable state and transport snapshots honest", () => {
    const input = fixture();
    const report = buildMcpToolUsefulnessEvidenceReport({
      ...input,
      effectiveState: { status: "unknown" },
      transport: { state: "transport-unavailable" },
    });

    expect(report.tools.every(({ visibility, invocation }) => (
      visibility.reason === "TOOL_STATE_UNAVAILABLE" && invocation.reason === "TOOL_STATE_UNAVAILABLE"
    ))).toBe(true);
  });

  it("accepts caller-selected conformance evidence without manufacturing it", () => {
    const input = fixture();
    expect(buildMcpToolUsefulnessEvidenceReport({
      ...input,
      conformance: {
        status: "known",
        issues: [{ code: "missing-registration", toolName: "ingenium_alpha" }],
      },
    }).catalog).toEqual({
      status: "nonconformant",
      issues: [{ code: "missing-registration", toolName: "ingenium_alpha" }],
    });
  });

  it("validates complete effective state and bounded full-catalog output", () => {
    const incomplete = fixture();
    incomplete.effectiveState.states.pop();
    expect(() => buildMcpToolUsefulnessEvidenceReport(incomplete)).toThrow(McpToolUsefulnessReportError);

    const report = buildMcpToolUsefulnessEvidenceReport({
      provenance: "fixture",
      generatedAt: "2026-07-31T12:00:10.000Z",
      observedAt: null,
      freshnessDurationMs: 60_000,
      catalog: MCP_TOOL_CATALOG,
      effectiveState: {
        status: "known",
        states: MCP_TOOL_CATALOG.map(({ name, defaultEnabled }) => ({ toolName: name, enabled: defaultEnabled })),
      },
      transport: { state: "list-unavailable" },
    });
    expect(report.tools).toHaveLength(MCP_TOOL_CATALOG.length);
    expect(Buffer.byteLength(JSON.stringify(report), "utf8")).toBeLessThanOrEqual(MCP_TOOL_USEFULNESS_MAX_JSON_BYTES);
  });
});
