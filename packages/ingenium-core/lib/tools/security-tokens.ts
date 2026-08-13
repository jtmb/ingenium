import { randomBytes, randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { hashSecurityToken } from "./authentication.js";

function normalizeScopes(scopes: string[]): string[] {
  const normalized = [...new Set(scopes)].sort();
  if (normalized.length < 1 || normalized.length > 64
    || normalized.some((scope) => !/^[a-z][a-z0-9:._-]{0,127}$/.test(scope))) {
    throw new Error("Invalid token scopes");
  }
  return normalized;
}

export function createServicePrincipal(organizationId: string | null, name: string): string {
  const normalizedName = name.trim();
  if (normalizedName.length < 1 || normalizedName.length > 128) throw new Error("Invalid service principal name");
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
): { id: string; token: string } {
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error("Token expiry must be in the future");
  const normalizedScopes = normalizeScopes(scopes);
  const token = randomBytes(32).toString("base64url");
  const id = execTransaction(() => {
    const tokenId = randomUUID();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      `INSERT INTO scoped_api_tokens
       (id, user_id, service_principal_id, token_hash, scopes_json, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(tokenId, "userId" in owner ? owner.userId : null,
      "servicePrincipalId" in owner ? owner.servicePrincipalId : null,
      hashSecurityToken(token), JSON.stringify(normalizedScopes), expiresAt.toISOString(), new Date().toISOString());
    return tokenId;
  });
  checkpointAfterWrite();
  return { id, token };
}

export function resolveScopedApiToken(token: string, now = new Date()): { id: string; userId: string | null; servicePrincipalId: string | null; scopes: string[] } | undefined {
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT id, user_id, service_principal_id, scopes_json FROM scoped_api_tokens
     WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
  ).get(hashSecurityToken(token), now.toISOString()) as { id: string; user_id: string | null; service_principal_id: string | null; scopes_json: string } | undefined;
  return row ? { id: row.id, userId: row.user_id, servicePrincipalId: row.service_principal_id, scopes: JSON.parse(row.scopes_json) as string[] } : undefined;
}

export function revokeScopedApiToken(tokenId: string): boolean {
  const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "UPDATE scoped_api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
  ).run(new Date().toISOString(), tokenId).changes === 1);
  if (changed) checkpointAfterWrite();
  return changed;
}
