import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Skill } from "../schema.js";
import { randomUUID } from "node:crypto";

export function listSkills(projectId: string): Skill[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM skills WHERE project_id = ? AND enabled = 1")
    .all(projectId) as Skill[];
}

export function getSkill(projectId: string, name: string): Skill | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Skill | undefined;
}

export function searchSkills(projectId: string, query: string): Skill[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare(
    `SELECT s.* FROM skills s
     INNER JOIN skills_fts fts ON fts.rowid = s.rowid
     WHERE s.project_id = ? AND skills_fts MATCH ?
     ORDER BY rank`
  ).all(projectId, query) as Skill[];
}

export function createSkill(projectId: string, name: string, description: string, content: string, category?: string): Skill {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const id = randomUUID();
    const result = db.prepare(
      `INSERT INTO skills (id, project_id, name, description, content, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, name, description, content, category ?? null, now, now);
    // Sync FTS5 index: use lastInsertRowid (integer) for FTS5 rowid
    db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
      .run(result.lastInsertRowid, content, description);
    checkpointAfterWrite();
    return getSkill(projectId, name)!;
  });
}

export function updateSkill(projectId: string, name: string, content: string): Skill | undefined {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    // Get current rowid for FTS5 sync
    const current = db.prepare("SELECT rowid FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as { rowid: number } | undefined;
    if (!current) return undefined;

    // Remove old entry from FTS index
    db.prepare("DELETE FROM skills_fts WHERE rowid = ?")
      .run(current.rowid);

    // Update the skill content
    db.prepare("UPDATE skills SET content = ?, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(content, now, projectId, name);

    // Re-insert into FTS index
    db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
      .run(current.rowid, content, getSkill(projectId, name)?.description ?? "");

    checkpointAfterWrite();
    return getSkill(projectId, name);
  });
}
