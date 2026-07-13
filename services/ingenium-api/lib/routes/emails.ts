import { Router, Response } from "express";
import { requireProject } from "../helpers.js";
import { logger, emailCache } from "ingenium-core";
import {
  // Account CRUD
  listAccounts,
  getAccount,
  addAccount,
  removeAccount,
  getCredentials,
  storeCredentials,
  storeTokens,
  // IMAP
  connectAccount,
  disconnectAccount,
  listEmails,
  getEmail,
  searchEmails,
  moveEmail,
  setFlags,
  deleteEmail,
  listFolders,
  // SMTP
  sendEmail,
  saveDraft,
  // OAuth
  getOAuthUrl,
  exchangeCode,
  getValidTokens,
  // Triage
  triageEmails,
  // Responder
  suggestResponse,
  // Watcher
  startWatcher,
  getWatcherStatus,
  stopWatcher,
  // Sync
  syncFolder,
  syncAccountFolders,
} from "ingenium-email";
import type {
  EmailAccount,
  OAuthToken,
  SearchQuery,
  SendOptions,
  EmailProvider,
  EmailMessage,
} from "ingenium-email";

export const emailsRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────

/** Resolve account + credentials or send a 422/404 and return null. */
async function getAccountAuthOrError(
  res: Response,
  projectId: string,
  accountId?: string,
): Promise<{ account: EmailAccount; auth: { password?: string; tokens?: OAuthToken } } | null> {
  if (!accountId) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "account query parameter is required" },
    });
    return null;
  }
  const account = getAccount(projectId, accountId);
  if (!account) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: `Email account '${accountId}' not found` },
    });
    return null;
  }
  const creds = getCredentials(projectId, accountId);
  if (!creds) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: `Credentials for account '${accountId}' not found` },
    });
    return null;
  }
  // Refresh OAuth tokens if expired
  let tokens = creds.tokens;
  if (account.authType === "oauth2" && tokens?.expiryDate && tokens.expiryDate < Date.now() + 60_000) {
    try {
      const refreshed = await getValidTokens(projectId, accountId, account.provider as EmailProvider);
      if (refreshed) tokens = refreshed;
    } catch { /* use existing tokens */ }
  }
  return { account, auth: { password: creds.password, tokens } };
}

/** Wrapper that connects, runs the callback. Only disconnects on errors.
 *  Let the connection pool manage connections for normal operations. */
async function withImapConnection<T>(
  account: EmailAccount,
  auth: { password?: string; tokens?: OAuthToken },
  fn: (accountId: string) => Promise<T>,
): Promise<T> {
  await connectAccount(account, auth);
  try {
    return await fn(account.id);
  } catch (err) {
    await disconnectAccount(account.id).catch(() => {
      /* non-fatal */
    });
    throw err;
  }
}

// ── OAuth Routes (before parameterized /accounts/:id) ─────────────────────

