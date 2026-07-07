import { projects } from "ingenium-core";
/**
 * Resolve a project name to its UUID, creating the project if it doesn't exist.
 * This lets API callers use friendly project names like `?project=test`
 * without needing to know the UUID.
 */
export function resolveProjectId(name) {
    const existing = projects.getProject(name);
    if (existing)
        return existing.id;
    const created = projects.createProject(name);
    return created.id;
}
