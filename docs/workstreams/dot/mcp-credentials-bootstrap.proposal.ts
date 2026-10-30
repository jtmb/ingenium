import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { decryptAuthSecret, encryptAuthSecret, hashSecurityToken } from "./authentication.js";

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

export interface CreateMcpCredentialOptions {
  replaceRevokedReceipt?: boolean;
  /** Issue a new credential after expiry; never extend the old token's lifetime. */
  replaceExpiredReceipt?: boolean;
}

export interface ServiceCredentialIdentity {
  credentialId: string;
  authenticatedCredentialId: string;
  servicePrincipalId: string;
  audience: McpCredentialAudience;
  organizationId: string;
  projectId: string;
  workspaceId: string;
  launcherWorktree: string;
  storageMappingHash: string;
}

export type RepositorySyncCredential = McpCredential & { token: string };

export const REPOSITORY_SYNC_CREDENTIAL_TTL_MS = 15 * 60_000;
export const REPOSITORY_SYNC_SCOPES = ["projects:read", "repository:sync"] as const;

export class RepositorySyncCredentialUnavailableError extends Error {
  constructor() {
    super("Repository sync credential runtime is unavailable");
  }
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

function newCredentialToken(): { id: string; tokenPrefix: string; token: string } {
  const id = randomUUID();
  const tokenPrefix = `ing_${id.replaceAll("-", "").slice(0, 12)}`;
  return { id, tokenPrefix, token: `${tokenPrefix}_${randomBytes(32).toString("base64url")}` };
}

function matchesCredentialBinding(
  row: CredentialRow,
  input: CreateMcpCredentialInput,
  scopes: string[],
  grants: string[],
): boolean {
  return row.kind === input.kind && row.audience === input.audience && row.name === normalizeText(input.name, 128, "credential name")
    && row.scopes_json === JSON.stringify(scopes) && row.organization_id === input.organizationId
    && row.project_id === input.projectId && row.project_grants_json === JSON.stringify(grants)
    && row.workspace_id === normalizeText(input.workspaceId, 256, "workspace binding")
    && row.launcher_worktree === normalizeWorktree(input.launcherWorktree)
    && row.created_by_user_id === input.createdByUserId
    && (!input.servicePrincipalId || row.service_principal_id === input.servicePrincipalId);
}

export function createMcpCredential(
  input: CreateMcpCredentialInput,
  idempotencyKey?: string,
  options: CreateMcpCredentialOptions = {},
): McpCredential & { token: string } {
  const { scopes, grants } = validateInput(input);
  const { id, tokenPrefix, token } = newCredentialToken();
  // The first issuance owns expiry; retries must not extend credential lifetime.
  const requestHash = createHash("sha256").update(JSON.stringify([
    input.kind, input.audience, input.name, scopes, input.organizationId, input.projectId,
    grants, input.workspaceId, input.launcherWorktree, input.createdByUserId,
  ])).digest("hex");
  const encryptedToken = idempotencyKey ? encryptAuthSecret(token) : undefined;
  const created = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    if (idempotencyKey) {
      const receipt = db.prepare("SELECT request_hash, credential_id, encrypted_token FROM mcp_credential_receipts WHERE idempotency_key = ?")
        .get(idempotencyKey) as { request_hash: string; credential_id: string; encrypted_token: string } | undefined;
      if (receipt) {
        const row = db.prepare(`${SELECT_CREDENTIAL}
          JOIN service_principals principal ON principal.id = mcp_credentials.service_principal_id
          WHERE mcp_credentials.id = ?
            AND principal.organization_id = mcp_credentials.organization_id
            AND principal.status = 'active' AND principal.security_epoch = mcp_credentials.security_epoch
            AND authorized_workspaces.status = 'authorized'
            AND authorized_workspaces.organization_id = mcp_credentials.organization_id
            AND authorized_workspaces.project_id = mcp_credentials.project_id
            AND authorized_workspaces.owner_user_id = mcp_credentials.created_by_user_id
            AND authorized_workspaces.storage_path = mcp_credentials.launcher_worktree
            AND authorized_workspaces.security_epoch = mcp_credentials.security_epoch`)
          .get(receipt.credential_id) as CredentialRow | undefined;
        if (receipt.request_hash !== requestHash || !row || !matchesCredentialBinding(row, input, scopes, grants)) {
          throw new Error("Credential replay is unavailable");
        }
        const expiry = Date.parse(row.expires_at);
        const expired = expiry <= Date.now();
        if (!Number.isFinite(expiry) || (expired && !options.replaceExpiredReceipt)
          || (row.revoked_at && !options.replaceRevokedReceipt)) throw new Error("Credential replay is unavailable");
        if (!expired && !row.revoked_at) return { credential: toCredential(row), encryptedToken: receipt.encrypted_token };
        const credential = insertMcpCredential(db, {
          ...input,
          servicePrincipalId: row.service_principal_id,
          expiresAt: expired ? input.expiresAt : new Date(row.expires_at),
        }, scopes, grants, id, tokenPrefix, token);
        if (db.prepare(`UPDATE mcp_credential_receipts SET credential_id = ?, encrypted_token = ?
          WHERE idempotency_key = ? AND request_hash = ? AND credential_id = ?`)
          .run(id, encryptedToken!, idempotencyKey, requestHash, row.id).changes !== 1) {
          throw new Error("Credential replay is unavailable");
        }
        return { credential, encryptedToken: undefined };
      }
    }
    const servicePrincipalId = input.servicePrincipalId ?? insertServicePrincipal(db, input);
    const credential = insertMcpCredential(db, { ...input, servicePrincipalId }, scopes, grants, id, tokenPrefix, token);
    if (idempotencyKey) {
      db.prepare("INSERT INTO mcp_credential_receipts (idempotency_key, request_hash, credential_id, encrypted_token) VALUES (?, ?, ?, ?)")
        .run(idempotencyKey, requestHash, id, encryptedToken!);
    }
    return { credential, encryptedToken: undefined };
  });
  checkpointAfterWrite();
  return { ...created.credential, token: created.encryptedToken ? decryptAuthSecret(created.encryptedToken) : token };
}

