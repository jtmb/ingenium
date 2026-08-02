/**
 * Auto Observer Plugin — Thin HTTP trigger for server-side extraction.
 *
 * This plugin is a lightweight trigger only. The actual extraction
 * (pattern detection, enrichment, observation creation) runs server-side
 * in the Ingenium API at POST /api/v1/extraction/run, triggered by both
 * this plugin (on session idle) and the API's scheduled maintenance cycle.
 *
 * No regex, no OpenCode DB access, no heavy init — just a thin HTTP ping.
 *
 * NOTE: Extraction runs server-side to avoid duplication and ensure consistency
 * across all OpenCode sessions. The client-side trigger is merely a convenience
 * to reduce latency vs. waiting for the scheduled maintenance cycle.
 */
import { tool } from "@opencode-ai/plugin"
import { classifyExtensionProjectFailure, ensureExtensionProject } from "./project-resolver.js"
import { apiRequestHeaders } from "./api-auth.js"
import { assertExtensionToolEnabled } from "./mcp-tool-state.js"
import { logPluginLifecycle } from "./plugin-lifecycle-log.js"

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1"

// Throttle to once per 60s — extraction is expensive and the API's scheduled
// maintenance cycle (every 15min) will catch anything this misses
let lastFire = 0
const THROTTLE_MS = 60000
const EXTRACTION_REQUEST_TIMEOUT_MS = 10_000

type ExtractionRequestFailure = "authentication" | "timeout" | "request_failed"

function classifyExtractionFailure(error: unknown, timedOut: boolean): ExtractionRequestFailure {
  if (timedOut || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) {
    return "timeout"
  }
  if (classifyExtensionProjectFailure(error) === "authentication") return "authentication"
  return "request_failed"
}

/**
 * POST to the server-side extraction endpoint.
 * Returns success/failure with observation count on success.
 */
async function triggerExtraction(worktree: string): Promise<{
  triggered: boolean;
  message: string;
  failure?: ExtractionRequestFailure;
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_REQUEST_TIMEOUT_MS)
  try {
    const project = await ensureExtensionProject(worktree, API_BASE)
    const res = await fetch(`${API_BASE}/extraction/run?project=${encodeURIComponent(project)}`, {
      method: "POST",
      headers: apiRequestHeaders(worktree, { "Content-Type": "application/json" }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return {
        triggered: false,
        message: `API ${res.status}`,
        failure: res.status === 401 || res.status === 403 ? "authentication" : "request_failed",
      }
    }
    const json = await res.json()
    const created = json?.data?.created ?? "unknown"
    return { triggered: true, message: `Extraction triggered: created ${created} observations` }
  } catch (error) {
    // Swallow errors — server may be down; API scheduler covers extraction anyway
    return { triggered: false, message: "Extraction request failed", failure: classifyExtractionFailure(error, controller.signal.aborted) }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * AutoObserverPlugin — triggers server-side extraction on session.idle events.
 * Throttled to 1/60s to avoid API load spikes.
 */
export const AutoObserverPlugin = async (ctx: { worktree: string; client: any }) => {
  const reportWarning = (reason: ExtractionRequestFailure) => {
    logPluginLifecycle(ctx.client, "auto-observer", "warn", `trigger_extraction: ${reason}`)
  }

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.idle") {
        const now = Date.now()
        if (now - lastFire < THROTTLE_MS) return
        lastFire = now
        try {
          const result = await triggerExtraction(ctx.worktree)
          if (!result.triggered) reportWarning(result.failure ?? "request_failed")
        } catch {
          reportWarning("request_failed")
        }
      }
    },

    tool: {
      auto_observe_now: tool({
        description:
          "Trigger server-side extraction — the API scans OpenCode message history for behavior patterns and creates observations. Returns a summary of what was found and created.",
        args: {},
        async execute(_args: any, context: { worktree: string }) {
          await assertExtensionToolEnabled("auto_observe_now", context.worktree)
          const { failure: _failure, ...result } = await triggerExtraction(context.worktree)
          return JSON.stringify(result, null, 2)
        },
      }),
    },
  }
}
