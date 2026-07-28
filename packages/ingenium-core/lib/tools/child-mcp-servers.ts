import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import {
  ChildMcpDiscoveryReportInputSchema,
  ChildMcpServerDefinitionInputSchema,
  ChildMcpServerDefinitionSchema,
  type ChildMcpDiscoveredTool,
  type ChildMcpDiscoveryReportInput,
  type ChildMcpServerDefinition,
  type ChildMcpServerDefinitionInput,
} from "../schema.js";
import { getCatalogMap } from "./mcp-tool-catalog.js";

const DELETED_VAULT_POLICY = '{"mode":"deleted"}';

export type ChildMcpServerErrorCode =
  | "INVALID_CHILD_MCP_SERVER"
  | "GLOBAL_SCOPE_REQUIRED"
  | "MCP_SERVER_NAME_CONFLICT"
  | "MCP_SERVER_NOT_FOUND"
  | "MCP_SERVER_DISABLED"
  | "VAULT_REFERENCE_NOT_FOUND"
  | "MCP_TOOL_NAME_CONFLICT";

/** Deliberately contains no unsafe input or child-process diagnostic text. */
export class ChildMcpServerError extends Error {
  constructor(public readonly code: ChildMcpServerErrorCode) {
    super(code);
    this.name = "ChildMcpServerError";
  }
}

export interface ChildMcpServerView extends Omit<ChildMcpServerDefinition, "args"> {
  args: string[];
  environment: Record<string, { vault_item_id: string }>;
}

export interface EffectiveChildMcpTool extends ChildMcpDiscoveredTool {
  project_id: string;
  scope: "project" | "global";
}

/**
 * Runtime configuration remains API-owned: this view contains vault item IDs,
 * never plaintext secrets. The API resolves those references immediately before
 * sending a definition to the trusted MCP server process.
 */
export interface EffectiveChildMcpRuntimeServer extends ChildMcpServerView {
  owner_project_id: string;
}

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./data";
}

function invalid(): never {
  throw new ChildMcpServerError("INVALID_CHILD_MCP_SERVER");
}

function parseDefinitionInput(input: unknown): ChildMcpServerDefinitionInput {
  const parsed = ChildMcpServerDefinitionInputSchema.safeParse(input);
  if (!parsed.success) invalid();
  return parsed.data;
}

function parseDiscoveryReport(input: unknown): ChildMcpDiscoveryReportInput {
  const parsed = ChildMcpDiscoveryReportInputSchema.safeParse(input);
  if (!parsed.success) invalid();
  return parsed.data;
}

function assertSafeServerName(name: string): void {
  if (!/^[a-z][a-z0-9]{0,47}$/.test(name)) invalid();
}

function readDefinition(row: unknown): ChildMcpServerDefinition {
  const parsed = ChildMcpServerDefinitionSchema.safeParse(row);
  if (!parsed.success) throw new Error("Invalid persisted child MCP definition");
  return parsed.data;
}

function readEnvironment(serverId: string): Record<string, { vault_item_id: string }> {
  const rows = getDb(dbPath()).prepare(
    "SELECT env_key, vault_item_id FROM mcp_child_server_vault_refs WHERE server_id = ? ORDER BY env_key",
  ).all(serverId) as Array<{ env_key: string; vault_item_id: string }>;
  return Object.fromEntries(rows.map((row) => [row.env_key, { vault_item_id: row.vault_item_id }]));
}

function toView(definition: ChildMcpServerDefinition): ChildMcpServerView {
  let args: unknown;
  try {
    args = JSON.parse(definition.args);
  } catch {
    throw new Error("Invalid persisted child MCP arguments");
  }
  if (!Array.isArray(args) || !args.every((argument) => typeof argument === "string")) {
    throw new Error("Invalid persisted child MCP arguments");
  }
  return { ...definition, args, environment: readEnvironment(definition.id) };
}

