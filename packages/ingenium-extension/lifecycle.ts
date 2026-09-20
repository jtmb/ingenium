import { createHash, randomUUID } from "node:crypto";
import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import { callMcpTool, mcpToolData } from "./mcp-client.js";
import { resolveExtensionBinding } from "./extension-binding.js";
import { ContextAutoUploader } from "./context-upload.js";
import { ExternalUsageCollector } from "./external-usage.js";
import { eventSessionId, getV2SessionInfo, readV2Messages, recoverySessionMessage, v2Client } from "./opencode-v2.js";
import { logPluginLifecycle } from "./plugin-lifecycle-log.js";
import { redactedHandoffFromSession } from "./scripts/production-restart.js";
import {
  currentRecoverySource,
  isValidRecoveryRole,
  publishCurrentParentRecovery,
  type CurrentRecoverySession,
  type ManagedRecoveryBinding,
} from "./tui-recovery.js";

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
  const recoveryBinding: ManagedRecoveryBinding | undefined = binding.projectId && binding.storageMappingHash
    ? { project: binding.project, projectId: binding.projectId, workspaceId: binding.workspaceId,
      launcherWorktree: binding.launcherWorktree, storageMappingHash: binding.storageMappingHash }
    : undefined;
  const recoveryRuntimeId = binding.runtimeId ?? randomUUID();
  const recoveryRevisions = new Map<string, { incarnation: number; revision: number; fence: number }>();
  const pendingRecovery = new Map<string, { again: boolean; promise: Promise<void> }>();

  const publishRecovery = async (sessionID: string): Promise<void> => {
    const nonce = process.env.INGENIUM_RESTART_NONCE;
    const controlPlane = ctx.serverUrl?.origin;
    if (!recoveryBinding || !nonce || !controlPlane) return;
    const info = await getV2SessionInfo(client, sessionID);
    if (info.location.directory !== ctx.worktree) return;
    const messages = await readV2Messages(client, sessionID);
    const assistant = [...messages].reverse().find((message) => message.type === "assistant");
    if (!assistant || !isValidRecoveryRole(assistant.agent)) return;
    const handoff = redactedHandoffFromSession(
      messages.map((message) => recoverySessionMessage(message, sessionID)),
      { [sessionID]: { type: "idle" } },
      { id: sessionID, directory: ctx.worktree },
      sessionID,
      ctx.worktree,
    );
    if (!handoff) return;
    const prior = recoveryRevisions.get(sessionID);
    const sequence = prior
      ? { ...prior, revision: prior.revision + 1 }
      : { incarnation: 1, revision: 0, fence: 1 };
    recoveryRevisions.set(sessionID, sequence);
    const session: CurrentRecoverySession = {
      role: assistant.agent,
      sessionId: sessionID,
      coordinationSessionId: `session-${digest(sessionID)}`,
      worktreeId: `worktree-${digest(`${recoveryBinding.workspaceId}\0${recoveryBinding.storageMappingHash}`)}`,
      ...sequence,
      epoch: null,
      claimReferenceSha256: null,
      handoff,
      todos: handoff.replay.todos.map(({ id, status }) => ({ id, status })),
    };
    publishCurrentParentRecovery({
      binding: recoveryBinding,
      runtimeId: recoveryRuntimeId,
      nonce,
      controlPlane,
      source: currentRecoverySource(ctx.worktree),
      sessions: [session],
    });
  };

  const queueRecoveryPublication = (sessionID: string): Promise<void> => {
    const pending = pendingRecovery.get(sessionID);
    if (pending) {
      pending.again = true;
      return pending.promise;
    }
    const state = { again: false, promise: Promise.resolve() };
    pendingRecovery.set(sessionID, state);
    state.promise = (async () => {
      do {
        state.again = false;
        await publishRecovery(sessionID).catch(() => logPluginLifecycle(
          ctx.client, "ingenium-lifecycle", "warn", "recovery: current parent unavailable",
        ));
      } while (state.again);
    })().finally(() => pendingRecovery.delete(sessionID));
    return state.promise;
  };

  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return;
      const sessionID = eventSessionId(event);
      if (!sessionID) return;
      await queueRecoveryPublication(sessionID);
      await contextUploader.sync(sessionID);
      await externalUsage.sync(sessionID).catch(() => undefined);
    },
  };
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