export function issueRepositorySyncCredential(runtimeId: string, now = new Date()): RepositorySyncCredential {
  const timestamp = now.toISOString();
  const repositoryToken = newCredentialToken();
  const issued = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const scope = db.prepare(`SELECT runtime.organization_id, runtime.project_id, runtime.owner_user_id,
      runtime.workspace_id, runtime.absolute_expires_at, workspace.storage_path, workspace.storage_mapping_hash,
      binding.expires_at AS binding_expires_at, credential.expires_at AS capability_expires_at,
      credential.service_principal_id
      FROM runtime_instances runtime
      JOIN authorized_workspaces workspace
        ON workspace.id = runtime.workspace_id
       AND workspace.organization_id = runtime.organization_id
       AND workspace.project_id = runtime.project_id
       AND workspace.owner_user_id = runtime.owner_user_id
       AND workspace.security_epoch = runtime.security_epoch
       AND workspace.status = 'authorized'
      JOIN runtime_capability_bindings binding
        ON binding.runtime_id = runtime.id
       AND binding.organization_id = runtime.organization_id
       AND binding.project_id = runtime.project_id
       AND binding.owner_user_id = runtime.owner_user_id
       AND binding.workspace_id = runtime.workspace_id
       AND binding.security_epoch = runtime.security_epoch
       AND binding.revoked_at IS NULL AND binding.expires_at > ?
      JOIN mcp_credentials credential
        ON credential.id = binding.mcp_credential_id
       AND credential.organization_id = runtime.organization_id
       AND credential.project_id = runtime.project_id
       AND credential.workspace_id = runtime.workspace_id
       AND credential.created_by_user_id = runtime.owner_user_id
       AND credential.launcher_worktree = workspace.storage_path
       AND credential.security_epoch = runtime.security_epoch
       AND credential.kind = 'runtime' AND credential.audience = 'runtime'
       AND credential.revoked_at IS NULL AND credential.expires_at > ?
      JOIN service_principals principal
        ON principal.id = credential.service_principal_id
       AND principal.organization_id = runtime.organization_id
       AND principal.security_epoch = runtime.security_epoch
       AND principal.status = 'active'
      WHERE runtime.id = ? AND runtime.state IN ('READY', 'IDLE')
        AND runtime.absolute_expires_at IS NOT NULL AND runtime.absolute_expires_at > ?`)
      .get(timestamp, timestamp, runtimeId, timestamp) as {
        organization_id: string; project_id: string; owner_user_id: string; workspace_id: string;
        absolute_expires_at: string; storage_path: string; storage_mapping_hash: string;
        binding_expires_at: string; capability_expires_at: string; service_principal_id: string;
      } | undefined;
    if (!scope) throw new RepositorySyncCredentialUnavailableError();
    const expiresAt = new Date(Math.min(
      now.getTime() + REPOSITORY_SYNC_CREDENTIAL_TTL_MS,
      Date.parse(scope.absolute_expires_at),
      Date.parse(scope.binding_expires_at),
      Date.parse(scope.capability_expires_at),
    ));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      throw new RepositorySyncCredentialUnavailableError();
    }
    const base = {
      servicePrincipalId: scope.service_principal_id,
      organizationId: scope.organization_id,
      projectId: scope.project_id,
      workspaceId: scope.workspace_id,
      launcherWorktree: scope.storage_path,
      expiresAt,
      createdByUserId: scope.owner_user_id,
    };
    const repositorySync = insertMcpCredential(db, {
      ...base,
      kind: "repository-sync",
      audience: "repository-sync",
      name: `Repository sync lease ${runtimeId}`,
      scopes: [...REPOSITORY_SYNC_SCOPES],
    }, [...REPOSITORY_SYNC_SCOPES], [scope.project_id], repositoryToken.id,
    repositoryToken.tokenPrefix, repositoryToken.token);
    return repositorySync;
  });
  checkpointAfterWrite();
  return { ...issued, token: repositoryToken.token };
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
  return resolveMcpCredentialState(token, audience, now, true);
}

