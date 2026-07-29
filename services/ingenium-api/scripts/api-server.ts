import express from "express";
import cors from "cors";
import helmet from "helmet";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { agents, backups, logger, getDb, MAX_ATTACHMENT_SIZE, resolveCoreDbPath } from "ingenium-core";
import { config } from "../config/index.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { authMiddleware } from "../lib/middleware/auth.js";
import { assertApiTokenConfigured } from "../lib/middleware/api-token.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";
import { rateLimit } from "../lib/middleware/rate-limit.js";
import { projectsRouter } from "../lib/routes/projects.js";
import { skillsRouter } from "../lib/routes/skills.js";
import { tasksRouter } from "../lib/routes/tasks.js";
import { contextRouter } from "../lib/routes/context.js";
import {
  CONTEXT_SNAPSHOT_INGEST_PATH,
  contextSnapshotIngestRouter,
} from "../lib/routes/context-snapshot-ingest.js";
import { pluginsRouter } from "../lib/routes/plugins.js";
import { serversRouter } from "../lib/routes/servers.js";
import {
  CHILD_MCP_RUNTIME_HANDOFF_PATH,
  childMcpRuntimeRouter,
  mcpServersRouter,
} from "../lib/routes/mcp-servers.js";
import { settingsRouter } from "../lib/routes/settings.js";
import { agentsRouter } from "../lib/routes/agents.js";
import { observationsRouter } from "../lib/routes/observations.js";
import { personalityRouter } from "../lib/routes/personality.js";
import { synthesisRouter } from "../lib/routes/synthesis.js";
import { pipelineRouter } from "../lib/routes/pipeline.js";
import { emailsRouter } from "../lib/routes/emails.js";
import { commandsRouter } from "../lib/routes/commands.js";
import { configRouter } from "../lib/routes/configs.js";
import { mcpToolsRouter } from "../lib/routes/mcp-tools.js";
import { logsRouter } from "../lib/routes/logs.js";
import { createOAuthCallbackRateLimiter, handleOAuthCallback, opencodeRouter } from "../lib/routes/opencode.js";
import { extractionRouter } from "../lib/routes/extraction.js";
import { jobsRouter } from "../lib/routes/jobs.js";
import { servicesRouter } from "../lib/routes/services.js";
import { dashboardRouter } from "../lib/routes/dashboard.js";
import { vaultRouter } from "../lib/routes/vault.js";
import { router as docsRouter } from "../lib/routes/docs.js";
import { repositoryRouter } from "../lib/routes/repository.js";
import { router as docsAiRouter } from "../lib/routes/docs-ai.js";
import { backupsRouter } from "../lib/routes/backups.js";
import { ragRouter } from "../lib/routes/rag.js";
import { usageRouter } from "../lib/routes/usage.js";
import { authPreflightRouter } from "../lib/routes/auth-preflight.js";
import {
  defaultMcpServerProjection,
  isPackagedMcpLauncher,
  resolvePackagedMcpLauncher,
} from "../lib/mcp-launcher.js";
import { projects as projectsDb, protectedSettings, servers } from "ingenium-core";
import { startScheduler } from "../lib/scheduler.js";
import { startBackupScheduler } from "../lib/backup-scheduler.js";
import { createApiLifecycle, installShutdownSignalHandlers, type ApiLifecycle } from "../lib/lifecycle.js";
import { startMailMaintenance } from "../lib/mail-maintenance.js";
import { shouldStartBackgroundSchedulers, shouldStartMailMaintenance } from "../lib/runtime-mode.js";

/**
 * Ensure the global-default project exists at startup.
 *
 * Canonical deployments use docker-entrypoint.sh to create this project via the
 * API, but local development and one-shot processes (tsx scripts/api-server.ts)
 * need it to exist before the scheduler and email engine can function.
 *
 * Idempotent: if the project already exists, this is a no-op.
 */
function ensureGlobalProject(): string | null {
  try {
    const global = projectsDb.ensureGlobalProject();
    // The broker is a system-owned profile. Its dedicated core bootstrap emits
    // the only row accepted by migration 058; no public agent route can create
    // or reactivate it.
    agents.bootstrapReservedBroker(global.id);
    const migrations = protectedSettings.migrateLegacyOAuthClientSecrets(global.id);
    const deferred = migrations.filter((migration) => migration.status === "vault_unavailable").length;
    const conflicts = migrations.filter((migration) => migration.status === "legacy_conflict").length;
    if (deferred > 0) {
      logger.info("api", "OAuth client-secret migration deferred until the vault is unsealed", { deferred });
    }
    if (conflicts > 0) {
      logger.warn("api", "OAuth client-secret migration requires operator review", { conflicts });
    }
    return global.id;
  } catch {
    logger.warn("api", "Failed to create the global-default project. Email engine and cross-project features will be unavailable until one is created via /init-project or the Settings page.");
    return null;
  }
}

export const app = express();

