/**
 * Email cache — persistent DB-backed caching for IMAP email listings and bodies.
 *
 * Eliminates the in-memory React useRef Map that was cleared on every navigation.
 * After the first IMAP fetch, subsequent loads read from SQLite for < 2s response.
 */

import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CachedEmail {
  id: number;
  account_id: string;
  folder: string;
  uid: string;
  subject: string | null;
  from_name: string | null;
  from_addr: string | null;
  date: string | null;
  snippet: string | null;
  flags: string;
  has_attachments: number;
  envelope_json: string | null;
  cached_at: string;
}

export interface CachedEmailBody {
  id: number;
  account_id: string;
  folder: string;
  uid: string;
  html: string | null;
  text: string | null;
  headers_json: string | null;
  fetched_at: string;
}

export interface EmailCacheEntry {
  uid: string;
  subject?: string | null;
  from_name?: string | null;
  from_addr?: string | null;
  date?: string | null;
  snippet?: string | null;
  flags?: string;
  has_attachments?: number;
  envelope_json?: string | null;
}

export interface SyncState {
  last_uid: string;
  uidvalidity: number;
  last_synced_at: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}

// ── Email listing cache ────────────────────────────────────────────────────

/**
 * Insert or update cached email listings. Uses INSERT OR REPLACE to handle
 * the UNIQUE(account_id, folder, uid) constraint so re-fetches update stale data.
 */
export function upsertEmailCache(
  accountId: string,
  folder: string,
  emails: EmailCacheEntry[],
): number {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO email_cache
         (account_id, folder, uid, subject, from_name, from_addr, date,
          snippet, flags, has_attachments, envelope_json, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    );
    let count = 0;
    for (const e of emails) {
      stmt.run(
        accountId,
        folder,
        e.uid,
        e.subject ?? null,
        e.from_name ?? null,
        e.from_addr ?? null,
        e.date ?? null,
        e.snippet ?? null,
        e.flags ?? "[]",
        e.has_attachments ?? 0,
        e.envelope_json ?? null,
      );
      count++;
    }
    return count;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Retrieve cached emails for a folder, paginated by date DESC (newest first).
 */
export function getCachedEmails(
  accountId: string,
  folder: string,
  page: number,
  limit: number,
): { emails: CachedEmail[]; total: number } {
  const db = getDb(dbPath());
  const offset = (page - 1) * limit;

  const totalRow = db.prepare(
    "SELECT COUNT(*) as count FROM email_cache WHERE account_id = ? AND folder = ?",
  ).get(accountId, folder) as { count: number };

  const emails = db.prepare(
    `SELECT * FROM email_cache
      WHERE account_id = ? AND folder = ?
      ORDER BY date DESC
      LIMIT ? OFFSET ?`,
  ).all(accountId, folder, limit, offset) as CachedEmail[];

  return { emails, total: totalRow.count };
}

/**
 * Look up a single cached email by account + folder + uid.
 */
export function getCachedEmail(
  accountId: string,
  folder: string,
  uid: string,
): CachedEmail | undefined {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?",
  ).get(accountId, folder, uid) as CachedEmail | undefined;
}

// ── Email body cache ───────────────────────────────────────────────────────

/**
 * Retrieve a cached email body. Returns undefined if not yet cached.
 */
export function getCachedEmailBody(
  accountId: string,
  folder: string,
  uid: string,
): CachedEmailBody | undefined {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM email_bodies WHERE account_id = ? AND folder = ? AND uid = ?",
  ).get(accountId, folder, uid) as CachedEmailBody | undefined;
}

/**
 * Cache an email body (HTML, text, headers). Uses INSERT OR REPLACE so
 * re-fetches update the content.
 */
