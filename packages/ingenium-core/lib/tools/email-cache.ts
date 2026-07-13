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
  uid: number;
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
  uid: number;
  html: string | null;
  text: string | null;
  headers_json: string | null;
  fetched_at: string;
}

export interface EmailCacheEntry {
  uid: number;
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
  last_uid: number;
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
  uid: number,
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
  uid: number,
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
  uid: number,
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
  ).get(accountId, folder) as { last_uid: number; uidvalidity: number; last_synced_at: string | null } | undefined;

  return {
    last_uid: row?.last_uid ?? 0,
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
  lastUid: number,
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

// ── Cache maintenance ──────────────────────────────────────────────────────

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
