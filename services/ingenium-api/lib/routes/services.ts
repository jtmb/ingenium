import { Router } from "express";
import { logger, settings, synthesis, docs, tasks, projects, runtimes } from "ingenium-core";
import {
  getEmailClientStatus,
  getSynthesisStatus,
  hasRequiredApplicationIssue,
  type ApplicationHealth,
} from "../application-health.js";
import { runtimeManagerHealth } from "../runtime-manager-client.js";
import { isControlPlaneMode } from "../runtime-mode.js";
import {
  GET_ALL_PROCESS_INFO_XML,
  escapeSupervisorXml,
  parseSupervisorProcessInfo,
  parseSupervisorProcesses,
  parseSupervisorString,
  supervisorRpc,
} from "../supervisor-client.js";

/** Handles /api/v1/services — supervisord process status, logs, and application health checks (email-client, synthesis-engine). */
export const servicesRouter = Router();

/* ── Types ── */

interface ServiceInfo {
  name: string;
  state: "running" | "starting" | "error" | "stopped";
  uptime: number; // seconds since start (0 if stopped)
  restartCount: number;
  port: number;
  description: string;
  required: boolean;
  pid?: number;
  exitstatus?: number;
  spawnerr?: string;
  stop?: number;
}

interface ServiceDetail extends ServiceInfo {
  /** Internal supervisord process name (before display-name mapping). */
  processName: string;
}

type AppInfo = ApplicationHealth;

type OverallHealth = "healthy" | "degraded" | "down";

const PORT_MAP: Record<string, number> = {
  "restore-maintenance": 0,
  "restore-handoff": 0,
  "ingenium-api": 4096,
  "ingenium-api-boundary": 4097,
  "ingenium-dashboard": 3001,
  "ingenium-gateway": 3000,
  "opencode-web": 4098,
  "ttyd-opencode": 4099,
  vscode: 4100,
};

const DESCRIPTION_MAP: Record<string, string> = {
  "restore-maintenance": "One-shot restore maintenance executor",
  "restore-handoff": "Fixed restore maintenance handoff",
  "ingenium-api": "Private REST API (sole DB authority)",
  "ingenium-api-boundary": "Authenticated host API boundary",
  "ingenium-dashboard": "Next.js Dashboard UI",
  "ingenium-gateway": "Browser gateway",
  "opencode-web": "OpenCode Web Server",
  "opencode-internal-proxy": "OpenCode internal auth proxy",
  "ttyd-opencode": "OpenCode CLI Terminal (ttyd)",
  vscode: "VS Code Server (code-server)",
};

const DISPLAY_NAME_MAP: Record<string, string> = {
  "opencode-web": "OpenCode Web",
  "ttyd-opencode": "OpenCode CLI",
  vscode: "VS Code",
};

const STATE_MAP: Record<string, ServiceInfo["state"]> = {
  RUNNING: "running",
  STARTING: "starting",
  BACKOFF: "error",
  FATAL: "error",
  EXITED: "stopped",
  STOPPED: "stopped",
};

const CONTROL_PLANE_REQUIRED_PROCESSES = [
  "restore-handoff",
  "ingenium-api",
  "ingenium-api-boundary",
  "ingenium-dashboard",
  "ingenium-gateway",
] as const;

const COMPATIBILITY_REQUIRED_PROCESSES = [
  ...CONTROL_PLANE_REQUIRED_PROCESSES,
  "opencode-web",
  "opencode-internal-proxy",
  "ttyd-opencode",
  "vscode",
] as const;

function requiredSupervisorProcesses(): readonly string[] {
  return isControlPlaneMode() ? CONTROL_PLANE_REQUIRED_PROCESSES : COMPATIBILITY_REQUIRED_PROCESSES;
}

function sendServiceError(
  res: import("express").Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: { code, message } });
}

/**
 * Resolve the UUID for the global-default project.
 * Falls back to the literal string "global-default" if the project doesn't exist.
 */
function resolveGlobalProjectId(): string {
  try {
    const p = projects.getProject("global-default");
    return p?.id ?? "global-default";
  } catch {
    return "global-default";
  }
}


async function resolveSupervisorProcessName(name: string): Promise<string | undefined> {
  const processName = Object.entries(DISPLAY_NAME_MAP).find(
    ([, display]) => display === name,
  )?.[0] ?? name;
  const processes = parseSupervisorProcesses(await supervisorRpc(GET_ALL_PROCESS_INFO_XML));
  return processes.some((process) => process.name === processName) ? processName : undefined;
}

