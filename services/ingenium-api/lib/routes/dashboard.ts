import { Router } from "express";
import { synthesis, personality, tasks, jobs, settings, pipelineEvents, observations, getDb, logger } from "ingenium-core";
import { requireProject } from "../helpers.js";
import type { EngineStatus } from "ingenium-email";

export const dashboardRouter = Router();

// ── Types ──────────────────────────────────────────────────────────────────────

interface LearningSummary {
  pendingObservations: number;
  displayTraitsCount: number;
  lastSynthesisAt: string | null;
  synthesisIntervalMs: number;
}

interface TasksSummary {
  todoCount: number;
  inProgressCount: number;
  reviewCount: number;
  nextTask: { id: string; title: string } | null;
}

interface JobsSummary {
  total: number;
  enabledCount: number;
  failedRecently: Array<{ id: string; name: string; finishedAt: string | null }>;
}

interface MailSummary {
  accountCount: number;
  engineRunning: boolean;
  engineHealthy: boolean;
}

// ── NEW types for extended dashboard ───────────────────────────────────────────

interface AttentionItem {
  id: string;
  type: 'task_blocked' | 'task_overdue' | 'job_failed' | 'synthesis_pending' | 'extraction_pending' | 'unread_email' | 'error_log';
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  action?: { label: string; route: string };
  timestamp: string;
}

interface AttentionData {
  items: AttentionItem[];
  count: number;
}

interface ResumeData {
  lastVisitedPages: Array<{
    route: string;
    label: string;
    timestamp: string;
  }>;
  activeSession?: {
    type: 'opencode' | 'mail' | 'docs';
    label: string;
    detail?: string;
  };
}

interface ActivityItem {
  id: string;
  type: 'skill_created' | 'observation_processed' | 'job_completed' | 'task_completed' | 'synthesis_completed' | 'email_received' | 'email_sent' | 'config_changed';
  title: string;
  description: string;
  timestamp: string;
  route?: string;
}

interface HealthService {
  name: string;
  status: 'running' | 'stopped' | 'error';
  uptime?: number;
}

interface HealthData {
  api: { status: 'ok' | 'degraded' | 'down'; uptime: number };
  dashboard: { status: 'ok' | 'down' };
  opencode: { status: 'ok' | 'down' };
  docker: { status: 'healthy' | 'unhealthy' | 'unknown' };
  services: HealthService[];
}

interface DashboardData {
  learning: LearningSummary | null;
  tasks: TasksSummary | null;
  jobs: JobsSummary | null;
  mail: MailSummary | null;
  generatedAt: string;

  attention: AttentionData | null;
  resume: ResumeData | null;
  activity: ActivityItem[] | null;
  health: HealthData | null;
}

interface DashboardResponse {
  data: DashboardData;
  unavailable: string[];
}

// Resolves to the SQLite DB path used by getDb() for direct queries (attention, error logs, unread counts).
// Falls back to the default path when the env var is unset (e.g., tests).
function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}

// ── Existing module helpers ────────────────────────────────────────────────────

function fetchLearning(projectId: string, globalProjectId: string): {
  learning: LearningSummary | null;
  unavailable: string[];
} {
  const unavailable: string[] = [];
  const learning: Partial<LearningSummary> = {};

  // Synthesis status
  try {
    const status = synthesis.getSynthesisStatus(projectId);
    learning.pendingObservations = status.pending_count;
    learning.lastSynthesisAt = status.last_synthesis_at;
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch synthesis status: ${err.message}`);
    unavailable.push("learning.synthesis");
  }

  // Personality traits (display gate ≥0.30 is handled by getProfile)
  try {
    const profile = personality.getProfile(projectId);
    learning.displayTraitsCount = profile.length;
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch personality profile: ${err.message}`);
    unavailable.push("learning.personality");
  }

  // Synthesis interval — read from the global-default project where it's configured
  try {
    const intervalStr = settings.getSetting(globalProjectId, "synthesis_interval_ms");
    learning.synthesisIntervalMs = intervalStr ? parseInt(intervalStr, 10) : 900000;
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch synthesis interval: ${err.message}`);
    unavailable.push("learning.interval");
    learning.synthesisIntervalMs = 900000;
  }

  if (Object.keys(learning).length === 0) {
    return { learning: null, unavailable };
  }

  return { learning: learning as LearningSummary, unavailable };
}

function fetchTasks(projectId: string): {
  tasks: TasksSummary | null;
  unavailable: string[];
} {
  const unavailable: string[] = [];

  try {
    const allTasks = tasks.listTasks(projectId);
    let todoCount = 0;
    let inProgressCount = 0;
    let reviewCount = 0;

    for (const t of allTasks) {
      switch (t.column_id) {
        case "todo":
          todoCount++;
          break;
        case "in_progress":
          inProgressCount++;
          break;
        case "review":
          reviewCount++;
          break;
      }
    }

    let nextTask: TasksSummary["nextTask"] = null;
    try {
      const next = tasks.getNextTask(projectId);
      if (next) {
        nextTask = { id: next.id, title: next.title };
      }
    } catch (err: any) {
      logger.error("dashboard", `Failed to fetch next task: ${err.message}`);
      unavailable.push("tasks.next");
    }

    return {
      tasks: { todoCount, inProgressCount, reviewCount, nextTask },
      unavailable,
    };
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch tasks: ${err.message}`);
    return { tasks: null, unavailable: ["tasks"] };
  }
}

