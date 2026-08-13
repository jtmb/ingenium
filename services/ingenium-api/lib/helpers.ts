import { Request, Response } from "express";
import { authorization, getDb, projects } from "ingenium-core";

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
  if (!req.authorizationPolicy) return project.id;
  const principal = req.principal;
  if (!principal) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication is required" } });
    return null;
  }
  const permission = req.authorizationPolicy?.permission ?? "read";
  const resource = req.authorizationPolicy?.resource ?? "projects";
  const decision = authorization.requireProjectPermission({
    type: principal.type === "user" ? (principal.session ? "browser-user" : "user-token") : principal.type === "service" ? "service-principal" : principal.type,
    id: principal.id,
    scopes: principal.scopes,
    organizationId: "organizationId" in principal ? principal.organizationId : undefined,
    projectId: "projectId" in principal ? principal.projectId : undefined,
  }, project.id, resource, permission);
  if (!decision.allowed) {
    res.status(decision.visible ? 403 : 404).json({ error: { code: decision.visible ? "FORBIDDEN" : "NOT_FOUND", message: decision.visible ? "The authenticated principal cannot perform this action" : "Resource not found" } });
    return null;
  }
  return project.id;
}

export function requestContentActor(req: Request, projectId: string): { organizationId: string; ownerUserId: string | null } | null {
  const project = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT organization_id FROM projects WHERE id = ? AND archived_at IS NULL",
  ).get(projectId) as { organization_id: string } | undefined;
  if (!project) return null;
  return {
    organizationId: project.organization_id,
    ownerUserId: req.principal?.type === "user" ? req.principal.id : null,
  };
}

export function requestAuthorizationPrincipal(req: Request): authorization.AuthorizationPrincipal {
  const principal = req.principal;
  if (!principal) return { type: "compatibility", id: "direct-router", scopes: ["*"] };
  return {
    type: principal.type === "user" ? (principal.session ? "browser-user" : "user-token") : principal.type === "service" ? "service-principal" : principal.type,
    id: principal.id,
    scopes: principal.scopes,
    organizationId: "organizationId" in principal ? principal.organizationId : undefined,
    projectId: "projectId" in principal ? principal.projectId : undefined,
  };
}

export function requireContentAccess(
  req: Request,
  res: Response,
  scope: authorization.ContentScope,
): boolean {
  if (!req.authorizationPolicy) return true;
  const decision = authorization.requireContentPermission(
    requestAuthorizationPrincipal(req),
    scope,
    req.authorizationPolicy.permission,
  );
  if (decision.allowed) return true;
  res.status(decision.visible ? 403 : 404).json({
    error: {
      code: decision.visible ? "FORBIDDEN" : "NOT_FOUND",
      message: decision.visible ? "The authenticated principal cannot perform this action" : "Resource not found",
    },
  });
  return false;
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