function requireOwnedDefinition(projectId: string, name: string): ChildMcpServerDefinition {
  assertSafeServerName(name);
  const row = getDb(dbPath()).prepare(
    "SELECT * FROM mcp_child_server_definitions WHERE project_id = ? AND name = ?",
  ).get(projectId, name);
  if (!row) throw new ChildMcpServerError("MCP_SERVER_NOT_FOUND");
  return readDefinition(row);
}

/** Ensure a local reconciliation mutation is visible even within the same millisecond. */
function nextUpdatedAt(previous: string): string {
  const previousMs = Date.parse(previous);
  const nowMs = Date.now();
  return new Date(Number.isFinite(previousMs) ? Math.max(nowMs, previousMs + 1) : nowMs).toISOString();
}

function assertVaultReferences(projectId: string, environment: ChildMcpServerDefinitionInput["environment"]): void {
  const db = getDb(dbPath());
  for (const { vault_item_id: vaultItemId } of Object.values(environment)) {
    const item = db.prepare(
      "SELECT 1 FROM vault_items WHERE id = ? AND project_id = ? AND access_policy <> ?",
    ).get(vaultItemId, projectId, DELETED_VAULT_POLICY);
    if (!item) throw new ChildMcpServerError("VAULT_REFERENCE_NOT_FOUND");
  }
}

function assertScopeOwnership(projectId: string, input: ChildMcpServerDefinitionInput): void {
  const db = getDb(dbPath());
  const owner = db.prepare(
    "SELECT is_global FROM projects WHERE id = ? AND archived_at IS NULL",
  ).get(projectId) as { is_global: number } | undefined;
  if (!owner) throw new ChildMcpServerError("MCP_SERVER_NOT_FOUND");

  if (input.scope === "global") {
    if (owner.is_global !== 1) throw new ChildMcpServerError("GLOBAL_SCOPE_REQUIRED");
    const localCollision = db.prepare(
      `SELECT 1
       FROM mcp_child_server_definitions AS definition
       INNER JOIN projects AS project ON project.id = definition.project_id
       WHERE definition.name = ?
         AND definition.scope = 'project'
         AND project.archived_at IS NULL
       LIMIT 1`,
    ).get(input.name);
    if (localCollision) throw new ChildMcpServerError("MCP_SERVER_NAME_CONFLICT");
    return;
  }

  const globalCollision = db.prepare(
    `SELECT 1
     FROM mcp_child_server_definitions AS definition
     INNER JOIN projects AS project ON project.id = definition.project_id
     WHERE definition.name = ?
       AND definition.scope = 'global'
       AND project.is_global = 1
       AND project.archived_at IS NULL
     LIMIT 1`,
  ).get(input.name);
  if (globalCollision) throw new ChildMcpServerError("MCP_SERVER_NAME_CONFLICT");
}

