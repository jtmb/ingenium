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

import { emailCache, logger, settings } from "ingenium-core";
import { listAccounts, getAccount, getCredentials, getGlobalProjectId } from "./accounts.js";
import { GmailProvider } from "./providers/gmail.js";
import type { MailProvider } from "./providers/mail-provider.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface FolderEngineState {
  folder: string;
  state: "idle" | "syncing-headers" | "backfilling-bodies" | "complete" | "error";
  headersSynced: number;
  headersTotal: number;
  bodiesCached: number;
  bodiesWindow: number;        // the window cap from settings
  lastSyncedAt: string | null; // ISO timestamp
  lastError: string | null;
}

export interface EngineStatus {
  running: boolean;
  heartbeatAt: string | null;  // ISO, updated EVERY loop tick even on errors
  accounts: { accountId: string; email: string; folders: FolderEngineState[] }[];
}

// ── Internal task queue ─────────────────────────────────────────────────────

type TaskPriority = 0 | 1 | 2 | 3 | 4 | 5;

interface EngineTask {
  priority: TaskPriority;
  type: "sync-folder" | "backfill-bodies";
  accountId: string;
  folder: string;
  /** Specific UID to prioritize for body fetch (from boostBody). */
  boostUid?: string;
}

// ── Default settings ────────────────────────────────────────────────────────

const DEFAULT_OFFLINE_WINDOW = 500;   // max headers per folder
const DEFAULT_BODY_WINDOW = 200;      // max bodies per folder
const DEFAULT_SYNC_INTERVAL_MS = 300_000; // 5 min
const GMAIL_POLL_INTERVAL_MS = 30_000;    // 30s delta poll (cheap — empty response when nothing changed)
const TASK_WATCHDOG_MS = 5 * 60_000;      // 5 min — abort stuck tasks
const BODY_BATCH_SIZE = 5;                // batch body fetches in groups of 5 (rate limit safe)
const BODY_BATCH_YIELD_MS = 200;          // yield between body fetch groups
const LOOP_YIELD_MS = 1000;               // yield between full account loop ticks
const TASK_PROCESS_YIELD_MS = 100;        // yield between individual tasks in a loop

// ── Engine singleton state ──────────────────────────────────────────────────

interface AccountWorker {
  accountId: string;
  email: string;
  projectId: string;
  running: boolean;
  /** The mail provider — GmailProvider (stateless HTTPS, no connection needed). */
  provider: MailProvider;
  /** Priority-ordered task queue (lowest priority number = highest priority). */
  taskQueue: EngineTask[];
  /** Per-folder engine state. */
  folderStates: Map<string, FolderEngineState>;
  /** Folders boosted by boostFolder() — cleared after sync. */
  boostedFolders: Set<string>;
  /** Specific UIDs boosted by boostBody() — front-loaded in body backfill. */
  boostedBodyUids: Map<string, Set<string>>; // key: folder
  /** The worker's async loop promise (used for stop). */
  loopPromise: Promise<void> | null;
  /** AbortController for stopping the loop. */
  abortController: AbortController | null;
}

const engineState: {
  running: boolean;
  heartbeatAt: string | null;
  workers: Map<string, AccountWorker>;
  projectId: string | null;
} = {
  running: false,
  heartbeatAt: null,
  workers: new Map(),
  projectId: null,
};

// ── Settings helpers ────────────────────────────────────────────────────────

function getProjectId(): string {
  if (engineState.projectId) return engineState.projectId;
  return getGlobalProjectId();
}

function readSetting(key: string, defaultVal: number): number {
  try {
    const pid = getProjectId();
    const val = settings.getSetting(pid, key);
    if (val !== undefined) {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n > 0) return n;
    }
  } catch {
    // fall through to default
  }
  return defaultVal;
}

function getOfflineWindow(): number {
  return readSetting("mail_offline_window", DEFAULT_OFFLINE_WINDOW);
}

function getBodyWindow(): number {
  return readSetting("mail_body_window", DEFAULT_BODY_WINDOW);
}

