import { Request, Response } from "express";
import { projects } from "ingenium-core";

/**
 * Express middleware helper that reads the `project` query parameter,
 * validates it exists, resolves it to a UUID, and returns 400/404 if invalid.
 *
 * HACK: Returns null instead of calling next(err) so route handlers can
 * early-return with a clean pattern:
 *
 *   const projectId = requireProject(req, res);
 *   if (!projectId) return;
 *
 * The project is passed as a query parameter (not a header or URL segment)
 * to keep routes flat and RESTful — every resource is scoped to a project
 * without deeply nested paths like /projects/:id/skills/:skillId.
 */
export function requireProject(req: Request, res: Response): string | null {
  const name = req.query.project as string | undefined;
  if (!projects.isValidProjectName(name)) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "project query parameter is required. Create a project first." } });
    return null;
  }
  const project = projects.getProject(name);
  if (!project || project.archived_at) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Project '${name}' not found. Create it first via POST /api/v1/projects or the dashboard.` } });
    return null;
  }
  return project.id;
}

/**
 * Resolve the sole active global project for server-owned resources.
 *
 * The caller's project query parameter is intentionally ignored. This keeps
 * shared resources such as backups in the canonical server namespace even
 * when a dashboard tab or MCP client still carries an external project
 * context in its URL/request.
 */
export function requireActiveGlobalProject(_req: Request, res: Response): { id: string; name: string } | null {
  try {
    const global = projects.getGlobalProject();
    if (!global) {
      res.status(503).json({
        error: {
          code: "GLOBAL_PROJECT_UNAVAILABLE",
          message: "The canonical active global project is not configured.",
        },
      });
      return null;
    }
    return { id: global.id, name: global.name };
  } catch {
    res.status(503).json({
      error: {
        code: "GLOBAL_PROJECT_UNAVAILABLE",
        message: "The canonical active global project is unavailable.",
      },
    });
    return null;
  }
}

export function requireGlobalProject(req: Request, res: Response): string | null {
  return requireActiveGlobalProject(req, res)?.id ?? null;
}
