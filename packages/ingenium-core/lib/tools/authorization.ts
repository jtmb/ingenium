import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import type { OrganizationRole, Project, ProjectRole } from "../schema.js";

export type AuthorizationPermission = "read" | "write" | "admin" | "execute";

export interface AuthorizationPrincipal {
  type: "browser-user" | "user-token" | "service-principal" | "runtime-service" | "compatibility";
  id: string;
  scopes: readonly string[];
  organizationId?: string | null;
  projectId?: string | null;
}

export interface AuthorizationDecision {
  allowed: boolean;
  visible: boolean;
  organizationId?: string;
  projectId?: string;
}

export type ResourceOwnerKind = "user" | "organization";
export type OwnedResourceType = "vault_folder" | "vault_item" | "provider_connection" | "mail_account";

export interface OwnedResource {
  resourceType: OwnedResourceType;
  resourceId: string;
  organizationId: string;
  ownerKind: ResourceOwnerKind;
  ownerUserId?: string | null;
}

export interface ResourceAuditEventInput {
  organizationId?: string | null;
  projectId?: string | null;
  resourceType: "vault" | OwnedResourceType;
  resourceId?: string | null;
  action: string;
  actorType: "compatibility" | "user" | "service" | "system";
  actorId?: string | null;
  outcome: "success" | "denied" | "failure";
  requestId?: string | null;
}

function scopeAllows(scopes: readonly string[], resource: string, permission: AuthorizationPermission): boolean {
  return scopes.some((scope) => scope === "*" || scope === "user:*" || scope === `${resource}:*`
    || scope === `${resource}:${permission}` || (permission === "read" && scope === `${resource}:write`)
    || (permission !== "admin" && scope === `${resource}:admin`));
}

export function isInstallationAdmin(userId: string): boolean {
  return Boolean(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT 1 FROM installation_admins WHERE user_id = ?",
  ).get(userId));
}

export function requireInstallationPermission(
  principal: AuthorizationPrincipal,
  resource: string,
  permission: AuthorizationPermission,
): AuthorizationDecision {
  if (principal.type === "compatibility") return { allowed: true, visible: true };
  if (principal.type === "runtime-service") {
    return { allowed: scopeAllows(principal.scopes, resource, permission), visible: true };
  }
  if (principal.type === "service-principal") return { allowed: false, visible: true };
  const allowed = isInstallationAdmin(principal.id) && scopeAllows(principal.scopes, resource, permission);
  return { allowed, visible: true };
}

function organizationMembership(userId: string, organizationId: string): OrganizationRole | undefined {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT role FROM organization_memberships
     WHERE organization_id = ? AND user_id = ? AND status = 'active'`,
  ).get(organizationId, userId) as { role: OrganizationRole } | undefined)?.role;
}

export function requireOrganizationPermission(
  principal: AuthorizationPrincipal,
  organizationId: string,
  resource: string,
  permission: AuthorizationPermission,
): AuthorizationDecision {
  if (principal.type === "compatibility") return { allowed: true, visible: true, organizationId };
  if (principal.organizationId && principal.organizationId !== organizationId) return { allowed: false, visible: false };
  if (!scopeAllows(principal.scopes, resource, permission)) return { allowed: false, visible: true, organizationId };
  if (principal.type === "service-principal" || principal.type === "runtime-service") {
    return { allowed: principal.organizationId === organizationId, visible: principal.organizationId === organizationId, organizationId };
  }
  const role = organizationMembership(principal.id, organizationId);
  if (!role) return { allowed: false, visible: false };
  const allowed = role === "owner" || role === "admin"
    || ((role === "member" || role === "viewer") && permission === "read");
  return { allowed, visible: true, organizationId };
}

function projectAccess(userId: string, projectId: string): { organizationId: string; organizationRole?: OrganizationRole; projectRole?: ProjectRole } | undefined {
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT projects.organization_id AS organizationId, organization_memberships.role AS organizationRole,
            project_memberships.role AS projectRole
     FROM projects
     LEFT JOIN organization_memberships ON organization_memberships.organization_id = projects.organization_id
       AND organization_memberships.user_id = ? AND organization_memberships.status = 'active'
     LEFT JOIN project_memberships ON project_memberships.project_id = projects.id AND project_memberships.user_id = ?
     WHERE projects.id = ? AND projects.archived_at IS NULL`,
  ).get(userId, userId, projectId) as { organizationId: string; organizationRole?: OrganizationRole; projectRole?: ProjectRole } | undefined;
}

