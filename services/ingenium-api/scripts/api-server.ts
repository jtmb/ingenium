import express from "express";
import cors from "cors";
import helmet from "helmet";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { agents, authentication, backups, emailKeyTransition, jobs, logger, getDb, MAX_ATTACHMENT_SIZE, resolveCoreDbPath } from "ingenium-core";
import { getEmailEncryptionKeyFingerprint } from "ingenium-email/lib/credential-crypto";
import { config } from "../config/index.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { authMiddleware } from "../lib/middleware/auth.js";
import { assertApiTokenConfigured } from "../lib/middleware/api-token.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import {
  authPreflightReadRateLimit,
  authenticatedReadRateLimit,
  coordinationRateLimit,
  rateLimit,
  recordCandidateAuthenticationFailure,
  recordCoordinationAttestationFailure,
} from "../lib/middleware/rate-limit.js";
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
import { coordinationRouter } from "../lib/routes/coordination.js";
import { bootstrapRouter } from "../lib/routes/bootstrap.js";
import { organizationsRouter } from "../lib/routes/organizations.js";
import { runtimesRouter } from "../lib/routes/runtimes.js";
import {
  defaultMcpServerProjection,
  isPackagedMcpLauncher,
  resolvePackagedMcpLauncher,
} from "../lib/mcp-launcher.js";
import { projects as projectsDb, protectedSettings, servers, skillGovernance } from "ingenium-core";
import { startScheduler } from "../lib/scheduler.js";
import { recoverVaultSecretRunDirectories } from "../lib/job-runner.js";
import { startBackupScheduler } from "../lib/backup-scheduler.js";
import { createApiLifecycle, installShutdownSignalHandlers, type ApiLifecycle } from "../lib/lifecycle.js";
import { startMailMaintenance } from "../lib/mail-maintenance.js";
import { isControlPlaneMode, shouldStartBackgroundSchedulers, shouldStartMailMaintenance } from "../lib/runtime-mode.js";
import { startRestoreMaintenance } from "../lib/restore-supervisor.js";
import { configureEmailRuntimeForApi } from "../lib/email-runtime.js";
import { recoverServerGlobalProviderMetadata } from "../lib/server-global-provider-persistence.js";
import { runtimeOpenCodeContext } from "../lib/runtime-opencode-context.js";
import { startRuntimeReconciler } from "../lib/runtime-reconciler.js";

configureEmailRuntimeForApi();

/**
 * Ensure the global-default project exists at startup.
 *
 * Canonical deployments use docker-entrypoint.sh to create this project via the
 * API, but local development and one-shot processes (tsx scripts/api-server.ts)
 * need it to exist before the scheduler and email engine can function.
 *
 * Idempotent: if the project already exists, this is a no-op.
 */
export function ensureGlobalProject(): string | null {
  try {
    const global = projectsDb.ensureCanonicalGlobalProject();
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
    const providerRecovery = recoverServerGlobalProviderMetadata();
    if (providerRecovery.migratedSettings > 0 || providerRecovery.migratedCredentials > 0
      || providerRecovery.conflicts > 0 || providerRecovery.skippedForVault) {
      logger.info("api", "Server-global provider recovery completed", providerRecovery);
    }
    return global.id;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Reserved LLM broker")) {
      logger.error("api", "Reserved LLM broker startup validation failed; refusing unsafe startup");
      throw error;
    }
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

app.use(helmet());
// Keep preflight on the authenticated path so CORS cannot create a public API route.
app.use(cors({ origin: [...config.dashboardOrigins], preflightContinue: true }));
// 2mb JSON limit accommodates skill content, email bodies, and plugin source files
// without opening the door to oversized payload attacks. The attachment endpoint
// uses a separate, larger limit via MAX_ATTACHMENT_SIZE.
app.use(express.json({ limit: "2mb" }));
// MAX_ATTACHMENT_SIZE (from ingenium-core) sets the body parser limit for file uploads;
// converting bytes → MB for the human-readable `limit` string passed to urlencoded.
app.use(express.urlencoded({ limit: `${Math.round(MAX_ATTACHMENT_SIZE / (1024 * 1024))}mb`, extended: true }));
app.use(authPreflightReadRateLimit);
app.use(rateLimit);
app.use(authMiddleware);
app.use(recordCandidateAuthenticationFailure);
app.use(authenticatedReadRateLimit);
app.use(csrfMiddleware);
app.use(authorizationMiddleware);
app.use(recordCoordinationAttestationFailure);

// OpenAI redirects the browser to localhost:1455/auth/callback. The Nginx
// listener on that port proxies only this exact GET path. authMiddleware owns
// the matching public allowlist; state validation and a dedicated rate limiter
// remain mandatory before the callback can complete.
app.get("/auth/callback", createOAuthCallbackRateLimiter(), handleOAuthCallback);

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});
app.use("/api/v1/auth", authPreflightRouter);
app.use("/api/v1/bootstrap", bootstrapRouter);
app.use("/api/v1/organizations", organizationsRouter);

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
app.use("/api/v1/coordination", coordinationRateLimit);
app.use("/api/v1/coordination", coordinationRouter);
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
app.use("/api/v1/opencode", runtimeOpenCodeContext, opencodeRouter);
app.use("/api/v1/extraction", extractionRouter);
app.use("/api/v1/jobs", jobsRouter);

