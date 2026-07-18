/**
 * Project CRUD — manages the two-project identity model (see AGENTS.md).
 *
 * Every project gets a UUID-based ID and a named directory under INGENIUM_HOME/projects/.
 * Global projects (is_global=1) serve as shared resource roots; normal projects are
 * tied to external worktree sessions. Skills auto-cascade from global → new projects.
 *
 * 🔴 All mutations use execTransaction() with checkpointAfterWrite() outside the txn.
 */
import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { logger } from "../logger.js";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import * as skills from "./skills.js";
/** List all projects, newest first. */
export function listProjects() {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
}
export const MAX_PROJECT_NAME_LENGTH = 64;
/** Names are identifiers, never paths. Keep this contract aligned with the extension resolver. */
export function isValidProjectName(value) {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_PROJECT_NAME_LENGTH &&
        value.trim().length > 0 && value === value.trim() && value !== "." && value !== ".." &&
        !/[\\/\u0000-\u001f\u007f]/.test(value);
}
function assertProjectName(name) {
    if (!isValidProjectName(name))
        throw new Error("Invalid project name");
}
function projectDirectory(name) {
    const base = resolve(process.env.INGENIUM_HOME ?? resolve(process.cwd(), ".ingenium"));
    const projectsBase = resolve(base, "projects");
    const candidate = resolve(projectsBase, name);
    if (!candidate.startsWith(projectsBase + sep))
        throw new Error("Project path escapes INGENIUM_HOME/projects");
    return candidate;
}
export function createProject(name, isGlobal = false) {
    assertProjectName(name);
    // Idempotent: return existing project on container restart
    const existing = getProject(name);
    if (existing)
        return existing;
    const project = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        const id = randomUUID();
        const projectPath = projectDirectory(name);
        if (!existsSync(projectPath)) {
            mkdirSync(projectPath, { recursive: true });
        }
        if (isGlobal)
            db.prepare("UPDATE projects SET is_global = 0, updated_at = ? WHERE is_global = 1").run(now);
        db.prepare(`INSERT INTO projects (id, name, path, is_global, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`).run(id, name, projectPath, isGlobal ? 1 : 0, now, now);
        // Auto-load global skills into new project
        const globalProject = db.prepare("SELECT * FROM projects WHERE is_global = 1").get();
        if (globalProject && globalProject.id !== id) {
            const count = skills.copySkills(globalProject.id, id);
            if (count > 0) {
                logger.info("projects", `Auto-loaded ${count} global skill(s) into project "${name}"`);
            }
        }
        return db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    });
    checkpointAfterWrite();
    return project;
}
/**
 * Soft-delete a project by setting archived_at.
 * Archived projects are excluded from the active list but can be restored.
 * Returns false if the project doesn't exist or is already archived.
 */
export function archiveProject(name) {
    assertProjectName(name);
    const changed = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const existing = db.prepare("SELECT * FROM projects WHERE name = ? AND archived_at IS NULL").get(name);
        if (!existing)
            return false;
        const now = new Date().toISOString();
        db.prepare("UPDATE projects SET archived_at = ? WHERE name = ?").run(now, name);
        return true;
    });
    if (changed)
        checkpointAfterWrite();
    return changed;
}
/** Restore a previously archived project by clearing its archived_at timestamp. */
export function unarchiveProject(name) {
    assertProjectName(name);
    const changed = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const existing = db.prepare("SELECT * FROM projects WHERE name = ? AND archived_at IS NOT NULL").get(name);
        if (!existing)
            return false;
        db.prepare("UPDATE projects SET archived_at = NULL WHERE name = ?").run(name);
        return true;
    });
    if (changed)
        checkpointAfterWrite();
    return changed;
}
/** List archived projects, newest-archived first. */
export function listArchivedProjects() {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM projects WHERE archived_at IS NOT NULL ORDER BY archived_at DESC").all();
}
/**
 * Permanently delete projects whose archived_at is older than retentionDays.
 * This is the only hard-delete path — used by the scheduled purge job.
 * Returns the number of projects deleted.
 */
