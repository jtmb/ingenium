/** IMAP operations backed by imapflow with an in-memory connection pool. */

import { ImapFlow } from "imapflow";
import type {
  EmailAccount,
  OAuthToken,
  EmailMessage,
  EmailFolder,
  SearchQuery,
} from "./types.js";
import { parseRawEmail } from "./parser.js";
import { PROVIDERS } from "./providers.js";
import type { ProviderConfig } from "./providers.js";

// ── Connection pool ──────────────────────────────────────────────────────
const pool = new Map<string, ImapFlow>();

/** In-flight connect promises — deduplicates concurrent connectAccount()
 *  calls for the same account to prevent TOCTOU race (two callers both see
 *  pool.get(id) as null, both create ImapFlow clients, second pool.set
 *  overwrites the first — leaking a connection with no error handler). */
const connectingLocks = new Map<string, Promise<ImapFlow>>();

/** Resolve the provider configuration for an account. */
function getProviderConfig(account: EmailAccount): ProviderConfig {
  return PROVIDERS[account.provider];
}

/** Build auth object for imapflow based on account type.
 *  🔴 OAuth fallthrough guard: if authType is "oauth2" but accessToken is
 *     missing/empty, throw a clear error instead of falling through to
 *     password auth (which triggers ImapFlow "No password configured"). */
function buildAuth(
  account: EmailAccount,
  auth?: { password?: string; tokens?: OAuthToken },
): { user: string; pass?: string; accessToken?: string } {
  const user = account.email;
  if (account.authType === "oauth2") {
    const accessToken = auth?.tokens?.accessToken;
    if (!accessToken) {
      throw new Error(
        `OAuth2 account "${account.email}" has no access token. ` +
        `Tokens may be expired or not yet provisioned. Re-authenticate the account.`,
      );
    }
    return { user, accessToken };
  }
  // Password/app-password auth — require a non-empty password
  const pass = auth?.password;
  if (!pass) {
    throw new Error(
      `Account "${account.email}" has no password configured. ` +
      `Provide appPassword credentials or switch to OAuth2.`,
    );
  }
  return { user, pass };
}

// ── Public API ───────────────────────────────────────────────────────────

/** Create an IMAP connection for the account and store it in the pool.
 *  🔴 Wrapped in try/catch so connection/auth failures produce normal errors,
 *     never uncaught exceptions (critical for background setImmediate callers). */
export async function connectAccount(
  account: EmailAccount,
  auth: { password?: string; tokens?: OAuthToken },
): Promise<ImapFlow> {
  // ── Deduplicate concurrent connects (Lesson 27: TOCTOU race guard) ──
  // If another caller is already connecting this account, await its promise.
  const connecting = connectingLocks.get(account.id);
  if (connecting) {
    try {
      return await connecting;
    } catch {
      // Previous connect failed — fall through to retry
    }
  }

  // Reuse existing if already connected
  const existing = pool.get(account.id);
  if (existing && existing.usable) {
    return existing;
  }

  // Clean up stale connection
  if (existing) {
    try { await existing.logout(); } catch { /* ignore */ }
  }

  // ── Create connection with mutex guard ────────────────────────────
  const connectPromise = (async () => {
    const config = getProviderConfig(account);
    const host = account.imapHost || config.imap.host;
    const port = account.imapPort || config.imap.port;

    let client: ImapFlow;
    try {
      client = new ImapFlow({
        host,
        port,
        secure: config.imap.tls,
        auth: buildAuth(account, auth),
        logger: false,
        connectionTimeout: 15000,   // 15s connect timeout
        socketTimeout: 30000,      // 30s socket inactivity timeout
      });
      // 🔴 Attach error/close handlers BEFORE connect() to prevent
      //    unhandled error events from crashing the process (Lesson 24).
      client.on("error", (err: Error) => {
        console.error(`[imap] pool error for ${account.email}:`, err.message);
        pool.delete(account.id);
      });
      client.on("close", () => {
        pool.delete(account.id);
      });
      await client.connect();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `IMAP connection failed for account "${account.email}" (${host}:${port}): ${msg}`,
      );
    }
    pool.set(account.id, client);
    return client;
  })();

  connectingLocks.set(account.id, connectPromise);
  try {
    return await connectPromise;
  } finally {
    connectingLocks.delete(account.id);
  }
}

/** Disconnect and remove an account from the connection pool. */
export async function disconnectAccount(accountId: string): Promise<void> {
  const client = pool.get(accountId);
  if (client) {
    try { await client.logout(); } catch { /* ignore */ }
    pool.delete(accountId);
  }
}

/** Get a live connection from the pool (throws if not connected). */
export function getConnection(accountId: string): ImapFlow {
  const client = pool.get(accountId);
  if (!client || !client.usable) {
    throw new Error(`No active IMAP connection for account ${accountId}`);
  }
  return client;
}

/** Map our SearchQuery to imapflow's SearchObject. */
function buildSearchCriteria(query: SearchQuery): Record<string, unknown> {
  const crit: Record<string, unknown> = {};
  if (query.query) crit.text = query.query;
  if (query.unseen) crit.unseen = true;
  if (query.flagged) crit.flagged = true;
  if (query.answered) crit.answered = true;
  if (query.from) crit.from = query.from;
  if (query.to) crit.to = query.to;
  if (query.subject) crit.subject = query.subject;
  if (query.since) crit.since = query.since;
  if (query.before) crit.before = query.before;
  return crit;
}

