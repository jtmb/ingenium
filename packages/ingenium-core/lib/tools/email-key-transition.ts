import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { insertResourceAuditEvent, type ResourceAuditEventInput } from "./authorization.js";

const FINGERPRINT_KEY = "email_encryption_key_fingerprint";
const REQUIRED_EMPTY_TABLES = [
  "mail_accounts",
  "mail_account_credentials",
  "mail_oauth_attempts",
  "email_cache",
  "email_bodies",
  "email_sync_state",
  "email_suggestions",
  "email_summaries",
  "email_suggestion_queue",
  "email_watcher_markers",
] as const;

export type EmptyEmailKeyTransitionResult =
  | { status: "transitioned"; auditId: string }
  | { status: "unchanged" }
  | { status: "blocked" }
  | { status: "concurrent_change" };

class ConcurrentEmailKeyTransitionError extends Error {}

function assertKnownSchemaAndEmpty(): boolean {
  const db = getDb();
  for (const table of REQUIRED_EMPTY_TABLES) {
    const schema = db.prepare("SELECT type FROM sqlite_master WHERE name = ?").get(table) as { type: string } | undefined;
    if (schema?.type !== "table") throw new Error("Mail encryption transition schema is unavailable");
    if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) return false;
  }
  if (db.prepare(
    `SELECT 1 FROM settings
     WHERE key != ? AND (key LIKE 'email_account_%' OR key LIKE 'email_oauth_%') LIMIT 1`,
  ).get(FINGERPRINT_KEY)) return false;
  if (db.prepare("SELECT 1 FROM resource_grants WHERE resource_type = 'mail_account' LIMIT 1").get()) return false;
  return true;
}

export function transitionEmptyEmailEncryptionKey(input: {
  projectId: string;
  fingerprint: string;
  actorType: ResourceAuditEventInput["actorType"];
  actorId?: string;
  requestId?: string;
}): EmptyEmailKeyTransitionResult {
  if (!/^[0-9a-f]{64}$/.test(input.fingerprint)) throw new Error("Email encryption fingerprint is invalid");
  try {
    const result = execTransaction(() => {
      const db = getDb();
      const project = db.prepare("SELECT organization_id FROM projects WHERE id = ? AND archived_at IS NULL")
        .get(input.projectId) as { organization_id: string } | undefined;
      if (!project) throw new Error("Email encryption transition project is unavailable");
      if (!assertKnownSchemaAndEmpty()) return { status: "blocked" as const };
      const current = db.prepare("SELECT value FROM settings WHERE project_id = ? AND key = ?")
        .get(input.projectId, FINGERPRINT_KEY) as { value: string } | undefined;
      if (current?.value === input.fingerprint) return { status: "unchanged" as const };
      db.prepare(
        `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
      ).run(input.projectId, FINGERPRINT_KEY, input.fingerprint);
      if (!assertKnownSchemaAndEmpty()) throw new ConcurrentEmailKeyTransitionError();
      const auditId = insertResourceAuditEvent({
        organizationId: project.organization_id,
        projectId: input.projectId,
        resourceType: "mail_account",
        action: "mail.email_key_empty_transition",
        actorType: input.actorType,
        actorId: input.actorId,
        outcome: "success",
        requestId: input.requestId,
      });
      return { status: "transitioned" as const, auditId };
    });
    if (result.status === "transitioned") checkpointAfterWrite();
    return result;
  } catch (error) {
    if (error instanceof ConcurrentEmailKeyTransitionError) return { status: "concurrent_change" };
    throw error;
  }
}
