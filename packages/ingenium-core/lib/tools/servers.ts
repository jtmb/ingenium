import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Server } from "../schema.js";
import { randomUUID } from "node:crypto";

/** List all registered MCP servers for a project. */
export function listServers(projectId: string): Server[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM servers WHERE project_id = ?").all(projectId) as Server[];
}

/**
 * Register a new MCP server definition.
 * Idempotent: if a server with the same name already exists, returns it unchanged.
 * This is intentional — on container restart, the initialization code may re-register
 * servers that were already persisted, and we don't want to overwrite config.
 */
export function registerServer(projectId: string, name: string, command: string, args?: string, env?: string, source?: string): Server {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const existing = db.prepare("SELECT * FROM servers WHERE project_id = ? AND name = ?").get(projectId, name) as Server | undefined;
  if (existing) return existing;

  const result = execTransaction(() => {
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO servers (id, project_id, name, command, args, env, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, name, command, args ?? null, env ?? null, source ?? "opencode", now);
    return db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as Server;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Update a server's runtime status (running/stopped).
 * Currently only supports the `running` field — the `command`/`args`/`env` fields
 * are updated via upsertServer(), not this function.
 */
export function updateServer(projectId: string, name: string, fields: { running?: number }): void {
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    if (fields.running !== undefined) {
      db.prepare("UPDATE servers SET running = ? WHERE project_id = ? AND name = ?").run(fields.running, projectId, name);
    }
  });
  checkpointAfterWrite();
}

/**
 * Create or update an MCP server definition.
 * Unlike registerServer (idempotent-only), this explicitly updates an existing server's
 * command/args/env if a match is found — used by the MCP server management UI and
 * config sync to reconcile disk → DB changes.
 */
export function upsertServer(projectId: string, name: string, command: string, args?: string, env?: string, source?: string): Server {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const existing = db.prepare("SELECT * FROM servers WHERE project_id = ? AND name = ?").get(projectId, name) as Server | undefined;

  if (existing) {
    execTransaction(() => {
      db.prepare(
        `UPDATE servers SET command = ?, args = ?, env = ?, source = ? WHERE project_id = ? AND name = ?`
      ).run(command, args ?? null, env ?? null, source ?? "opencode", projectId, name);
    });
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM servers WHERE project_id = ? AND name = ?").get(projectId, name) as Server;
  }

  const inserted = execTransaction(() => {
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO servers (id, project_id, name, command, args, env, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, name, command, args ?? null, env ?? null, source ?? "opencode", now);
    return db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as Server;
  });
  checkpointAfterWrite();
  return inserted;
}

/** Delete a server definition by project and name. */
export function removeServer(projectId: string, name: string): void {
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    db.prepare("DELETE FROM servers WHERE project_id = ? AND name = ?").run(projectId, name);
  });
  checkpointAfterWrite();
}
