/**
 * Auto Observer Plugin — Thin MCP trigger for server-side extraction.
 *
 * This plugin is a lightweight trigger only. The actual extraction
 * (pattern detection, enrichment, observation creation) runs server-side
 * in the Ingenium API through the Ingenium MCP transport, triggered by both
 * this plugin (on session idle) and the API's scheduled maintenance cycle.
 *
 * No regex, no OpenCode DB access, no heavy init — just a thin MCP call.
 *
 * NOTE: Extraction runs server-side to avoid duplication and ensure consistency
 * across all OpenCode sessions. The client-side trigger is merely a convenience
 * to reduce latency vs. waiting for the scheduled maintenance cycle.
 */
import { tool } from "@opencode-ai/plugin"
import { assertExtensionToolEnabled } from "./mcp-tool-state.js"
import { resolveExtensionBinding } from "./extension-binding.js"
import { logPluginLifecycle } from "./plugin-lifecycle-log.js"
import { callMcpTool, mcpToolData } from "./mcp-client.js"
import { classifyObserverFailure, type ObserverRequestFailure } from "./observer-core.js"

// Throttle to once per 60s — extraction is expensive and the API's scheduled
// maintenance cycle (every 15min) will catch anything this misses
let lastFire = 0
const THROTTLE_MS = 60000

type ExtractionRequestFailure = Extract<ObserverRequestFailure, "authentication" | "timeout" | "request_failed">

function classifyExtractionFailure(error: unknown): ExtractionRequestFailure {
  const failure = classifyObserverFailure(error)
  if (failure === "authentication" || failure === "timeout") return failure
  return "request_failed"
}

/**
 * Schedule the server-side extraction tool.
 */
async function triggerExtraction(worktree: string): Promise<{
  triggered: boolean;
  message: string;
  status?: "started";
  failure?: ExtractionRequestFailure;
}> {
  try {
    const project = resolveExtensionBinding(worktree, { purpose: "learning" }).project
    const json = mcpToolData(await callMcpTool(worktree, "extraction_run", { project })) as { status?: unknown }
    if (json?.status !== "started") return { triggered: false, message: "Extraction request failed", failure: "request_failed" }
    return { triggered: true, status: "started", message: "Extraction scheduled" }
  } catch (error) {
    // Swallow errors — server may be down; API scheduler covers extraction anyway
    return { triggered: false, message: "Extraction request failed", failure: classifyExtractionFailure(error) }
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
          "Schedule server-side extraction. Returns only whether asynchronous extraction started; results are available later through pipeline status.",
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
