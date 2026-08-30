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
 *    mailbox and INBOX is where new messages arrive.
 */

import { connectAccount, disconnectAccount } from "./imap.js";
import { triageEmails } from "./triage.js";
import { parseReplyRecipient, suggestResponse } from "./responder.js";
import { saveDraft } from "./smtp.js";
import { getAccount, getCredentials } from "./accounts.js";
import type { EmailAccount, OAuthToken } from "./types.js";
import { ProviderOperationError } from "./provider-errors.js";
import { getEmailRuntime, type EmailObservation } from "./runtime.js";

type ImapClient = Awaited<ReturnType<typeof connectAccount>>;
type ExistsHandler = () => void | Promise<void>;
const MAX_PROCESSED_UIDS = 4096;
const WATCHER_FOLDER = "INBOX";
const MAX_MARKER_FAILURE_WARNINGS = 3;
let processedUidCapacityForTest: number | undefined;

interface WatcherEntry {
  projectId: string;
  accountId: string;
  account: EmailAccount;
  auth: { password?: string; tokens?: OAuthToken };
  client: ImapClient;
  existsHandler: ExistsHandler;
  running: boolean;
  scanPromise: Promise<void> | null;
  folder: string;
  processedUids: Map<string, undefined>;
  processedUidCapacity: number;
  markerFailureWarnings: number;
}

interface WatcherStart {
  projectId: string;
  accountId: string;
  cancelled: boolean;
  connectStarted: boolean;
  client: ImapClient | null;
  entry: WatcherEntry | null;
  promise: Promise<void>;
}

/** Process-global watcher registry. Keyed by project and account ID. */
const watchers = new Map<string, WatcherEntry>();
/** Synchronous startup reservations prevent duplicate listener setup. */
const startingWatchers = new Map<string, WatcherStart>();

function watcherKey(projectId: string, accountId: string): string {
  return `${projectId}\u0000${accountId}`;
}

export function configureWatcherProcessedUidCapacityForTest(capacity?: number): void {
  if (capacity !== undefined && (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_PROCESSED_UIDS)) {
    throw new Error(`Processed UID capacity must be between 1 and ${MAX_PROCESSED_UIDS}`);
  }
  processedUidCapacityForTest = capacity;
}

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
export function startWatcher(
  projectId: string,
  accountId: string,
): Promise<void> {
  const key = watcherKey(projectId, accountId);
  const current = startingWatchers.get(key);
  if (current) return current.promise;

  const start: WatcherStart = {
    projectId,
    accountId,
    cancelled: false,
    connectStarted: false,
    client: null,
    entry: null,
    promise: Promise.resolve(),
  };
  startingWatchers.set(key, start);
  start.promise = runWatcherStart(start);
  return start.promise;
}

async function runWatcherStart(start: WatcherStart): Promise<void> {
  let committed = false;
  const key = watcherKey(start.projectId, start.accountId);
  try {
    const existing = watchers.get(key);
    if (existing) await stopStoredWatcher(key, existing);
    if (start.cancelled) return;

    const account = getAccount(start.accountId);
    if (!account) {
      throw new ProviderOperationError("PROVIDER_NOT_FOUND", "imap", false);
    }

    const creds = getCredentials(start.accountId);
    if (!creds) {
      throw new ProviderOperationError("CREDENTIALS_UNAVAILABLE", "imap", false);
    }

    const auth = { password: creds.password, tokens: creds.tokens };
    start.connectStarted = true;
    const client = await connectAccount(account, auth);
    start.client = client;
    if (start.cancelled) return;

    await client.mailboxOpen(WATCHER_FOLDER);
    if (start.cancelled) return;

    const entry: WatcherEntry = {
      projectId: start.projectId,
      accountId: start.accountId,
      account,
      auth,
      client,
      existsHandler: () => Promise.resolve(),
      running: true,
      scanPromise: null,
      folder: WATCHER_FOLDER,
      processedUids: new Map(),
      processedUidCapacity: processedUidCapacityForTest ?? MAX_PROCESSED_UIDS,
      markerFailureWarnings: 0,
    };
    start.entry = entry;
    entry.existsHandler = () => scheduleWatcherScan(entry);
    client.on("exists", entry.existsHandler);
    if (start.cancelled) return;

    watchers.set(key, entry);

    // Kick off an initial scan to catch messages that arrived before IDLE was registered.
    await scheduleWatcherScan(entry, true);
    if (start.cancelled) return;
    committed = true;
  } catch (error: unknown) {
    if (!start.cancelled) throw error;
  } finally {
    if (!committed) await cleanupWatcherStart(start);
    if (startingWatchers.get(key) === start) startingWatchers.delete(key);
  }
}