/** Check if a SearchQuery has any active filter criteria. */
function hasSearchCriteria(query: SearchQuery): boolean {
  return !!(query.query || query.unseen || query.flagged || query.answered ||
    query.from || query.to || query.subject || query.since || query.before);
}

/** List and paginate emails from a folder.
 *  Uses windowed sequence-range fetch (default 200) to avoid scanning 62K+ mailboxes. */
export async function listEmails(
  accountId: string,
  folder: string,
  page: number,
  limit: number,
  query?: SearchQuery,
  windowSize: number = 200,
): Promise<{ messages: EmailMessage[]; total: number }> {
  const client = getConnection(accountId);
  await client.mailboxOpen(folder);

  const total = (client.mailbox as { exists: number }).exists;

  // ── Filtered search path (limited results, no windowing needed) ────
  if (query && hasSearchCriteria(query)) {
    const criteria = buildSearchCriteria(query);
    const matchResult = await client.search(criteria);
    const matches = matchResult === false ? [] : matchResult;
    const matchCount = matches.length;

    const sorted = [...matches].reverse();
    const start = (page - 1) * limit;
    const pageUids = sorted.slice(start, start + limit);

    const messages: EmailMessage[] = [];
    for await (const msg of client.fetch(pageUids, { envelope: true, uid: true, flags: true, source: true }, { uid: true })) {
      const raw = msg.source?.toString("utf-8") ?? "";
      const parsed = await parseRawEmail(raw);
      parsed.uid = String(msg.uid);
      parsed.flags = msg.flags ? [...msg.flags] : [];
      parsed.folder = folder;
      messages.push(parsed);
    }

    messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { messages, total: matchCount };
  }

  // ── Unfiltered path — windowed sequence-range fetch ─────────────────
  if (total === 0) {
    return { messages: [], total: 0 };
  }

  const windowStart = Math.max(1, total - windowSize + 1);
  const rangeStr = `${windowStart}:${total}`;

  const messages: EmailMessage[] = [];
  for await (const msg of client.fetch(
    rangeStr,
    { envelope: true, uid: true, flags: true, source: true },
  )) {
    const raw = msg.source?.toString("utf-8") ?? "";
    const parsed = await parseRawEmail(raw);
    parsed.uid = String(msg.uid);
    parsed.flags = msg.flags ? [...msg.flags] : [];
    parsed.folder = folder;
    messages.push(parsed);
  }

  // Sort newest first by date
  messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Apply pagination within the window
  const start = (page - 1) * limit;
  const paged = messages.slice(start, start + limit);

  return { messages: paged, total };
}

/** Get a single email by UID. */
export async function getEmail(
  accountId: string,
  folder: string,
  uid: string | number,
): Promise<EmailMessage | null> {
  const client = getConnection(accountId);
  await client.mailboxOpen(folder);

  const fetched = await client.fetchOne(uid, { envelope: true, uid: true, flags: true, source: true }, { uid: true });
  if (!fetched) return null;

  const raw = fetched.source?.toString("utf-8") ?? "";
  const parsed = await parseRawEmail(raw);
  parsed.uid = String(fetched.uid);
  parsed.flags = fetched.flags ? [...fetched.flags] : [];
  parsed.folder = folder;
  return parsed;
}

/** Search emails in a folder and return matching UIDs. */
export async function searchEmails(
  accountId: string,
  folder: string,
  query: SearchQuery,
): Promise<number[]> {
  const client = getConnection(accountId);
  await client.mailboxOpen(folder);

  const criteria = buildSearchCriteria(query);
  const result = await client.search(criteria);
  return result === false ? [] : result;
}

/** Move an email from one folder to another (copy + delete). */
export async function moveEmail(
  accountId: string,
  uid: string | number,
  fromFolder: string,
  toFolder: string,
): Promise<void> {
  const client = getConnection(accountId);
  await client.mailboxOpen(fromFolder);

  // Copy message to destination folder
  await client.messageCopy(uid, toFolder, { uid: true });
  // Mark original as deleted and expunge
  await client.messageFlagsSet(uid, ["\\Deleted"], { uid: true });
  await client.messageDelete(uid, { uid: true });
}

/** Set flags on an email. */
export async function setFlags(
  accountId: string,
  folder: string,
  uid: string | number,
  flags: string[],
): Promise<void> {
  const client = getConnection(accountId);
  await client.mailboxOpen(folder);
  await client.messageFlagsSet(uid, flags, { uid: true });
}

/** Delete an email by UID. */
export async function deleteEmail(
  accountId: string,
  folder: string,
  uid: string | number,
): Promise<void> {
  const client = getConnection(accountId);
  await client.mailboxOpen(folder);
  await client.messageFlagsSet(uid, ["\\Deleted"], { uid: true });
  await client.messageDelete(uid, { uid: true });
}

/** List all mailboxes/folders with status information. */
export async function listFolders(
  accountId: string,
): Promise<EmailFolder[]> {
  const client = getConnection(accountId);
  const folders = await client.list({
    statusQuery: { messages: true, unseen: true },
  });

  return folders.map((f) => ({
    name: f.name,
    path: f.path,
    delimiter: f.delimiter,
    flags: [...f.flags],
    totalMessages: f.status?.messages ?? 0,
    unreadMessages: f.status?.unseen ?? 0,
  }));
}
