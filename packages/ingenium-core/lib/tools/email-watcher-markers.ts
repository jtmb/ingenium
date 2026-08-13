import { checkpointAfterWrite, execTransaction, getDb, resolveCoreDbPath } from "../db.js";

export const EMAIL_WATCHER_MARKER_CAP = 4096;

export interface WatcherMarkerRememberResult {
  alreadyProcessed: boolean;
  newlyRecorded: boolean;
}

function dbPath(): string {
  return resolveCoreDbPath();
}

function assertBoundedText(label: string, value: string, maximumLength: number): void {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximumLength
    || value.trim().length === 0
    || value.includes("\0")
  ) {
    throw new Error(`${label} must be a non-empty string up to ${maximumLength} characters`);
  }
}

function assertMarkerScope(projectId: string, accountId: string, folder?: string, uid?: string): void {
  assertBoundedText("projectId", projectId, 128);
  assertBoundedText("accountId", accountId, 256);
  if (folder !== undefined) assertBoundedText("folder", folder, 512);
  if (uid !== undefined) assertBoundedText("uid", uid, 512);
}

/** Atomically records a watcher attempt and retains only the newest scoped markers. */
export function remember(
  projectId: string,
  accountId: string,
  folder: string,
  uid: string,
): WatcherMarkerRememberResult {
  assertMarkerScope(projectId, accountId, folder, uid);

  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const inserted = db.prepare(
      `INSERT INTO email_watcher_markers
         (project_id, organization_id, account_id, folder, uid, created_at, updated_at)
       SELECT ?, organization_id, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       FROM mail_accounts WHERE id = ?
       ON CONFLICT(project_id, account_id, folder, uid) DO NOTHING`,
    ).run(projectId, accountId, folder, uid, accountId);

    if (inserted.changes === 0) {
      const refreshed = db.prepare(
        `UPDATE email_watcher_markers
         SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE project_id = ? AND account_id = ? AND folder = ? AND uid = ?`,
      ).run(projectId, accountId, folder, uid);
      if (refreshed.changes !== 1) {
        throw new Error("Watcher marker disappeared during duplicate suppression");
      }
      return { alreadyProcessed: true, newlyRecorded: false };
    }

    db.prepare(
      `DELETE FROM email_watcher_markers
       WHERE id IN (
         SELECT id FROM email_watcher_markers
         WHERE project_id = ? AND account_id = ? AND folder = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT -1 OFFSET ?
       )`,
    ).run(projectId, accountId, folder, EMAIL_WATCHER_MARKER_CAP);
    return { alreadyProcessed: false, newlyRecorded: true };
  });

  checkpointAfterWrite();
  return result;
}

/** Remove durable watcher markers when the API deletes an account. */
export function clearAccount(projectId: string, accountId: string): number {
  assertMarkerScope(projectId, accountId);
  const deleted = execTransaction(() => {
    return getDb(dbPath()).prepare(
      "DELETE FROM email_watcher_markers WHERE project_id = ? AND account_id = ?",
    ).run(projectId, accountId).changes;
  });
  if (deleted > 0) checkpointAfterWrite();
  return deleted;
}
