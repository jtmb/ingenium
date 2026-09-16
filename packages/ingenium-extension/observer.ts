import { tool } from "@opencode-ai/plugin"
import { importObservationsFromFile, triggerSynthesis, logPipelineEvent, type ObserverFailureReporter, type ObserverRequestFailure } from "./observer-core.js"
import { assertExtensionToolEnabled } from "./mcp-tool-state.js"
import { logPluginLifecycle } from "./plugin-lifecycle-log.js"

/**
 * How many session.idle events to skip between synthesis checks.
 * 0 disables periodic synthesis entirely.
 * Configured via OBSERVER_CHECK_INTERVAL env var to avoid hammering the API on frequent idle events.
 */
function getInterval(): number {
  const raw = process.env.OBSERVER_CHECK_INTERVAL
  if (raw === undefined || raw === "") return 0
  const n = parseInt(raw, 10)
  return isNaN(n) ? 0 : n
}

let turnCount = 0
let lastCheckTime = 0

function reportObserverError(
  reportWarning: ObserverFailureReporter,
  operation: "import_observations" | "trigger_synthesis",
  reason: ObserverRequestFailure = "request_failed",
): void {
  reportWarning(operation, reason);
}

/**
 * ObserverPlugin — orchestrates the self-learning pipeline from session lifecycle events.
 *
 * session.created: imports fallback observations from local file, triggers initial synthesis.
 * session.idle: conditionally triggers synthesis via dual throttle (turn count + 30s wall clock).
 *
 * The dual throttle prevents rapid re-synthesis during burst idle events
 * while ensuring eventual processing in slow sessions.
 */
export const ObserverPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree
  const reportWarning: ObserverFailureReporter = (operation, reason) => {
    logPluginLifecycle(ctx.client, "observer-pipeline", "warn", `${operation}: ${reason}`)
  }

  return {
    event: async ({ event }: { event: any }) => {
      const sessionId = (event as any).session?.id || undefined;

      if (event.type === "session.created") {
        try {
          await logPipelineEvent(
            "session_created",
            "plugin",
            "OpenCode session started",
            worktree,
            "",
            {},
            undefined,
            reportWarning,
          );
        } catch {
          reportWarning("pipeline_event_rejected", "request_failed")
        }

        // Import observations saved to local fallback when API was unreachable
        let fileResult = { imported: 0, skipped: 0 }
        try {
          fileResult = await importObservationsFromFile(worktree, reportWarning)
        } catch {
          reportObserverError(reportWarning, "import_observations")
        }
        if (fileResult.imported > 0) {
          logPluginLifecycle(
            ctx.client,
            "observer-pipeline",
            "info",
            `Imported ${fileResult.imported} observation(s) from observations.md (${fileResult.skipped} skipped)`,
          )
        }

        // Process any observations that accumulated while the session was closed
        const synthResult = await triggerSynthesis(worktree, sessionId, reportWarning)
        if (!synthResult.triggered) reportObserverError(reportWarning, "trigger_synthesis", synthResult.failure)
        if (synthResult.triggered) {
          logPluginLifecycle(ctx.client, "observer-pipeline", "info", "Synthesis triggered")
        }
        
        turnCount = 0
        lastCheckTime = Date.now()
      }

      if (event.type === "session.idle") {
        const interval = getInterval()
        if (interval <= 0) return

        turnCount++
        if (turnCount % interval !== 0) return

        // Wall-clock guard prevents rapid re-triggering when session.idle fires in quick succession
        const now = Date.now()
        if (now - lastCheckTime < 30000) return
        lastCheckTime = now

        const synthResult = await triggerSynthesis(worktree, sessionId, reportWarning)
        if (!synthResult.triggered) reportObserverError(reportWarning, "trigger_synthesis", synthResult.failure)
        if (synthResult.triggered) {
          logPluginLifecycle(ctx.client, "observer-pipeline", "info", `Synthesis triggered (check interval: ${interval})`)
        }
      }
    },

    tool: {
      synthesize_observations: tool({
        description: "Process all pending observations through the synthesis pipeline. Reads unprocessed observations, classifies them, generates/updates personality traits and skills, and marks them as processed in the DB. Returns a JSON summary of what was done.",
        args: {},
        async execute(_args: any, context: { worktree: string }) {
          await assertExtensionToolEnabled("synthesize_observations", context.worktree)
          const result = await triggerSynthesis(context.worktree)
          return JSON.stringify(result, null, 2)
        },
      }),
    },
  }
}