function fetchJobs(projectId: string): {
  jobs: JobsSummary | null;
  unavailable: string[];
} {
  const unavailable: string[] = [];

  try {
    const allJobs = jobs.listJobs(projectId);

    const enabledJobs = allJobs.filter((j) => j.enabled);
    const total = allJobs.length;
    const enabledCount = enabledJobs.length;

    const failedRecently: JobsSummary["failedRecently"] = [];

    for (const job of enabledJobs) {
      try {
        const runs = jobs.listJobRuns(job.id, 1);
        if (runs.length > 0 && runs[0]!.status === "failed") {
          failedRecently.push({
            id: job.id,
            name: job.name,
            finishedAt: runs[0]!.finished_at ?? null,
          });
        }
      } catch {
        // Skip individual job run lookup failures — not worth failing the whole module
      }
    }

    return {
      jobs: { total, enabledCount, failedRecently },
      unavailable,
    };
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch jobs: ${err.message}`);
    return { jobs: null, unavailable: ["jobs"] };
  }
}

async function fetchMail(): Promise<{
  mail: MailSummary | null;
  unavailable: string[];
}> {
  const unavailable: string[] = [];

  try {
    const engineModule = await import("ingenium-email");
    const engine: EngineStatus = engineModule.getEngineStatus();

    let accountCount = 0;
    try {
      accountCount = engineModule.listAccounts(engineModule.getGlobalProjectId()).length;
    } catch (err: any) {
      logger.error("dashboard", `Failed to list email accounts: ${err.message}`);
      unavailable.push("mail.accounts");
      accountCount = engine.accounts.length;
    }

    // Engine is healthy only if it's running AND has sent a heartbeat in the last 2 minutes
    const heartbeatAge = engine.heartbeatAt
      ? Date.now() - new Date(engine.heartbeatAt).getTime()
      : null;

    return {
      mail: {
        accountCount,
        engineRunning: engine.running,
        engineHealthy: engine.running && heartbeatAge !== null && heartbeatAge < 120_000,
      },
      unavailable,
    };
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch mail status: ${err.message}`);
    return { mail: null, unavailable: ["mail"] };
  }
}

// ── NEW module helpers ─────────────────────────────────────────────────────────

/**
 * Severity ordering for sorting attention items.
 */
