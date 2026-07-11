import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../logger.js";
import { getSkillsBase } from "./paths.js";
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
    return db.prepare(`SELECT s.*, rank FROM skills s
     INNER JOIN skills_fts fts ON fts.rowid = s.rowid
     WHERE s.project_id = ? AND skills_fts MATCH ?
     ORDER BY rank`).all(projectId, query);
}
function writeSkillToDisk(skill) {
    const projectId = skill.project_id;
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, skill.name);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    // Write SKILL.md with YAML frontmatter
    const frontmatter = `---
name: ${skill.name}
description: "${(skill.description || "").replace(/"/g, '\\"')}"
---
`;
    writeFileSync(resolve(dir, "SKILL.md"), frontmatter + "\n" + skill.content);
    // Write metadata.json
    const tags = skill.tags ? skill.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const meta = JSON.stringify({ tags, alwaysApply: skill.always_apply === 1 }, null, 2);
    writeFileSync(resolve(dir, "metadata.json"), meta);
    // Write file_tree — every file under the skill directory
    if (skill.file_tree) {
        try {
            const tree = JSON.parse(skill.file_tree);
            for (const [relPath, content] of Object.entries(tree)) {
                const filePath = resolve(dir, relPath);
                const parentDir = resolve(filePath, "..");
                if (!existsSync(parentDir))
                    mkdirSync(parentDir, { recursive: true });
                writeFileSync(filePath, content, "utf-8");
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
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        const id = randomUUID();
        const result = db.prepare(`INSERT INTO skills (id, project_id, name, description, content, category, tags, always_apply, file_tree, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, name, description, content, category ?? null, tags ?? null, alwaysApply ?? 0, fileTree ?? null, now, now);
        // Sync FTS5 index: use lastInsertRowid (integer) for FTS5 rowid
        db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
            .run(result.lastInsertRowid, content, description);
        checkpointAfterWrite();
        writeSkillToDisk(getSkill(projectId, name));
        return getSkill(projectId, name);
    });
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
        writeSkillToDisk(getSkill(projectId, name));
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
    return execTransaction(() => {
        // Find the file on disk
        const skillsBase = getSkillsBase(projectId);
        const filePath = resolve(skillsBase, name, "SKILL.md");
        if (!existsSync(filePath)) {
            logger.warn("skills", "Skill file not found on disk", { name, filePath });
            return undefined;
        }
        // Read and parse frontmatter
        const content = readFileSync(filePath, "utf-8");
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const descMatch = content.match(/^description:\s*"(.+)"$/m);
        const diskName = nameMatch?.[1] ?? name;
        const description = descMatch?.[1] ?? "";
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
        let fileTree = "";
        try {
            const tree = {};
            const walkDir = (dir, base) => {
                const entries = readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                    if (e.isDirectory()) {
                        walkDir(resolve(dir, e.name), base + e.name + "/");
                    }
                    else if (e.isFile()) {
                        const relPath = base + e.name;
                        if (relPath === "SKILL.md" || relPath === "metadata.json")
                            continue;
                        tree[relPath] = readFileSync(resolve(dir, e.name), "utf-8");
                    }
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, diskName, description, content, diskTags, diskAlwaysApply, fileTree, now, now);
            // Sync FTS5
            const inserted = db.prepare("SELECT rowid FROM skills WHERE id = ?").get(id);
            db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
                .run(inserted.rowid, content, description);
            logger.info("skills", "Skill created from disk sync", { name: diskName });
        }
        else {
            // Update existing skill from disk file
            const now = new Date().toISOString();
            const row = db.prepare("SELECT rowid FROM skills WHERE id = ?").get(existing.id);
            // Remove old FTS entry
            db.prepare("DELETE FROM skills_fts WHERE rowid = ?").run(row.rowid);
            // Update skill
            db.prepare("UPDATE skills SET content = ?, description = ?, tags = ?, always_apply = ?, file_tree = ?, updated_at = ? WHERE id = ?")
                .run(content, description, diskTags, diskAlwaysApply, fileTree, now, existing.id);
            // Re-insert FTS
            db.prepare("INSERT INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
                .run(row.rowid, content, description);
            logger.info("skills", "Skill synced from disk", { name: diskName });
        }
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?")
            .get(projectId, diskName);
    });
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
