import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { getDb, resetDbForTest } from "../lib/db.js";
import * as childMcpServers from "../lib/tools/child-mcp-servers.js";
import * as mcpToolStates from "../lib/tools/mcp-tool-states.js";
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
     (id, project_id, name, type, encrypted, wrapped_kek, created_at, updated_at)
     VALUES (?, ?, ?, 'api_key', ?, ?, ?, ?)`,
  ).run(id, projectId, `child-mcp-${id}`, Buffer.from([0]), Buffer.from([0]), now, now);
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
    expect(mcpToolStates.listToolStatesWithDefaults(project.id)).toContainEqual({ tool_name: toolName, enabled: true });
    mcpToolStates.setToolState(project.id, toolName, false);
    expect(mcpToolStates.getToolState(project.id, toolName)).toBe(false);

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

  it("uses the Thread child-MCP namespace while preserving rejection of retired thread", () => {
    const project = createIsolatedProject("child-mcp-threadbridge");
    childMcpServers.createChildMcpServer(project.id, { name: "threadbridge", executable: "node" });
    childMcpServers.recordChildMcpDiscovery(project.id, "threadbridge", {
      status: "ready",
      tools: [{
        name: "thread_upload_file",
        description: "Upload one generated JSONL file to Thread.",
        input_schema: {
          type: "object",
          required: ["session", "file_path"],
          properties: { session: { type: "string" }, file_path: { type: "string" } },
        },
      }],
    });

    expect(childMcpServers.listEffectiveChildMcpTools(project.id)).toContainEqual(expect.objectContaining({
      canonical_name: "ingenium_threadbridge_thread_upload_file",
      category: "Child MCP / threadbridge",
    }));
    expectErrorCode(() => childMcpServers.createChildMcpServer(project.id, {
      name: "thread",
      executable: "node",
    }), "INVALID_CHILD_MCP_SERVER");
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
