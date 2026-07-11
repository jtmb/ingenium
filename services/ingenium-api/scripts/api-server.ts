import express from "express";
import cors from "cors";
import helmet from "helmet";
import { logger, getDb } from "ingenium-core";
import { config } from "../config/index.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { authMiddleware } from "../lib/middleware/auth.js";
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
import { emailsRouter } from "../lib/routes/emails.js";
import { commandsRouter } from "../lib/routes/commands.js";
import { configRouter } from "../lib/routes/configs.js";
import { mcpToolsRouter } from "../lib/routes/mcp-tools.js";
import { logsRouter } from "../lib/routes/logs.js";
import { opencodeRouter } from "../lib/routes/opencode.js";
import { extractionRouter } from "../lib/routes/extraction.js";
import { jobsRouter } from "../lib/routes/jobs.js";
import { startScheduler } from "../lib/scheduler.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "2mb" }));
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

// Error handler
app.use(errorHandler);

// Start server + scheduler
app.listen(config.port, () => {
  logger.info("api", `ingenium-api listening on port ${config.port}`);
  startScheduler(config.port);

  // 🔴 Durability: run WAL checkpoint + integrity check at startup
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

// Crash handlers — log unhandled errors before process exits
process.on("uncaughtException", (err) => {
  import("ingenium-core").then(({ logger: crashLogger }) => {
    crashLogger.error("api", "Uncaught exception — process will exit", { error: err.message, stack: err.stack });
  }).catch(() => {
    console.error("[api] FATAL uncaught exception:", err.message, err.stack);
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason: any) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  import("ingenium-core").then(({ logger: crashLogger }) => {
    crashLogger.error("api", "Unhandled rejection", { error: message });
  }).catch(() => {
    console.error("[api] FATAL unhandled rejection:", message);
  });
});

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
