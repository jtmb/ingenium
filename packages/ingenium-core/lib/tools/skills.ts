import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
import { Skill, SkillVersion } from "../schema.js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, realpathSync, lstatSync } from "node:fs";
import { resolve, sep, isAbsolute } from "node:path";
import { logger } from "../logger.js";
import { getSkillsBase } from "./paths.js";

/**
 * Validate a skill name for filesystem safety.
 *
 * A safe skill name is a non-empty string ≤ 64 characters that does not contain
 * path separators (`/`, `\\`), null bytes, and is not `.` or `..`.
 * Spaces and underscores are allowed for backward compatibility.
 *
 * Use before any filesystem path derived from a skill name and before DB
 * mutation entry points that create/update by name.
 */
export function isSafeSkillName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 64) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("\x00")) return false;
  return true;
}

/** Private assertion — throws before DB mutations so disk divergence is prevented. */
function assertSafeName(name: unknown): asserts name is string {
  if (!isSafeSkillName(name)) {
    throw new Error(`Unsafe skill name: "${String(name)}". Names must be 1-64 chars with no path separators, null bytes, or '.'/'..'.`);
  }
}

/**
 * Validate file_tree value: must be undefined, null, or a JSON string representing
 * a non-array object whose values are all strings. Empty-string, arrays, primitives,
 * and non-string values are invalid.
 */
export function isValidSkillFileTree(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    for (const v of Object.values(parsed)) {
      if (typeof v !== "string") return false;
    }
    return true;
  } catch { return false; }
}

/**
 * Verify the skills base directory itself is safe — not a symlink and its
 * canonical path is under its canonical parent. Returns true if safe;
 * false if a symlink-escape at the root level is detected.
 */
function safeSkillsBaseRoot(skillsBase: string): boolean {
  // If skillsBase does not exist, it's safe to create later (write paths)
  if (!existsSync(skillsBase)) return true;
  try {
    if (lstatSync(skillsBase).isSymbolicLink()) return false;
  } catch { return false; }
  try {
    const canon = realpathSync(skillsBase);
    const parentCanon = realpathSync(resolve(skillsBase, ".."));
    if (!canon.startsWith(parentCanon + sep) && canon !== parentCanon) return false;
    return true;
  } catch { return false; }
}

/**
 * Verify a skill directory is safe — not a symlink and its canonical path
 * remains within the skills base. Also confirms the skills base root itself
 * is not a symlink escape. Returns canonical dir, or null if unsafe.
 */
function safeSkillDir(skillsBase: string, name: string): string | null {
  if (!safeSkillsBaseRoot(skillsBase)) return null;
  assertSafeName(name);
  const dir = resolve(skillsBase, name);
  try {
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) return null;
  } catch { /* lstat may fail */ }
  try {
    const canon = realpathSync(dir);
    const canonBase = realpathSync(skillsBase);
    if (!canon.startsWith(canonBase + sep) && canon !== canonBase) return null;
    return canon;
  } catch {
    // dir doesn't exist yet — safe to create at resolved path
    return dir;
  }
}

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

    // Safety: guard against non-advancing regex
    if (t === prev) break;
    prev = t;
  }

  return t;
}

/**
 * Security: validate a relative file_tree path against a canonical base directory.
 * Rejects absolute paths, path traversal (../), symlink escapes, and reserved
 * canonical filenames (SKILL.md, metadata.json).
 *
 * Reserved-file defense: the resolved target is compared against the resolved
 * canonical SKILL.md / metadata.json paths (catches `./SKILL.md`,
 * `refs/../metadata.json`, empty/`.` that resolve to base directory, etc.).
 * Existing directory targets and dangling symlink ancestors are also rejected.
 *
 * Walks upward from the target path to the nearest existing ancestor and verifies
 * its realpath is within the canonical base BEFORE any mkdir/write — this defends
 * against a symlinked ancestor with a nonexistent deeper descendant.
 *
 * Returns the resolved safe path, or null if the path is unsafe.
 */
