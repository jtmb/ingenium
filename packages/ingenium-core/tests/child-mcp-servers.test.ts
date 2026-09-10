import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { getDb, resetDbForTest } from "../lib/db.js";
import { ChildMcpServerDefinitionInputSchema, ChildMcpServerDefinitionSchema } from "../lib/schema.js";
import * as childMcpServers from "../lib/tools/child-mcp-servers.js";
import {
  PLAYWRIGHT_CHILD_MCP_ARGS,
  PLAYWRIGHT_CHILD_MCP_INTEGRITY,
  PLAYWRIGHT_CHILD_MCP_EXECUTABLE,
  PLAYWRIGHT_CHILD_MCP_PACKAGE,
  PLAYWRIGHT_CHILD_MCP_PASSIVE_TOOL_PERMISSIONS,
  isPlaywrightChildMcpPreset,
  playwrightChildMcpPreset,
} from "../lib/tools/child-mcp-presets.js";
import { MCP_TOOL_CATALOG } from "../lib/tools/mcp-tool-catalog.js";
import { buildMcpToolConformanceReport } from "../lib/tools/mcp-tool-conformance.js";
import * as mcpToolStates from "../lib/tools/mcp-tool-states.js";
import * as identity from "../lib/tools/identity.js";
import * as organizations from "../lib/tools/organizations.js";
import * as projects from "../lib/tools/projects.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;