async function cleanupWatcherStart(start: WatcherStart): Promise<void> {
  const key = watcherKey(start.projectId, start.accountId);
  if (start.entry) {
    start.entry.running = false;
    detachExistsListener(start.entry);
    if (watchers.get(key) === start.entry) watchers.delete(key);
  }
  if (start.client || start.connectStarted) {
    try {
      await disconnectAccount(start.accountId);
    } catch {
      // Non-fatal: connection may already be closed.
    }
    start.client = null;
  }
}

/**
 * Stop the IDLE watcher for an account.
 * Disconnects the IMAP connection and removes the watcher from the registry.
 * Idempotent — safe to call if no watcher exists.
 */
export async function stopWatcher(projectId: string, accountId?: string): Promise<void> {
  const resolvedAccountId = accountId ?? projectId;
  const key = accountId
    ? watcherKey(projectId, accountId)
    : [...startingWatchers.keys(), ...watchers.keys()].find((candidate) => candidate.endsWith(`\u0000${resolvedAccountId}`));
  if (!key) return;
  const starting = startingWatchers.get(key);
  if (starting) {
    starting.cancelled = true;
    if (starting.entry) starting.entry.running = false;
    await starting.promise.catch(() => undefined);
    return;
  }

  const entry = watchers.get(key);
  if (!entry) return;
  await stopStoredWatcher(key, entry);
}

async function stopStoredWatcher(key: string, entry: WatcherEntry): Promise<void> {
  entry.running = false;
  detachExistsListener(entry);
  try {
    await disconnectAccount(entry.accountId);
  } catch {
    // Non-fatal: connection may already be closed
  }
  if (watchers.get(key) === entry) watchers.delete(key);
}

function detachExistsListener(entry: WatcherEntry): void {
  const client = entry.client as ImapClient & {
    off?: (event: string, listener: ExistsHandler) => void;
    removeListener?: (event: string, listener: ExistsHandler) => void;
  };
  try {
    if (typeof client.off === "function") {
      client.off("exists", entry.existsHandler);
    } else if (typeof client.removeListener === "function") {
      client.removeListener("exists", entry.existsHandler);
    }
  } catch {
    // Listener cleanup is best-effort; disconnect still closes the client.
  }
}

/** Stop every watcher this process owns during API shutdown. */
export async function stopAllWatchers(): Promise<void> {
  const keys = new Set([...watchers.keys(), ...startingWatchers.keys()]);
  await Promise.allSettled([...keys].map((key) => {
    const [projectId, accountId] = key.split("\u0000");
    return stopWatcher(projectId!, accountId!);
  }));
}

/** Get watcher status for an account (whether it's running or stopped). */
export function getWatcherStatus(projectId: string, accountId?: string): { running: boolean } {
  const entry = accountId
    ? watchers.get(watcherKey(projectId, accountId))
    : [...watchers.values()].find((candidate) => candidate.accountId === projectId);
  return { running: entry?.running ?? false };
}

function scheduleWatcherScan(entry: WatcherEntry, propagateError = false): Promise<void> {
  if (!entry.running) return Promise.resolve();
  if (entry.scanPromise) return entry.scanPromise;

  const scanPromise = handleNewEmail(entry, propagateError).finally(() => {
    if (entry.scanPromise === scanPromise) entry.scanPromise = null;
  });
  entry.scanPromise = scanPromise;
  return scanPromise;
}

function touchProcessedUid(entry: WatcherEntry, emailUid: string): void {
  entry.processedUids.delete(emailUid);
  entry.processedUids.set(emailUid, undefined);
  if (entry.processedUids.size > entry.processedUidCapacity) {
    entry.processedUids.delete(entry.processedUids.keys().next().value!);
  }
}

