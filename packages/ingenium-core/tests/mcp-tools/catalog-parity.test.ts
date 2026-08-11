import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MCP_TOOL_CATALOG, getCatalogMap } from "../../lib/tools/mcp-tool-catalog.js";
import { buildMcpToolConformanceReport } from "../../lib/tools/mcp-tool-conformance.js";
import { getSourceDerivedCanonicalRegistrations } from "./source-inventory.js";

const CATALOG_SOURCE_PATH = join(__dirname, "..", "..", "lib", "tools", "mcp-tool-catalog.ts");

describe("MCP Tool Catalog Parity", () => {
  it("keeps source inventory within the catalog without certifying runtime state", () => {
    const inventory = getSourceDerivedCanonicalRegistrations();
    const catalog = getCatalogMap();
    const catalogExtensionTools = MCP_TOOL_CATALOG.filter(({ name }) => !name.startsWith("ingenium_"));

    expect(new Set(inventory.server).size).toBe(inventory.server.length);
    expect(new Set(inventory.extension).size).toBe(inventory.extension.length);
    expect(inventory.all).toHaveLength(inventory.server.length + inventory.extension.length);
    expect(inventory.all.filter((name) => !catalog.has(name))).toEqual([]);
    expect(catalogExtensionTools.map(({ name }) => name).sort()).toEqual([...inventory.extension].sort());
    expect(new Set(MCP_TOOL_CATALOG.map(({ name }) => name)).size).toBe(MCP_TOOL_CATALOG.length);
    expect(MCP_TOOL_CATALOG).toHaveLength(282);
    expect(MCP_TOOL_CATALOG.filter(({ name }) => name.startsWith("ingenium_"))).toHaveLength(280);
    expect(new Set(MCP_TOOL_CATALOG.map(({ category }) => category)).size).toBe(30);
    for (const name of [
      "ingenium_coordination_status",
      "ingenium_coordination_update",
      "ingenium_coordination_claim",
      "ingenium_coordination_release",
    ]) expect(catalog.get(name)?.category).toBe("Tasks");
    const catalogSource = readFileSync(CATALOG_SOURCE_PATH, "utf8");
    expect(catalogSource.match(/name: "/g)).toHaveLength(282);
    expect(catalogSource).toMatch(/name: "ingenium_mcp_report_get",\s+category: "Servers",\s+description: "Get the bounded MCP usefulness report for a project\.",\s+projectScope: "per-project",\s+defaultEnabled: true,\s+apiEndpoints: MCP_REPORT_ENDPOINTS,/);
    expect(catalog.get("ingenium_repository_sync")).toMatchObject({
      category: "Repository Sync",
      projectScope: "per-project",
      apiEndpoints: ["POST /api/v1/docs/repository/sync", "POST /api/v1/repository/resources/sync"],
    });
    expect(catalog.get("ingenium_skill_proposal_list")?.description).toContain("Deprecated");
    expect(catalog.get("ingenium_skill_proposal_page")).toMatchObject({
      category: "Skills",
      projectScope: "per-project",
      apiEndpoints: expect.arrayContaining(["GET /api/v1/skills/proposals/page"]),
    });
    expect(catalog.get("ingenium_skill_proposal_counts")).toMatchObject({
      category: "Skills",
      projectScope: "per-project",
      apiEndpoints: expect.arrayContaining(["GET /api/v1/skills/proposals/counts"]),
    });
  });

  it("reports every deterministic catalog, registration, projection, and state fault", () => {
    const valid = {
      name: "ingenium_alpha",
      category: "Alpha",
      description: "Alpha tool",
      projectScope: "per-project",
      defaultEnabled: true,
      apiEndpoints: [],
    } as const;
    const report = buildMcpToolConformanceReport({
      catalog: [
        valid,
        { ...valid },
        {
          name: "ingenium_beta",
          category: "Beta",
          description: "Beta tool",
          projectScope: "per-project",
          defaultEnabled: true,
          apiEndpoints: [],
        },
        {
          name: "ingenium_malformed",
          category: "Malformed",
          description: "Malformed tool",
          projectScope: "per-project",
          defaultEnabled: "true",
          apiEndpoints: [],
        },
      ],
      canonicalRegistrations: ["ingenium_alpha", "ingenium_alpha", "ingenium_stale", ""],
      effectiveProjection: [
        { tool_name: "ingenium_alpha", category: "Wrong", enabled: true },
        { tool_name: "ingenium_alpha", category: "Alpha", enabled: true },
        { tool_name: "ingenium_stale", category: "Stale", enabled: true },
        { tool_name: "ingenium_beta", category: "Beta", enabled: "true" },
      ],
      rawExplicitStates: [
        { tool_name: "ingenium_alpha", enabled: false },
        { tool_name: "ingenium_alpha", enabled: false },
        { tool_name: "ingenium_stale", enabled: true },
        { tool_name: "ingenium_beta", enabled: "true" },
      ],
      expectedEnabledOverrides: {
        ingenium_alpha: false,
        ingenium_beta: "false",
        ingenium_override_stale: true,
      },
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "malformed-catalog-entry",
      "duplicate-catalog",
      "malformed-registration",
      "duplicate-registration",
      "missing-registration",
      "stale-registration",
      "malformed-projection",
      "duplicate-projection",
      "missing-projection",
      "stale-projection",
      "category-mismatch",
      "malformed-explicit-state",
      "duplicate-explicit-state",
      "stale-explicit-state",
      "malformed-expected-enabled-override",
      "stale-expected-enabled-override",
      "wrong-toggle",
    ]));
  });

  it("keeps extension-owned tools out of stdio registration failures and detects effective omissions", () => {
    const stdio = {
      name: "ingenium_alpha",
      category: "Alpha",
      description: "Alpha tool",
      projectScope: "per-project",
      defaultEnabled: true,
      apiEndpoints: [],
    } as const;
    const extension = {
      name: "auto_observe_now",
      category: "Extension",
      description: "Extension tool",
      projectScope: "per-project",
      defaultEnabled: true,
      apiEndpoints: [],
    } as const;

    const complete = buildMcpToolConformanceReport({
      catalog: [stdio, extension],
      canonicalRegistrations: [stdio.name],
      effectiveCatalog: [extension, stdio],
      effectiveProjection: [
        { tool_name: extension.name, category: extension.category, enabled: true },
        { tool_name: stdio.name, category: stdio.category, enabled: true },
      ],
      knownCategories: ["Alpha", "Extension"],
    });
    expect(complete).toMatchObject({ ok: true, issues: [] });

    const omitted = buildMcpToolConformanceReport({
      catalog: [stdio, extension],
      canonicalRegistrations: [stdio.name],
      effectiveCatalog: [extension],
      effectiveProjection: [{ tool_name: extension.name, category: extension.category, enabled: true }],
    });
    expect(omitted.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-effective-catalog", name: stdio.name }),
      expect.objectContaining({ code: "missing-projection", name: stdio.name }),
    ]));
  });

  it("has no duplicate API endpoint within a catalog entry", () => {
    const violations: string[] = [];
    for (const entry of MCP_TOOL_CATALOG) {
      const seen = new Set<string>();
      for (const endpoint of entry.apiEndpoints) {
        if (seen.has(endpoint)) violations.push(`${entry.name}: duplicate endpoint '${endpoint}'`);
        seen.add(endpoint);
      }
    }
    expect(violations).toEqual([]);
  });

  it("exposes the complete project tool shape", () => {
    const catalogMap = getCatalogMap();
    const projectTools = [
      "ingenium_project_delete",
      "ingenium_project_detail",
      "ingenium_project_init",
      "ingenium_project_list",
      "ingenium_project_list_archived",
      "ingenium_project_purge",
      "ingenium_project_rename",
      "ingenium_project_restore",
      "ingenium_project_set_global",
      "ingenium_project_migrate_workspace",
    ];
    for (const name of projectTools) {
      const entry = catalogMap.get(name);
      expect(entry, `${name} must exist in the catalog`).toBeDefined();
      expect(entry?.category).toBe("Projects");
      expect(entry?.projectScope).toBeDefined();
      expect(entry?.apiEndpoints.length).toBeGreaterThan(0);
    }
    expect(catalogMap.get("ingenium_project_set_global")?.defaultEnabled).toBe(false);
  });

  it("catalogs the protected Context upload transport and API contract", () => {
    const entry = getCatalogMap().get("ingenium_context_upload_file");
    expect(entry).toMatchObject({
      category: "Context",
      projectScope: "per-project",
      defaultEnabled: true,
    });
    expect(entry?.apiEndpoints).toContain("POST /api/v1/context/conversations/import");
  });
});
