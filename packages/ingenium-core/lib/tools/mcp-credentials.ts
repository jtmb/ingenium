import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { hashSecurityToken } from "./authentication.js";

export type McpCredentialKind = "service" | "runtime" | "repository-sync";
export type McpCredentialAudience = "mcp" | "runtime" | "repository-sync";

export interface McpCredential {
  id: string;
  servicePrincipalId: string;
  kind: McpCredentialKind;
  audience: McpCredentialAudience;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  organizationId: string;
  projectId: string;
  projectIds: string[];
  projectName: string;
  workspaceId: string;
  launcherWorktree: string;
  storageMappingHash: string;
  securityEpoch: number;
  expiresAt: string;
  revokedAt: string | null;
  rotatedToId: string | null;
  lastUsedAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface CreateMcpCredentialInput {
  servicePrincipalId?: string;
  servicePrincipalName?: string;
  kind: McpCredentialKind;
  audience: McpCredentialAudience;
  name: string;
  scopes: string[];
  organizationId: string;
  projectId: string;
  projectIds?: string[];
  workspaceId: string;
  launcherWorktree: string;
  expiresAt: Date;
  createdByUserId: string;
}

type CredentialRow = {
  id: string; service_principal_id: string; kind: McpCredentialKind; audience: McpCredentialAudience;
  name: string; token_prefix: string; scopes_json: string; organization_id: string; project_id: string;
  project_grants_json: string; project_name: string; workspace_id: string; launcher_worktree: string;
  storage_mapping_hash: string;
  security_epoch: number; expires_at: string; revoked_at: string | null; rotated_to_id: string | null;
  last_used_at: string | null; created_by_user_id: string; created_at: string;
};

const SELECT_CREDENTIAL = `SELECT mcp_credentials.id, mcp_credentials.service_principal_id, mcp_credentials.kind,
  mcp_credentials.audience, mcp_credentials.name, mcp_credentials.token_prefix, mcp_credentials.scopes_json,
  mcp_credentials.organization_id, mcp_credentials.project_id, mcp_credentials.project_grants_json,
  projects.name AS project_name, mcp_credentials.workspace_id, mcp_credentials.launcher_worktree,
  authorized_workspaces.storage_mapping_hash,
  mcp_credentials.security_epoch, mcp_credentials.expires_at, mcp_credentials.revoked_at,
  mcp_credentials.rotated_to_id, mcp_credentials.last_used_at, mcp_credentials.created_by_user_id,
  mcp_credentials.created_at FROM mcp_credentials JOIN projects ON projects.id = mcp_credentials.project_id
  JOIN authorized_workspaces ON authorized_workspaces.id = mcp_credentials.workspace_id`;

function normalizeText(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function normalizeScopes(scopes: string[]): string[] {
  const normalized = [...new Set(scopes)].sort();
  if (normalized.length < 1 || normalized.length > 64
    || normalized.some((scope) => !/^[a-z][a-z0-9:._-]{0,127}$/.test(scope))) throw new Error("Invalid credential scopes");
  return normalized;
}

function normalizeWorktree(worktree: string): string {
  const normalized = normalizeText(worktree, 1024, "launcher worktree");
  if (!normalized.startsWith("/") || normalized.includes("/../") || normalized.endsWith("/..")) throw new Error("Invalid launcher worktree");
  return normalized;
}

function expectedAudience(kind: McpCredentialKind): McpCredentialAudience {
  return kind === "repository-sync" ? "repository-sync" : kind === "runtime" ? "runtime" : "mcp";
}

function validateLeastPrivilege(kind: McpCredentialKind, scopes: readonly string[]): void {
  if (kind === "repository-sync" && (scopes.length !== 2
    || !scopes.includes("repository:sync") || !scopes.includes("projects:read"))) {
    throw new Error("Repository sync credentials require only repository:sync and projects:read");
  }
  if (kind === "runtime" && !scopes.includes("child-mcp:runtime")) throw new Error("Runtime credentials require child-mcp:runtime");
}

function projectGrants(input: CreateMcpCredentialInput): string[] {
  const grants = [...new Set(input.projectIds ?? [input.projectId])].sort();
  if (grants.length < 1 || grants.length > 32 || !grants.includes(input.projectId)) throw new Error("Invalid project grants");
  return grants;
}

function toCredential(row: CredentialRow): McpCredential {
  return {
    id: row.id,
    servicePrincipalId: row.service_principal_id,
    kind: row.kind,
    audience: row.audience,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: JSON.parse(row.scopes_json) as string[],
    organizationId: row.organization_id,
    projectId: row.project_id,
    projectIds: JSON.parse(row.project_grants_json) as string[],
    projectName: row.project_name,
    workspaceId: row.workspace_id,
    launcherWorktree: row.launcher_worktree,
    storageMappingHash: row.storage_mapping_hash,
    securityEpoch: row.security_epoch,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    rotatedToId: row.rotated_to_id,
    lastUsedAt: row.last_used_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

function validateInput(input: CreateMcpCredentialInput): { scopes: string[]; grants: string[] } {
  if (input.audience !== expectedAudience(input.kind)) throw new Error("Credential audience does not match its kind");
  if (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now()) throw new Error("Credential expiry must be in the future");
  const scopes = normalizeScopes(input.scopes);
  validateLeastPrivilege(input.kind, scopes);
  normalizeText(input.name, 128, "credential name");
  normalizeText(input.workspaceId, 256, "workspace binding");
  normalizeWorktree(input.launcherWorktree);
  return { scopes, grants: projectGrants(input) };
}

export function createMcpCredential(input: CreateMcpCredentialInput): McpCredential & { token: string } {
  const { scopes, grants } = validateInput(input);
  const id = randomUUID();
  const tokenPrefix = `ing_${id.replaceAll("-", "").slice(0, 12)}`;
  const token = `${tokenPrefix}_${randomBytes(32).toString("base64url")}`;
  const created = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const servicePrincipalId = input.servicePrincipalId ?? insertServicePrincipal(db, input);
    return insertMcpCredential(db, { ...input, servicePrincipalId }, scopes, grants, id, tokenPrefix, token);
  });
  checkpointAfterWrite();
  return { ...created, token };
}

function insertServicePrincipal(db: Database.Database, input: CreateMcpCredentialInput): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO service_principals (id, organization_id, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
    .run(id, input.organizationId, normalizeText(input.servicePrincipalName ?? `MCP ${input.name}`, 128, "service principal name"), now, now);
  return id;
}

function insertMcpCredential(
  db: Database.Database,
  input: CreateMcpCredentialInput & { servicePrincipalId: string },
  scopes: string[],
  grants: string[],
  id: string,
  tokenPrefix: string,
  token: string,
): McpCredential {
  const principal = db.prepare(
    "SELECT security_epoch FROM service_principals WHERE id = ? AND organization_id = ? AND status = 'active'",
  ).get(input.servicePrincipalId, input.organizationId) as { security_epoch: number } | undefined;
  if (!principal) throw new Error("Service principal is unavailable");
  const placeholders = grants.map(() => "?").join(",");
  const validProjects = (db.prepare(
    `SELECT count(*) AS count FROM projects WHERE id IN (${placeholders}) AND organization_id = ? AND archived_at IS NULL`,
  ).get(...grants, input.organizationId) as { count: number }).count;
  if (validProjects !== grants.length) throw new Error("Credential project grant is unavailable");
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO mcp_credentials
    (id, service_principal_id, kind, audience, name, token_prefix, token_hash, scopes_json, organization_id,
     project_id, project_grants_json, workspace_id, launcher_worktree, security_epoch, expires_at, created_by_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.servicePrincipalId, input.kind, input.audience, normalizeText(input.name, 128, "credential name"),
      tokenPrefix, hashSecurityToken(token), JSON.stringify(scopes), input.organizationId, input.projectId,
      JSON.stringify(grants), normalizeText(input.workspaceId, 256, "workspace binding"),
      normalizeWorktree(input.launcherWorktree), principal.security_epoch, input.expiresAt.toISOString(),
      input.createdByUserId, createdAt);
  const runtimeSchema = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'authorized_workspaces'",
  ).get();
  if (runtimeSchema) {
    const workspace = db.prepare("SELECT * FROM authorized_workspaces WHERE id = ?").get(input.workspaceId) as {
      organization_id: string; project_id: string; owner_user_id: string; storage_path: string; security_epoch: number;
    } | undefined;
    if (!workspace) {
      const storagePath = normalizeWorktree(input.launcherWorktree);
      db.prepare(`INSERT INTO authorized_workspaces
        (id, organization_id, project_id, owner_user_id, storage_path, storage_mapping_hash, security_epoch, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.workspaceId, input.organizationId, input.projectId, input.createdByUserId, storagePath,
          createHash("sha256").update(`${input.workspaceId}\0${storagePath}`).digest("hex"), principal.security_epoch, createdAt, createdAt);
    } else if (workspace.organization_id !== input.organizationId || workspace.project_id !== input.projectId
      || workspace.owner_user_id !== input.createdByUserId || workspace.storage_path !== normalizeWorktree(input.launcherWorktree)
      || workspace.security_epoch !== principal.security_epoch) {
      throw new Error("Credential workspace binding is unavailable");
    }
  }
  return toCredential(db.prepare(`${SELECT_CREDENTIAL} WHERE mcp_credentials.id = ?`).get(id) as CredentialRow);
}

export function listMcpCredentials(userId: string): McpCredential[] {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `${SELECT_CREDENTIAL} WHERE mcp_credentials.created_by_user_id = ? ORDER BY mcp_credentials.created_at DESC LIMIT 100`,
  ).all(userId) as CredentialRow[]).map(toCredential);
}

export function resolveMcpCredential(token: string, audience: McpCredentialAudience, now = new Date()): McpCredential | undefined {
  if (!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  let hash: string;
  try { hash = hashSecurityToken(token); } catch { return undefined; }
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const timestamp = now.toISOString();
  const runtimeScope = audience === "runtime" ? `
      JOIN runtime_capability_bindings ON runtime_capability_bindings.mcp_credential_id = mcp_credentials.id
      JOIN runtime_instances ON runtime_instances.id = runtime_capability_bindings.runtime_id` : "";
  const runtimePredicate = audience === "runtime" ? `
      AND runtime_capability_bindings.revoked_at IS NULL AND runtime_capability_bindings.expires_at > ?
      AND runtime_instances.state IN ('PROVISIONING','STARTING','READY','IDLE')
      AND runtime_instances.organization_id = mcp_credentials.organization_id
      AND runtime_instances.project_id = mcp_credentials.project_id
      AND runtime_instances.owner_user_id = mcp_credentials.created_by_user_id
      AND runtime_instances.workspace_id = mcp_credentials.workspace_id
      AND runtime_instances.security_epoch = mcp_credentials.security_epoch
      AND runtime_capability_bindings.security_epoch = mcp_credentials.security_epoch
      AND authorized_workspaces.status = 'authorized'
      AND authorized_workspaces.security_epoch = mcp_credentials.security_epoch` : "";
  const row = db.prepare(`${SELECT_CREDENTIAL}${runtimeScope}
      JOIN service_principals ON service_principals.id = mcp_credentials.service_principal_id
      WHERE mcp_credentials.token_hash = ? AND mcp_credentials.audience = ? AND mcp_credentials.revoked_at IS NULL
        AND mcp_credentials.expires_at > ? AND service_principals.status = 'active'
        AND service_principals.security_epoch = mcp_credentials.security_epoch${runtimePredicate}`)
    .get(hash, audience, timestamp, ...(audience === "runtime" ? [timestamp] : [])) as CredentialRow | undefined;
  if (!row) return undefined;
  execTransaction(() => db.prepare("UPDATE mcp_credentials SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(now.toISOString(), row.id));
  checkpointAfterWrite();
  return toCredential({ ...row, last_used_at: now.toISOString() });
}

export function revokeMcpCredential(id: string, userId: string, now = new Date()): boolean {
  const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "UPDATE mcp_credentials SET revoked_at = ? WHERE id = ? AND created_by_user_id = ? AND revoked_at IS NULL",
  ).run(now.toISOString(), id, userId).changes === 1);
  if (changed) checkpointAfterWrite();
  return changed;
}

export function rotateMcpCredential(id: string, userId: string, expiresAt?: Date): McpCredential & { token: string } {
  const replacementId = randomUUID();
  const tokenPrefix = `ing_${replacementId.replaceAll("-", "").slice(0, 12)}`;
  const token = `${tokenPrefix}_${randomBytes(32).toString("base64url")}`;
  const replacement = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const current = db.prepare(
      `${SELECT_CREDENTIAL} WHERE mcp_credentials.id = ? AND mcp_credentials.created_by_user_id = ? AND mcp_credentials.revoked_at IS NULL`,
    ).get(id, userId) as CredentialRow | undefined;
    if (!current) throw new Error("Credential not found");
    const input: CreateMcpCredentialInput & { servicePrincipalId: string } = {
      servicePrincipalId: current.service_principal_id,
      kind: current.kind,
      audience: current.audience,
      name: current.name,
      scopes: JSON.parse(current.scopes_json) as string[],
      organizationId: current.organization_id,
      projectId: current.project_id,
      projectIds: JSON.parse(current.project_grants_json) as string[],
      workspaceId: current.workspace_id,
      launcherWorktree: current.launcher_worktree,
      expiresAt: expiresAt ?? new Date(current.expires_at),
      createdByUserId: userId,
    };
    const normalized = validateInput(input);
    const created = insertMcpCredential(db, input, normalized.scopes, normalized.grants, replacementId, tokenPrefix, token);
    if (db.prepare("UPDATE mcp_credentials SET revoked_at = ?, rotated_to_id = ? WHERE id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), replacementId, id).changes !== 1) throw new Error("Credential rotation conflict");
    return created;
  });
  checkpointAfterWrite();
  return { ...replacement, token };
}

export function incrementServicePrincipalSecurityEpoch(servicePrincipalId: string): number {
  const epoch = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    if (db.prepare("UPDATE service_principals SET security_epoch = security_epoch + 1, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), servicePrincipalId).changes !== 1) throw new Error("Service principal not found");
    return (db.prepare("SELECT security_epoch FROM service_principals WHERE id = ?").get(servicePrincipalId) as { security_epoch: number }).security_epoch;
  });
  checkpointAfterWrite();
  return epoch;
}
