import type { RequestPrincipal } from "../middleware/auth.js";
import { authorization, getDb, skills, isInstallationStorageProject } from "ingenium-core";
import { requireProject } from "../helpers.js";
import { toAuthorizationPrincipal } from "../authorization-policy.js";
import { createCustomizeRouter } from "../customize-v2/router.js";
import { createProjectCatalogAuthority } from "../customize-v2/project-authority.js";
import type { CustomizeContext, CustomizeAuthority } from "../customize-v2/catalog-service.js";

/** Read-only catalog composition; existing lifecycle routes retain all writes. */
export function createHostedCustomizeRouter() {
  const principals = new WeakMap<CustomizeContext, RequestPrincipal>();
  const isSystem = (context: CustomizeContext) => Boolean(isInstallationStorageProject(context.projectId)&&getDb().prepare("SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL").get(context.projectId));
  const canRead: CustomizeAuthority["authorize"] = (context, action, kind, visibility, resourceId) => {
    const principal = principals.get(context);
    if (!principal || principal.id !== context.actorId || action !== "read" || !["plugin", "skill"].includes(kind)
      || !(visibility === "project" || visibility === "system" && isSystem(context))) return false;
    const resource = kind === "skill" ? "skills" : "plugins";
    const decision = authorization.requireProjectPermission(toAuthorizationPrincipal(principal), context.projectId, resource, "read");
    if (!decision.allowed) return false;
    if (resourceId !== undefined) {
      const sql = kind === "skill" ? "SELECT 1 FROM skills WHERE id=? AND project_id=? AND archived_at IS NULL" : "SELECT 1 FROM plugins WHERE id=? AND project_id=?";
      if (!getDb().prepare(sql).get(resourceId, context.projectId)) return false;
    }
    return true;
  };
  const base = createProjectCatalogAuthority(canRead, skills.listSkillRecords);
  const authority: CustomizeAuthority = {
    ...base,
    authorize: canRead,
    scopes: context => isSystem(context) ? ["project", "system"] : ["project"],
    installed: (context, kind) => base.installed(context, kind, "project"),
    discover: (context, kind, visibility) => visibility === "system" ? base.installed(context, kind, "project") : base.discover(context, kind, visibility),
  };
  return createCustomizeRouter({ authority, resolveContext(req, res) {
    if (!req.principal || !["user", "service", "compatibility"].includes(req.principal.type)) return null;
    const projectId = requireProject(req, res);
    if (!projectId) return null;
    const context = Object.freeze({ actorId: req.principal.id, projectId });
    principals.set(context, req.principal);
    return context;
  } });
}
