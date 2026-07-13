import { Router } from "express";
import { logger } from "ingenium-core";

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

// ── Route ────────────────────────────────────────────────────────────────────

/** GET /api/v1/services/status — live supervisord process states */
servicesRouter.get("/status", async (_req, res): Promise<void> => {
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
        data: { services: [], overall: "down" as OverallHealth, error: `HTTP ${response.status}` },
      });
      return;
    }

    const xml = await response.text();
    const processes = parseSupervisorResponse(xml);

    const now = Math.floor(Date.now() / 1000);
    const services: ServiceInfo[] = processes.map((proc) => ({
      name: proc.name,
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

    res.json({ data: { services, overall } });
  } catch (err: any) {
    logger.error("services", `Supervisord RPC failed: ${err.message}`, {
      name: err.name,
    });
    res.json({
      data: {
        services: [],
        overall: "down" as OverallHealth,
        error: err.message,
      },
    });
  }
});
