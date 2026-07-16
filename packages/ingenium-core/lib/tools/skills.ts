import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Skill } from "../schema.js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../logger.js";
import { getSkillsBase } from "./paths.js";

/**
 * Strip ALL leading YAML frontmatter blocks from text.
 * Handles BOM, CRLF, and stacked/repeated blocks (idempotent).
 * Returns text unchanged if no frontmatter is found.
 */
export function stripLeadingFrontmatter(text: string): string {
  // Strip BOM
  let t = text;
  if (t.codePointAt(0) === 0xFEFF) t = t.slice(1);

  // Pattern: ---(optional trailing space)\n...\n---(optional trailing space)(\n)?
  const fmRegex = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n)?/;

  // Strip all consecutive frontmatter blocks (handles stacking from the bug)
  let prev = t;
  while (fmRegex.test(t)) {
    const match = t.match(fmRegex)!;
    t = t.slice(match[0].length);

    // Trim exactly one leading newline (the separator between blocks / body)
    if (t.startsWith("\r\n")) t = t.slice(2);
    else if (t.startsWith("\n")) t = t.slice(1);
    // Don't break: the regex may have consumed the trailing newline,
    // so the next block could follow immediately (stacked frontmatter).

    // Safety: guard against non-advancing regex
    if (t === prev) break;
    prev = t;
  }

  return t;
}

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
    `SELECT s.*, rank FROM skills s
     INNER JOIN skills_fts fts ON fts.rowid = s.rowid
     WHERE s.project_id = ? AND skills_fts MATCH ?
     ORDER BY rank`
  ).all(projectId, query) as Skill[];
}

export function writeSkillToDisk(skill: Skill): void {
  const projectId = skill.project_id;
  const skillsBase = getSkillsBase(projectId);
  const dir = resolve(skillsBase, skill.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Write SKILL.md with YAML frontmatter
  // Un-escape any existing escapes before re-escaping to prevent double-escape
  const escaped = (skill.description || "")
    .replace(/\\\\"/g, '"')  // un-escape double-escaped quotes
    .replace(/\\"/g, '"')    // un-escape single-escaped quotes
    .replace(/"/g, '\\"');   // re-escape exactly once
  const frontmatter = `---
name: ${skill.name}
description: "${escaped}"
created: ${(skill as any).created_at || new Date().toISOString()}
---
`;
  // Strip any existing frontmatter from content so we don't stack blocks
  const body = stripLeadingFrontmatter(skill.content);
  writeFileSync(resolve(dir, "SKILL.md"), frontmatter + "\n" + body);

  // Write metadata.json
  const tags = skill.tags ? skill.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
  const meta = JSON.stringify({ tags, alwaysApply: (skill as any).always_apply === 1 }, null, 2);
  writeFileSync(resolve(dir, "metadata.json"), meta);

  // Write file_tree — every file under the skill directory
  if ((skill as any).file_tree) {
    try {
      const tree = JSON.parse((skill as any).file_tree);
      for (const [relPath, content] of Object.entries(tree)) {
        const filePath = resolve(dir, relPath);
        const parentDir = resolve(filePath, "..");
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
        writeFileSync(filePath, content as string, "utf-8");
      }
    } catch (e) {
      logger.warn("skills", "Failed to parse file_tree JSON", { name: skill.name });
    }
  }
}

function removeSkillFromDisk(name: string, projectId?: string): void {
  const skillsBase = getSkillsBase(projectId);
  const dir = resolve(skillsBase, name);
  const filePath = resolve(dir, "SKILL.md");
  const metaPath = resolve(dir, "metadata.json");
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}
  try { if (existsSync(metaPath)) unlinkSync(metaPath); } catch {}
}

export function createSkill(projectId: string, name: string, description: string, content: string, category?: string, tags?: string, alwaysApply?: number, fileTree?: string): Skill {
  const skill = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const id = randomUUID();
    const result = db.prepare(
      `INSERT INTO skills (id, project_id, name, description, content, category, tags, always_apply, file_tree, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, name) DO UPDATE SET
         description = excluded.description,
         content = excluded.content,
         category = excluded.category,
         tags = excluded.tags,
         always_apply = excluded.always_apply,
         file_tree = excluded.file_tree,
         updated_at = excluded.updated_at`
    ).run(id, projectId, name, description, content, category ?? null, tags ?? null, alwaysApply ?? 0, fileTree ?? null, now, now);
    // Sync FTS5 index: use lastInsertRowid (integer) for FTS5 rowid
    db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
      .run(result.lastInsertRowid, content, description);
    return getSkill(projectId, name)!;
  });
  checkpointAfterWrite();
  // Write to disk AFTER the DB transaction commits — frontmatter amplification
  // is prevented by stripLeadingFrontmatter() inside writeSkillToDisk
  if (skill) writeSkillToDisk(skill);
  return skill;
}

export function updateSkill(projectId: string, name: string, content: string, description?: string, tags?: string, alwaysApply?: number, fileTree?: string): Skill | undefined {
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

    const desc = description ?? getSkill(projectId, name)?.description ?? "";

    // Update the skill content
    db.prepare(
      `UPDATE skills SET content = ?, description = ?, tags = ?, always_apply = ?, file_tree = ?, updated_at = ?
       WHERE project_id = ? AND name = ?`
    ).run(content, desc, tags ?? null, alwaysApply ?? 0, fileTree ?? null, now, projectId, name);

    // Re-insert into FTS index
    db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
      .run(current.rowid, content, getSkill(projectId, name)?.description ?? "");

    checkpointAfterWrite();
    // 🔴 writeSkillToDisk DISABLED
    return getSkill(projectId, name);
  });
}

