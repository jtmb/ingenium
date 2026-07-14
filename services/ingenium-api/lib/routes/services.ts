import { Router } from "express";
import { logger, settings, pipelineEvents, synthesis } from "ingenium-core";

export const servicesRouter = Router();

// ── Types ────────────────────────────────────────────────────────────────────

interface ServiceInfo {
  name: string;
  state: "running" | "starting" | "error" | "stopped";
  uptime: number; // seconds since start (0 if stopped)
  restartCount: number;
  port: number;
  description: string;
}

interface AppInfo {
  name: string;
  state: "healthy" | "degraded" | "stopped" | "starting" | "idle" | "disabled" | "error" | "unknown";
  description: string;
  detail?: string;
}

type OverallHealth = "healthy" | "degraded" | "down";

// ── Constants ────────────────────────────────────────────────────────────────

const SUPERVISOR_RPC = "http://127.0.0.1:9001/RPC2";

const PORT_MAP: Record<string, number> = {
  "ingenium-api": 4097,
  "ingenium-dashboard": 3000,
  "opencode-server": 4096,
  "opencode-iframe": 4098,
};

const DESCRIPTION_MAP: Record<string, string> = {
  "ingenium-api": "REST API Gateway (sole DB authority)",
  "ingenium-dashboard": "Next.js Dashboard UI",
  "opencode-server": "OpenCode Web Server (auth-enabled)",
  "opencode-iframe": "OpenCode Iframe (embedded)",
};

const DISPLAY_NAME_MAP: Record<string, string> = {
  "opencode-iframe": "opencode-webui-client",
};

const STATE_MAP: Record<string, ServiceInfo["state"]> = {
  RUNNING: "running",
  STARTING: "starting",
  BACKOFF: "error",
  FATAL: "error",
  EXITED: "stopped",
  STOPPED: "stopped",
};

// ── XML-RPC Helpers ──────────────────────────────────────────────────────────

/**
 * Extract a member value from a supervisord XML-RPC struct snippet.
 * Handles both `<string>` and `<i4>` value types.
 */
function extractMember(struct: string, memberName: string): string {
  const regex = new RegExp(
    `<member>\\s*<name>${memberName}</name>\\s*<value>\\s*(<string>(.*?)</string>|<i4>(.*?)</i4>)\\s*</value>\\s*</member>`,
    "s"
  );
  const match = struct.match(regex);
  return match?.[2] ?? match?.[3] ?? "";
}

/**
 * Parse supervisord XML-RPC getAllProcessInfo response into structured records.
 * Uses regex to avoid heavyweight XML parser dependencies.
 */
function parseSupervisorResponse(
  xml: string
): Array<{ name: string; statename: string; start: number; spawnerr: string }> {
  const results: Array<{
    name: string;
    statename: string;
    start: number;
    spawnerr: string;
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
    results.push({
      name,
      statename,
      start: parseInt(startStr, 10) || 0,
      spawnerr,
    });
  }

  return results;
}

// ── Application Health Checks ───────────────────────────────────────────────

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
      return { name: "email-client", state: "starting", description: "Mail sync engine", detail: "Engine starting..." };
    }
    const hbAge = Date.now() - new Date(engine.heartbeatAt).getTime();
    if (hbAge > 120_000) {
      return { name: "email-client", state: "degraded", description: "Mail sync engine", detail: `Heartbeat stale (${Math.round(hbAge / 1000)}s)` };
    }
    const accounts = engine.accounts ?? [];
    if (accounts.length === 0) {
      return { name: "email-client", state: "idle", description: "Mail sync engine running, no accounts", detail: "Add an email account to begin syncing" };
    }
    return {
      name: "email-client",
      state: "healthy",
      description: `Mail sync engine — ${accounts.length} account(s) connected`,
      detail: accounts.map(a => a.email).join(", "),
    };
  } catch (err) {
    return { name: "email-client", state: "error", description: "Mail sync engine", detail: (err as Error).message };
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
      return { name: "synthesis-engine", state: "starting", description: "Synthesis pipeline", detail: "No runs yet" };
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

// ── Route ────────────────────────────────────────────────────────────────────

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
    const xmlBody = `<?xml version="1.0"?>\n<methodCall><methodName>supervisor.getAllProcessInfo</methodName></methodCall>`;

    const response = await fetch(SUPERVISOR_RPC, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: xmlBody,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.error("services", `Supervisord RPC returned ${response.status}`);
      res.json({
        data: { services: [], applications, overall: "down" as OverallHealth, error: `HTTP ${response.status}` },
      });
      return;
    }

    const xml = await response.text();
    const processes = parseSupervisorResponse(xml);

    const now = Math.floor(Date.now() / 1000);
    const services: ServiceInfo[] = processes.map((proc) => ({
      name: DISPLAY_NAME_MAP[proc.name] ?? proc.name,
      state: STATE_MAP[proc.statename] ?? "error",
      uptime: proc.start > 0 && STATE_MAP[proc.statename] === "running" ? now - proc.start : 0,
      restartCount: 0, // supervisord returns spawnerr but no restart count in getAllProcessInfo; track via spawnerr presence
      port: PORT_MAP[proc.name] ?? 0,
      description: DESCRIPTION_MAP[proc.name] ?? proc.name,
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
