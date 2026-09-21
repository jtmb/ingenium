import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import { callMcpTool, mcpToolData } from "./mcp-client.js";
import { resolveExtensionBinding } from "./extension-binding.js";
import { ContextAutoUploader } from "./context-upload.js";
import { ExternalUsageCollector } from "./external-usage.js";
import { eventSessionId, v2Client } from "./opencode-v2.js";
import { logPluginLifecycle } from "./plugin-lifecycle-log.js";

/**
 * Hybrid OpenCode adapter. Root hooks are retained only for lifecycle events;
 * session/API reads are routed through the v2 client because v2 has no native
 * lifecycle or tool-registration equivalent yet.
 */
export const LifecyclePlugin = async (ctx: PluginInput): Promise<Hooks> => {
  let binding;
  try {
    binding = resolveExtensionBinding(ctx.worktree, { purpose: "general", allowMissingCredential: true });
  } catch {
    logPluginLifecycle(ctx.client, "ingenium-lifecycle", "warn", "lifecycle: unavailable");
    return {};
  }
  if (binding.audience !== "mcp" || binding.launcherWorktree !== ctx.worktree) return {};

  const invoke = async (name: string, args: Record<string, unknown>) => {
    const value = mcpToolData(await callMcpTool(ctx.worktree, name, args));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP_RESULT_INVALID");
    return value as Record<string, unknown>;
  };
  const client = v2Client(ctx);
  const contextUploader = new ContextAutoUploader(binding.project, ctx.worktree, client, invoke);
  const externalUsage = new ExternalUsageCollector(binding.project, ctx.worktree, client, invoke);

  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return;
      const sessionID = eventSessionId(event);
      if (!sessionID) return;
      await contextUploader.sync(sessionID);
      await externalUsage.sync(sessionID).catch(() => undefined);
    },
  };
};
