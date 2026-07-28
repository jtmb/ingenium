/**
 * Observer Core — Self-learning pipeline core.
 *
 * On session start: imports locally-saved observations (API-down fallback) into the DB.
 * On session idle: triggers synthesis if the check-interval timer has elapsed.
 *
 * Extension events always resolve an explicit worktree-derived project. They never fall
 * back to global-default, which is reserved for the container's own session.
 */

import { ensureExtensionProject } from "./project-resolver.js";
import { apiRequestHeaders } from "./api-auth.js";

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";
const OBSERVER_API_REQUEST_TIMEOUT_MS = 10_000;

/** Stable, credential-free diagnostics emitted by observer lifecycle hooks. */
export type ObserverRequestFailure = "authentication" | "not_found" | "locked" | "timeout" | "request_failed";

class ObserverApiRequestError extends Error {
  constructor(readonly failure: ObserverRequestFailure) {
    super("Observer API request failed");
    this.name = "ObserverApiRequestError";
  }
}

/** Map HTTP responses without propagating a status, body, URL, or credential. */
export function classifyObserverHttpFailure(status: number): ObserverRequestFailure {
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "not_found";
  if (status === 423) return "locked";
  return "request_failed";
}

export function classifyObserverFailure(error: unknown): ObserverRequestFailure {
  if (error instanceof ObserverApiRequestError) return error.failure;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "timeout";
  }
  return "request_failed";
}

async function apiFetch(worktree: string, path: string, options?: RequestInit): Promise<any> {
  const url = `${API_BASE}${path}`;
  const headers = apiRequestHeaders(worktree, options?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OBSERVER_API_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ObserverApiRequestError(classifyObserverHttpFailure(res.status));
    }
    return res.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ObserverApiRequestError("timeout");
    }
    if (error instanceof ObserverApiRequestError) throw error;
    throw new ObserverApiRequestError(classifyObserverFailure(error));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Log a pipeline lifecycle event to the Ingenium API for dashboard timeline observability.
 * Non-fatal on failure — observability must never block pipeline operations.
 */
export async function logPipelineEvent(
  eventType: string,
  eventSource: string,
  title: string,
  worktree: string,
  description?: string,
  data?: any,
  sessionId?: string,
): Promise<void> {
  try {
    const project = await ensureExtensionProject(worktree, API_BASE);
    await apiFetch(worktree, `/pipeline/events?project=${encodeURIComponent(project)}`, {
      method: "POST",
      body: JSON.stringify({
        event_type: eventType,
        event_source: eventSource,
        title,
        description,
        data,
        session_id: sessionId,
        importance: 5,
      }),
    });
  } catch (error) {
    // Non-fatal — observability should never block pipeline, but never drop it silently.
    // Do not include API response text here: it can contain upstream diagnostics or credentials.
    process.stderr.write(`${JSON.stringify({ event: "pipeline_event_rejected", reason: classifyObserverFailure(error), eventType, eventSource })}\n`);
  }
}

/**
 * Import observations from the local file fallback.
 *
 * When the API is unreachable, observations are saved to observations.md (pipe-delimited).
 * On the next session start, this imports any that don't have the [IMPORTED] marker.
 * The file format: YYYY-MM-DD | type | content | importance | source
 */
export async function importObservationsFromFile(worktree: string): Promise<{ imported: number; skipped: number }> {
  const project = await ensureExtensionProject(worktree, API_BASE);
  const pathModule = require("path");
  const fs = require("fs");

  const obsPath = pathModule.join(worktree, ".opencode", "skills", "observations.md");
  if (!fs.existsSync(obsPath)) return { imported: 0, skipped: 0 };

  const content = fs.readFileSync(obsPath, "utf-8");
  const lines = content.split("\n");
  const unprocessed: string[] = [];
  const lineIndices: number[] = [];

  lines.forEach((line: string, i: number) => {
    // Match lines starting with a date but lacking the [IMPORTED] marker
    if (/^\d{4}-\d{2}-\d{2}/.test(line) && !line.includes("[IMPORTED]")) {
      unprocessed.push(line);
      lineIndices.push(i);
    }
  });

  if (unprocessed.length === 0) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;

  for (const entry of unprocessed) {
    try {
      // Parse pipe-delimited format: date | type | content | importance | source
      const parts = entry.split(" | ");
      const obsType = parts[1]?.trim() || "insight";
      const obsContent = parts[2]?.trim() || entry;
      const importance = parseInt(parts[3]?.trim() || "5");
      
      await apiFetch(worktree, `/observations?project=${encodeURIComponent(project)}`, {
        method: "POST",
        body: JSON.stringify({
          observation_type: obsType,
          content: obsContent,
          importance,
          source: "import",
        }),
      });
      imported++;
    } catch {
      skipped++;
    }
  }

  // Mark successfully imported entries so they aren't re-imported on next restart
  if (imported > 0) {
    const updatedLines = lines.map((line: string, i: number) => {
      if (lineIndices.includes(i) && !line.includes("[IMPORTED]")) {
        return line + " [IMPORTED]";
      }
      return line;
    });
    fs.writeFileSync(obsPath, updatedLines.join("\n"), "utf-8");

    // Log import event for dashboard observability
    await logPipelineEvent(
      "observation_imported",
      "plugin",
      `Imported ${imported} observation(s) from file fallback`,
      worktree,
      `${skipped} skipped`,
      { imported, skipped },
    );
  }

  return { imported, skipped };
}

/**
 * Trigger the synthesis pipeline via the API.
 * The API processes pending observations into personality traits and skill updates.
 */
export async function triggerSynthesis(worktree: string, sessionId?: string): Promise<{
  triggered: boolean;
  message: string;
  failure?: ObserverRequestFailure;
}> {
  try {
    const project = await ensureExtensionProject(worktree, API_BASE);
    await logPipelineEvent(
      "synthesis_triggered",
      "plugin",
      "Synthesis pipeline triggered",
      worktree,
      "",
      {},
    );

    const params = new URLSearchParams({ project });
    if (sessionId) params.set("session_id", sessionId);
    const result = await apiFetch(worktree, `/synthesis/run?${params}`, {
      method: "POST",
    });
    return { triggered: true, message: JSON.stringify(result.data) };
  } catch (error) {
    return {
      triggered: false,
      message: "Synthesis request failed",
      failure: classifyObserverFailure(error),
    };
  }
}