function createIsolatedProject(name: string, isGlobal = false) {
  if (!directory) {
    directory = mkdtempSync(join(tmpdir(), "ingenium-child-mcp-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    process.env.INGENIUM_HOME = join(directory, "home");
  }
  return projects.createProject(name, isGlobal);
}

function createVaultReference(projectId: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO vault_items
     (id, project_id, organization_id, owner_kind, name, type, encrypted, wrapped_kek, created_at, updated_at)
     SELECT ?, id, organization_id, 'organization', ?, 'api_key', ?, ?, ?, ? FROM projects WHERE id = ?`,
  ).run(id, `child-mcp-${id}`, Buffer.from([0]), Buffer.from([0]), now, now, projectId);
  return id;
}

function expectErrorCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected child MCP operation to fail");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

describe("child MCP definitions", () => {
  it.each([undefined, "", "Managed browser"])("preserves description %j through creation and lifecycle updates", (description) => {
    const project = createIsolatedProject("child-mcp-description");
    const created = childMcpServers.createChildMcpServer(project.id, {
      name: "calendar", executable: "npx", description,
    });
    const expected = description ?? null;
    expect(created).toMatchObject({ description: expected });
    expect(childMcpServers.createPlaywrightChildMcpServer(project.id, description)).toMatchObject({ description: expected });
    expect(childMcpServers.recordChildMcpDiscovery(project.id, "calendar", { status: "ready", tools: [] }))
      .toMatchObject({ description: expected });
    expect(childMcpServers.setChildMcpServerEnabled(project.id, "calendar", false)).toMatchObject({ description: expected });
    expect(childMcpServers.setChildMcpServerEnabled(project.id, "calendar", true)).toMatchObject({ description: expected });
    expect(childMcpServers.requestChildMcpServerRefresh(project.id, "calendar")).toMatchObject({ description: expected });
    resetDbForTest();
    expect(childMcpServers.listEffectiveChildMcpServers(project.id).map((server) => server.description)).toEqual([expected, expected]);
  });

  it("upgrades existing definitions without a description and guards repeat opens", () => {
    const project = createIsolatedProject("child-mcp-description-upgrade");
    const created = childMcpServers.createChildMcpServer(project.id, { name: "calendar", executable: "npx" });
    getDb().exec("ALTER TABLE mcp_child_server_definitions DROP COLUMN description");
    resetDbForTest();
    expect(childMcpServers.getOwnedChildMcpServer(project.id, "calendar")).toMatchObject({ id: created.id, description: null });
    resetDbForTest();
    expect(childMcpServers.getOwnedChildMcpServer(project.id, "calendar")).toMatchObject({ id: created.id, description: null });
  });

  describe("description schemas", () => {
    it.each([undefined, "", "Managed browser"])("accepts optional input description %j", (description) => {
      expect(ChildMcpServerDefinitionInputSchema.parse({ name: "calendar", executable: "npx", description }).description).toBe(description);
    });

    it.each([null, 123, {}, []])("rejects non-string input description %j", (description) => {
      expect(ChildMcpServerDefinitionInputSchema.safeParse({ name: "calendar", executable: "npx", description }).success).toBe(false);
    });

    it.each([undefined, null, "", "Managed browser"])("reads persisted description %j", (description) => {
      const project = createIsolatedProject("child-mcp-description-schema");
      const server = childMcpServers.createChildMcpServer(project.id, { name: "calendar", executable: "npx" });
      expect(ChildMcpServerDefinitionSchema.parse({ ...server, args: "[]", description }).description).toBe(description);
    });
  });

  it.each([
    { executable: "npx" },
    { args: [...PLAYWRIGHT_CHILD_MCP_ARGS, "--no-sandbox"] },
    { scope: "global" },
    { environment: { TOKEN: { vault_item_id: randomUUID() } } },
  ])("rejects non-canonical Playwright creation: %j", (override) => {
    const project = createIsolatedProject("child-mcp-playwright-invalid");
    expectErrorCode(() => childMcpServers.createChildMcpServer(project.id, {
      ...playwrightChildMcpPreset(), ...override,
    }), "INVALID_CHILD_MCP_SERVER");
    expect(childMcpServers.listEffectiveChildMcpServers(project.id)).toEqual([]);
  });

  it("registers the pinned shell-free Playwright preset with managed permission names", () => {
    const project = createIsolatedProject("child-mcp-playwright");

    const server = childMcpServers.createPlaywrightChildMcpServer(project.id);

    expect(server).toMatchObject({
      name: "playwright",
      executable: PLAYWRIGHT_CHILD_MCP_EXECUTABLE,
      args: [...PLAYWRIGHT_CHILD_MCP_ARGS],
      environment: {},
      scope: "project",
      enabled: true,
      discovery_status: "pending",
    });
    expect(PLAYWRIGHT_CHILD_MCP_PACKAGE).toBe("@playwright/mcp@0.0.78");
    expect(PLAYWRIGHT_CHILD_MCP_INTEGRITY).toMatch(/^sha512-/);
    expect(PLAYWRIGHT_CHILD_MCP_EXECUTABLE).toBe("/app/node_modules/.bin/playwright-mcp");
    expect(PLAYWRIGHT_CHILD_MCP_ARGS.some((argument) => argument.includes("latest"))).toBe(false);
    expect(isPlaywrightChildMcpPreset(server)).toBe(true);
    expect(PLAYWRIGHT_CHILD_MCP_PASSIVE_TOOL_PERMISSIONS).toEqual(
      expect.arrayContaining([
        "ingenium_playwright_browser_navigate",
        "ingenium_playwright_browser_snapshot",
        "ingenium_playwright_browser_close",
      ]),
    );
    expect(PLAYWRIGHT_CHILD_MCP_PASSIVE_TOOL_PERMISSIONS.every((name) => name.startsWith("ingenium_playwright_"))).toBe(true);
  });

  it("discovers managed Playwright names and rejects refresh while the preset is disabled", () => {
    const project = createIsolatedProject("child-mcp-playwright-lifecycle");
    childMcpServers.createPlaywrightChildMcpServer(project.id);
    childMcpServers.recordChildMcpDiscovery(project.id, "playwright", {
      status: "ready",
      tools: [
        { name: "browser_navigate", description: "Navigate", input_schema: { type: "object" } },
        { name: "browser_snapshot", description: "Snapshot", input_schema: { type: "object" } },
      ],
    });

    expect(childMcpServers.listEffectiveChildMcpTools(project.id).map((tool) => tool.canonical_name)).toEqual([
      "ingenium_playwright_browser_navigate",
      "ingenium_playwright_browser_snapshot",
    ]);
    expect(childMcpServers.setChildMcpServerEnabled(project.id, "playwright", false)).toMatchObject({ enabled: false });
    expect(childMcpServers.listEffectiveChildMcpRuntimeServers(project.id)).toEqual([]);
    expectErrorCode(
      () => childMcpServers.requestChildMcpServerRefresh(project.id, "playwright"),
      "MCP_SERVER_DISABLED",
    );
  });

  it("defaults discovered tools to the passive allowlist while preserving explicit project choices", () => {
    const project = createIsolatedProject("child-mcp-playwright-permissions");
    childMcpServers.createPlaywrightChildMcpServer(project.id);
    const allowed = PLAYWRIGHT_CHILD_MCP_PASSIVE_TOOL_PERMISSIONS.map((name) => name.slice("ingenium_playwright_".length));
    const denied = ["browser_evaluate", "browser_run_code", "browser_click", "browser_future_tool"];
    childMcpServers.recordChildMcpDiscovery(project.id, "playwright", {
      status: "ready",
      tools: [...allowed, ...denied].map((name) => ({ name, description: name, input_schema: {} })),
    });
    for (const name of [...allowed, ...denied]) {
      const canonical = `ingenium_playwright_${name}`;
      expect(mcpToolStates.getToolState(project.id, canonical)).toBe(allowed.includes(name));
      expect(mcpToolStates.listToolStatesWithDefaults(project.id)).toContainEqual({
        tool_name: canonical, enabled: allowed.includes(name),
      });
    }
    mcpToolStates.setToolState(project.id, "ingenium_playwright_browser_evaluate", true);
    mcpToolStates.setToolState(project.id, "ingenium_playwright_browser_snapshot", false);
    expect(mcpToolStates.getToolState(project.id, "ingenium_playwright_browser_evaluate")).toBe(true);
    expect(mcpToolStates.getToolState(project.id, "ingenium_playwright_browser_snapshot")).toBe(false);
  });

  it("persists shell-free executable arguments and vault references without an env payload", () => {
    const project = createIsolatedProject("child-mcp-local");
    const vaultItemId = createVaultReference(project.id);

    const server = childMcpServers.createChildMcpServer(project.id, {
      name: "calendar",
      executable: "/usr/bin/npx",
      args: ["--yes", "@example/calendar-mcp"],
      environment: { CALENDAR_TOKEN: { vault_item_id: vaultItemId } },
    });

    expect(server).toMatchObject({
      name: "calendar",
      executable: "/usr/bin/npx",
      args: ["--yes", "@example/calendar-mcp"],
      environment: { CALENDAR_TOKEN: { vault_item_id: vaultItemId } },
      scope: "project",
      discovery_status: "pending",
    });
    expect(getDb().prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mcp_child_server_definitions'").get())
      .not.toMatchObject({ sql: expect.stringContaining(" env ") });

    expectErrorCode(() => childMcpServers.createChildMcpServer(project.id, {
      name: "unsafe",
      executable: "npx --yes @example/unsafe",
    }), "INVALID_CHILD_MCP_SERVER");
    expectErrorCode(() => childMcpServers.createChildMcpServer(project.id, {
      name: "unsafe2",
      executable: "npx",
      environment: { TOKEN: "plain-text-secret" },
    }), "INVALID_CHILD_MCP_SERVER");
  });

  it("enforces project and global ownership without cross-project vault references", () => {
    const global = createIsolatedProject("global-default", true);
    const local = createIsolatedProject("child-mcp-external");
    const globalVaultItemId = createVaultReference(global.id);
    const localVaultItemId = createVaultReference(local.id);

    childMcpServers.createChildMcpServer(global.id, {
      name: "weather",
      executable: "npx",
      environment: { WEATHER_TOKEN: { vault_item_id: globalVaultItemId } },
      scope: "global",
    });
    expect(childMcpServers.listEffectiveChildMcpServers(local.id).map((server) => server.name)).toEqual(["weather"]);

    expectErrorCode(() => childMcpServers.createChildMcpServer(local.id, {
      name: "weather",
      executable: "npx",
    }), "MCP_SERVER_NAME_CONFLICT");
    expectErrorCode(() => childMcpServers.createChildMcpServer(local.id, {
      name: "localglobal",
      executable: "npx",
      scope: "global",
    }), "GLOBAL_SCOPE_REQUIRED");
    expectErrorCode(() => childMcpServers.createChildMcpServer(local.id, {
      name: "wrongvault",
      executable: "npx",
      environment: { TOKEN: { vault_item_id: globalVaultItemId } },
    }), "VAULT_REFERENCE_NOT_FOUND");

    const privateOwner = identity.createUser("child-mcp-private@example.test", "Private Owner");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, privateOwner.id, "member");
    const privateVaultItemId = randomUUID();
    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO vault_items
       (id, project_id, organization_id, owner_kind, owner_user_id, name, type, encrypted, wrapped_kek, created_at, updated_at)
       VALUES (?, ?, ?, 'user', ?, ?, 'api_key', ?, ?, ?, ?)`,
    ).run(privateVaultItemId, local.id, local.organization_id, privateOwner.id, `private-${privateVaultItemId}`, Buffer.from([0]), Buffer.from([0]), now, now);
    expectErrorCode(() => childMcpServers.createChildMcpServer(local.id, {
      name: "privatevault",
      executable: "npx",
      environment: { TOKEN: { vault_item_id: privateVaultItemId } },
    }), "VAULT_REFERENCE_NOT_FOUND");

    const localServer = childMcpServers.createChildMcpServer(local.id, {
      name: "notes",
      executable: "npx",
      environment: { NOTES_TOKEN: { vault_item_id: localVaultItemId } },
    });
    expect(localServer.environment.NOTES_TOKEN.vault_item_id).toBe(localVaultItemId);
  });

  it("persists bounded discovery metadata with one canonical namespace and dynamic toggle metadata", () => {
    const project = createIsolatedProject("child-mcp-discovery");
    childMcpServers.createChildMcpServer(project.id, { name: "calendar", executable: "npx" });

    childMcpServers.recordChildMcpDiscovery(project.id, "calendar", {
      status: "ready",
      tools: [{
        name: "list_events",
        description: "List events from the configured calendar.",
        input_schema: { type: "object", properties: { limit: { type: "integer" } } },
      }],
    });

    const toolName = "ingenium_calendar_list_events";
    const category = "Child MCP / calendar";
    expect(childMcpServers.listOwnedChildMcpDiscoveredTools(project.id, "calendar")).toMatchObject([
      { canonical_name: toolName, category },
    ]);
    expect(mcpToolStates.getAllTools(project.id).get(toolName)).toMatchObject({ category });
    expect(mcpToolStates.getCategoryMap(project.id).get(category)).toContain(toolName);
    expect(mcpToolStates.listToolStatesWithDefaults(project.id)).toContainEqual({ tool_name: toolName, enabled: false });
    mcpToolStates.setToolState(project.id, toolName, false);
    expect(mcpToolStates.getToolState(project.id, toolName)).toBe(false);
    const report = buildMcpToolConformanceReport({
      catalog: MCP_TOOL_CATALOG,
      canonicalRegistrations: MCP_TOOL_CATALOG
        .filter(({ name }) => name.startsWith("ingenium_"))
        .map(({ name }) => name),
      effectiveCatalog: [
        ...MCP_TOOL_CATALOG,
        {
          name: toolName,
          category,
          description: "List events from the configured calendar.",
          projectScope: "per-project",
          defaultEnabled: false,
          apiEndpoints: [],
        },
      ],
      effectiveProjection: mcpToolStates.listCategorizedTools(project.id).flatMap(({ category: projectedCategory, tools }) =>
        tools.map(({ tool_name, enabled }) => ({ tool_name, category: projectedCategory, enabled })),
      ),
      rawExplicitStates: mcpToolStates.listToolStates(project.id),
      expectedEnabledOverrides: { [toolName]: false },
    });
    expect(report.issues).toEqual([]);

    getDb().prepare("UPDATE mcp_child_server_definitions SET enabled = 0 WHERE project_id = ? AND name = ?")
      .run(project.id, "calendar");
    expect(childMcpServers.listEffectiveChildMcpRuntimeServers(project.id)).toEqual([]);
    expect(mcpToolStates.getAllTools(project.id).get(toolName)).toMatchObject({ category });

    expectErrorCode(() => childMcpServers.recordChildMcpDiscovery(project.id, "calendar", {
      status: "ready",
      tools: [{ name: "calendar_list", description: "Duplicate namespace", input_schema: {} }],
    }), "INVALID_CHILD_MCP_SERVER");

    childMcpServers.createChildMcpServer(project.id, { name: "skill", executable: "npx" });
    expectErrorCode(() => childMcpServers.recordChildMcpDiscovery(project.id, "skill", {
      status: "ready",
      tools: [{ name: "list", description: "Collides with an Ingenium tool", input_schema: {} }],
    }), "MCP_TOOL_NAME_CONFLICT");
  });

  it("upgrades the original generic child category without losing discovered tools", () => {
    const project = createIsolatedProject("child-mcp-category-upgrade");
    childMcpServers.createChildMcpServer(project.id, { name: "calendar", executable: "npx" });
    childMcpServers.recordChildMcpDiscovery(project.id, "calendar", {
      status: "ready",
      tools: [{ name: "list_events", description: "List calendar events", input_schema: { type: "object" } }],
    });

    const db = getDb();
    db.exec(`
      ALTER TABLE mcp_child_discovered_tools RENAME TO mcp_child_discovered_tools_current;
      DROP INDEX IF EXISTS idx_mcp_child_discovered_tools_server;
      CREATE TABLE mcp_child_discovered_tools (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category = 'Child MCP'),
        description TEXT NOT NULL,
        input_schema TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        UNIQUE(server_id, source_name),
        UNIQUE(server_id, canonical_name)
      );
      INSERT INTO mcp_child_discovered_tools
        (id, server_id, source_name, canonical_name, category, description, input_schema, discovered_at)
      SELECT id, server_id, source_name, canonical_name, 'Child MCP', description, input_schema, discovered_at
      FROM mcp_child_discovered_tools_current;
      DROP TABLE mcp_child_discovered_tools_current;
      CREATE INDEX idx_mcp_child_discovered_tools_server
        ON mcp_child_discovered_tools(server_id, canonical_name);
    `);

    resetDbForTest();
    expect(childMcpServers.listOwnedChildMcpDiscoveredTools(project.id, "calendar")).toMatchObject([
      { canonical_name: "ingenium_calendar_list_events", category: "Child MCP / calendar" },
    ]);
  });

  it("advances owned runtime revisions for connect, disconnect, and refresh without discovery write churn", () => {
    const project = createIsolatedProject("child-mcp-lifecycle");
    const created = childMcpServers.createChildMcpServer(project.id, { name: "calendar", executable: "npx" });

    childMcpServers.recordChildMcpDiscovery(project.id, "calendar", {
      status: "ready",
      tools: [{ name: "list_events", description: "List calendar events", input_schema: { type: "object" } }],
    });
    const afterDiscovery = childMcpServers.getOwnedChildMcpServer(project.id, "calendar");
    expect(afterDiscovery.updated_at).toBe(created.updated_at);

    const disconnected = childMcpServers.setChildMcpServerEnabled(project.id, "calendar", false);
    expect(disconnected).toMatchObject({ enabled: false });
    expect(disconnected.updated_at > created.updated_at).toBe(true);
    expect(childMcpServers.listEffectiveChildMcpRuntimeServers(project.id)).toEqual([]);
    expectErrorCode(
      () => childMcpServers.requestChildMcpServerRefresh(project.id, "calendar"),
      "MCP_SERVER_DISABLED",
    );

    const connected = childMcpServers.setChildMcpServerEnabled(project.id, "calendar", true);
    expect(connected).toMatchObject({ enabled: true, discovery_status: "pending" });
    expect(connected.updated_at > disconnected.updated_at).toBe(true);
    const refreshed = childMcpServers.requestChildMcpServerRefresh(project.id, "calendar");
    expect(refreshed).toMatchObject({ enabled: true, discovery_status: "pending" });
    expect(refreshed.updated_at > connected.updated_at).toBe(true);
  });
});
