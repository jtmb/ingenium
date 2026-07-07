import { Request, Response } from "express";
/**
 * Resolve a project name to its UUID, or null if the project doesn't exist.
 * Projects MUST be created explicitly via POST /api/v1/projects or the dashboard.
 */
export declare function resolveProjectId(name: string): string | null;
/**
 * Express middleware helper that reads the `project` query parameter,
 * validates it exists, resolves it to a UUID, and returns 400/404 if invalid.
 * Call this at the top of every route handler that needs a project:
 *
 *   const projectId = requireProject(req, res);
 *   if (!projectId) return;
 */
export declare function requireProject(req: Request, res: Response): string | null;
//# sourceMappingURL=helpers.d.ts.map