/** GET /accounts/oauth/url?project=&provider= — Get OAuth authorization URL. */
emailsRouter.get("/accounts/oauth/url", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const provider = (req.query.provider as string) ?? "";
  const validProviders: EmailProvider[] = ["gmail", "outlook", "yahoo", "custom"];
  if (!validProviders.includes(provider as EmailProvider)) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "provider must be one of: gmail, outlook, yahoo, custom" },
    });
    return;
  }

  getOAuthUrl(provider as EmailProvider, projectId)
    .then((result) => res.json({ data: result }))
    .catch((err: any) => {
      logger.error("email", `Failed to generate OAuth URL for ${provider}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
      res.status(500).json({ error: { code: "OAUTH_ERROR", message: err.message } });
    });
});

/** POST /accounts/oauth?project= — Exchange OAuth code for tokens. */
emailsRouter.post("/accounts/oauth", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { provider, code, state, redirectUri, accountId } = req.body;
  if (!provider || !code || !state) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "provider, code, and state are required in body" },
    });
    return;
  }

  try {
    const tokens = await exchangeCode(provider, code, state, redirectUri, projectId);
    
    // Create the account if it doesn't exist yet
    let acctId = accountId;
    if (!acctId) {
      const existingAccounts = listAccounts(projectId);
      const existing = existingAccounts.find(a => a.email === tokens.email);
      if (existing) {
        acctId = existing.id;
      } else {
        const account = addAccount(projectId, {
          email: tokens.email || `${provider}-${Date.now()}@unknown`,
          provider: provider as EmailProvider,
          authType: "oauth2",
          name: tokens.email || `${provider} account`,
        });
        acctId = account.id;
      }
    }
    
    // Store tokens server-side — never return them to the client
    storeTokens(projectId, acctId, tokens);
    res.json({ data: { success: true, accountId: acctId } });
  } catch (err: any) {
    logger.error("email", "OAuth code exchange failed", { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "OAUTH_ERROR", message: err.message } });
  }
});

// ── Account Management ───────────────────────────────────────────────────

/** GET /accounts?project= — List all email accounts. */
emailsRouter.get("/accounts", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accounts = listAccounts(projectId);
  res.json({ data: accounts, total: accounts.length });
});

/** POST /accounts?project= — Add a new email account. */
emailsRouter.post("/accounts", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { email, provider, authType, name, appPassword, imapHost, smtpHost, imapPort, smtpPort } = req.body;
  if (!email || !provider || !authType) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "email, provider, and authType are required" },
    });
    return;
  }

  const account = addAccount(projectId, {
    email,
    provider,
    authType,
    name: name ?? email,
    imapHost,
    imapPort,
    smtpHost,
    smtpPort,
  });

  // Store credentials if provided
  if (appPassword) {
    storeCredentials(projectId, account.id, {
      imapPass: appPassword,
      smtpPass: appPassword,
    });
  }

  res.status(201).json({ data: account });
});

/** DELETE /accounts/:id?project= — Remove an email account. */
emailsRouter.delete("/accounts/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.params.id!;
  const account = getAccount(projectId, accountId);
  if (!account) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: `Email account '${accountId}' not found` },
    });
    return;
  }

  removeAccount(projectId, accountId);
  res.status(204).send();
  return;
});

/** POST /accounts/:id/test?project= — Test IMAP connection for an account. */
emailsRouter.post("/accounts/:id/test", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.params.id!;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const { account, auth } = result;
  let connected = false;
  try {
    await connectAccount(account, auth);
    connected = true;
    const folders = await listFolders(account.id);
    res.json({ data: { success: true, folders } });
  } catch (err: any) {
    res.json({ data: { success: false, error: err.message } });
  } finally {
    if (connected) {
      await disconnectAccount(account.id).catch(() => {});
    }
  }
});

// ── Email Operations (fixed paths before /:uid) ──────────────────────────

/** GET /search?project=&account=&folder=&q=&from=&to=&subject=&since=&before= — Search emails. */
emailsRouter.get("/search", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const folder = (req.query.folder as string) ?? "INBOX";
  const { account, auth } = result;

  const query: SearchQuery = {};
  if (req.query.q) query.query = req.query.q as string;
  if (req.query.from) query.from = req.query.from as string;
  if (req.query.to) query.to = req.query.to as string;
  if (req.query.subject) query.subject = req.query.subject as string;
  if (req.query.since) query.since = req.query.since as string;
  if (req.query.before) query.before = req.query.before as string;

  try {
    const uids = await withImapConnection(account, auth, (id) =>
      searchEmails(id, folder, query),
    );
    res.json({ data: uids, total: uids.length });
  } catch (err: any) {
    logger.error("email", `Search failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
  }
});

/** GET /folders?project=&account= — List IMAP folders. */
emailsRouter.get("/folders", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const { account, auth } = result;
  try {
    const folders = await withImapConnection(account, auth, (id) => listFolders(id));
    res.json({ data: folders, total: folders.length });
  } catch (err: any) {
    logger.error("email", `List folders failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
  }
});

/** GET /triage?project=&account=&limit= — Triage unread emails. */
emailsRouter.get("/triage", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const { account, auth } = result;
  const limit = parseInt((req.query.limit as string) ?? "20", 10) || 20;

  try {
    const triageResults = await withImapConnection(account, auth, (id) =>
      triageEmails(projectId, id, limit),
    );
    res.json({ data: triageResults, total: triageResults.length });
  } catch (err: any) {
    logger.error("email", `Triage failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
  }
});

