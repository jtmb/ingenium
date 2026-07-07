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

export function getProject(name: string): Project | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM projects WHERE name = ?").get(name) as Project | undefined;
}
