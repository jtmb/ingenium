import { createHash } from "node:crypto";
import { Router, Response } from "express";
import { logger, emailCache, synthesisLlm, settings } from "ingenium-core";
import {
  // Account CRUD
  listAccounts,
  getAccount,
  addAccount,
  removeAccount,
  storeAccount,
  getCredentials,
  storeCredentials,
  storeTokens,
  getGlobalProjectId,
  // IMAP (write ops only — move, flags, delete)
  connectAccount,
  disconnectAccount,
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
  getFreshGmailToken,
  // Responder
  suggestResponse,
  // LLM smart-reply
  getVoiceSamples,
  generateSmartReplies,
  // LLM email summary
  generateEmailSummary,
  // LLM draft review
  reviewDraft,
  // Watcher
  startWatcher,
  getWatcherStatus,
  stopWatcher,
  // Sync engine (replaces route-triggered syncs)
  startEngine,
  boostFolder,
  boostBody,
  getEngineStatus,
  stopAccountWorker,
  // Connection state
  setAccountConnected,
  // Providers
  GmailProvider,
} from "ingenium-email";
import type {
  EmailAccount,
  EmailAttachment,
  EmailMessage,
  OAuthToken,
  SendOptions,
  EmailProvider,
  FolderEngineState,
} from "ingenium-email";

// ── Engine-backed helpers (no in-memory sync trackers) ──────────────────────

/** Get folder engine state from the sync engine for a given account+folder. */
function getFolderEngineState(accountId: string, folder: string): FolderEngineState | null {
  const status = getEngineStatus();
  const acct = status.accounts.find(a => a.accountId === accountId);
  if (!acct) return null;
  return acct.folders.find(f => f.folder === folder) ?? null;
}

/** Promise-based sleep helper for timeout races in on-demand body/refresh fetches. */
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export const emailsRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Resolve the global project ID for all email operations.
 * Email is always global — the project query param is accepted for
 * backward compatibility but ignored.
 */
function resolveEmailProject(): string {
  return getGlobalProjectId();
}

/** Resolve account + credentials or send a 422/404 and return null. */
async function getAccountAuthOrError(
  res: Response,
  accountId?: string,
): Promise<{ account: EmailAccount; auth: { password?: string; tokens?: OAuthToken } } | null> {
  if (!accountId) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "account query parameter is required" },
    });
    return null;
  }
  const projectId = resolveEmailProject();
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

/** Wrapper that connects, runs the callback, marks account as connected.
 *  🔴 WRITE PATHS ONLY — read paths use the engine via boostFolder/boostBody.
 *  Never disconnects — the shared connection pool and ImapFlow error handlers
 *  manage connection lifecycle. Disconnecting on per-request errors would kill
 *  the pool for all concurrent users. */
async function withImapConnection<T>(
  account: EmailAccount,
  auth: { password?: string; tokens?: OAuthToken },
  fn: (accountId: string) => Promise<T>,
): Promise<T> {
  const projectId = resolveEmailProject();
  await connectAccount(account, auth);
  try {
    const result = await fn(account.id);
    try {
      setAccountConnected(projectId, account.id, true);
    } catch { /* non-fatal */ }
    return result;
  } catch (err) {
    // DO NOT disconnect — the error handler on ImapFlow cleans up dead connections.
    // Disconnecting here kills the shared pool for all concurrent requests.
    const accountHash = createHash("sha256").update(account.email).digest("hex").slice(0, 16);
    logger.error("email", `IMAP operation failed: ${(err as Error).message}`, { accountHash });
    throw err;
  }
}

// ── OAuth Routes (before parameterized /accounts/:id) ─────────────────────

