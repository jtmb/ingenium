import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { logger, settings } from "ingenium-core";
import {
  opencodeClient,
  isOpenCodeError,
} from "../opencode-client.js";
import { requireProject } from "../helpers.js";

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
 * Proxy routes validated against the v1.18.3 contract at /tmp/opencode-contract.md.
 */
export const opencodeRouter = Router();

/* ── Utility ── */

const SOURCE = "opencode-routes";

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
function sendResult(req: any, res: any, result: any, statusOnSuccess = 200): void {
  if (isOpenCodeError(result)) {
    const code = result.error.code;
    // Map known error codes to HTTP statuses
    let status: number;
    if (code === "AUTH_NOT_CONFIGURED") {
      status = 503;
    } else if (code === "NOT_FOUND" || code === "NotFoundError") {
      status = 404;
    } else if (code === "BadRequest" || code.startsWith("HTTP_4")) {
      status = 400;
    } else if (code.startsWith("HTTP_5")) {
      status = 502;
    } else {
      status = 502; // Default upstream error
    }
    logger.warn(
      SOURCE,
      `Proxy error: ${result.error.code} — ${result.error.message.slice(0, 120)}`,
      { method: req.method, path: req.originalUrl, code: result.error.code },
    );
    res.status(status).json(result);
    return;
  }

  res.status(statusOnSuccess).json({ data: result });
}

/* ── Sanitization ── */

const SENSITIVE_KEY_PATTERN = /api[_-]?key|secret|token|password/i;