function buildServiceDetail(info: Record<string, string>): ServiceDetail {
  const name = info["name"] || "";
  const statename = info["statename"] || "";
  const start = parseInt(info["start"] || "0", 10) || 0;
  const pid = parseInt(info["pid"] || "0", 10) || 0;
  const exitstatus = parseInt(info["exitstatus"] || "0", 10) || 0;
  const stop = parseInt(info["stop"] || "0", 10) || 0;
  const now = parseInt(info["now"] || "0", 10) || Math.floor(Date.now() / 1000);
  const uptime = start > 0 && statename === "RUNNING" ? now - start : 0;

  return {
    name: DISPLAY_NAME_MAP[name] ?? name,
    processName: name,
    state: STATE_MAP[statename] ?? "error",
    uptime,
    restartCount: 0,
    port: PORT_MAP[name] ?? 0,
    description: DESCRIPTION_MAP[name] ?? info["description"] ?? name,
    required: requiredSupervisorProcesses().includes(name),
    pid: pid || undefined,
    exitstatus: statename === "EXITED" ? (exitstatus || undefined) : undefined,
    spawnerr: info["spawnerr"] || undefined,
    stop: stop || undefined,
  };
}

/**
 * Docs-workspace health: checks doc stats from ingenium-core.
 * Returns idle when no documents exist yet.
 */
async function getDocsStatus(): Promise<AppInfo> {
  try {
    const stats = docs.getDocStats();
    const total = stats.pages + stats.drafts;
    if (total === 0) {
      return { name: "docs-workspace", state: "idle", description: "Documentation workspace", detail: "No documents yet — create a space to begin", required: false };
    }
    return {
      name: "docs-workspace",
      state: "healthy",
      description: `Documentation workspace — ${stats.spaces} space(s), ${stats.pages} page(s)`,
      detail: `${stats.spaces} spaces, ${stats.pages} pages, ${stats.drafts} drafts`,
      required: false,
    };
  } catch (err: any) {
    return { name: "docs-workspace", state: "error", description: "Documentation workspace", detail: (err as Error).message, required: false };
  }
}

/**
 * Tasks-board health: checks task counts by column.
 * Returns idle when no tasks exist yet.
 */
async function getTasksStatus(): Promise<AppInfo> {
  try {
    const globalId = resolveGlobalProjectId();
    const allTasks = tasks.listTasks(globalId);
    const byColumn: Record<string, number> = {};
    for (const t of allTasks) {
      byColumn[t.column_id] = (byColumn[t.column_id] || 0) + 1;
    }
    const total = allTasks.length;
    if (total === 0) {
      return { name: "tasks-board", state: "idle", description: "Task board", detail: "No tasks — create one to begin", required: false };
    }
    const todo = byColumn["todo"] || 0;
    const inProgress = byColumn["in_progress"] || 0;
    const review = byColumn["review"] || 0;
    const done = byColumn["done"] || 0;
    return {
      name: "tasks-board",
      state: "healthy",
      description: `Task board — ${total} task(s)`,
      detail: `${todo} todo, ${inProgress} in progress, ${review} in review, ${done} done`,
      required: false,
    };
  } catch (err: any) {
    return { name: "tasks-board", state: "error", description: "Task board", detail: (err as Error).message, required: false };
  }
}

async function getRuntimeFleetStatus(): Promise<AppInfo> {
  const instances = runtimes.listRuntimeInstances();
  const healthy = await runtimeManagerHealth();
  const active = instances.filter((runtime) => ["PROVISIONING", "STARTING", "READY", "IDLE", "STOPPING"].includes(runtime.state)).length;
  return {
    name: "runtime-manager",
    state: healthy ? "healthy" : "error",
    description: "Per-user workspace runtime fleet",
    detail: healthy ? `${active} active runtime(s)` : "Private runtime manager unavailable",
    required: true,
  };
}