export function deleteSkill(projectId: string, name: string): boolean {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const current = db.prepare("SELECT rowid FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as { rowid: number } | undefined;
    if (!current) return false;
    db.prepare("DELETE FROM skills_fts WHERE rowid = ?").run(current.rowid);
    db.prepare("DELETE FROM skills WHERE project_id = ? AND name = ?").run(projectId, name);
    removeSkillFromDisk(name, projectId);
    checkpointAfterWrite();
    return true;
  });
}

export function enableSkill(projectId: string, name: string): Skill | undefined {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    db.prepare("UPDATE skills SET enabled = 1, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(now, projectId, name);
    const skill = db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Skill | undefined;
    if (skill) writeSkillToDisk(skill);
    checkpointAfterWrite();
    return skill;
  });
}

export function disableSkill(projectId: string, name: string): Skill | undefined {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    db.prepare("UPDATE skills SET enabled = 0, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(now, projectId, name);
    removeSkillFromDisk(name, projectId);
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Skill | undefined;
  });
}

export function syncSkillFromDisk(projectId: string, name: string): Skill | undefined {
  const result = execTransaction(() => {
    // Find the file on disk
    const skillsBase = getSkillsBase(projectId);
    const filePath = resolve(skillsBase, name, "SKILL.md");
    if (!existsSync(filePath)) {
      logger.debug("skills", "Skill file not found on disk", { name, filePath });
      return undefined;
    }

    // Read and parse frontmatter
    const content = readFileSync(filePath, "utf-8");
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descMatch = content.match(/^description:\s*"(.+)"$/m);
    const diskName = nameMatch?.[1] ?? name;
    // Un-escape YAML-escaped quotes to restore original description text
    const rawDescription = descMatch?.[1] ?? "";
    const description = rawDescription.replace(/\\"/g, '"');

    // Read metadata.json
    const metaPath = resolve(filePath, "..", "metadata.json");
    let diskTags = "";
    let diskAlwaysApply = 0;
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        if (Array.isArray(meta.tags)) diskTags = meta.tags.join(",");
        if (meta.alwaysApply === true) diskAlwaysApply = 1;
      } catch {}
    }

    // Read all auxiliary files (everything except SKILL.md and metadata.json)
    let fileTree = "";
    try {
      const tree: Record<string, string> = {};
      const walkDir = (dir: string, base: string) => {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            walkDir(resolve(dir, e.name), base + e.name + "/");
          } else if (e.isFile()) {
            const relPath = base + e.name;
            if (relPath === "SKILL.md" || relPath === "metadata.json") continue;
            tree[relPath] = readFileSync(resolve(dir, e.name), "utf-8");
          }
        }
      };
      walkDir(resolve(filePath, ".."), "");
      if (Object.keys(tree).length > 0) fileTree = JSON.stringify(tree);
    } catch {}

    // Check if skill exists in DB
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Skill | undefined;

    if (!existing) {
      // Create new skill from disk file
      const now = new Date().toISOString();
      const id = randomUUID();
      db.prepare(
        `INSERT INTO skills (id, project_id, name, description, content, tags, always_apply, file_tree, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, name) DO UPDATE SET
           description = excluded.description,
           content = excluded.content,
           tags = excluded.tags,
           always_apply = excluded.always_apply,
           file_tree = excluded.file_tree,
           updated_at = excluded.updated_at`
      ).run(id, projectId, diskName, description, content, diskTags, diskAlwaysApply, fileTree, now, now);
      // FTS5 index is auto-synced by AFTER INSERT trigger on skills (migration 024)
      logger.info("skills", "Skill created from disk sync", { name: diskName });
    } else {
      // Update existing skill from disk file
      // FTS5 index is auto-synced by AFTER UPDATE trigger on skills (migration 024)
      const now = new Date().toISOString();
      db.prepare("UPDATE skills SET content = ?, description = ?, tags = ?, always_apply = ?, file_tree = ?, updated_at = ? WHERE id = ?")
        .run(content, description, diskTags, diskAlwaysApply, fileTree, now, existing.id);
      logger.info("skills", "Skill synced from disk", { name: diskName });
    }

    return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, diskName) as Skill | undefined;
  });
  checkpointAfterWrite();
  return result;
}

export function syncAllSkills(projectId: string, db?: any): number {
  const database = db ?? getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const skills = database.prepare("SELECT * FROM skills WHERE project_id = ? AND enabled = 1")
    .all(projectId) as Skill[];
  for (const skill of skills) {
    writeSkillToDisk(skill);
  }
  return skills.length;
}

export function copySkills(sourceProjectId: string, targetProjectId: string): number {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const sourceSkills = db.prepare(
      "SELECT * FROM skills WHERE project_id = ? AND enabled = 1"
    ).all(sourceProjectId) as Skill[];
    let count = 0;
    for (const skill of sourceSkills) {
      const now = new Date().toISOString();
      const id = randomUUID();
      const result = db.prepare(
        `INSERT INTO skills (id, project_id, name, description, content, category, tags, always_apply, file_tree, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        targetProjectId,
        skill.name,
        skill.description,
        skill.content,
        skill.category ?? null,
        skill.tags ?? null,
        skill.always_apply ?? 0,
        (skill as any).file_tree ?? null,
        now,
        now,
      );
      // Sync FTS5 index
      db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
        .run(result.lastInsertRowid, skill.content, skill.description);
      count++;
    }
    checkpointAfterWrite();
    return count;
  });
}
