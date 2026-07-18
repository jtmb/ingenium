import express from "express";
import cors from "cors";
import helmet from "helmet";
import { logger, getDb, MAX_ATTACHMENT_SIZE } from "ingenium-core";
import { config } from "../config/index.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { authMiddleware } from "../lib/middleware/auth.js";
import { rateLimit, vaultRateLimiter } from "../lib/middleware/rate-limit.js";
import { projectsRouter } from "../lib/routes/projects.js";
import { skillsRouter } from "../lib/routes/skills.js";
import { tasksRouter } from "../lib/routes/tasks.js";
import { contextRouter } from "../lib/routes/context.js";
import { pluginsRouter } from "../lib/routes/plugins.js";
import { serversRouter } from "../lib/routes/servers.js";
import { settingsRouter } from "../lib/routes/settings.js";
import { agentsRouter } from "../lib/routes/agents.js";
import { observationsRouter } from "../lib/routes/observations.js";
import { personalityRouter } from "../lib/routes/personality.js";
import { synthesisRouter } from "../lib/routes/synthesis.js";
import { pipelineRouter } from "../lib/routes/pipeline.js";
import { emailsRouter, migrateEmailAccountsToGlobal } from "../lib/routes/emails.js";
import { startEngine, getGlobalProjectId } from "ingenium-email";
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
import { router as docsAiRouter } from "../lib/routes/docs-ai.js";
import { backupsRouter } from "../lib/routes/backups.js";
import { ragRouter } from "../lib/routes/rag.js";
import { projects as projectsDb } from "ingenium-core";
import { startScheduler } from "../lib/scheduler.js";
import { startBackupScheduler } from "../lib/backup-scheduler.js";

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
    const existing = projectsDb.getGlobalProject();
    if (existing) return existing.id;

    // No global project — create it. This matches docker-entrypoint.sh behavior.
    const created = projectsDb.createProject("global-default", true);
    logger.info("api", `Created global-default project (${created.id}) for core functionality`);
    return created.id;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("api", `Failed to create global-default project: ${msg}. Email engine and cross-project features will be unavailable until one is created via /init-project or the Settings page.`);
    return null;
  }
}

// 🔴 Log SYNCHRONOUSLY with console.error — async logs die before process.exit(1)
//    writes, hiding every crash from supervisord. See deep-seek Lessons 9 & 24.
//    unhandledRejection → log only (transport-layer errors should not crash)
//    uncaughtException   → log + exit(1) (undefined state, supervisord restarts)

process.on("uncaughtException", (err: Error) => {
  console.error("[api] FATAL uncaughtException — exiting:", err.message);
  console.error(err.stack || "(no stack)");
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : "(no stack)";
  console.error("[api] FATAL unhandledRejection:", msg);
  console.error(stack);
  // Do NOT call process.exit for unhandledRejection — just log.
  // The process may recover; exiting turns transport-layer issues into outages.
});

const app = express();

// Do not trust X-Forwarded-For by default. This API is directly exposed in local
// development and Docker; deployments behind a proxy must configure a trusted
// proxy explicitly rather than allowing clients to choose their rate-limit IP.
app.set("trust proxy", false);

// ════════════════════════════════════════════════════════════════════════════
// Middleware pipeline — order matters:
//   1. Security headers  (helmet)
//   2. CORS              (must be early; preflight OPTIONS won't reach auth)
//   3. Body parsing      (JSON → urlencoded)
//   4. Rate limiting     (before auth: throttles brute-force token attempts)
//   5. Auth              (after rate-limit: limited IPs never pay token cmp cost)
// ════════════════════════════════════════════════════════════════════════════