/** GET /accounts/oauth/url?project=&provider= — Get OAuth authorization URL. */
emailsRouter.get("/accounts/oauth/url", (_req, res) => {
  const provider = (_req.query.provider as string) ?? "";
  const validProviders: EmailProvider[] = ["gmail", "outlook", "yahoo", "custom"];
  if (!validProviders.includes(provider as EmailProvider)) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "provider must be one of: gmail, outlook, yahoo, custom" },
    });
    return;
  }

  getOAuthUrl(provider as EmailProvider)
    .then((result) => res.json({ data: result }))
    .catch((err: any) => {
      logger.error("email", `Failed to generate OAuth URL for ${provider}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: _req.method, path: _req.originalUrl });
      res.status(500).json({ error: { code: "OAUTH_ERROR", message: err.message } });
    });
});

/** POST /accounts/oauth?project= — Exchange OAuth code for tokens. */
emailsRouter.post("/accounts/oauth", async (req, res) => {
  const { provider, code, state, redirectUri, accountId } = req.body;
  if (!provider || !code || !state) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "provider, code, and state are required in body" },
    });
    return;
  }

  try {
    const projectId = resolveEmailProject();
    const tokens = await exchangeCode(provider, code, state, redirectUri);

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
    // Replace a parked credential-error worker so OAuth reconnect resumes sync.
    stopAccountWorker(acctId);
    startEngine(projectId);
    res.json({ data: { success: true, accountId: acctId } });
  } catch (err: any) {
    logger.error("email", "OAuth code exchange failed", { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "OAUTH_ERROR", message: err.message } });
  }
});

// ── Account Management ───────────────────────────────────────────────────

/** GET /accounts?project=&include_hidden=true — List all email accounts.
 *  Default: only returns non-hidden accounts. Pass include_hidden=true to get all. */
emailsRouter.get("/accounts", (req, res) => {
  const projectId = resolveEmailProject();
  const includeHidden = req.query.include_hidden === "true";
  let accounts = listAccounts(projectId);
  if (!includeHidden) {
    accounts = accounts.filter(a => !a.hidden);
  }
  res.json({ data: accounts, total: accounts.length });
});

/** POST /accounts?project= — Add a new email account. */
emailsRouter.post("/accounts", (req, res) => {
  const projectId = resolveEmailProject();
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

  startEngine(projectId);
  res.status(201).json({ data: account });
});

/** DELETE /accounts/:id?project= — Remove an email account. */
emailsRouter.delete("/accounts/:id", (req, res) => {
  const projectId = resolveEmailProject();
  const accountId = req.params.id!;
  const account = getAccount(projectId, accountId);
  if (!account) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: `Email account '${accountId}' not found` },
    });
    return;
  }

  // Stop the account's sync engine worker BEFORE deleting data
  stopAccountWorker(accountId);

  removeAccount(projectId, accountId);
  // Also clear all cached emails, bodies, suggestions, summaries, and sync state for this account
  emailCache.clearCache(accountId);
  res.status(204).send();
});

/** PATCH /accounts/:id?project= — Update account metadata (e.g., hidden flag). */
emailsRouter.patch("/accounts/:id", (req, res) => {
  const projectId = resolveEmailProject();
  const accountId = req.params.id!;
  const account = getAccount(projectId, accountId);
  if (!account) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: `Email account '${accountId}' not found` },
    });
    return;
  }

  const { hidden } = req.body;
  if (hidden !== undefined) {
    account.hidden = !!hidden;
  }

  storeAccount(projectId, account);
  res.json({ data: account });
});

/** PATCH /accounts/:id/credentials — Replace app-password credentials in place. */
emailsRouter.patch("/accounts/:id/credentials", async (req, res) => {
  const projectId = resolveEmailProject();
  const accountId = req.params.id!;
  const account = getAccount(projectId, accountId);
  if (!account) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Email account '${accountId}' not found` } });
    return;
  }
  if (account.authType !== "app_password") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "OAuth accounts must be reconnected through the OAuth flow" } });
    return;
  }
  const { appPassword } = req.body;
  if (typeof appPassword !== "string" || !appPassword.trim()) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "appPassword is required" } });
    return;
  }

  try {
    storeCredentials(projectId, accountId, { imapPass: appPassword, smtpPass: appPassword });
    stopAccountWorker(accountId);
    startEngine(projectId);
    // Never return the submitted credential or stored encrypted material.
    res.json({ data: { success: true, accountId } });
  } catch (err: unknown) {
    logger.warn("email", `Credential update failed for account ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
    res.status(409).json({ error: { code: "CREDENTIAL_UPDATE_FAILED", message: "Could not update email credentials. Verify the encryption configuration and try again." } });
  }
});

/** POST /accounts/:id/test?project= — Test IMAP connection for an account. */
emailsRouter.post("/accounts/:id/test", async (req, res) => {
  const accountId = req.params.id!;
  const result = await getAccountAuthOrError(res, accountId);
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

/** GET /search?project=&account=&folder=&q=&from=&to=&subject=&since=&before= — Search emails (cache-only). */
emailsRouter.get("/search", async (req, res) => {
  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const folder = (req.query.folder as string) ?? "INBOX";
  const { account } = result;

  // Cache-only — check if we have cached listings for this folder
  const { emails: cached, total: cachedTotal } = emailCache.getCachedEmails(
    account.id, folder, 1, 1000, // fetch up to 1000 cached emails for filtering
  );

  if (cached.length === 0) {
    // No cached data — hint engine to sync this folder
    boostFolder(account.id, folder);
    res.json({
      data: [],
      total: 0,
      source: "pending",
      message: "No cached data for search. Folder is being synced — retry shortly.",
    });
    return;
  }

  // Filter cached emails by query params
  const q = (req.query.q as string)?.toLowerCase();
  const fromFilter = (req.query.from as string)?.toLowerCase();
  const toFilter = (req.query.to as string)?.toLowerCase();
  const subjFilter = (req.query.subject as string)?.toLowerCase();
  const since = req.query.since as string | undefined;
  const before = req.query.before as string | undefined;

  const filtered = cached.filter((e) => {
    if (q) {
      const snippet = (e.snippet ?? "").toLowerCase();
      const subject = (e.subject ?? "").toLowerCase();
      const from = (e.from_addr ?? "").toLowerCase();
      if (!snippet.includes(q) && !subject.includes(q) && !from.includes(q)) return false;
    }
    if (fromFilter && !(e.from_addr ?? "").toLowerCase().includes(fromFilter)) return false;
    if (toFilter) return false; // cached emails don't have to_addr — skip to filter
    if (subjFilter && !(e.subject ?? "").toLowerCase().includes(subjFilter)) return false;
    if (since && e.date && e.date < since) return false;
    if (before && e.date && e.date > before) return false;
    return true;
  });

  res.json({
    data: filtered.map(cachedToEmailMessage),
    total: filtered.length,
    source: "cache",
    totalCached: cachedTotal,
  });
});

/** GET /folders?project=&account= — List IMAP folders (cache-only). */
emailsRouter.get("/folders", async (req, res) => {
  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const { account } = result;
  const projectId = resolveEmailProject();

  // Read folders from the sync engine (source of truth now)
  try {
    const engineStatus = getEngineStatus();
    const acct = engineStatus.accounts.find(a => a.accountId === account.id);
    if (acct && acct.folders.length > 0) {
      const folders = acct.folders
        .filter(f => f.state !== "error")
        .map(f => ({ name: f.folder, path: f.folder }));
      res.json({ data: folders, total: folders.length, source: "engine" });
      return;
    }
  } catch { /* fall through to settings cache */ }

  // Cache-only — check settings cache
  try {
    const { settings } = await import("ingenium-core");
    const cached = settings.getSetting(projectId, `email_folders_${accountId}`);
    if (cached) {
      let folders = JSON.parse(cached);
      // 🔴 Filter Noselect at the producer (API response), not just the UI
      folders = folders.filter((f: { flags?: string[]; path: string }) => {
        const flagStr = f.flags?.join(" ") ?? "";
        return !(/\\noselect|\\nonexistent/i.test(flagStr)) && f.path !== "[Gmail]";
      });
      // 🔴 Hide Gmail alias folders (e.g. "Sent") when the real [Gmail]/X version exists
      const gmailPaths = new Set(folders.map((f: { path: string }) => f.path));
      folders = folders.filter((f: { path: string }) => {
        if (f.path.startsWith("[Gmail]/")) return true; // keep real folders
        const gmailVariant = `[Gmail]/${f.path}`;
        const gmailVariant2 = `[Gmail]/${f.path} Mail`; // e.g. "Sent" → "[Gmail]/Sent Mail"
        return !gmailPaths.has(gmailVariant) && !gmailPaths.has(gmailVariant2);
      });
      // Hint engine this account is active (folders cache may be stale)
      boostFolder(account.id, "INBOX");
      res.json({ data: folders, total: folders.length, source: "cache" });
      return;
    }
  } catch { /* non-fatal — fall through to empty response */ }

  // No cached folders — hint engine
  boostFolder(account.id, "INBOX");
  res.json({
    data: [],
    total: 0,
    source: "pending",
    message: "No cached folder list. Sync is in progress — retry shortly.",
  });
});

/** GET /triage?project=&account=&limit= — Triage unread emails (cache-only). */
emailsRouter.get("/triage", async (req, res) => {
  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const { account } = result;
  const limit = parseInt((req.query.limit as string) ?? "20", 10) || 20;

  // Cache-only — get cached INBOX emails and return unread ones
  const { emails: cached } = emailCache.getCachedEmails(
    account.id, "INBOX", 1, 200,
  );

  if (cached.length === 0) {
    boostFolder(account.id, "INBOX");
    res.json({
      data: [],
      total: 0,
      source: "pending",
      message: "No cached data for triage. Sync is in progress — retry shortly.",
    });
    return;
  }

  // Filter unread, return at most `limit` items with basic priority
  const unread = cached
    .filter(e => {
      try {
        const flags: string[] = JSON.parse(e.flags);
        return !flags.includes("\\Seen");
      } catch { return true; }
    })
    .slice(0, limit)
    .map(e => {
      const email = cachedToEmailMessage(e);
      // Basic triage without AI: assign "new" priority
      return {
        priority: "medium" as const,
        reason: "Unread message",
        email,
      };
    });

  res.json({ data: unread, total: unread.length, source: "cache" });
});

/** GET /suggest/:uid?project=&account=&folder= — Smart-reply suggestions for an email.
 *  Cache-first: returns cached suggestions instantly.
 *  If no cache + LLM configured → generates via voice-sample LLM.
 *  Falls back to heuristic pattern-matching if no LLM configured. */
emailsRouter.get("/suggest/:uid", async (req, res) => {
  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const uid = req.params.uid!;
  if (!uid || typeof uid !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid is required" },
    });
    return;
  }

  const folder = req.query.folder as string | undefined;
  if (!folder || typeof folder !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "folder query parameter is required" },
    });
    return;
  }
  const { account } = result;
  const projectId = resolveEmailProject();

  // ── Settings gate: smart replies disabled ─────────────────────────────────
  const smartRepliesEnabled = settings.getSetting(projectId, "mail_smart_replies_enabled");
  if (smartRepliesEnabled === "false") {
    res.json({ suggestions: [], source: "disabled", configured: true });
    return;
  }

  // ── Noreply sender check (before cache to avoid stale noreply suggestions) ─
  const senderCheck = emailCache.getCachedEmail(account.id, folder, uid);
  const noreplyPattern = /no[-_.]?reply|do[-_.]?not[-_.]?reply/i;
  const senderAddr = senderCheck?.from_addr ?? "";
  const senderName = senderCheck?.from_name ?? "";
  if (noreplyPattern.test(senderAddr) || noreplyPattern.test(senderName)) {
    res.json({ suggestions: [], source: "noreply", configured: true });
    return;
  }

  // ── 1. Check cached suggestions (instant return) ─────────────────────────
  const cached = emailCache.getCachedSuggestions(account.id, folder, uid);
  if (cached) {
    try {
      const suggestions = JSON.parse(cached.suggestions_json) as Array<{ tone: string; subject: string; body: string }>;
      res.json({ suggestions, source: "cache", configured: true });
      return;
    } catch {
      // Corrupt cache — fall through to regenerate
    }
  }

  // ── 2. Check body cache (required for any suggestion path) ───────────────
  const cachedBody = emailCache.getCachedEmailBody(account.id, folder, uid);
  if (!cachedBody) {
    boostBody(account.id, folder, uid);
    boostFolder(account.id, folder);
    res.status(202).json({
      pending: true,
      message: "Email body being fetched — retry in 1.5s",
      retry: true,
    });
    return;
  }

  // cachedListing is used below to build targetEmail
  const cachedListing = emailCache.getCachedEmail(account.id, folder, uid);

  // ── 3. No cache, body available → generate ──────────────────────────────
  const configured = synthesisLlm.isLLMSynthesisConfigured(projectId);
  if (!configured) {
    // No LLM — fall back to heuristic pattern-matching
    try {
      const suggestion = await suggestResponse(projectId, account.id, uid, folder);
      const suggestions = suggestion
        ? [{ tone: "matched", subject: suggestion.subject, body: suggestion.body }]
        : [];
      if (suggestions.length > 0) {
        emailCache.upsertEmailSuggestions(account.id, folder, uid, suggestions, null);
      }
      res.json({ suggestions, source: "heuristic", configured: false });
    } catch (err: any) {
      logger.error("email", `Suggest response failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
      res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
    }
    return;
  }

  // LLM configured — generate smart replies with voice samples
  try {
    const llmConfig = synthesisLlm.resolveLLMConfig(projectId);
    if (!llmConfig?.model || !llmConfig?.endpoint) {
      // Edge case: config exists but is incomplete
      const suggestion = await suggestResponse(projectId, account.id, uid, folder);
      const suggestions = suggestion
        ? [{ tone: "matched", subject: suggestion.subject, body: suggestion.body }]
        : [];
      if (suggestions.length > 0) {
        emailCache.upsertEmailSuggestions(account.id, folder, uid, suggestions, null);
      }
      res.json({ suggestions, source: "heuristic", configured: false });
      return;
    }

    // Build target email from cache
    const targetEmail = {
      from: cachedListing?.from_addr ?? "unknown",
      subject: cachedListing?.subject ?? "(no subject)",
      bodySnippet: cachedBody.text?.substring(0, 800) ?? cachedListing?.snippet ?? "",
    };

    // Get voice samples from Sent folder
    const creds = getCredentials(projectId, account.id);
    const freshToken = await getFreshGmailToken(account.id).catch(() => "");
    const tokens: OAuthToken = creds?.tokens ?? { accessToken: freshToken, refreshToken: "", expiryDate: 0, scope: "" };
    const voiceSamples = await getVoiceSamples(account, tokens, 15);

    // Generate
    const suggestions = await generateSmartReplies(
      targetEmail,
      voiceSamples,
      { model: llmConfig.model, endpoint: llmConfig.endpoint, apiKey: llmConfig.apiKey, allowPrivateNetwork: llmConfig.allowPrivateNetwork },
    );

    // Persist to cache
    if (suggestions.length > 0) {
      emailCache.upsertEmailSuggestions(
        account.id, folder, uid, suggestions, llmConfig.model ?? null,
      );
    }

    res.json({ suggestions, source: "generated", configured: true });
  } catch (err: any) {
    logger.error("email", `Smart-reply generation failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "LLM_ERROR", message: err.message } });
  }
});

/** GET /summarize/:uid?project=&account=&folder= — LLM-generated email summary.
 *  Cache-first: returns cached summary instantly.
 *  If miss + body cached + LLM configured → generates via LLM.
 *  No noreply gate — summarization works for ALL emails regardless of sender.
 *  🔴 HARD RULE #8: folder is REQUIRED — UIDs are only unique within a folder. */
emailsRouter.get("/summarize/:uid", async (req, res) => {
  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const uid = req.params.uid!;
  if (!uid || typeof uid !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid is required" },
    });
    return;
  }

  const folder = req.query.folder as string | undefined;
  if (!folder || typeof folder !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "folder query parameter is required" },
    });
    return;
  }
  const { account } = result;
  const projectId = resolveEmailProject();

  // ── Check LLM is configured ────────────────────────────────────────────
  const configured = synthesisLlm.isLLMSynthesisConfigured(projectId);
  if (!configured) {
    res.json({ summary: null, source: "not-configured", configured: false });
    return;
  }

  // ── 1. Check cached summary (instant return) ───────────────────────────
  const cached = emailCache.getCachedSummary(account.id, folder, uid);
  if (cached) {
    res.json({ summary: cached.summary_text, source: "cache", configured: true });
    return;
  }

  // ── 2. Check body cache (required for generation) ──────────────────────
  const cachedBody = emailCache.getCachedEmailBody(account.id, folder, uid);
  if (!cachedBody?.text && !cachedBody?.html) {
    // Body not yet cached — get listing snippet as a fallback
    const listing = emailCache.getCachedEmail(account.id, folder, uid);
    if (!listing?.snippet) {
      boostBody(account.id, folder, uid);
      boostFolder(account.id, folder);
      res.status(202).json({
        pending: true,
        message: "Email body being fetched — retry in 1.5s",
        configured: true,
      });
      return;
    }
    // Use snippet as fallback for summary
    const bodyText = listing.snippet;
    const llmConfig = synthesisLlm.resolveLLMConfig(projectId);
    const summary = await generateEmailSummary(bodyText, listing.subject ?? "", llmConfig!);
    if (summary) {
      emailCache.upsertEmailSummary(account.id, folder, uid, summary, llmConfig?.model ?? null);
    }
    res.json({ summary: summary || null, source: summary ? "generated" : "failed", configured: true });
    return;
  }

  // ── 3. Body cached — generate summary via LLM ──────────────────────────
  const llmConfig = synthesisLlm.resolveLLMConfig(projectId);
  if (!llmConfig?.model || !llmConfig?.endpoint) {
    res.json({ summary: null, source: "incomplete-config", configured: true });
    return;
  }

  const bodyText = cachedBody.text ?? cachedBody.html ?? "";
  try {
    const summary = await generateEmailSummary(bodyText, "(from email)", llmConfig);

    // Persist to cache
    if (summary) {
      emailCache.upsertEmailSummary(account.id, folder, uid, summary, llmConfig.model ?? null);
    }

    res.json({ summary: summary || null, source: summary ? "generated" : "failed", configured: true });
  } catch (err: any) {
    logger.error("email", `Email summary generation failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "LLM_ERROR", message: err.message } });
  }
});