const SEVERITY_ORDER: Record<AttentionItem["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Attention queue — things that need the user's immediate attention.
 * Each sub-check is independently wrapped so one failure doesn't cascade.
 * Sorted by severity (critical → warning → info) then newest-first.
 * Limited to 10 items to avoid overwhelming the dashboard.
 */
function fetchAttention(projectId: string): {
  attention: AttentionData | null;
  unavailable: string[];
} {
  const unavailable: string[] = [];
  const items: AttentionItem[] = [];

  // ── Blocked tasks ──────────────────────────────────────────────────────
  try {
    const db = getDb(dbPath());
    // Tasks blocked by another task: the task has a link_type = 'blocked_by' and is not done
    const blockedRows = db.prepare(
      `SELECT DISTINCT t.id, t.title, t.column_id, t.due_date, t.updated_at
       FROM tasks t
       JOIN task_links tl ON t.id = tl.task_id
       WHERE t.project_id = ? AND t.column_id != 'done' AND tl.link_type = 'blocked_by'`,
    ).all(projectId) as Array<{ id: string; title: string; column_id: string; due_date: string | null; updated_at: string }>;

    for (const row of blockedRows) {
      items.push({
        id: `blocked-${row.id}`,
        type: "task_blocked",
        title: row.title,
        description: `Blocked in "${row.column_id}" column`,
        severity: "warning",
        action: { label: "View task", route: "/tasks" },
        timestamp: row.updated_at,
      });
    }
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch blocked tasks for attention: ${err.message}`);
    unavailable.push("attention.blocked_tasks");
  }

  // ── Overdue tasks ──────────────────────────────────────────────────────
  try {
    const allTasks = tasks.listTasks(projectId);
    const now = new Date().toISOString();
    for (const t of allTasks) {
      if (t.column_id === "done") continue;
      if (!t.due_date) continue;
      if (t.due_date >= now) continue;

      items.push({
        id: `overdue-${t.id}`,
        type: "task_overdue",
        title: t.title,
        description: `Due: ${t.due_date.slice(0, 10)}`,
        severity: "critical",
        action: { label: "View task", route: "/tasks" },
        timestamp: t.updated_at,
      });
    }
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch overdue tasks for attention: ${err.message}`);
    unavailable.push("attention.overdue_tasks");
  }

  // ── Failed jobs (last 24h) ─────────────────────────────────────────────
  try {
    const db = getDb(dbPath());
    const failedRuns = db.prepare(
      `SELECT jr.id as run_id, jr.job_id, jr.created_at, jr.finished_at, j.name as job_name
       FROM job_runs jr
       JOIN jobs j ON jr.job_id = j.id
       WHERE j.project_id = ? AND jr.status = 'failed'
         AND jr.created_at > datetime('now', '-1 day')
       ORDER BY jr.created_at DESC
       LIMIT 5`,
    ).all(projectId) as Array<{ run_id: string; job_id: string; created_at: string; finished_at: string | null; job_name: string }>;

    for (const row of failedRuns) {
      items.push({
        id: `job-failed-${row.run_id}`,
        type: "job_failed",
        title: `Job failed: ${row.job_name}`,
        description: row.finished_at
          ? `Failed at ${new Date(row.finished_at).toLocaleString()}`
          : "Failed during execution",
        severity: "warning",
        action: { label: "View jobs", route: "/jobs" },
        timestamp: row.created_at,
      });
    }
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch failed jobs for attention: ${err.message}`);
    unavailable.push("attention.failed_jobs");
  }

  // ── Pending synthesis ──────────────────────────────────────────────────
  try {
    const pendingCount = observations.countUnprocessed(projectId);
    if (pendingCount > 10) {
      items.push({
        id: "synthesis-pending",
        type: "synthesis_pending",
        title: `${pendingCount} observations pending synthesis`,
        description: "The synthesis pipeline has unprocessed observations. Run /synthesize to process them.",
        severity: "info",
        action: { label: "Synthesize", route: "/observations" },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    logger.error("dashboard", `Failed to check pending synthesis: ${err.message}`);
    unavailable.push("attention.synthesis_pending");
  }

  // ── Pending extraction ─────────────────────────────────────────────────
  try {
    const watermarkStr = settings.getSetting(projectId, "extraction_watermark");
    const intervalStr = settings.getSetting(projectId, "extraction_interval_ms");
    const extractionIntervalMs = intervalStr ? parseInt(intervalStr, 10) : 900000; // default 15 min

    if (!watermarkStr) {
      // Never run — pending
      items.push({
        id: "extraction-pending",
        type: "extraction_pending",
        title: "Extraction never run",
        description: "The auto-observer extraction engine has not yet scanned OpenCode messages.",
        severity: "info",
        action: { label: "Run extraction", route: "/pipeline" },
        timestamp: new Date().toISOString(),
      });
    } else {
      const watermarkMs = new Date(watermarkStr).getTime();
      const ageMs = Date.now() - watermarkMs;
      // Flag if overdue by > 2x the interval
      if (ageMs > extractionIntervalMs * 2) {
        items.push({
          id: "extraction-pending",
          type: "extraction_pending",
          title: `Extraction overdue (${Math.round(ageMs / 60000)}m ago)`,
          description: "The auto-observer extraction engine is overdue. It should run every 15 minutes.",
          severity: "warning",
          action: { label: "Run extraction", route: "/pipeline" },
          timestamp: watermarkStr,
        });
      }
    }
  } catch (err: any) {
    logger.error("dashboard", `Failed to check extraction watermark: ${err.message}`);
    unavailable.push("attention.extraction_pending");
  }

  // ── Unread emails ──────────────────────────────────────────────────────
  try {
    const db = getDb(dbPath());
    const unreadRow = db.prepare(
      "SELECT COUNT(*) as count FROM email_cache WHERE flags NOT LIKE '%\\\\Seen%'",
    ).get() as { count: number };

    if (unreadRow && unreadRow.count > 0) {
      items.push({
        id: "unread-email",
        type: "unread_email",
        title: `${unreadRow.count} unread email${unreadRow.count !== 1 ? "s" : ""}`,
        description: "You have unread messages in your inbox.",
        severity: "info",
        action: { label: "Open inbox", route: "/mail" },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    logger.error("dashboard", `Failed to check unread emails: ${err.message}`);
    unavailable.push("attention.unread_email");
  }

  // ── Recent error logs ──────────────────────────────────────────────────
  try {
    const db = getDb(dbPath());
    const errorEvents = db.prepare(
      `SELECT id, event_type, title, description, created_at
       FROM pipeline_events
       WHERE project_id = ? AND (event_type LIKE '%failed' OR event_type = 'plugin_error')
       ORDER BY created_at DESC
       LIMIT 3`,
    ).all(projectId) as Array<{ id: number; event_type: string; title: string; description: string | null; created_at: string }>;

    for (const evt of errorEvents) {
      items.push({
        id: `error-${evt.id}`,
        type: "error_log",
        title: evt.title,
        description: evt.description ?? `${evt.event_type} at ${new Date(evt.created_at).toLocaleString()}`,
        severity: "warning",
        action: { label: "View logs", route: "/logs" },
        timestamp: evt.created_at,
      });
    }
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch error logs: ${err.message}`);
    unavailable.push("attention.error_logs");
  }

  // Sort: severity (critical first) → newest-first within same severity
  items.sort((a, b) => {
    const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.timestamp.localeCompare(a.timestamp);
  });

  const limited = items.slice(0, 10);

  return {
    attention: { items: limited, count: limited.length },
    unavailable,
  };
}

