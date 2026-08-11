import { Router, type Request, type Response } from "express";
import multer from "multer";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { logger, settings } from "ingenium-core";
import { createRateLimiter } from "../middleware/rate-limit.js";
import {
  opencodeClient,
  isOpenCodeError,
  type SendPromptBody,
} from "../opencode-client.js";
import { requireActiveGlobalProject } from "../helpers.js";
import {
  callOpenCodeWithProviderDeadline,
  connectNativeProviderCredential,
  disconnectNativeProviderCredential,
  type NativeProviderCredentialPersistenceStatus,
} from "../server-global-provider-persistence.js";
import {
  CHAT_SELECTION_SETTING,
  getBuiltinChatProvider,
  getChatProviderCatalog,
  getAllowedLegacyChatSelection,
  getStoredOrDefaultChatSelection,
  isAllowedChatSelection,
  isValidChatSelectionIdentifier,
  type ExpandedChatProviderInfo,
} from "../chat-provider-catalog.js";
import { normalizeMcpStatusResponse } from "../mcp-status.js";
import { isSafeBrowserIdentifier, isSafeBrowserLabel, isSafeMcpServerName } from "../browser-safe-scalars.js";

/* ── File upload configuration ── */

const UPLOAD_DIR = "/tmp/ingenium-chat-uploads";
mkdirSync(UPLOAD_DIR, { recursive: true });

/* ── Startup cleanup: remove uploads older than 1 hour ── */
try {
  const oneHour = 60 * 60 * 1000;
  const now = Date.now();
  for (const f of readdirSync(UPLOAD_DIR)) {
    const fp = path.join(UPLOAD_DIR, f);
    try {
      const stat = statSync(fp);
      if (now - stat.mtimeMs > oneHour) {
        unlinkSync(fp);
      }
    } catch { /* race — file removed between readdir and stat */ }
  }
} catch { /* non-critical */ }

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeName = path
      .basename(file.originalname || "file")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${randomUUID()}-${safeName}`);
  },
});

/** MIME allowlist — only safe types for chat file uploads. */
const ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/pdf",
  "text/typescript",
  "text/javascript",
];

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

/**
 * Handles /api/v1/opencode — reads recent user messages from the OpenCode SQLite DB,
 * AND proxies the full OpenCode REST API surface through the OpenCode HTTP server.
 *
 * The DB-based /messages route is the ONLY route file that directly accesses a
 * SQLite database outside the API authority pattern, because the OpenCode DB is a
 * separate process's database mounted via docker-compose volume.
 *
 * Proxy routes validated against the v1.18.9 contract at /tmp/opencode-contract.md.
 */
export const opencodeRouter = Router();

/* ── Utility ── */

const SOURCE = "opencode-routes";
const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_OAUTH_ATTEMPTS = 100;
const DEFAULT_OAUTH_CALLBACK_FORWARD_URL = "http://localhost:1455/auth/callback";
const pendingOAuthAttempts = new Map<string, { attemptID: string; mode: "auto" | "code"; expiresAt: number }>();

/**
 * The callback is intentionally unauthenticated because OAuth providers redirect
 * browsers here. Keep its limiter independent from the authenticated API budget.
 */
export function createOAuthCallbackRateLimiter(maxRequests = 20, windowMs = 60_000) {
  return createRateLimiter(maxRequests, windowMs);
}

function pruneOAuthAttempts(): void {
  const now = Date.now();
  for (const [state, attempt] of pendingOAuthAttempts) {
    if (attempt.expiresAt <= now) pendingOAuthAttempts.delete(state);
  }
}

function oauthCallbackPage(res: Response, status: number, title: string, message: string): void {
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
  const nonce = randomBytes(16).toString("base64");
  res.set({
    "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  res.status(status).type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><script nonce="${nonce}">window.close()</script></body></html>`);
}

/**
 * OPENCODE_OAUTH_CALLBACK_FORWARD_URL overrides the local OpenCode listener.
 * The default works when API and OpenCode run on the host or in the same Docker
 * container. Only loopback HTTP callback URLs are accepted to prevent SSRF.
 */
