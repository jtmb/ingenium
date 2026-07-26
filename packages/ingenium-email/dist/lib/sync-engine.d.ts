/**
 * Mail Sync Engine — Outlook Cached-Mode background synchronization.
 *
 * One background engine owns all mailbox I/O via a MailProvider with a priority queue:
 *   P0: Gmail delta poll (cheap historyId check, 30s interval)
 *   P1: boostFolder'd folders (user is viewing)
 *   P2: Full resync (all folders) or INBOX if stale
 *   P3: All folders round-robin headers (skipFresh gate)
 *   P4: Body backfill (newest→oldest, capped)
 *   P5: Deeper history backfill
 *
 * Per-account serialization: one worker per account, sequential tasks.
 * Body fetches: batch of 5, 200ms yield between batches (rate limit safe).
 * Provider is stateless HTTPS — no persistent connection needed.
 *
 * 🔴 Every error is logged before returning (Lesson 14). Silent deaths are invisible.
 * 🔴 Concurrent operations are SERIALIZED per account (Lesson 25).
 * 🔴 `lastSyncedAt` timestamps survive restarts (Lesson 16 — no in-memory booleans).
 */
/** Per-folder state within the sync engine. Mirrors both header sync and body backfill progress. */
export interface FolderEngineState {
    folder: string;
    state: "idle" | "syncing-headers" | "backfilling-bodies" | "complete" | "error";
    headersSynced: number;
    headersTotal: number;
    bodiesCached: number;
    /** The window cap from settings — max bodies to cache per folder. */
    bodiesWindow: number;
    /** ISO timestamp of last sync activity (not just completion — updates during backfill too). */
    lastSyncedAt: string | null;
    lastError: string | null;
}
/** Aggregate engine status returned by getEngineStatus() for dashboard/monitoring. */
export interface EngineStatus {
    running: boolean;
    /** ISO timestamp, updated EVERY loop tick even on errors (detect stuck workers). */
    heartbeatAt: string | null;
    accounts: {
        accountId: string;
        email: string;
        folders: FolderEngineState[];
    }[];
}
import { resetAuthCircuit } from "./circuit-breaker.js";
export { resetAuthCircuit };
/**
 * Start the background sync engine for a given project.
 * Launches one worker per connected email account.
 * Safe to call repeatedly: an already-running engine reconciles workers for
 * accounts that became available after startup.
 */
export declare function startEngine(_projectId: string): void;
/**
 * Stop a single account worker by its account ID.
 * Called by the API route before deleting an account to cleanly park
 * the worker and prevent stale sync tasks from running against deleted data.
 *
 * Sets worker.running = false, aborts the worker's AbortController,
 * deregisters the worker, and cleans up auth-error counters for the account.
 */
export declare function stopAccountWorker(accountId: string): void;
/**
 * Stop the background sync engine gracefully.
 * Aborts all workers and waits for them to finish.
 */
export declare function stopEngine(): Promise<void>;
/**
 * Boost a folder to P1 priority — called from UI when user clicks a folder.
 * Non-blocking, fire-and-forget.
 */
export declare function boostFolder(accountId: string, folder: string): void;
/**
 * Boost a specific UID for body backfill — called from GET /:uid when
 * body cache-miss returns 202. Adds the UID to the front of the body
 * backfill queue for that folder.
 * Non-blocking, fire-and-forget.
 */
export declare function boostBody(accountId: string, folder: string, uid: string): void;
/**
 * Return the current engine status for dashboard/monitoring.
 * Includes heartbeat, running state, and per-account folder states.
 */
export declare function getEngineStatus(): EngineStatus;
//# sourceMappingURL=sync-engine.d.ts.map