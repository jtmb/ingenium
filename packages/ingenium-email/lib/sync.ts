/** Email sync — IMAP-to-DB synchronization with UIDVALIDITY tracking.
 *  Always uses the global project regardless of passed projectId. */

import { emailCache } from "ingenium-core";
import { getAccount, getCredentials, getGlobalProjectId } from "./accounts.js";
import { connectAccount, listFolders } from "./imap.js";
import { parseRawEmail } from "./parser.js";

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
 * @param maxBatch Maximum emails to sync per call (default 200). Prevents timeout on 62K+ mailboxes.
 * @returns SyncResult with folder name, count of newly synced, total in mailbox.
 */
export async function syncFolder(
  _projectId: string,
  accountId: string,
  folder: string,
  maxBatch: number = 200,
): Promise<SyncResult> {
  const projectId = getGlobalProjectId();
  const account = getAccount(projectId, accountId);
  if (!account) {
    return { folder, synced: 0, total: 0, error: `Account ${accountId} not found` };
  }

  const creds = getCredentials(projectId, accountId);
  if (!creds) {
    return { folder, synced: 0, total: 0, error: `No credentials for ${accountId}` };
  }

  const auth = { password: creds.password, tokens: creds.tokens };

  try {
    const client = await connectAccount(account, auth);
    await client.mailboxOpen(folder);

    // UIDVALIDITY — if it changed, the server renumbered UIDs.
    // Clear the entire account cache and start fresh.
    const uidValidity: number = (client.mailbox as any)?.uidValidity ?? 0;
    const state = emailCache.getSyncState(accountId, folder);

    if (state.uidvalidity > 0 && uidValidity > 0 && state.uidvalidity !== uidValidity) {
      emailCache.clearCache(accountId);
    }

    const lastUid = state.uidvalidity === uidValidity ? state.last_uid : 0;
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
      return { folder, synced: 0, total };
    }

    // Fetch and cache each new email
    const cacheEntries: emailCache.EmailCacheEntry[] = [];
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

    return { folder, synced, total };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { folder, synced: 0, total: 0, error: msg };
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
): Promise<SyncResult[]> {
  const projectId = getGlobalProjectId();
  const account = getAccount(projectId, accountId);
  if (!account) {
    return [{ folder: "__all__", synced: 0, total: 0, error: `Account ${accountId} not found` }];
  }

  const creds = getCredentials(projectId, accountId);
  if (!creds) {
    return [{ folder: "__all__", synced: 0, total: 0, error: `No credentials for ${accountId}` }];
  }

  const auth = { password: creds.password, tokens: creds.tokens };

  try {
    await connectAccount(account, auth);
    const folders = await listFolders(accountId);

    const results: SyncResult[] = [];
    for (const folder of folders) {
      const result = await syncFolder(projectId, accountId, folder.path);
      results.push(result);
    }

    return results;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [{ folder: "__all__", synced: 0, total: 0, error: msg }];
  }
}