export function requireProjectPermission(
  principal: AuthorizationPrincipal,
  projectId: string,
  resource: string,
  permission: AuthorizationPermission,
): AuthorizationDecision {
  const project = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT id, organization_id FROM projects WHERE id = ? AND archived_at IS NULL",
  ).get(projectId) as { id: string; organization_id: string } | undefined;
  if (!project) return { allowed: false, visible: false };
  if (principal.type === "compatibility") return { allowed: true, visible: true, projectId, organizationId: project.organization_id };
  if (principal.projectId && principal.projectId !== projectId) return { allowed: false, visible: false };
  if (principal.organizationId && principal.organizationId !== project.organization_id) return { allowed: false, visible: false };
  if (principal.type === "service-principal" || principal.type === "runtime-service") {
    const visible = principal.projectId === projectId || (!principal.projectId && principal.organizationId === project.organization_id);
    return { allowed: visible && scopeAllows(principal.scopes, resource, permission), visible, projectId, organizationId: project.organization_id };
  }
  const access = projectAccess(principal.id, projectId);
  if (!access?.organizationRole) return { allowed: false, visible: false };
  const organizationWide = access.organizationRole === "owner" || access.organizationRole === "admin";
  const visible = organizationWide || access.projectRole !== undefined;
  if (!visible) return { allowed: false, visible: false };
  const roleAllows = organizationWide
    || (permission === "read" && access.projectRole !== undefined)
    || (access.organizationRole !== "viewer" && access.projectRole === "editor" && (permission === "write" || permission === "execute"));
  return {
    allowed: roleAllows && scopeAllows(principal.scopes, resource, permission),
    visible: true,
    projectId,
    organizationId: access.organizationId,
  };
}

export function requireProjectLifecyclePermission(
  principal: AuthorizationPrincipal,
  projectId: string,
): AuthorizationDecision {
  const project = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT id, organization_id FROM projects WHERE id = ?",
  ).get(projectId) as { id: string; organization_id: string } | undefined;
  if (!project) return { allowed: false, visible: false };
  if (principal.type === "compatibility") return { allowed: true, visible: true, projectId, organizationId: project.organization_id };
  if (principal.projectId && principal.projectId !== projectId) return { allowed: false, visible: false };
  if (principal.organizationId && principal.organizationId !== project.organization_id) return { allowed: false, visible: false };
  const organization = requireOrganizationPermission(principal, project.organization_id, "projects", "admin");
  return organization.allowed
    ? { ...organization, projectId }
    : organization;
}

export const requireProjectAccess = requireProjectPermission;

export function listAuthorizedProjects(principal: AuthorizationPrincipal, archived = false): Project[] {
  const archivePredicate = archived ? "archived_at IS NOT NULL" : "archived_at IS NULL";
  if (principal.type === "compatibility") {
    return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      `SELECT * FROM projects WHERE ${archivePredicate} ORDER BY created_at DESC`,
    ).all() as Project[];
  }
  if (principal.type === "service-principal" || principal.type === "runtime-service") {
    if (!scopeAllows(principal.scopes, "projects", "read")) return [];
    if (principal.projectId) return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      `SELECT * FROM projects WHERE id = ? AND ${archivePredicate}`,
    ).all(principal.projectId) as Project[];
    if (!principal.organizationId) return [];
    return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      `SELECT * FROM projects WHERE organization_id = ? AND ${archivePredicate} ORDER BY created_at DESC`,
    ).all(principal.organizationId) as Project[];
  }
  if (!scopeAllows(principal.scopes, "projects", "read")) return [];
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT DISTINCT projects.* FROM projects
     JOIN organization_memberships ON organization_memberships.organization_id = projects.organization_id
       AND organization_memberships.user_id = ? AND organization_memberships.status = 'active'
     LEFT JOIN project_memberships ON project_memberships.project_id = projects.id AND project_memberships.user_id = ?
     WHERE projects.${archivePredicate}
       AND (organization_memberships.role IN ('owner', 'admin') OR project_memberships.user_id IS NOT NULL)
     ORDER BY projects.created_at DESC`,
  ).all(principal.id, principal.id) as Project[];
}

export function requirePrivateResourceAccess(input: {
  principal: AuthorizationPrincipal;
  ownerUserId?: string | null;
  explicitlyShared?: boolean;
  breakGlass?: boolean;
}): boolean {
  if (input.principal.type === "compatibility") return true;
  if (input.breakGlass) return input.principal.type === "browser-user" && isInstallationAdmin(input.principal.id);
  return input.principal.type === "browser-user" || input.principal.type === "user-token"
    ? input.ownerUserId === input.principal.id || input.explicitlyShared === true
    : false;
}

function hasResourceGrant(
  principal: AuthorizationPrincipal,
  resource: OwnedResource,
  permission: AuthorizationPermission,
): boolean {
  const granteeKind = principal.type === "service-principal" || principal.type === "runtime-service" ? "service" : "user";
  const rows = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT permissions_json FROM resource_grants
     WHERE organization_id = ? AND resource_type = ? AND resource_id = ?
       AND grantee_kind = ? AND grantee_id = ? AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)`
  ).all(resource.organizationId, resource.resourceType, resource.resourceId, granteeKind, principal.id, new Date().toISOString()) as Array<{ permissions_json: string }>;
  return rows.some((row) => {
    try {
      const permissions = JSON.parse(row.permissions_json) as unknown;
      return Array.isArray(permissions) && permissions.some((candidate) => candidate === "*" || candidate === permission
        || (permission === "read" && candidate === "write") || (permission !== "admin" && candidate === "admin"));
    } catch {
      return false;
    }
  });
}

