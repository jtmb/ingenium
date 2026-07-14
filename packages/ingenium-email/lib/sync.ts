/** Email sync — IMAP-to-DB synchronization with UIDVALIDITY tracking.
 *  Always uses the global project regardless of passed projectId. */

import { emailCache, logger } from "ingenium-core";
import { getAccount, getCredentials, getGlobalProjectId } from "./accounts.js";
import { connectAccount, listFolders } from "./imap.js";
import { parseRawEmail } from "./parser.js";

/**
 * 🔴 Single-flight deduplication map — prevents concurrent syncFolder calls
 * for the same account+ folder within one process. Keyed by `${accountId}\x00${folder}`.
 * In-memory by design: guards concurrency within a process lifetime, not freshness.
 * A process restart naturally clears the guard, which is correct — new process, new guards.
 */
const inFlightSyncs = new Map<string, Promise<SyncResult>>();

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
export async function syncFolder(
  _projectId: string,
  accountId: string,
  folder: string,
  maxBatch: number = 200,
): Promise<SyncResult> {
  const key = `${accountId}\x00${folder}`;
  const existing = inFlightSyncs.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<SyncResult> => {
  const projectId = getGlobalProjectId();
  const account = getAccount(projectId, accountId);
  if (!account) {
    logger.warn("email", `syncFolder SKIP: account ${accountId} not found`);
    return { folder, synced: 0, total: 0, error: `Account ${accountId} not found` };
  }

  const creds = getCredentials(projectId, accountId);
  if (!creds) {
    logger.warn("email", `syncFolder SKIP: no credentials for ${accountId}`);
    return { folder, synced: 0, total: 0, error: `No credentials for ${accountId}` };
  }

  const auth = { password: creds.password, tokens: creds.tokens };

  try {
    const client = await connectAccount(account, auth);
    await client.mailboxOpen(folder);

    // UIDVALIDITY — if it changed, the server renumbered UIDs.
    // Clear the entire account cache and start fresh.
    const uidValidity = Number((client.mailbox as any)?.uidValidity ?? 0);
    const state = emailCache.getSyncState(accountId, folder);

    if (state.uidvalidity > 0 && uidValidity > 0 && Number(state.uidvalidity) !== uidValidity) {
      logger.warn("email", `UIDVALIDITY changed for ${account.email}/${folder}: was ${state.uidvalidity}, now ${uidValidity} — clearing folder cache`);
      emailCache.clearFolderCache(accountId, folder);
    }

    const lastUid = Number(state.uidvalidity) === uidValidity ? state.last_uid : 0;
    const total = (client.mailbox as { exists: number }).exists;

    // ── Resolve UIDs to sync ──────────────────────────────────────────
    let uids: number[];

    if (lastUid === 0) {
      // First sync — use windowed sequence-range to avoid scanning all messages.
      // Fetch by sequence, capturing UIDs, for the most recent maxBatch emails.
      const windowStart = Math.max(1, total - maxBatch + 1);
      const fetchedUids: number[] = [];
      for await (const msg of client.fetch(
        `${windowStart}:${total}`,
        { uid: true },
      )) {
        fetchedUids.push(msg.uid);
      }
      uids = fetchedUids;
    } else {
      // Incremental sync — UIDs > last_uid, capped at maxBatch
      try {
        const result = await client.search({ uid: `${lastUid + 1}:*` } as Record<string, unknown>);
        uids = (result === false ? [] : (result as number[])).slice(0, maxBatch);
      } catch {
        // Range search may not be supported — fall back to search-all + filter
        const allResult = await client.search({ all: true });
        uids = (allResult === false ? [] : allResult)
          .filter((uid) => uid > lastUid)
          .slice(0, maxBatch);
      }
    }

    if (uids.length === 0) {
      // No new emails — still persist sync state so future syncs skip this range
      emailCache.updateSyncState(accountId, folder, lastUid || 0, uidValidity);
      logger.info("email", `Synced ${account.email}/${folder}: 0 new (total ${total})`);
      return { folder, synced: 0, total };
    }

    // Fetch and cache each new email
    const cacheEntries: emailCache.EmailCacheEntry[] = [];
    // Track parsed results for body prefetch (last 50 most recent across ALL folders)
    const allParsed: Array<{ uid: number; html: string | undefined; text: string | undefined; messageId: string | undefined; threadId: string | undefined; inReplyTo: string | undefined; references: string | undefined }> = [];
    let maxUid = lastUid;

    for await (const msg of client.fetch(uids, {
      envelope: true,
      uid: true,
      flags: true,
      bodyStructure: true,
      source: true,
    }, { uid: true })) {
      try {
        const raw = msg.source?.toString("utf-8") ?? "";
        const parsed = await parseRawEmail(raw);

        cacheEntries.push({
          uid: msg.uid,
          subject: parsed.subject,
          from_name: parsed.from[0]?.name ?? null,
          from_addr: parsed.from[0]?.address ?? null,
          date: parsed.date,
          snippet: (parsed.body.text ?? "").substring(0, 200) || parsed.subject,
          flags: JSON.stringify(parsed.flags),
          has_attachments: parsed.attachments.length > 0 ? 1 : 0,
          envelope_json: JSON.stringify({
            subject: parsed.subject,
            from: parsed.from,
            to: parsed.to,
            cc: parsed.cc,
            date: parsed.date,
            messageId: parsed.messageId,
            threadId: parsed.threadId,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
          }),
        });

        // Collect parsed body for body prefetch (all folders)
        if (parsed.body.html || parsed.body.text) {
          allParsed.push({
            uid: msg.uid,
            html: parsed.body.html,
            text: parsed.body.text,
            messageId: parsed.messageId,
            threadId: parsed.threadId,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
          });
        }

        if (msg.uid > maxUid) maxUid = msg.uid;
      } catch {
        // Skip individual emails that fail to parse — don't block the batch
        continue;
      }
    }

    // Upsert into cache
    const synced = emailCache.upsertEmailCache(accountId, folder, cacheEntries);

    // Update sync state so next sync only fetches what's newer
    emailCache.updateSyncState(accountId, folder, maxUid, uidValidity);

    logger.info("email", `Synced ${account.email}/${folder}: ${synced} new (total ${total}, last_uid=${maxUid})`);

    // ── Body prefetch: cache bodies for the 50 most recent emails ──
    if (allParsed.length > 0) {
      try {
        const recentParsed = allParsed
          .sort((a, b) => b.uid - a.uid)
          .slice(0, 50);

        let bodiesCached = 0;
        for (const p of recentParsed) {
          try {
            const headersJson = p.messageId ? JSON.stringify({
              messageId: p.messageId,
              threadId: p.threadId,
              inReplyTo: p.inReplyTo,
              references: p.references,
            }) : null;
            emailCache.upsertEmailBody(
              accountId, folder, p.uid,
              p.html ?? null,
              p.text ?? null,
              headersJson,
            );
            bodiesCached++;
          } catch {
            // Skip individual body upsert failures
          }
        }
        if (bodiesCached > 0) {
          logger.info("email", `Prefetched ${bodiesCached} bodies for ${account.email}/${folder}`);
        }
      } catch (err: unknown) {
        // Body prefetch failure is non-fatal — listings are already synced
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("email", `Body prefetch failed for ${account.email}/${folder} (non-fatal): ${msg}`);
      }
    }

    return { folder, synced, total };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("email", `syncFolder FAILED for ${account.email}/${folder}: ${msg}`);
    return { folder, synced: 0, total: 0, error: msg };
  }
  })(); // close the single-flight IIFE

  inFlightSyncs.set(key, promise);
  promise.finally(() => { inFlightSyncs.delete(key); });
  return promise;
}