/** POST /review-draft — LLM-powered draft review and improvement.
 *  Accepts {text, subject?} and returns improved text.
 *  No caching — every call is a fresh LLM invocation (user-initiated). */
emailsRouter.post("/review-draft", async (req, res) => {
  const projectId = resolveEmailProject();

  // ── Check LLM is configured ────────────────────────────────────────────
  const configured = synthesisLlm.isLLMSynthesisConfigured(projectId);
  if (!configured) {
    res.json({ improved: null, configured: false });
    return;
  }

  const { text, subject } = req.body;
  if (!text || typeof text !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "text (string) is required in body" },
    });
    return;
  }

  const llmConfig = synthesisLlm.resolveLLMConfig(projectId);
  if (!llmConfig?.model || !llmConfig?.endpoint) {
    res.json({ improved: null, configured: true });
    return;
  }

  try {
    const improved = await reviewDraft(text, subject, llmConfig);
    res.json({ improved: improved || null, configured: true });
  } catch (err: any) {
    logger.error("email", `Draft review failed`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "LLM_ERROR", message: err.message } });
  }
});

// ── Watcher Routes ───────────────────────────────────────────────────────

/** POST /watch/start?project=&account= — Start IMAP IDLE watcher. */
emailsRouter.post("/watch/start", async (req, res) => {
  const projectId = resolveEmailProject();
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
emailsRouter.get("/watch/status", (_req, res) => {
  const accountId = _req.query.account as string | undefined;
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

/**
 * POST /sync?project=&account=&folder= — Trigger engine-backed sync hint.
 * Does NOT perform live IMAP — just hints the sync engine to prioritize this folder.
 * POST /emails/sync?account=<id>            — boost all folders
 * POST /emails/sync?account=<id>&folder=X   — boost single folder
 */
emailsRouter.post("/sync", async (req, res) => {
  const accountId = (req.query.account as string) ?? req.body.account;
  if (!accountId) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "account query parameter is required" },
    });
    return;
  }

  const folder = (req.query.folder as string) ?? req.body.folder ?? null;

  try {
    if (folder) {
      boostFolder(accountId, folder);
    } else {
      // Boost all folders marked in engine state for this account
      const engineStatus = getEngineStatus();
      const acct = engineStatus.accounts.find(a => a.accountId === accountId);
      if (acct) {
        for (const fs of acct.folders) {
          boostFolder(accountId, fs.folder);
        }
      } else {
        // Account not in engine yet — boost INBOX to kickstart
        boostFolder(accountId, "INBOX");
      }
    }
    res.json({ data: { accepted: true, account: accountId, folder } });
  } catch (err: any) {
    logger.error("email", `Sync hint failed for account ${accountId}`, { error: err.message, name: err.name, method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "SYNC_ERROR", message: err.message } });
  }
});