/** Create a shell-free child MCP definition. No child process is started here. */
export function createChildMcpServer(projectId: string, input: unknown): ChildMcpServerView {
  const definitionInput = parseDefinitionInput(input);
  const inserted = execTransaction(() => {
    const db = getDb(dbPath());
    assertScopeOwnership(projectId, definitionInput);
    assertVaultReferences(projectId, definitionInput.environment);

    const duplicate = db.prepare(
      "SELECT 1 FROM mcp_child_server_definitions WHERE project_id = ? AND name = ?",
    ).get(projectId, definitionInput.name);
    if (duplicate) throw new ChildMcpServerError("MCP_SERVER_NAME_CONFLICT");

    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO mcp_child_server_definitions
       (id, project_id, name, executable, args, scope, enabled, discovery_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?)`,
    ).run(id, projectId, definitionInput.name, definitionInput.executable, JSON.stringify(definitionInput.args), definitionInput.scope, now, now);

    const insertReference = db.prepare(
      "INSERT INTO mcp_child_server_vault_refs (server_id, env_key, vault_item_id) VALUES (?, ?, ?)",
    );
    for (const [environmentKey, { vault_item_id: vaultItemId }] of Object.entries(definitionInput.environment)) {
      insertReference.run(id, environmentKey, vaultItemId);
    }

    return readDefinition(db.prepare("SELECT * FROM mcp_child_server_definitions WHERE id = ?").get(id));
  });
  checkpointAfterWrite();
  return toView(inserted);
}

/** List the request project's definitions plus enabled-or-disabled global definitions it inherits. */
export function listEffectiveChildMcpServers(projectId: string): ChildMcpServerView[] {
  const rows = getDb(dbPath()).prepare(
    `SELECT definition.*
     FROM mcp_child_server_definitions AS definition
     INNER JOIN projects AS project ON project.id = definition.project_id
     WHERE project.archived_at IS NULL
       AND (
         definition.project_id = ?
         OR (definition.scope = 'global' AND project.is_global = 1)
       )
     ORDER BY CASE WHEN definition.project_id = ? THEN 0 ELSE 1 END, definition.name`,
  ).all(projectId, projectId);
  return rows.map((row) => toView(readDefinition(row)));
}

/**
 * Return effective, enabled definitions that a runtime may launch. Keeping this
 * separate from the catalog list lets disabled definitions remain visible to
 * operators while preventing a runtime process from starting them.
 */
export function listEffectiveChildMcpRuntimeServers(projectId: string): EffectiveChildMcpRuntimeServer[] {
  return listEffectiveChildMcpServers(projectId)
    .filter((definition) => definition.enabled)
    .map((definition) => ({ ...definition, owner_project_id: definition.project_id }));
}

/** Read one definition only when the requested project owns it; inherited definitions are read-only. */
export function getOwnedChildMcpServer(projectId: string, name: string): ChildMcpServerView {
  return toView(requireOwnedDefinition(projectId, name));
}

/** Remove an owned definition and its metadata. Foreign keys clean up vault references and tools. */
export function removeChildMcpServer(projectId: string, name: string): void {
  const removed = execTransaction(() => {
    const definition = requireOwnedDefinition(projectId, name);
    return getDb(dbPath()).prepare("DELETE FROM mcp_child_server_definitions WHERE id = ?").run(definition.id).changes;
  });
  if (removed === 0) throw new ChildMcpServerError("MCP_SERVER_NOT_FOUND");
  checkpointAfterWrite();
}

/**
 * Enable or disable an owned definition. The server runtime observes the new
 * revision during its post-connect reconciliation loop; no OpenCode restart is
 * needed and inherited global definitions remain read-only.
 */
export function setChildMcpServerEnabled(
  projectId: string,
  name: string,
  enabled: boolean,
): ChildMcpServerView {
  const updated = execTransaction(() => {
    const db = getDb(dbPath());
    const definition = requireOwnedDefinition(projectId, name);
    const now = nextUpdatedAt(definition.updated_at);
    db.prepare(
      `UPDATE mcp_child_server_definitions
       SET enabled = ?,
           discovery_status = CASE WHEN ? = 1 THEN 'pending' ELSE discovery_status END,
           discovery_diagnostic = CASE WHEN ? = 1 THEN NULL ELSE discovery_diagnostic END,
           updated_at = ?
       WHERE id = ?`,
    ).run(enabled ? 1 : 0, enabled ? 1 : 0, enabled ? 1 : 0, now, definition.id);
    return readDefinition(db.prepare("SELECT * FROM mcp_child_server_definitions WHERE id = ?").get(definition.id));
  });
  checkpointAfterWrite();
  return toView(updated);
}

/**
 * Request a bounded rediscovery of an enabled owned definition. The gateway
 * sees the monotonically advancing revision and safely replaces its child
 * runtime in the current parent process.
 */
export function requestChildMcpServerRefresh(projectId: string, name: string): ChildMcpServerView {
  const updated = execTransaction(() => {
    const db = getDb(dbPath());
    const definition = requireOwnedDefinition(projectId, name);
    if (!definition.enabled) throw new ChildMcpServerError("MCP_SERVER_DISABLED");
    const now = nextUpdatedAt(definition.updated_at);
    db.prepare(
      `UPDATE mcp_child_server_definitions
       SET discovery_status = 'pending', discovery_diagnostic = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(now, definition.id);
    return readDefinition(db.prepare("SELECT * FROM mcp_child_server_definitions WHERE id = ?").get(definition.id));
  });
  checkpointAfterWrite();
  return toView(updated);
}

