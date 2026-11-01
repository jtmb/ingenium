import { Router } from "express";
import { authorization, projects, authentication, isInstallationStorageProject } from "ingenium-core";
import { authorizeProjectRestoreTarget,toAuthorizationPrincipal } from "../authorization-policy.js";
import {createPositivePluginProjectionOwner,createCapturedProjectRestoreOwner,PluginProjectionTransitionRequired} from "ingenium-core/lib/tools/plugin-projection-transition";
import {randomUUID} from "node:crypto";
import {authenticateRequestWithoutActivity} from "../middleware/auth.js";
import {csrfMiddleware} from "../middleware/csrf.js";
import {AppError} from "../middleware/errors.js";

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
  const project=projects.getProject(name);return !!project&&isInstallationStorageProject(project.id);
}

/** Handles /api/v1/projects — project CRUD while trusted lifecycle owns global designation. */
export const projectsRouter = Router();

// NOTE: Literal-path sub-routes (/archive, /purge) are registered before /:name
// to avoid Express route capture.

projectsRouter.get("/", (req, res) => {
  const principal = req.principal ?? { type: "compatibility" as const, id: "legacy-server-bearer" as const, scopes: ["legacy:*"] as const };
  const list = authorization.listAuthorizedProjects({
    type: principal.type === "user" ? (principal.session ? "browser-user" : "user-token") : principal.type === "service" ? "service-principal" : principal.type,
    id: principal.id,
    scopes: principal.scopes,
    organizationId: "organizationId" in principal ? principal.organizationId : undefined,
    projectId: "projectId" in principal ? principal.projectId : undefined,
    projectIds: "projectIds" in principal ? principal.projectIds : undefined,
  });
  res.json({ data: list });
});

projectsRouter.post("/", (req, res) => {
  const { name, is_global, organization_id } = req.body;
  if (req.principal?.type === "service" && !req.principal.scopes.includes("projects:create")) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "The authenticated principal cannot perform this action" } });
    return;
  }
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
  const existedBeforeCreate=projects.getProject(name);
  const creator=req.principal?.type==="user"?toAuthorizationPrincipal(req.principal):undefined;
  const initializerSessionId=req.principal?.type==="user"?req.principal.session?.id:undefined;
  const project = projects.createProject(name, false, typeof organization_id === "string" ? organization_id : undefined,creator);
  if(!existedBeforeCreate&&creator?.type==="browser-user"){
    const assertInitializerCurrent=()=>{authenticateRequestWithoutActivity(req);csrfMiddleware(req,res,()=>{});const p=req.principal;if(p?.type!=="user"||!p.session||p.id!==creator.id||p.session.id!==initializerSessionId)throw new AppError("Authentication is required","UNAUTHORIZED",401);};
    assertInitializerCurrent();
    try{const owner=createPositivePluginProjectionOwner(creator,assertInitializerCurrent),review=owner.review("fresh-project",project.id,"new-empty");
    const receipt=owner.apply({operationId:randomUUID(),mode:"fresh-project",projectId:project.id,configOrigin:"new-empty",reviewSha256:review.reviewSha256});
    assertInitializerCurrent();if(receipt.outcome!=="succeeded"){res.status(503).json({data:project,error:{code:"PROJECT_NAMESPACE_INITIALIZATION_UNCONFIRMED",message:"Project data is retained; inspect its original initialization before plugin use"},original:receipt});return;}}catch(e){assertInitializerCurrent();res.status(503).json({data:project,error:{code:"PROJECT_NAMESPACE_INITIALIZATION_REFUSED",message:"Project data is retained; review its namespace before plugin use",reason:e instanceof Error&&/^[A-Z][A-Z0-9_]{1,120}$/.test(e.message)?e.message:"PRIVATE_OWNER_REVIEW_REQUIRED"}});return;}
  }
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

projectsRouter.get("/archive", (req, res) => {
  const principal = req.principal ?? { type: "compatibility" as const, id: "legacy-server-bearer" as const, scopes: ["legacy:*"] as const };
  const list = authorization.listAuthorizedProjects({
    type: principal.type === "user" ? (principal.session ? "browser-user" : "user-token") : principal.type === "service" ? "service-principal" : principal.type,
    id: principal.id,
    scopes: principal.scopes,
    organizationId: "organizationId" in principal ? principal.organizationId : undefined,
    projectId: "projectId" in principal ? principal.projectId : undefined,
    projectIds: "projectIds" in principal ? principal.projectIds : undefined,
  }, true);
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
  let target = req.authorizedProjectTarget;
  if (!target && req.principal) {
    target = authorizeProjectRestoreTarget(req.principal, req.params.name!);
  }
  if (!target && !req.principal) {
    const project = projects.getProject(req.params.name!);
    if (project) target = { id: project.id, name: project.name, organizationId: project.organization_id, archived: project.archived_at!==null, isGlobal: isInstallationStorageProject(project.id) };
  }
  if (!target || target.name !== req.params.name || !target.archived) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
    return;
  }
  if (target.isGlobal) {
    rejectGlobalProjectLifecycle(res);
    return;
  }
  let restored:boolean;
  try{restored=projects.unarchiveProjectById(target.id);}catch(error){
    if(!(error instanceof PluginProjectionTransitionRequired))throw error;
    const original=req.principal;if(original?.type!=="user"||!original.session)throw new AppError("A browser session is required to restore this project","UNAUTHORIZED",401);
    const actor=original.id,sessionId=original.session.id,principal=toAuthorizationPrincipal(original),projectId=target.id;
    const current=()=>{authenticateRequestWithoutActivity(req);csrfMiddleware(req,res,()=>{});const p=req.principal;if(p?.type!=="user"||!p.session||p.id!==actor||p.session.id!==sessionId)throw new AppError("Authentication is required","UNAUTHORIZED",401);if(!authentication.hasRecentStepUp(p.session))throw new AppError("Recent authentication is required","STEP_UP_REQUIRED",403);};
    current();const operationId=req.body?.operationId??randomUUID();if(typeof operationId!=="string"||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(operationId))throw new AppError("Invalid restore operation","VALIDATION_ERROR",422);
    const owner=createCapturedProjectRestoreOwner(principal,current),review=owner.review(projectId),receipt=owner.apply({operationId,projectId,reviewSha256:review.reviewSha256});current();res.json({data:{restored:true,namespace_setup_required:true,plugins_activated:false},original:receipt});return;
  }
  if (!restored) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
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
