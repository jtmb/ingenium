import { randomBytes, randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import type { OrganizationRole } from "../schema.js";
import { hashSecurityToken, INVITATION_MS } from "./authentication.js";
import { normalizeEmail } from "./identity.js";

type InvitationRole = Exclude<OrganizationRole, "owner">;

export function issueInvitation(organizationId: string, email: string, role: InvitationRole): string {
  const token = randomBytes(32).toString("base64url");
  execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `INSERT INTO organization_invitations
     (id, organization_id, email_normalized, role, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), organizationId, normalizeEmail(email), role, hashSecurityToken(token),
    new Date(Date.now() + INVITATION_MS).toISOString(), new Date().toISOString()));
  checkpointAfterWrite();
  return token;
}

export function previewInvitation(token: string, now = new Date()): { organizationName: string; email: string; role: InvitationRole; expiresAt: string } | undefined {
  let hash: string;
  try { hash = hashSecurityToken(token); } catch { return undefined; }
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT organizations.name, organization_invitations.email_normalized, organization_invitations.role, organization_invitations.expires_at
     FROM organization_invitations JOIN organizations ON organizations.id = organization_invitations.organization_id
     WHERE organization_invitations.token_hash = ? AND organization_invitations.accepted_at IS NULL
       AND organization_invitations.revoked_at IS NULL AND organization_invitations.expires_at > ?`,
  ).get(hash, now.toISOString()) as { name: string; email_normalized: string; role: InvitationRole; expires_at: string } | undefined;
  return row ? { organizationName: row.name, email: row.email_normalized, role: row.role, expiresAt: row.expires_at } : undefined;
}

export function acceptInvitation(token: string, userId: string, now = new Date()): void {
  const hash = hashSecurityToken(token);
  execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const row = database.prepare(
      `SELECT organization_invitations.id, organization_invitations.organization_id, organization_invitations.email_normalized,
              organization_invitations.role, users.email_normalized AS user_email
       FROM organization_invitations JOIN users ON users.id = ?
       WHERE organization_invitations.token_hash = ? AND organization_invitations.accepted_at IS NULL
         AND organization_invitations.revoked_at IS NULL AND organization_invitations.expires_at > ?`,
    ).get(userId, hash, now.toISOString()) as { id: string; organization_id: string; email_normalized: string; role: InvitationRole; user_email: string } | undefined;
    if (!row || row.email_normalized !== row.user_email) throw new Error("Invitation is invalid or expired");
    const timestamp = now.toISOString();
    database.prepare(
      `INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = excluded.updated_at`,
    ).run(row.organization_id, userId, row.role, timestamp, timestamp);
    if (database.prepare("UPDATE organization_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL")
      .run(timestamp, row.id).changes !== 1) throw new Error("Invitation is invalid or expired");
    database.prepare("UPDATE users SET security_epoch = security_epoch + 1, updated_at = ? WHERE id = ?").run(timestamp, userId);
    database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(timestamp, userId);
  });
  checkpointAfterWrite();
}
