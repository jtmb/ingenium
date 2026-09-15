import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { SecurityAuditEventInputSchema, type SecurityAuditEventInput } from "../schema.js";

export function appendSecurityAuditEvent(event: SecurityAuditEventInput): string {
  const parsedEvent = SecurityAuditEventInputSchema.parse(event);
  if (parsedEvent.action.trim() !== parsedEvent.action || /[\u0000-\u001f\u007f]/.test(parsedEvent.action)) {
    throw new Error("Invalid security audit action");
  }
  const id = execTransaction(() => {
    const eventId = randomUUID();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      `INSERT INTO security_audit_events
       (id, actor_type, actor_id, action, organization_id, project_id, outcome, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(eventId, parsedEvent.actorType, parsedEvent.actorId ?? null, parsedEvent.action, parsedEvent.organizationId ?? null,
      parsedEvent.projectId ?? null, parsedEvent.outcome, "{}", new Date().toISOString());
    return eventId;
  });
  checkpointAfterWrite();
  return id;
}