function getOAuthCallbackForwardUrl(): URL | null {
  const configuredUrl = process.env.OPENCODE_OAUTH_CALLBACK_FORWARD_URL
    || DEFAULT_OAUTH_CALLBACK_FORWARD_URL;
  try {
    const url = new URL(configuredUrl);
    const isLoopback = url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname === "[::1]";
    if (url.protocol !== "http:" || !isLoopback || url.pathname !== "/auth/callback"
      || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function forwardAutoOAuthCallback(params: URLSearchParams, event: string): void {
  const callbackUrl = getOAuthCallbackForwardUrl();
  if (!callbackUrl) {
    logger.warn(SOURCE, "Auto OAuth callback forward blocked by invalid OPENCODE_OAUTH_CALLBACK_FORWARD_URL");
    return;
  }
  callbackUrl.search = params.toString();
  fetch(callbackUrl.toString()).catch((error) => {
    logger.warn(SOURCE, event, { error: error instanceof Error ? error.name : "unknown" });
  });
}

/**
 * Complete browser OAuth redirects that OpenAI sends to localhost:1455.
 * The state value is issued by OpenCode and lets this public endpoint locate
 * the corresponding short-lived integration attempt without exposing an API token.
 */
export async function handleOAuthCallback(req: Request, res: Response): Promise<void> {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const providerError = typeof req.query.error === "string" ? req.query.error : "";

  pruneOAuthAttempts();
  if (state.length > 1024 || /[\r\n\0]/.test(state)) {
    oauthCallbackPage(res, 400, "Authorization could not be completed", "This authorization request is invalid or has expired. Return to Ingenium and start again.");
    return;
  }
  const attempt = pendingOAuthAttempts.get(state);
  if (!attempt) {
    oauthCallbackPage(res, 400, "Authorization could not be completed", "This authorization request is invalid or has expired. Return to Ingenium and start again.");
    return;
  }

  // Consume the state before forwarding or exchanging the code so the redirect cannot be replayed.
  pendingOAuthAttempts.delete(state);
  if (providerError || !code || code.length > 4096 || /[\r\n\0]/.test(code)) {
    if (attempt.mode === "auto") {
      const params = new URLSearchParams({ state, ...(providerError ? { error: providerError } : {}) });
      forwardAutoOAuthCallback(params, "Auto OAuth cancellation forward failed");
    } else {
      await opencodeClient.cancelIntegrationAttempt(attempt.attemptID);
    }
    oauthCallbackPage(res, 400, "Authorization was cancelled", "Return to Ingenium to try again.");
    return;
  }

  if (attempt.mode === "auto") {
    // OpenCode owns the PKCE verifier for auto flows. Its listener may close the
    // connection without a response after resolving the callback, which is expected.
    const params = new URLSearchParams({ code, state });
    forwardAutoOAuthCallback(params, "Auto OAuth callback forward failed");
    logger.info(SOURCE, "Native OAuth provider connections cannot be rehydrated after OpenCode auth storage loss without a separately stored provider credential");
    oauthCallbackPage(res, 200, "Authorization received", "You can close this window and return to Ingenium while the connection completes.");
    return;
  }

  try {
    const result = await opencodeClient.completeIntegrationAttempt(attempt.attemptID, code);
    if (isOpenCodeError(result)) {
      logger.warn(SOURCE, `OAuth callback completion failed: ${result.error.code}`);
      oauthCallbackPage(res, 502, "Authorization could not be completed", "Return to Ingenium and try again.");
      return;
    }

    logger.info(SOURCE, "Native OAuth provider connections cannot be rehydrated after OpenCode auth storage loss without a separately stored provider credential");
    oauthCallbackPage(res, 200, "Authorization complete", "You can close this window and return to Ingenium.");
  } catch (error) {
    logger.warn(SOURCE, "OAuth callback completion threw unexpectedly", {
      error: error instanceof Error ? error.name : "unknown",
    });
    oauthCallbackPage(res, 502, "Authorization could not be completed", "Return to Ingenium and try again.");
  }
}

/**
 * Guard: all proxy routes require OPENCODE_SERVER_PASSWORD to be configured.
 * Returns 503 if missing so the caller gets a clear signal.
 */
function guardPassword(req: any, res: any): boolean {
  if (!process.env.OPENCODE_SERVER_PASSWORD) {
    logger.warn(SOURCE, `Route blocked: OPENCODE_SERVER_PASSWORD not configured`, {
      method: req.method,
      path: req.originalUrl,
    });
    res.status(503).json({
      error: {
        code: "OPENCODE_NOT_CONFIGURED",
        message: "OPENCODE_SERVER_PASSWORD is not configured. Set it to enable the OpenCode proxy.",
      },
    });
    return false;
  }
  return true;
}

/**
 * Normalize an OpenCode client result into an Express response.
 * If the result has an `error` property, sends the error with the appropriate
 * status code (derived from the error code). Otherwise sends 200 with the data.
 */
function sendOpenCodeError(req: any, res: any, result: any, status: number): void {
  const code = result.error.code;
  logger.warn(
    SOURCE,
    `Proxy error: ${result.error.code}`,
    { method: req.method, path: req.originalUrl, code: result.error.code },
  );
  res.status(status).json({
    error: {
      code: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(code) ? code : "UPSTREAM_ERROR",
      message: "OpenCode request failed.",
    },
  });
}

function sendResult(req: any, res: any, result: any, statusOnSuccess = 200): void {
  if (isOpenCodeError(result)) {
    const code = result.error.code;
    // Map known error codes to HTTP statuses
    let status: number;
    if (code === "AUTH_NOT_CONFIGURED") {
      status = 503;
    } else if (code === "NETWORK_ERROR" || code === "OPENCODE_OPERATION_TIMEOUT") {
      status = 503;
      result.error.code = "OPENCODE_UNAVAILABLE";
      result.error.message = "OpenCode is starting up. Please wait a moment and try again.";
      // Set Retry-After header so clients can back off gracefully
      res.setHeader("Retry-After", "5");
    } else if (code === "NOT_FOUND" || code === "NotFoundError") {
      status = 404;
    } else if (code === "BadRequest" || code.startsWith("HTTP_4")) {
      status = 400;
    } else if (code.startsWith("HTTP_5")) {
      status = 502;
    } else {
      status = 502; // Default upstream error
    }
    sendOpenCodeError(req, res, result, status);
    return;
  }

  res.status(statusOnSuccess).json({ data: result });
}

/* ── Browser provider catalog DTO ────────────────────────────────────────── */

/**
 * `/providers` is browser-facing. Project the upstream OpenCode response into
 * this deliberately small DTO rather than attempting to recursively redact a
 * provider object whose nested fields evolve independently of this API.
 */
interface BrowserProviderModelDto {
  id: string;
  label: string;
}

interface BrowserProviderDto {
  id: string;
  label: string;
  models: BrowserProviderModelDto[];
  defaultModel: string | null;
  connected: boolean;
}

interface BrowserProviderCatalogDto {
  providers: BrowserProviderDto[];
}

function isBrowserProviderRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBrowserProviderIdentifier(value: unknown): value is string {
  return isSafeBrowserIdentifier(value);
}

/** Use an upstream name only when it is safe as a non-secret display label. */
function browserProviderLabel(value: unknown, fallback: string): string {
  return isSafeBrowserLabel(value) ? value : fallback;
}

/** Strict property allowlist for the browser-visible provider catalog. */
function toBrowserProviderCatalog(result: unknown): BrowserProviderCatalogDto {
  if (!isBrowserProviderRecord(result) || !Array.isArray(result.all)) {
    return { providers: [] };
  }

  const defaults = isBrowserProviderRecord(result.default) ? result.default : {};
  const connected = new Set(
    Array.isArray(result.connected)
      ? result.connected.filter(isBrowserProviderIdentifier)
      : [],
  );
  const providerIds = new Set<string>();
  const providers: BrowserProviderDto[] = [];

  for (const candidate of result.all) {
    if (!isBrowserProviderRecord(candidate) || !isBrowserProviderIdentifier(candidate.id)
      || providerIds.has(candidate.id) || !isBrowserProviderRecord(candidate.models)) {
      continue;
    }

    const modelIds = new Set<string>();
    const models: BrowserProviderModelDto[] = [];
    for (const model of Object.values(candidate.models)) {
      if (!isBrowserProviderRecord(model) || !isBrowserProviderIdentifier(model.id)
        || modelIds.has(model.id)) {
        continue;
      }
      modelIds.add(model.id);
      models.push({
        id: model.id,
        label: browserProviderLabel(model.name, model.id),
      });
    }

    const configuredDefault = defaults[candidate.id];
    providers.push({
      id: candidate.id,
      label: browserProviderLabel(candidate.name, candidate.id),
      models,
      defaultModel: isBrowserProviderIdentifier(configuredDefault)
        && modelIds.has(configuredDefault)
        ? configuredDefault
        : null,
      connected: connected.has(candidate.id),
    });
    providerIds.add(candidate.id);
  }

  return { providers };
}

function sendBrowserProviderCatalogError(res: Response, result: unknown): void {
  const isNetworkFailure = isOpenCodeError(result) && result.error.code === "NETWORK_ERROR";
  logger.warn(SOURCE, "Browser provider catalog unavailable", {
    failure: isNetworkFailure ? "network" : "upstream",
  });
  if (isNetworkFailure) {
    res.setHeader("Retry-After", "5");
    res.status(503).json({
      error: {
        code: "OPENCODE_UNAVAILABLE",
        message: "OpenCode is starting up. Please wait a moment and try again.",
      },
    });
    return;
  }
  res.status(502).json({
    error: {
      code: "PROVIDER_CATALOG_UNAVAILABLE",
      message: "OpenCode provider catalog is unavailable.",
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   File upload endpoint — POST /upload (multipart)
   ═══════════════════════════════════════════════════════════════════════════ */

opencodeRouter.post("/upload", (req, res) => {
  if (!guardPassword(req, res)) return;

  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        // Multer-specific errors (file too large, wrong field name, etc.)
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        logger.warn(SOURCE, `Upload multer error: ${err.code}`, {
          code: err.code,
          field: err.field,
        });
        res.status(status).json({
          error: { code: err.code, message: err.message },
        });
        return;
      }
      // Custom file-filter error or other errors
      logger.warn(SOURCE, `Upload error: ${err.message}`);
      res.status(400).json({
        error: { code: "UPLOAD_REJECTED", message: err.message },
      });
      return;
    }

    if (!req.file) {
      res.status(400).json({
        error: { code: "NO_FILE", message: "No file uploaded" },
      });
      return;
    }

    res.json({
      data: {
        url: `file:///tmp/ingenium-chat-uploads/${path.basename(req.file.filename)}`,
        filename: req.file.originalname,
        mime: req.file.mimetype,
        size: req.file.size,
      },
    });

    // Deferred cleanup: remove file after 1 hour
    setTimeout(() => {
      try {
        if (existsSync(req.file!.path)) {
          unlinkSync(req.file!.path);
        }
      } catch { /* non-critical — file may already be removed */ }
    }, 60 * 60 * 1000);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Existing: DB-based OpenCode message reader
   ═══════════════════════════════════════════════════════════════════════════ */

opencodeRouter.get("/messages", (req, res) => {
  const since = parseInt(req.query.since as string || "0", 10);
  const limit = Math.min(parseInt(req.query.limit as string || "500", 10), 2000);
  const project = (req.query.project as string) || "";

  try {
    // Host OpenCode DB mounted at /var/opencode/ via docker-compose
    const dbPath = process.env.INGENIUM_OPENCODE_DB_PATH || "/var/opencode/opencode.db";

    if (!existsSync(dbPath)) {
      logger.warn("opencode", "OpenCode DB not found", { path: dbPath });
      res.json({ data: { messages: [], total: 0 } });
      return;
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });

    // Build query with optional project (worktree directory) filter
    const projectClause = project
      ? "AND (s.directory LIKE ('%/' || ?) OR s.directory LIKE ('%\\' || ?))"
      : "";

    const sql = `
      SELECT
        m.id as message_id,
        m.session_id as session_id,
        json_extract(p.data, '$.text') as text,
        p.time_created
      FROM part p
      JOIN message m ON p.message_id = m.id
      JOIN session s ON m.session_id = s.id
      WHERE json_extract(m.data, '$.role') = 'user'
        AND json_extract(p.data, '$.type') = 'text'
        AND length(json_extract(p.data, '$.text')) > 10
        AND p.time_created > ?
        AND s.parent_id IS NULL
        ${projectClause}
      ORDER BY p.time_created DESC
      LIMIT ?
    `;

    const params: any[] = [since];
    if (project) params.push(project, project);
    params.push(limit);

    const rows = db.prepare(sql).all(...params);

    db.close();

    const messages = rows.map((r: any) => ({
      text: String(r.text || ""),
      time_created: r.time_created,
      messageId: r.message_id ? String(r.message_id) : undefined,
      sessionId: r.session_id ? String(r.session_id) : undefined,
    }));

    logger.info("opencode", `Returned ${messages.length} user messages from OpenCode DB (since=${since}, limit=${limit}, project=${project || "any"})`);

    res.json({ data: { messages, total: messages.length } });
  } catch (err: any) {
    logger.error("opencode", `Failed to read OpenCode DB: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.json({ data: { messages: [], total: 0, error: err.message } });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   Chat config — sanitized provider/agent config for the Chat page.
   Reads from settings table (same as Settings → Providers) and NEVER
   exposes API keys.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Sanitized provider info returned to the Chat page — no API keys. */
interface ChatProviderInfo {
  providerId: string;
  modelId: string;
  label: string;
  isCustom: boolean;
}

interface ChatConfigResponse {
  project: string;
  configured: boolean;
  primary: ChatProviderInfo | null;
  backup: ChatProviderInfo | null;
  providers: ExpandedChatProviderInfo[];
  agents: Array<{ name: string; label: string }>;
  defaultSelection: { providerId: string; modelId: string } | null;
}

function legacyChatDto(
  projectId: string,
  providers: ExpandedChatProviderInfo[],
  role: "primary" | "backup",
): ChatProviderInfo | null {
  const selection = getAllowedLegacyChatSelection(projectId, providers, role);
  if (!selection) return null;
  const provider = providers.find((candidate) => candidate.providerId === selection.providerId);
  const model = provider?.models.find((candidate) => candidate.id === selection.modelId);
  if (!provider || !model) return null;
  return {
    providerId: provider.providerId,
    modelId: model.id,
    label: `${provider.label}: ${model.label}`,
    isCustom: provider.providerId === "ingenium-primary" || provider.providerId === "ingenium-backup",
  };
}

// Chat configuration is instance-owned; any caller project query is ignored.
opencodeRouter.get("/chat-config", async (req, res) => {
  const globalProject = requireActiveGlobalProject(req, res);
  if (!globalProject) return;
  const projectId = globalProject.id;

  let providers: ExpandedChatProviderInfo[];
  try {
    const catalog = await getChatProviderCatalog(projectId);
    if (catalog.unavailable) {
      if (catalog.unavailable === "network") {
        res.status(503).json({
          error: {
            code: "OPENCODE_UNAVAILABLE",
            message: "OpenCode is starting up. Provider list will be available shortly.",
          },
        });
      } else {
        res.status(503).json({
          error: {
            code: "LLM_CATALOG_UNAVAILABLE",
            message: "The Chat model catalog is temporarily unavailable. Try again later.",
          },
        });
      }
      return;
    }
    providers = catalog.providers;
  } catch {
    // Provider discovery can fail while OpenCode is unavailable. Never expose
    // transport details, endpoints, or credentials through this browser DTO.
    logger.warn(SOURCE, "Chat provider catalog unavailable");
    res.status(503).json({
      error: {
        code: "LLM_CATALOG_UNAVAILABLE",
        message: "The Chat model catalog is temporarily unavailable. Try again later.",
      },
    });
    return;
  }

  // Legacy synthesis fields are server-side runtime settings, not browser DTO
  // inputs. Project them only after the exact provider/model pair is found in
  // the current allowlisted catalog, and derive labels from that catalog.
  const primary = legacyChatDto(projectId, providers, "primary");
  const backup = primary ? legacyChatDto(projectId, providers, "backup") : null;

  const response: ChatConfigResponse = {
    project: globalProject.name,
    configured: primary !== null,
    primary,
    backup,
    providers,
    agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
    defaultSelection: getStoredOrDefaultChatSelection(projectId, providers),
  };

  res.json({ data: response });
});

/**
 * Persist the one global, non-secret Chat selection. This route is mounted
 * behind the API auth and dashboard CSRF middleware; clients cannot choose a
 * project, and only an exact current global-catalog pair is saved.
 */
opencodeRouter.put("/chat-selection", async (req, res) => {
  if (req.query.project !== undefined || req.body?.project !== undefined) {
    res.status(422).json({ error: { code: "CHAT_SELECTION_PROJECT_CONFLICT", message: "Chat model selection is owned by the active global project." } });
    return;
  }
  const providerId = req.body?.providerId;
  const modelId = req.body?.modelId;
  if (!isValidChatSelectionIdentifier(providerId) || !isValidChatSelectionIdentifier(modelId)) {
    res.status(422).json({ error: { code: "INVALID_CHAT_SELECTION", message: "A valid Chat provider and model are required." } });
    return;
  }

  const globalProject = requireActiveGlobalProject(req, res);
  if (!globalProject) return;
  const projectId = globalProject.id;
  try {
    const catalog = await getChatProviderCatalog(projectId);
    if (catalog.unavailable) {
      res.status(503).json({ error: { code: "LLM_CATALOG_UNAVAILABLE", message: "The Chat model catalog is temporarily unavailable. Try again later." } });
      return;
    }
    const selection = { providerId, modelId };
    if (!isAllowedChatSelection(catalog.providers, selection)) {
      res.status(422).json({ error: { code: "CHAT_SELECTION_UNAVAILABLE", message: "The selected Chat provider or model is not currently available." } });
      return;
    }
    settings.setSetting(projectId, CHAT_SELECTION_SETTING, JSON.stringify(selection));
    res.json({ data: { project: globalProject.name, ...selection } });
  } catch {
    logger.warn(SOURCE, "Chat selection validation failed while loading the global catalog");
    res.status(503).json({ error: { code: "LLM_CATALOG_UNAVAILABLE", message: "The Chat model catalog is temporarily unavailable. Try again later." } });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   OpenCode HTTP API proxy routes (v1.18.9 contract)
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Health ── */

opencodeRouter.get("/health", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const result = await opencodeClient.health();
  if (isOpenCodeError(result) && result.error.code === "NETWORK_ERROR") {
    res.status(503).json({
      data: { healthy: false, status: "unavailable" },
    });
    return;
  }
  sendResult(req, res, result);
});

/* ── Sessions (list + create — MUST come before /sessions/:id routes) ── */

opencodeRouter.get("/sessions", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.listSessions(directory);
  sendResult(req, res, result);
});

opencodeRouter.post("/sessions", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.createSession(req.body, directory);
  sendResult(req, res, result, 201);
});

/* ── Session status (literal path — MUST come before /sessions/:id) ── */

opencodeRouter.get("/sessions/status", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.getSessionStatus(directory);
  sendResult(req, res, result);
});

/* ── Session detail (CRUD) ── */

opencodeRouter.get("/sessions/:id", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.getSession(req.params.id!, directory);
  sendResult(req, res, result);
});

opencodeRouter.patch("/sessions/:id", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.updateSession(req.params.id!, req.body, directory);
  sendResult(req, res, result);
});

opencodeRouter.delete("/sessions/:id", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.deleteSession(req.params.id!, directory);
  sendResult(req, res, result);
});

/* ── Messages (per-session) ── */

opencodeRouter.get("/sessions/:id/messages", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const before = req.query.before as string | undefined;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.getMessages(req.params.id!, limit, before, directory);
  sendResult(req, res, result);
});

opencodeRouter.get("/sessions/:id/messages/:msgId", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.getSessionMessage(
    req.params.id!,
    req.params.msgId!,
    directory,
  );
  sendResult(req, res, result);
});

opencodeRouter.delete("/sessions/:id/messages/:msgId", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.deleteMessage(
    req.params.id!,
    req.params.msgId!,
    directory,
  );
  sendResult(req, res, result);
});

/* ── Prompt (POST /sessions/:id/message — uses parts array per v1.18.9) ── */

function isPromptPart(part: unknown): boolean {
  if (part === null || typeof part !== "object") return false;
  const candidate = part as Record<string, unknown>;
  if (candidate.type === "text") return typeof candidate.text === "string";
  return candidate.type === "file"
    && typeof candidate.mime === "string"
    && typeof candidate.url === "string"
    && (candidate.filename === undefined || typeof candidate.filename === "string");
}

function hasPromptParts(body: unknown): body is SendPromptBody {
  return body !== null
    && typeof body === "object"
    && Array.isArray((body as { parts?: unknown }).parts)
    && (body as { parts: unknown[] }).parts.every(isPromptPart);
}

opencodeRouter.post("/sessions/:id/prompt", async (req, res) => {
  if (!guardPassword(req, res)) return;
  if (!hasPromptParts(req.body)) {
    res.status(400).json({
      error: {
        code: "INVALID_PROMPT",
        message: "Prompt requests require a parts array.",
      },
    });
    return;
  }
  const directory = req.query.directory as string | undefined;
  const sessionId = req.params.id!;

  // OpenCode keeps this HTTP request open for the entire provider turn. The
  // dashboard has already subscribed to the session SSE endpoint before this
  // route runs, so keeping its API rewrite open ties prompt acceptance to a
  // long-running generation and makes a dropped intermediary socket surface as
  // an unrelated 500. Accept the request promptly; terminal provider errors
  // are delivered on the authoritative session.error SSE event.
  void opencodeClient.sendPrompt(sessionId, req.body, directory)
    .then((result) => {
      if (isOpenCodeError(result)) {
        logger.warn(SOURCE, `Asynchronous prompt request failed: ${result.error.code}`, {
          code: result.error.code,
          sessionId,
        });
      }
    })
    .catch((error: unknown) => {
      logger.error(SOURCE, "Asynchronous prompt request threw unexpectedly", {
        error: error instanceof Error ? error.name : "unknown",
        sessionId,
      });
    });

  res.status(202).json({ data: { accepted: true } });
});

/* ── Session actions ── */

opencodeRouter.post("/sessions/:id/abort", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.abortSession(req.params.id!, directory);
  sendResult(req, res, result);
});

opencodeRouter.post("/sessions/:id/fork", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const messageId = (req.body?.messageID || req.body?.messageId) as string | undefined;
  const result = await opencodeClient.forkSession(req.params.id!, messageId, directory);
  sendResult(req, res, result, 201);
});

opencodeRouter.post("/sessions/:id/share", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;

  // Pre-check: if session already has a share URL, return it without calling POST /share.
  // This avoids the upstream 500 InternalServerError for already-shared sessions and
  // returns the existing share URL directly.
  const session = await opencodeClient.getSession(req.params.id!, directory);
  if (!isOpenCodeError(session) && session.share?.url) {
    logger.debug(SOURCE, `Session ${req.params.id!} already shared — returning existing share URL`);
    res.json({ data: session });
    return;
  }

  const result = await opencodeClient.shareSession(req.params.id!, directory);
  if (isOpenCodeError(result)) {
    // Preserve the actual upstream status code rather than mapping everything to 502.
    // Extract HTTP status from error codes like HTTP_500, HTTP_409, etc.
    const code = result.error.code;
    const httpMatch = /^HTTP_(\d+)$/.exec(code);
    const status = httpMatch ? parseInt(httpMatch[1]!, 10) : 502;
    sendOpenCodeError(req, res, result, status);
    return;
  }
  res.json({ data: result });
});

opencodeRouter.delete("/sessions/:id/share", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.unshareSession(req.params.id!, directory);
  sendResult(req, res, result);
});

opencodeRouter.post("/sessions/:id/compact", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;

  const { providerID, modelID } = req.body ?? {};
  if (!providerID || (typeof providerID === "string" && providerID.trim() === "")) {
    res.status(400).json({
      error: {
        code: "MISSING_PROVIDER_ID",
        message: "providerID is required for session summarization (compact). Provide a valid providerID and modelID in the request body.",
      },
    });
    return;
  }

  const body = { providerID: providerID as string, modelID: modelID as string };
  const result = await opencodeClient.compactSession(req.params.id!, body, directory);
  sendResult(req, res, result);
});

opencodeRouter.post("/sessions/:id/revert", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.revertSession(req.params.id!, req.body, directory);
  sendResult(req, res, result);
});

opencodeRouter.post("/sessions/:id/unrevert", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.unrevertSession(req.params.id!, directory);
  sendResult(req, res, result);
});

opencodeRouter.get("/sessions/:id/children", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.getSessionChildren(req.params.id!, directory);
  sendResult(req, res, result);
});

opencodeRouter.get("/sessions/:id/diff", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const messageId = req.query.messageID as string | undefined;
  const result = await opencodeClient.getSessionDiff(req.params.id!, messageId, directory);
  sendResult(req, res, result);
});

opencodeRouter.post("/sessions/:id/command", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.sendCommand(req.params.id!, req.body, directory);
  sendResult(req, res, result);
});

opencodeRouter.post("/sessions/:id/init", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.initSession(req.params.id!, directory);
  sendResult(req, res, result);
});

/* ── Permissions ── */

opencodeRouter.get("/permissions", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.getPermissions(directory);
  sendResult(req, res, result);
});

opencodeRouter.post("/sessions/:id/permissions/:permId", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.replyPermission(
    req.params.id!,
    req.params.permId!,
    req.body,
    directory,
  );
  sendResult(req, res, result);
});

/* ── Questions ── */

opencodeRouter.get("/questions", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.getQuestions(directory);
  sendResult(req, res, result);
});

/* ── SSE event stream ── */

opencodeRouter.get("/sessions/:id/events", async (req, res) => {
  if (!guardPassword(req, res)) return;

  // Forward Last-Event-ID from client for SSE resume
  const lastEventId = req.headers["last-event-id"] as string | undefined;

  const result = await opencodeClient.streamEvents(
    req.params.id!,
    req.query.directory as string | undefined,
    lastEventId,
  );

  if (isOpenCodeError(result)) {
    sendResult(req, res, result);
    return;
  }

  // Set SSE response headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering if behind proxy
  res.flushHeaders();

  // Create a Web Streams reader to consume the upstream SSE
  const reader = result.getReader();
  let aborted = false;

  // Cancel upstream on client disconnect
  req.on("close", () => {
    aborted = true;
    reader.cancel().catch(() => {});
    logger.debug(SOURCE, `SSE client disconnected for session ${req.params.id!}`);
  });

  try {
    while (!aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.writableEnded) {
        res.write(value);
      }
    }
  } catch (err: any) {
    if (err.name !== "AbortError") {
      logger.error(SOURCE, `SSE stream error for session ${req.params.id!}: ${err.message}`);
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

/* ── Global event stream (no session filter) ── */

opencodeRouter.get("/events", async (req, res) => {
  if (!guardPassword(req, res)) return;

  const lastEventId = req.headers["last-event-id"] as string | undefined;

  const result = await opencodeClient.streamEvents(
    undefined,
    req.query.directory as string | undefined,
    lastEventId,
  );

  if (isOpenCodeError(result)) {
    sendResult(req, res, result);
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const reader = result.getReader();
  let aborted = false;

  req.on("close", () => {
    aborted = true;
    reader.cancel().catch(() => {});
    logger.debug(SOURCE, "SSE global event client disconnected");
  });

  try {
    while (!aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.writableEnded) {
        res.write(value);
      }
    }
  } catch (err: any) {
    if (err.name !== "AbortError") {
      logger.error(SOURCE, `SSE global stream error: ${err.message}`);
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

/* ── Providers ── */

opencodeRouter.get("/providers", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.listProviders(directory);
  if (isOpenCodeError(result)) {
    sendBrowserProviderCatalogError(res, result);
    return;
  }
  res.json({ data: toBrowserProviderCatalog(result) });
});

opencodeRouter.get("/builtin-providers", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.listProviders(directory);

  if (isOpenCodeError(result)) {
    res.json({ data: { models: [], defaultModel: null, source: "unavailable" } });
    return;
  }

  const builtinProvider = getBuiltinChatProvider(result);
  if (!builtinProvider) {
    res.json({ data: { models: [], defaultModel: null, source: "unavailable" } });
    return;
  }

  res.json({
    data: {
      providerId: builtinProvider.providerId,
      providerName: builtinProvider.label,
      models: builtinProvider.models.map((model) => ({
        id: model.id,
        name: model.label,
        providerID: builtinProvider.providerId,
      })),
      defaultModel: builtinProvider.defaultModel,
      source: "runtime",
    },
  });
});

opencodeRouter.get("/integrations", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const result = await opencodeClient.listIntegrations(req.query.directory as string | undefined);
  sendResult(req, res, result);
});

function isSafeIdentifier(value: unknown): value is string {
  return isSafeBrowserIdentifier(value);
}

function isValidProviderKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 8192 && !/[\x00-\x1F\x7F]/.test(value);
}

function validateOAuthInputs(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 12) return null;
  const inputs: Record<string, string> = {};
  for (const [key, input] of entries) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key) || typeof input !== "string" || input.length > 1024 || /[\r\n\0]/.test(input)) {
      return null;
    }
    inputs[key] = input;
  }
  return inputs;
}

function isSafeOAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"));
  } catch {
    return false;
  }
}

function respondNativeProviderPersistenceFailure(
  res: Response,
  persistence: NativeProviderCredentialPersistenceStatus,
  action: "connect" | "disconnect",
): void {
  logger.warn(SOURCE, "Native provider credential saga could not access the vault", { action, status: persistence });
  if (persistence === "global_unavailable") {
    res.status(503).json({
      error: {
        code: "GLOBAL_PROJECT_UNAVAILABLE",
        message: "Provider credential storage requires the canonical global project.",
      },
    });
    return;
  }
  if (persistence === "conflict") {
    res.status(409).json({
      error: {
        code: "PROVIDER_CREDENTIAL_CONFLICT",
        message: `A saved provider credential needs operator review before it can be ${action === "connect" ? "changed" : "removed"}.`,
      },
    });
    return;
  }
  res.status(409).json({
    error: {
      code: "VAULT_REQUIRED",
      message: action === "connect"
        ? "Unseal and initialize the vault before connecting a provider with an API key."
        : "Unseal the vault before disconnecting a provider with a saved API key.",
    },
  });
}

function respondNativeProviderQueueRejected(res: Response): void {
  res.setHeader("Retry-After", "2");
  res.status(503).json({
    error: {
      code: "PROVIDER_OPERATION_RETRY",
      message: "Provider operation is busy. Try again shortly.",
      retryable: true,
    },
  });
}

opencodeRouter.post("/integrations/:integrationID/connect/key", async (req, res) => {
  if (!guardPassword(req, res)) return;
  if (!isSafeIdentifier(req.params.integrationID) || !isValidProviderKey(req.body?.key)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "API key is required" } });
    return;
  }
  const providerId = req.params.integrationID!;
  const saga = await connectNativeProviderCredential(providerId, req.body.key, {
    apply: (key, signal) => opencodeClient.connectIntegrationKey(providerId, key, signal),
    remove: (signal) => opencodeClient.deleteAuth(providerId, undefined, signal),
    status: (signal) => opencodeClient.getAuthStatus(undefined, signal),
  });
  if (saga.outcome === "queue_rejected") {
    respondNativeProviderQueueRejected(res);
    return;
  }
  if (saga.outcome === "persistence_failed") {
    respondNativeProviderPersistenceFailure(res, saga.persistence, "connect");
    return;
  }
  if (saga.outcome === "connected") {
    res.status(200).json({ data: { connected: true } });
    return;
  }
  logger.warn(SOURCE, "Native provider key connection failed", { compensation: saga.compensation });
  res.status(502).json({ error: { code: "PROVIDER_CONNECTION_FAILED", message: "Provider connection failed" } });
});

opencodeRouter.post("/integrations/:integrationID/connect/oauth", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const inputs = validateOAuthInputs(req.body?.inputs);
  if (!isSafeIdentifier(req.params.integrationID) || !isSafeIdentifier(req.body?.methodID) || !inputs) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "OAuth methodID is required" } });
    return;
  }
  const result = await opencodeClient.beginIntegrationOAuth(req.params.integrationID!, req.body.methodID, inputs);
  if (!isOpenCodeError(result) && !isSafeOAuthUrl(result.data.url)) {
    await opencodeClient.cancelIntegrationAttempt(result.data.attemptID);
    res.status(502).json({ error: { code: "UNSAFE_OAUTH_URL", message: "Provider returned an unsafe authorization URL" } });
    return;
  }
  if (!isOpenCodeError(result)) {
    const callbackUrl = new URL(result.data.url);
    const state = callbackUrl.searchParams.get("state");
    if (!state || state.length > 1024 || /[\r\n\0]/.test(state)) {
      await opencodeClient.cancelIntegrationAttempt(result.data.attemptID);
      res.status(502).json({ error: { code: "INVALID_OAUTH_STATE", message: "Provider returned an invalid authorization request" } });
      return;
    }
    pruneOAuthAttempts();
    if (pendingOAuthAttempts.size >= MAX_PENDING_OAUTH_ATTEMPTS) {
      await opencodeClient.cancelIntegrationAttempt(result.data.attemptID);
      res.status(503).json({ error: { code: "OAUTH_CAPACITY_REACHED", message: "Too many pending authorization requests. Try again shortly." } });
      return;
    }
    pendingOAuthAttempts.set(state, {
      attemptID: result.data.attemptID,
      mode: result.data.mode,
      expiresAt: Math.min(Date.now() + OAUTH_ATTEMPT_TTL_MS, result.data.time.expires),
    });
  }
  sendResult(req, res, result);
});

opencodeRouter.get("/integration-attempts/:attemptID", async (req, res) => {
  if (!guardPassword(req, res)) return;
  if (!isSafeIdentifier(req.params.attemptID)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Invalid OAuth attempt ID" } });
    return;
  }
  const result = await opencodeClient.getIntegrationAttempt(req.params.attemptID!);
  sendResult(req, res, result);
});

opencodeRouter.post("/integration-attempts/:attemptID/complete", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const code = typeof req.body?.code === "string" ? req.body.code : undefined;
  if (!isSafeIdentifier(req.params.attemptID) || (code !== undefined && (code.length > 4096 || /[\r\n\0]/.test(code)))) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Invalid OAuth completion request" } });
    return;
  }
  const result = await opencodeClient.completeIntegrationAttempt(req.params.attemptID!, code);
  sendResult(req, res, result);
});

opencodeRouter.delete("/integration-attempts/:attemptID", async (req, res) => {
  if (!guardPassword(req, res)) return;
  if (!isSafeIdentifier(req.params.attemptID)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Invalid OAuth attempt ID" } });
    return;
  }
  const result = await opencodeClient.cancelIntegrationAttempt(req.params.attemptID!);
  sendResult(req, res, result);
});

/* ── Auth ── */

opencodeRouter.post("/auth/:providerID", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const body = req.body || {};

  if (!isSafeIdentifier(req.params.providerID) || (body.key !== undefined && !isValidProviderKey(body.key))) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "A valid API key is required" } });
    return;
  }
  if (typeof body.key === "string") {
    const providerId = req.params.providerID!;
    const saga = await connectNativeProviderCredential(providerId, body.key, {
      apply: (key, signal) => opencodeClient.addAuth(providerId, { ...body, key }, directory, signal),
      remove: (signal) => opencodeClient.deleteAuth(providerId, directory, signal),
      status: (signal) => opencodeClient.getAuthStatus(directory, signal),
    });
    if (saga.outcome === "queue_rejected") {
      respondNativeProviderQueueRejected(res);
      return;
    }
    if (saga.outcome === "persistence_failed") {
      respondNativeProviderPersistenceFailure(res, saga.persistence, "connect");
      return;
    }
    if (saga.outcome === "connected") {
      res.status(200).json({ data: { connected: true } });
      return;
    }
    logger.warn(SOURCE, "Native provider key connection failed", { compensation: saga.compensation });
    res.status(502).json({ error: { code: "PROVIDER_CONNECTION_FAILED", message: "Provider connection failed" } });
    return;
  }

  // Redact key from logging
  const bodyForLog = { ...body };
  if (bodyForLog.key) bodyForLog.key = "***REDACTED***";
  logger.debug(SOURCE, `POST /auth/${req.params.providerID}`, { body: bodyForLog });

  const result = await callOpenCodeWithProviderDeadline((signal) =>
    opencodeClient.addAuth(req.params.providerID!, body, directory, signal),
  );
  sendResult(req, res, result);
});

opencodeRouter.delete("/auth/:providerID", async (req, res) => {
  if (!guardPassword(req, res)) return;
  if (!isSafeIdentifier(req.params.providerID)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "A valid provider ID is required" } });
    return;
  }
  const directory = req.query.directory as string | undefined;
  const providerId = req.params.providerID!;
  const saga = await disconnectNativeProviderCredential(providerId, {
    apply: (key, signal) => opencodeClient.addAuth(providerId, { type: "api", key }, directory, signal),
    remove: (signal) => opencodeClient.deleteAuth(providerId, directory, signal),
    status: (signal) => opencodeClient.getAuthStatus(directory, signal),
  });
  if (saga.outcome === "queue_rejected") {
    respondNativeProviderQueueRejected(res);
    return;
  }
  if (saga.outcome === "persistence_failed") {
    respondNativeProviderPersistenceFailure(res, saga.persistence, "disconnect");
    return;
  }
  if (saga.outcome === "disconnected") {
    res.status(200).json({ data: { disconnected: true } });
    return;
  }
  logger.warn(SOURCE, "Native provider disconnect failed", {
    outcome: saga.outcome,
    ...("compensation" in saga ? { compensation: saga.compensation } : {}),
  });
  res.status(502).json({ error: { code: "PROVIDER_DISCONNECT_FAILED", message: "Provider disconnect failed" } });
});

opencodeRouter.get("/auth/status", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await callOpenCodeWithProviderDeadline((signal) => opencodeClient.getAuthStatus(directory, signal));
  sendResult(req, res, result);
});

/* ── Agents ── */

opencodeRouter.get("/agents", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const result = await opencodeClient.listAgents();
  sendResult(req, res, result);
});

/* ── MCP ── */

opencodeRouter.get("/mcp", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.getMCPStatus(directory);
  if (!isOpenCodeError(result)) {
    const normalized = normalizeMcpStatusResponse(result);
    if (!normalized) {
      logger.warn(SOURCE, "OpenCode returned an invalid MCP status response");
      res.status(502).json({
        error: {
          code: "MCP_STATUS_INVALID",
          message: "OpenCode returned an invalid MCP status response.",
        },
      });
      return;
    }
    res.json({ data: normalized });
    return;
  }
  // GET status is a browser contract just like the mutation routes. Upstream
  // codes can be opaque diagnostic identifiers, so neither log nor reflect
  // them even when they match the otherwise-valid proxy error-code regex.
  logger.warn(SOURCE, "MCP status request failed");
  res.status(502).json({
    error: {
      code: "MCP_STATUS_FAILED",
      message: "Unable to retrieve MCP server status.",
    },
  });
});

opencodeRouter.post("/mcp/:name/connect", async (req, res) => {
  if (!guardPassword(req, res)) return;
  if (!isSafeMcpServerName(req.params.name)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Invalid MCP server name" } });
    return;
  }
  const result = await opencodeClient.connectMCP(req.params.name!);
  if (isOpenCodeError(result)) {
    // Mutation responses are a route-owned contract. Do not pass an upstream
    // error code into a response or log context: provider codes may encode
    // credentials, topology, or opaque diagnostic identifiers.
    logger.warn(SOURCE, "MCP connect request failed");
    res.status(502).json({
      error: {
        code: "MCP_CONNECT_FAILED",
        message: "Unable to connect to the MCP server.",
      },
    });
    return;
  }
  // Upstream success bodies are not a browser contract and can contain
  // credentials, endpoint topology, or implementation diagnostics.
  res.status(200).json({ data: { accepted: true } });
});

opencodeRouter.post("/mcp/:name/disconnect", async (req, res) => {
  if (!guardPassword(req, res)) return;
  if (!isSafeMcpServerName(req.params.name)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Invalid MCP server name" } });
    return;
  }
  const result = await opencodeClient.disconnectMCP(req.params.name!);
  if (isOpenCodeError(result)) {
    logger.warn(SOURCE, "MCP disconnect request failed");
    res.status(502).json({
      error: {
        code: "MCP_DISCONNECT_FAILED",
        message: "Unable to disconnect from the MCP server.",
      },
    });
    return;
  }
  // See connect: do not proxy arbitrary upstream success payloads.
  res.status(200).json({ data: { accepted: true } });
});