/** Recursively walk an object and redact values whose keys match sensitive patterns. */
function sanitizeOptions(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sanitizeOptions);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = "***REDACTED***";
      } else if (typeof value === "object" && value !== null) {
        result[key] = sanitizeOptions(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return obj;
}

/** Redact sensitive fields from an individual auth provider entry. */
function sanitizeAuthEntry(entry: any): any {
  if (!entry || typeof entry !== "object") return entry;
  const sanitized = { ...entry };
  if (sanitized.type === "api" && "key" in sanitized) {
    sanitized.key = "***REDACTED***";
  }
  if (sanitized.type === "oauth") {
    if ("access" in sanitized) sanitized.access = "***REDACTED***";
    if ("refresh" in sanitized) sanitized.refresh = "***REDACTED***";
  }
  return sanitized;
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
  configured: boolean;
  primary: ChatProviderInfo | null;
  backup: ChatProviderInfo | null;
  providers: ExpandedChatProviderInfo[];
  agents: Array<{ name: string; label: string }>;
  restartRequired: boolean;
  defaultSelection: { providerId: string; modelId: string } | null;
}

interface ChatModelInfo {
  id: string;
  label: string;
}

interface ExpandedChatProviderInfo {
  providerId: string;
  label: string;
  models: ChatModelInfo[];
  defaultModel: string;
  source: "managed" | "builtin";
}

interface ManagedProviderConfig {
  id?: unknown;
  name?: unknown;
  models?: unknown;
  defaultModel?: unknown;
  roles?: unknown;
  role?: unknown;
  enabled?: unknown;
}

function hasAvailableRole(provider: ManagedProviderConfig): boolean {
  if (Array.isArray(provider.roles)) return provider.roles.includes("available");
  return provider.role === "available" || provider.role === "primary" || provider.role === "backup";
}

function getManagedChatProviders(projectId: string): ExpandedChatProviderInfo[] {
  const stored = settings.getSetting(projectId, "llm_provider_configs");
  let providers: ManagedProviderConfig[] = [];

  try {
    const parsed = stored ? JSON.parse(stored) : [];
    providers = Array.isArray(parsed) ? parsed : [];
  } catch {
    providers = [];
  }

  if (providers.length === 0) {
    const primaryProvider = settings.getSetting(projectId, "synthesis_provider") || "";
    const primaryModel = settings.getSetting(projectId, "synthesis_model") || "";
    const backupProvider = settings.getSetting(projectId, "synthesis_backup_provider") || "";
    const backupModel = settings.getSetting(projectId, "synthesis_backup_model") || "";
    if (primaryProvider && primaryModel) {
      providers.push({
        id: primaryProvider === "__custom__" ? "ingenium-primary" : primaryProvider,
        name: primaryProvider === "__custom__" ? "Custom" : primaryProvider,
        models: [primaryModel],
        defaultModel: primaryModel,
        roles: ["available", "primary"],
        enabled: true,
      });
    }
    if (backupProvider && backupModel) {
      providers.push({
        id: backupProvider === "__custom__" ? "ingenium-backup" : backupProvider,
        name: backupProvider === "__custom__" ? "Custom Backup" : backupProvider,
        models: [backupModel],
        defaultModel: backupModel,
        roles: ["available", "backup"],
        enabled: true,
      });
    }
  }

  return providers.flatMap((provider) => {
    if (provider.enabled !== true || !hasAvailableRole(provider)
      || typeof provider.id !== "string" || typeof provider.name !== "string"
      || !Array.isArray(provider.models) || typeof provider.defaultModel !== "string") {
      return [];
    }
    const models = provider.models
      .filter((model): model is string => typeof model === "string" && model.length > 0)
      .map((id) => ({ id, label: id }));
    if (models.length === 0) return [];
    return [{
      providerId: provider.id,
      label: provider.name,
      models,
      defaultModel: models.some((model) => model.id === provider.defaultModel)
        ? provider.defaultModel
        : models[0]!.id,
      source: "managed" as const,
    }];
  });
}

function getBuiltinChatProvider(result: unknown): ExpandedChatProviderInfo | null {
  if (isOpenCodeError(result)) return null;
  const response = result as { all?: any[]; default?: Record<string, string> };
  const opencodeZen = response.all?.find((provider) => provider.id === "opencode");
  if (!opencodeZen) return null;

  const models = Object.values(opencodeZen.models || {})
    .filter((model: any) => model.status === "active" && model.cost?.input === 0 && model.cost?.output === 0)
    .map((model: any) => ({ id: model.id, label: model.name || model.id }))
    .filter((model: ChatModelInfo) => typeof model.id === "string" && model.id.length > 0);
  if (models.length === 0) return null;

  const runtimeDefault = response.default?.opencode;
  return {
    providerId: "opencode",
    label: opencodeZen.name || "OpenCode Zen",
    models,
    defaultModel: models.some((model) => model.id === runtimeDefault) ? runtimeDefault! : models[0]!.id,
    source: "builtin",
  };
}

opencodeRouter.get("/chat-config", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const provider = settings.getSetting(projectId, "synthesis_provider") || "";
  const model = settings.getSetting(projectId, "synthesis_model") || "";
  const endpoint = settings.getSetting(projectId, "synthesis_endpoint") || "";

  const backupProvider = settings.getSetting(projectId, "synthesis_backup_provider") || "";
  const backupModel = settings.getSetting(projectId, "synthesis_backup_model") || "";

  const configured = !!(provider && model);

  const primary: ChatProviderInfo | null = configured
    ? {
        providerId: provider === "__custom__" ? "ingenium-primary" : provider,
        modelId: model,
        label: `${provider === "__custom__" ? "Custom" : provider}: ${model}${endpoint ? ` (${endpoint})` : ""}`,
        isCustom: provider === "__custom__",
      }
    : null;

  const backup: ChatProviderInfo | null =
    configured && backupProvider && backupModel
      ? {
          providerId: backupProvider === "__custom__" ? "ingenium-backup" : backupProvider,
          modelId: backupModel,
          label: `${backupProvider === "__custom__" ? "Custom Backup" : backupProvider}: ${backupModel}`,
          isCustom: backupProvider === "__custom__",
        }
      : null;

  // Read restart-pending flag set by POST /settings/llm-config
  const restartPending = settings.getSetting(projectId, "synthesis_restart_pending") === "true";
  const managedProviders = getManagedChatProviders(projectId);
  const builtinProvider = getBuiltinChatProvider(await opencodeClient.listProviders());
  const providers = builtinProvider ? [...managedProviders, builtinProvider] : managedProviders;
  const managedPrimary = managedProviders.find((candidate) => {
    try {
      const stored = settings.getSetting(projectId, "llm_provider_configs");
      const configuredProviders = stored ? JSON.parse(stored) : [];
      return Array.isArray(configuredProviders)
        && configuredProviders.some((item: ManagedProviderConfig) => item.id === candidate.providerId
          && (Array.isArray(item.roles) ? item.roles.includes("primary") : item.role === "primary"));
    } catch {
      return candidate.providerId === primary?.providerId;
    }
  });
  const defaultProvider = managedPrimary || builtinProvider || providers[0];

  const response: ChatConfigResponse = {
    configured,
    primary,
    backup,
    providers,
    agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
    restartRequired: restartPending,
    defaultSelection: defaultProvider
      ? { providerId: defaultProvider.providerId, modelId: defaultProvider.defaultModel }
      : null,
  };

  // Reset the flag — it was delivered to the client and the restart banner will show
  if (restartPending) {
    settings.setSetting(projectId, "synthesis_restart_pending", "false");
  }

  res.json({ data: response });
});

