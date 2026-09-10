import { describe, expect, it } from "vitest";

import {
  buildMcpToolConformanceReport,
  toMcpToolConformanceEvidence,
} from "../../lib/tools/mcp-tool-conformance.js";
import { MCP_TOOL_CATALOG } from "../../lib/tools/mcp-tool-catalog.js";
import {
  buildMcpToolUsefulnessReport,
  MCP_TOOL_USEFULNESS_MAX_JSON_BYTES,
  MCP_TOOL_USEFULNESS_MAX_TOOLS,
  McpToolUsefulnessReportError,
  type McpToolUsefulnessReportInput,
} from "../../lib/tools/mcp-usefulness-report.js";

const OBSERVED_AT = "2026-07-31T12:00:00.000Z";
const GENERATED_AT = "2026-07-31T12:00:10.000Z";
const EXTENSION_TOOL_NAMES = new Set(["auto_observe_now", "synthesize_observations"]);

function fixture(): McpToolUsefulnessReportInput {
  return {
    provenance: "fixture",
    generatedAt: GENERATED_AT,
    observedAt: OBSERVED_AT,
    freshnessDurationMs: 10_000,
    catalog: [
      { name: "ingenium_alpha", boundary: "mcp-stdio" },
      { name: "auto_observe_now", boundary: "opencode-extension" },
      { name: "ingenium_beta", boundary: "mcp-stdio" },
      { name: "synthesize_observations", boundary: "opencode-extension" },
    ],
    conformance: {
      status: "known",
      issues: [{ code: "missing-projection", toolName: "ingenium_beta" }],
    },
    visibility: [
      { toolName: "ingenium_alpha", status: "reachable", reason: null },
      { toolName: "auto_observe_now", status: "not-applicable", reason: "not-requested" },
      { toolName: "ingenium_beta", status: "unreachable", reason: "not-listed" },
      { toolName: "synthesize_observations", status: "unknown", reason: "transport-unavailable" },
    ],
    invocations: [
      { toolName: "ingenium_alpha", status: "success", reason: null },
      { toolName: "auto_observe_now", status: "not-run", reason: "unsafe-invocation" },
      { toolName: "ingenium_beta", status: "failed", reason: "TOOL_DISABLED" },
      { toolName: "synthesize_observations", status: "unknown", reason: "TOOL_STATE_UNAVAILABLE" },
    ],
  };
}

function outputKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(outputKeys);
  return Object.entries(value).flatMap(([key, child]) => [key, ...outputKeys(child)]);
}

