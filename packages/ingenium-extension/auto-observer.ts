/**
 * Auto Observer Plugin — Thin Trigger
 *
 * This plugin is a lightweight trigger only. The actual extraction
 * (pattern detection, enrichment, observation creation) runs server-side
 * in the Ingenium API at POST /api/v1/extraction/run, triggered by both
 * this plugin (on session idle) and the API's scheduled maintenance cycle.
 *
 * No regex, no OpenCode DB access, no heavy init — just a thin HTTP ping.
 */
import { tool } from "@opencode-ai/plugin"

// Configuration
const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1"
const PROJECT = process.env.INGENIUM_PROJECT || "global-default"

// In-memory throttle — fire at most once per 60s
let lastFire = 0
const THROTTLE_MS = 60000

async function triggerExtraction(): Promise<{ triggered: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/extraction/run?project=${PROJECT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
    if (!res.ok) {
      return { triggered: false, message: `API ${res.status}` }
    }
    const json = await res.json()
    const created = json?.data?.created ?? "unknown"
    return { triggered: true, message: `Extraction triggered: created ${created} observations` }
  } catch (err: any) {
    // Swallow errors — server may be down; API scheduler covers extraction anyway
    return { triggered: false, message: err.message }
  }
}

export const AutoObserverPlugin = async (ctx: { worktree: string; client: any }) => {
  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.idle") {
        const now = Date.now()
        if (now - lastFire < THROTTLE_MS) return
        lastFire = now
        await triggerExtraction()
      }
    },

    tool: {
      auto_observe_now: tool({
        description:
          "Trigger server-side extraction — the API scans OpenCode message history for behavior patterns and creates observations. Returns a summary of what was found and created.",
        args: {},
        async execute(_args: any, _context: { worktree: string }) {
          const result = await triggerExtraction()
          return JSON.stringify(result, null, 2)
        },
      }),
    },
  }
}
