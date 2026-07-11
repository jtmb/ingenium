import { tool } from "@opencode-ai/plugin"
import { importObservationsFromFile, triggerSynthesis, logPipelineEvent } from "./observer-core.js"

// Configuration
const SYNC_INTERVAL = 0  // 0 = disabled, set via env
function getInterval(): number {
  const raw = process.env.OBSERVER_CHECK_INTERVAL
  if (raw === undefined || raw === "") return SYNC_INTERVAL
  const n = parseInt(raw, 10)
  return isNaN(n) ? SYNC_INTERVAL : n
}

// In-memory state
let turnCount = 0
let lastCheckTime = 0

export const ObserverPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree

  return {
    event: async ({ event }: { event: any }) => {
      // Extract session ID for pipeline event threading
      const sessionId = (event as any).session?.id || undefined;

      if (event.type === "session.created") {
        // Log session created for dashboard observability
        logPipelineEvent(
          "session_created",
          "plugin",
          "OpenCode session started",
          "",
          {},
        ).catch(() => {});

        // Step 1: Import any locally-saved observations into the DB
        const fileResult = await importObservationsFromFile(worktree)
        if (fileResult.imported > 0) {
          await ctx.client.app.log({
            body: {
              service: "observer-pipeline",
              level: "info",
              message: `Imported ${fileResult.imported} observation(s) from observations.md (${fileResult.skipped} skipped)`,
            },
          })
        }

        // Step 2: Trigger initial synthesis
        const synthResult = await triggerSynthesis(worktree, sessionId)
        if (synthResult.triggered) {
          await ctx.client.app.log({
            body: {
              service: "observer-pipeline",
              level: "info",
              message: `Synthesis triggered: ${synthResult.message}`,
            },
          })
        }
        
        turnCount = 0
        lastCheckTime = Date.now()
      }

      if (event.type === "session.idle") {
        const interval = getInterval()
        if (interval <= 0) return

        turnCount++
        if (turnCount % interval !== 0) return

        const now = Date.now()
        if (now - lastCheckTime < 30000) return
        lastCheckTime = now

        const synthResult = await triggerSynthesis(worktree, sessionId)
        if (synthResult.triggered) {
          await ctx.client.app.log({
            body: {
              service: "observer-pipeline",
              level: "info",
              message: `Synthesis triggered (check interval: ${interval}): ${synthResult.message}`,
            },
          })
        }
      }
    },

    tool: {
      synthesize_observations: tool({
        description: "Process all pending observations through the synthesis pipeline. Reads unprocessed observations, classifies them, generates/updates personality traits and skills, and marks them as processed in the DB. Returns a JSON summary of what was done.",
        args: {},
        async execute(_args: any, context: { worktree: string }) {
          const result = await triggerSynthesis(context.worktree)
          return JSON.stringify(result, null, 2)
        },
      }),
    },
  }
}