// Do not trust X-Forwarded-For by default. Docker sends host and dashboard
// traffic through the credential boundary proxy; deployments behind another
// proxy must configure a trusted proxy explicitly rather than allowing clients
// to choose their rate-limit IP.
app.set("trust proxy", false);

// ════════════════════════════════════════════════════════════════════════════
// Middleware pipeline — order matters:
//   1. Security headers  (helmet)
//   2. CORS              (must be early; preflight OPTIONS won't reach auth)
//   3. Body parsing      (JSON → urlencoded)
//   4. Rate limiting     (before auth: throttles brute-force token attempts)
//   5. Auth              (after rate-limit: limited IPs never pay token cmp cost;
//                          exact OAuth callback is the only allowlisted route)
// ════════════════════════════════════════════════════════════════════════════

app.use(helmet());
// SECURITY: CORS and CSRF consume the same exact, credential-free dashboard
// allowlist. Same-origin dashboard calls do not need CORS preflight.
// Preflight requests continue to auth instead of becoming an implicit public
// API allowlist. Same-origin dashboard calls do not need CORS preflight.
app.use(cors({ origin: [...config.dashboardOrigins], preflightContinue: true }));
// 2mb JSON limit accommodates skill content, email bodies, and plugin source files
// without opening the door to oversized payload attacks. The attachment endpoint
// uses a separate, larger limit via MAX_ATTACHMENT_SIZE.
app.use(express.json({ limit: "2mb" }));
// MAX_ATTACHMENT_SIZE (from ingenium-core) sets the body parser limit for file uploads;
// converting bytes → MB for the human-readable `limit` string passed to urlencoded.
app.use(express.urlencoded({ limit: `${Math.round(MAX_ATTACHMENT_SIZE / (1024 * 1024))}mb`, extended: true }));
app.use(rateLimit);
app.use(authMiddleware);
app.use(csrfMiddleware);

// OpenAI redirects the browser to localhost:1455/auth/callback. The Nginx
// listener on that port proxies only this exact GET path. authMiddleware owns
// the matching public allowlist; state validation and a dedicated rate limiter
// remain mandatory before the callback can complete.
app.get("/auth/callback", createOAuthCallbackRateLimiter(), handleOAuthCallback);

// Health check
app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});
app.use("/api/v1/auth", authPreflightRouter);

// Routes
// Mounted after bearer/CSRF protection. Its dedicated octet-stream media type
// avoids the global JSON parser and it owns its own bounded raw parser.
app.use(CONTEXT_SNAPSHOT_INGEST_PATH, contextSnapshotIngestRouter);
// This is deliberately outside `/api/v1`, which is the dashboard's entire
// rewrite namespace. It is a bearer-authenticated server-to-server handoff for
// resolved child-MCP environment values, not a browser API route.
app.use(CHILD_MCP_RUNTIME_HANDOFF_PATH, childMcpRuntimeRouter);
app.use("/api/v1/projects", projectsRouter);
app.use("/api/v1/skills", skillsRouter);
app.use("/api/v1/tasks", tasksRouter);
app.use("/api/v1/context", contextRouter);
app.use("/api/v1/plugins", pluginsRouter);
app.use("/api/v1/servers", serversRouter);
app.use("/api/v1/mcp-servers", mcpServersRouter);
app.use("/api/v1/settings", settingsRouter);
// Vault brute-force protection is mounted inside vaultRouter only on passphrase
// initialization and unseal routes. Status and metadata reads remain available
// while a client is cooling down after HTTP 429.
app.use("/api/v1/vault", vaultRouter);
app.use("/api/v1/agents", agentsRouter);
app.use("/api/v1/observations", observationsRouter);
app.use("/api/v1/personality", personalityRouter);
app.use("/api/v1/synthesis", synthesisRouter);
app.use("/api/v1/pipeline", pipelineRouter);
app.use("/api/v1/emails", emailsRouter);
app.use("/api/v1/commands", commandsRouter);
app.use("/api/v1/config", configRouter);
app.use("/api/v1/mcp-tools", mcpToolsRouter);
app.use("/api/v1/logs", logsRouter);
app.use("/api/v1/opencode", opencodeRouter);
app.use("/api/v1/extraction", extractionRouter);
app.use("/api/v1/jobs", jobsRouter);

// System-level routes (no project dependency)
app.use("/api/v1/services", servicesRouter);
app.use("/api/v1/dashboard", dashboardRouter);
app.use("/api/v1/docs", docsRouter);
app.use("/api/v1/repository", repositoryRouter);
app.use("/api/v1/docs", docsAiRouter);
app.use("/api/v1/backups", backupsRouter);
app.use("/api/v1/rag", ragRouter);
app.use("/api/v1/usage", usageRouter);

// Error handler must be registered AFTER all routes — Express 4 does not catch errors
// from middleware registered below the error handler.
app.use(errorHandler);