export function requireOwnedResourcePermission(
  principal: AuthorizationPrincipal,
  resource: OwnedResource,
  permission: AuthorizationPermission,
  options: { breakGlass?: boolean } = {},
): AuthorizationDecision {
  if (principal.type === "compatibility") return { allowed: true, visible: true, organizationId: resource.organizationId };
  if (principal.organizationId && principal.organizationId !== resource.organizationId) return { allowed: false, visible: false };
  if (options.breakGlass) {
    const allowed = principal.type === "browser-user" && isInstallationAdmin(principal.id);
    return { allowed, visible: allowed, organizationId: resource.organizationId };
  }
  if (!scopeAllows(principal.scopes, resource.resourceType, permission)
    && !scopeAllows(principal.scopes, resource.resourceType.split("_")[0]!, permission)) {
    return { allowed: false, visible: true, organizationId: resource.organizationId };
  }
  if (resource.ownerKind === "user") {
    const owner = (principal.type === "browser-user" || principal.type === "user-token")
      && resource.ownerUserId === principal.id;
    const granted = hasResourceGrant(principal, resource, permission);
    return { allowed: owner || granted, visible: owner || granted, organizationId: resource.organizationId };
  }
  return requireOrganizationPermission(principal, resource.organizationId, resource.resourceType.split("_")[0]!, permission);
}

export function insertResourceAuditEvent(input: ResourceAuditEventInput): string {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const id = randomUUID();
  const inserted = db.prepare(
    `INSERT INTO resource_audit_events
     (id, organization_id, project_id, resource_type, resource_id, action, actor_type, actor_id, outcome, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).run(id, input.organizationId ?? null, input.projectId ?? null, input.resourceType, input.resourceId ?? null,
    input.action, input.actorType, input.actorId ?? null, input.outcome, input.requestId ?? null, new Date().toISOString());
  if (inserted.changes === 1 || !input.requestId) return id;
  return (db.prepare(
    `SELECT id FROM resource_audit_events
     WHERE request_id = ? AND action = ? AND resource_type = ? AND COALESCE(resource_id, '') = COALESCE(?, '')`,
  ).get(input.requestId, input.action, input.resourceType, input.resourceId ?? null) as { id: string }).id;
}

export function appendResourceAuditEvent(input: ResourceAuditEventInput): string {
  const id = execTransaction(() => insertResourceAuditEvent(input));
  checkpointAfterWrite();
  return id;
}

export function createResourceGrant(input: {
  resource: OwnedResource;
  granteeKind: "user" | "service" | "installation";
  granteeId?: string | null;
  permissions: AuthorizationPermission[];
  actorType: "compatibility" | "user" | "service" | "system";
  actorId?: string | null;
  expiresAt?: string | null;
}): string {
  if (input.permissions.length === 0 || new Set(input.permissions).size !== input.permissions.length) {
    throw new Error("Resource grant requires unique permissions");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    db.prepare(
      `INSERT INTO resource_grants
       (id, organization_id, resource_type, resource_id, grantee_kind, grantee_id, permissions_json,
        granted_by_actor_type, granted_by_actor_id, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.resource.organizationId, input.resource.resourceType, input.resource.resourceId,
      input.granteeKind, input.granteeId ?? null, JSON.stringify(input.permissions), input.actorType,
      input.actorId ?? null, input.expiresAt ?? null, now, now);
  });
  checkpointAfterWrite();
  return id;
}
