import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { resolve, sep, isAbsolute } from "node:path";
import { logger } from "../logger.js";
import { getSkillsBase } from "./paths.js";
/**
 * Strip ALL leading YAML frontmatter blocks from text.
 * Handles BOM, CRLF, and stacked/repeated blocks (idempotent).
 * Returns text unchanged if no frontmatter is found.
 */
export function stripLeadingFrontmatter(text) {
    // Strip BOM
    let t = text;
    if (t.codePointAt(0) === 0xFEFF)
        t = t.slice(1);
    // Pattern: ---(optional trailing space)\n...\n---(optional trailing space)(\n)?
    const fmRegex = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n)?/;
    // Strip all consecutive frontmatter blocks (handles stacking from the bug)
    let prev = t;
    while (fmRegex.test(t)) {
        const match = t.match(fmRegex);
        t = t.slice(match[0].length);
        // Trim exactly one leading newline (the separator between blocks / body)
        if (t.startsWith("\r\n"))
            t = t.slice(2);
        else if (t.startsWith("\n"))
            t = t.slice(1);
        // Don't break: the regex may have consumed the trailing newline,
        // so the next block could follow immediately (stacked frontmatter).
        // Safety: guard against non-advancing regex
        if (t === prev)
            break;
        prev = t;
    }
    return t;
}
/**
 * Security: validate a relative file_tree path against a canonical base directory.
 * Rejects absolute paths, path traversal (../), and symlink escapes.
 * Returns the resolved safe path, or null if the path is unsafe.
 */