describe("MCP usefulness report", () => {
  it("covers the fixture status matrix without treating extension tools as missing stdio registrations", () => {
    const report = buildMcpToolUsefulnessReport(fixture());

    expect(report).toMatchObject({
      schemaVersion: 1,
      provenance: "fixture",
      generatedAt: GENERATED_AT,
      freshness: { status: "fresh", observedAt: OBSERVED_AT, durationMs: 10_000 },
      catalog: {
        status: "nonconformant",
        issues: [{ code: "missing-projection", toolName: "ingenium_beta" }],
      },
    });
    expect(report.tools).toEqual([
      {
        name: "auto_observe_now",
        boundary: "opencode-extension",
        visibility: { status: "not-applicable", reason: "not-requested" },
        invocation: { status: "not-run", reason: "unsafe-invocation" },
      },
      {
        name: "ingenium_alpha",
        boundary: "mcp-stdio",
        visibility: { status: "reachable", reason: null },
        invocation: { status: "success", reason: null },
      },
      {
        name: "ingenium_beta",
        boundary: "mcp-stdio",
        visibility: { status: "unreachable", reason: "not-listed" },
        invocation: { status: "failed", reason: "TOOL_DISABLED" },
      },
      {
        name: "synthesize_observations",
        boundary: "opencode-extension",
        visibility: { status: "unknown", reason: "transport-unavailable" },
        invocation: { status: "unknown", reason: "TOOL_STATE_UNAVAILABLE" },
      },
    ]);

    const catalogReport = buildMcpToolConformanceReport({
      catalog: [
        { name: "ingenium_alpha", category: "Alpha", description: "Alpha", projectScope: "per-project", defaultEnabled: true, apiEndpoints: [] },
        { name: "auto_observe_now", category: "Extension", description: "Extension", projectScope: "per-project", defaultEnabled: true, apiEndpoints: [] },
      ],
      canonicalRegistrations: ["ingenium_alpha"],
      effectiveProjection: [
        { tool_name: "ingenium_alpha", category: "Alpha", enabled: true },
        { tool_name: "auto_observe_now", category: "Extension", enabled: true },
      ],
    });
    expect(catalogReport).toMatchObject({ ok: true, issues: [] });
    expect(toMcpToolConformanceEvidence(catalogReport)).toEqual({ status: "known", issues: [] });
  });

  it("represents unknown conformance and every caller-supplied freshness state", () => {
    const unknown = fixture();
    unknown.provenance = "live";
    unknown.conformance = { status: "unknown", issues: [] };
    expect(buildMcpToolUsefulnessReport(unknown).provenance).toBe("live");
    expect(buildMcpToolUsefulnessReport(unknown).catalog).toEqual({ status: "unknown", issues: [] });

    const stale = fixture();
    stale.generatedAt = "2026-07-31T12:00:10.001Z";
    expect(buildMcpToolUsefulnessReport(stale).freshness.status).toBe("stale");

    const unknownFreshness = fixture();
    unknownFreshness.observedAt = null;
    expect(buildMcpToolUsefulnessReport(unknownFreshness).freshness.status).toBe("unknown");
  });

  it("handles empty evidence and defaults missing evidence to not-requested without an error payload", () => {
    const input = fixture();
    input.catalog = [];
    input.conformance = { status: "known", issues: [] };
    input.visibility = [];
    input.invocations = [];
    expect(buildMcpToolUsefulnessReport(input)).toEqual({
      schemaVersion: 1,
      provenance: "fixture",
      generatedAt: GENERATED_AT,
      freshness: { status: "fresh", observedAt: OBSERVED_AT, durationMs: 10_000 },
      catalog: { status: "conformant", issues: [] },
      tools: [],
    });

    const defaults = fixture();
    defaults.visibility = [];
    defaults.invocations = [];
    expect(buildMcpToolUsefulnessReport(defaults).tools[0]).toMatchObject({
      visibility: { status: "unknown", reason: "not-requested" },
      invocation: { status: "not-run", reason: "not-requested" },
    });
  });

  it("sorts every collection into byte-identical fixed-key output", () => {
    const first = fixture();
    first.conformance.issues = [
      { code: "wrong-toggle", toolName: "ingenium_alpha" },
      { code: "wrong-toggle", toolName: "ingenium_beta" },
      { code: "missing-projection", toolName: "ingenium_beta" },
    ];
    const shuffled = fixture();
    shuffled.catalog = [...shuffled.catalog].reverse();
    shuffled.conformance.issues = [...first.conformance.issues].reverse();
    shuffled.visibility = [...shuffled.visibility].reverse();
    shuffled.invocations = [...shuffled.invocations].reverse();

    expect(JSON.stringify(buildMcpToolUsefulnessReport(first)))
      .toBe(JSON.stringify(buildMcpToolUsefulnessReport(shuffled)));
    expect(buildMcpToolUsefulnessReport(first).catalog.issues).toEqual([
      { code: "missing-projection", toolName: "ingenium_beta" },
      { code: "wrong-toggle", toolName: "ingenium_alpha" },
      { code: "wrong-toggle", toolName: "ingenium_beta" },
    ]);
  });

  it("uses the fixed report shape without repeating catalog or freshness for every tool", () => {
    const report = buildMcpToolUsefulnessReport(fixture());

    expect(Object.keys(report)).toEqual(["schemaVersion", "provenance", "generatedAt", "freshness", "catalog", "tools"]);
    expect(Object.keys(report.freshness)).toEqual(["status", "observedAt", "durationMs"]);
    expect(Object.keys(report.catalog)).toEqual(["status", "issues"]);
    expect(report.tools.every((tool) => Object.keys(tool).join(",") === "name,boundary,visibility,invocation")).toBe(true);
    expect(outputKeys(report).filter((key) => key === "catalog")).toHaveLength(1);
    expect(outputKeys(report).filter((key) => key === "freshness")).toHaveLength(1);
  });

  it("fits the complete catalog within the byte bound", () => {
    const input = fixture();
    input.catalog = MCP_TOOL_CATALOG.map(({ name }) => ({
      name,
      boundary: EXTENSION_TOOL_NAMES.has(name) ? "opencode-extension" : "mcp-stdio",
    }));
    input.conformance = { status: "known", issues: [] };
    input.visibility = [];
    input.invocations = [];

    const report = buildMcpToolUsefulnessReport(input);
    expect(report.tools).toHaveLength(MCP_TOOL_CATALOG.length);
    expect(Buffer.byteLength(JSON.stringify(report), "utf8")).toBeLessThanOrEqual(MCP_TOOL_USEFULNESS_MAX_JSON_BYTES);
  });

  it("does not project forbidden fields and rejects sensitive or project-attributed input", () => {
    const report = buildMcpToolUsefulnessReport(fixture());
    const forbidden = ["message", "result", "content", "arguments", "prompt", "headers", "url", "env", "session", "user", "project", "projectId", "project_id", "useful", "score", "rank"];
    expect(outputKeys(report)).not.toEqual(expect.arrayContaining(forbidden));

    const sensitive = fixture() as unknown as { visibility: unknown[] };
    sensitive.visibility[0] = {
      toolName: "ingenium_alpha",
      status: "reachable",
      reason: null,
      headers: "Bearer raw-secret",
    };
    expect(() => buildMcpToolUsefulnessReport(sensitive)).toThrow(McpToolUsefulnessReportError);
    try {
      buildMcpToolUsefulnessReport(sensitive);
    } catch (error) {
      expect(String(error)).not.toContain("raw-secret");
    }

    const attributed = { ...fixture(), project: "secret-project" };
    expect(() => buildMcpToolUsefulnessReport(attributed)).toThrow("MCP_TOOL_USEFULNESS_REPORT_INVALID");
  });

  it("permits malformed results only as unknown invalid-response evidence", () => {
    const malformedResponse = fixture();
    malformedResponse.invocations[0] = {
      toolName: "ingenium_alpha",
      status: "unknown",
      reason: "invalid-response",
    };
    expect(buildMcpToolUsefulnessReport(malformedResponse).tools[1]?.invocation)
      .toEqual({ status: "unknown", reason: "invalid-response" });

    const falseSuccess = fixture();
    falseSuccess.invocations[0] = {
      toolName: "ingenium_alpha",
      status: "success",
      reason: "invalid-response",
    };
    expect(() => buildMcpToolUsefulnessReport(falseSuccess)).toThrow(McpToolUsefulnessReportError);
  });

  it("rejects invalid controls, catalog issues, duplicates, state-reason combinations, timestamps, and oversized output", () => {
    const control = fixture();
    control.catalog = [{ name: "ingenium_alpha\n", boundary: "mcp-stdio" }];
    expect(() => buildMcpToolUsefulnessReport(control)).toThrow(McpToolUsefulnessReportError);

    const duplicate = fixture();
    duplicate.visibility.push({ toolName: "ingenium_alpha", status: "reachable", reason: null });
    expect(() => buildMcpToolUsefulnessReport(duplicate)).toThrow(McpToolUsefulnessReportError);

    const invalidCombination = fixture();
    invalidCombination.visibility[0] = { toolName: "ingenium_alpha", status: "reachable", reason: "list-unavailable" };
    expect(() => buildMcpToolUsefulnessReport(invalidCombination)).toThrow(McpToolUsefulnessReportError);

    const nonUtc = fixture();
    nonUtc.generatedAt = "2026-07-31T12:00:10.000+00:00";
    expect(() => buildMcpToolUsefulnessReport(nonUtc)).toThrow(McpToolUsefulnessReportError);

    const futureObservation = fixture();
    futureObservation.observedAt = "2026-07-31T12:00:10.001Z";
    expect(() => buildMcpToolUsefulnessReport(futureObservation)).toThrow(McpToolUsefulnessReportError);

    const falseStdioFailure = fixture();
    falseStdioFailure.conformance = {
      status: "known",
      issues: [{ code: "missing-registration", toolName: "auto_observe_now" }],
    };
    expect(() => buildMcpToolUsefulnessReport(falseStdioFailure)).toThrow(McpToolUsefulnessReportError);

    const unknownCatalogIssue = fixture();
    unknownCatalogIssue.conformance = {
      status: "known",
      issues: [{ code: "missing-projection", toolName: "ingenium_unknown" }],
    };
    expect(() => buildMcpToolUsefulnessReport(unknownCatalogIssue)).toThrow(McpToolUsefulnessReportError);

    const tooMany = fixture();
    tooMany.catalog = Array.from({ length: MCP_TOOL_USEFULNESS_MAX_TOOLS + 1 }, (_value, index) => ({
      name: `tool_${String(index).padStart(4, "0")}`,
      boundary: "mcp-stdio" as const,
    }));
    tooMany.conformance = { status: "known", issues: [] };
    tooMany.visibility = [];
    tooMany.invocations = [];
    expect(() => buildMcpToolUsefulnessReport(tooMany)).toThrow(McpToolUsefulnessReportError);

    const oversized = fixture();
    oversized.catalog = Array.from({ length: MCP_TOOL_USEFULNESS_MAX_TOOLS }, (_value, index) => ({
      name: `tool_${String(index).padStart(4, "0")}_${"x".repeat(110)}`,
      boundary: "mcp-stdio" as const,
    }));
    oversized.conformance = { status: "known", issues: [] };
    oversized.visibility = [];
    oversized.invocations = [];
    expect(() => buildMcpToolUsefulnessReport(oversized)).toThrow(McpToolUsefulnessReportError);
  });
});
