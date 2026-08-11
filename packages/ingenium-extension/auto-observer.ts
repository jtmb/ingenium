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
import { logPluginLifecycle } from "./plugin-lifecycle-log.js"
import { callMcpTool, McpBridgeError, mcpToolData } from "./mcp-client.js"
import { resolveExtensionProject } from "./project-resolver.js"

// Throttle to once per 60s — extraction is expensive and the API's scheduled
// maintenance cycle (every 15min) will catch anything this misses
let lastFire = 0
const THROTTLE_MS = 60000

type ExtractionRequestFailure = "authentication" | "timeout" | "request_failed"

function bridgeFailure(error: unknown): McpBridgeError["failure"] | undefined {
  if (error instanceof McpBridgeError) return error.failure
  if (typeof error === "object" && error !== null && "failure" in error) {
    const failure = (error as { failure?: unknown }).failure
    if (failure === "authentication" || failure === "timeout" || failure === "request_failed") return failure
  }
  return undefined
}

function classifyExtractionFailure(error: unknown, timedOut: boolean): ExtractionRequestFailure {
  if (timedOut || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) {
    return "timeout"
  }
  const failure = bridgeFailure(error)
  if (failure) {
    if (failure === "authentication") return "authentication"
    if (failure === "timeout") return "timeout"
  }
  return "request_failed"
}

/**
 * Call the server-side extraction tool.
 * Returns success/failure with observation count on success.
 */
async function triggerExtraction(worktree: string): Promise<{
  triggered: boolean;
  message: string;
  failure?: ExtractionRequestFailure;
}> {
  try {
    const project = resolveExtensionProject(worktree)
    const json = mcpToolData(await callMcpTool(worktree, "extraction_run", { project })) as { created?: unknown }
    const created = json?.created ?? "unknown"
    return { triggered: true, message: `Extraction triggered: created ${created} observations` }
  } catch (error) {
    // Swallow errors — server may be down; API scheduler covers extraction anyway
    return { triggered: false, message: "Extraction request failed", failure: classifyExtractionFailure(error, false) }
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
