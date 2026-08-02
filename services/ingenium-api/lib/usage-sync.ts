import { logger, usage } from "ingenium-core";
import { config } from "../config/index.js";
import {
  isOpenCodeError,
  opencodeClient,
  type MessageEnvelope,
  type MessageInfo,
  type MessagePart,
  type SessionInfo,
} from "./opencode-client.js";

const SOURCE = "usage-sync";
const LOOKBACK_MS = 5 * 60_000;
const MAX_SESSIONS_PER_PROJECT = 100;
const MAX_MESSAGE_PAGES_PER_SESSION = 5;
const MESSAGE_PAGE_SIZE = 200;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export function getUsageSyncInterval(): number {
  const parsed = Number.parseInt(process.env.USAGE_SYNC_INTERVAL_MS ?? "300000", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300_000;
}

interface SyncSession {
  session: SessionInfo;
  sessionId: string;
  sourceProjectId: string;
  updatedAt: string;
}

interface ProcessSessionResult {
  eventCount: number;
  lastPartId: string | null;
  errorCode: string | null;
}

export interface UsageSyncProjectResult {
  projectId: string;
  sessionsSelected: number;
  sessionsProcessed: number;
  eventsUpserted: number;
  errorCode: string | null;
}

export interface UsageSyncResult {
  sourceInstance: string;
  projects: UsageSyncProjectResult[];
  sessionsScanned: number;
  sessionsQuarantined: number;
  sessionsSkipped: number;
  unavailable: boolean;
  errorCode: string | null;
  alreadyRunning: boolean;
}

let activeSync: Promise<UsageSyncResult> | null = null;

function now(): string {
  return new Date().toISOString();
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !CONTROL_CHARACTER.test(value)
    ? value
    : null;
}

function timestampFromEpoch(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 8.64e15) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tokenMetadata(value: unknown) {
  const tokens = record(value);
  const cache = record(tokens?.cache);
  return {
    totalTokens: nonNegativeInteger(tokens?.total),
    inputTokens: nonNegativeInteger(tokens?.input),
    outputTokens: nonNegativeInteger(tokens?.output),
    reasoningTokens: nonNegativeInteger(tokens?.reasoning),
    cacheReadTokens: nonNegativeInteger(cache?.read),
    cacheWriteTokens: nonNegativeInteger(cache?.write),
  };
}

function valueOrFallback(value: number | null, fallback: number | null, useFallback: boolean): number | null {
  return value ?? (useFallback ? fallback : null);
}

function normalizeStatus(part: MessagePart, message: MessageInfo): usage.UsageStatus {
  const reason = typeof part.reason === "string"
    ? part.reason.toLowerCase()
    : typeof message.finish === "string"
      ? message.finish.toLowerCase()
      : "";
  if (/error|fail|abort|cancel/.test(reason)) return "error";
  if (/length|limit|partial|incomplete/.test(reason)) return "partial";
  if (/stop|complete|success|end/.test(reason)) return "success";
  return "unknown";
}

function providerModelAndAgent(
  message: MessageInfo,
  session: SessionInfo,
): { providerId: string | null; modelId: string | null; agentId: string | null } {
  return {
    providerId: safeIdentifier(message.model?.providerID)
      ?? safeIdentifier(message.providerID)
      ?? safeIdentifier(session.model?.providerID),
    modelId: safeIdentifier(message.model?.modelID)
      ?? safeIdentifier(message.modelID)
      ?? safeIdentifier(session.model?.id),
    // Attribution is only valid when the assistant message that owns this
    // step-finish reports it. A session-level default can be stale or refer to
    // a different assistant, so it must not be used as a fallback.
    agentId: safeIdentifier(message.agent),
  };
}

/**
 * Convert only a step-finish part and its assistant/session metadata into an
 * event. This function intentionally never reads text, reasoning content,
 * snapshots, tool payloads, session titles, paths, or provider credentials.
 */
export function usageEventFromOpenCodeStepFinish(
  sourceInstance: string,
  session: SessionInfo,
  message: MessageEnvelope,
  part: MessagePart,
  stepFinishCount: number,
  projectId: string,
): usage.UsageEventInput | null {
  if (message.info.role !== "assistant" || part.type !== "step-finish") return null;
  const sourcePartId = safeIdentifier(part.id);
  const sourceSessionId = safeIdentifier(session.id);
  const sourceMessageId = safeIdentifier(message.info.id);
  const sourceProjectId = safeIdentifier(session.projectID);
  if (!sourcePartId || !sourceSessionId || !sourceMessageId || !sourceProjectId) return null;
  if (part.sessionID !== session.id || part.messageID !== message.info.id || message.info.sessionID !== session.id) return null;
  const occurredAt = timestampFromEpoch(part.time?.end)
    ?? timestampFromEpoch(message.info.time.completed)
    ?? timestampFromEpoch(message.info.time.created)
    ?? timestampFromEpoch(session.time.updated);
  if (!occurredAt) return null;

  const partTokens = tokenMetadata(part.tokens);
  const messageTokens = tokenMetadata(message.info.tokens);
  const useMessageFallback = stepFinishCount === 1;
  const partCost = nonNegativeNumber(part.cost);
  const messageCost = nonNegativeNumber(message.info.cost);
  const costAmount = partCost ?? (useMessageFallback ? messageCost : null);
  const costStatus: usage.UsageAvailability = costAmount !== null
    ? "known"
    : messageCost !== null
      ? "partial"
      : "unavailable";
  const identity = providerModelAndAgent(message.info, session);
  return {
    projectId,
    sourceInstance,
    sourcePartId,
    sourceSessionId,
    sourceMessageId,
    sourceProjectId,
    providerId: identity.providerId,
    modelId: identity.modelId,
    agentId: identity.agentId,
    status: normalizeStatus(part, message.info),
    occurredAt,
    totalTokens: valueOrFallback(partTokens.totalTokens, messageTokens.totalTokens, useMessageFallback),
    inputTokens: valueOrFallback(partTokens.inputTokens, messageTokens.inputTokens, useMessageFallback),
    outputTokens: valueOrFallback(partTokens.outputTokens, messageTokens.outputTokens, useMessageFallback),
    reasoningTokens: valueOrFallback(partTokens.reasoningTokens, messageTokens.reasoningTokens, useMessageFallback),
    cacheReadTokens: valueOrFallback(partTokens.cacheReadTokens, messageTokens.cacheReadTokens, useMessageFallback),
    cacheWriteTokens: valueOrFallback(partTokens.cacheWriteTokens, messageTokens.cacheWriteTokens, useMessageFallback),
    costAmount,
    costStatus,
  };
}

/** The upstream origin identifies an OpenCode instance without persisting credentials or paths. */
export function getOpenCodeUsageSourceInstance(): string {
  try {
    const url = new URL(config.opencodeUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin === "null") {
      return "opencode:unavailable";
    }
    return url.origin;
  } catch {
    return "opencode:unavailable";
  }
}

function compareSessions(left: Pick<SyncSession, "updatedAt" | "sessionId">, right: Pick<SyncSession, "updatedAt" | "sessionId">): number {
  return left.updatedAt.localeCompare(right.updatedAt) || left.sessionId.localeCompare(right.sessionId);
}

function selectSessionsForSync(sessions: SyncSession[], state: usage.UsageSyncState | null): SyncSession[] {
  const cursorUpdatedAt = state?.cursorUpdatedAt;
  const cursorSessionId = state?.cursorSessionId;
  const lookback = cursorUpdatedAt
    ? new Date(Math.max(0, Date.parse(cursorUpdatedAt) - LOOKBACK_MS)).toISOString()
    : null;
  return sessions
    .filter((candidate) => {
      if (!cursorUpdatedAt || !cursorSessionId) return true;
      return candidate.updatedAt >= lookback!
        || candidate.updatedAt > cursorUpdatedAt
        || (candidate.updatedAt === cursorUpdatedAt && candidate.sessionId > cursorSessionId);
    })
    .sort(compareSessions)
    .slice(0, MAX_SESSIONS_PER_PROJECT);
}

function updateCursor(
  state: usage.UsageSyncState | null,
  session: SyncSession,
  partId: string | null,
): Pick<usage.UsageSyncState, "cursorUpdatedAt" | "cursorSessionId" | "cursorPartId"> {
  const current = state?.cursorUpdatedAt && state.cursorSessionId
    ? { updatedAt: state.cursorUpdatedAt, sessionId: state.cursorSessionId, partId: state.cursorPartId }
    : null;
  if (!current || compareSessions(session, current) > 0) {
    return {
      cursorUpdatedAt: session.updatedAt,
      cursorSessionId: session.sessionId,
      cursorPartId: partId,
    };
  }
  if (compareSessions(session, current) === 0 && partId && (!current.partId || partId > current.partId)) {
    return {
      cursorUpdatedAt: current.updatedAt,
      cursorSessionId: current.sessionId,
      cursorPartId: partId,
    };
  }
  return {
    cursorUpdatedAt: current.updatedAt,
    cursorSessionId: current.sessionId,
    cursorPartId: current.partId,
  };
}

async function processSession(
  sourceInstance: string,
  projectId: string,
  syncSession: SyncSession,
): Promise<ProcessSessionResult> {
  let eventCount = 0;
  let lastPartId: string | null = null;
  let before: string | undefined;
  for (let page = 0; page < MAX_MESSAGE_PAGES_PER_SESSION; page += 1) {
    const result = await opencodeClient.getMessages(syncSession.sessionId, MESSAGE_PAGE_SIZE, before);
    if (isOpenCodeError(result) || !Array.isArray(result)) {
      return { eventCount, lastPartId, errorCode: "OPENCODE_UNAVAILABLE" };
    }
    if (result.length === 0) break;
    for (const message of result) {
      if (message.info.role !== "assistant" || message.info.sessionID !== syncSession.sessionId) continue;
      const stepFinishCount = message.parts.filter((part) => part.type === "step-finish").length;
      if (stepFinishCount === 0) continue;
      for (const part of message.parts) {
        const event = usageEventFromOpenCodeStepFinish(
          sourceInstance,
          syncSession.session,
          message,
          part,
          stepFinishCount,
          projectId,
        );
        if (!event) continue;
        usage.upsertUsageEvent(event);
        eventCount += 1;
        if (!lastPartId || event.sourcePartId > lastPartId) lastPartId = event.sourcePartId;
      }
    }
    if (result.length < MESSAGE_PAGE_SIZE) break;
    const nextBefore = safeIdentifier(result[result.length - 1]?.info?.id);
    if (!nextBefore || nextBefore === before) break;
    before = nextBefore;
  }
  return { eventCount, lastPartId, errorCode: null };
}

function initialResult(sourceInstance: string): UsageSyncResult {
  return {
    sourceInstance,
    projects: [],
    sessionsScanned: 0,
    sessionsQuarantined: 0,
    sessionsSkipped: 0,
    unavailable: false,
    errorCode: null,
    alreadyRunning: false,
  };
}

async function performUsageSync(projectId?: string): Promise<UsageSyncResult> {
  const sourceInstance = getOpenCodeUsageSourceInstance();
  const result = initialResult(sourceInstance);
  const sessionsResult = await opencodeClient.listSessions();
  if (isOpenCodeError(sessionsResult) || !Array.isArray(sessionsResult)) {
    return { ...result, unavailable: true, errorCode: "OPENCODE_UNAVAILABLE" };
  }

  result.sessionsScanned = sessionsResult.length;
  const groups = new Map<string, SyncSession[]>();
  for (const session of sessionsResult) {
    const sessionId = safeIdentifier(session.id);
    const sourceProjectId = safeIdentifier(session.projectID);
    const updatedAt = timestampFromEpoch(session.time?.updated);
    if (!sessionId || !sourceProjectId || !updatedAt) {
      result.sessionsSkipped += 1;
      continue;
    }
    const mapping = usage.getOpenCodeProjectMapping(sourceInstance, sourceProjectId);
    if (!mapping || mapping.status !== "mapped" || !mapping.ingeniumProjectId) {
      usage.quarantineOpenCodeProject(sourceInstance, sourceProjectId, sessionId, updatedAt);
      result.sessionsQuarantined += 1;
      continue;
    }
    if (projectId && mapping.ingeniumProjectId !== projectId) continue;
    const candidate: SyncSession = { session, sessionId, sourceProjectId, updatedAt };
    const group = groups.get(mapping.ingeniumProjectId) ?? [];
    group.push(candidate);
    groups.set(mapping.ingeniumProjectId, group);
  }

  for (const [mappedProjectId, sessions] of groups) {
    const startedAt = now();
    const priorState = usage.getUsageSyncState(sourceInstance, mappedProjectId);
    const selected = selectSessionsForSync(sessions, priorState);
    let cursor = {
      cursorUpdatedAt: priorState?.cursorUpdatedAt ?? null,
      cursorSessionId: priorState?.cursorSessionId ?? null,
      cursorPartId: priorState?.cursorPartId ?? null,
    };
    let processed = 0;
    let eventsUpserted = 0;
    let errorCode: string | null = null;
    for (const session of selected) {
      const processedSession = await processSession(sourceInstance, mappedProjectId, session);
      if (processedSession.errorCode) {
        errorCode = processedSession.errorCode;
        break;
      }
      processed += 1;
      eventsUpserted += processedSession.eventCount;
      cursor = updateCursor({
        sourceInstance,
        projectId: mappedProjectId,
        ...cursor,
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastSuccessfulSyncAt: null,
        lastErrorCode: null,
      }, session, processedSession.lastPartId);
    }
    const completedAt = now();
    usage.saveUsageSyncState({
      sourceInstance,
      projectId: mappedProjectId,
      ...cursor,
      lastSyncStartedAt: startedAt,
      lastSyncCompletedAt: completedAt,
      lastSuccessfulSyncAt: errorCode ? priorState?.lastSuccessfulSyncAt ?? null : completedAt,
      lastErrorCode: errorCode,
    });
    result.projects.push({
      projectId: mappedProjectId,
      sessionsSelected: selected.length,
      sessionsProcessed: processed,
      eventsUpserted,
      errorCode,
    });
  }
  if (result.projects.some((project) => project.errorCode)) result.errorCode = "OPENCODE_UNAVAILABLE";
  return result;
}

export function syncUsageFromOpenCode(options: { projectId?: string } = {}): Promise<UsageSyncResult> {
  if (activeSync) {
    return Promise.resolve({
      ...initialResult(getOpenCodeUsageSourceInstance()),
      alreadyRunning: true,
    });
  }
  activeSync = performUsageSync(options.projectId)
    .catch((error: unknown) => {
      logger.warn(SOURCE, "Usage sync failed", { error: error instanceof Error ? error.name : "unknown" });
      return {
        ...initialResult(getOpenCodeUsageSourceInstance()),
        unavailable: true,
        errorCode: "OPENCODE_UNAVAILABLE",
      };
    })
    .finally(() => {
      activeSync = null;
    });
  return activeSync;
}
