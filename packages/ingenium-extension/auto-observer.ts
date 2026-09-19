import { createHash } from "node:crypto"
import { tool } from "@opencode-ai/plugin"
import { assertExtensionToolEnabled } from "./mcp-tool-state.js"
import { resolveExtensionBinding } from "./extension-binding.js"
import { logPluginLifecycle } from "./plugin-lifecycle-log.js"
import { callMcpTool, mcpToolData } from "./mcp-client.js"
import { classifyObserverFailure, type ObserverRequestFailure } from "./observer-core.js"
import { visibleContextExport } from "@ingenium/extension/context-upload-codec"
import { eventSessionId, getV2SessionInfo, legacySessionInfo, legacySessionMessage, readV2Messages, v2Client } from "./opencode-v2.js"

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

export const AutoObserverPlugin = async (ctx: { worktree: string; client: any; serverUrl?: URL }) => {
  const pending = new Map<string, Promise<void>>()
  const reportWarning = (reason: ExtractionRequestFailure) => {
    logPluginLifecycle(ctx.client, "auto-observer", "warn", `trigger_extraction: ${reason}`)
  }

  const collect = async (sessionId: string) => {
    const binding = resolveExtensionBinding(ctx.worktree, { purpose: "learning" })
    if (binding.launcherWorktree !== ctx.worktree) throw new Error("EXTERNAL_OBSERVATION_BINDING_REJECTED")
    const external = {
      worktree: binding.launcherWorktree,
      sessionId: `session-${createHash("sha256").update(sessionId, "utf8").digest("hex")}`,
    }
    const invoke = async (input: Record<string, unknown>) => mcpToolData(await callMcpTool(
      ctx.worktree, "extraction_run", { project: binding.project, external: input }, { timeoutMs: 60_000 },
    )) as { enabled?: boolean }
    if ((await invoke(external)).enabled !== true) return
    const client = v2Client(ctx)
    const info = await getV2SessionInfo(client, sessionId)
    const messages = await readV2Messages(client, sessionId, { maxPages: 1, order: "desc" })
    if (messages.length > 100) throw new Error("EXTERNAL_OBSERVATION_INVALID")
    const users = messages.map((message) => legacySessionMessage(message, sessionId))
      .reverse().filter((message) => message.info.role === "user").slice(-20)
    if (Buffer.byteLength(JSON.stringify(users)) > 1024 * 1024) {
      throw new Error("EXTERNAL_OBSERVATION_INVALID")
    }
    // Bound each idle pass; replay is safe because the API persists per-message receipts.
    const visible = visibleContextExport({
      info: legacySessionInfo(info, sessionId, binding.launcherWorktree), messages: users,
    }, sessionId, binding.launcherWorktree)
    for (const message of visible.messages) {
      const text = message.parts[0]?.text
      if (!text || text.length > 6000) continue
      const result = await invoke({ ...external, message: { id: message.info.id, role: "user", text } })
      if (result.enabled !== true) return
    }
  }

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type !== "session.idle") return
       const sessionId = eventSessionId(event)
       if (!sessionId) return
      const existing = pending.get(sessionId)
      if (existing) return existing
      const promise = collect(sessionId).catch((error) => reportWarning(classifyExtractionFailure(error)))
        .finally(() => pending.delete(sessionId))
      pending.set(sessionId, promise)
      await promise
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