/**
 * Resume work — where the user left off.
 * Reads from settings table; the dashboard frontend writes on navigation.
 */
function fetchResume(projectId: string): {
  resume: ResumeData | null;
  unavailable: string[];
} {
  const unavailable: string[] = [];
  const resume: ResumeData = { lastVisitedPages: [] };

  try {
    const pagesStr = settings.getSetting(projectId, "last_visited_pages");
    if (pagesStr) {
      try {
        const parsed = JSON.parse(pagesStr);
        if (Array.isArray(parsed)) {
          resume.lastVisitedPages = parsed.slice(0, 5).map((p: any) => ({
            route: typeof p.route === "string" ? p.route : "",
            label: typeof p.label === "string" ? p.label : "",
            timestamp: typeof p.timestamp === "string" ? p.timestamp : new Date().toISOString(),
          }));
        }
      } catch {
        // Invalid JSON — return empty
      }
    }
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch resume state: ${err.message}`);
    unavailable.push("resume");
  }

  return { resume, unavailable };
}

/**
 * Activity timeline — recent pipeline events mapped to user-facing activity types.
 */
function fetchActivity(projectId: string): {
  activity: ActivityItem[] | null;
  unavailable: string[];
} {
  const unavailable: string[] = [];

  try {
    const events = pipelineEvents.getEvents(projectId, { limit: 50 });
    const activity: ActivityItem[] = [];

    for (const evt of events) {
      const mapped = mapEventToActivity(evt);
      if (mapped) activity.push(mapped);
    }

    // Limit to 20 most recent
    return {
      activity: activity.slice(0, 20),
      unavailable,
    };
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch activity timeline: ${err.message}`);
    return { activity: null, unavailable: ["activity"] };
  }
}

/**
 * Map a pipeline event to an activity timeline item.
 */