app.use(helmet());
// SECURITY: corsOrigin defaults to "http://localhost:3000". Override via the
// CORS_ORIGIN env var for deployments needing another origin.
app.use(cors({ origin: config.corsOrigin }));
// 2mb JSON limit accommodates skill content, email bodies, and plugin source files
// without opening the door to oversized payload attacks. The attachment endpoint
// uses a separate, larger limit via MAX_ATTACHMENT_SIZE.
app.use(express.json({ limit: "2mb" }));
// MAX_ATTACHMENT_SIZE (from ingenium-core) sets the body parser limit for file uploads;
// converting bytes → MB for the human-readable `limit` string passed to urlencoded.
app.use(express.urlencoded({ limit: `${Math.round(MAX_ATTACHMENT_SIZE / (1024 * 1024))}mb`, extended: true }));
// OpenAI redirects the browser to localhost:1455/auth/callback. Docker maps that
// fixed port to this API; state is validated by the handler before completion.
app.get("/auth/callback", createOAuthCallbackRateLimiter(), handleOAuthCallback);
app.use(rateLimit);
app.use(authMiddleware);

// Health check
app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Routes
app.use("/api/v1/projects", projectsRouter);
app.use("/api/v1/skills", skillsRouter);
app.use("/api/v1/tasks", tasksRouter);
app.use("/api/v1/context", contextRouter);
app.use("/api/v1/plugins", pluginsRouter);
app.use("/api/v1/servers", serversRouter);
app.use("/api/v1/settings", settingsRouter);
app.use("/api/v1/vault/initialize", vaultRateLimiter);
app.use("/api/v1/vault/unseal", vaultRateLimiter);
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
app.use("/api/v1/docs", docsAiRouter);
app.use("/api/v1/backups", backupsRouter);
app.use("/api/v1/rag", ragRouter);

// Error handler must be registered AFTER all routes — Express 4 does not catch errors
// from middleware registered below the error handler.
app.use(errorHandler);

// Start server + scheduler
app.listen(config.port, () => {
  logger.info("api", `ingenium-api listening on port ${config.port}`);

  // 🔴 Ensure global-default project exists before starting the scheduler,
  //    which depends on it for synthesis interval resolution and email engine.
  //    This is idempotent — if the project already exists, it's a no-op.
  ensureGlobalProject();

  startScheduler(config.port);
  startBackupScheduler();

  // 🔴 Email: migrate any project-scoped accounts to global, start sync engine
  // Defer 10s to let the DB fully initialize (WAL recovery, migration locks settle)
  // before touching email accounts. The email engine manages all IMAP I/O in-process. 
  setTimeout(() => {
    migrateEmailAccountsToGlobal().then((migrated) => {
      if (migrated > 0) {
        logger.info("api", `Migrated ${migrated} email settings to global project`);
      }
      // Start the sync engine instead of prefetch (engine owns all IMAP I/O now)
      startEngine(getGlobalProjectId());
      logger.info("api", "Email sync engine started for all connected accounts");
    }).catch((err) => { logger.warn("api", `Email engine start deferred: ${err.message}`); });
  }, 10_000); // Delay to ensure DB is fully initialized

  // 🔴 Durability: run WAL checkpoint + integrity check at startup.
  // Ensures the WAL is truncated before the scheduler starts writing; integrity_check
  // catches corruption early (disk-full or unclean shutdown) before any data is processed.
  const dbPath = process.env.INGENIUM_CORE_DB_PATH || "/app/.ingenium/data.db";
  try {
    const db = getDb(dbPath);
    const checkpoint = db.pragma("wal_checkpoint(TRUNCATE)");
    const integrity = db.pragma("integrity_check");
    logger.info("api", "DB startup check", { checkpoint, integrity });
  } catch (e: any) {
    logger.error("api", `DB startup check failed: ${e.message}`, { stack: e.stack });
  }
});

// Dynamic import to avoid circular dependency — ingenium-core is imported at the top of this
// file, but by the time SIGTERM fires, the module graph may be partially torn down.
// A fresh dynamic import ensures the logger module is still live.
process.on("SIGTERM", () => {
  import("ingenium-core").then(({ logger: crashLogger }) => {
    crashLogger.info("api", "SIGTERM received — shutting down gracefully");
  }).catch(() => {
    console.log("[api] SIGTERM received — shutting down");
  });
  process.exit(0);
});

process.on("SIGINT", () => {
  import("ingenium-core").then(({ logger: crashLogger }) => {
    crashLogger.info("api", "SIGINT received — shutting down gracefully");
  }).catch(() => {
    console.log("[api] SIGINT received — shutting down");
  });
  process.exit(0);
});

export default app;
