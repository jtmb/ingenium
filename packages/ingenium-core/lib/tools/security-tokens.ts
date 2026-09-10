import { randomBytes, randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { hashSecurityToken } from "./authentication.js";

export interface ScopedApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  userId: string | null;
  servicePrincipalId: string | null;
  scopes: string[];
  organizationId: string | null;
  projectId: string | null;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

function normalizeScopes(scopes: string[]): string[] {
  const normalized = [...new Set(scopes)].sort();
  if (normalized.length < 1 || normalized.length > 64
    || normalized.some((scope) => !/^[a-z][a-z0-9:._-]{0,127}$/.test(scope))) {
    throw new Error("Invalid token scopes");
  }
  return normalized;
}

function normalizeName(name: string): string {
  const value = name.trim();
  if (value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid token name");
  return value;
}

function toToken(row: {
  id: string; name: string; token_prefix: string; user_id: string | null; service_principal_id: string | null;
  scopes_json: string; organization_id: string | null; project_id: string | null; expires_at: string;
  revoked_at: string | null; last_used_at: string | null; created_at: string;
}): ScopedApiToken {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    userId: row.user_id,
    servicePrincipalId: row.service_principal_id,
    scopes: JSON.parse(row.scopes_json) as string[],
    organizationId: row.organization_id,
    projectId: row.project_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export function createServicePrincipal(organizationId: string | null, name: string): string {
  const normalizedName = normalizeName(name);
  const id = execTransaction(() => {
    const principalId = randomUUID();
    const now = new Date().toISOString();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "INSERT INTO service_principals (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(principalId, organizationId, normalizedName, now, now);
    return principalId;
  });
  checkpointAfterWrite();
  return id;
}

export function createScopedApiToken(
  owner: { userId: string } | { servicePrincipalId: string },
  scopes: string[],
  expiresAt: Date,
  options: { name?: string; organizationId?: string; projectId?: string } = {},
): ScopedApiToken & { token: string } {
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error("Token expiry must be in the future");
  const normalizedScopes = normalizeScopes(scopes);
  const secret = randomBytes(32).toString("base64url");
  const tokenId = randomUUID();
  const publicId = tokenId.replaceAll("-", "").slice(0, 12);
  const tokenPrefix = `ing_${publicId}`;
  const token = `${tokenPrefix}_${secret}`;
  const created = execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    if ("userId" in owner) {
      if (options.organizationId && !database.prepare(
        "SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND status = 'active'",
      ).get(options.organizationId, owner.userId)) throw new Error("API token scope is unavailable");
      if (options.projectId && !database.prepare(
        `SELECT 1 FROM projects LEFT JOIN project_memberships
           ON project_memberships.project_id = projects.id AND project_memberships.user_id = ?
         JOIN organization_memberships ON organization_memberships.organization_id = projects.organization_id
           AND organization_memberships.user_id = ? AND organization_memberships.status = 'active'
         WHERE projects.id = ? AND (organization_memberships.role IN ('owner', 'admin') OR project_memberships.user_id IS NOT NULL)`,
      ).get(owner.userId, owner.userId, options.projectId)) throw new Error("API token scope is unavailable");
    }
    database.prepare(
      `INSERT INTO scoped_api_tokens
       (id, user_id, service_principal_id, name, token_prefix, token_hash, scopes_json, organization_id, project_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(tokenId, "userId" in owner ? owner.userId : null,
      "servicePrincipalId" in owner ? owner.servicePrincipalId : null,
      normalizeName(options.name ?? "API token"), tokenPrefix, hashSecurityToken(token), JSON.stringify(normalizedScopes),
      options.organizationId ?? null, options.projectId ?? null, expiresAt.toISOString(), new Date().toISOString());
    return toToken(database.prepare(
      `SELECT id, name, token_prefix, user_id, service_principal_id, scopes_json, organization_id, project_id,
              expires_at, revoked_at, last_used_at, created_at FROM scoped_api_tokens WHERE id = ?`,
    ).get(tokenId) as Parameters<typeof toToken>[0]);
  });
  checkpointAfterWrite();
  return { ...created, token };
}

export function listUserApiTokens(userId: string): ScopedApiToken[] {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT id, name, token_prefix, user_id, service_principal_id, scopes_json, organization_id, project_id,
            expires_at, revoked_at, last_used_at, created_at
     FROM scoped_api_tokens WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
  ).all(userId) as Parameters<typeof toToken>[0][]).map(toToken);
}

export function resolveScopedApiToken(token: string, now = new Date()): ScopedApiToken | undefined {
  if (!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const row = database.prepare(
    `SELECT scoped_api_tokens.id, scoped_api_tokens.name, scoped_api_tokens.token_prefix,
            scoped_api_tokens.user_id, scoped_api_tokens.service_principal_id, scoped_api_tokens.scopes_json,
            scoped_api_tokens.organization_id, scoped_api_tokens.project_id, scoped_api_tokens.expires_at,
            scoped_api_tokens.revoked_at, scoped_api_tokens.last_used_at, scoped_api_tokens.created_at
     FROM scoped_api_tokens
     LEFT JOIN users ON users.id = scoped_api_tokens.user_id
     LEFT JOIN service_principals ON service_principals.id = scoped_api_tokens.service_principal_id
     WHERE scoped_api_tokens.token_hash = ? AND scoped_api_tokens.revoked_at IS NULL AND scoped_api_tokens.expires_at > ?
       AND (scoped_api_tokens.user_id IS NULL OR users.status = 'active')
       AND (scoped_api_tokens.service_principal_id IS NULL OR service_principals.status = 'active')`,
  ).get(hashSecurityToken(token), now.toISOString()) as Parameters<typeof toToken>[0] | undefined;
  if (!row) return undefined;
  execTransaction(() => database.prepare(
    "UPDATE scoped_api_tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL",
  ).run(now.toISOString(), row.id));
  checkpointAfterWrite();
  return toToken({ ...row, last_used_at: now.toISOString() });
}

export function revokeScopedApiToken(tokenId: string, userId?: string): boolean {
  const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "UPDATE scoped_api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND (? IS NULL OR user_id = ?)",
  ).run(new Date().toISOString(), tokenId, userId ?? null, userId ?? null).changes === 1);
  if (changed) checkpointAfterWrite();
  return changed;
}