function resolveSafePath(baseDir: string, relativePath: string): string | null {
  // Reject absolute paths (e.g., "/etc/passwd")
  if (isAbsolute(relativePath)) return null;

  // Reject empty/`.` paths that resolve to the base directory itself
  if (relativePath === "" || relativePath === ".") return null;

  // Resolve relative to the base directory
  const resolved = resolve(baseDir, relativePath);

  // Containment check: resolved path must be within baseDir
  if (!resolved.startsWith(baseDir + sep) && resolved !== baseDir) return null;

  // Reserved-file defense: compare resolved target against canonical SKILL.md / metadata.json paths
  const canonicalSkillMd = resolve(baseDir, "SKILL.md");
  const canonicalMetadataJson = resolve(baseDir, "metadata.json");
  if (resolved === canonicalSkillMd || resolved === canonicalMetadataJson) return null;

  // Reject existing directory targets (file_tree entries must be files)
  try {
    if (existsSync(resolved) && lstatSync(resolved).isDirectory()) return null;
  } catch { /* lstat may fail */ }

  // Walk upward to the nearest existing ancestor and verify its realpath
  // is within the canonical base.
  try {
    let walk = resolved;
    for (;;) {
      // Check for dangling symlink at any level in the ancestor chain (lstat, not existsSync)
      try {
        if (lstatSync(walk).isSymbolicLink()) return null;
      } catch {
        // lstat threw — path component does not exist. Check the parent.
        const parent = resolve(walk, "..");
        if (parent === walk) break;
        walk = parent;
        continue;
      }

      if (existsSync(walk)) {
        try {
          const canon = realpathSync(walk);
          if (!canon.startsWith(baseDir + sep) && canon !== baseDir) return null;
        } catch { /* realpathSync may throw */ }
        break; // reached an existing ancestor within base
      }
      const parent = resolve(walk, "..");
      if (parent === walk) break;
      walk = parent;
    }
  } catch {
    return null;
  }

  return resolved;
}

/** List all enabled skills for a project. */
export function listSkills(projectId: string): Skill[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM skills WHERE project_id = ? AND enabled = 1 AND archived_at IS NULL")
    .all(projectId) as Skill[];
}

/** List all archived skills for a project. */
export function listArchivedSkills(projectId: string): Skill[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM skills WHERE project_id = ? AND archived_at IS NOT NULL")
    .all(projectId) as Skill[];
}

/** Get a single skill by project and name (active or archived). Returns undefined if not found. */
export function getSkill(projectId: string, name: string): Skill | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Skill | undefined;
}

/** Get a skill by its UUID id. Returns undefined if not found. */
export function getSkillById(skillId: string): Skill | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM skills WHERE id = ?")
    .get(skillId) as Skill | undefined;
}

/**
 * Full-text search across skills using FTS5.
 * Returns results ranked by BM25 relevance. Falls back to an empty array
 * if sanitizeFts5Query rejects the input.
 */
export function searchSkills(projectId: string, query: string): Skill[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];
  return db.prepare(
    `SELECT s.*, rank FROM skills s
     INNER JOIN skills_fts fts ON fts.rowid = s.rowid
     WHERE s.project_id = ? AND skills_fts MATCH ?
     ORDER BY rank`
  ).all(projectId, sanitized) as Skill[];
}

/**
 * Get all version snapshots for a skill, ordered by revision descending (newest first).
 */
export function getSkillVersions(skillId: string): SkillVersion[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare(
    "SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY revision DESC"
  ).all(skillId) as SkillVersion[];
}

/**
 * Get a specific version of a skill by revision number.
 */
export function getSkillVersion(skillId: string, revision: number): SkillVersion | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare(
    "SELECT * FROM skill_versions WHERE skill_id = ? AND revision = ?"
  ).get(skillId, revision) as SkillVersion | undefined;
}

/**
 * Write a skill's full representation to disk.
 *
 * Does NOT write if the skill is archived (SKILL.md removed, but auxiliary files preserved).
 */