/**
 * GET /sync-status?project=&account= — Return per-folder sync status from the engine.
 * Backward-compatible response shape with new `engine` key for raw EngineStatus.
 */
emailsRouter.get("/sync-status", (req, res) => {
  const accountId = req.query.account as string | undefined;
  if (!accountId) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "account query parameter is required" },
    });
    return;
  }

  try {
    const engineStatus = getEngineStatus();
    const acct = engineStatus.accounts.find(a => a.accountId === accountId);

    if (!acct) {
      // Account not in engine — return idle state
      res.json({
        data: {
          overall: "idle" as const,
          account: accountId,
          totalFolders: 0,
          syncingFolders: 0,
          totalCached: 0,
          totalBodies: 0,
          folders: [],
          engine: engineStatus,
        },
      });
      return;
    }

    // Map engine folder states to backward-compatible shape
    const folders = acct.folders.map((fs) => {
      const { total: cachedTotal } = emailCache.getCachedEmails(
        accountId, fs.folder, 1, 1,
      );
      return {
        folder: fs.folder,
        cachedCount: cachedTotal,
        bodyCount: fs.bodiesCached,
        lastSyncedAt: fs.lastSyncedAt,
        syncing: fs.state === "syncing-headers" || fs.state === "backfilling-bodies",
        engineState: fs.state,
      };
    });

    const syncingFolders = folders.filter(f => f.syncing);
    const syncingCount = syncingFolders.length;

    let overall: "idle" | "syncing" | "done";
    if (syncingCount > 0) {
      overall = "syncing";
    } else if (folders.length > 0 && folders.some(f => f.cachedCount > 0)) {
      overall = "done";
    } else {
      overall = "idle";
    }

    const totalCached = folders.reduce((sum, f) => sum + f.cachedCount, 0);
    const totalBodies = folders.reduce((sum, f) => sum + f.bodyCount, 0);

    res.json({
      data: {
        overall,
        account: accountId,
        totalFolders: folders.length,
        syncingFolders: syncingCount,
        totalCached,
        totalBodies,
        folders,
        engine: engineStatus,
      },
    });
  } catch (err: any) {
    logger.error("email", `Sync-status query failed for account ${accountId}`, { error: err.message });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

/** Convert a cached email row to an EmailMessage-compatible shape for the API.
 *  Includes body HTML/Text from the email_bodies cache when available. */
function cachedToEmailMessage(c: emailCache.CachedEmail): Partial<EmailMessage> {
  let envelope: Record<string, unknown> = {};
  if (c.envelope_json) {
    try { envelope = JSON.parse(c.envelope_json) as Record<string, unknown>; } catch { /* empty */ }
  }

  // Check body cache for full HTML/text content
  const cachedBody = emailCache.getCachedEmailBody(c.account_id, c.folder, c.uid);

  // Extract attachment metadata from body cache or envelope
  let attachments: EmailAttachment[] = [];
  if (c.has_attachments) {
    // Try body cache headers_json first (has full attachment metadata from parser)
    if (cachedBody?.headers_json) {
      try {
        const headers = JSON.parse(cachedBody.headers_json);
        if (Array.isArray(headers.attachments)) {
          attachments = headers.attachments;
        }
      } catch { /* ignore */ }
    }
    // Fallback: show placeholder
    if (attachments.length === 0) {
      attachments = [{ filename: "Open in full view to see attachments", size: 0, mimeType: "text/plain", partId: "0" }];
    }
  }

  return {
    uid: c.uid,
    subject: c.subject ?? "(no subject)",
    from: Array.isArray(envelope.from) ? (envelope.from as EmailMessage["from"]) : [{ name: c.from_name ?? undefined, address: c.from_addr ?? "" }],
    to: Array.isArray(envelope.to) ? (envelope.to as EmailMessage["to"]) : [],
    cc: Array.isArray(envelope.cc) ? (envelope.cc as EmailMessage["cc"]) : [],
    date: c.date ?? new Date().toISOString(),
    body: {
      text: cachedBody?.text ?? c.snippet ?? undefined,
      html: cachedBody?.html ?? undefined,
    },
    attachments,
    flags: ((): string[] => { try { return JSON.parse(c.flags) as string[]; } catch { return []; } })(),
    folder: c.folder,
    messageId: (envelope.messageId as string) ?? undefined,
    threadId: (envelope.threadId as string) ?? undefined,
    inReplyTo: (envelope.inReplyTo as string) ?? undefined,
    references: (envelope.references as string) ?? undefined,
  };
}

/**
 * 🔴 GET /?project=&account=&folder=&page=&limit=&refresh=
 * CACHE-ONLY — NEVER BLOCK ON LIVE IMAP.
 *
 * - Always check cache first. Serve instantly if cached.
 * - If cache is empty: return immediately with "pending" status.
 * - ?refresh=true calls boostFolder (non-blocking hint to engine) then returns cache.
 * - The sync engine owns ALL IMAP I/O.
 */
emailsRouter.get("/", async (req, res) => {
  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const folder = (req.query.folder as string) ?? "INBOX";
  const page = parseInt((req.query.page as string) ?? "1", 10) || 1;
  const limit = parseInt((req.query.limit as string) ?? "50", 10) || 50;
  const refresh = req.query.refresh === "true";

  const { account } = result;

  // ── ?refresh=true — synchronous fetch so the refresh button actually works ─
  // 🔴 L30: boostFolder() was fire-and-forget (IMAP connection-pool workaround)
  // that returned stale cached data immediately.  The Gmail REST API has no
  // connection pool constraint — replace with a direct synchronous call.
  if (refresh) {
    try {
      const freshToken = await getFreshGmailToken(account.id);
      const REFRESH_WINDOW = 50; // Gmail API returns 50-100 by default; 50 keeps the UI snappy
      // 10s timeout: Gmail API is typically <2s; 10s gives headroom for rate-limiting backoff
      const messages = await Promise.race([
        GmailProvider.listMessages(
          account,
          { accessToken: freshToken } as OAuthToken,
          folder,
          REFRESH_WINDOW,
        ),
        sleep(10000).then(() => null),
      ]);

      if (messages && messages.length > 0) {
        for (const msg of messages) {
          emailCache.upsertEmailCache(account.id, msg.folder, [{
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
        // Also boost the folder so the engine does deeper backfill
        boostFolder(account.id, folder);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("email", `Refresh fetch failed for ${account.email}/${folder}: ${msg}`);
      // Fall through to cache — serve stale rather than nothing
    }
  }

  // ── Check DB cache ─────────────────────────────────────────────────
  const { emails: cached, total: cachedTotal } = emailCache.getCachedEmails(
    account.id, folder, page, limit,
  );

  if (cached.length > 0) {
    // Cache hit — return immediately
    const folderState = getFolderEngineState(account.id, folder);
    res.json({
      data: cached.map(cachedToEmailMessage),
      total: cachedTotal,
      source: "cache",
      engineState: folderState,
    });
    return;
  }

  // ── Cache miss — return empty, let engine populate asynchronously ──
  const folderState = getFolderEngineState(account.id, folder);
  const engineState = folderState?.state;
  const engineCompleted = engineState === "complete" || engineState === "error";
  res.json({
    data: [],
    total: 0,
    source: engineCompleted ? "cache" : "pending",
    message: engineCompleted 
      ? (engineState === "error" ? folderState?.lastError || "Folder sync failed" : "No messages in this folder")
      : "Syncing this folder. Data will appear shortly.",
    engineState: folderState,
  });
});

/** POST /draft?project= — Save a draft email. */
emailsRouter.post("/draft", async (req, res) => {
  const accountId = req.body.account;
  const result = await getAccountAuthOrError(res, accountId);
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
  const accountId = req.body.account;
  const result = await getAccountAuthOrError(res, accountId);
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

/** GET /:id/attachments/:attachmentId?account=&folder= — Download an attachment by its part ID.
 *  🔴 HARD RULE #8: folder is REQUIRED — attachment lookups are uid-specific. */
emailsRouter.get("/:id/attachments/:attachmentId", async (req, res) => {
  const accountId = req.query.account as string;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const { account } = result;
  const id = req.params.id!;
  const attachmentId = req.params.attachmentId!;
  const folder = req.query.folder as string | undefined;
  if (!folder || typeof folder !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "folder query parameter is required" },
    });
    return;
  }

  // 🔴 L29: The Gmail REST API re-fetched full message in getAttachment()
  // may have a different structure than the original cached message.  When
  // walkParts() can't find the attachment, it falls back to the opaque
  // Gmail attachmentId token (e.g. "ANGjdJ_...") as the filename.
  //
  // Fix: resolve the real filename from the cached email body BEFORE the
  // API call, and use it to override whatever the provider returns.
  let cachedFilename: string | null = null;
  const cachedBody = emailCache.getCachedEmailBody(account.id, folder, id);
  if (cachedBody?.headers_json) {
    try {
      const headers = JSON.parse(cachedBody.headers_json);
      if (Array.isArray(headers.attachments)) {
        const found = headers.attachments.find(
          (a: { partId?: string; attachmentId?: string }) =>
            a.attachmentId === attachmentId || a.partId === attachmentId,
        );
        if (found?.filename) cachedFilename = found.filename;
      }
    } catch { /* ignore parse errors — fall through to provider */ }
  }

  try {
    // Get fresh token and fetch attachment via the Gmail REST API provider
    const freshToken = await getFreshGmailToken(account.id);
    const att = await GmailProvider.getAttachment(account, { accessToken: freshToken } as any, id, attachmentId);

    // ✅ Use the cached filename when available — it's the EXACT filename
    // the Gmail API originally returned, not a fallback token.
    const filename = cachedFilename ?? att.filename;
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', att.data.length);
    res.send(att.data);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'ATTACHMENT_ERROR', message: err.message } });
  }
});

// ── UID Parameterized Routes ─────────────────────────────────────────────

/**
 * GET /:uid?project=&account=&folder= — Get a single email by UID.
 *
 * Fast path: body and listing cached → 200 "cache".
 * On-demand: listing cached, body NOT cached → live Gmail getBody (12s timeout)
 *   → persist → 200 "live". Fallback: 202 only on timeout/error.
 * Cold miss: neither cached → 202 (engine hint).
 *
 * 🔴 HARD RULE #8: folder is REQUIRED — UIDs are only unique within a folder.
 */
emailsRouter.get("/:uid", async (req, res) => {
  const accountId = req.query.account as string | undefined;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const uid = req.params.uid!;
  if (!uid || typeof uid !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid is required" },
    });
    return;
  }

  const folder = req.query.folder as string | undefined;
  if (!folder || typeof folder !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "folder query parameter is required" },
    });
    return;
  }
  const { account } = result;

  // ── 1. Fast path: both body and listing cached ─────────────────────
  const cachedBody = emailCache.getCachedEmailBody(account.id, folder, uid);
  const cachedListing = emailCache.getCachedEmail(account.id, folder, uid);

  if (cachedBody && cachedListing) {
    const email = cachedToEmailMessage(cachedListing);
    // Ensure body content comes from the body cache (never snippet fallback)
    email.body = {
      text: cachedBody.text ?? email.body?.text,
      html: cachedBody.html ?? email.body?.html,
    };
    res.json({ data: email, source: "cache" });
    return;
  }

  // ── 2. On-demand body fetch: listing cached, body missing ──────────
  // 12s timeout: Gmail API body fetch is typically <3s but large threads with
  // many attachments can take longer. 12s is the max before we fall back
  // to async engine sync.
  if (cachedListing) {
    try {
      const freshToken = await getFreshGmailToken(account.id);
      const body = await Promise.race([
        GmailProvider.getBody(account, { accessToken: freshToken } as any, uid),
        sleep(12000).then(() => null),
      ]);

      if (body) {
        // Persist body to cache
        emailCache.upsertEmailBody(
          account.id, folder, uid,
          body.html ?? null,
          body.text ?? null,
          JSON.stringify({ attachments: body.attachments }),
        );

        // Re-read from cache and construct full email
        const freshCachedBody = emailCache.getCachedEmailBody(account.id, folder, uid);
        const email = cachedToEmailMessage(cachedListing);
        email.body = {
          text: freshCachedBody?.text ?? body.text ?? email.body?.text,
          html: freshCachedBody?.html ?? body.html ?? email.body?.html,
        };
        // 🔴 Explicitly set from fresh response (not cached headers_json)
        // to ensure the NEW attachmentId field is correct
        email.attachments = body.attachments;

        res.json({ data: email, source: "live" });
        return;
      }

      // Timeout — fall through to 202
      logger.warn("email",
        `On-demand body fetch timed out for ${account.email}/${folder}/${uid} (12s)`,
      );
    } catch (err: unknown) {
      // 🔴 Lesson 14: log before returning error sentinel
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("email",
        `On-demand body fetch FAILED for ${account.email}/${folder}/${uid}: ${msg}`,
      );
    }

    // Timeout or error — fall back to engine hints + 202
    boostBody(account.id, folder, uid);
    boostFolder(account.id, folder);
    res.status(202).json({
      pending: true,
      message: "Body being fetched — retry in 1.5s",
      retry: true,
    });
    return;
  }

  // ── 3. Cold miss: neither listing nor body cached ─────────────────
  // No listing to display — hint engine, return 202
  boostBody(account.id, folder, uid);
  boostFolder(account.id, folder);

  res.status(202).json({
    pending: true,
    message: "Body being fetched — retry in 1.5s",
    retry: true,
  });
});