/** Preserve all credential/workspace checks without activity writes or checkpoints. */
export function inspectMcpCredential(token: string, audience: McpCredentialAudience, now = new Date()): McpCredential | undefined {
  return resolveMcpCredentialState(token, audience, now, false);
}

function resolveMcpCredentialState(token: string, audience: McpCredentialAudience, now: Date, touch: boolean): McpCredential | undefined {
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
  if (touch) {
    execTransaction(() => db.prepare("UPDATE mcp_credentials SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(now.toISOString(), row.id));
    checkpointAfterWrite();
  }
  return toCredential(touch ? { ...row, last_used_at: now.toISOString() } : row);
}

export function revokeMcpCredential(id: string, userId: string, now = new Date()): boolean {
  const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "UPDATE mcp_credentials SET revoked_at = ? WHERE id = ? AND created_by_user_id = ? AND revoked_at IS NULL",
  ).run(now.toISOString(), id, userId).changes === 1);
  if (changed) checkpointAfterWrite();
  return changed;
}

export function revokeOwnMcpCredential(input: ServiceCredentialIdentity, now = new Date()): boolean {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const credential = db.prepare(`SELECT credential.revoked_at
      FROM mcp_credentials credential
      JOIN authorized_workspaces workspace
        ON workspace.id = credential.workspace_id
       AND workspace.organization_id = credential.organization_id
       AND workspace.project_id = credential.project_id
       AND workspace.owner_user_id = credential.created_by_user_id
       AND workspace.storage_path = credential.launcher_worktree
       AND workspace.security_epoch = credential.security_epoch
       AND workspace.status = 'authorized'
      JOIN service_principals principal
        ON principal.id = credential.service_principal_id
       AND principal.organization_id = credential.organization_id
       AND principal.security_epoch = credential.security_epoch
       AND principal.status = 'active'
      WHERE credential.id = ? AND credential.id = ? AND credential.service_principal_id = ?
        AND credential.audience = ? AND credential.organization_id = ? AND credential.project_id = ?
        AND credential.workspace_id = ? AND credential.launcher_worktree = ?
        AND workspace.storage_mapping_hash = ?`)
      .get(input.credentialId, input.authenticatedCredentialId, input.servicePrincipalId, input.audience,
        input.organizationId, input.projectId, input.workspaceId, input.launcherWorktree,
        input.storageMappingHash) as { revoked_at: string | null } | undefined;
    if (!credential) return { matched: false, changed: false };
    if (credential.revoked_at) return { matched: true, changed: false };
    const changed = db.prepare("UPDATE mcp_credentials SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(now.toISOString(), input.credentialId).changes === 1;
    return { matched: changed, changed };
  });
  if (result.changed) checkpointAfterWrite();
  return result.matched;
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

