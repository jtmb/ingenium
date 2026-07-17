import { Router } from "express";
import { logger, settings, pipelineEvents, synthesis } from "ingenium-core";

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
  pid?: number;
  exitstatus?: number;
  spawnerr?: string;
  stop?: number;
}

interface ServiceDetail extends ServiceInfo {
  /** Internal supervisord process name (before display-name mapping). */
  processName: string;
}

interface AppInfo {
  name: string;
  state: "healthy" | "degraded" | "stopped" | "starting" | "idle" | "disabled" | "error" | "unknown";
  description: string;
  detail?: string;
}

type OverallHealth = "healthy" | "degraded" | "down";

/** Supervisord XML-RPC endpoint — localhost:9001, container-internal only. */
const SUPERVISOR_RPC = "http://127.0.0.1:9001/RPC2";

const PORT_MAP: Record<string, number> = {
  "ingenium-api": 4097,
  "ingenium-dashboard": 3000,
  "opencode-web": 4098,
  "ttyd-opencode": 4099,
};

const DESCRIPTION_MAP: Record<string, string> = {
  "ingenium-api": "REST API Gateway (sole DB authority)",
  "ingenium-dashboard": "Next.js Dashboard UI",
  "opencode-web": "OpenCode Web Server",
  "ttyd-opencode": "OpenCode CLI Terminal (ttyd)",
};

const DISPLAY_NAME_MAP: Record<string, string> = {
  "opencode-web": "OpenCode Web",
  "ttyd-opencode": "OpenCode CLI",
};

const STATE_MAP: Record<string, ServiceInfo["state"]> = {
  RUNNING: "running",
  STARTING: "starting",
  BACKOFF: "error",
  FATAL: "error",
  EXITED: "stopped",
  STOPPED: "stopped",
};

/**
 * Extract a member value from a supervisord XML-RPC struct snippet.
 * Uses regex to avoid heavyweight XML parser dependency.
 * Handles both `<string>` and `<i4>` value types.
 */
function extractMember(struct: string, memberName: string): string {
  const regex = new RegExp(
    `<member>\\s*<name>${memberName}</name>\\s*<value>\\s*(<string>(.*?)</string>|<int>(.*?)</int>|<i4>(.*?)</i4>)\\s*</value>\\s*</member>`,
    "s"
  );
  const match = struct.match(regex);
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? "";
}

/**
 * Parse supervisord XML-RPC getAllProcessInfo response into structured records.
 * Uses regex to avoid heavyweight XML parser dependencies.
 */
function parseSupervisorResponse(
  xml: string
): Array<{
  name: string;
  statename: string;
  start: number;
  spawnerr: string;
  pid: number;
  exitstatus: number;
  stop: number;
}> {
  const results: Array<{
    name: string;
    statename: string;
    start: number;
    spawnerr: string;
    pid: number;
    exitstatus: number;
    stop: number;
  }> = [];

  const structRegex = /<struct>(.*?)<\/struct>/gs;
  let match: RegExpExecArray | null;
  while ((match = structRegex.exec(xml)) !== null) {
    const struct = match[1];
    if (!struct) continue;
    const name = extractMember(struct, "name");
    const statename = extractMember(struct, "statename");
    const startStr = extractMember(struct, "start");
    const spawnerr = extractMember(struct, "spawnerr") || "";
    const pidStr = extractMember(struct, "pid");
    const exitstatusStr = extractMember(struct, "exitstatus");
    const stopStr = extractMember(struct, "stop");
    results.push({
      name,
      statename,
      start: parseInt(startStr, 10) || 0,
      spawnerr,
      pid: parseInt(pidStr, 10) || 0,
      exitstatus: parseInt(exitstatusStr, 10) || 0,
      stop: parseInt(stopStr, 10) || 0,
    });
  }

  return results;
}

/**
 * Send an XML-RPC request to supervisord and return the response body text.
 * Throws on network errors, non-OK responses, or timeout.
 */