/** The only valid dynamic child tool name: one lower-case Ingenium + server namespace. */
export function canonicalChildMcpToolName(serverName: string, sourceToolName: string): string {
  assertSafeServerName(serverName);
  if (
    !/^[a-z][a-z0-9_]{0,63}$/.test(sourceToolName)
    || sourceToolName.startsWith("ingenium_")
    || sourceToolName.startsWith(`${serverName}_`)
  ) {
    invalid();
  }
  return `ingenium_${serverName}_${sourceToolName}`;
}

/**
 * Persist a discovery snapshot supplied by a future child-process bridge. This
 * method deliberately does not launch, connect to, or forward calls to a child.
 */
export function recordChildMcpDiscovery(
  projectId: string,
  name: string,
  input: unknown,
): ChildMcpServerView {
  const report = parseDiscoveryReport(input);
  const updated = execTransaction(() => {
    const db = getDb(dbPath());
    const definition = requireOwnedDefinition(projectId, name);
    const toolRows = report.tools.map((tool) => ({
      ...tool,
      canonicalName: canonicalChildMcpToolName(definition.name, tool.name),
    }));
    const staticCatalog = getCatalogMap();
    if (toolRows.some((tool) => staticCatalog.has(tool.canonicalName))) {
      throw new ChildMcpServerError("MCP_TOOL_NAME_CONFLICT");
    }

    const now = new Date().toISOString();
    db.prepare("DELETE FROM mcp_child_discovered_tools WHERE server_id = ?").run(definition.id);
    if (report.status === "ready") {
      const insertTool = db.prepare(
        `INSERT INTO mcp_child_discovered_tools
         (id, server_id, source_name, canonical_name, category, description, input_schema, discovered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const tool of toolRows) {
        insertTool.run(
          randomUUID(),
          definition.id,
          tool.name,
          tool.canonicalName,
          `Child MCP / ${definition.name}`,
          tool.description,
          JSON.stringify(tool.input_schema),
          now,
        );
      }
    }

    db.prepare(
      `UPDATE mcp_child_server_definitions
       SET discovery_status = ?, discovery_diagnostic = ?, last_discovered_at = ?
       WHERE id = ?`,
    ).run(report.status, report.status === "failed" ? report.diagnostic ?? "unavailable" : null, now, definition.id);
    return readDefinition(db.prepare("SELECT * FROM mcp_child_server_definitions WHERE id = ?").get(definition.id));
  });
  checkpointAfterWrite();
  return toView(updated);
}

/** List bounded discovery metadata for a definition the request project owns. */
export function listOwnedChildMcpDiscoveredTools(projectId: string, name: string): ChildMcpDiscoveredTool[] {
  const definition = requireOwnedDefinition(projectId, name);
  return getDb(dbPath()).prepare(
    "SELECT * FROM mcp_child_discovered_tools WHERE server_id = ? ORDER BY canonical_name",
  ).all(definition.id) as ChildMcpDiscoveredTool[];
}

/**
 * List successfully discovered tools visible to one project. A disabled child
 * definition stays in this catalog so its project-scoped tool states can be
 * inspected or re-enabled; the runtime launch list filters it separately.
 */
export function listEffectiveChildMcpTools(projectId: string): EffectiveChildMcpTool[] {
  return getDb(dbPath()).prepare(
    `SELECT tool.*, definition.project_id, definition.scope
     FROM mcp_child_discovered_tools AS tool
     INNER JOIN mcp_child_server_definitions AS definition ON definition.id = tool.server_id
     INNER JOIN projects AS project ON project.id = definition.project_id
      WHERE definition.discovery_status = 'ready'
       AND project.archived_at IS NULL
       AND (
         definition.project_id = ?
         OR (definition.scope = 'global' AND project.is_global = 1)
       )
     ORDER BY tool.canonical_name`,
  ).all(projectId) as EffectiveChildMcpTool[];
}
