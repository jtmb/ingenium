/**
 * IMAP IDLE watcher for real-time email monitoring with auto-triage and response suggestions.
 *
 * Uses IMAP IDLE to listen for new messages on the INBOX.  On each "exists" event,
 * runs triage on recent unreads and auto-saves drafts for high-confidence matches.
 *
 * 🔴 IMAP IDLE requires an active connection — the watcher holds one open connection
 *    per account.  Connection drops are handled by the pool cleanup in imap.ts.
 *
 * 🔴 The watcher is separate from (and complementary to) the sync engine.  The sync
 *    engine handles periodic delta polling for Gmail API; this watcher handles IMAP
 *    IDLE for real-time notifications on IMAP-connected accounts.
 *
 * 🔴 The watcher intentionally scopes to INBOX only — IMAP IDLE monitors a single
 *    mailbox and INBOX is where new messages arrive. This is a legitimate semantic
 *    scope, not a missing-folder bug. The "INBOX" literal on handleNewEmail line 134
 *    reflects the actual mailbox the watcher is monitoring.
 */
/**
 * Start the IMAP IDLE watcher for an account.
 *
 * Opens an IMAP connection, selects INBOX, and listens for "exists" events
 * (IMAP IDLE notification for new messages).  Also performs an initial triage
 * scan to catch messages that arrived between connection establishment and
 * the IDLE listener being registered.
 *
 * If a watcher already exists for this account, it is stopped first.
 */
export declare function startWatcher(projectId: string, accountId: string): Promise<void>;
/**
 * Stop the IDLE watcher for an account.
 * Disconnects the IMAP connection and removes the watcher from the registry.
 * Idempotent — safe to call if no watcher exists.
 */
export declare function stopWatcher(accountId: string): Promise<void>;
/** Get watcher status for an account (whether it's running or stopped). */
export declare function getWatcherStatus(accountId: string): {
    running: boolean;
};
/**
 * Log an observation to the Ingenium API for the self-learning pipeline.
 * Best-effort: failures are silent (non-critical path).
 */
export declare function logWatcherObservation(projectId: string, data: {
    observation_type: string;
    content: string;
    importance: number;
}): Promise<void>;
//# sourceMappingURL=watcher.d.ts.map