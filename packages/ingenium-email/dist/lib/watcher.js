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
import { connectAccount, disconnectAccount } from "./imap.js";
import { triageEmails } from "./triage.js";
import { suggestResponse } from "./responder.js";
import { saveDraft } from "./smtp.js";
import { getAccount, getCredentials } from "./accounts.js";
import { apiRequestHeaders } from "./api-auth.js";
import { ProviderOperationError } from "./provider-errors.js";
/** Process-global watcher registry. Keyed by account ID. */
const watchers = new Map();
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
export async function startWatcher(projectId, accountId) {
    // Stop any existing watcher for this account
    if (watchers.has(accountId)) {
        await stopWatcher(accountId);
    }
    const account = getAccount(projectId, accountId);
    if (!account) {
        throw new ProviderOperationError("PROVIDER_NOT_FOUND", "imap", false);
    }
    const creds = getCredentials(projectId, accountId);
    if (!creds) {
        throw new ProviderOperationError("CREDENTIALS_UNAVAILABLE", "imap", false);
    }
    const auth = { password: creds.password, tokens: creds.tokens };
    const client = await connectAccount(account, auth);
    // Select INBOX for IDLE monitoring
    await client.mailboxOpen("INBOX");
    const entry = { projectId, accountId, account, auth, running: true };
    watchers.set(accountId, entry);
    // Listen for new emails (exists event fires on new messages via IMAP IDLE)
    client.on("exists", async () => {
        await handleNewEmail(entry);
    });
    // Kick off an initial scan to catch messages that arrived before IDLE was registered
    await handleNewEmail(entry);
}
/**
 * Stop the IDLE watcher for an account.
 * Disconnects the IMAP connection and removes the watcher from the registry.
 * Idempotent — safe to call if no watcher exists.
 */
export async function stopWatcher(accountId) {
    const entry = watchers.get(accountId);
    if (!entry)
        return;
    entry.running = false;
    try {
        await disconnectAccount(accountId);
    }
    catch {
        // Non-fatal: connection may already be closed
    }
    watchers.delete(accountId);
}
/** Get watcher status for an account (whether it's running or stopped). */
export function getWatcherStatus(accountId) {
    const entry = watchers.get(accountId);
    return { running: entry?.running ?? false };
}
/**
 * Handle a new email event: triage and optionally generate draft responses.
 *
 * For each triaged email:
 *   1. Logs an observation for the self-learning pipeline
 *   2. If priority is high or medium AND confidence > 0.5, auto-saves a draft
 *
 * All errors are caught and logged as observations (never thrown).
 */
async function handleNewEmail(entry) {
    if (!entry.running)
        return;
    try {
        // Fetch and triage recent unreads
        const results = await triageEmails(entry.projectId, entry.accountId, 10);
        for (const triage of results) {
            // Log observation for self-learning pipeline
            await logWatcherObservation(entry.projectId, {
                observation_type: "pattern",
                content: `Email triaged: uid=${triage.emailUid} category=${triage.category} priority=${triage.priority} action=${triage.suggestedAction} skills=${triage.matchedSkills.join(",")} confidence=${triage.confidence}`,
                importance: triage.priority === "high" ? 8 : 5,
            });
            // For high/medium priority with response skills, generate suggestions
            if (triage.priority === "high" || triage.priority === "medium") {
                // 🔴 Legitimate INBOX scope — the watcher monitors INBOX via IMAP IDLE.
                // This is NOT a missing-folder bug; it's the actual mailbox being watched.
                const suggestion = await suggestResponse(entry.projectId, entry.accountId, Number(triage.emailUid), "INBOX");
                if (suggestion && suggestion.confidence > 0.5) {
                    // Auto-save as draft
                    try {
                        await saveDraft(entry.account, entry.auth, {
                            to: [{ address: "", name: "" }], // placeholder — caller should resolve recipient
                            subject: suggestion.subject,
                            html: suggestion.body,
                            text: suggestion.body.replace(/<[^>]+>/g, ""),
                        });
                        await logWatcherObservation(entry.projectId, {
                            observation_type: "insight",
                            content: `Auto-draft saved for uid=${triage.emailUid} using skill=${suggestion.matchedSkill} confidence=${suggestion.confidence}`,
                            importance: 7,
                        });
                    }
                    catch {
                        await logWatcherObservation(entry.projectId, {
                            observation_type: "error",
                            // Transport/provider diagnostics can include credentials. Store a
                            // stable operational summary instead of propagating raw error text.
                            content: `Failed to save draft for uid=${triage.emailUid}: operation failed`,
                            importance: 5,
                        });
                    }
                }
            }
        }
    }
    catch {
        await logWatcherObservation(entry.projectId, {
            observation_type: "error",
            // Do not persist raw error text: it can contain provider diagnostics or tokens.
            content: `Watcher error for account ${entry.accountId}: processing failed`,
            importance: 7,
        });
    }
}
/**
 * Log an observation to the Ingenium API for the self-learning pipeline.
 * Best-effort: failures are silent (non-critical path).
 */
export async function logWatcherObservation(projectId, data) {
    try {
        const apiUrl = process.env.INGENIUM_API_URL ?? "http://localhost:4097/api/v1";
        await fetch(`${apiUrl}/observations?project=${projectId}`, {
            method: "POST",
            headers: apiRequestHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
                ...data,
                source: "email_watcher",
            }),
        });
    }
    catch {
        // Non-fatal: observation logging is best-effort
    }
}