app.use("/api/v1/services", servicesRouter);
app.use("/api/v1/dashboard", dashboardRouter);
app.use("/api/v1/docs", docsRouter);
app.use("/api/v1/repository", repositoryRouter);
app.use("/api/v1/docs", docsAiRouter);
app.use("/api/v1/backups", backupsRouter);
app.use("/api/v1/rag", ragRouter);
app.use("/api/v1/usage", usageRouter);
app.use("/api/v1/runtimes", runtimesRouter);

// Error handler must be registered AFTER all routes — Express 4 does not catch errors
// from middleware registered below the error handler.
app.use(errorHandler);

export function recoverInterruptedJobRunsAtStartup(): number {
  try {
    const recoveredRuns = jobs.recoverInterruptedJobRuns();
    if (recoveredRuns > 0) {
      logger.warn("api", "Marked interrupted ordinary job runs as failed after API restart", { recoveredRuns });
    }
    return recoveredRuns;
  } catch {
    logger.warn("api", "Interrupted ordinary job run recovery failed; scheduler start will continue");
    return 0;
  }
}

function runStartupMaintenance(lifecycle: ApiLifecycle): void {
  const host = isControlPlaneMode() ? "0.0.0.0" : "127.0.0.1";
  logger.info("api", `ingenium-api listening privately on ${host}:${config.port}`);

  // Ensure global-default exists before schedulers or mail maintenance use it.
  const globalProjectId = ensureGlobalProject();
  recoverInterruptedJobRunsAtStartup();

  try {
    const proposalReconciliation = skillGovernance.reconcileOpenProposalCandidates();
    if (proposalReconciliation.keysAssigned > 0 || proposalReconciliation.staleProposals > 0 || proposalReconciliation.truncated) {
      logger.info("api", "Reconciled open skill proposal candidates", proposalReconciliation);
    }
  } catch {
    logger.warn("api", "Open skill proposal candidate reconciliation failed; it will retry on the next startup");
  }

  // Migration 061 can run before a first-start global project is created. Run
  // the idempotent backfill again after startup resolution so those legacy
  // records are not stranded in an external namespace.
  if (globalProjectId) {
    backups.migrateLegacyBackupOwnership(globalProjectId);
    // The API never reads restore journals or database bytes. It only retries
    // fixed Supervisor handoff for durable queued ledger rows after an API
    // restart, recording a deterministic terminal failure when that handoff is
    // unavailable.
    for (const run of backups.listQueuedRestoreExecutions(globalProjectId)) {
      void startRestoreMaintenance().catch(() => {
        try {
          backups.failRestoreExecutionStart(globalProjectId, run.id, run.revision);
          logger.warn("api", "Queued restore executor start failed", { code: "SUPERVISOR_FAILED", runId: run.id });
        } catch {
          logger.warn("api", "Queued restore executor reconciliation raced another owner", { runId: run.id });
        }
      });
    }
  }

  // The tmpfs is empty after a container restart. This only handles an API
  // process restart, retaining any unknown or tampered directory untouched.
  void recoverVaultSecretRunDirectories().catch(() => {
    logger.warn("api", "Vault job run recovery could not complete; retained evidence will be retried by the scheduler");
  });

  if (shouldStartBackgroundSchedulers()) {
    startScheduler(config.port);
    startBackupScheduler();
  } else {
    logger.info("api", "Background schedulers disabled by API test/maintenance mode");
  }

  if (isControlPlaneMode()) {
    lifecycle.registerCleanup("runtime-reconciler", startRuntimeReconciler());
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

  try {
    const globalProjectRec = projectsDb.getCanonicalGlobalProject();
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
    authentication.validateAuthEncryptionKeyFile();
    if (process.env.INGENIUM_EMAIL_ENCRYPTION_KEY_EMPTY_TRANSITION === "1") {
      const project = projectsDb.ensureCanonicalGlobalProject();
      const transition = emailKeyTransition.transitionEmptyEmailEncryptionKey({
        projectId: project.id,
        fingerprint: getEmailEncryptionKeyFingerprint(),
        actorType: "system",
        actorId: "deployment",
      });
      if (transition.status === "blocked" || transition.status === "concurrent_change") {
        throw new Error("Email encryption key transition requires destructive rekey review");
      }
      if (transition.status === "transitioned") {
        logger.info("security", "Completed empty-mail email encryption key transition", { auditId: transition.auditId });
      }
    }
  } catch {
    console.error("[api] FATAL API authentication configuration is invalid");
    process.exitCode = 1;
    return null;
  }

  const server = app.listen(config.port, isControlPlaneMode() ? "0.0.0.0" : "127.0.0.1");
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
