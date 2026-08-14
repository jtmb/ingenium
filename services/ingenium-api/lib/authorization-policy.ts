import type { NextFunction, Request, Response } from "express";
import { authentication, authorization, projects, securityAudit } from "ingenium-core";
import { AppError } from "./middleware/errors.js";
import type { RequestPrincipal } from "./middleware/auth.js";

export type PolicyTarget = "installation" | "organization" | "project" | "private" | "public";
export type PolicyPermission = authorization.AuthorizationPermission;

export interface AuthorizationPolicy {
  action: string;
  resource: string;
  permission: PolicyPermission;
  target: PolicyTarget;
  sensitive?: boolean;
  stepUp?: boolean;
}

export interface AuthorizedProjectTarget {
  id: string;
  name: string;
  organizationId: string;
  archived: boolean;
  isGlobal: boolean;
}

export const PUBLIC_POLICY: AuthorizationPolicy = { action: "public.read", resource: "public", permission: "read", target: "public" };

const INSTALLATION_PREFIXES = [
  "/api/v1/backups", "/api/v1/logs", "/api/v1/services", "/api/v1/config",
  "/api/v1/opencode", "/api/v1/bootstrap",
];
const ADMIN_PROJECT_PREFIXES = ["/api/v1/mcp-tools", "/api/v1/mcp-servers"];
const INSTALLATION_PROJECT_PREFIXES = ["/api/v1/config"];
const PRIVATE_PREFIXES = ["/api/v1/context", "/api/v1/emails"];
const PROJECT_PREFIXES = [
  "/api/v1/skills", "/api/v1/tasks", "/api/v1/coordination", "/api/v1/context",
  "/api/v1/plugins", "/api/v1/servers", "/api/v1/settings", "/api/v1/agents",
  "/api/v1/observations", "/api/v1/personality", "/api/v1/pipeline", "/api/v1/emails",
  "/api/v1/commands", "/api/v1/extraction", "/api/v1/jobs", "/api/v1/dashboard",
  "/api/v1/repository", "/api/v1/rag", "/api/v1/usage", "/api/v1/synthesis",
];
const PUBLIC_AUTH_PATHS = new Set([
  "GET /api/v1/auth/csrf", "POST /api/v1/auth/login", "POST /api/v1/auth/mfa/challenge",
  "POST /api/v1/auth/password/forgot", "POST /api/v1/auth/password/reset", "POST /api/v1/auth/email/verify",
  "GET /api/v1/auth/invitations/preview", "GET /api/v1/auth/oidc/providers", "POST /api/v1/auth/oidc/start", "GET /api/v1/auth/oidc/callback",
]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function permissionFor(req: Request): PolicyPermission {
  if (READ_METHODS.has(req.method)) return "read";
  if (/\/(run|sync|execute|test|connect|disconnect|prompt|command|abort|compact|fork|revert|unrevert)(?:\/|$)/.test(req.path)) return "execute";
  if (req.method === "DELETE" || /\/(purge|restore|global|authorize|approve|rollback|recover)(?:\/|$)/.test(req.path)) return "admin";
  return "write";
}

function resourceFor(path: string): string {
  const segment = path.replace(/^\/(?:_ingenium\/)?(?:api\/v1\/)?/, "").split("/")[0];
  return segment || "api";
}

export function policyForRequest(req: Pick<Request, "method" | "path">): AuthorizationPolicy | undefined {
  const route = `${req.method} ${req.path}`;
  if ((req.method === "GET" && req.path === "/auth/callback") || PUBLIC_AUTH_PATHS.has(route)) return PUBLIC_POLICY;
  if (req.path === "/api/v1/health") return { action: "health.read", resource: "health", permission: "read", target: "installation" };
  if (req.path.startsWith("/_ingenium/")) return { action: "child-mcp.execute", resource: "child-mcp", permission: "execute", target: "project", sensitive: true };
  if (req.path.startsWith("/api/v1/auth/")) return { action: `auth.${permissionFor(req as Request)}`, resource: "auth", permission: permissionFor(req as Request), target: "private", sensitive: !READ_METHODS.has(req.method) };
  if (req.path.startsWith("/api/v1/organizations")) {
    const permission = permissionFor(req as Request);
    return { action: `organizations.${permission}`, resource: "organizations", permission, target: "organization", sensitive: permission !== "read", stepUp: permission === "admin" };
  }
  if (req.path.startsWith("/api/v1/projects/migrate-workspace") || req.path.startsWith("/api/v1/projects/purge")) {
    return { action: "projects.admin", resource: "projects", permission: "admin", target: "installation", sensitive: true, stepUp: true };
  }
  if (req.path.startsWith("/api/v1/projects")) {
    const permission = permissionFor(req as Request);
    const collection = req.method === "GET" && (req.path === "/api/v1/projects" || req.path === "/api/v1/projects/archive");
    return { action: `projects.${permission}`, resource: "projects", permission, target: collection || (req.method === "POST" && req.path === "/api/v1/projects") ? "organization" : "project", sensitive: permission === "admin", stepUp: permission === "admin" };
  }
  if (req.path.startsWith("/api/v1/synthesis/cross-project")) return { action: "synthesis.execute", resource: "synthesis", permission: "execute", target: "installation", sensitive: true };
  if (/^\/api\/v1\/jobs\/runs\/[^/]+\/logs$/.test(req.path)) {
    return { action: "jobs.raw-logs.read", resource: "jobs", permission: "read", target: "installation", sensitive: true };
  }
  if (req.path.startsWith("/api/v1/settings/provider-configs") || req.path.startsWith("/api/v1/settings/llm-config")) {
    const permission = permissionFor(req as Request);
    return { action: `providers.${permission}`, resource: "providers", permission, target: "installation", sensitive: true };
  }
  if (/^\/api\/v1\/opencode\/(integrations|integration-attempts|auth)(?:\/|$)/.test(req.path)) {
    const permission = permissionFor(req as Request);
    return { action: `providers.${permission}`, resource: "providers", permission, target: "installation", sensitive: true };
  }
  if (req.path === "/api/v1/docs/repository/sync") return { action: "repository.sync", resource: "repository", permission: "execute", target: "project", sensitive: true };
  if (req.method === "GET" && (req.path === "/api/v1/mcp-tools" || req.path === "/api/v1/mcp-tools/catalog")) {
    return { action: "projects.read", resource: "projects", permission: "read", target: "project" };
  }
  if (req.method === "GET" && /^\/api\/v1\/mcp-tools\/[^/]+\/state$/.test(req.path)) {
    return { action: "projects.read", resource: "projects", permission: "read", target: "project" };
  }
  if (req.path.startsWith("/api/v1/docs")) {
    const permission = permissionFor(req as Request);
    return { action: `docs.${permission}`, resource: "docs", permission, target: "organization", sensitive: permission !== "read" };
  }
  if (PRIVATE_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    const permission = permissionFor(req as Request);
    return { action: `${resourceFor(req.path)}.${permission}`, resource: resourceFor(req.path), permission, target: "private", sensitive: true };
  }
  if (req.path.startsWith("/api/v1/vault")) {
    const permission = permissionFor(req as Request);
    return { action: `${resourceFor(req.path)}.${permission}`, resource: resourceFor(req.path), permission, target: "project", sensitive: true };
  }
  if (INSTALLATION_PROJECT_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    const permission = permissionFor(req as Request);
    return { action: `${resourceFor(req.path)}.${permission}`, resource: resourceFor(req.path), permission, target: "installation", sensitive: permission !== "read", stepUp: permission === "admin" };
  }
  if (INSTALLATION_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    const permission = permissionFor(req as Request);
    return { action: `${resourceFor(req.path)}.${permission}`, resource: resourceFor(req.path), permission, target: "installation", sensitive: permission !== "read", stepUp: permission === "admin" };
  }
  if (ADMIN_PROJECT_PREFIXES.some((prefix) => req.path.startsWith(prefix)) || PROJECT_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    const permission = permissionFor(req as Request);
    return { action: `${resourceFor(req.path)}.${permission}`, resource: resourceFor(req.path), permission, target: "project", sensitive: permission !== "read" };
  }
  return undefined;
}

export function toAuthorizationPrincipal(principal: RequestPrincipal): authorization.AuthorizationPrincipal {
  return {
    type: principal.type === "user" ? (principal.session ? "browser-user" : "user-token") : principal.type === "service" ? "service-principal" : principal.type,
    id: principal.id,
    scopes: principal.scopes,
    organizationId: "organizationId" in principal ? principal.organizationId : undefined,
    projectId: "projectId" in principal ? principal.projectId : undefined,
    projectIds: "projectIds" in principal ? principal.projectIds : undefined,
  };
}

export const authorizationPrincipal = toAuthorizationPrincipal;

function requestedOrganizationId(req: Request, principal: RequestPrincipal): string | undefined {
  const organizationPathId = req.path.startsWith("/api/v1/organizations/") ? req.path.slice("/api/v1/organizations/".length).split("/")[0] : undefined;
  const bodyOrganizationId = req.body && typeof req.body === "object" && typeof (req.body as Record<string, unknown>).organization_id === "string"
    ? (req.body as Record<string, string>).organization_id : undefined;
  const value = req.params.organizationId ?? req.params.orgId ?? organizationPathId ?? (typeof req.query.organization_id === "string" ? req.query.organization_id : undefined) ?? bodyOrganizationId;
  if (value) return value;
  return "organizationId" in principal && principal.organizationId ? principal.organizationId : undefined;
}

function requestedProject(req: Request): { id: string; organizationId: string } | undefined {
  const projectPathName = req.path.startsWith("/api/v1/projects/") ? req.path.slice("/api/v1/projects/".length).split("/")[0] : undefined;
  const name = projectPathName ?? req.params.name ?? (typeof req.query.project === "string" ? req.query.project : undefined);
  if (!name || !projects.isValidProjectName(name)) return undefined;
  const project = projects.getProject(name);
  return project && !project.archived_at ? { id: project.id, organizationId: project.organization_id } : undefined;
}

function projectLifecycleTarget(req: Request): AuthorizedProjectTarget | undefined {
  if (!req.path.startsWith("/api/v1/projects/")) return undefined;
  const name = req.path.slice("/api/v1/projects/".length).split("/")[0];
  if (!projects.isValidProjectName(name)) return undefined;
  const project = projects.getProject(name);
  if (!project) return undefined;
  return { id: project.id, name: project.name, organizationId: project.organization_id, archived: Boolean(project.archived_at), isGlobal: Boolean(project.is_global) };
}

export function authorizeProjectRestoreTarget(principal: RequestPrincipal, name: string): AuthorizedProjectTarget | undefined {
  if (!projects.isValidProjectName(name)) return undefined;
  const target = projects.getProject(name);
  if (!target || !target.archived_at) return undefined;
  const decision = authorization.requireProjectLifecyclePermission(toAuthorizationPrincipal(principal), target.id);
  if (!decision.allowed) return undefined;
  return { id: target.id, name: target.name, organizationId: target.organization_id, archived: true, isGlobal: Boolean(target.is_global) };
}

function audit(principal: RequestPrincipal, policy: AuthorizationPolicy, outcome: "success" | "denied", decision?: authorization.AuthorizationDecision): void {
  if (!policy.sensitive && outcome === "success") return;
  try {
    securityAudit.appendSecurityAuditEvent({
      actorType: principal.type === "runtime-service" ? "system" : principal.type,
      actorId: principal.id,
      action: policy.action,
      organizationId: decision?.organizationId,
      projectId: decision?.projectId,
      outcome,
    });
  } catch {
    throw new AppError("Authorization audit failed", "AUTHORIZATION_AUDIT_FAILED", 503);
  }
}

export function authorizationMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const policy = policyForRequest(req);
  if (!policy) throw new AppError("No authorization policy is registered for this route", "AUTHORIZATION_POLICY_MISSING", 403);
  req.authorizationPolicy = policy;
  if (policy.target === "public") return next();
  if (!req.principal) throw new AppError("Authentication is required", "UNAUTHORIZED", 401);
  if (req.principal.type === "compatibility") {
    audit(req.principal, policy, "success");
    return next();
  }
  const servicePreflight = req.method === "GET" && req.path === "/api/v1/auth/preflight";
  if (req.principal.type === "service" && req.principal.audience === "repository-sync" && !servicePreflight
    && policy.resource !== "repository" && policy.resource !== "repository-sync" && policy.resource !== "projects"
    && policy.resource !== "mcp-tools" && policy.resource !== "docs" && policy.resource !== "child-mcp") {
    throw new AppError("The authenticated principal cannot perform this action", "FORBIDDEN", 403);
  }
  const principal = toAuthorizationPrincipal(req.principal);
  let decision: authorization.AuthorizationDecision;
  if (policy.target === "installation" || policy.target === "private") {
    decision = authorization.requireInstallationPermission(principal, policy.resource, policy.permission);
    if (policy.target === "private" && req.path.startsWith("/api/v1/auth/") && req.principal.type === "user" && req.principal.session) decision = { allowed: true, visible: true };
    if (policy.target === "private" && req.principal.type === "user" && !req.principal.session
      && req.method === "GET" && req.path === "/api/v1/auth/preflight") {
      decision = req.principal.scopes.includes("auth:preflight") || req.principal.scopes.includes("auth:*")
        ? { allowed: true, visible: true }
        : { allowed: false, visible: true };
    }
    if (policy.target === "private" && req.principal.type === "service" && servicePreflight) {
      decision = req.principal.scopes.includes("projects:read") || req.principal.scopes.includes("projects:*")
        || req.principal.scopes.includes("*")
        ? { allowed: true, visible: true }
        : { allowed: false, visible: true };
    }
    if (policy.target === "private" && !req.path.startsWith("/api/v1/auth/")) {
      const browserUser = principal.type === "browser-user";
      decision = { allowed: browserUser, visible: browserUser };
    }
  } else if (policy.target === "organization") {
    const organizationId = requestedOrganizationId(req, req.principal);
    decision = !organizationId && req.principal.type === "user" && req.method === "GET" && (req.path === "/api/v1/projects" || req.path === "/api/v1/projects/archive" || req.path === "/api/v1/organizations")
      ? { allowed: true, visible: true }
      : !organizationId && req.principal.type === "user" && req.principal.session && req.method === "POST" && req.path === "/api/v1/organizations"
      ? { allowed: true, visible: true }
      : organizationId
      ? authorization.requireOrganizationPermission(principal, organizationId, policy.resource, policy.permission)
      : authorization.requireInstallationPermission(principal, policy.resource, policy.permission);
  } else {
    const lifecycle = policy.resource === "projects" && policy.permission === "admin" ? projectLifecycleTarget(req) : undefined;
    if (lifecycle) req.authorizedProjectTarget = lifecycle;
    const project = lifecycle ?? requestedProject(req);
    decision = lifecycle
      ? authorization.requireProjectLifecyclePermission(principal, lifecycle.id)
      : project
      ? authorization.requireProjectPermission(principal, project.id, policy.resource, policy.permission)
      : { allowed: req.path === "/api/v1/projects" && req.method === "GET", visible: req.path === "/api/v1/projects" && req.method === "GET" };
  }
  if (decision.allowed && policy.stepUp && req.principal.type === "user" && req.principal.session
    && !authentication.hasRecentStepUp(req.principal.session)) decision = { ...decision, allowed: false };
  if (!decision.allowed) {
    audit(req.principal, policy, "denied", decision);
    throw new AppError(decision.visible ? "The authenticated principal cannot perform this action" : "Resource not found", decision.visible ? "FORBIDDEN" : "NOT_FOUND", decision.visible ? 403 : 404);
  }
  audit(req.principal, policy, "success", decision);
  next();
}

export function assertAuthorizationPolicyCoverage(paths: readonly string[]): void {
  for (const value of paths) {
    const [method, path] = value.split(" ", 2);
    if (!method || !path || !policyForRequest({ method, path } as Pick<Request, "method" | "path">)) throw new Error(`Missing authorization policy: ${value}`);
  }
}

declare global {
  namespace Express {
    interface Request {
      authorizationPolicy?: AuthorizationPolicy;
      authorizedProjectTarget?: AuthorizedProjectTarget;
    }
  }
}