export function purgeExpiredProjects(retentionDays) {
    const deleted = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
        const candidates = db.prepare("SELECT id FROM projects WHERE archived_at IS NOT NULL AND archived_at < ?").all(cutoff);
        let deletedCount = 0;
        for (const candidate of candidates) {
            if (projectChildTables(db, candidate.id).length > 0)
                continue;
            deletedCount += db.prepare("DELETE FROM projects WHERE id = ?").run(candidate.id).changes;
        }
        return deletedCount;
    });
    if (deleted > 0)
        checkpointAfterWrite();
    return deleted;
}
function projectChildTables(db, projectId) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'projects'").all();
    return tables.flatMap(({ name }) => {
        const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all();
        if (!columns.some((column) => column.name === "project_id"))
            return [];
        const count = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)} WHERE project_id = ?`).get(projectId);
        return count.count > 0 ? [name] : [];
    });
}
export function deleteProject(name) {
    assertProjectName(name);
    const result = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const project = db.prepare("SELECT id FROM projects WHERE name = ?").get(name);
        if (!project)
            return { status: "not_found" };
        const childTables = projectChildTables(db, project.id);
        if (childTables.length > 0)
            return { status: "has_children", childTables };
        db.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
        return { status: "deleted" };
    });
    if (result.status === "deleted")
        checkpointAfterWrite();
    return result;
}
/** Look up a project by name (case-sensitive). Returns undefined if not found. */
export function getProject(name) {
    if (!isValidProjectName(name))
        return undefined;
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM projects WHERE name = ?").get(name);
}
/** Rename a project. Returns the updated project, or undefined if not found. */
export function updateProject(currentName, newName) {
    assertProjectName(currentName);
    assertProjectName(newName);
    const project = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const existing = db.prepare("SELECT * FROM projects WHERE name = ?").get(currentName);
        if (!existing)
            return undefined;
        const now = new Date().toISOString();
        // Names are validated identifiers. Renames intentionally do not move or create
        // filesystem paths; this avoids operating on any legacy/untrusted path value.
        const newPath = projectDirectory(newName);
        db.prepare("UPDATE projects SET name = ?, path = ?, updated_at = ? WHERE name = ?").run(newName, newPath, now, currentName);
        return db.prepare("SELECT * FROM projects WHERE id = ?").get(existing.id);
    });
    if (project)
        checkpointAfterWrite();
    return project;
}
/**
 * Toggle a project's global flag. When isGlobal=true, the project's skills/plugins
 * become the shared baseline for all other projects. Only one project should be
 * global at a time (not enforced here — UI layer manages this).
 */
export function setProjectGlobal(name, isGlobal) {
    assertProjectName(name);
    const changed = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const existing = db.prepare("SELECT * FROM projects WHERE name = ?").get(name);
        if (!existing)
            return false;
        const now = new Date().toISOString();
        if (isGlobal)
            db.prepare("UPDATE projects SET is_global = 0, updated_at = ? WHERE is_global = 1").run(now);
        db.prepare("UPDATE projects SET is_global = ?, updated_at = ? WHERE name = ?").run(isGlobal ? 1 : 0, now, name);
        return true;
    });
    if (changed)
        checkpointAfterWrite();
    return changed;
}
/** Get the single global project (is_global=1, not archived). There should be at most one. */
export function getGlobalProject() {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM projects WHERE is_global = 1 AND archived_at IS NULL LIMIT 1").get();
}
const WORKSPACE_PROJECT = "/workspace";
const REQUIRED_WORKSPACE_SKILLS = 10;
function sha256(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}
function quoteIdentifier(identifier) {
    return `"${identifier.replace(/"/g, '""')}"`;
}
/**
 * Move the historical DB-only /workspace project into global-default.
 * This intentionally never reads, renames, or deletes the /workspace filesystem path.
 */