function getSyncIntervalMs(): number {
  return readSetting("mail_sync_interval_ms", DEFAULT_SYNC_INTERVAL_MS);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function tickHeartbeat(): void {
  engineState.heartbeatAt = nowISO();
}

/**
 * Push a task onto a worker's task queue, maintaining priority order.
 * If a task for the same account+folder+type already exists at equal or
 * higher priority, the new task is skipped (dedup).
 */
function enqueueTask(worker: AccountWorker, task: EngineTask): void {
  // Dedup: skip if same folder+type is already queued at same or higher priority
  const existing = worker.taskQueue.find(
    t => t.accountId === task.accountId &&
      t.folder === task.folder &&
      t.type === task.type,
  );
  if (existing && existing.priority <= task.priority) {
    return; // already queued at equal or higher priority, skip
  }
  // Remove any lower-priority duplicate
  if (existing) {
    worker.taskQueue = worker.taskQueue.filter(t => t !== existing);
  }

  // Insert in priority order
  let inserted = false;
  for (let i = 0; i < worker.taskQueue.length; i++) {
    if (worker.taskQueue[i]!.priority > task.priority) {
      worker.taskQueue.splice(i, 0, task);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    worker.taskQueue.push(task);
  }
}

function getFolderState(worker: AccountWorker, folder: string): FolderEngineState {
  let state = worker.folderStates.get(folder);
  if (!state) {
    state = {
      folder,
      state: "idle",
      headersSynced: 0,
      headersTotal: 0,
      bodiesCached: 0,
      bodiesWindow: getBodyWindow(),
      lastSyncedAt: null,
      lastError: null,
    };
    worker.folderStates.set(folder, state);
  }
  return state;
}

function setFolderState(
  worker: AccountWorker,
  folder: string,
  partial: Partial<Omit<FolderEngineState, "folder">>,
): void {
  const state = getFolderState(worker, folder);
  Object.assign(state, partial);
}

/**
 * Return true if a folder was synced recently enough to skip.
 */
function isFolderFresh(accountId: string, folder: string): boolean {
  const interval = getSyncIntervalMs();
  const st = emailCache.getSyncState(accountId, folder);
  if (!st.last_synced_at) return false;
  const msSince = Date.now() - new Date(st.last_synced_at).getTime();
  return msSince < interval;
}

// ── Watchdog timer ──────────────────────────────────────────────────────────

function withWatchdog<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Watchdog timeout after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// ── Account worker ──────────────────────────────────────────────────────────

async function runAccountWorker(worker: AccountWorker): Promise<void> {
  logger.info("sync-engine", `Worker started for ${worker.email}`);

  try {
    const account = getAccount(worker.projectId, worker.accountId);
    if (!account) {
      logger.warn("sync-engine", `Worker for ${worker.accountId}: account not found, stopping`);
      return;
    }

    const creds = getCredentials(worker.projectId, worker.accountId);
    if (!creds) {
      logger.warn("sync-engine", `Worker for ${worker.email}: no credentials, stopping`);
      return;
    }

    const tokens = creds.tokens;
    if (!tokens) {
      logger.warn("sync-engine", `Worker for ${worker.email}: no OAuth tokens, stopping`);
      return;
    }

    // Discover folders via provider (already assigned in spawnWorkers)
    let folders: string[] = [];
    try {
      const folderList = await worker.provider.listFolders(account, tokens);
      folders = folderList.map(f => f.path);

      // Initialize folder states for all discovered folders
      for (const f of folders) {
        getFolderState(worker, f);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("sync-engine", `Worker for ${worker.email}: listFolders failed: ${msg}`);
      // Continue with empty folder list — we can still do INBOX
      folders = ["INBOX"];
    }

    // Ensure INBOX is in the folder list
    if (!folders.includes("INBOX")) {
      folders.unshift("INBOX");
    }

    let roundRobinIndex = 0;
    let lastDeltaPoll = 0;

    // ── Main loop ──────────────────────────────────────────────────────
    while (worker.running && !worker.abortController?.signal.aborted) {
      tickHeartbeat();

      // ── P0: Gmail delta poll (every GMAIL_POLL_INTERVAL_MS) ──────────
      if (Date.now() - lastDeltaPoll >= GMAIL_POLL_INTERVAL_MS) {
        lastDeltaPoll = Date.now();
        try {
          const { historyId } = emailCache.getAccountCursor(worker.accountId);
          const delta = await worker.provider.changesSince(account, tokens, historyId || null);

          if (delta.fullResyncRequired) {
            logger.info("sync-engine",
              `Full resync required for ${worker.email} (historyId ${historyId ?? "none"})`,
            );
            // Enqueue sync-folder for every folder at P2 priority
            for (const folder of folders) {
              enqueueTask(worker, {
                priority: 2,
                type: "sync-folder",
                accountId: worker.accountId,
                folder,
              });
            }
            // Set the new cursor after resync — GmailProvider always returns a
            // non-empty cursor now (profile historyId), so the cursor advances
            // and the next delta poll is incremental.
            emailCache.setAccountCursor(worker.accountId, delta.newCursor || "", "gmail");
          } else {
            // Apply upserts to cache
            if (delta.upserts.length > 0) {
              for (const msg of delta.upserts) {
                emailCache.upsertEmailCache(worker.accountId, msg.folder, [{
                  uid: msg.id,
                  subject: msg.subject,
                  from_name: msg.fromName,
                  from_addr: msg.fromAddr,
                  date: msg.date,
                  snippet: msg.snippet,
                  flags: JSON.stringify(msg.flags),
                  has_attachments: msg.hasAttachments ? 1 : 0,
                  envelope_json: msg.envelopeJson,
                }]);
                // Trigger body backfill for upserted messages (P4)
                enqueueTask(worker, {
                  priority: 4,
                  type: "backfill-bodies",
                  accountId: worker.accountId,
                  folder: msg.folder,
                });
              }
              logger.info("sync-engine",
                `Delta upserts for ${worker.email}: ${delta.upserts.length} messages`,
              );
            }

            // Deletes: log for now — per-UID cache deletion not yet supported
            if (delta.deletes.length > 0) {
              logger.info("sync-engine",
                `Delta deletes for ${worker.email}: ${delta.deletes.length} messages (cache cleanup not yet implemented)`,
              );
            }

            // Store new cursor unconditionally — GmailProvider always returns a
            // non-empty cursor now (even for fullResyncRequired, it fetches the
            // profile historyId).  Skipping the save here would cause every
            // delta poll to be a full resync.
            emailCache.setAccountCursor(worker.accountId, delta.newCursor || "", "gmail");
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn("sync-engine", `Delta poll failed for ${worker.email}: ${msg}`);
          // Non-fatal: continue the loop
        }
      }

      // ── Generate maintenance tasks if queue is empty ─────────────────
      if (worker.taskQueue.length === 0) {
        // P1: Check boosted folders first
        for (const folder of worker.boostedFolders) {
          enqueueTask(worker, {
            priority: 1,
            type: "sync-folder",
            accountId: worker.accountId,
            folder,
          });
        }
        worker.boostedFolders.clear();

        // P2: INBOX if stale
        if (!isFolderFresh(worker.accountId, "INBOX")) {
          enqueueTask(worker, {
            priority: 2,
            type: "sync-folder",
            accountId: worker.accountId,
            folder: "INBOX",
          });
        }

        // P3: Round-robin all folders (skip fresh)
        if (folders.length > 0) {
          const folder = folders[roundRobinIndex % folders.length]!;
          roundRobinIndex++;
          if (!isFolderFresh(worker.accountId, folder)) {
            enqueueTask(worker, {
              priority: 3,
              type: "sync-folder",
              accountId: worker.accountId,
              folder,
            });
          }
        }

        // P4: Body backfill — find folders with missing bodies
        for (const folder of folders) {
          const uids = emailCache.getUidsMissingBodies(worker.accountId, folder, 1);
          if (uids.length > 0) {
            const fs = getFolderState(worker, folder);
            if (fs.bodiesCached < fs.bodiesWindow) {
              enqueueTask(worker, {
                priority: 4,
                type: "backfill-bodies",
                accountId: worker.accountId,
                folder,
              });
            }
          }
        }

        // P5: Deeper history — only if body window already full but boosted
        for (const folder of worker.boostedFolders) {
          const fs = getFolderState(worker, folder);
          if (fs.bodiesCached >= fs.bodiesWindow) {
            // Still have uncached bodies beyond the window
            const uids = emailCache.getUidsMissingBodies(worker.accountId, folder, 1);
            if (uids.length > 0) {
              enqueueTask(worker, {
                priority: 5,
                type: "backfill-bodies",
                accountId: worker.accountId,
                folder,
              });
            }
          }
        }
      }

      // ── Process next task ^ ───────────────────────────────────────────
      if (worker.taskQueue.length > 0) {
        const task = worker.taskQueue.shift()!;
        await executeTask(worker, task);
        // Small yield between tasks so other workers get CPU time
        await sleep(TASK_PROCESS_YIELD_MS);
      } else {
        // No tasks — sleep before next round
        await sleep(LOOP_YIELD_MS);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("sync-engine", `Worker for ${worker.email} crashed: ${msg}`);
  } finally {
    logger.info("sync-engine", `Worker stopped for ${worker.email}`);
  }
}

// ── Task execution ──────────────────────────────────────────────────────────

async function executeTask(worker: AccountWorker, task: EngineTask): Promise<void> {
  const { accountId, folder } = task;
  tickHeartbeat();

  switch (task.type) {
    case "sync-folder": {
      await executeSyncFolder(worker, accountId, folder);
      break;
    }
    case "backfill-bodies": {
      await executeBackfillBodies(worker, accountId, folder, task.boostUid);
      break;
    }
  }
}

async function executeSyncFolder(
  worker: AccountWorker,
  accountId: string,
  folder: string,
): Promise<void> {
  setFolderState(worker, folder, { state: "syncing-headers", lastError: null });

  try {
    const account = getAccount(worker.projectId, accountId);
    if (!account) {
      logger.warn("sync-engine", `executeSyncFolder: account ${accountId} not found`);
      setFolderState(worker, folder, { state: "error", lastError: "Account not found" });
      return;
    }
    const creds = getCredentials(worker.projectId, accountId);
    if (!creds?.tokens) {
      logger.warn("sync-engine", `executeSyncFolder: no tokens for ${worker.email}`);
      setFolderState(worker, folder, { state: "error", lastError: "No OAuth tokens" });
      return;
    }

    const offlineWindow = getOfflineWindow();
    const messages = await withWatchdog(
      worker.provider.listMessages(account, creds.tokens, folder, offlineWindow),
      TASK_WATCHDOG_MS,
      `listMessages ${worker.email}/${folder}`,
    );

    // Upsert each message into the cache
    for (const msg of messages) {
      emailCache.upsertEmailCache(accountId, msg.folder, [{
        uid: msg.id,
        subject: msg.subject,
        from_name: msg.fromName,
        from_addr: msg.fromAddr,
        date: msg.date,
        snippet: msg.snippet,
        flags: JSON.stringify(msg.flags),
        has_attachments: msg.hasAttachments ? 1 : 0,
        envelope_json: msg.envelopeJson,
      }]);
    }

    // Update folder state
    const bodyWindow = getBodyWindow();
    const cachedTotal = messages.length;
    const missingUids = emailCache.getUidsMissingBodies(accountId, folder, 1);
    const bodyCount = Math.max(0, cachedTotal - missingUids.length);

    setFolderState(worker, folder, {
      state: cachedTotal === 0 ? "complete" : "syncing-headers",
      headersSynced: Math.min(cachedTotal, offlineWindow),
      headersTotal: offlineWindow,
      bodiesCached: bodyCount,
      bodiesWindow: bodyWindow,
      lastSyncedAt: nowISO(),
      lastError: null,
    });

    logger.info("sync-engine",
      `Synced ${worker.email}/${folder}: ${cachedTotal} headers, ${bodyCount} bodies`,
    );

    // 🔴 L16: Persist last_synced_at to DB so isFolderFresh() survives
    // process restarts.  The Gmail REST API doesn't have IMAP UIDs, so we
    // pass dummy values for those fields — isFolderFresh() only reads
    // last_synced_at.
    try {
      emailCache.updateSyncState(accountId, folder, "0", 0);
    } catch { /* non-fatal — don't abort sync over DB write failure */ }

    // If bodies missing and not at window cap, queue body backfill
    if (missingUids.length > 0 && bodyCount < bodyWindow) {
      enqueueTask(worker, {
        priority: 4,
        type: "backfill-bodies",
        accountId,
        folder,
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("sync-engine", `executeSyncFolder FAILED for ${worker.email}/${folder}: ${msg}`);
    setFolderState(worker, folder, { state: "error", lastError: msg });
  }
}

async function executeBackfillBodies(
  worker: AccountWorker,
  accountId: string,
  folder: string,
  boostUid?: string,
): Promise<void> {
  setFolderState(worker, folder, { state: "backfilling-bodies", lastError: null });

  try {
    const account = getAccount(worker.projectId, accountId);
    if (!account) {
      logger.warn("sync-engine", `executeBackfillBodies: account ${accountId} not found`);
      setFolderState(worker, folder, { state: "error", lastError: "Account not found" });
      return;
    }
    const creds = getCredentials(worker.projectId, accountId);
    if (!creds?.tokens) {
      logger.warn("sync-engine", `executeBackfillBodies: no tokens for ${worker.email}`);
      setFolderState(worker, folder, { state: "error", lastError: "No OAuth tokens" });
      return;
    }

    const bodyWindow = getBodyWindow();

    // Check how many bodies we still need
    let uidsToFetch: string[];

    if (boostUid) {
      // Specific UID boosted — front-load it
      uidsToFetch = [boostUid];
      // Add remaining missing bodies
      const remaining = emailCache.getUidsMissingBodies(accountId, folder, bodyWindow);
      for (const uid of remaining) {
        if (uid !== boostUid) uidsToFetch.push(uid);
      }
    } else {
      uidsToFetch = emailCache.getUidsMissingBodies(accountId, folder, bodyWindow);
    }

    if (uidsToFetch.length === 0) {
      // Check if we're at complete state
      const cachedTotal = emailCache.getCachedEmails(accountId, folder, 1, 1).total;
      const stillMissing = emailCache.getUidsMissingBodies(accountId, folder, 1);
      if (stillMissing.length === 0 && cachedTotal > 0) {
        setFolderState(worker, folder, { state: "complete" });
      } else {
        setFolderState(worker, folder, { state: "idle" });
      }
      return;
    }

    // Cap at body window
    uidsToFetch = uidsToFetch.slice(0, bodyWindow);

    // Fetch in batches of BODY_BATCH_SIZE with yields between batches
    let backfilled = 0;
    for (let i = 0; i < uidsToFetch.length; i += BODY_BATCH_SIZE) {
      const batch = uidsToFetch.slice(i, i + BODY_BATCH_SIZE);

      // Fetch each body in the batch sequentially (provider.getBody rate-limit safe)
      for (const uid of batch) {
        try {
          const body = await worker.provider.getBody(account, creds.tokens, uid);
          emailCache.upsertEmailBody(
            accountId, folder, uid,
            body.html ?? null,
            body.text ?? null,
            JSON.stringify({ attachments: body.attachments }),
          );
          backfilled++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn("sync-engine",
            `executeBackfillBodies FAILED for ${worker.email}/${folder} uid=${uid}: ${msg}`,
          );
          // Continue with next UID instead of aborting all backfill
        }
      }

      // Yield between batches
      if (i + BODY_BATCH_SIZE < uidsToFetch.length) {
        await sleep(BODY_BATCH_YIELD_MS);
      }
    }

    // Update state
    const cachedTotal = emailCache.getCachedEmails(accountId, folder, 1, 1).total;
    const stillMissing = emailCache.getUidsMissingBodies(accountId, folder, 1);
    const bodyCount = Math.max(0, cachedTotal - stillMissing.length);

    const newState: FolderEngineState["state"] =
      stillMissing.length === 0 && cachedTotal > 0
        ? "complete"
        : bodyCount >= bodyWindow
          ? "complete"
          : "backfilling-bodies";

    setFolderState(worker, folder, {
      state: newState,
      bodiesCached: bodyCount,
      bodiesWindow: bodyWindow,
      lastSyncedAt: nowISO(),
      lastError: null,
    });

    logger.info("sync-engine",
      `Backfilled ${backfilled} bodies for ${worker.email}/${folder} ` +
      `(${bodyCount}/${cachedTotal} cached)`,
    );

    // 🔴 L16: Persist last_synced_at to DB so isFolderFresh() survives restarts.
    try {
      emailCache.updateSyncState(accountId, folder, "0", 0);
    } catch { /* non-fatal */ }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("sync-engine", `executeBackfillBodies FAILED for ${worker.email}/${folder}: ${msg}`);
    setFolderState(worker, folder, { state: "error", lastError: msg });
  }
}

// ── Utility ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Public API (PINNED CONTRACT) ────────────────────────────────────────────

/**
 * Start the background sync engine for a given project.
 * Launches one worker per connected email account.
 * Idempotent: calling startEngine on an already-running engine is a no-op.
 */
export function startEngine(projectId: string): void {
  if (engineState.running) {
    logger.info("sync-engine", "Engine already running, skipping startEngine");
    return;
  }

  engineState.projectId = projectId;
  engineState.running = true;
  engineState.heartbeatAt = nowISO();

  logger.info("sync-engine", `Starting sync engine for project ${projectId}`);

  // Launch workers asynchronously
  spawnWorkers(projectId).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("sync-engine", `spawnWorkers failed: ${msg}`);
  });
}

async function spawnWorkers(projectId: string): Promise<void> {
  const pid = getProjectId();
  const accounts = listAccounts(pid);

  if (accounts.length === 0) {
    logger.info("sync-engine", "No email accounts configured, engine idle");
    return;
  }

  for (const acct of accounts) {
    // Skip if worker already exists
    if (engineState.workers.has(acct.id)) continue;

    const worker: AccountWorker = {
      accountId: acct.id,
      email: acct.email,
      projectId,
      running: true,
      provider: GmailProvider,
      taskQueue: [],
      folderStates: new Map(),
      boostedFolders: new Set(),
      boostedBodyUids: new Map(),
      loopPromise: null,
      abortController: new AbortController(),
    };

    engineState.workers.set(acct.id, worker);

    // Fire and forget — worker runs in background
    worker.loopPromise = runAccountWorker(worker).finally(() => {
      engineState.workers.delete(acct.id);
    });

    logger.info("sync-engine", `Worker launched for ${acct.email}`);
  }
}

/**
 * Stop the background sync engine gracefully.
 * Aborts all workers and waits for them to finish.
 */
export async function stopEngine(): Promise<void> {
  if (!engineState.running) return;

  logger.info("sync-engine", "Stopping sync engine...");
  engineState.running = false;

  const stopPromises: Promise<void>[] = [];

  for (const [, worker] of engineState.workers) {
    worker.running = false;
    worker.abortController?.abort();
    if (worker.loopPromise) {
      stopPromises.push(
        worker.loopPromise.catch(() => {
          // Ignore — we're stopping anyway
        }),
      );
    }
  }

  await Promise.all(stopPromises);
  engineState.workers.clear();
  engineState.heartbeatAt = null;

  logger.info("sync-engine", "Sync engine stopped");
}

/**
 * Boost a folder to P1 priority — called from UI when user clicks a folder.
 * Non-blocking, fire-and-forget.
 */
export function boostFolder(accountId: string, folder: string): void {
  const worker = engineState.workers.get(accountId);
  if (!worker) {
    logger.warn("sync-engine", `boostFolder: no worker for ${accountId}`);
    return;
  }

  worker.boostedFolders.add(folder);
  logger.info("sync-engine", `boostFolder: ${accountId}/${folder}`);
}

/**
 * Boost a specific UID for body backfill — called from GET /:uid when
 * body cache-miss returns 202. Adds the UID to the front of the body
 * backfill queue for that folder.
 * Non-blocking, fire-and-forget.
 */
export function boostBody(accountId: string, folder: string, uid: string): void {
  const worker = engineState.workers.get(accountId);
  if (!worker) {
    logger.warn("sync-engine", `boostBody: no worker for ${accountId}`);
    return;
  }

  let uidSet = worker.boostedBodyUids.get(folder);
  if (!uidSet) {
    uidSet = new Set();
    worker.boostedBodyUids.set(folder, uidSet);
  }
  uidSet.add(uid);

  // Immediately enqueue a backfill task with the boosted UID
  enqueueTask(worker, {
    priority: 1, // Same as boosted folder — fetch this body now
    type: "backfill-bodies",
    accountId,
    folder,
    boostUid: uid,
  });

  logger.info("sync-engine", `boostBody: ${accountId}/${folder} uid=${uid}`);
}

/**
 * Return the current engine status for dashboard/monitoring.
 * Includes heartbeat, running state, and per-account folder states.
 */
export function getEngineStatus(): EngineStatus {
  const accounts: EngineStatus["accounts"] = [];

  for (const worker of engineState.workers.values()) {
    const folders: FolderEngineState[] = [];
    for (const state of worker.folderStates.values()) {
      folders.push({ ...state });
    }
    accounts.push({
      accountId: worker.accountId,
      email: worker.email,
      folders,
    });
  }

  return {
    running: engineState.running,
    heartbeatAt: engineState.heartbeatAt,
    accounts,
  };
}