function mapEventToActivity(evt: {
  id: number;
  event_type: string;
  title: string;
  description?: string | null;
  created_at: string;
}): ActivityItem | null {
  const typeMap: Record<string, ActivityItem["type"]> = {
    skill_created: "skill_created",
    skill_updated: "skill_created",
    synthesis_completed: "synthesis_completed",
    observation_created: "observation_processed",
    observation_imported: "observation_processed",
    extraction_completed: "observation_processed",
    trait_created: "observation_processed",
    trait_updated: "observation_processed",
  };

  const routeMap: Record<string, string> = {
    skill_created: "/skills",
    skill_updated: "/skills",
    synthesis_completed: "/pipeline",
    observation_created: "/observations",
    observation_imported: "/observations",
    extraction_completed: "/pipeline",
    trait_created: "/personality",
    trait_updated: "/personality",
  };

  const atype = typeMap[evt.event_type];
  if (!atype) return null; // skip events we don't map (session_created, etc.)

  return {
    id: String(evt.id),
    type: atype,
    title: evt.title,
    description: evt.description ?? evt.event_type,
    timestamp: evt.created_at,
    route: routeMap[evt.event_type],
  };
}

/**
 * Health strip — compact status indicators for services.
 * Queries supervisord for process states, and checks application health.
 */
async function fetchHealth(projectId: string): Promise<{
  health: HealthData | null;
  unavailable: string[];
}> {
  const unavailable: string[] = [];

  // Defaults — API is always ok since we're responding
  const health: HealthData = {
    api: { status: "ok", uptime: Math.floor(process.uptime()) },
    dashboard: { status: "ok" },
    opencode: { status: "down" },
    docker: { status: "unknown" },
    services: [],
  };

  // ── Supervisord process check via XML-RPC (Docker internal only) ─────────
  // 3s timeout avoids hanging the dashboard if supervisord is unresponsive
  try {
    const response = await fetch("http://127.0.0.1:9001/RPC2", {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: `<?xml version="1.0"?>
<methodCall>
  <methodName>supervisor.getAllProcessInfo</methodName>
</methodCall>`,
      signal: AbortSignal.timeout(3000),
    });

    if (response.ok) {
      health.docker = { status: "healthy" };
      const xml = await response.text();

      // Parse individual process structs
      const structRegex = /<struct>(.*?)<\/struct>/gs;
      const processNames = ["ingenium-api", "ingenium-dashboard", "opencode-web", "ttyd-opencode"];
      const foundProcesses: Map<string, { statename: string; startSecs: number }> = new Map();

      let match: RegExpExecArray | null;
      while ((match = structRegex.exec(xml)) !== null) {
        const struct = match[1];
        if (!struct) continue;
        const name = extractXmlMember(struct, "name");
        if (!processNames.includes(name)) continue;
        const statename = extractXmlMember(struct, "statename") || "UNKNOWN";
        const startStr = extractXmlMember(struct, "start") || "0";
        foundProcesses.set(name, {
          statename,
          startSecs: parseInt(startStr, 10) || 0,
        });
      }

      const now = Math.floor(Date.now() / 1000);
      const displayNames: Record<string, string> = {
        "ingenium-api": "API",
        "ingenium-dashboard": "Dashboard",
        "opencode-web": "OpenCode",
        "ttyd-opencode": "OpenCode CLI",
      };

      for (const name of processNames) {
        const proc = foundProcesses.get(name);
        if (!proc) {
          health.services.push({ name: displayNames[name] ?? name, status: "stopped" });
          continue;
        }

        const status: HealthService["status"] =
          proc.statename === "RUNNING" ? "running" :
          proc.statename === "STARTING" ? "running" :
          proc.statename === "BACKOFF" || proc.statename === "FATAL" ? "error" :
          "stopped";

        const uptime = proc.startSecs > 0 ? now - proc.startSecs : undefined;

        health.services.push({
          name: displayNames[name] ?? name,
          status,
          uptime,
        });

        // Set OpenCode status based on web process
        if (name === "opencode-web") {
          health.opencode = { status: proc.statename === "RUNNING" ? "ok" : "down" };
        }
      }
    } else {
      health.docker = { status: "unhealthy" };
    }
  } catch (err: any) {
    health.docker = { status: "unhealthy" };
    unavailable.push("health.docker");
  }

  // ── In-process application checks ──────────────────────────────────────
  try {
    // Synthesis engine — status based on interval config vs last-run age
    // interval=0 means disabled; >3x interval = error; >1.5x = still running (may catch up)
    try {
      const intervalMs = parseInt(
        settings.getSetting("global-default", "synthesis_interval_ms") ?? "900000",
        10,
      );
      const synthStatus = synthesis.getSynthesisStatus(projectId);
      const lastRun = synthStatus.last_synthesis_at
        ? new Date(synthStatus.last_synthesis_at).getTime()
        : null;

      let synthState: HealthService["status"] = "running";
      if (intervalMs === 0) {
        synthState = "stopped";
      } else if (lastRun) {
        const age = Date.now() - lastRun;
        if (age > intervalMs * 3) synthState = "error";
        else if (age > intervalMs * 1.5) synthState = "running";
      }

      health.services.push({
        name: "Synthesis Engine",
        status: synthState,
      });
    } catch {
      health.services.push({ name: "Synthesis Engine", status: "stopped" });
    }

    // Email client
    try {
      const engineModule = await import("ingenium-email");
      const engine = engineModule.getEngineStatus();
      let emailState: HealthService["status"] = "stopped";
      if (engine.running) {
        const hbAge = engine.heartbeatAt
          ? Date.now() - new Date(engine.heartbeatAt).getTime()
          : null;
        emailState = hbAge !== null && hbAge < 120_000 ? "running" : "error";
      }
      health.services.push({
        name: "Email Client",
        status: emailState,
      });
    } catch {
      health.services.push({ name: "Email Client", status: "stopped" });
    }
  } catch (err: any) {
    logger.error("dashboard", `Failed to check application health: ${err.message}`);
    unavailable.push("health.applications");
  }

  return { health, unavailable };
}

