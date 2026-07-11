import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { logger } from "../logger.js";
import { Project } from "../schema.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as skills from "./skills.js";

export function listProjects(): Project[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as Project[];
}

export function createProject(name: string, isGlobal = false): Project {
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
      `INSERT INTO projects (id, name, path, is_global, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, name, projectPath, isGlobal ? 1 : 0, now, now);
    checkpointAfterWrite();

    // Auto-load global skills into new project
    const globalProject = db.prepare("SELECT * FROM projects WHERE is_global = 1").get() as Project | undefined;
    if (globalProject && globalProject.id !== id) {
      const count = skills.copySkills(globalProject.id, id);
      if (count > 0) {
        logger.info("projects", `Auto-loaded ${count} global skill(s) into project "${name}"`);
      }
    }

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

export function deleteProject(name: string): boolean {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const existing = db.prepare("SELECT id FROM projects WHERE name = ?").get(name) as { id: string } | undefined;
  if (!existing) return false;
  db.prepare("DELETE FROM projects WHERE name = ?").run(name);
  checkpointAfterWrite();
  return true;
}

export function getProject(name: string): Project | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM projects WHERE name = ?").get(name) as Project | undefined;
}

export function updateProject(currentName: string, newName: string): Project | undefined {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM projects WHERE name = ?").get(currentName) as Project | undefined;
    if (!existing) return undefined;
    const now = new Date().toISOString();
    db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE name = ?").run(newName, now, currentName);
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM projects WHERE id = ?").get(existing.id) as Project;
  });
}

export function setProjectGlobal(name: string, isGlobal: boolean): boolean {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM projects WHERE name = ?").get(name) as Project | undefined;
    if (!existing) return false;
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE projects SET is_global = ?, updated_at = ? WHERE name = ?"
    ).run(isGlobal ? 1 : 0, now, name);
    checkpointAfterWrite();
    return true;
  });
}

export function getGlobalProject(): Project | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare(
    "SELECT * FROM projects WHERE is_global = 1 AND archived_at IS NULL LIMIT 1"
  ).get() as Project | undefined;
}

export interface ProjectDetail {
  project: Project;
  skills_count: number;
  recent_skills: Array<{ name: string; description: string; created_at: string }>;
  observation_stats: {
    total: number;
    pending: number;
    processed: number;
    recent: Array<{ observation_type: string; content: string; created_at: string }>;
  };
  pipeline: Array<{ event_type: string; title: string; created_at: string }>;
  latest_synthesis: string | null;
  latest_synthesis_result: unknown;
}

export function getProjectDetail(name: string): ProjectDetail | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");

  const project = db.prepare("SELECT * FROM projects WHERE name = ?").get(name) as Project | undefined;
  if (!project) return undefined;

  const skillsCount = db.prepare("SELECT COUNT(*) as c FROM skills WHERE project_id = ? AND enabled = 1").get(project.id) as { c: number };
  const recentSkills = db.prepare("SELECT name, description, created_at FROM skills WHERE project_id = ? AND enabled = 1 ORDER BY created_at DESC LIMIT 5").all(project.id) as Array<{ name: string; description: string; created_at: string }>;

  const obsTotal = db.prepare("SELECT COUNT(*) as c FROM observations WHERE project_id = ?").get(project.id) as { c: number };
  const obsPending = db.prepare("SELECT COUNT(*) as c FROM observations WHERE project_id = ? AND status != 'processed'").get(project.id) as { c: number };
  const obsProcessed = db.prepare("SELECT COUNT(*) as c FROM observations WHERE project_id = ? AND status = 'processed'").get(project.id) as { c: number };
  const recentObs = db.prepare("SELECT observation_type, content, created_at FROM observations WHERE project_id = ? ORDER BY created_at DESC LIMIT 5").all(project.id) as Array<{ observation_type: string; content: string; created_at: string }>;

  const pipeline = db.prepare("SELECT event_type, title, created_at FROM pipeline_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 5").all(project.id) as Array<{ event_type: string; title: string; created_at: string }>;

  const latestSynth = db.prepare("SELECT created_at FROM pipeline_events WHERE project_id = ? AND event_type = 'synthesis_completed' ORDER BY created_at DESC LIMIT 1").get(project.id) as { created_at: string } | undefined;

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
