import { Router } from "express";
import { projects } from "ingenium-core";

const CANONICAL_GLOBAL_PROJECT_NAME = "global-default";

function requireSafeProjectName(value: unknown, res: import("express").Response): value is string {
  if (!projects.isValidProjectName(value)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Project name must be a non-empty identifier (max 64 chars, no whitespace, separators, dot segments, or control characters)" } });
    return false;
  }
  return true;
}

function rejectGlobalProjectLifecycle(res: import("express").Response): void {
  res.status(403).json({
    error: {
      code: "GLOBAL_PROJECT_LIFECYCLE_FORBIDDEN",
      message: "Global project ownership is managed by the trusted server lifecycle",
    },
  });
}

function hasGlobalRole(name: string): boolean {
  return Boolean(projects.getProject(name)?.is_global);
}

/** Handles /api/v1/projects — project CRUD while trusted lifecycle owns global designation. */
export const projectsRouter = Router();

// NOTE: Literal-path sub-routes (/archive, /purge) are registered before /:name
// to avoid Express route capture.

projectsRouter.get("/", (_req, res) => {
  const list = projects.listProjects();
  res.json({ data: list });
});

projectsRouter.post("/", (req, res) => {
  const { name, is_global } = req.body;
  if (!requireSafeProjectName(name, res)) return;
  if (is_global !== undefined && typeof is_global !== "boolean") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "is_global must be a boolean when provided" } });
    return;
  }
  if (projects.getProject(name)) {
    res.status(409).json({ error: { code: "CONFLICT", message: `Project '${name}' already exists` } });
    return;
  }
  if (name === CANONICAL_GLOBAL_PROJECT_NAME || is_global === true) {
    rejectGlobalProjectLifecycle(res);
    return;
  }
  const project = projects.createProject(name);
  res.status(201).json({ data: project });
});

projectsRouter.patch("/:name", (req, res) => {
  const { name: newName } = req.body;
  if (!requireSafeProjectName(req.params.name, res) || !requireSafeProjectName(newName, res)) return;
  if (hasGlobalRole(req.params.name!) || newName === CANONICAL_GLOBAL_PROJECT_NAME) {
    rejectGlobalProjectLifecycle(res);
    return;
  }
  const updated = projects.updateProject(req.params.name!, newName);
  if (!updated) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Project '${req.params.name}' not found` } });
    return;
  }
  res.json({ data: updated });
});

projectsRouter.get("/archive", (_req, res) => {
  const list = projects.listArchivedProjects();
  res.json({ data: list });
});

projectsRouter.delete("/:name", (req, res) => {
  if (!requireSafeProjectName(req.params.name, res)) return;
  if (hasGlobalRole(req.params.name!)) {
    rejectGlobalProjectLifecycle(res);
    return;
  }
  const archived = projects.archiveProject(req.params.name!);
  if (!archived) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Project '${req.params.name}' not found or already archived` } });
    return;
  }
  res.status(200).json({ data: { archived: true } });
});

// Permanently deletes all project data — distinct from archive which is reversible
projectsRouter.delete("/:name/purge", (req, res) => {
  if (!requireSafeProjectName(req.params.name, res)) return;
  if (hasGlobalRole(req.params.name!)) {
    rejectGlobalProjectLifecycle(res);
    return;
  }
  const result = projects.deleteProject(req.params.name!);
  if (result.status === "not_found") {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
    return;
  }
  if (result.status === "has_children") {
    res.status(409).json({ error: { code: "PROJECT_HAS_CHILDREN", message: "Project has referenced data and cannot be permanently deleted", details: { child_tables: result.childTables } } });
    return;
  }
  res.status(204).send();
});

// Reverses an archive — only works for projects in archived state
projectsRouter.post("/:name/restore", (req, res) => {
  if (!requireSafeProjectName(req.params.name, res)) return;
  if (hasGlobalRole(req.params.name!)) {
    rejectGlobalProjectLifecycle(res);
    return;
  }
  const restored = projects.unarchiveProject(req.params.name!);
  if (!restored) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Archived project '${req.params.name}' not found` } });
    return;
  }
  res.json({ data: { restored: true } });
});

// Purges projects older than retentionDays — runs as scheduled cleanup, default 7 days
projectsRouter.post("/purge", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const retentionDays = Object.prototype.hasOwnProperty.call(body, "retention_days")
    ? body.retention_days
    : 7;
  if (!projects.isValidProjectRetentionDays(retentionDays)) {
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: `retention_days must be an integer between 0 and ${projects.MAX_PROJECT_RETENTION_DAYS}`,
      },
    });
    return;
  }
  const purged = projects.purgeExpiredProjects(retentionDays);
  res.json({ data: { purged_count: purged } });
});

projectsRouter.get("/:name/detail", (req, res) => {
  if (!requireSafeProjectName(req.params.name, res)) return;
  const detail = projects.getProjectDetail(req.params.name!);
  if (!detail) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
    return;
  }
  res.json({ data: detail });
});

projectsRouter.patch("/:name/global", (req, res) => {
  if (!requireSafeProjectName(req.params.name, res)) return;
  const { is_global } = req.body;
  if (is_global === undefined || typeof is_global !== "boolean") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "is_global (boolean) is required" } });
    return;
  }
  rejectGlobalProjectLifecycle(res);
});

/** DB-only repair for the historical invalid project. Never touches filesystem /workspace. */
projectsRouter.post("/migrate-workspace", (req, res) => {
  try {
    const result = projects.migrateWorkspaceProject(req.body?.dry_run === true);
    res.json({ data: result });
  } catch (error) {
    res.status(409).json({ error: { code: "MIGRATION_REFUSED", message: error instanceof Error ? error.message : String(error) } });
  }
});