export function upsertEmailBody(
  accountId: string,
  folder: string,
  uid: string,
  html: string | null,
  text: string | null,
  headersJson: string | null,
): void {
  execTransaction(() => {
    const db = getDb(dbPath());
    db.prepare(
      `INSERT OR REPLACE INTO email_bodies
         (account_id, folder, uid, html, text, headers_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(accountId, folder, uid, html ?? null, text ?? null, headersJson ?? null);
  });
  checkpointAfterWrite();
}

// ── Sync state ─────────────────────────────────────────────────────────────

/**
 * Return the last-known sync state for an account+ folder.
 */
export function getSyncState(
  accountId: string,
  folder: string,
): SyncState {
  const db = getDb(dbPath());
  const row = db.prepare(
    "SELECT last_uid, uidvalidity, last_synced_at FROM email_sync_state WHERE account_id = ? AND folder = ?",
  ).get(accountId, folder) as { last_uid: number | string; uidvalidity: number; last_synced_at: string | null } | undefined;

  return {
    last_uid: String(row?.last_uid ?? "0"),
    uidvalidity: row?.uidvalidity ?? 0,
    last_synced_at: row?.last_synced_at ?? null,
  };
}

/**
 * Update (upsert) the sync state for an account+ folder.
 */
export function updateSyncState(
  accountId: string,
  folder: string,
  lastUid: string,
  uidValidity: number,
): void {
  execTransaction(() => {
    const db = getDb(dbPath());
    db.prepare(
      `INSERT INTO email_sync_state (account_id, folder, last_uid, uidvalidity, last_synced_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(account_id, folder) DO UPDATE SET
         last_uid = excluded.last_uid,
         uidvalidity = excluded.uidvalidity,
         last_synced_at = datetime('now')`,
    ).run(accountId, folder, lastUid, uidValidity);
  });
  checkpointAfterWrite();
}

// ── Sync status queries ────────────────────────────────────────────────────

export interface FolderSyncStatus {
  folder: string;
  cachedCount: number;
  bodyCount: number;
  lastSyncedAt: string | null;
}

/**
 * Return per-folder sync status for all folders of an account.
 * Used by the /sync-status endpoint to show cache state.
 */
export function getAccountFoldersSyncStatus(accountId: string): FolderSyncStatus[] {
  const db = getDb(dbPath());
  const folders = db.prepare(
    `SELECT DISTINCT folder FROM email_cache WHERE account_id = ?
     UNION
     SELECT DISTINCT folder FROM email_sync_state WHERE account_id = ?`,
  ).all(accountId, accountId) as Array<{ folder: string }>;

  return folders.map(({ folder }) => {
    const cacheRow = db.prepare(
      "SELECT COUNT(*) as count FROM email_cache WHERE account_id = ? AND folder = ?",
    ).get(accountId, folder) as { count: number };
    const bodyRow = db.prepare(
      "SELECT COUNT(*) as count FROM email_bodies WHERE account_id = ? AND folder = ?",
    ).get(accountId, folder) as { count: number };
    const syncRow = db.prepare(
      "SELECT last_synced_at FROM email_sync_state WHERE account_id = ? AND folder = ?",
    ).get(accountId, folder) as { last_synced_at: string | null } | undefined;

    return {
      folder,
      cachedCount: cacheRow.count,
      bodyCount: bodyRow.count,
      lastSyncedAt: syncRow?.last_synced_at ?? null,
    };
  });
}

// ── Cache maintenance ──────────────────────────────────────────────────────

/**
 * Return UIDs from email_cache that are missing corresponding entries in
 * email_bodies. Used by backfillFolderBodies to find which emails need
 * body fetching. Returns the most recent UIDs first (date DESC), capped at limit.
 */
export function getUidsMissingBodies(
  accountId: string,
  folder: string,
  limit: number,
): string[] {
  const db = getDb(dbPath());
  const rows = db.prepare(
    `SELECT ec.uid FROM email_cache ec
     WHERE ec.account_id = ? AND ec.folder = ?
       AND ec.uid NOT IN (SELECT uid FROM email_bodies WHERE account_id = ? AND folder = ?)
     ORDER BY ec.date DESC
     LIMIT ?`,
  ).all(accountId, folder, accountId, folder, limit) as Array<{ uid: string }>;
  return rows.map(r => r.uid);
}

/**
 * Delete all cached data for an account (both email listings and bodies).
 * Call this when an account is removed or the user wants a fresh sync.
 */
export function clearCache(accountId: string): { listings: number; bodies: number } {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const bodyResult = db.prepare("DELETE FROM email_bodies WHERE account_id = ?").run(accountId);
    const listingResult = db.prepare("DELETE FROM email_cache WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM email_sync_state WHERE account_id = ?").run(accountId);
    return { listings: listingResult.changes, bodies: bodyResult.changes };
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Clear cached data for a single folder (listings, bodies, sync state).
 * Use this when a single folder's UIDVALIDITY changes instead of nuking the
 * entire account cache. Much cheaper than clearCache().
 */
export function clearFolderCache(accountId: string, folder: string): { listings: number; bodies: number } {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const bodyResult = db.prepare("DELETE FROM email_bodies WHERE account_id = ? AND folder = ?").run(accountId, folder);
    const listingResult = db.prepare("DELETE FROM email_cache WHERE account_id = ? AND folder = ?").run(accountId, folder);
    db.prepare("DELETE FROM email_sync_state WHERE account_id = ? AND folder = ?").run(accountId, folder);
    return { listings: listingResult.changes, bodies: bodyResult.changes };
  });
  checkpointAfterWrite();
  return result;
}

// ── Account-level cursor (Gmail historyId / Graph deltaLink) ────────────────

/**
 * Read the account-level sync cursor (history_id + provider) from email_sync_state.
 * Uses a special folder key '__account__' to distinguish from per-folder sync state.
 */
export function getAccountCursor(accountId: string): { historyId: string | null; provider: string } {
  const db = getDb(dbPath());
  const row = db.prepare(
    "SELECT history_id, provider FROM email_sync_state WHERE account_id = ? AND folder = '__account__'",
  ).get(accountId) as { history_id: string | null; provider: string | null } | undefined;

  return {
    historyId: row?.history_id ?? null,
    provider: row?.provider ?? "imap",
  };
}

/**
 * Store (upsert) the account-level sync cursor in email_sync_state.
 * Uses a special folder key '__account__' to store per-account (not per-folder) state.
 */
export function setAccountCursor(accountId: string, historyId: string, provider: string): void {
  execTransaction(() => {
    const db = getDb(dbPath());
    db.prepare(
      `INSERT INTO email_sync_state (account_id, folder, last_uid, history_id, provider, last_synced_at)
       VALUES (?, '__account__', '0', ?, ?, datetime('now'))
       ON CONFLICT(account_id, folder) DO UPDATE SET
         history_id = excluded.history_id,
         provider = excluded.provider,
         last_synced_at = datetime('now')`,
    ).run(accountId, historyId, provider);
  });
  checkpointAfterWrite();
}
