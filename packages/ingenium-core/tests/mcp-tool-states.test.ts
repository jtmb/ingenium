import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { MCP_TOOL_CATALOG } from "../lib/tools/mcp-tool-catalog.js";
import { buildMcpToolConformanceReport } from "../lib/tools/mcp-tool-conformance.js";
import * as mcpToolStates from "../lib/tools/mcp-tool-states.js";
import * as projects from "../lib/tools/projects.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

function createProject(name: string) {
  if (!directory) {
    directory = mkdtempSync(join(tmpdir(), "ingenium-mcp-tool-states-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  }
  return projects.createProject(name);
}

function getEffectiveProjection(projectId: string) {
  return mcpToolStates.listCategorizedTools(projectId).flatMap(({ category, tools }) => tools.map(({ tool_name, enabled }) => ({
    tool_name,
    category,
    enabled,
  })));
}

function expectProjectConformance(projectId: string, expectedEnabledOverrides?: Record<string, boolean>) {
  const report = buildMcpToolConformanceReport({
    catalog: MCP_TOOL_CATALOG,
    canonicalRegistrations: MCP_TOOL_CATALOG
      .filter(({ name }) => name.startsWith("ingenium_"))
      .map(({ name }) => name),
    effectiveCatalog: Array.from(mcpToolStates.getAllTools(projectId).values()),
    effectiveProjection: getEffectiveProjection(projectId),
    rawExplicitStates: mcpToolStates.listToolStates(projectId),
    expectedEnabledOverrides,
  });
  expect(report.issues).toEqual([]);
}

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("MCP tool states", () => {
  it("projects explicit overrides without mutating the static catalog and fails closed for unknown tools", () => {
    const project = createProject("mcp-overrides");
    const toolName = "ingenium_skill_list";

    expect(mcpToolStates.getToolState(project.id, toolName)).toBe(true);
    mcpToolStates.setToolState(project.id, toolName, false);
    expectProjectConformance(project.id, { [toolName]: false });
    expect(mcpToolStates.getToolState(project.id, toolName)).toBe(false);
    expect(mcpToolStates.getToolState(project.id, "ingenium_unknown_tool")).toBe(false);
    expect(() => mcpToolStates.setToolState(project.id, "ingenium_unknown_tool", true)).toThrow("MCP_TOOL_NOT_REGISTERED");
  });

  it("keeps category changes project-isolated and reports only effective state changes", () => {
    const projectA = createProject("mcp-category-a");
    const projectB = createProject("mcp-category-b");
    const toolName = "ingenium_skill_list";
    const skills = Array.from(mcpToolStates.getAllTools(projectA.id).values())
      .filter((tool) => tool.category === "Skills");

    mcpToolStates.setToolState(projectA.id, toolName, false);
    const expectedChanges = skills.filter((tool) => (tool.name === toolName ? false : tool.defaultEnabled) !== false).length;
    expect(mcpToolStates.setCategoryState(projectA.id, "Skills", false)).toBe(expectedChanges);
    expect(mcpToolStates.setCategoryState(projectA.id, "Skills", false)).toBe(0);
    expectProjectConformance(projectA.id);
    expect(mcpToolStates.getToolState(projectA.id, toolName)).toBe(false);
    expect(mcpToolStates.getToolState(projectB.id, toolName)).toBe(true);
  });

  it("rolls back the whole category when an upsert fails", () => {
    const project = createProject("mcp-category-rollback");
    const db = getDb();
    db.exec(`
      CREATE TRIGGER fail_category_upsert
      BEFORE INSERT ON mcp_tool_states
      WHEN NEW.tool_name = 'ingenium_skill_create'
      BEGIN
        SELECT RAISE(ABORT, 'forced category upsert failure');
      END;
    `);

    expect(() => mcpToolStates.setCategoryState(project.id, "Skills", false))
      .toThrow("forced category upsert failure");
    expect(db.prepare("SELECT COUNT(*) AS count FROM mcp_tool_states WHERE project_id = ?").get(project.id))
      .toEqual({ count: 0 });
    expect(mcpToolStates.getToolState(project.id, "ingenium_skill_list")).toBe(true);
  });
});
