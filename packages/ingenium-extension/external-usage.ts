import { createHash } from "node:crypto";
import { completedAssistant, redactContextText } from "@ingenium/extension/context-upload-codec";
import { getV2SessionInfo, legacySessionMessage, readV2Messages, type OpenCodeV2Client } from "./opencode-v2.js";

type Invoke = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    && redactContextText(value) === value ? value : undefined;
}

export function externalUsageEvent(info: unknown, sessionId: string, worktree: string): Record<string, unknown> | undefined {
  const message = record(info);
  if (!message || message.role !== "assistant" || message.sessionID !== sessionId
    || !identifier(message.id) || !completedAssistant(message)) return;
  const completed = record(message.time)?.completed;
  if (typeof completed !== "number" || completed < 0 || completed > 8.64e15) return;
  const tokens = record(message.tokens);
  const cache = record(tokens?.cache);
  for (const value of [message.providerID, message.modelID, message.agent]) {
    if (value != null && (typeof value !== "string" || value.length > 128
      || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) || redactContextText(value) !== value)) return;
  }
  for (const value of [tokens?.total, tokens?.input, tokens?.output, tokens?.reasoning, cache?.read, cache?.write]) {
    if (value != null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) return;
  }
  if (message.cost != null && (typeof message.cost !== "number" || !Number.isFinite(message.cost)
    || message.cost < 0 || message.cost > Number.MAX_SAFE_INTEGER)) return;
  // Copy the allowlist, never the SDK envelope, parts, errors, or provider configuration.
  return {
    worktree, sessionId: `session-${createHash("sha256").update(sessionId, "utf8").digest("hex")}`,
    messageId: message.id, role: "assistant", completedAt: new Date(completed).toISOString(),
    providerId: message.providerID, modelId: message.modelID, agentId: message.agent,
    totalTokens: tokens?.total, inputTokens: tokens?.input, outputTokens: tokens?.output,
    reasoningTokens: tokens?.reasoning, cacheReadTokens: cache?.read, cacheWriteTokens: cache?.write,
    costAmount: message.cost,
  };
}

export class ExternalUsageCollector {
  private readonly pending = new Map<string, { again: boolean; promise: Promise<void> }>();

  constructor(private readonly project: string, private readonly worktree: string,
    private readonly client: OpenCodeV2Client, private readonly invoke: Invoke) {}

  sync(sessionId: string): Promise<void> {
    const existing = this.pending.get(sessionId);
    if (existing) {
      existing.again = true;
      return existing.promise;
    }
    const state = { again: false, promise: Promise.resolve() };
    this.pending.set(sessionId, state);
    state.promise = (async () => {
      do {
        state.again = false;
        await this.collect(sessionId);
      } while (state.again);
    })().finally(() => this.pending.delete(sessionId));
    return state.promise;
  }

  private async collect(sessionId: string): Promise<void> {
    if (!identifier(sessionId)) throw new Error("EXTERNAL_USAGE_BINDING_REJECTED");
    const info = await getV2SessionInfo(this.client, sessionId);
    if (info.location.directory !== this.worktree) throw new Error("EXTERNAL_USAGE_BINDING_REJECTED");
    const seen = new Set<string>();
    const messages = await readV2Messages(this.client, sessionId);
    for (const raw of messages) {
      const message = legacySessionMessage(raw, sessionId).info;
      const id = identifier(message.id);
      if (!id || seen.has(id) || message.sessionID !== sessionId) throw new Error("EXTERNAL_USAGE_BINDING_REJECTED");
      seen.add(id);
      const event = externalUsageEvent(message, sessionId, this.worktree);
      if (!event) continue;
      const result = await this.invoke("usage_ingest", { project: this.project, event });
      if (typeof result.created !== "boolean") throw new Error("EXTERNAL_USAGE_UNAVAILABLE");
    }
  }
}
