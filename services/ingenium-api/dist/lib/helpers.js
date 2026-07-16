import { projects } from "ingenium-core";
/**
 * Resolve a project name to its UUID, or null if the project doesn't exist.
 * Projects MUST be created explicitly via POST /api/v1/projects or the dashboard.
 */
export function resolveProjectId(name) {
    const existing = projects.getProject(name);
    return existing ? existing.id : null;
}
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
export function requireProject(req, res) {
    const name = req.query.project;
    if (!name) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "project query parameter is required. Create a project first." } });
        return null;
    }
    const id = resolveProjectId(name);
    if (!id) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Project '${name}' not found. Create it first via POST /api/v1/projects or the dashboard.` } });
        return null;
    }
    return id;
}
