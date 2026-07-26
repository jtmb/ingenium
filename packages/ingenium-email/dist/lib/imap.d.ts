/**
 * IMAP operations backed by imapflow with an in-memory connection pool.
 *
 * Connection pool is in-memory (not persisted) — on process restart, all connections
 * are lost and re-established on first use.  The pool is process-scoped, not
 * request-scoped, so multiple callers share the same IMAP connection.
 *
 * 🔴 OAuth fallthrough guard: if authType is "oauth2" but accessToken is
 *    missing/empty, we throw a clear error instead of falling through to
 *    password auth (which triggers ImapFlow "No password configured").
 *
 * 🔴 Process-safety: `connectingLocks` prevents TOCTOU races where two
 *    concurrent callers both see pool.get(id) as null and create overlapping
 *    connections (leaking one with no error handler).
 */
import { ImapFlow } from "imapflow";
import type { EmailAccount, OAuthToken, EmailMessage, EmailFolder, SearchQuery } from "./types.js";
/**
 * Create an IMAP connection for the account and store it in the pool.
 *
 * Connection lifecycle:
 *   1. Check if another caller is already connecting (dedup via connectingLocks)
 *   2. Reuse existing pool entry if usable
 *   3. Clean up stale connection if present
 *   4. Create new ImapFlow client with error/close handlers attached BEFORE connect()
 *   5. Store in pool and return
 *
 * 🔴 Wrapped in try/catch so connection/auth failures produce normal errors,
 *    never uncaught exceptions (critical for background setImmediate callers).
 * 🔴 Error/close handlers attached BEFORE connect() to prevent unhandled error
 *    events from crashing the process (Lesson 24).
 * 🔴 TOCTOU race guard: connectingLocks ensures concurrent calls share one promise.
 */
export declare function connectAccount(account: EmailAccount, auth: {
    password?: string;
    tokens?: OAuthToken;
}): Promise<ImapFlow>;
/**
 * Disconnect and remove an account from the connection pool.
 * Idempotent — safe to call on accounts that were never connected.
 */
export declare function disconnectAccount(accountId: string): Promise<void>;
/**
 * Get a live connection from the pool (throws if not connected).
 *
 * Checks both pool existence AND client.usable (imapflow flag indicating
 * the connection is still open).  Throws a descriptive error if the
 * connection is missing or stale — callers should re-connect.
 */
export declare function getConnection(accountId: string): ImapFlow;
/**
 * List and paginate emails from a folder.
 *
 * Two fetch paths:
 *   1. Filtered (has search criteria) — uses IMAP SEARCH, paginates after results
 *   2. Unfiltered — windowed sequence-range fetch to avoid scanning 62K+ mailboxes
 *
 * The windowed approach fetches only the most recent `windowSize` messages (default 200),
 * then applies page/limit within that window.  For huge mailboxes, this avoids the
 * cost of scanning all 62K+ UIDs on every page load.
 *
 * Results are always sorted newest-first by date.
 */
export declare function listEmails(accountId: string, folder: string, page: number, limit: number, query?: SearchQuery, 
/** How many recent messages to scan for the unfiltered windowed path. */
windowSize?: number): Promise<{
    messages: EmailMessage[];
    total: number;
}>;
/**
 * Get a single email by UID.
 * Returns null if the UID doesn't exist in the folder (already deleted, moved, or invalid).
 */
export declare function getEmail(accountId: string, folder: string, uid: string | number): Promise<EmailMessage | null>;
/**
 * Search emails in a folder and return matching UIDs.
 * Uses IMAP SEARCH under the hood (supports text, from, to, subject, date ranges, flags).
 * Returns an empty array on no matches (imapflow returns false for empty results).
 */
export declare function searchEmails(accountId: string, folder: string, query: SearchQuery): Promise<number[]>;
/**
 * Move an email from one folder to another (IMAP COPY + STORE \\Deleted + EXPUNGE).
 *
 * The move is not atomic — if the copy succeeds but the delete fails, the message
 * will appear in both folders.  This is a known IMAP limitation; for stronger
 * guarantees, use IMAP MOVE (RFC 6851) which imapflow supports as client.messageMove().
 */
export declare function moveEmail(accountId: string, uid: string | number, fromFolder: string, toFolder: string): Promise<void>;
/**
 * Set flags on an email (e.g., \\Seen, \\Flagged, \\Answered).
 * Replaces all existing flags with the provided array.
 */
export declare function setFlags(accountId: string, folder: string, uid: string | number, flags: string[]): Promise<void>;
/**
 * Delete an email by UID (IMAP STORE \\Deleted + EXPUNGE).
 * This is a hard delete — the message is removed from the folder.
 * For soft-delete (move to Trash), use moveEmail() to the Trash folder instead.
 */
export declare function deleteEmail(accountId: string, folder: string, uid: string | number): Promise<void>;
/**
 * List all mailboxes/folders with status information (total/unread counts).
 * Uses IMAP LIST with STATUS (messages, unseen) to get counts in one round-trip.
 * Returns only folders the user has access to (filters out \\Noselect containers).
 */
export declare function listFolders(accountId: string): Promise<EmailFolder[]>;
//# sourceMappingURL=imap.d.ts.map