function resolveSafePath(baseDir, relativePath) {
    // Reject absolute paths (e.g., "/etc/passwd")
    if (isAbsolute(relativePath))
        return null;
    // Resolve relative to the canonical base directory
    const resolved = resolve(baseDir, relativePath);
    // Containment check: resolved path must be within baseDir
    // Use `baseDir + sep` to ensure we match the directory boundary, not a sibling prefix
    if (!resolved.startsWith(baseDir + sep) && resolved !== baseDir)
        return null;
    // Symlink escape check: realpathSync follows symlinks to the canonical target
    // This catches cases where a symlink within the skill directory points outside
    try {
        const parentDir = resolve(resolved, "..");
        // Only check if the parent exists (file may not yet exist for writes)
        if (existsSync(parentDir)) {
            // For directories, check that the parent is within baseDir
            const canonicalParent = realpathSync(parentDir);
            if (!canonicalParent.startsWith(baseDir + sep) && canonicalParent !== baseDir)
                return null;
        }
        // If the file already exists (e.g., on re-write), verify its real path
        if (existsSync(resolved)) {
            const canonical = realpathSync(resolved);
            if (!canonical.startsWith(baseDir + sep) && canonical !== baseDir)
                return null;
        }
    }
    catch {
        // realpathSync can throw on nonexistent paths — that's fine, skip this check
    }
    return resolved;
}
export function listSkills(projectId) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM skills WHERE project_id = ? AND enabled = 1")
        .all(projectId);
}
export function getSkill(projectId, name) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
        .get(projectId, name);
}
export function searchSkills(projectId, query) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const sanitized = sanitizeFts5Query(query);
    if (!sanitized)
        return [];
    return db.prepare(`SELECT s.*, rank FROM skills s
     INNER JOIN skills_fts fts ON fts.rowid = s.rowid
     WHERE s.project_id = ? AND skills_fts MATCH ?
     ORDER BY rank`).all(projectId, sanitized);
}
export function writeSkillToDisk(skill) {
    const projectId = skill.project_id;
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, skill.name);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    // Canonicalize the base directory to prevent symlink-based escapes
    let baseDir = dir;
    try {
        baseDir = realpathSync(dir);
    }
    catch { /* dir just created, realpath may fail; fall back to resolved */ }
    // Write SKILL.md with YAML frontmatter
    // Un-escape any existing escapes before re-escaping to prevent double-escape
    const escaped = (skill.description || "")
        .replace(/\\\\"/g, '"') // un-escape double-escaped quotes
        .replace(/\\"/g, '"') // un-escape single-escaped quotes
        .replace(/"/g, '\\"'); // re-escape exactly once
    const frontmatter = `---
name: ${skill.name}
description: "${escaped}"
created: ${skill.created_at || new Date().toISOString()}
---
`;
    // Strip any existing frontmatter from content so we don't stack blocks
    const body = stripLeadingFrontmatter(skill.content);
    writeFileSync(resolve(dir, "SKILL.md"), frontmatter + "\n" + body);
    // Write metadata.json
    const tags = skill.tags ? skill.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const meta = JSON.stringify({ tags, alwaysApply: skill.always_apply === 1 }, null, 2);
    writeFileSync(resolve(dir, "metadata.json"), meta);
    // Write file_tree — every file under the skill directory
    // 🔴 SECURITY: Validate every path against the canonical baseDir to prevent
    // path traversal (../), absolute paths (/etc/passwd), and symlink escapes.
    if (skill.file_tree) {
        try {
            const tree = JSON.parse(skill.file_tree);
            for (const [relPath, content] of Object.entries(tree)) {
                const safePath = resolveSafePath(baseDir, relPath);
                if (!safePath) {
                    logger.warn("skills", "Rejected unsafe file_tree path", {
                        name: skill.name, path: relPath, baseDir,
                    });
                    continue;
                }
                const parentDir = resolve(safePath, "..");
                if (!existsSync(parentDir))
                    mkdirSync(parentDir, { recursive: true });
                writeFileSync(safePath, content, "utf-8");
                // Post-write symlink defense: verify the written file's real path is still within baseDir.
                // If a symlink was created between the containment check and the write, this catches it.
                try {
                    const realPath = realpathSync(safePath);
                    if (!realPath.startsWith(baseDir + sep) && realPath !== baseDir) {
                        logger.warn("skills", "Post-write symlink escape detected, removing file", {
                            name: skill.name, path: relPath, realPath,
                        });
                        unlinkSync(safePath);
                    }
                }
                catch { /* realpath may fail if the file was just removed; safe to ignore */ }
            }
        }
        catch (e) {
            logger.warn("skills", "Failed to parse file_tree JSON", { name: skill.name });
        }
    }
}
function removeSkillFromDisk(name, projectId) {
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, name);
    const filePath = resolve(dir, "SKILL.md");
    const metaPath = resolve(dir, "metadata.json");
    try {
        if (existsSync(filePath))
            unlinkSync(filePath);
    }
    catch { }
    try {
        if (existsSync(metaPath))
            unlinkSync(metaPath);
    }
    catch { }
}
export function createSkill(projectId, name, description, content, category, tags, alwaysApply, fileTree) {
    const skill = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        const id = randomUUID();
        const result = db.prepare(`INSERT INTO skills (id, project_id, name, description, content, category, tags, always_apply, file_tree, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, name) DO UPDATE SET
         description = excluded.description,
         content = excluded.content,
         category = excluded.category,
         tags = excluded.tags,
         always_apply = excluded.always_apply,
         file_tree = excluded.file_tree,
         updated_at = excluded.updated_at`).run(id, projectId, name, description, content, category ?? null, tags ?? null, alwaysApply ?? 0, fileTree ?? null, now, now);
        // Sync FTS5 index: use lastInsertRowid (integer) for FTS5 rowid
        db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
            .run(result.lastInsertRowid, content, description);
        return getSkill(projectId, name);
    });
    checkpointAfterWrite();
    // Write to disk AFTER the DB transaction commits — frontmatter amplification
    // is prevented by stripLeadingFrontmatter() inside writeSkillToDisk
    if (skill)
        writeSkillToDisk(skill);
    return skill;
}
export function updateSkill(projectId, name, content, description, tags, alwaysApply, fileTree) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        // Get current rowid for FTS5 sync
        const current = db.prepare("SELECT rowid FROM skills WHERE project_id = ? AND name = ?")
            .get(projectId, name);
        if (!current)
            return undefined;
        // Remove old entry from FTS index
        db.prepare("DELETE FROM skills_fts WHERE rowid = ?")
            .run(current.rowid);
        const desc = description ?? getSkill(projectId, name)?.description ?? "";
        // Update the skill content
        db.prepare(`UPDATE skills SET content = ?, description = ?, tags = ?, always_apply = ?, file_tree = ?, updated_at = ?
       WHERE project_id = ? AND name = ?`).run(content, desc, tags ?? null, alwaysApply ?? 0, fileTree ?? null, now, projectId, name);
        // Re-insert into FTS index
        db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
            .run(current.rowid, content, getSkill(projectId, name)?.description ?? "");
        checkpointAfterWrite();
        // 🔴 writeSkillToDisk DISABLED
        return getSkill(projectId, name);
    });
}
export function deleteSkill(projectId, name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const current = db.prepare("SELECT rowid FROM skills WHERE project_id = ? AND name = ?")
            .get(projectId, name);
        if (!current)
            return false;
        db.prepare("DELETE FROM skills_fts WHERE rowid = ?").run(current.rowid);
        db.prepare("DELETE FROM skills WHERE project_id = ? AND name = ?").run(projectId, name);
        removeSkillFromDisk(name, projectId);
        checkpointAfterWrite();
        return true;
    });
}
export function enableSkill(projectId, name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        db.prepare("UPDATE skills SET enabled = 1, updated_at = ? WHERE project_id = ? AND name = ?")
            .run(now, projectId, name);
        const skill = db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
            .get(projectId, name);
        if (skill)
            writeSkillToDisk(skill);
        checkpointAfterWrite();
        return skill;
    });
}
export function disableSkill(projectId, name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        db.prepare("UPDATE skills SET enabled = 0, updated_at = ? WHERE project_id = ? AND name = ?")
            .run(now, projectId, name);
        removeSkillFromDisk(name, projectId);
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
            .get(projectId, name);
    });
}
export function syncSkillFromDisk(projectId, name) {
    const result = execTransaction(() => {
        // Find the file on disk
        const skillsBase = getSkillsBase(projectId);
        const filePath = resolve(skillsBase, name, "SKILL.md");
        if (!existsSync(filePath)) {
            logger.debug("skills", "Skill file not found on disk", { name, filePath });
            return undefined;
        }
        // Canonicalize the skill directory to prevent symlink escapes during reading
        const skillDir = resolve(filePath, "..");
        let baseDir = skillDir;
        try {
            baseDir = realpathSync(skillDir);
        }
        catch { /* fall back to resolved path */ }
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
                if (Array.isArray(meta.tags))
                    diskTags = meta.tags.join(",");
                if (meta.alwaysApply === true)
                    diskAlwaysApply = 1;
            }
            catch { }
        }
        // Read all auxiliary files (everything except SKILL.md and metadata.json)
        // 🔴 SECURITY: Verify every file read is within the canonical skill directory
        // to prevent symlink-based escapes reading files outside the expected path.
        let fileTree = "";
        try {
            const tree = {};
            const walkDir = (dir, base) => {
                const entries = readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                    if (e.isDirectory()) {
                        const childPath = resolve(dir, e.name);
                        // Containment check before recursing into subdirectories
                        try {
                            const childCanonical = realpathSync(childPath);
                            if (!childCanonical.startsWith(baseDir + sep) && childCanonical !== baseDir) {
                                logger.warn("skills", "Skipping directory outside skill base", {
                                    name, path: childPath, canonical: childCanonical,
                                });
                                continue;
                            }
                            walkDir(childPath, base + e.name + "/");
                        }
                        catch {
                            // realpathSync may fail; skip this entry
                        }
                    }
                    else if (e.isFile()) {
                        const relPath = base + e.name;
                        if (relPath === "SKILL.md" || relPath === "metadata.json")
                            continue;
                        const childPath = resolve(dir, e.name);
                        // Containment check before reading file content
                        try {
                            const childCanonical = realpathSync(childPath);
                            if (!childCanonical.startsWith(baseDir + sep) && childCanonical !== baseDir) {
                                logger.warn("skills", "Skipping file outside skill base", {
                                    name, path: childPath, canonical: childCanonical,
                                });
                                continue;
                            }
                        }
                        catch {
                            // realpathSync may fail; skip this entry
                        }
                        tree[relPath] = readFileSync(childPath, "utf-8");
                    }
                    // Note: symlinks are not followed — readdirSync with withFileTypes uses lstat,
                    // so symlinks are neither isDirectory() nor isFile() and are silently skipped.
                }
            };
            walkDir(resolve(filePath, ".."), "");
            if (Object.keys(tree).length > 0)
                fileTree = JSON.stringify(tree);
        }
        catch { }
        // Check if skill exists in DB
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const existing = db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
            .get(projectId, name);
        if (!existing) {
            // Create new skill from disk file
            const now = new Date().toISOString();
            const id = randomUUID();
            db.prepare(`INSERT INTO skills (id, project_id, name, description, content, tags, always_apply, file_tree, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, name) DO UPDATE SET
           description = excluded.description,
           content = excluded.content,
           tags = excluded.tags,
           always_apply = excluded.always_apply,
           file_tree = excluded.file_tree,
           updated_at = excluded.updated_at`).run(id, projectId, diskName, description, content, diskTags, diskAlwaysApply, fileTree, now, now);
            // FTS5 index is auto-synced by AFTER INSERT trigger on skills (migration 024)
            logger.info("skills", "Skill created from disk sync", { name: diskName });
        }
        else {
            // Update existing skill from disk file
            // FTS5 index is auto-synced by AFTER UPDATE trigger on skills (migration 024)
            const now = new Date().toISOString();
            db.prepare("UPDATE skills SET content = ?, description = ?, tags = ?, always_apply = ?, file_tree = ?, updated_at = ? WHERE id = ?")
                .run(content, description, diskTags, diskAlwaysApply, fileTree, now, existing.id);
            logger.info("skills", "Skill synced from disk", { name: diskName });
        }
        return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
            .get(projectId, diskName);
    });
    checkpointAfterWrite();
    return result;
}
export function syncAllSkills(projectId, db) {
    const database = db ?? getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const skills = database.prepare("SELECT * FROM skills WHERE project_id = ? AND enabled = 1")
        .all(projectId);
    for (const skill of skills) {
        writeSkillToDisk(skill);
    }
    return skills.length;
}
export function copySkills(sourceProjectId, targetProjectId) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const sourceSkills = db.prepare("SELECT * FROM skills WHERE project_id = ? AND enabled = 1").all(sourceProjectId);
        let count = 0;
        for (const skill of sourceSkills) {
            const now = new Date().toISOString();
            const id = randomUUID();
            const result = db.prepare(`INSERT INTO skills (id, project_id, name, description, content, category, tags, always_apply, file_tree, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, targetProjectId, skill.name, skill.description, skill.content, skill.category ?? null, skill.tags ?? null, skill.always_apply ?? 0, skill.file_tree ?? null, now, now);
            // Sync FTS5 index
            db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
                .run(result.lastInsertRowid, skill.content, skill.description);
            count++;
        }
        checkpointAfterWrite();
        return count;
    });
}
