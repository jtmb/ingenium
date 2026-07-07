import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Project } from "../schema.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function listProjects(): Project[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as Project[];
}

export function createProject(name: string): Project {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const id = randomUUID();
    const basePath = process.env.INGENIUM_HOME ?? resolve(process.cwd(), ".ingenium");
    const projectPath = resolve(basePath, "projects", name);
    if (!existsSync(projectPath)) {
      mkdirSync(projectPath, { recursive: true });
    }
    db.prepare(
      `INSERT INTO projects (id, name, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, name, projectPath, now, now);
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;
  });
}

export function archiveProject(name: string): boolean {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM projects WHERE name = ? AND archived_at IS NULL").get(name);
    if (!existing) return false;
    const now = new Date().toISOString();
    db.prepare("UPDATE projects SET archived_at = ? WHERE name = ?").run(now, name);
    checkpointAfterWrite();
    return true;
  });
}

export function unarchiveProject(name: string): boolean {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM projects WHERE name = ? AND archived_at IS NOT NULL").get(name);
    if (!existing) return false;
    db.prepare("UPDATE projects SET archived_at = NULL WHERE name = ?").run(name);
    checkpointAfterWrite();
    return true;
  });
}

export function listArchivedProjects(): Project[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM projects WHERE archived_at IS NOT NULL ORDER BY archived_at DESC").all() as Project[];
}

export function purgeExpiredProjects(retentionDays: number): number {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare("DELETE FROM projects WHERE archived_at IS NOT NULL AND archived_at < ?").run(cutoff);
    checkpointAfterWrite();
    return result.changes;
  });
}

export function getProject(name: string): Project | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM projects WHERE name = ?").get(name) as Project | undefined;
}