/** GET /suggest/:uid?project=&account=&folder= — Suggest a response for an email. */
emailsRouter.get("/suggest/:uid", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const uid = parseInt(req.params.uid!, 10);
  if (isNaN(uid)) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid must be a number" },
    });
    return;
  }

  const folder = (req.query.folder as string) ?? "INBOX";
  const { account, auth } = result;

  try {
    const suggestion = await withImapConnection(account, auth, (id) =>
      suggestResponse(projectId, id, uid, folder),
    );
    if (!suggestion) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: `No response suggestion for UID ${uid}` },
      });
      return;
    }
    res.json({ data: suggestion });
  } catch (err: any) {
    logger.error("email", `Suggest response failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
  }
});

// ── Watcher Routes ───────────────────────────────────────────────────────

/** POST /watch/start?project=&account= — Start IMAP IDLE watcher. */
emailsRouter.post("/watch/start", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = (req.query.account as string) ?? req.body.account;
  if (!accountId) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "account is required" },
    });
    return;
  }

  try {
    await startWatcher(projectId, accountId);
    res.json({ data: { running: true, accountId } });
  } catch (err: any) {
    logger.error("email", `Failed to start watcher for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "WATCHER_ERROR", message: err.message } });
  }
});

/** POST /watch/stop?project=&account= — Stop IMAP IDLE watcher. */
emailsRouter.post("/watch/stop", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = (req.query.account as string) ?? req.body.account;
  if (!accountId) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "account is required" },
    });
    return;
  }

  try {
    await stopWatcher(accountId);
    res.json({ data: { running: false, accountId } });
  } catch (err: any) {
    logger.error("email", `Failed to stop watcher for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "WATCHER_ERROR", message: err.message } });
  }
});

/** GET /watch/status?project=&account= — Get watcher status for an account. */
emailsRouter.get("/watch/status", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.query.account as string | undefined;
  if (!accountId) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "account query parameter is required" },
    });
    return;
  }

  const status = getWatcherStatus(accountId);
  res.json({ data: status });
});

// ── Root Email Routes ────────────────────────────────────────────────────

/** POST /sync?project=&account=&folder= — Trigger DB-backed email sync.
 *  POST /emails/sync?account=<id>            — sync all folders
 *  POST /emails/sync?account=<id>&folder=X   — sync single folder */
emailsRouter.post("/sync", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  // Support both query params and body for account/folder
  const accountId = (req.query.account as string) ?? req.body.account;
  if (!accountId) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "account query parameter is required" },
    });
    return;
  }

  const folder = (req.query.folder as string) ?? null;

  try {
    if (folder) {
      // Sync single folder
      const result = await syncFolder(projectId, accountId, folder);
      if (result.error) {
        res.status(500).json({ error: { code: "SYNC_ERROR", message: result.error } });
        return;
      }
      res.json({ data: { folder, synced: result.synced, total: result.total } });
    } else {
      // Sync all folders
      const results = await syncAccountFolders(projectId, accountId);
      const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
      const errors = results.filter((r) => r.error).map((r) => ({ folder: r.folder, error: r.error }));
      res.json({
        data: {
          account: accountId,
          folders: results.length,
          totalSynced,
          results: results.map((r) => ({ folder: r.folder, synced: r.synced, total: r.total })),
          errors: errors.length > 0 ? errors : undefined,
        },
      });
    }
  } catch (err: any) {
    logger.error("email", `Sync failed for account ${accountId}`, { error: err.message, name: err.name, method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "SYNC_ERROR", message: err.message } });
  }
});

/** Convert a cached email row to an EmailMessage-compatible shape for the API. */
function cachedToEmailMessage(c: emailCache.CachedEmail): Partial<EmailMessage> {
  let envelope: Record<string, unknown> = {};
  if (c.envelope_json) {
    try { envelope = JSON.parse(c.envelope_json) as Record<string, unknown>; } catch { /* empty */ }
  }
  return {
    uid: c.uid,
    subject: c.subject ?? "(no subject)",
    from: Array.isArray(envelope.from) ? (envelope.from as EmailMessage["from"]) : [{ name: c.from_name ?? undefined, address: c.from_addr ?? "" }],
    to: Array.isArray(envelope.to) ? (envelope.to as EmailMessage["to"]) : [],
    cc: Array.isArray(envelope.cc) ? (envelope.cc as EmailMessage["cc"]) : [],
    date: c.date ?? new Date().toISOString(),
    body: { text: c.snippet ?? undefined },
    attachments: c.has_attachments ? [] : [],  // attachment detail lives in body cache
    flags: ((): string[] => { try { return JSON.parse(c.flags) as string[]; } catch { return []; } })(),
    folder: c.folder,
    messageId: (envelope.messageId as string) ?? undefined,
    threadId: (envelope.threadId as string) ?? undefined,
    inReplyTo: (envelope.inReplyTo as string) ?? undefined,
    references: (envelope.references as string) ?? undefined,
  };
}

/** GET /?project=&account=&folder=&page=&limit=&refresh= — List and paginate emails.
 *  Uses DB cache when available; falls back to direct IMAP. */
emailsRouter.get("/", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const folder = (req.query.folder as string) ?? "INBOX";
  const page = parseInt((req.query.page as string) ?? "1", 10) || 1;
  const limit = parseInt((req.query.limit as string) ?? "50", 10) || 50;
  const refresh = req.query.refresh === "true";

  const { account, auth } = result;

  // ── Force refresh: skip cache, fetch from IMAP, populate cache ──────
  if (refresh) {
    try {
      const { messages, total } = await withImapConnection(account, auth, (id) =>
        listEmails(id, folder, page, limit),
      );
      // Populate cache in background (fire-and-forget)
      setImmediate(() => {
        syncFolder(projectId, account.id, folder).catch(() => {});
      });
      res.json({ data: messages, total, source: "imap" });
      return;
    } catch (err: any) {
      logger.error("email", `List emails (refresh) failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
      res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
      return;
    }
  }

  // ── Check DB cache first ───────────────────────────────────────────
  const { emails: cached, total: cachedTotal } = emailCache.getCachedEmails(
    account.id, folder, page, limit,
  );

  if (cached.length > 0) {
    // We have cached data — return it immediately.
    // Optionally trigger a background sync if cache might be stale.
    const state = emailCache.getSyncState(account.id, folder);
    const lastSynced = state.last_synced_at ? new Date(state.last_synced_at).getTime() : 0;
    const staleThresholdMs = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - lastSynced > staleThresholdMs) {
      setImmediate(() => {
        syncFolder(projectId, account.id, folder).catch(() => {});
      });
    }

    res.json({
      data: cached.map(cachedToEmailMessage),
      total: cachedTotal,
      source: "cache",
    });
    return;
  }

  // ── No cache — fall back to IMAP, populating cache for next time ───
  try {
    const { messages, total } = await withImapConnection(account, auth, (id) =>
      listEmails(id, folder, page, limit),
    );

    // Populate cache in background
    setImmediate(() => {
      syncFolder(projectId, account.id, folder).catch(() => {});
    });

    res.json({ data: messages, total, source: "imap" });
  } catch (err: any) {
    logger.error("email", `List emails failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
  }
});

/** POST /draft?project= — Save a draft email. */
emailsRouter.post("/draft", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.body.account;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const { to, cc, bcc, subject, html, text, inReplyTo, references } = req.body;
  if (!to || !subject) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "to and subject are required in body" },
    });
    return;
  }

  const { account, auth } = result;
  const options: SendOptions = { to, subject };
  if (cc) options.cc = cc;
  if (bcc) options.bcc = bcc;
  if (html) options.html = html;
  if (text) options.text = text;
  if (inReplyTo) options.inReplyTo = inReplyTo;
  if (references) options.references = references;

  try {
    const messageId = await saveDraft(account, auth, options);
    res.status(201).json({ data: { messageId } });
  } catch (err: any) {
    logger.error("email", `Save draft failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "SMTP_ERROR", message: err.message } });
  }
});

