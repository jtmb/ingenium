import { Router } from "express";
import { synthesis, personality, tasks, jobs, settings, logger } from "ingenium-core";
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

interface DashboardData {
  learning: LearningSummary | null;
  tasks: TasksSummary | null;
  jobs: JobsSummary | null;
  mail: MailSummary | null;
  generatedAt: string;
}

interface DashboardResponse {
  data: DashboardData;
  unavailable: string[];
}

// ── Module helpers ─────────────────────────────────────────────────────────────

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

  // Synthesis interval
  try {
    const intervalStr = settings.getSetting(globalProjectId, "synthesis_interval_ms");
    learning.synthesisIntervalMs = intervalStr ? parseInt(intervalStr, 10) : 900000;
  } catch (err: any) {
    logger.error("dashboard", `Failed to fetch synthesis interval: ${err.message}`);
    unavailable.push("learning.interval");
    learning.synthesisIntervalMs = 900000;
  }

  // If we got nothing at all, return null
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

// ── Route ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/dashboard/summary?project=X
 *
 * Aggregates key metrics across learning, tasks, jobs, and mail for the
 * dashboard home page. Each module is independently resolved — if one
 * fails, the others still populate and the failed module is listed in
 * `unavailable[]`. Returns 200 with partial data unless ALL modules fail.
 */
dashboardRouter.get("/summary", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const allUnavailable: string[] = [];
  const data: Partial<DashboardData> = {};

  // Fetch learning, tasks, and jobs synchronously (they run in-process)
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

  data.generatedAt = new Date().toISOString();

  // If ALL modules failed, return 500
  const allNull =
    data.learning === null &&
    data.tasks === null &&
    data.jobs === null &&
    data.mail === null;

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
