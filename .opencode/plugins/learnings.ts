import { tool } from "@opencode-ai/plugin"
import { processAll } from "./learnings-core"

// Configuration
const DEFAULT_INTERVAL = 0
function getInterval(): number {
  const raw = process.env.LEARNINGS_CHECK_INTERVAL
  if (raw === undefined || raw === "") return DEFAULT_INTERVAL
  const n = parseInt(raw, 10)
  return isNaN(n) ? DEFAULT_INTERVAL : n
}

// In-memory state for turn counting
let turnCount = 0
let lastCheckTime = 0

export const LearningsPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.created") {
        const result = await processAll(worktree)
        if (result.processed > 0) {
          await ctx.client.app.log({
            body: {
              service: "learnings-pipeline",
              level: "info",
              message: `Processed ${result.processed} learning(s) automatically at session start. ${result.indexesUpdated ? "Indexes updated. " : ""}Summary: ${result.actions.map(a => `${a.action} (${a.notes})`).join("; ")}`,
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

        // Debounce: don't check more than once per 30 seconds
        const now = Date.now()
        if (now - lastCheckTime < 30000) return
        lastCheckTime = now

        const result = await processAll(worktree)
        if (result.processed > 0) {
          await ctx.client.app.log({
            body: {
              service: "learnings-pipeline",
              level: "info",
              message: `Processed ${result.processed} learning(s) automatically (check interval: ${interval}). ${result.indexesUpdated ? "Indexes updated. " : ""}Summary: ${result.actions.map(a => `${a.action} (${a.notes})`).join("; ")}`,
            },
          })
        }
      }
    },

    tool: {
      process_learnings: tool({
        description: "Process all unprocessed learning entries from the Ingenium DB into skill file updates. Reads each entry, classifies it (new-skill, add-pattern, update-rule, noop), executes the action, and marks the entry as processed in the DB. Returns a JSON summary of what was done.",
        args: {},
        async execute(_args: any, context: { worktree: string }) {
          const result = await processAll(context.worktree)
          return JSON.stringify(result, null, 2)
        },
      }),
    },
  }
}