/** POST /?project= — Send an email. */
emailsRouter.post("/", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.body.account;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const { to, cc, bcc, subject, html, text, inReplyTo, references } = req.body;
  if (!to || !subject) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "to and subject are required in body" },
    });
    return;
  }

  const { account, auth } = result;
  const options: SendOptions = { to, subject };
  if (cc) options.cc = cc;
  if (bcc) options.bcc = bcc;
  if (html) options.html = html;
  if (text) options.text = text;
  if (inReplyTo) options.inReplyTo = inReplyTo;
  if (references) options.references = references;

  try {
    const messageId = await sendEmail(account, auth, options);
    res.status(201).json({ data: { messageId } });
  } catch (err: any) {
    logger.error("email", `Send email failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "SMTP_ERROR", message: err.message } });
  }
});

// ── UID Parameterized Routes ─────────────────────────────────────────────

/** GET /:uid?project=&account=&folder= — Get a single email by UID. */
emailsRouter.get("/:uid", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const uid = parseInt(req.params.uid!, 10);
  if (isNaN(uid)) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid must be a number" },
    });
    return;
  }

  const folder = (req.query.folder as string) ?? "INBOX";
  const { account, auth } = result;

  try {
    const email = await withImapConnection(account, auth, (id) =>
      getEmail(id, folder, uid),
    );
    if (!email) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: `Email with UID ${uid} not found in ${folder}` },
      });
      return;
    }
    res.json({ data: email });
  } catch (err: any) {
    logger.error("email", `Get email failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
  }
});