/** GET /api/v1/services/status — live supervisord process states + application health */
servicesRouter.get("/status", async (_req, res): Promise<void> => {
  // Always fetch application health checks (independent from supervisord)
  let applications: AppInfo[] = [];
  try {
    applications = await Promise.all([
      getEmailClientStatus(),
      getSynthesisStatus(),
      getDocsStatus(),
      getTasksStatus(),
      ...(isControlPlaneMode() ? [getRuntimeFleetStatus()] : []),
    ]);
  } catch {
    // Individual errors are caught inside each function; this is defense-in-depth
  }

  try {
    const xml = await supervisorRpc(GET_ALL_PROCESS_INFO_XML);

    const processes = parseSupervisorProcesses(xml);
    const requiredProcessNames = requiredSupervisorProcesses();

    const services: ServiceInfo[] = processes.map((proc) => ({
      name: DISPLAY_NAME_MAP[proc.name] ?? proc.name,
      state: STATE_MAP[proc.statename] ?? "error",
      uptime: proc.start > 0 && STATE_MAP[proc.statename] === "running"
        ? Math.max(0, (proc.now || Math.floor(Date.now() / 1000)) - proc.start)
        : 0,
      restartCount: 0,
      port: PORT_MAP[proc.name] ?? 0,
      description: DESCRIPTION_MAP[proc.name] ?? proc.name,
      required: requiredProcessNames.includes(proc.name),
      pid: proc.pid || undefined,
      exitstatus: proc.statename === "EXITED" ? (proc.exitstatus || undefined) : undefined,
      spawnerr: proc.spawnerr || undefined,
      stop: proc.stop || undefined,
    }));

    const reportedProcessNames = new Set(processes.map((process) => process.name));
    for (const name of requiredProcessNames) {
      if (reportedProcessNames.has(name)) continue;
      services.push({
        name: DISPLAY_NAME_MAP[name] ?? name,
        state: "stopped",
        uptime: 0,
        restartCount: 0,
        port: PORT_MAP[name] ?? 0,
        description: DESCRIPTION_MAP[name] ?? name,
        required: true,
      });
    }

    const requiredServices = services.filter((service) => service.required);
    const runningCount = requiredServices.filter((s) => s.state === "running").length;
    const totalCount = requiredServices.length;
    const maintenance = services.find((service) => service.name === "restore-maintenance");
    let overall: OverallHealth;
    if (totalCount === 0) {
      overall = "down";
    } else if (runningCount === totalCount) {
      overall = "healthy";
    } else if (runningCount === 0) {
      overall = "down";
    } else {
      overall = "degraded";
    }
    // A static one-shot program is healthy while STOPPED; only a supervisor
    // error is actionable. A RUNNING maintenance run remains part of normal
    // restore state rather than degrading unrelated service health.
    if (maintenance?.state === "error" && overall === "healthy") overall = "degraded";

    // In-process services do not appear in supervisord. Required application
    // failures must therefore participate in the same aggregate health result.
    const hasAppIssue = applications.some(hasRequiredApplicationIssue);
    if (hasAppIssue && overall === "healthy") {
      overall = "degraded";
    }

    res.json({ data: { services, applications, overall } });
  } catch (error) {
    logger.error("services", "Supervisor status is unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    res.json({
      data: {
        services: [],
        applications,
        overall: "down" as OverallHealth,
        error: "Supervisor status unavailable",
      },
    });
  }
});