async function supervisorRpc(xmlBody: string): Promise<string> {
  const response = await fetch(SUPERVISOR_RPC, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: xmlBody,
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

/**
 * Parse a supervisord getProcessInfo XML-RPC response (single struct).
 * Returns a record with all process fields extracted.
 */
function parseProcessInfo(xml: string): Record<string, string> {
  const structMatch = xml.match(/<struct>([\s\S]*?)<\/struct>/);
  if (!structMatch || !structMatch[1]) return {};

  const struct = structMatch[1];
  const fields = [
    "name", "group", "start", "stop", "now", "statename",
    "spawnerr", "exitstatus", "logfile", "stdout_logfile",
    "stderr_logfile", "pid", "description",
  ];

  const result: Record<string, string> = {};
  for (const field of fields) {
    result[field] = extractMember(struct, field);
  }
  return result;
}

/**
 * Parse a supervisord readProcessStderrLog XML-RPC response.
 * Returns the log text string.
 */
function parseReadLog(xml: string): string {
  const match = xml.match(/<string>(.*?)<\/string>/s);
  if (!match) return "";
  return match[1] ?? "";
}

function buildServiceDetail(info: Record<string, string>): ServiceDetail {
  const name = info["name"] || "";
  const statename = info["statename"] || "";
  const start = parseInt(info["start"] || "0", 10) || 0;
  const pid = parseInt(info["pid"] || "0", 10) || 0;
  const exitstatus = parseInt(info["exitstatus"] || "0", 10) || 0;
  const stop = parseInt(info["stop"] || "0", 10) || 0;
  const now = Math.floor(Date.now() / 1000);
  const uptime = start > 0 && statename === "RUNNING" ? now - start : 0;

  return {
    name: DISPLAY_NAME_MAP[name] ?? name,
    processName: name,
    state: STATE_MAP[statename] ?? "error",
    uptime,
    restartCount: 0,
    port: PORT_MAP[name] ?? 0,
    description: DESCRIPTION_MAP[name] ?? info["description"] ?? name,
    pid: pid || undefined,
    exitstatus: statename === "EXITED" ? (exitstatus || undefined) : undefined,
    spawnerr: info["spawnerr"] || undefined,
    stop: stop || undefined,
  };
}

/**
 * Email-client health: checks the sync engine status and heartbeat.
 * Returns idle state when engine runs but no accounts are configured.
 */
async function getEmailClientStatus(): Promise<AppInfo> {
  try {
    const engine = (await import("ingenium-email")).getEngineStatus();
    if (!engine.running) {
      return { name: "email-client", state: "stopped", description: "Mail sync engine", detail: "Engine not running" };
    }
    if (!engine.heartbeatAt) {
      return { name: "email-client", state: "healthy", description: "Mail sync engine", detail: "Engine active, awaiting first heartbeat" };
    }
    const hbAge = Date.now() - new Date(engine.heartbeatAt).getTime();
    if (hbAge > 120_000) {
      return { name: "email-client", state: "degraded", description: "Mail sync engine", detail: `Heartbeat stale (${Math.round(hbAge / 1000)}s)` };
    }
    const accounts = engine.accounts ?? [];
    if (accounts.length === 0) {
      return { name: "email-client", state: "idle", description: "Mail sync engine running, no accounts", detail: "Add an email account to begin syncing" };
    }
    // Check if any account has all folders in error state
    const allErrorAccounts = accounts.filter((a: any) => 
      a.folders && a.folders.length > 0 && 
      a.folders.every((f: any) => f.state === "error")
    );
    if (allErrorAccounts.length === accounts.length) {
      return { 
        name: "email-client", 
        state: "degraded", 
        description: "Mail sync engine", 
        detail: "Re-authentication required" 
      };
    }
    return {
      name: "email-client",
      state: "healthy",
      description: `Mail sync engine — ${accounts.length} account(s) connected`,
      detail: `${accounts.length} account(s) connected`,
    };
  } catch {
    return { name: "email-client", state: "error", description: "Mail sync engine", detail: "Internal error" };
  }
}

/**
 * Synthesis-engine health: checks configured interval vs last run time.
 * Falls back to pipeline_events if getSynthesisStatus is unavailable.
 */
async function getSynthesisStatus(): Promise<AppInfo> {
  try {
    const intervalMs = parseInt(settings.getSetting("global-default", "synthesis_interval_ms") ?? "900000", 10);
    if (intervalMs === 0) {
      return { name: "synthesis-engine", state: "disabled", description: "Synthesis pipeline", detail: "Interval set to 0 (disabled)" };
    }

    let lastRun: number | null = null;
    try {
      const status = synthesis.getSynthesisStatus("global-default");
      lastRun = status.last_synthesis_at ? new Date(status.last_synthesis_at).getTime() : null;
    } catch {
      // Fall back to pipeline events
      try {
        const events = pipelineEvents.getEvents("global-default", { type: "synthesis_completed", limit: 1 });
        if (events.length > 0) {
          lastRun = new Date(events[0]!.created_at).getTime();
        }
      } catch {
        // Both methods failed — lastRun stays null
      }
    }

    if (!lastRun) {
      const intervalMin = Math.round(intervalMs / 60000);
      const detail = intervalMs > 0
        ? `No runs yet — checks every ${intervalMin}m`
        : "No runs yet";
      return { name: "synthesis-engine", state: "healthy", description: "Synthesis pipeline", detail };
    }
    const age = Date.now() - lastRun;
    if (age <= intervalMs * 1.5) {
      return { name: "synthesis-engine", state: "healthy", description: "Synthesis pipeline", detail: `Last run: ${Math.round(age / 60000)}m ago (interval: ${Math.round(intervalMs / 60000)}m)` };
    }
    if (age <= intervalMs * 3) {
      return { name: "synthesis-engine", state: "degraded", description: "Synthesis pipeline", detail: `Last run: ${Math.round(age / 60000)}m ago (interval: ${Math.round(intervalMs / 60000)}m)` };
    }
    return { name: "synthesis-engine", state: "error", description: "Synthesis pipeline", detail: `Last run: ${Math.round(age / 60000)}m ago — may be stuck` };
  } catch (err) {
    return { name: "synthesis-engine", state: "error", description: "Synthesis pipeline", detail: (err as Error).message };
  }
}

/** GET /api/v1/services/status — live supervisord process states + application health */
servicesRouter.get("/status", async (_req, res): Promise<void> => {
  // Always fetch application health checks (independent from supervisord)
  let applications: AppInfo[] = [];
  try {
    applications = await Promise.all([
      getEmailClientStatus(),
      getSynthesisStatus(),
    ]);
  } catch {
    // Individual errors are caught inside each function; this is defense-in-depth
  }

  try {
    const xml = await supervisorRpc(
      `<?xml version="1.0"?>\n<methodCall><methodName>supervisor.getAllProcessInfo</methodName></methodCall>`
    );

    const processes = parseSupervisorResponse(xml);

    const now = Math.floor(Date.now() / 1000);
    const services: ServiceInfo[] = processes.map((proc) => ({
      name: DISPLAY_NAME_MAP[proc.name] ?? proc.name,
      state: STATE_MAP[proc.statename] ?? "error",
      uptime: proc.start > 0 && STATE_MAP[proc.statename] === "running" ? now - proc.start : 0,
      restartCount: 0,
      port: PORT_MAP[proc.name] ?? 0,
      description: DESCRIPTION_MAP[proc.name] ?? proc.name,
      pid: proc.pid || undefined,
      exitstatus: proc.statename === "EXITED" ? (proc.exitstatus || undefined) : undefined,
      spawnerr: proc.spawnerr || undefined,
      stop: proc.stop || undefined,
    }));

    const runningCount = services.filter((s) => s.state === "running").length;
    const totalCount = services.length;
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

    // Downgrade overall health if any application is error or stopped
    const hasAppIssue = applications.some(app => app.state === "error" || app.state === "stopped");
    if (hasAppIssue && overall === "healthy") {
      overall = "degraded";
    }

    res.json({ data: { services, applications, overall } });
  } catch (err: any) {
    logger.error("services", `Supervisord RPC failed: ${err.message}`, {
      name: err.name,
    });
    res.json({
      data: {
        services: [],
        applications,
        overall: "down" as OverallHealth,
        error: err.message,
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

  // Resolve display name back to internal supervisord process name
  const processName = Object.entries(DISPLAY_NAME_MAP).find(
    ([, display]) => display === name
  )?.[0] ?? name;

  try {
    const xml = await supervisorRpc(
      `<?xml version="1.0"?>\n<methodCall><methodName>supervisor.getProcessInfo</methodName><params><param><value><string>${processName}</string></value></param></params></methodCall>`
    );

    const info = parseProcessInfo(xml);

    if (!info["name"]) {
      res.status(404).json({ error: `Process "${name}" not found` });
      return;
    }

    const detail = buildServiceDetail(info);

    res.json({ data: detail });
  } catch (err: any) {
    logger.error("services", `getProcessInfo failed for "${name}": ${err.message}`);
    res.status(502).json({ error: `Failed to fetch process info: ${err.message}` });
  }
});

/** GET /api/v1/services/:name/logs?offset=0&limit=100&stream=stdout — process log reading */
servicesRouter.get("/:name/logs", async (req, res): Promise<void> => {
  const { name } = req.params;
  const offset = parseInt(req.query.offset as string, 10) || 0;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 8192);
  const stream = (req.query.stream as string) === "stderr" ? "stderr" : "stdout";

  // Resolve display name back to internal supervisord process name
  const processName = Object.entries(DISPLAY_NAME_MAP).find(
    ([, display]) => display === name
  )?.[0] ?? name;

  try {
    const method = stream === "stderr"
      ? "supervisor.readProcessStderrLog"
      : "supervisor.readProcessStdoutLog";
    const xml = await supervisorRpc(
      `<?xml version="1.0"?>\n<methodCall><methodName>${method}</methodName><params><param><value><string>${processName}</string></value></param><param><value><i4>${offset}</i4></value></param><param><value><i4>${limit}</i4></value></param></params></methodCall>`
    );

    const logText = parseReadLog(xml);

    res.json({
      data: {
        name,
        log: logText,
        offset: offset + (logText ? Buffer.byteLength(logText, "utf8") : 0),
        more: logText.length > 0,
      },
    });
  } catch (err: any) {
    logger.error("services", `readProcessStderrLog failed for "${name}": ${err.message}`);
    res.status(502).json({ error: `Failed to read process log: ${err.message}` });
  }
});