/** PATCH /:uid/move?project= — Move an email to another folder. (WRITE op — uses IMAP) */
emailsRouter.patch("/:uid/move", async (req, res) => {
  const accountId = req.body.account;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const uid = req.params.uid!;
  if (!uid || typeof uid !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid is required" },
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

/** PATCH /:uid/flags?project= — Set flags on an email. (WRITE op — uses IMAP) */
emailsRouter.patch("/:uid/flags", async (req, res) => {
  const accountId = req.body.account;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const uid = req.params.uid!;
  if (!uid || typeof uid !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid is required" },
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

/** DELETE /:uid?project= — Delete an email. (WRITE op — uses IMAP)
 *  🔴 HARD RULE #8: folder is REQUIRED in body — UID is ambiguous without folder. */
emailsRouter.delete("/:uid", async (req, res) => {
  const accountId = req.body.account;
  const result = await getAccountAuthOrError(res, accountId);
  if (!result) return;

  const uid = req.params.uid!;
  if (!uid || typeof uid !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "uid is required" },
    });
    return;
  }

  const folder = req.body.folder;
  if (!folder || typeof folder !== 'string') {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "folder is required in request body" },
    });
    return;
  }
  const { account, auth } = result;

  try {
    await withImapConnection(account, auth, (id) =>
      deleteEmail(id, folder, uid),
    );
    res.status(204).send();
  } catch (err: any) {
    logger.error("email", `Delete email failed for account ${accountId}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(500).json({ error: { code: "IMAP_ERROR", message: err.message } });
  }
});

// ── Startup: account migration & engine initialization ──────────────────────

/**
 * 🔴 Migration: copy email accounts from any non-global project to global-default.
 * Runs once at first import (lazy, triggered from api-server.ts startup).
 *
 * Email accounts used to be project-scoped (pre-v2.3). This migration coalesces
 * them into the global-default project so accounts are available across sessions.
 * Source rows are DELETED (not kept) to prevent resurrection on container rebuilds.
 */
export async function migrateEmailAccountsToGlobal(): Promise<number> {
  try {
    const globalId = resolveEmailProject();
    const { getDb } = await import("ingenium-core");
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");

    // Find all settings keys that look like email accounts in non-global projects
    const rows = db.prepare(
      `SELECT s.project_id, s.key, s.value
       FROM settings s
       JOIN projects p ON s.project_id = p.id
       WHERE s.key LIKE 'email_account_%'
         AND p.is_global = 0
         AND p.archived_at IS NULL`,
    ).all() as Array<{ project_id: string; key: string; value: string }>;

    let migrated = 0;
    for (const row of rows) {
      // Check if this account already exists in global
      const existing = db.prepare(
        "SELECT key FROM settings WHERE project_id = ? AND key = ?",
      ).get(globalId, row.key) as { key: string } | undefined;

      if (!existing) {
        db.prepare(
          `INSERT INTO settings (project_id, key, value)
           VALUES (?, ?, ?)
           ON CONFLICT(project_id, key) DO NOTHING`,
        ).run(globalId, row.key, row.value);
        // Delete from source so the account only lives in global — prevents
        // resurrection on next rebuild if user deleted it from global.
        db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?").run(row.project_id, row.key);
        migrated++;
      }
    }

    // Also migrate OAuth tokens
    const oauthRows = db.prepare(
      `SELECT s.project_id, s.key, s.value
       FROM settings s
       JOIN projects p ON s.project_id = p.id
       WHERE s.key LIKE 'email_oauth_%'
         AND p.is_global = 0
         AND p.archived_at IS NULL`,
    ).all() as Array<{ project_id: string; key: string; value: string }>;

    for (const row of oauthRows) {
      const existing = db.prepare(
        "SELECT key FROM settings WHERE project_id = ? AND key = ?",
      ).get(globalId, row.key) as { key: string } | undefined;

      if (!existing) {
        db.prepare(
          `INSERT INTO settings (project_id, key, value)
           VALUES (?, ?, ?)
           ON CONFLICT(project_id, key) DO NOTHING`,
        ).run(globalId, row.key, row.value);
        db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?").run(row.project_id, row.key);
        migrated++;
      }
    }

    // Also migrate OAuth state keys
    const stateRows = db.prepare(
      `SELECT s.project_id, s.key, s.value
       FROM settings s
       JOIN projects p ON s.project_id = p.id
       WHERE s.key LIKE 'oauth_state_%'
         AND p.is_global = 0
         AND p.archived_at IS NULL`,
    ).all() as Array<{ project_id: string; key: string; value: string }>;

    for (const row of stateRows) {
      const existing = db.prepare(
        "SELECT key FROM settings WHERE project_id = ? AND key = ?",
      ).get(globalId, row.key) as { key: string } | undefined;

      if (!existing) {
        db.prepare(
          `INSERT INTO settings (project_id, key, value)
           VALUES (?, ?, ?)
           ON CONFLICT(project_id, key) DO NOTHING`,
        ).run(globalId, row.key, row.value);
        db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?").run(row.project_id, row.key);
        migrated++;
      }
    }

    if (migrated > 0) {
      logger.info("email", `Migrated ${migrated} email settings from project-scoped to global`);
    }
    return migrated;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("email", `Email account migration failed (non-fatal): ${msg}`);
    return 0;
  }
}

/**
 * 🔴 DEPRECATED — use startEngine(projectId) instead.
 * The sync engine now owns all IMAP I/O via its priority-queue background workers.
 * Kept for backward compatibility: just delegates to startEngine.
 * TODO(v3): remove this function and update all callers.
 */
export async function prefetchAllAccounts(): Promise<void> {
  const projectId = resolveEmailProject();
  logger.info("email", "DEPRECATED: prefetchAllAccounts called — delegating to startEngine");
  startEngine(projectId);
}