/**
 * Extract a member value from a supervisord XML-RPC struct snippet.
 * Handles <string> and <int>/<i4> value types.
 */
function extractXmlMember(struct: string, memberName: string): string {
  const regex = new RegExp(
    `<member>\\s*<name>${memberName}</name>\\s*<value>\\s*(<string>(.*?)</string>|<int>(.*?)</int>|<i4>(.*?)</i4>)\\s*</value>\\s*</member>`,
    "s",
  );
  const match = struct.match(regex);
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? "";
}

// ── Route ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/dashboard/summary?project=X
 *
 * Aggregates key metrics across learning, tasks, jobs, mail, attention,
 * resume, activity, and health for the operational cockpit home page.
 * Each module is independently resolved — if one fails, the others still
 * populate and the failed module is listed in `unavailable[]`.
 * Returns 200 with partial data unless ALL modules fail.
 */
dashboardRouter.get("/summary", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const allUnavailable: string[] = [];
  const data: Partial<DashboardData> = {};

  // Existing modules (synchronous)
  const learningResult = fetchLearning(projectId, "global-default");
  data.learning = learningResult.learning;
  allUnavailable.push(...learningResult.unavailable);

  const tasksResult = fetchTasks(projectId);
  data.tasks = tasksResult.tasks;
  allUnavailable.push(...tasksResult.unavailable);

  const jobsResult = fetchJobs(projectId);
  data.jobs = jobsResult.jobs;
  allUnavailable.push(...jobsResult.unavailable);

  // Mail requires a dynamic import (ingenium-email may not be bundled at import-time)
  const mailResult = await fetchMail();
  data.mail = mailResult.mail;
  allUnavailable.push(...mailResult.unavailable);

  // ── NEW modules ────────────────────────────────────────────────────────

  // Attention queue (synchronous — queries DB directly)
  const attentionResult = fetchAttention(projectId);
  data.attention = attentionResult.attention;
  allUnavailable.push(...attentionResult.unavailable);

  // Resume work (synchronous — reads from settings)
  const resumeResult = fetchResume(projectId);
  data.resume = resumeResult.resume;
  allUnavailable.push(...resumeResult.unavailable);

  // Activity timeline (synchronous — uses pipelineEvents)
  const activityResult = fetchActivity(projectId);
  data.activity = activityResult.activity;
  allUnavailable.push(...activityResult.unavailable);

  // Health strip (async — queries supervisord)
  const healthResult = await fetchHealth(projectId);
  data.health = healthResult.health;
  allUnavailable.push(...healthResult.unavailable);

  // ────────────────────────────────────────────────────────────────────────

  data.generatedAt = new Date().toISOString();

  // 500 only if every single module failed — partial failures are still 200 with unavailable[]
  const allNull =
    data.learning === null &&
    data.tasks === null &&
    data.jobs === null &&
    data.mail === null &&
    data.attention === null &&
    data.resume === null &&
    data.activity === null &&
    data.health === null;

  if (allNull) {
    res.status(500).json({
      error: {
        code: "ALL_MODULES_FAILED",
        message: "All dashboard modules failed to load",
        details: allUnavailable,
      },
    });
    return;
  }

  const response: DashboardResponse = {
    data: data as DashboardData,
    unavailable: allUnavailable,
  };

  res.json(response);
});
