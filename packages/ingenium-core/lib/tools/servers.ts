import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Server } from "../schema.js";
import { randomUUID } from "node:crypto";

export function listServers(projectId: string): Server[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM servers WHERE project_id = ?").all(projectId) as Server[];
}

export function registerServer(projectId: string, name: string, command: string, args?: string, env?: string, source?: string): Server {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO servers (id, project_id, name, command, args, env, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, name, command, args ?? null, env ?? null, source ?? "opencode", now);
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as Server;
  });
}

export function updateServer(projectId: string, name: string, fields: { running?: number }): void {
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    if (fields.running !== undefined) {
      db.prepare("UPDATE servers SET running = ? WHERE project_id = ? AND name = ?").run(fields.running, projectId, name);
    }
    checkpointAfterWrite();
  });
}

export function removeServer(projectId: string, name: string): void {
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    db.prepare("DELETE FROM servers WHERE project_id = ? AND name = ?").run(projectId, name);
    checkpointAfterWrite();
  });
}