/**
 * Backfill email bodies for a folder. Fetches UIDs that exist in email_cache
 * but are missing from email_bodies, then fetches and parses each to populate
 * the body cache. Useful for warming folders that were synced before body
 * prefetch was added for all folders.
 *
 * @param limit Maximum bodies to backfill (default 50).
 * @returns Count of bodies backfilled, or an error sentinel (logged before return).
 */
export async function backfillFolderBodies(
  _projectId: string,
  accountId: string,
  folder: string,
  limit: number = 50,
): Promise<{ folder: string; backfilled: number; error?: string }> {
  const projectId = getGlobalProjectId();
  const account = getAccount(projectId, accountId);
  if (!account) {
    logger.warn("email", `backfillFolderBodies SKIP: account ${accountId} not found`);
    return { folder, backfilled: 0, error: `Account ${accountId} not found` };
  }

  const creds = getCredentials(projectId, accountId);
  if (!creds) {
    logger.warn("email", `backfillFolderBodies SKIP: no credentials for ${accountId}`);
    return { folder, backfilled: 0, error: `No credentials for ${accountId}` };
  }

  const uids = emailCache.getUidsMissingBodies(accountId, folder, limit);
  if (uids.length === 0) {
    logger.info("email", `backfillFolderBodies: no bodies to backfill for ${account.email}/${folder}`);
    return { folder, backfilled: 0 };
  }

  const auth = { password: creds.password, tokens: creds.tokens };

  try {
    const client = await connectAccount(account, auth);
    await client.mailboxOpen(folder);

    let backfilled = 0;
    for await (const msg of client.fetch(uids, { source: true, uid: true }, { uid: true })) {
      try {
        const raw = msg.source?.toString("utf-8") ?? "";
        const parsed = await parseRawEmail(raw);

        if (parsed.body.html || parsed.body.text) {
          const headersJson = parsed.messageId ? JSON.stringify({
            messageId: parsed.messageId,
            threadId: parsed.threadId,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
          }) : null;
          emailCache.upsertEmailBody(
            accountId, folder, msg.uid,
            parsed.body.html ?? null,
            parsed.body.text ?? null,
            headersJson,
          );
          backfilled++;
        }
      } catch {
        // Skip individual emails that fail to parse
        continue;
      }
    }

    logger.info("email", `backfillFolderBodies: cached ${backfilled} bodies for ${account.email}/${folder}`);
    return { folder, backfilled };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("email", `backfillFolderBodies FAILED for ${account.email}/${folder}: ${msg}`);
    return { folder, backfilled: 0, error: msg };
  }
}