// Append inside the existing mcp-credentials.ts owner, retaining its original private factories/imports.
// No legacy kind/audience union, table row, receipt, encryption key or workspace is rewritten.
export interface ManagedJobCredential {
  id:string;kind:"job-run";audience:"job-run";runId:string;attemptId:string;
  servicePrincipalId:string;organizationId:string;projectId:string;ownerUserId:string;
  workspaceId:string;storageMappingHash:string;securityEpoch:number;principalSecurityEpoch:number;
  scopes:string[];expiresAt:string;
}
function managedJobCredentialBinding(runId:string,attemptId?:string,now=new Date()) {
  const db=getDb(process.env.INGENIUM_CORE_DB_PATH),timestamp=now.toISOString();
  const row=db.prepare(`SELECT e.*,run.effective_service_principal_id,
      principal.security_epoch AS principal_epoch,workspace.security_epoch AS workspace_epoch
    FROM job_run_managed_execution e
    JOIN job_runs run ON run.id=e.run_id AND run.job_id=e.job_id AND run.project_id=e.project_id
      AND run.organization_id=e.organization_id AND run.status='running'
    JOIN service_principals principal ON principal.id=run.effective_service_principal_id
      AND principal.organization_id=e.organization_id AND principal.status='active'
    JOIN authorized_workspaces workspace ON workspace.id=e.workspace_id AND workspace.status='authorized'
      AND workspace.organization_id=e.organization_id AND workspace.project_id=e.project_id
      AND workspace.owner_user_id=e.owner_user_id AND workspace.storage_mapping_hash=e.binding_hash
      AND workspace.security_epoch=e.binding_epoch
    JOIN runtime_instances runtime ON runtime.id=e.runtime_id AND runtime.workspace_id=e.workspace_id
      AND runtime.organization_id=e.organization_id AND runtime.project_id=e.project_id
      AND runtime.owner_user_id=e.owner_user_id AND runtime.security_epoch=e.binding_epoch
      AND runtime.revision=e.runtime_revision AND runtime.backend_container_id=e.parent_container_id
      AND runtime.state IN ('READY','IDLE') AND runtime.absolute_expires_at>? AND runtime.idle_expires_at>?
    JOIN users owner ON owner.id=e.owner_user_id AND owner.status='active'
    JOIN organization_memberships member ON member.user_id=e.owner_user_id
      AND member.organization_id=e.organization_id AND member.status='active'
    LEFT JOIN project_memberships pm ON pm.project_id=e.project_id AND pm.user_id=e.owner_user_id
    WHERE e.run_id=? AND e.deadline_at>? AND e.phase IN ('prepared','create_intent','created','start_intent','running')
      AND (member.role IN ('owner','admin') OR pm.user_id IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM veyra_dot_records op WHERE op.kind='operation'
        AND json_extract(op.body,'$.runId')=e.run_id AND json_extract(op.body,'$.state')='cancel_requested')
    `).get(timestamp,timestamp,runId,timestamp) as Record<string,unknown>|undefined;
  if(!row||attemptId!==undefined&&row.attempt_id!==attemptId)return undefined;
  const granted=db.prepare(`SELECT 1 FROM job_runs run JOIN jobs job ON job.id=run.job_id AND job.project_id=run.project_id
    JOIN projects project ON project.id=run.project_id AND project.organization_id=run.organization_id AND project.archived_at IS NULL
    JOIN automation_principal_grants grant_row ON grant_row.project_id=run.project_id AND grant_row.organization_id=run.organization_id
      AND grant_row.service_principal_id=run.effective_service_principal_id AND grant_row.permission='execute' AND grant_row.status='active'
    WHERE run.id=? AND run.job_revision=job.revision AND job.service_principal_id=run.effective_service_principal_id
      AND run.authorization_revision=grant_row.revision`).get(runId);
  if(!granted)return undefined;
  const a=JSON.parse(String(row.admission_json));
  if(!Array.isArray(a.approvedScopes)||!a.approvedScopes.length||a.approvedScopes.length>64||a.approvedScopes.some((scope:unknown)=>typeof scope!=="string"||!/^[a-z][a-z0-9:._-]{0,127}$/.test(scope)||scope==="child-mcp:runtime"))return undefined;
  return {row,a};
}
export function issueManagedJobCredential(input:{runId:string;attemptId:string}):ManagedJobCredential&{token:string} {
  const issued=execTransaction(()=>{
    const binding=managedJobCredentialBinding(input.runId,input.attemptId);if(!binding||binding.row.phase!=="prepared")throw Error("Original JobRun credential binding unavailable");
    const db=getDb(process.env.INGENIUM_CORE_DB_PATH),prior=db.prepare("SELECT * FROM job_run_mcp_credentials WHERE run_id=?").get(input.runId) as Record<string,unknown>|undefined;
    if(prior)throw Error("Original JobRun credential already issued; no rotation/replacement fallback");
    const generated=newCredentialToken(),encrypted=encryptAuthSecret(generated.token),a=binding.a,row=binding.row;
    db.prepare(`INSERT INTO job_run_mcp_credentials(id,run_id,attempt_id,kind,audience,service_principal_id,
      principal_security_epoch,workspace_security_epoch,token_prefix,token_hash,encrypted_token,scopes_json,expires_at,created_at)
      VALUES(?,?,?,'job-run','job-run',?,?,?,?,?,?,?,?,?)`).run(generated.id,input.runId,input.attemptId,row.effective_service_principal_id,
        row.principal_epoch,row.workspace_epoch,generated.tokenPrefix,hashSecurityToken(generated.token),encrypted,JSON.stringify(a.approvedScopes),row.deadline_at,new Date().toISOString());
    return {id:generated.id,kind:"job-run" as const,audience:"job-run" as const,runId:input.runId,attemptId:input.attemptId,
      servicePrincipalId:String(row.effective_service_principal_id),organizationId:a.organizationId,projectId:a.projectId,ownerUserId:a.ownerUserId,
      workspaceId:a.workspaceId,storageMappingHash:a.bindingHash,securityEpoch:Number(row.workspace_epoch),principalSecurityEpoch:Number(row.principal_epoch),scopes:[...a.approvedScopes],expiresAt:String(row.deadline_at),token:generated.token};
  });
  checkpointAfterWrite();return issued;
}
/** This resolver is deliberately separate from generic MCP/service/runtime/browser authentication. */
export function inspectManagedJobCredential(token:string,audience:"job-run",now=new Date()):ManagedJobCredential|undefined {
  if(audience!=="job-run"||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token))return undefined;
  const db=getDb(process.env.INGENIUM_CORE_DB_PATH),credential=db.prepare("SELECT * FROM job_run_mcp_credentials WHERE token_hash=? AND kind='job-run' AND audience='job-run' AND revoked_at IS NULL AND expires_at>?")
    .get(hashSecurityToken(token),now.toISOString()) as Record<string,unknown>|undefined;
  if(!credential)return undefined;const binding=managedJobCredentialBinding(String(credential.run_id),String(credential.attempt_id),now);
  if(!binding||binding.row.principal_epoch!==credential.principal_security_epoch||binding.row.workspace_epoch!==credential.workspace_security_epoch||credential.service_principal_id!==binding.row.effective_service_principal_id||credential.scopes_json!==JSON.stringify(binding.a.approvedScopes)||binding.row.credential_id!==credential.id)return undefined;
  const a=binding.a;return {id:String(credential.id),kind:"job-run",audience:"job-run",runId:String(credential.run_id),attemptId:String(credential.attempt_id),servicePrincipalId:String(credential.service_principal_id),organizationId:a.organizationId,projectId:a.projectId,ownerUserId:a.ownerUserId,workspaceId:a.workspaceId,storageMappingHash:a.bindingHash,securityEpoch:Number(credential.workspace_security_epoch),principalSecurityEpoch:Number(credential.principal_security_epoch),scopes:[...a.approvedScopes],expiresAt:String(credential.expires_at)};
}
export function revokeManagedJobCredential(runId:string):void {
  execTransaction(()=>getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("UPDATE job_run_mcp_credentials SET revoked_at=? WHERE run_id=? AND revoked_at IS NULL").run(new Date().toISOString(),runId));checkpointAfterWrite();
}