function runStartupMaintenance(lifecycle: ApiLifecycle): void {
  logger.info("api", `ingenium-api listening privately on 127.0.0.1:${config.port}`);

  // Ensure global-default exists before schedulers or mail maintenance use it.
  const globalProjectId = ensureGlobalProject();

  // Migration 061 can run before a first-start global project is created. Run
  // the idempotent backfill again after startup resolution so those legacy
  // records are not stranded in an external namespace.
  if (globalProjectId) {
    backups.migrateLegacyBackupOwnership(globalProjectId);
  }

  if (shouldStartBackgroundSchedulers()) {
    startScheduler(config.port);
    startBackupScheduler();
  } else {
    logger.info("api", "Background schedulers disabled by API test/maintenance mode");
  }

  if (shouldStartMailMaintenance()) {
    startMailMaintenance(lifecycle, globalProjectId);
  } else {
    logger.info("api", "Mail maintenance disabled by API test/maintenance mode");
  }

  // 🔴 Durability: run WAL checkpoint + integrity check at startup.
  // Ensures the WAL is truncated before the scheduler starts writing; integrity_check
  // catches corruption early (disk-full or unclean shutdown) before any data is processed.
  const dbPath = resolveCoreDbPath();
  try {
    const db = getDb(dbPath);
    const checkpoint = db.pragma("wal_checkpoint(TRUNCATE)");
    const integrity = db.pragma("integrity_check");
    logger.info("api", "DB startup check", { checkpoint, integrity });
  } catch {
    logger.error("api", "DB startup check failed");
  }

  // Register the default Ingenium MCP server in the DB (idempotent — skips if exists).
  // Previously done by docker-entrypoint.sh curl calls; moving here ensures the server
  // is registered in all environments (Docker, tsx dev, etc.) at startup.
  try {
    const globalProjectRec = projectsDb.getGlobalProject();
    if (globalProjectRec) {
      const launcherPath = resolvePackagedMcpLauncher(import.meta.url);
      if (!isPackagedMcpLauncher(launcherPath)) {
        logger.warn("api", "Default Ingenium MCP launcher is unavailable; build @ingenium/extension before starting OpenCode");
        return;
      }
      const projection = defaultMcpServerProjection(launcherPath);
      servers.upsertServer(
        globalProjectRec.id,
        "ingenium",
        projection.command,
        projection.args,
        projection.environment,
        "opencode",
      );
      servers.updateServer(globalProjectRec.id, "ingenium", { running: 1 });
      logger.info("api", "Registered default Ingenium MCP server");
    }
  } catch {
    logger.warn("api", "MCP server registration skipped");
  }
}

function installFatalErrorHandlers(lifecycle: ApiLifecycle): () => void {
  const onUncaughtException = (error: Error) => {
    // Provider errors can include OAuth codes, Authorization headers, URLs, or
    // upstream bodies. Log only a stable operational message.
    void error;
    console.error("[api] FATAL unexpected exception — beginning graceful shutdown");
    void lifecycle.shutdown("uncaughtException").finally(() => {
      process.exitCode = 1;
    });
  };
  const onUnhandledRejection = (reason: unknown) => {
    void reason;
    console.error("[api] FATAL unhandled rejection");
  };

  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);
  return () => {
    process.removeListener("uncaughtException", onUncaughtException);
    process.removeListener("unhandledRejection", onUnhandledRejection);
  };
}

export interface ApiServerHandle {
  app: express.Express;
  server: Server;
  lifecycle: ApiLifecycle;
  disposeSignalHandlers: () => void;
}

/** Start the private HTTP listener and attach graceful lifecycle ownership. */
export function startApiServer(): ApiServerHandle | null {
  // Refuse to bind when the credential is absent, malformed, or stored in an
  // unsafe token file. No explicit hard exit is required: no listener or
  // timer remains, and the non-zero exitCode is observed by supervisord.
  try {
    assertApiTokenConfigured();
  } catch {
    console.error("[api] FATAL API authentication configuration is invalid");
    process.exitCode = 1;
    return null;
  }

  const server = app.listen(config.port, "127.0.0.1");
  const lifecycle = createApiLifecycle(server);
  const disposeSignals = installShutdownSignalHandlers(lifecycle);
  const disposeFatalHandlers = installFatalErrorHandlers(lifecycle);
  lifecycle.registerCleanup("process-handlers", () => {
    disposeSignals();
    disposeFatalHandlers();
  });

  server.once("listening", () => runStartupMaintenance(lifecycle));
  server.once("error", () => {
    console.error("[api] FATAL HTTP listener failed — beginning graceful shutdown");
    void lifecycle.shutdown("server-error").finally(() => {
      process.exitCode = 1;
    });
  });

  return { app, server, lifecycle, disposeSignalHandlers: disposeSignals };
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && pathToFileURL(entrypoint!).href === import.meta.url;
}

if (isMainModule()) startApiServer();

export default app;
