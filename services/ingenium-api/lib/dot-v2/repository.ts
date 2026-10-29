import type { DotScope, Suggestion, Followup, Operation, Notification } from "../../../../packages/veyra-automation/contracts.js";
export type RecordKind = "suggestion" | "followup" | "operation" | "notification";
export type DotRecord = Suggestion | Followup | Operation | Notification;
export interface Database {
  prepare(sql: string): { run(...values: (string | number)[]): { changes: number | bigint }; get(...values: (string | number)[]): unknown; all(...values: (string | number)[]): unknown[] };
}
export function scopeKey(scope: DotScope): string {
  return JSON.stringify([scope.organizationId, scope.ownerUserId, scope.projectId, scope.executionBindingId, scope.executionBindingFingerprint, scope.conversationId]);
}
export class DotConflict extends Error { readonly code = "DOT_REVISION_CONFLICT"; }
export class DotRepository {
  readonly db: Database;
  readonly transaction: <T>(fn: () => T) => T;
  constructor(db: Database, transaction: <T>(fn: () => T) => T) { this.db=db; this.transaction=transaction; }
  get<T extends DotRecord>(kind: RecordKind, id: string, scope: DotScope): T | undefined {
    const row = this.db.prepare("SELECT body FROM veyra_dot_records WHERE kind=? AND id=? AND scope_key=?").get(kind,id,scopeKey(scope)) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as T : undefined;
  }
  page<T extends DotRecord>(kind: RecordKind, scope: DotScope, after = "", limit = 20): { data: T[]; nextCursor: string | null } {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || after.length > 512) throw new RangeError("Invalid page");
    const rows = this.db.prepare("SELECT id,body FROM veyra_dot_records WHERE kind=? AND scope_key=? AND id>? ORDER BY id LIMIT ?").all(kind,scopeKey(scope),after,limit+1) as { id: string; body: string }[];
    return { data: rows.slice(0,limit).map(r => JSON.parse(r.body)), nextCursor: rows.length > limit ? rows[limit-1]!.id : null };
  }
  put(kind: RecordKind, record: DotRecord, expectedRevision: number | null): void {
    const revision = "revision" in record ? record.revision : 0;
    if (expectedRevision === null) {
      let changes: number | bigint;
      try {
      const result = this.db.prepare("INSERT INTO veyra_dot_records(kind,id,organization_id,owner_user_id,scope_key,revision,body) VALUES(?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO NOTHING").run(kind,record.id,record.scope.organizationId,record.scope.ownerUserId,scopeKey(record.scope),revision,JSON.stringify(record));
      changes=result.changes;
      } catch(error) {
        if(error instanceof Error && error.message.includes("veyra_dot_job_owner")) throw new DotConflict("Job already has an active follow-up");
        throw error;
      }
      if (!Number(changes)) throw new DotConflict("Record already exists");
    } else {
      if (revision !== expectedRevision + 1) throw new DotConflict("Revision must advance once");
      const result = this.db.prepare("UPDATE veyra_dot_records SET revision=?,body=? WHERE kind=? AND id=? AND scope_key=? AND revision=?").run(revision,JSON.stringify(record),kind,record.id,scopeKey(record.scope),expectedRevision);
      if (!Number(result.changes)) throw new DotConflict("Reload changed record");
    }
  }
}
