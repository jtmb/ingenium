/**
 * Email sync — IMAP-to-DB synchronization with UIDVALIDITY tracking.
 *
 * Always uses the global project regardless of passed projectId.
 * Handles full initial sync (windowed), incremental sync (UID range search),
 * UIDVALIDITY changes (cache clear), and body prefetch for recent messages.
 *
 * 🔴 Single-flight deduplication prevents concurrent syncFolder calls
 * for the same account+folder within one process.
 */
export interface SyncResult {
    folder: string;
    synced: number;
    total: number;
    error?: string;
}
/**
 * Sync a single folder for an account. Checks UIDVALIDITY, fetches new emails
 * with UID > last_uid, and upserts them into the email_cache.
 *
 * On first sync (last_uid=0) uses a windowed sequence-range fetch to avoid
 * scanning the entire mailbox. Incremental syncs use UID search capped at maxBatch.
 *
 * After syncing listings, also prefetches bodies for the most recent 50 emails
 * so the common email-open path is instant (no IMAP round-trip).
 *
 * 🔴 Single-flight guarded: concurrent calls for the same account+folder return
 * the same promise. Guards concurrency within one process, not freshness.
 *
 * @param maxBatch Maximum emails to sync per call (default 200). Prevents timeout on 62K+ mailboxes.
 * @returns SyncResult with folder name, count of newly synced, total in mailbox.
 */
export declare function syncFolder(_projectId: string, accountId: string, folder: string, maxBatch?: number): Promise<SyncResult>;
/**
 * Backfill email bodies for a folder. Fetches UIDs that exist in email_cache
 * but are missing from email_bodies, then fetches and parses each to populate
 * the body cache. Useful for warming folders that were synced before body
 * prefetch was added for all folders.
 *
 * @param limit Maximum bodies to backfill (default 50).
 * @returns Count of bodies backfilled, or an error sentinel (logged before return).
 */
export declare function backfillFolderBodies(_projectId: string, accountId: string, folder: string, limit?: number): Promise<{
    folder: string;
    backfilled: number;
    error?: string;
}>;
/**
 * Sync all folders for an account. Gets folder list via IMAP, connects once,
 * then syncs each folder sequentially.
 *
 * 🔴 Early-return optimization: if all folders are fresh (within freshMs),
 *    skip IMAP entirely — avoid wasting a connection on stale folders.
 *
 * @returns Array of SyncResult, one per folder.
 */
export declare function syncAccountFolders(_projectId: string, accountId: string, opts?: {
    skipFresh?: boolean;
    freshMs?: number;
    onFolder?: (folder: string, active: boolean) => void;
}): Promise<SyncResult[]>;
//# sourceMappingURL=sync.d.ts.map