export function migrateWorkspaceProject(dryRun = false) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const source = db.prepare("SELECT * FROM projects WHERE name = ?").get(WORKSPACE_PROJECT);
    if (!source)
        return { migrated: false, dryRun, sourceSkillCount: 0, sourceHashes: [], movedChildRows: {}, collisions: [] };
    const sourceSkills = db.prepare("SELECT id, name, content FROM skills WHERE project_id = ? ORDER BY name").all(source.id);
    const sourceHashes = sourceSkills.map((skill) => ({ name: skill.name, sha256: sha256(skill.content) }));
    if (sourceSkills.length !== REQUIRED_WORKSPACE_SKILLS) {
        throw new Error(`Refusing /workspace migration: source skill count mismatch (expected=${REQUIRED_WORKSPACE_SKILLS}, found=${sourceSkills.length}, project_id=${source.id})`);
    }
    let global = db.prepare("SELECT * FROM projects WHERE name = 'global-default'").get();
    if (!global && dryRun) {
        global = { ...source, id: "dry-run-global-default", name: "global-default", is_global: true };
    }
    if (!global)
        global = createProject("global-default", true);
    const childTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
        .map(({ name }) => name)
        .filter((name) => name !== "projects" && name !== "project_migration_manifests")
        .filter((name) => db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all().some((column) => column.name === "project_id"));
    const movedChildRows = {};
    for (const table of childTables) {
        movedChildRows[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE project_id = ?`).get(source.id).count;
    }
    const collisions = sourceSkills.flatMap((skill) => {
        const destination = db.prepare("SELECT 1 FROM skills WHERE project_id = ? AND name = ?").get(global.id, skill.name);
        if (!destination)
            return [];
        return [{ name: skill.name, destinationName: `migrated-${sha256(skill.content).slice(0, 16)}`, sha256: sha256(skill.content) }];
    });
    const result = { migrated: false, dryRun, sourceSkillCount: sourceSkills.length, sourceHashes, movedChildRows, collisions };
    if (dryRun)
        return result;
    const manifestId = randomUUID();
    const now = new Date().toISOString();
    // Durable audit precedes data movement; it contains names and hashes only, never skill content.
    execTransaction(() => {
        db.prepare("INSERT INTO project_migration_manifests (id, source_project_id, destination_project_id, source_skill_count, source_hashes, child_counts, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?, ?)")
            .run(manifestId, source.id, global.id, sourceSkills.length, JSON.stringify(sourceHashes), JSON.stringify(movedChildRows), now, now);
    });
    checkpointAfterWrite();
    execTransaction(() => {
        for (const collision of collisions) {
            db.prepare("UPDATE skills SET name = ? WHERE project_id = ? AND name = ?").run(collision.destinationName, source.id, collision.name);
        }
        for (const table of childTables) {
            db.prepare(`UPDATE ${quoteIdentifier(table)} SET project_id = ? WHERE project_id = ?`).run(global.id, source.id);
        }
        for (const sourceSkill of sourceSkills) {
            const migratedSkill = db.prepare("SELECT content FROM skills WHERE id = ? AND project_id = ?").get(sourceSkill.id, global.id);
            if (!migratedSkill || sha256(migratedSkill.content) !== sha256(sourceSkill.content)) {
                throw new Error(`Refusing /workspace project deletion: skill hash verification failed for '${sourceSkill.name}'`);
            }
        }
        for (const collision of collisions) {
            const target = db.prepare("SELECT id FROM skills WHERE project_id = ? AND name = ?").get(global.id, collision.destinationName);
            db.prepare("INSERT INTO skill_lineage (project_id, source_project_id, source_name, target_skill_id, source_hash, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
                .run(global.id, source.id, collision.name, target.id, collision.sha256, "workspace-project-migration collision rename", now, now);
        }
        const remaining = childTables.reduce((total, table) => total + db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE project_id = ?`).get(source.id).count, 0);
        if (remaining !== 0)
            throw new Error("Refusing /workspace project deletion: child rows remain");
        const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
        if (fkViolations.length !== 0)
            throw new Error("Refusing /workspace project deletion: foreign-key check failed");
        db.prepare("DELETE FROM projects WHERE id = ?").run(source.id);
        db.prepare("UPDATE project_migration_manifests SET status = 'completed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), manifestId);
    });
    checkpointAfterWrite();
    return { ...result, migrated: true, manifestId };
}
/**
 * Get a comprehensive project snapshot for the dashboard: project metadata,
 * skill count + recent skills, observation stats + recent observations,
 * recent pipeline events, and the latest synthesis timestamp.
 *
 * Runs 9 independent SELECT queries — acceptable for the dashboard use case
 * but not suitable for high-frequency API endpoints.
 */
export function getProjectDetail(name) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const project = db.prepare("SELECT * FROM projects WHERE name = ?").get(name);
    if (!project)
        return undefined;
    const skillsCount = db.prepare("SELECT COUNT(*) as c FROM skills WHERE project_id = ? AND enabled = 1").get(project.id);
    const recentSkills = db.prepare("SELECT name, description, created_at FROM skills WHERE project_id = ? AND enabled = 1 ORDER BY created_at DESC LIMIT 5").all(project.id);
    const obsTotal = db.prepare("SELECT COUNT(*) as c FROM observations WHERE project_id = ?").get(project.id);
    const obsPending = db.prepare("SELECT COUNT(*) as c FROM observations WHERE project_id = ? AND status != 'processed'").get(project.id);
    const obsProcessed = db.prepare("SELECT COUNT(*) as c FROM observations WHERE project_id = ? AND status = 'processed'").get(project.id);
    const recentObs = db.prepare("SELECT observation_type, content, created_at FROM observations WHERE project_id = ? ORDER BY created_at DESC LIMIT 5").all(project.id);
    const pipeline = db.prepare("SELECT event_type, title, created_at FROM pipeline_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 5").all(project.id);
    const latestSynth = db.prepare("SELECT created_at FROM pipeline_events WHERE project_id = ? AND event_type = 'synthesis_completed' ORDER BY created_at DESC LIMIT 1").get(project.id);
    return {
        project,
        skills_count: skillsCount.c,
        recent_skills: recentSkills,
        observation_stats: {
            total: obsTotal.c,
            pending: obsPending.c,
            processed: obsProcessed.c,
            recent: recentObs,
        },
        pipeline,
        latest_synthesis: latestSynth?.created_at ?? null,
        latest_synthesis_result: null,
    };
}
