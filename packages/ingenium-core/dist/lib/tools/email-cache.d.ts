/**
 * Email cache — persistent DB-backed caching for IMAP email listings and bodies.
 *
 * Eliminates the in-memory React useRef Map that was cleared on every navigation.
 * After the first IMAP fetch, subsequent loads read from SQLite for < 2s response.
 */
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
    labels_json: string | null;
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
    labels_json?: string | null;
}
export interface SyncState {
    last_uid: string;
    uidvalidity: number;
    last_synced_at: string | null;
}
/**
 * Insert or update cached email listings. Uses ON CONFLICT DO UPDATE to handle
 * the UNIQUE(account_id, folder, uid) constraint without triggering ON DELETE CASCADE
 * to child tables (email_bodies, email_suggestions, email_summaries). Previously used
 * INSERT OR REPLACE which deleted the old row → cascading to destroy cached smart
 * replies, bodies, and summaries on every re-sync cycle.
 */
export declare function upsertEmailCache(accountId: string, folder: string, emails: EmailCacheEntry[]): number;
/**
 * Retrieve cached emails for a folder, paginated by date DESC (newest first).
 */
export declare function getCachedEmails(accountId: string, folder: string, page: number, limit: number): {
    emails: CachedEmail[];
    total: number;
};
/**
 * Look up a single cached email by account + folder + uid.
 */
export declare function getCachedEmail(accountId: string, folder: string, uid: string): CachedEmail | undefined;
/**
 * Retrieve a cached email body. Returns undefined if not yet cached.
 */
export declare function getCachedEmailBody(accountId: string, folder: string, uid: string): CachedEmailBody | undefined;
/**
 * Cache an email body (HTML, text, headers). Uses ON CONFLICT(account_id, folder, uid)
 * DO UPDATE so re-fetches update the content without triggering row deletion that
 * could cascade to child tables. The UNIQUE(account_id, folder, uid) constraint
 * matches the FK parent's key.
 *
 * 🔴 HARD RULE #11: ON CONFLICT DO UPDATE, never INSERT OR REPLACE.
 */
export declare function upsertEmailBody(accountId: string, folder: string, uid: string, html: string | null, text: string | null, headersJson: string | null): void;
/**
 * Return the last-known sync state for an account+ folder.
 */
export declare function getSyncState(accountId: string, folder: string): SyncState;
/**
 * Update (upsert) the sync state for an account+ folder.
 */
export declare function updateSyncState(accountId: string, folder: string, lastUid: string, uidValidity: number): void;
export interface CachedEmailSuggestions {
    account_id: string;
    folder: string;
    uid: string;
    suggestions_json: string;
    model: string | null;
    generated_at: string;
}
/**
 * Retrieve cached AI-generated reply suggestions for an email.
 * Returns undefined if no suggestions have been generated yet.
 */
export declare function getCachedSuggestions(accountId: string, folder: string, uid: string): CachedEmailSuggestions | undefined;
/**
 * Upsert AI-generated reply suggestions for an email.
 * Uses the same defensive parent-check pattern as upsertEmailBody:
 * verifies the email_cache row exists before inserting to avoid FK violations.
 *
 * Uses ON CONFLICT(account_id, folder, uid) DO UPDATE (not INSERT OR REPLACE)
 * per HARD RULE #11. The PRIMARY KEY is (account_id, folder, uid) — matching
 * the FK parent's UNIQUE(account_id, folder, uid). INSERT OR REPLACE would delete
 * the old row first, which would cascade to any future child tables of
 * email_suggestions.
 */
export declare function upsertEmailSuggestions(accountId: string, folder: string, uid: string, suggestions: Array<{
    tone: string;
    subject: string;
    body: string;
}>, model: string | null): void;
export interface CachedEmailSummary {
    account_id: string;
    folder: string;
    uid: string;
    summary_text: string;
    model: string | null;
    generated_at: string;
}
/**
 * Retrieve cached AI-generated email summary for an email.
 * Returns undefined if no summary has been generated yet.
 */
export declare function getCachedSummary(accountId: string, folder: string, uid: string): CachedEmailSummary | undefined;
/**
 * Upsert an AI-generated summary for an email.
 * Uses the same defensive parent-check pattern as upsertEmailSuggestions:
 * verifies the email_cache row exists before inserting to avoid FK violations.
 *
 * Uses ON CONFLICT(account_id, folder, uid) DO UPDATE (not INSERT OR REPLACE)
 * per HARD RULE #11. The PRIMARY KEY is (account_id, folder, uid) — matching
 * the FK parent's UNIQUE(account_id, folder, uid).
 */
export declare function upsertEmailSummary(accountId: string, folder: string, uid: string, summaryText: string, model: string | null): void;
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
export declare function getAccountFoldersSyncStatus(accountId: string): FolderSyncStatus[];
/**
 * Return UIDs from email_cache that are missing corresponding entries in
 * email_bodies. Used by backfillFolderBodies to find which emails need
 * body fetching. Returns the most recent UIDs first (date DESC), capped at limit.
 */
export declare function getUidsMissingBodies(accountId: string, folder: string, limit: number): string[];
/**
 * Delete all cached data for an account (both email listings and bodies).
 * Call this when an account is removed or the user wants a fresh sync.
 */
export declare function clearCache(accountId: string): {
    listings: number;
    bodies: number;
};
/**
 * Clear cached data for a single folder (listings, bodies, sync state).
 * Use this when a single folder's UIDVALIDITY changes instead of nuking the
 * entire account cache. Much cheaper than clearCache().
 */
export declare function clearFolderCache(accountId: string, folder: string): {
    listings: number;
    bodies: number;
};
/**
 * Read the account-level sync cursor (history_id + provider) from email_sync_state.
 * Uses a special folder key '__account__' to distinguish from per-folder sync state.
 */
export declare function getAccountCursor(accountId: string): {
    historyId: string | null;
    provider: string;
};
/**
 * Store (upsert) the account-level sync cursor in email_sync_state.
 * Uses a special folder key '__account__' to store per-account (not per-folder) state.
 */
export declare function setAccountCursor(accountId: string, historyId: string, provider: string): void;
//# sourceMappingURL=email-cache.d.ts.map