export function writeSkillToDisk(skill: Skill): void {
  // Archived skills should not have a SKILL.md written (it was removed on archive)
  if ((skill as any).archived_at) {
    return;
  }

  if (!isSafeSkillName(skill.name)) {
    logger.warn("skills", "Refusing to write skill with unsafe name", { name: skill.name });
    return;
  }

  const projectId = skill.project_id;
  const skillsBase = getSkillsBase(projectId);
  const baseDir = safeSkillDir(skillsBase, skill.name);
  if (!baseDir) {
    logger.warn("skills", "Refusing to write skill — unsafe directory (symlink/canonical escape)", { name: skill.name });
    return;
  }
  const dir = resolve(skillsBase, skill.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Write SKILL.md with YAML frontmatter
  const escaped = (skill.description || "")
    .replace(/\\\\"/g, '"')
    .replace(/\\"/g, '"')
    .replace(/"/g, '\\"');
  const frontmatter = `---
name: ${skill.name}
description: "${escaped}"
created: ${(skill as any).created_at || new Date().toISOString()}
---
`;
  const body = stripLeadingFrontmatter(skill.content);
  writeFileSync(resolve(dir, "SKILL.md"), frontmatter + "\n" + body);

  // Write metadata.json
  const tags = skill.tags ? skill.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
  const meta = JSON.stringify({ tags, alwaysApply: (skill as any).always_apply === 1 }, null, 2);
  writeFileSync(resolve(dir, "metadata.json"), meta);

  // Write file_tree
  if ((skill as any).file_tree) {
    try {
      const tree = JSON.parse((skill as any).file_tree);
      for (const [relPath, content] of Object.entries(tree)) {
        if (typeof content !== "string") continue; // defensively skip non-string values
        const safePath = resolveSafePath(baseDir, relPath as string);
        if (!safePath) {
          logger.warn("skills", "Rejected unsafe file_tree path", {
            name: skill.name, path: relPath, baseDir,
          });
          continue;
        }
        const parentDir = resolve(safePath, "..");
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
        writeFileSync(safePath, content as string, "utf-8");

        // Post-write symlink defense
        try {
          const realPath = realpathSync(safePath);
          if (!realPath.startsWith(baseDir + sep) && realPath !== baseDir) {
            logger.warn("skills", "Post-write symlink escape detected, removing file", {
              name: skill.name, path: relPath, realPath,
            });
            unlinkSync(safePath);
          }
        } catch { /* realpath may fail; safe to ignore */ }
      }
    } catch (e) {
      logger.warn("skills", "Failed to parse file_tree JSON", { name: skill.name });
    }
  }
}

/** Remove only SKILL.md from disk for a given skill (preserves metadata.json and all auxiliary files). */
export function removeSkillMdOnly(name: string, projectId?: string): void {
  if (!isSafeSkillName(name)) {
    logger.warn("skills", "Refusing to remove SKILL.md with unsafe name", { name });
    return;
  }
  const skillsBase = getSkillsBase(projectId);
  const canonical = safeSkillDir(skillsBase, name);
  if (!canonical) {
    logger.warn("skills", "Refusing to remove SKILL.md — unsafe directory (symlink/canonical escape)", { name });
    return;
  }
  const dir = resolve(skillsBase, name);
  const filePath = resolve(dir, "SKILL.md");
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}
}

/**
 * Remove SKILL.md from disk for a given skill (preserves metadata.json and all auxiliary files).
 * On disable/archive we only remove the discoverability entry point (SKILL.md).
 * All other content (metadata.json, file_tree auxiliary files) is preserved.
 */
function removeSkillMdFromDisk(name: string, projectId?: string): void {
  removeSkillMdOnly(name, projectId);
}

/**
 * Create or upsert a skill for a project.
 * Increments revision on every call (create starts at 0, upsert bumps existing).
 *
 * Uses ON CONFLICT ... DO UPDATE SET for atomic upsert.
 * Writes to DB first (transactional), THEN to disk after transaction commits.
 *
 * 🔴 checkpointAfterWrite() is OUTSIDE execTransaction() — WAL safety.
 */
export function createSkill(
  projectId: string, name: string, description: string, content: string,
  category?: string, tags?: string, alwaysApply?: number, fileTree?: string,
): Skill {
  assertSafeName(name);
  if (!isValidSkillFileTree(fileTree)) {
    throw new Error("Invalid file_tree: must be a JSON string representing a non-array object with string values.");
  }
  const skill = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const id = randomUUID();

    // Check if skill already exists to determine if this is a create or upsert
    const existing = db.prepare("SELECT id, revision FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as { id: string; revision: number } | undefined;

    if (existing) {
      // Upsert: increment revision
      const newRevision = existing.revision + 1;
      db.prepare(
        `UPDATE skills SET
           description = ?, content = ?, category = ?, tags = ?,
           always_apply = ?, file_tree = ?, revision = ?,
           archived_at = NULL, updated_at = ?
         WHERE project_id = ? AND name = ?`
      ).run(
        description, content, category ?? null, tags ?? null,
        alwaysApply ?? 0, fileTree ?? null, newRevision,
        now, projectId, name,
      );
    } else {
      // Create: revision starts at 0
      db.prepare(
        `INSERT INTO skills (id, project_id, name, description, content, category, tags, always_apply, file_tree, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(id, projectId, name, description, content, category ?? null, tags ?? null, alwaysApply ?? 0, fileTree ?? null, now, now);
    }

    // The AFTER INSERT/UPDATE triggers on skills handle:
    // - FTS5 sync (migration 024 triggers)
    // - version snapshot (migration 042 triggers, only when revision changes)

    return getSkill(projectId, name)!;
  });
  checkpointAfterWrite();
  if (skill) writeSkillToDisk(skill);
  return skill;
}

/**
 * Update a skill's content and metadata. Increments revision.
 *
 * FTS5 sync handled by AFTER UPDATE triggers (migration 024).
 * Version snapshot handled by AFTER UPDATE trigger (migration 042) — fires only because revision changes.
 *
 * Returns undefined if the skill doesn't exist.
 */
export function updateSkill(
  projectId: string, name: string, content: string,
  description?: string, tags?: string, alwaysApply?: number,
  fileTree?: string,
): Skill | undefined {
  assertSafeName(name);
  if (!isValidSkillFileTree(fileTree)) {
    throw new Error("Invalid file_tree: must be a JSON string representing a non-array object with string values.");
  }
  const skill = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const current = db.prepare(
      "SELECT revision FROM skills WHERE project_id = ? AND name = ?"
    ).get(projectId, name) as { revision: number } | undefined;
    if (!current) return undefined;

    const newRevision = current.revision + 1;

    db.prepare(
      `UPDATE skills SET
         content = ?, description = COALESCE(?, description),
         tags = COALESCE(?, tags), always_apply = COALESCE(?, always_apply),
         file_tree = COALESCE(?, file_tree),
         revision = ?, updated_at = ?
       WHERE project_id = ? AND name = ?`
    ).run(
      content, description ?? null, tags ?? null,
      alwaysApply ?? null, fileTree ?? null,
      newRevision, now, projectId, name,
    );

    return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Skill | undefined;
  });
  checkpointAfterWrite();
  if (skill) writeSkillToDisk(skill);
  return skill;
}

/**
 * Enable a skill and write it to disk after the DB transaction commits.
 * Increments revision to capture enablement in version history.
 */
export function enableSkill(projectId: string, name: string): Skill | undefined {
  assertSafeName(name);
  const skill = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const current = db.prepare(
      "SELECT revision FROM skills WHERE project_id = ? AND name = ?"
    ).get(projectId, name) as { revision: number } | undefined;
    if (!current) return undefined;

    const newRevision = current.revision + 1;
    db.prepare(
      "UPDATE skills SET enabled = 1, revision = ?, updated_at = ? WHERE project_id = ? AND name = ?"
    ).run(newRevision, now, projectId, name);
    return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Skill | undefined;
  });
  checkpointAfterWrite();
  if (skill) writeSkillToDisk(skill);
  return skill;
}

/** Disable a skill and remove SKILL.md from disk after the DB transaction commits. */
export function disableSkill(projectId: string, name: string): Skill | undefined {
  assertSafeName(name);
  const skill = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const current = db.prepare(
      "SELECT revision FROM skills WHERE project_id = ? AND name = ?"
    ).get(projectId, name) as { revision: number } | undefined;
    if (!current) return undefined;

    const newRevision = current.revision + 1;
    db.prepare(
      "UPDATE skills SET enabled = 0, revision = ?, updated_at = ? WHERE project_id = ? AND name = ?"
    ).run(newRevision, now, projectId, name);
    return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Skill | undefined;
  });
  checkpointAfterWrite();
  // Remove only SKILL.md (discoverability entry point), preserve metadata.json and aux files
  if (skill) removeSkillMdFromDisk(name, projectId);
  return skill;
}

/**
 * Archive a skill (soft-delete): sets archived_at, removes only SKILL.md from disk
 * but preserves metadata.json and all auxiliary source files (file_tree contents).
 *
 * The skill remains in the DB with archived_at set and is excluded from listSkills().
 * Auxiliary files are preserved for potential restoration. Only SKILL.md is removed
 * to make it undiscoverable — metadata.json and all file_tree content survive.
 *
 * 🔴 No-op if the skill is already archived (returns undefined, no revision bump).
 * Returns undefined if the skill doesn't exist.
 */
export function archiveSkill(projectId: string, name: string): Skill | undefined {
  assertSafeName(name);
  const skill = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const current = db.prepare(
      "SELECT revision, archived_at FROM skills WHERE project_id = ? AND name = ?"
    ).get(projectId, name) as { revision: number; archived_at: string | null } | undefined;
    if (!current) return undefined;
    // No-op if already archived
    if (current.archived_at !== null) return undefined;

    const now = new Date().toISOString();
    const newRevision = current.revision + 1;
    db.prepare(
      "UPDATE skills SET archived_at = ?, revision = ?, updated_at = ? WHERE project_id = ? AND name = ?"
    ).run(now, newRevision, now, projectId, name);
    return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Skill | undefined;
  });
  checkpointAfterWrite();
  // Remove only SKILL.md (discoverability entry point), preserve metadata.json and aux files
  if (skill) removeSkillMdFromDisk(name, projectId);
  return skill;
}

/**
 * Restore an archived skill: clears archived_at, writes full representation to disk.
 *
 * 🔴 No-op if the skill is NOT archived (returns undefined, no revision bump).
 * Returns undefined if the skill doesn't exist.
 */
export function restoreSkill(projectId: string, name: string): Skill | undefined {
  assertSafeName(name);
  const skill = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const current = db.prepare(
      "SELECT revision, archived_at FROM skills WHERE project_id = ? AND name = ?"
    ).get(projectId, name) as { revision: number; archived_at: string | null } | undefined;
    if (!current) return undefined;
    // No-op if not archived
    if (current.archived_at === null) return undefined;

    const now = new Date().toISOString();
    const newRevision = current.revision + 1;
    db.prepare(
      "UPDATE skills SET archived_at = NULL, revision = ?, updated_at = ? WHERE project_id = ? AND name = ?"
    ).run(newRevision, now, projectId, name);
    return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Skill | undefined;
  });
  checkpointAfterWrite();
  if (skill) writeSkillToDisk(skill);
  return skill;
}

/**
 * Rollback a skill to a prior revision.
 *
 * Loads the immutable skill_versions row for the given revision, applies its exact
 * state as a NEW revision, and writes disk. This ensures history remains append-only
 * and the restored state is byte-equivalent to the prior revision.
 *
 * Returns undefined if the skill or version record doesn't exist.
 */
export function rollbackSkill(
  projectId: string, name: string, targetRevision: number,
): Skill | undefined {
  assertSafeName(name);
  const skill = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const current = db.prepare(
      "SELECT id, revision FROM skills WHERE project_id = ? AND name = ?"
    ).get(projectId, name) as { id: string; revision: number } | undefined;
    if (!current) return undefined;

    // Load the target version
    const version = db.prepare(
      "SELECT * FROM skill_versions WHERE skill_id = ? AND revision = ?"
    ).get(current.id, targetRevision) as SkillVersion | undefined;
    if (!version) return undefined;

    // Reject unsafe version.name before applying
    if (!isSafeSkillName(version.name)) {
      throw new Error(`Rollback target version has unsafe name: "${version.name}"`);
    }

    const newRevision = current.revision + 1;
    const now = new Date().toISOString();

    // Apply the version's exact state as a new revision
    db.prepare(
      `UPDATE skills SET
         name = ?, description = ?, content = ?,
         category = ?, tags = ?,
         always_apply = ?, file_tree = ?,
         enabled = ?, archived_at = ?,
         revision = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      version.name, version.description, version.content,
      version.category, version.tags,
      version.always_apply, version.file_tree,
      version.enabled, version.archived_at,
      newRevision, now, current.id,
    );

    // The AFTER UPDATE trigger (migration 042) will auto-snapshot the new revision
    // because we changed revision.
    return db.prepare("SELECT * FROM skills WHERE id = ?")
      .get(current.id) as Skill | undefined;
  });
  checkpointAfterWrite();
  if (skill) {
    if (skill.archived_at) {
      removeSkillMdFromDisk(skill.name, projectId);
    } else {
      writeSkillToDisk(skill);
    }
  }
  return skill;
}

/**
 * Delete a skill (archive semantics only).
 *
 * ⚠️ This function now delegates to archiveSkill. The old hard-delete behavior is no
 * longer available — skills are never permanently deleted from the DB. This preserves
 * the version history and allows restoration.
 *
 * Use archiveSkill() explicitly for new code. deleteSkill() is retained for backward
 * compatibility with existing callers (API layer, MCP tools, etc.).
 *
 * Returns false if the skill doesn't exist, true if successfully archived.
 */
export function deleteSkill(projectId: string, name: string): boolean {
  const result = archiveSkill(projectId, name);
  return result !== undefined;
}

/**
 * Sync a skill from its `.opencode/skills/<name>/` directory on disk into the DB.
 *
 * 🔴 Filesystem I/O (reads, directory walks) happens OUTSIDE the DB transaction.
 * Only a short compare/upsert runs inside execTransaction. Path traversal security
 * checks are preserved in the pre-transaction read phase.
 *
 * Avoids revision bump when content/metadata/fileTree are unchanged.
 * Protects archived skills (disk is not authoritative for archived state).
 */
export function syncSkillFromDisk(projectId: string, name: string): Skill | undefined {
  if (!isSafeSkillName(name)) {
    logger.warn("skills", "Refusing to sync skill with unsafe name from disk", { name });
    return undefined;
  }

  // ---- Phase 1: Read and parse disk state (outside transaction) ----
  const skillsBase = getSkillsBase(projectId);
  const canonicalDir = safeSkillDir(skillsBase, name);
  if (!canonicalDir) {
    logger.warn("skills", "Refusing to sync — skill directory is a symlink or outside base", { name });
    return undefined;
  }
  const filePath = resolve(skillsBase, name, "SKILL.md");

  if (!existsSync(filePath)) {
    // Check DB for archived skill — if SKILL.md is gone but skill exists archived, return it
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?").get(projectId, name) as Skill | undefined;
    if (existing && existing.archived_at) {
      logger.debug("skills", "Archived skill SKILL.md not on disk, returning DB state", { name });
      return existing;
    }
    logger.debug("skills", "Skill file not found on disk", { name, filePath });
    return undefined;
  }

  const skillDir = resolve(filePath, "..");
  const baseDir = canonicalDir;

  // Read and parse SKILL.md
  const rawContent = readFileSync(filePath, "utf-8");
  const nameMatch = rawContent.match(/^name:\s*(.+)$/m);
  const descMatch = rawContent.match(/^description:\s*"(.+)"$/m);
  const diskName = nameMatch?.[1] ?? name;
  const rawDescription = descMatch?.[1] ?? "";
  const parsedDescription = rawDescription.replace(/\\"/g, '"');
  const parsedContent = stripLeadingFrontmatter(rawContent);

  // Validate diskName before allowing it into the DB
  if (!isSafeSkillName(diskName)) {
    logger.warn("skills", "Refusing to sync — SKILL.md frontmatter name is unsafe", { name, diskName });
    return undefined;
  }

  // Read and parse metadata.json
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

  // Walk all auxiliary files into a file_tree JSON blob (path traversal safe)
  let fileTree = "";
  try {
    const tree: Record<string, string> = {};
    const walkDir = (dir: string, base: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        // Explicitly skip symlinks at any level
        try {
          if (e.isSymbolicLink()) continue;
        } catch { continue; }
        if (e.isDirectory()) {
          const childPath = resolve(dir, e.name);
          try {
            const childCanonical = realpathSync(childPath);
            if (!childCanonical.startsWith(baseDir + sep) && childCanonical !== baseDir) {
              logger.warn("skills", "Skipping directory outside skill base", { name, path: childPath, canonical: childCanonical });
              continue;
            }
            walkDir(childPath, base + e.name + "/");
          } catch { /* skip */ }
        } else if (e.isFile()) {
          const relPath = base + e.name;
          if (relPath === "SKILL.md" || relPath === "metadata.json") continue;
          const childPath = resolve(dir, e.name);
          try {
            const childCanonical = realpathSync(childPath);
            if (!childCanonical.startsWith(baseDir + sep) && childCanonical !== baseDir) {
              logger.warn("skills", "Skipping file outside skill base", { name, path: childPath, canonical: childCanonical });
              continue;
            }
          } catch { /* skip */ }
          tree[relPath] = readFileSync(childPath, "utf-8");
        }
      }
    };
    walkDir(skillDir, "");
    if (Object.keys(tree).length > 0) fileTree = JSON.stringify(tree);
  } catch {}

  // ---- Phase 2: Short DB compare/update (inside transaction) ----
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?").get(projectId, diskName) as Skill | undefined;

    if (!existing) {
      const now = new Date().toISOString();
      const id = randomUUID();
      db.prepare(
        `INSERT INTO skills (id, project_id, name, description, content, tags, always_apply, file_tree, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(project_id, name) DO UPDATE SET
           description = excluded.description, content = excluded.content,
           tags = excluded.tags, always_apply = excluded.always_apply,
           file_tree = excluded.file_tree, revision = skills.revision + 1,
           archived_at = NULL, updated_at = excluded.updated_at`
      ).run(id, projectId, diskName, parsedDescription, parsedContent, diskTags, diskAlwaysApply, fileTree, now, now);
      logger.info("skills", "Skill created from disk sync", { name: diskName });
    } else {
      if (existing.archived_at) {
        logger.debug("skills", "Skill is archived in DB, skipping disk sync", { name: diskName });
        return existing;
      }

      const existingTags = existing.tags || "";
      const existingFileTree = (existing as any).file_tree || "";
      if (
        parsedContent === existing.content &&
        parsedDescription === existing.description &&
        diskTags === existingTags &&
        diskAlwaysApply === (existing.always_apply ?? 0) &&
        fileTree === existingFileTree
      ) {
        logger.debug("skills", "Skill unchanged, skipping sync", { name: diskName });
        return existing;
      }

      const now = new Date().toISOString();
      const newRevision = existing.revision + 1;
      db.prepare("UPDATE skills SET content=?, description=?, tags=?, always_apply=?, file_tree=?, revision=?, updated_at=? WHERE id=?")
        .run(parsedContent, parsedDescription, diskTags, diskAlwaysApply, fileTree, newRevision, now, existing.id);
      logger.info("skills", "Skill synced from disk", { name: diskName });
    }

    return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?").get(projectId, diskName) as Skill | undefined;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Write all enabled, non-archived skills for a project to disk.
 */
export function syncAllSkills(projectId: string, db?: any): number {
  const database = db ?? getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const skills = database.prepare(
    "SELECT * FROM skills WHERE project_id = ? AND enabled = 1 AND archived_at IS NULL"
  ).all(projectId) as Skill[];
  let written = 0;
  for (const skill of skills) {
    if (isSafeSkillName(skill.name)) {
      writeSkillToDisk(skill);
      written++;
    }
  }
  return written;
}

/**
 * Copy all enabled skills from one project to another.
 * Increments revision on newly created skills.
 */
export function copySkills(sourceProjectId: string, targetProjectId: string): number {
  const count = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const sourceSkills = db.prepare(
      "SELECT * FROM skills WHERE project_id = ? AND enabled = 1 AND archived_at IS NULL"
    ).all(sourceProjectId) as Skill[];
    let n = 0;
    for (const skill of sourceSkills) {
      if (!isSafeSkillName(skill.name)) continue;
      const now = new Date().toISOString();
      const id = randomUUID();
      db.prepare(
        `INSERT INTO skills (id, project_id, name, description, content, category, tags, always_apply, file_tree, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        id, targetProjectId,
        skill.name, skill.description, skill.content,
        skill.category ?? null, skill.tags ?? null,
        skill.always_apply ?? 0,
        (skill as any).file_tree ?? null,
        now, now,
      );
      n++;
    }
    return n;
  });
  checkpointAfterWrite();
  return count;
}
