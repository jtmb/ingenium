import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import type { EffectiveProjectAccess, OrganizationRole, ProjectRole } from "../schema.js";

export const BOOTSTRAP_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000093";

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
}

export interface OrganizationMember {
  organizationId: string;
  userId: string;
  email: string;
  displayName: string;
  role: OrganizationRole;
  status: "active" | "suspended";
}

export function getOrganization(organizationId: string): OrganizationSummary | undefined {
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT id, name, slug, status FROM organizations WHERE id = ?",
  ).get(organizationId) as OrganizationSummary | undefined;
}

export function getOrganizationRole(organizationId: string, userId: string): OrganizationRole | undefined {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT role FROM organization_memberships
     WHERE organization_id = ? AND user_id = ? AND status = 'active'`,
  ).get(organizationId, userId) as { role: OrganizationRole } | undefined)?.role;
}

export function listUserOrganizations(userId: string): OrganizationSummary[] {
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT organizations.id, organizations.name, organizations.slug, organizations.status
     FROM organizations JOIN organization_memberships ON organization_memberships.organization_id = organizations.id
     WHERE organization_memberships.user_id = ? AND organization_memberships.status = 'active'
     ORDER BY organizations.name, organizations.id`,
  ).all(userId) as OrganizationSummary[];
}

export function listOrganizationMembers(organizationId: string): OrganizationMember[] {
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT organization_memberships.organization_id AS organizationId,
            organization_memberships.user_id AS userId, users.email_normalized AS email,
            users.display_name AS displayName, organization_memberships.role, organization_memberships.status
     FROM organization_memberships JOIN users ON users.id = organization_memberships.user_id
     WHERE organization_memberships.organization_id = ?
     ORDER BY users.email_normalized, users.id`,
  ).all(organizationId) as OrganizationMember[];
}

export function setOrganizationMemberRole(organizationId: string, userId: string, role: OrganizationRole): boolean {
  const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "UPDATE organization_memberships SET role = ?, updated_at = ? WHERE organization_id = ? AND user_id = ?",
  ).run(role, new Date().toISOString(), organizationId, userId).changes === 1);
  if (changed) checkpointAfterWrite();
  return changed;
}

export function removeOrganizationMember(organizationId: string, userId: string): boolean {
  const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "DELETE FROM organization_memberships WHERE organization_id = ? AND user_id = ?",
  ).run(organizationId, userId).changes === 1);
  if (changed) checkpointAfterWrite();
  return changed;
}

export function listProjectMembers(projectId: string): Array<{ userId: string; email: string; displayName: string; role: ProjectRole }> {
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT project_memberships.user_id AS userId, users.email_normalized AS email,
            users.display_name AS displayName, project_memberships.role
     FROM project_memberships JOIN users ON users.id = project_memberships.user_id
     WHERE project_memberships.project_id = ? ORDER BY users.email_normalized, users.id`,
  ).all(projectId) as Array<{ userId: string; email: string; displayName: string; role: ProjectRole }>;
}

export function removeProjectMember(projectId: string, userId: string): boolean {
  const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "DELETE FROM project_memberships WHERE project_id = ? AND user_id = ?",
  ).run(projectId, userId).changes === 1);
  if (changed) checkpointAfterWrite();
  return changed;
}

export function addOrganizationMember(organizationId: string, userId: string, role: OrganizationRole): void {
  execTransaction(() => {
    const now = new Date().toISOString();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      `INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = excluded.updated_at`,
    ).run(organizationId, userId, role, now, now);
  });
  checkpointAfterWrite();
}

export function addProjectMember(projectId: string, userId: string, role: ProjectRole): void {
  execTransaction(() => {
    const now = new Date().toISOString();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      `INSERT INTO project_memberships (project_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`,
    ).run(projectId, userId, role, now, now);
  });
  checkpointAfterWrite();
}

export function createOrganization(name: string, slug: string): string {
  const normalizedName = name.trim();
  const normalizedSlug = slug.trim();
  if (normalizedName.length < 1 || normalizedName.length > 128 || !/^[a-z0-9-]{1,64}$/.test(normalizedSlug)) {
    throw new Error("Invalid organization");
  }
  const id = execTransaction(() => {
    const organizationId = randomUUID();
    const now = new Date().toISOString();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(organizationId, normalizedName, normalizedSlug, now, now);
    return organizationId;
  });
  checkpointAfterWrite();
  return id;
}

export function resolveProjectAccess(userId: string, projectId: string): EffectiveProjectAccess {
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT organization_memberships.role AS organization_role,
            project_memberships.role AS project_role
     FROM projects
     LEFT JOIN organization_memberships
       ON organization_memberships.organization_id = projects.organization_id
      AND organization_memberships.user_id = ?
      AND organization_memberships.status = 'active'
     LEFT JOIN project_memberships
       ON project_memberships.project_id = projects.id
      AND project_memberships.user_id = ?
     WHERE projects.id = ?`,
  ).get(userId, userId, projectId) as { organization_role: OrganizationRole | null; project_role: ProjectRole | null } | undefined;
  if (!row?.organization_role) return { canRead: false, canWrite: false };
  if (row.organization_role === "owner" || row.organization_role === "admin") return { canRead: true, canWrite: true };
  if (row.organization_role === "viewer") return { canRead: row.project_role !== null, canWrite: false };
  return { canRead: row.project_role !== null, canWrite: row.project_role === "editor" };
}
