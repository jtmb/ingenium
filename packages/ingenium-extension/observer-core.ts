/**
 * Observer Core — Self-learning pipeline core.
 *
 * On session start: imports locally-saved observations (API-down fallback) into the DB.
 * On session idle: triggers synthesis if the check-interval timer has elapsed.
 *
 * NOTE: DEFAULT_PROJECT falls back to "global-default" here (unlike resource-sync.ts which
 * never falls back) because this runs in the extension context where the user always has
 * a default global project. Resource-sync runs in server context where project isolation is critical.
 */

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";
const DEFAULT_PROJECT = process.env.INGENIUM_PROJECT || "global-default";

async function apiFetch(path: string, options?: RequestInit): Promise<any> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} for ${url}: ${text}`);
  }
  return res.json();
}

/**
 * Log a pipeline lifecycle event to the Ingenium API for dashboard timeline observability.
 * Non-fatal on failure — observability must never block pipeline operations.
 */
export async function logPipelineEvent(
  eventType: string,
  eventSource: string,
  title: string,
  description?: string,
  data?: any,
  sessionId?: string,
): Promise<void> {
  try {
    await apiFetch(`/pipeline/events?project=${DEFAULT_PROJECT}`, {
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
  } catch {
    // Non-fatal — observability should never block pipeline
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
      
      await apiFetch(`/observations?project=${DEFAULT_PROJECT}`, {
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
export async function triggerSynthesis(worktree: string, sessionId?: string): Promise<{ triggered: boolean; message: string }> {
  try {
    await logPipelineEvent(
      "synthesis_triggered",
      "plugin",
      "Synthesis pipeline triggered",
      "",
      {},
    );

    const params = new URLSearchParams({ project: DEFAULT_PROJECT });
    if (sessionId) params.set("session_id", sessionId);
    const result = await apiFetch(`/synthesis/run?${params}`, {
      method: "POST",
    });
    return { triggered: true, message: JSON.stringify(result.data) };
  } catch (err: any) {
    return { triggered: false, message: err.message };
  }
}