function hasProcessedUid(entry: WatcherEntry, emailUid: string): boolean {
  if (!entry.processedUids.has(emailUid)) return false;
  touchProcessedUid(entry, emailUid);
  return true;
}

function warnMarkerFailure(entry: WatcherEntry, emailUid: string): void {
  if (entry.markerFailureWarnings >= MAX_MARKER_FAILURE_WARNINGS) return;
  entry.markerFailureWarnings++;
  try {
    getEmailRuntime().logger.warn(
      "email-watcher",
      "Durable watcher marker unavailable; skipped side effects until a later scan",
      {
        accountId: entry.accountId,
        folder: entry.folder,
        uid: emailUid,
        retry: entry.markerFailureWarnings,
      },
    );
  } catch {
    // Logging must not turn a failed marker claim into watcher side effects.
  }
}

function rememberProcessedUid(entry: WatcherEntry, emailUid: string): "alreadyProcessed" | "newlyRecorded" | "failed" {
  if (hasProcessedUid(entry, emailUid)) return "alreadyProcessed";

  try {
    const marker = getEmailRuntime().watcherMarkers.remember(
      entry.projectId,
      entry.accountId,
      entry.folder,
      emailUid,
    );
    if (marker.alreadyProcessed === marker.newlyRecorded) {
      throw new Error("Invalid durable watcher marker result");
    }
    touchProcessedUid(entry, emailUid);
    return marker.alreadyProcessed ? "alreadyProcessed" : "newlyRecorded";
  } catch {
    warnMarkerFailure(entry, emailUid);
    return "failed";
  }
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
async function handleNewEmail(entry: WatcherEntry, propagateError = false): Promise<void> {
  if (!entry.running) return;

  try {
    // Fetch and triage recent unreads
    const results = await triageEmails(entry.projectId, entry.accountId, 10);

    for (const triage of results) {
      if (!entry.running) return;
      if (rememberProcessedUid(entry, triage.emailUid) !== "newlyRecorded") continue;

      // Log observation for self-learning pipeline
      await logWatcherObservation(entry.projectId, {
        observation_type: "pattern",
        content: `Email triaged: uid=${triage.emailUid} category=${triage.category} priority=${triage.priority} action=${triage.suggestedAction} skills=${triage.matchedSkills.join(",")} confidence=${triage.confidence}`,
        importance: triage.priority === "high" ? 8 : 5,
      });

      // For high/medium priority with response skills, generate suggestions
      if (triage.priority === "high" || triage.priority === "medium") {
        const suggestion = await suggestResponse(
          entry.projectId,
          entry.accountId,
          triage.emailUid,
          entry.folder,
        );

        if (suggestion && suggestion.confidence > 0.5) {
          const recipient = await parseReplyRecipient(suggestion.originalSender);
          if (!recipient) continue;

          // Auto-save as draft
          try {
            await saveDraft(entry.account, entry.auth, {
              to: [recipient],
              subject: suggestion.subject,
              html: suggestion.body,
              text: suggestion.body.replace(/<[^>]+>/g, ""),
            });

            await logWatcherObservation(entry.projectId, {
              observation_type: "insight",
              content: `Auto-draft saved for uid=${triage.emailUid} using skill=${suggestion.matchedSkill} confidence=${suggestion.confidence}`,
              importance: 7,
            });
          } catch {
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
  } catch (error: unknown) {
    await logWatcherObservation(entry.projectId, {
      observation_type: "error",
      // Do not persist raw error text: it can contain provider diagnostics or tokens.
      content: `Watcher error for account ${entry.accountId}: processing failed`,
      importance: 7,
    });
    if (propagateError) throw error;
  }
}

/**
 * Log an observation through the API-owned runtime boundary.
 * Best-effort: failures are silent (non-critical path).
 */
export async function logWatcherObservation(
  projectId: string,
  data: {
    observation_type: EmailObservation["observation_type"];
    content: EmailObservation["content"];
    importance: EmailObservation["importance"];
  },
): Promise<void> {
  try {
    await getEmailRuntime().recordObservation(projectId, data);
  } catch {
    // Non-fatal: observation logging is best-effort
  }
}