/** PATCH /:uid/move?project= — Move an email to another folder. */
emailsRouter.patch("/:uid/move", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.body.account;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const uid = parseInt(req.params.uid!, 10);
  if (isNaN(uid)) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid must be a number" },
    });
    return;
  }

  const { fromFolder, toFolder } = req.body;
  if (!fromFolder || !toFolder) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "fromFolder and toFolder are required in body" },
    });
    return;
  }

  const { account, auth } = result;
  try {
    await withImapConnection(account, auth, (id) =>
      moveEmail(id, uid, fromFolder, toFolder),
    );
    res.json({ data: { moved: true, uid, fromFolder, toFolder } });
  } catch (err: any) {
    logger.error("email", `Move email failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
  }
});

/** PATCH /:uid/flags?project= — Set flags on an email. */
emailsRouter.patch("/:uid/flags", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.body.account;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const uid = parseInt(req.params.uid!, 10);
  if (isNaN(uid)) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid must be a number" },
    });
    return;
  }

  const { folder, flags } = req.body;
  if (!folder || !Array.isArray(flags)) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "folder and flags[] are required in body" },
    });
    return;
  }

  const { account, auth } = result;
  try {
    await withImapConnection(account, auth, (id) =>
      setFlags(id, folder, uid, flags),
    );
    res.json({ data: { flagsSet: true, uid, folder, flags } });
  } catch (err: any) {
    logger.error("email", `Set flags failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
  }
});

/** DELETE /:uid?project= — Delete an email. */
emailsRouter.delete("/:uid", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const accountId = req.body.account;
  const result = await getAccountAuthOrError(res, projectId, accountId);
  if (!result) return;

  const uid = parseInt(req.params.uid!, 10);
  if (isNaN(uid)) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid must be a number" },
    });
    return;
  }

  const folder = req.body.folder ?? "INBOX";
  const { account, auth } = result;

  try {
    await withImapConnection(account, auth, (id) =>
      deleteEmail(id, folder, uid),
    );
    res.status(204).send();
    return;
  } catch (err: any) {
    logger.error("email", `Delete email failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
  }
});