/* ═══════════════════════════════════════════════════════════════════════════
   OpenCode HTTP API proxy routes (v1.18.3 contract)
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Health ── */

opencodeRouter.get("/health", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const result = await opencodeClient.health();
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

/* ── Prompt (POST /sessions/:id/message — uses parts array per v1.18.3) ── */

opencodeRouter.post("/sessions/:id/prompt", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  // Body passes through as-is — frontend sends the parts array per contract
  const result = await opencodeClient.sendPrompt(req.params.id!, req.body, directory);
  sendResult(req, res, result, 201);
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
    logger.warn(SOURCE, `Share error for session ${req.params.id!}: ${code} — ${result.error.message.slice(0, 120)}`, {
      method: req.method, path: req.originalUrl, code, mappedStatus: status,
    });
    res.status(status).json(result);
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
  // Sanitize sensitive fields from provider options before responding
  if (!isOpenCodeError(result) && result.all) {
    result.all = result.all.map((provider: any) => ({
      ...provider,
      options: sanitizeOptions(provider.options),
    }));
  }
  sendResult(req, res, result);
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

/* ── Auth ── */

opencodeRouter.post("/auth/:providerID", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const body = req.body || {};

  // Redact key from logging
  const bodyForLog = { ...body };
  if (bodyForLog.key) bodyForLog.key = "***REDACTED***";
  logger.debug(SOURCE, `POST /auth/${req.params.providerID}`, { body: bodyForLog });

  const result = await opencodeClient.addAuth(req.params.providerID!, body, directory);
  sendResult(req, res, result);
});

opencodeRouter.delete("/auth/:providerID", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.deleteAuth(req.params.providerID!, directory);
  sendResult(req, res, result);
});

opencodeRouter.get("/auth/status", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const directory = req.query.directory as string | undefined;
  const result = await opencodeClient.getAuthStatus(directory);

  // Sanitize sensitive fields from auth entries
  if (!isOpenCodeError(result)) {
    const sanitized: Record<string, unknown> = {};
    for (const [providerID, entry] of Object.entries(result as Record<string, unknown>)) {
      sanitized[providerID] = sanitizeAuthEntry(entry);
    }
    sendResult(req, res, sanitized);
    return;
  }

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
  sendResult(req, res, result);
});

opencodeRouter.post("/mcp/:name/connect", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const result = await opencodeClient.connectMCP(req.params.name!);
  sendResult(req, res, result);
});

opencodeRouter.post("/mcp/:name/disconnect", async (req, res) => {
  if (!guardPassword(req, res)) return;
  const result = await opencodeClient.disconnectMCP(req.params.name!);
  sendResult(req, res, result);
});