/** GET /api/v1/applications/:name — detailed status for a specific application */
servicesRouter.get("/applications/:name", async (req, res): Promise<void> => {
  const { name } = req.params;

  try {
    switch (name) {
      case "email-client": {
        const app = await getEmailClientStatus();
        // Augment with full engine status for detail view
        let engineStatus = null;
        try {
          const engine = (await import("ingenium-email")).getEngineStatus();
          engineStatus = engine;
        } catch {
          // Engine not available — return basic app info
        }
        res.json({
          data: {
            ...app,
            engine: engineStatus
              ? {
                  running: engineStatus.running,
                  heartbeatAt: engineStatus.heartbeatAt,
                  accounts: engineStatus.accounts.map((a) => ({
                    accountId: a.accountId,
                    email: a.email,
                    folders: a.folders.map((f) => ({
                      folder: f.folder,
                      state: f.state,
                      headersSynced: f.headersSynced,
                      headersTotal: f.headersTotal,
                      bodiesCached: f.bodiesCached,
                      bodiesWindow: f.bodiesWindow,
                      lastSyncedAt: f.lastSyncedAt,
                      lastError: f.lastError,
                    })),
                  })),
                }
              : null,
          },
        });
        return;
      }

      case "synthesis-engine": {
        const app = await getSynthesisStatus();
        const intervalMs = parseInt(settings.getSetting("global-default", "synthesis_interval_ms") ?? "900000", 10);

        let status = null;
        try {
          status = synthesis.getSynthesisStatus("global-default");
        } catch {
          // Status unavailable
        }

        let nextEstimate: string | null = null;
        if (status?.last_synthesis_at && intervalMs > 0) {
          const lastTime = new Date(status.last_synthesis_at).getTime();
          nextEstimate = new Date(lastTime + intervalMs).toISOString();
        }

        res.json({
          data: {
            ...app,
            intervalMs,
            lastRunAt: status?.last_synthesis_at ?? null,
            nextEstimate,
            stats: status
              ? {
                  totalObservations: status.total_observations,
                  pendingCount: status.pending_count,
                  processedCount: status.processed_count,
                  traitCount: status.trait_count,
                }
              : null,
          },
        });
        return;
      }

      case "docs-workspace": {
        const app = await getDocsStatus();
        const stats = docs.getDocStats();
        res.json({ data: { ...app, stats } });
        return;
      }
      case "tasks-board": {
        const app = await getTasksStatus();
        const globalId = resolveGlobalProjectId();
        const allTasks = tasks.listTasks(globalId);
        const byColumn: Record<string, number> = {};
        for (const t of allTasks) { byColumn[t.column_id] = (byColumn[t.column_id] || 0) + 1; }
        res.json({ data: { ...app, stats: { total: allTasks.length, byColumn } } });
        return;
      }
      default:
        res.status(404).json({ error: `Unknown application: "${name}"` });
        return;
    }
  } catch (err: any) {
    logger.error("services", `Application detail failed for "${name}": ${err.message}`);
    res.status(502).json({ error: `Failed to fetch application detail: ${err.message}` });
  }
});

/** GET /api/v1/services/:name — single process detail via supervisor.getProcessInfo */
servicesRouter.get("/:name", async (req, res): Promise<void> => {
  const { name } = req.params;

  try {
    const processName = await resolveSupervisorProcessName(name);
    if (!processName) {
      sendServiceError(res, 404, "PROCESS_NOT_FOUND", "Process not found");
      return;
    }
    const xml = await supervisorRpc(
      `<?xml version="1.0"?><methodCall><methodName>supervisor.getProcessInfo</methodName><params><param><value><string>${escapeSupervisorXml(processName)}</string></value></param></params></methodCall>`,
    );

    const info = parseSupervisorProcessInfo(xml);

    if (info["name"] !== processName) {
      sendServiceError(res, 404, "PROCESS_NOT_FOUND", "Process not found");
      return;
    }

    const detail = buildServiceDetail(info);

    res.json({ data: detail });
  } catch (error) {
    logger.error("services", "Supervisor process detail is unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    sendServiceError(res, 502, "SUPERVISOR_UNAVAILABLE", "Unable to fetch process details");
  }
});

/** GET /api/v1/services/:name/logs?offset=0&limit=100&stream=stdout — process log reading */
servicesRouter.get("/:name/logs", async (req, res): Promise<void> => {
  const { name } = req.params;
  const offset = parseInt(req.query.offset as string, 10) || 0;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 8192);
  const stream = (req.query.stream as string) === "stderr" ? "stderr" : "stdout";

  try {
    const processName = await resolveSupervisorProcessName(name);
    if (!processName) {
      sendServiceError(res, 404, "PROCESS_NOT_FOUND", "Process not found");
      return;
    }
    const method = stream === "stderr"
      ? "supervisor.readProcessStderrLog"
      : "supervisor.readProcessStdoutLog";
    const xml = await supervisorRpc(
      `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params><param><value><string>${escapeSupervisorXml(processName)}</string></value></param><param><value><i4>${offset}</i4></value></param><param><value><i4>${limit}</i4></value></param></params></methodCall>`,
    );

    const logText = parseSupervisorString(xml);

    res.json({
      data: {
        name,
        log: logText,
        offset: offset + (logText ? Buffer.byteLength(logText, "utf8") : 0),
        more: logText.length > 0,
      },
    });
  } catch (error) {
    logger.error("services", "Supervisor process logs are unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    sendServiceError(res, 502, "SUPERVISOR_UNAVAILABLE", "Unable to fetch process logs");
  }
});