/**
 * Sync all folders for an account. Gets folder list via IMAP, connects once,
 * then syncs each folder sequentially.
 *
 * @returns Array of SyncResult, one per folder.
 */
export async function syncAccountFolders(
  _projectId: string,
  accountId: string,
  opts?: {
    skipFresh?: boolean;
    freshMs?: number;
    onFolder?: (folder: string, active: boolean) => void;
  },
): Promise<SyncResult[]> {
  const projectId = getGlobalProjectId();
  const account = getAccount(projectId, accountId);
  if (!account) {
    logger.warn("email", `syncAccountFolders SKIP: account ${accountId} not found`);
    return [{ folder: "__all__", synced: 0, total: 0, error: `Account ${accountId} not found` }];
  }

  const creds = getCredentials(projectId, accountId);
  if (!creds) {
    logger.warn("email", `syncAccountFolders SKIP: no credentials for ${accountId}`);
    return [{ folder: "__all__", synced: 0, total: 0, error: `No credentials for ${accountId}` }];
  }

  const auth = { password: creds.password, tokens: creds.tokens };

  try {
    await connectAccount(account, auth);
    const folders = await listFolders(accountId);

    logger.info("email", `Starting sync for ${account.email}: ${folders.length} folders`);

    const results: SyncResult[] = [];
    for (const folder of folders) {
      // 🔴 Skip Noselect / Nonexistent folders — they can't be synced (producer-side filter)
      const flagStr = folder.flags?.join(" ") ?? "";
      if (/\\noselect|\\nonexistent/i.test(flagStr)) continue;
      // 🔴 Skip the [Gmail] container — it's a virtual parent, not a real mailbox
      if (folder.path === "[Gmail]") continue;

      if (opts?.skipFresh) {
        const st = emailCache.getSyncState(accountId, folder.path);
        const freshMs = opts.freshMs ?? 3_600_000; // 1 hour default
        if (st.last_synced_at) {
          const msSince = Date.now() - new Date(st.last_synced_at).getTime();
          if (msSince < freshMs && st.last_uid > 0) {
            logger.info("email", `skip fresh: ${account.email}/${folder.path} (synced ${Math.round(msSince / 1000)}s ago)`);
            continue;
          }
        }
      }
      opts?.onFolder?.(folder.path, true);
      const result = await syncFolder(projectId, accountId, folder.path);
      opts?.onFolder?.(folder.path, false);
      results.push(result);
    }

    const errors = results.filter(r => r.error);
    const successCount = results.filter(r => !r.error && r.synced > 0).length;
    logger.info("email",
      `Sync complete for ${account.email}: ` +
      `${results.length} folders, ${successCount} had new messages, ${errors.length} errors` +
      (errors.length > 0 ? ` (${errors.map(e => e.folder).join(", ")})` : ""),
    );

    return results;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("email", `syncAccountFolders FAILED for ${account.email}: ${msg}`);
    return [{ folder: "__all__", synced: 0, total: 0, error: msg }];
  }
}