/** Narrow self-withdrawal remains available after expiry/revocation. Never resolves an Auth principal. */
export function withdrawManagedJobDispatch(token:string,input:{runId:string;attemptId:string;reason:string}):{withdrawalRecorded:true;wholeContainerRetired:false}|undefined {
 if(!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token)||!input||Object.keys(input).sort().join("|")!=="attemptId|reason|runId"||!["CORE126_JOB_ENFORCEMENT_LOST","CORE126_JOB_PLUGIN_UNLOADED","CORE126_JOB_PARENT_STOP"].includes(input.reason))return undefined;
 const result=execTransaction(()=>{
  const db=getDb(process.env.INGENIUM_CORE_DB_PATH);
  const row=db.prepare(`SELECT credential.id,credential.run_id,credential.attempt_id,ledger.project_id,ledger.phase
   FROM job_run_mcp_credentials credential JOIN job_run_managed_execution ledger
   ON ledger.run_id=credential.run_id AND ledger.attempt_id=credential.attempt_id AND ledger.credential_id=credential.id
   JOIN job_runs run ON run.id=ledger.run_id AND run.project_id=ledger.project_id AND run.effective_service_principal_id=credential.service_principal_id
   WHERE credential.token_hash=? AND credential.kind='job-run' AND credential.audience='job-run'
    AND credential.run_id=? AND credential.attempt_id=?`).get(hashSecurityToken(token),input.runId,input.attemptId) as {id:string;run_id:string;attempt_id:string;project_id:string;phase:string}|undefined;
  if(!row)return undefined;
  const now=new Date().toISOString();
  if(row.phase!=="retired"){
   db.prepare("UPDATE job_run_managed_execution SET phase='cancel_requested',revision=revision+1,updated_at=? WHERE run_id=? AND attempt_id=? AND credential_id=? AND phase NOT IN ('retired','cancel_requested')").run(now,row.run_id,row.attempt_id,row.id);
   db.prepare("UPDATE veyra_dot_records SET revision=revision+1,body=json_set(body,'$.state','cancel_requested','$.revision',revision+1,'$.updatedAt',?) WHERE kind='operation' AND json_extract(body,'$.runId')=? AND json_extract(body,'$.scope.projectId')=? AND json_extract(body,'$.state') NOT IN ('cancel_requested','success','failed','cancelled','skipped')").run(now,row.run_id,row.project_id);
  }
  db.prepare("UPDATE job_run_mcp_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND run_id=? AND attempt_id=?").run(now,row.id,row.run_id,row.attempt_id);
  return {withdrawalRecorded:true as const,wholeContainerRetired:false as const};
 });if(result)checkpointAfterWrite();return result;
}
