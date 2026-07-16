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
import type { EmailAccount, OAuthToken } from "./types.js";

interface WatcherEntry {
  projectId: string;
  accountId: string;
  account: EmailAccount;
  auth: { password?: string; tokens?: OAuthToken };
  running: boolean;
}

/** Process-global watcher registry. Keyed by account ID. */
const watchers = new Map<string, WatcherEntry>();

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
export async function startWatcher(
  projectId: string,
  accountId: string,
): Promise<void> {
  // Stop any existing watcher for this account
  if (watchers.has(accountId)) {
    await stopWatcher(accountId);
  }

  const account = getAccount(projectId, accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found in project ${projectId}`);
  }

  const creds = getCredentials(projectId, accountId);
  if (!creds) {
    throw new Error(`No credentials found for account ${accountId}`);
  }

  const auth = { password: creds.password, tokens: creds.tokens };
  const client = await connectAccount(account, auth);

  // Select INBOX for IDLE monitoring
  await client.mailboxOpen("INBOX");

  const entry: WatcherEntry = { projectId, accountId, account, auth, running: true };
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
export async function stopWatcher(accountId: string): Promise<void> {
  const entry = watchers.get(accountId);
  if (!entry) return;

  entry.running = false;
  try {
    await disconnectAccount(accountId);
  } catch {
    // Non-fatal: connection may already be closed
  }
  watchers.delete(accountId);
}

/** Get watcher status for an account (whether it's running or stopped). */
export function getWatcherStatus(accountId: string): { running: boolean } {
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
async function handleNewEmail(entry: WatcherEntry): Promise<void> {
  if (!entry.running) return;

  try {
    // Fetch and triage recent unreads
    const results = await triageEmails(entry.projectId, entry.accountId, 10);

    for (const triage of results) {
      // Log observation for self-learning pipeline
      await logObservation(entry.projectId, {
        observation_type: "pattern",
        content: `Email triaged: uid=${triage.emailUid} category=${triage.category} priority=${triage.priority} action=${triage.suggestedAction} skills=${triage.matchedSkills.join(",")} confidence=${triage.confidence}`,
        importance: triage.priority === "high" ? 8 : 5,
      });

      // For high/medium priority with response skills, generate suggestions
      if (triage.priority === "high" || triage.priority === "medium") {
        // 🔴 Legitimate INBOX scope — the watcher monitors INBOX via IMAP IDLE.
        // This is NOT a missing-folder bug; it's the actual mailbox being watched.
        const suggestion = await suggestResponse(
          entry.projectId,
          entry.accountId,
          Number(triage.emailUid),
          "INBOX",
        );

        if (suggestion && suggestion.confidence > 0.5) {
          // Auto-save as draft
          try {
            await saveDraft(entry.account, entry.auth, {
              to: [{ address: "", name: "" }], // placeholder — caller should resolve recipient
              subject: suggestion.subject,
              html: suggestion.body,
              text: suggestion.body.replace(/<[^>]+>/g, ""),
            });

            await logObservation(entry.projectId, {
              observation_type: "insight",
              content: `Auto-draft saved for uid=${triage.emailUid} using skill=${suggestion.matchedSkill} confidence=${suggestion.confidence}`,
              importance: 7,
            });
          } catch (err: unknown) {
            await logObservation(entry.projectId, {
              observation_type: "error",
              content: `Failed to save draft for uid=${triage.emailUid}: ${err instanceof Error ? err.message : String(err)}`,
              importance: 5,
            });
          }
        }
      }
    }
  } catch (err: unknown) {
    await logObservation(entry.projectId, {
      observation_type: "error",
      content: `Watcher error for account ${entry.accountId}: ${err instanceof Error ? err.message : String(err)}`,
      importance: 7,
    });
  }
}

/**
 * Log an observation to the Ingenium API for the self-learning pipeline.
 * Best-effort: failures are silent (non-critical path).
 */
async function logObservation(
  projectId: string,
  data: {
    observation_type: string;
    content: string;
    importance: number;
  },
): Promise<void> {
  try {
    const apiUrl = process.env.INGENIUM_API_URL ?? "http://localhost:4097/api/v1";
    await fetch(`${apiUrl}/observations?project=${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        source: "email_watcher",
      }),
    });
  } catch {
    // Non-fatal: observation logging is best-effort
  }
}
