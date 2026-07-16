import { spawn, ChildProcess } from "node:child_process";
import { jobs, logger } from "ingenium-core";

// ============================================================================
// Concurrency cap
// ============================================================================

let activeRunCount = 0;

/**
 * Conservative concurrency limit: only 2 simultaneous opencode CLI invocations.
 *
 * Each opencode process loads an LLM model context and may consume significant
 * memory (especially with agentic tool loops). A cap of 2 prevents resource
 * starvation in the single-container deployment while still allowing parallel
 * execution for staggered cron jobs.
 */
const MAX_CONCURRENT_RUNS = 2;

/** In-memory map of runId → ChildProcess for cancellation and status tracking. */
const runningProcesses = new Map<string, ChildProcess>();

/**
 * Execute a job run by spawning the opencode CLI.
 *
 * Feasibility gate: opencode v1.17.18 supports `opencode run "<prompt>" --agent <name>`
 * The message is a positional argument, not a flag. The `--auto` flag enables
 * non-interactive auto-approval of permissions.
 */
export async function executeJobRun(
  runId: string,
  job: { id: string; agent: string; prompt_template: string; timeout_minutes: number; project_id: string },
  _prompt: string,
): Promise<void> {
  // Interpolate any tokens in the prompt template (simple: just use as-is for now)
  const prompt = job.prompt_template;

  // Check concurrency
  if (activeRunCount >= MAX_CONCURRENT_RUNS) {
    logger.warn("job-runner", `Concurrency limit reached (${MAX_CONCURRENT_RUNS}). Run ${runId} will be queued.`);
    jobs.finishJobRun(runId, "failed", -1);
    jobs.appendRunLog(runId, "stderr", `Concurrency limit reached: ${MAX_CONCURRENT_RUNS} runs already active.`);
    return;
  }

  activeRunCount++;
  logger.info("job-runner", `Starting run ${runId} for job ${job.id} (agent: ${job.agent}, active: ${activeRunCount}/${MAX_CONCURRENT_RUNS})`);

  // Update run status to running (it should already be 'running' from startJobRun,
  // but we re-affirm in case of any race)
  const run = jobs.getJobRun(runId);
  if (!run) {
    logger.error("job-runner", `Run ${runId} not found in DB — aborting.`);
    activeRunCount--;
    return;
  }
  if (run.status !== "running") {
    jobs.finishJobRun(runId, "running" as any, null);
  }

  // Default 30-minute timeout prevents runaway agents from consuming resources indefinitely.
  // The timeout is generous — typical agent runs finish in 2-10 minutes — because the
  // opencode CLI may include LLM inference time, tool calls, and user-facing confirmations.
  const timeoutMs = (job.timeout_minutes || 30) * 60 * 1000;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // Build opencode command args.
  // opencode run "<prompt>" --agent <agent_name> --auto
  const args = ["run", prompt, "--agent", job.agent, "--auto"];

  logger.info("job-runner", `Spawning: opencode ${args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`);

  // cwd: "/workspace" matches the Docker bind mount so the agent sees the host's repos.
  // HOME is set explicitly because the Docker container's appuser may not inherit the
  // expected home directory through the spawn() environment merge.
  const proc = spawn("opencode", args, {
    cwd: "/workspace",
    env: { ...process.env, HOME: "/home/appuser" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  runningProcesses.set(runId, proc);

  // Timeout handler — SIGTERM first with a 5s grace period, then SIGKILL.
  // This two-phase kill gives the opencode process time to flush logs and clean up
  // child processes (e.g., LLM subprocesses) before a hard kill.
  timeoutHandle = setTimeout(() => {
    timedOut = true;
    logger.warn("job-runner", `Run ${runId} timed out after ${timeoutMs}ms — killing process.`);
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
    }, 5000);
    jobs.finishJobRun(runId, "timeout", -1);
    jobs.appendRunLog(runId, "stderr", `Job timed out after ${job.timeout_minutes} minutes.`);
    runningProcesses.delete(runId);
    activeRunCount--;
  }, timeoutMs);

  // Collect stdout — split by newlines
  let stdoutBuffer = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf-8");
    const lines = stdoutBuffer.split("\n");
    // Keep the last incomplete line in the buffer (stream may end mid-line)
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        jobs.appendRunLog(runId, "stdout", line);
      }
    }
  });

  // Collect stderr — split by newlines
  let stderrBuffer = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString("utf-8");
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        jobs.appendRunLog(runId, "stderr", line);
      }
    }
  });

  proc.on("close", (code) => {
    // Flush any remaining buffer content (last partial line from stream data)
    if (stdoutBuffer.length > 0) {
      jobs.appendRunLog(runId, "stdout", stdoutBuffer);
    }
    if (stderrBuffer.length > 0) {
      jobs.appendRunLog(runId, "stderr", stderrBuffer);
    }

    if (timeoutHandle) clearTimeout(timeoutHandle);

    if (!timedOut) {
      const exitCode = code ?? -1;
      const status = exitCode === 0 ? "success" : "failed";
      logger.info("job-runner", `Run ${runId} finished: status=${status}, exitCode=${exitCode}`);
      jobs.finishJobRun(runId, status, exitCode);
    }

    runningProcesses.delete(runId);
    activeRunCount--;
    logger.info("job-runner", `Run ${runId} cleaned up (active: ${activeRunCount}/${MAX_CONCURRENT_RUNS})`);
  });

  proc.on("error", (err: Error) => {
    if (timeoutHandle) clearTimeout(timeoutHandle);

    logger.error("job-runner", `Run ${runId} spawn error: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
    jobs.finishJobRun(runId, "failed", -1);
    jobs.appendRunLog(runId, "stderr", `Spawn error: ${err.message}`);

    runningProcesses.delete(runId);
    activeRunCount--;
  });
}

/**
 * Try to kill a running job run by its runId.
 * Returns true if the process was found and killed, false if not running.
 */
export function killRunProcess(runId: string): boolean {
  const proc = runningProcesses.get(runId);
  if (!proc || proc.killed) return false;

  logger.info("job-runner", `Killing process for run ${runId}`);
  proc.kill("SIGTERM");
  setTimeout(() => {
    if (!proc.killed) {
      proc.kill("SIGKILL");
    }
  }, 5000);

  runningProcesses.delete(runId);
  return true;
}

export { runningProcesses };
