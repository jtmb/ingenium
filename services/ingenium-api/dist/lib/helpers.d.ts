import { Request, Response } from "express";
/**
 * Resolve a project name to its UUID, or null if the project doesn't exist.
 * Projects MUST be created explicitly via POST /api/v1/projects or the dashboard.
 */
export declare function resolveProjectId(name: string): string | null;
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
export declare function requireProject(req: Request, res: Response): string | null;
//# sourceMappingURL=helpers.d.ts.map