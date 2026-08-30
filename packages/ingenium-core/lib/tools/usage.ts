import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";

export const USAGE_STATUS_VALUES = ["success", "error", "partial", "unknown"] as const;
export const USAGE_AVAILABILITY_VALUES = ["known", "partial", "unavailable"] as const;
export const USAGE_ADVISORY_STATE_VALUES = ["disabled", "unknown", "below", "equal", "above"] as const;
export const USAGE_ATTENTION_STATUS_VALUES = ["active", "resolved"] as const;
export const USAGE_ATTENTION_SEVERITY_VALUES = ["info", "warning", "critical"] as const;
export const USAGE_ATTENTION_FRESHNESS_VALUES = ["disabled", "unknown", "fresh", "stale"] as const;
export const USAGE_ATTENTION_TRANSITION_VALUES = ["opened", "changed", "resolved", "reopened", "ack"] as const;
export const USAGE_ATTENTION_PAGE_MAX = 100;
export const USAGE_EVENT_PAGE_MAX = 200;
export const USAGE_EXPORT_PAGE_MAX = 10_000;
export const USAGE_ADVISORY_THRESHOLD_MAX = Number.MAX_SAFE_INTEGER;

export type UsageStatus = typeof USAGE_STATUS_VALUES[number];
export type UsageAvailability = typeof USAGE_AVAILABILITY_VALUES[number];
export type UsageAdvisoryState = typeof USAGE_ADVISORY_STATE_VALUES[number];
export type UsageAttentionStatus = typeof USAGE_ATTENTION_STATUS_VALUES[number];
export type UsageAttentionSeverity = typeof USAGE_ATTENTION_SEVERITY_VALUES[number];
export type UsageAttentionFreshness = typeof USAGE_ATTENTION_FRESHNESS_VALUES[number];
export type UsageAttentionTransition = typeof USAGE_ATTENTION_TRANSITION_VALUES[number];
export type UsageErrorCode =
  | "INVALID_USAGE_INPUT"
  | "INVALID_USAGE_QUERY"
  | "INVALID_USAGE_THRESHOLD_INPUT"
  | "PROJECT_NOT_FOUND"
  | "MAPPING_OWNED_BY_OTHER_PROJECT"
  | "USAGE_THRESHOLD_REVISION_CONFLICT"
  | "USAGE_ATTENTION_ITEM_NOT_FOUND"
  | "USAGE_ATTENTION_REVISION_CONFLICT";

export class UsageError extends Error {
  constructor(public readonly code: UsageErrorCode, public readonly currentRevision?: number) {
    super(code);
    this.name = "UsageError";
  }
}

export interface UsageEventInput {
  projectId: string;
  sourceInstance: string;
  sourcePartId: string;
  sourceSessionId: string;
  sourceMessageId: string;
  sourceProjectId: string;
  providerId: string | null;
  modelId: string | null;
  agentId: string | null;
  status: UsageStatus;
  occurredAt: string;
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costAmount: number | null;
  costStatus: UsageAvailability;
}

export interface UsageEvent extends UsageEventInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageProjectMapping {
  sourceInstance: string;
  sourceProjectId: string;
  ingeniumProjectId: string | null;
  status: "mapped" | "quarantined";
  firstSeenAt: string;
  lastSeenAt: string;
  lastSourceSessionId: string | null;
  lastSourceSessionUpdatedAt: string | null;
}

export interface UsageSyncState {
  sourceInstance: string;
  projectId: string;
  cursorUpdatedAt: string | null;
  cursorSessionId: string | null;
  cursorPartId: string | null;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorCode: string | null;
}

export interface UsageQuery {
  from: string;
  to: string;
  providerIds?: string[];
  modelIds?: string[];
  agentIds?: string[];
  statuses?: UsageStatus[];
}

export interface UsageCursorPage {
  data: UsageEvent[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export interface UsageMetricValue {
  value: number | null;
  availability: UsageAvailability;
}

export interface UsageMetrics {
  requests: number;
  tokens: {
    total: UsageMetricValue;
    input: UsageMetricValue;
    output: UsageMetricValue;
    reasoning: UsageMetricValue;
  };
  cache: {
    read: UsageMetricValue;
    write: UsageMetricValue;
  };
  cost: UsageMetricValue;
}

export interface UsageDailyRow extends UsageMetrics {
  day: string;
}

export interface UsageBreakdownRow extends UsageMetrics {
  providerId: string | null;
  modelId: string | null;
  agentId: string | null;
}

export interface UsageSummary {
  range: { from: string; to: string };
  totals: UsageMetrics;
  daily: UsageDailyRow[];
  freshness: {
    latestEventAt: string | null;
    lastSyncCompletedAt: string | null;
    lastSuccessfulSyncAt: string | null;
  };
}

/** One nullable, advisory-only threshold configuration per project. */
export interface UsageAdvisoryThresholds {
  requestCount: number | null;
  totalTokens: number | null;
  reportedCostAmount: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  revision: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/** PUT replacement input: every threshold key is required and may be null. */
export interface ReplaceUsageAdvisoryThresholdsInput {
  expectedRevision: number;
  requestCount: number | null;
  totalTokens: number | null;
  reportedCostAmount: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export interface UsageAdvisoryEvaluationQuery {
  from?: string;
  to?: string;
}

export interface UsageAdvisoryRange {
  from: string | null;
  to: string | null;
}

/** Every metric retains a reported subtotal even when its advisory state is unknown. */
export interface UsageAdvisoryMetric {
  observed: number | null;
  threshold: number | null;
  availability: UsageAvailability;
  state: UsageAdvisoryState;
}

export interface UsageAdvisoryEvaluation {
  range: UsageAdvisoryRange;
  generatedAt: string;
  thresholds: UsageAdvisoryThresholds;
  metrics: {
    requestCount: UsageAdvisoryMetric;
    totalTokens: UsageAdvisoryMetric;
    reportedCostAmount: UsageAdvisoryMetric;
    cacheReadTokens: UsageAdvisoryMetric;
    cacheWriteTokens: UsageAdvisoryMetric;
  };
}

export type UsageAttentionMetric =
  | "request_count"
  | "total_tokens"
  | "reported_cost_amount"
  | "cache_read_tokens"
  | "cache_write_tokens";

export interface UsageAttentionItem {
  id: string;
  condition: string;
  metric: UsageAttentionMetric;
  status: UsageAttentionStatus;
  evaluationState: UsageAdvisoryState;
  severity: UsageAttentionSeverity;
  messageCode: string;
  observed: number | null;
  threshold: number | null;
  availability: UsageAvailability;
  freshness: UsageAttentionFreshness;
  range: { from: null; to: null };
  thresholdRevision: number;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  reopenedAt: string | null;
  reopenCount: number;
  lastEvaluatedAt: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface UsageAttentionEvent {
  id: string;
  itemId: string;
  transition: UsageAttentionTransition;
  createdAt: string;
}

export interface UsageAttentionPage {
  data: UsageAttentionItem[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export interface ReconcileUsageAttentionOptions {
  syncIntervalMs: number;
}

export interface UsageAttentionReconciliation {
  evaluatedAt: string;
  items: UsageAttentionItem[];
  transitions: UsageAttentionEvent[];
}

interface UsageAggregateRow {
  request_count: number;
  total_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_amount: number | null;
  total_token_reported_count: number;
  input_token_reported_count: number;
  output_token_reported_count: number;
  reasoning_token_reported_count: number;
  cache_read_reported_count: number;
  cache_write_reported_count: number;
  cost_known_count: number;
  cost_partial_count: number;
}

interface UsageFilterSql {
  where: string;
  params: Array<string | number>;
}

interface UsageCursor {
  occurredAt: string;
  id: string;
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ISO_UTC_SUFFIX = /Z$/;

function now(): string {
  return new Date().toISOString();
}

function requireIdentifier(value: unknown, code: UsageError["code"] = "INVALID_USAGE_INPUT"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || CONTROL_CHARACTER.test(value)) {
    throw new UsageError(code);
  }
  return value;
}

function optionalIdentifier(value: unknown, code: UsageError["code"] = "INVALID_USAGE_INPUT"): string | null {
  if (value === null || value === undefined) return null;
  return requireIdentifier(value, code);
}

function requireUtcTimestamp(value: unknown, code: UsageError["code"] = "INVALID_USAGE_INPUT"): string {
  if (typeof value !== "string" || !ISO_UTC_SUFFIX.test(value)) throw new UsageError(code);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new UsageError(code);
  return new Date(timestamp).toISOString();
}

function optionalNonNegativeInteger(value: unknown, code: UsageErrorCode = "INVALID_USAGE_INPUT"): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > USAGE_ADVISORY_THRESHOLD_MAX) {
    throw new UsageError(code);
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown, code: UsageErrorCode = "INVALID_USAGE_INPUT"): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > USAGE_ADVISORY_THRESHOLD_MAX) {
    throw new UsageError(code);
  }
  return value;
}

function requireUsageStatus(value: unknown): UsageStatus {
  if (!USAGE_STATUS_VALUES.includes(value as UsageStatus)) throw new UsageError("INVALID_USAGE_INPUT");
  return value as UsageStatus;
}

function requireAvailability(value: unknown): UsageAvailability {
  if (!USAGE_AVAILABILITY_VALUES.includes(value as UsageAvailability)) throw new UsageError("INVALID_USAGE_INPUT");
  return value as UsageAvailability;
}

function normalizeUsageEvent(input: UsageEventInput): UsageEventInput {
  const costAmount = optionalNonNegativeNumber(input.costAmount);
  const costStatus = requireAvailability(input.costStatus);
  if ((costStatus === "known") !== (costAmount !== null)) {
    throw new UsageError("INVALID_USAGE_INPUT");
  }
  return {
    projectId: requireIdentifier(input.projectId),
    sourceInstance: requireIdentifier(input.sourceInstance),
    sourcePartId: requireIdentifier(input.sourcePartId),
    sourceSessionId: requireIdentifier(input.sourceSessionId),
    sourceMessageId: requireIdentifier(input.sourceMessageId),
    sourceProjectId: requireIdentifier(input.sourceProjectId),
    providerId: optionalIdentifier(input.providerId),
    modelId: optionalIdentifier(input.modelId),
    agentId: optionalIdentifier(input.agentId),
    status: requireUsageStatus(input.status),
    occurredAt: requireUtcTimestamp(input.occurredAt),
    totalTokens: optionalNonNegativeInteger(input.totalTokens),
    inputTokens: optionalNonNegativeInteger(input.inputTokens),
    outputTokens: optionalNonNegativeInteger(input.outputTokens),
    reasoningTokens: optionalNonNegativeInteger(input.reasoningTokens),
    cacheReadTokens: optionalNonNegativeInteger(input.cacheReadTokens),
    cacheWriteTokens: optionalNonNegativeInteger(input.cacheWriteTokens),
    costAmount,
    costStatus,
  };
}

function assertProjectExists(projectId: string): void {
  const project = getDb().prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId);
  if (!project) throw new UsageError("PROJECT_NOT_FOUND");
}

const ADVISORY_THRESHOLD_FIELDS = [
  "requestCount",
  "totalTokens",
  "reportedCostAmount",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

function defaultUsageAdvisoryThresholds(): UsageAdvisoryThresholds {
  return {
    requestCount: null,
    totalTokens: null,
    reportedCostAmount: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    revision: 1,
    createdAt: null,
    updatedAt: null,
  };
}

function readUsageAdvisoryThresholds(row: any): UsageAdvisoryThresholds {
  return {
    requestCount: row.request_count,
    totalTokens: row.total_tokens,
    reportedCostAmount: row.reported_cost_amount,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function existingUsageAdvisoryThresholds(projectId: string): UsageAdvisoryThresholds | null {
  const row = getDb().prepare(
    "SELECT * FROM usage_advisory_thresholds WHERE project_id = ?",
  ).get(projectId);
  return row ? readUsageAdvisoryThresholds(row) : null;
}

function normalizeUsageAdvisoryThresholdReplacement(input: ReplaceUsageAdvisoryThresholdsInput): ReplaceUsageAdvisoryThresholdsInput {
  if (!input || typeof input !== "object" || ADVISORY_THRESHOLD_FIELDS.some((field) => !(field in input))) {
    throw new UsageError("INVALID_USAGE_THRESHOLD_INPUT");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new UsageError("INVALID_USAGE_THRESHOLD_INPUT");
  }
  return {
    expectedRevision: input.expectedRevision,
    requestCount: optionalNonNegativeInteger(input.requestCount, "INVALID_USAGE_THRESHOLD_INPUT"),
    totalTokens: optionalNonNegativeInteger(input.totalTokens, "INVALID_USAGE_THRESHOLD_INPUT"),
    reportedCostAmount: optionalNonNegativeNumber(input.reportedCostAmount, "INVALID_USAGE_THRESHOLD_INPUT"),
    cacheReadTokens: optionalNonNegativeInteger(input.cacheReadTokens, "INVALID_USAGE_THRESHOLD_INPUT"),
    cacheWriteTokens: optionalNonNegativeInteger(input.cacheWriteTokens, "INVALID_USAGE_THRESHOLD_INPUT"),
  };
}

/** Returns the persisted threshold row or the implicit all-null default without writing. */
export function getUsageAdvisoryThresholds(projectId: string): UsageAdvisoryThresholds {
  const normalizedProjectId = requireIdentifier(projectId, "INVALID_USAGE_THRESHOLD_INPUT");
  assertProjectExists(normalizedProjectId);
  return existingUsageAdvisoryThresholds(normalizedProjectId) ?? defaultUsageAdvisoryThresholds();
}

/**
 * Replaces every threshold field. The all-null implicit default is revision 1;
 * a successful first replacement therefore returns revision 2.
 */
export function replaceUsageAdvisoryThresholds(
  projectId: string,
  input: ReplaceUsageAdvisoryThresholdsInput,
): UsageAdvisoryThresholds {
  const normalizedProjectId = requireIdentifier(projectId, "INVALID_USAGE_THRESHOLD_INPUT");
  const replacement = normalizeUsageAdvisoryThresholdReplacement(input);
  const result = execTransaction(() => {
    assertProjectExists(normalizedProjectId);
    const existing = existingUsageAdvisoryThresholds(normalizedProjectId);
    const currentRevision = existing?.revision ?? 1;
    if (currentRevision !== replacement.expectedRevision) {
      throw new UsageError("USAGE_THRESHOLD_REVISION_CONFLICT", currentRevision);
    }
    const timestamp = now();
    if (existing) {
      const update = getDb().prepare(
        `UPDATE usage_advisory_thresholds SET
          request_count = ?, total_tokens = ?, reported_cost_amount = ?,
          cache_read_tokens = ?, cache_write_tokens = ?, revision = revision + 1, updated_at = ?
         WHERE project_id = ? AND revision = ?`,
      ).run(
        replacement.requestCount,
        replacement.totalTokens,
        replacement.reportedCostAmount,
        replacement.cacheReadTokens,
        replacement.cacheWriteTokens,
        timestamp,
        normalizedProjectId,
        replacement.expectedRevision,
      );
      if (update.changes === 0) {
        const current = existingUsageAdvisoryThresholds(normalizedProjectId);
        if (!current) throw new UsageError("PROJECT_NOT_FOUND");
        throw new UsageError("USAGE_THRESHOLD_REVISION_CONFLICT", current.revision);
      }
    } else {
      getDb().prepare(
        `INSERT INTO usage_advisory_thresholds (
          project_id, request_count, total_tokens, reported_cost_amount,
          cache_read_tokens, cache_write_tokens, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 2, ?, ?)`,
      ).run(
        normalizedProjectId,
        replacement.requestCount,
        replacement.totalTokens,
        replacement.reportedCostAmount,
        replacement.cacheReadTokens,
        replacement.cacheWriteTokens,
        timestamp,
        timestamp,
      );
    }
    const updated = existingUsageAdvisoryThresholds(normalizedProjectId);
    if (!updated) throw new Error("Usage advisory threshold update failed");
    return updated;
  });
  checkpointAfterWrite();
  return result;
}

function normalizeUsageAdvisoryRange(query: UsageAdvisoryEvaluationQuery): UsageAdvisoryRange {
  const { from, to } = query;
  if (from === undefined && to === undefined) return { from: null, to: null };
  if (from === undefined || to === undefined) throw new UsageError("INVALID_USAGE_QUERY");
  const normalizedFrom = requireUtcTimestamp(from, "INVALID_USAGE_QUERY");
  const normalizedTo = requireUtcTimestamp(to, "INVALID_USAGE_QUERY");
  if (normalizedFrom >= normalizedTo) throw new UsageError("INVALID_USAGE_QUERY");
  return { from: normalizedFrom, to: normalizedTo };
}

function readMapping(row: any): UsageProjectMapping {
  return {
    sourceInstance: row.source_instance,
    sourceProjectId: row.source_project_id,
    ingeniumProjectId: row.ingenium_project_id,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastSourceSessionId: row.last_source_session_id,
    lastSourceSessionUpdatedAt: row.last_source_session_updated_at,
  };
}

function readSyncState(row: any): UsageSyncState {
  return {
    sourceInstance: row.source_instance,
    projectId: row.project_id,
    cursorUpdatedAt: row.cursor_updated_at,
    cursorSessionId: row.cursor_session_id,
    cursorPartId: row.cursor_part_id,
    lastSyncStartedAt: row.last_sync_started_at,
    lastSyncCompletedAt: row.last_sync_completed_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastErrorCode: row.last_error_code,
  };
}

function readEvent(row: any): UsageEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceInstance: row.source_instance,
    sourcePartId: row.source_part_id,
    sourceSessionId: row.source_session_id,
    sourceMessageId: row.source_message_id,
    sourceProjectId: row.source_project_id,
    providerId: row.provider_id,
    modelId: row.model_id,
    agentId: row.agent_id,
    status: row.status,
    occurredAt: row.occurred_at,
    totalTokens: row.total_tokens,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    costAmount: row.cost_amount,
    costStatus: row.cost_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOpenCodeProject(
  sourceInstance: string,
  sourceProjectId: string,
  ingeniumProjectId: string,
): UsageProjectMapping {
  const normalizedSourceInstance = requireIdentifier(sourceInstance);
  const normalizedSourceProjectId = requireIdentifier(sourceProjectId);
  const normalizedProjectId = requireIdentifier(ingeniumProjectId);
  assertProjectExists(normalizedProjectId);
  const timestamp = now();
  const result = execTransaction(() => {
    const existing = getDb().prepare(
      `SELECT ingenium_project_id, status FROM usage_project_mappings
       WHERE source_instance = ? AND source_project_id = ?`,
    ).get(normalizedSourceInstance, normalizedSourceProjectId) as {
      ingenium_project_id: string | null;
      status: string;
    } | undefined;
    if (existing?.status === "mapped" && existing.ingenium_project_id !== normalizedProjectId) {
      throw new UsageError("MAPPING_OWNED_BY_OTHER_PROJECT");
    }
    getDb().prepare(
      `INSERT INTO usage_project_mappings (
        source_instance, source_project_id, ingenium_project_id, status,
        first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, 'mapped', ?, ?)
      ON CONFLICT(source_instance, source_project_id) DO UPDATE SET
        ingenium_project_id = excluded.ingenium_project_id,
        status = 'mapped',
        last_seen_at = excluded.last_seen_at`,
    ).run(
      normalizedSourceInstance,
      normalizedSourceProjectId,
      normalizedProjectId,
      timestamp,
      timestamp,
    );
    return getDb().prepare(
      `SELECT * FROM usage_project_mappings
       WHERE source_instance = ? AND source_project_id = ?`,
    ).get(normalizedSourceInstance, normalizedSourceProjectId);
  });
  checkpointAfterWrite();
  return readMapping(result);
}

/** Record an unmapped OpenCode project without assigning it to global-default. */
export function quarantineOpenCodeProject(
  sourceInstance: string,
  sourceProjectId: string,
  sourceSessionId: string,
  sourceSessionUpdatedAt: string,
): UsageProjectMapping {
  const normalizedSourceInstance = requireIdentifier(sourceInstance);
  const normalizedSourceProjectId = requireIdentifier(sourceProjectId);
  const normalizedSessionId = requireIdentifier(sourceSessionId);
  const normalizedUpdatedAt = requireUtcTimestamp(sourceSessionUpdatedAt);
  const timestamp = now();
  const result = execTransaction(() => {
    getDb().prepare(
      `INSERT INTO usage_project_mappings (
        source_instance, source_project_id, ingenium_project_id, status,
        first_seen_at, last_seen_at, last_source_session_id, last_source_session_updated_at
      ) VALUES (?, ?, NULL, 'quarantined', ?, ?, ?, ?)
      ON CONFLICT(source_instance, source_project_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        last_source_session_id = excluded.last_source_session_id,
        last_source_session_updated_at = excluded.last_source_session_updated_at`,
    ).run(
      normalizedSourceInstance,
      normalizedSourceProjectId,
      timestamp,
      timestamp,
      normalizedSessionId,
      normalizedUpdatedAt,
    );
    return getDb().prepare(
      `SELECT * FROM usage_project_mappings
       WHERE source_instance = ? AND source_project_id = ?`,
    ).get(normalizedSourceInstance, normalizedSourceProjectId);
  });
  checkpointAfterWrite();
  return readMapping(result);
}

export function getOpenCodeProjectMapping(sourceInstance: string, sourceProjectId: string): UsageProjectMapping | null {
  const row = getDb().prepare(
    `SELECT * FROM usage_project_mappings
     WHERE source_instance = ? AND source_project_id = ?`,
  ).get(requireIdentifier(sourceInstance), requireIdentifier(sourceProjectId));
  return row ? readMapping(row) : null;
}

export function listOpenCodeProjectMappings(projectId: string): UsageProjectMapping[] {
  const normalizedProjectId = requireIdentifier(projectId);
  assertProjectExists(normalizedProjectId);
  return getDb().prepare(
    `SELECT * FROM usage_project_mappings
     WHERE ingenium_project_id = ? AND status = 'mapped'
     ORDER BY source_instance ASC, source_project_id ASC`,
  ).all(normalizedProjectId).map(readMapping);
}

export function upsertUsageEvent(input: UsageEventInput): UsageEvent {
  const event = normalizeUsageEvent(input);
  assertProjectExists(event.projectId);
  const timestamp = now();
  const result = execTransaction(() => {
    const existing = getDb().prepare(
      `SELECT id, created_at FROM usage_events
       WHERE source_instance = ? AND source_part_id = ?`,
    ).get(event.sourceInstance, event.sourcePartId) as { id: string; created_at: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const createdAt = existing?.created_at ?? timestamp;
    getDb().prepare(
      `INSERT INTO usage_events (
        id, project_id, source_instance, source_part_id, source_session_id,
        source_message_id, source_project_id, provider_id, model_id, agent_id, status,
        occurred_at, total_tokens, input_tokens, output_tokens, reasoning_tokens,
        cache_read_tokens, cache_write_tokens, cost_amount, cost_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_instance, source_part_id) DO UPDATE SET
        project_id = excluded.project_id,
        source_session_id = excluded.source_session_id,
        source_message_id = excluded.source_message_id,
        source_project_id = excluded.source_project_id,
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        agent_id = excluded.agent_id,
        status = excluded.status,
        occurred_at = excluded.occurred_at,
        total_tokens = excluded.total_tokens,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        reasoning_tokens = excluded.reasoning_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_write_tokens = excluded.cache_write_tokens,
        cost_amount = excluded.cost_amount,
        cost_status = excluded.cost_status,
        updated_at = excluded.updated_at`,
    ).run(
      id,
      event.projectId,
      event.sourceInstance,
      event.sourcePartId,
      event.sourceSessionId,
      event.sourceMessageId,
      event.sourceProjectId,
      event.providerId,
      event.modelId,
      event.agentId,
      event.status,
      event.occurredAt,
      event.totalTokens,
      event.inputTokens,
      event.outputTokens,
      event.reasoningTokens,
      event.cacheReadTokens,
      event.cacheWriteTokens,
      event.costAmount,
      event.costStatus,
      createdAt,
      timestamp,
    );
    return getDb().prepare("SELECT * FROM usage_events WHERE id = ?").get(id);
  });
  checkpointAfterWrite();
  return readEvent(result);
}

function normalizeQuery(query: UsageQuery): Required<UsageQuery> {
  const from = requireUtcTimestamp(query.from, "INVALID_USAGE_QUERY");
  const to = requireUtcTimestamp(query.to, "INVALID_USAGE_QUERY");
  if (from >= to) throw new UsageError("INVALID_USAGE_QUERY");
  const identifiers = (values: string[] | undefined): string[] => {
    if (!values) return [];
    if (!Array.isArray(values) || values.length > 50) throw new UsageError("INVALID_USAGE_QUERY");
    return [...new Set(values.map((value) => requireIdentifier(value, "INVALID_USAGE_QUERY")))];
  };
  const statuses = query.statuses ?? [];
  if (!Array.isArray(statuses) || statuses.some((status) => !USAGE_STATUS_VALUES.includes(status))) {
    throw new UsageError("INVALID_USAGE_QUERY");
  }
  return {
    from,
    to,
    providerIds: identifiers(query.providerIds),
    modelIds: identifiers(query.modelIds),
    agentIds: identifiers(query.agentIds),
    statuses: [...new Set(statuses)],
  };
}

function filterSql(projectId: string, query: Required<UsageQuery>, cursor?: UsageCursor, order: "asc" | "desc" = "desc"): UsageFilterSql {
  const clauses = ["e.project_id = ?", "e.occurred_at >= ?", "e.occurred_at < ?"];
  const params: Array<string | number> = [requireIdentifier(projectId, "INVALID_USAGE_QUERY"), query.from, query.to];
  const appendValues = (column: string, values: string[]) => {
    if (values.length === 0) return;
    clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
    params.push(...values);
  };
  appendValues("e.provider_id", query.providerIds);
  appendValues("e.model_id", query.modelIds);
  appendValues("e.agent_id", query.agentIds);
  appendValues("e.status", query.statuses);
  if (cursor) {
    clauses.push(order === "desc"
      ? "(e.occurred_at < ? OR (e.occurred_at = ? AND e.id < ?))"
      : "(e.occurred_at > ? OR (e.occurred_at = ? AND e.id > ?))");
    params.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }
  return { where: clauses.join(" AND "), params };
}

function encodeCursor(event: UsageEvent): string {
  return Buffer.from(JSON.stringify({ occurredAt: event.occurredAt, id: event.id }), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): UsageCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return {
      occurredAt: requireUtcTimestamp(parsed?.occurredAt, "INVALID_USAGE_QUERY"),
      id: requireIdentifier(parsed?.id, "INVALID_USAGE_QUERY"),
    };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError("INVALID_USAGE_QUERY");
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function aggregateMetric(value: unknown, reportedCount: unknown, total: number, partialCount = 0): UsageMetricValue {
  const reported = typeof reportedCount === "number" ? reportedCount : 0;
  const amount = numberOrNull(value);
  const availability: UsageAvailability = reported === total && total > 0
    ? "known"
    : reported > 0 || partialCount > 0
      ? "partial"
      : "unavailable";
  return { value: amount, availability };
}

function toMetrics(row: UsageAggregateRow): UsageMetrics {
  const requests = typeof row.request_count === "number" ? row.request_count : 0;
  return {
    requests,
    tokens: {
      total: aggregateMetric(row.total_tokens, row.total_token_reported_count, requests),
      input: aggregateMetric(row.input_tokens, row.input_token_reported_count, requests),
      output: aggregateMetric(row.output_tokens, row.output_token_reported_count, requests),
      reasoning: aggregateMetric(row.reasoning_tokens, row.reasoning_token_reported_count, requests),
    },
    cache: {
      read: aggregateMetric(row.cache_read_tokens, row.cache_read_reported_count, requests),
      write: aggregateMetric(row.cache_write_tokens, row.cache_write_reported_count, requests),
    },
    cost: aggregateMetric(row.cost_amount, row.cost_known_count, requests, row.cost_partial_count),
  };
}

const AGGREGATE_COLUMNS = `
  COUNT(*) AS request_count,
  SUM(e.total_tokens) AS total_tokens,
  SUM(e.input_tokens) AS input_tokens,
  SUM(e.output_tokens) AS output_tokens,
  SUM(e.reasoning_tokens) AS reasoning_tokens,
  SUM(e.cache_read_tokens) AS cache_read_tokens,
  SUM(e.cache_write_tokens) AS cache_write_tokens,
  SUM(e.cost_amount) AS cost_amount,
  SUM(CASE WHEN e.total_tokens IS NOT NULL THEN 1 ELSE 0 END) AS total_token_reported_count,
  SUM(CASE WHEN e.input_tokens IS NOT NULL THEN 1 ELSE 0 END) AS input_token_reported_count,
  SUM(CASE WHEN e.output_tokens IS NOT NULL THEN 1 ELSE 0 END) AS output_token_reported_count,
  SUM(CASE WHEN e.reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END) AS reasoning_token_reported_count,
  SUM(CASE WHEN e.cache_read_tokens IS NOT NULL THEN 1 ELSE 0 END) AS cache_read_reported_count,
  SUM(CASE WHEN e.cache_write_tokens IS NOT NULL THEN 1 ELSE 0 END) AS cache_write_reported_count,
  SUM(CASE WHEN e.cost_status = 'known' THEN 1 ELSE 0 END) AS cost_known_count,
  SUM(CASE WHEN e.cost_status = 'partial' THEN 1 ELSE 0 END) AS cost_partial_count`;

function aggregateUsageMetrics(projectId: string, query?: Required<UsageQuery>): UsageMetrics {
  const filter = query
    ? filterSql(projectId, query)
    : { where: "e.project_id = ?", params: [requireIdentifier(projectId, "INVALID_USAGE_QUERY")] };
  const totals = getDb().prepare(
    `SELECT ${AGGREGATE_COLUMNS} FROM usage_events e WHERE ${filter.where}`,
  ).get(...filter.params) as UsageAggregateRow;
  return toMetrics(totals);
}

function rangeDays(from: string, to: string): string[] {
  const start = new Date(from);
  const end = new Date(to);
  const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const days: string[] = [];
  for (let timestamp = first; timestamp < end.getTime(); timestamp += 86_400_000) {
    if (days.length >= 367) throw new UsageError("INVALID_USAGE_QUERY");
    days.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return days;
}

export function getUsageSummary(projectId: string, query: UsageQuery): UsageSummary {
  const normalizedQuery = normalizeQuery(query);
  assertProjectExists(projectId);
  const filter = filterSql(projectId, normalizedQuery);
  const db = getDb();
  const dailyRows = db.prepare(
    `SELECT substr(e.occurred_at, 1, 10) AS day, ${AGGREGATE_COLUMNS}
     FROM usage_events e WHERE ${filter.where}
     GROUP BY day ORDER BY day ASC`,
  ).all(...filter.params) as Array<UsageAggregateRow & { day: string }>;
  const dailyByDay = new Map(dailyRows.map((row) => [row.day, row]));
  const daily = rangeDays(normalizedQuery.from, normalizedQuery.to).map((day) => ({
    day,
    ...toMetrics(dailyByDay.get(day) ?? {
      request_count: 0,
      total_tokens: null,
      input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      cost_amount: null,
      total_token_reported_count: 0,
      input_token_reported_count: 0,
      output_token_reported_count: 0,
      reasoning_token_reported_count: 0,
      cache_read_reported_count: 0,
      cache_write_reported_count: 0,
      cost_known_count: 0,
      cost_partial_count: 0,
    }),
  }));
  const latestEvent = db.prepare(
    "SELECT MAX(occurred_at) AS latest_event_at FROM usage_events WHERE project_id = ?",
  ).get(requireIdentifier(projectId)) as { latest_event_at: string | null };
  const latestSync = db.prepare(
    `SELECT
       MAX(last_sync_completed_at) AS last_sync_completed_at,
       MAX(last_successful_sync_at) AS last_successful_sync_at
     FROM usage_sync_state WHERE project_id = ?`,
  ).get(requireIdentifier(projectId)) as {
    last_sync_completed_at: string | null;
    last_successful_sync_at: string | null;
  };
  return {
    range: { from: normalizedQuery.from, to: normalizedQuery.to },
    totals: aggregateUsageMetrics(projectId, normalizedQuery),
    daily,
    freshness: {
      latestEventAt: latestEvent.latest_event_at,
      lastSyncCompletedAt: latestSync.last_sync_completed_at,
      lastSuccessfulSyncAt: latestSync.last_successful_sync_at,
    },
  };
}

function advisoryMetric(
  observed: number | null,
  availability: UsageAvailability,
  threshold: number | null,
): UsageAdvisoryMetric {
  if (threshold === null) return { observed, threshold, availability, state: "disabled" };
  if (availability !== "known" || observed === null) {
    return { observed, threshold, availability, state: "unknown" };
  }
  return {
    observed,
    threshold,
    availability,
    state: observed < threshold ? "below" : observed === threshold ? "equal" : "above",
  };
}

/**
 * Evaluates thresholds without mutating configuration, telemetry, sync state, or
 * request routing. A null range is an explicit all-history aggregate.
 */
export function evaluateUsageAdvisoryThresholds(
  projectId: string,
  query: UsageAdvisoryEvaluationQuery = {},
): UsageAdvisoryEvaluation {
  const normalizedProjectId = requireIdentifier(projectId, "INVALID_USAGE_QUERY");
  const range = normalizeUsageAdvisoryRange(query);
  assertProjectExists(normalizedProjectId);
  const normalizedQuery = range.from === null || range.to === null
    ? undefined
    : normalizeQuery({ from: range.from, to: range.to });
  const totals = aggregateUsageMetrics(normalizedProjectId, normalizedQuery);
  // Do not call getUsageAdvisoryThresholds here: evaluation must remain read-only.
  const thresholds = existingUsageAdvisoryThresholds(normalizedProjectId) ?? defaultUsageAdvisoryThresholds();
  return {
    range,
    generatedAt: now(),
    thresholds,
    metrics: {
      requestCount: advisoryMetric(totals.requests, "known", thresholds.requestCount),
      totalTokens: advisoryMetric(totals.tokens.total.value, totals.tokens.total.availability, thresholds.totalTokens),
      reportedCostAmount: advisoryMetric(totals.cost.value, totals.cost.availability, thresholds.reportedCostAmount),
      cacheReadTokens: advisoryMetric(totals.cache.read.value, totals.cache.read.availability, thresholds.cacheReadTokens),
      cacheWriteTokens: advisoryMetric(totals.cache.write.value, totals.cache.write.availability, thresholds.cacheWriteTokens),
    },
  };
}

interface UsageAttentionDefinition {
  metric: UsageAttentionMetric;
  condition: string;
}

interface UsageAttentionCursor {
  updatedAt: string;
  id: string;
}

const USAGE_ATTENTION_DEFINITIONS: readonly UsageAttentionDefinition[] = [
  { metric: "request_count", condition: "usage.advisory:v1:all-history:request_count" },
  { metric: "total_tokens", condition: "usage.advisory:v1:all-history:total_tokens" },
  { metric: "reported_cost_amount", condition: "usage.advisory:v1:all-history:reported_cost_amount" },
  { metric: "cache_read_tokens", condition: "usage.advisory:v1:all-history:cache_read_tokens" },
  { metric: "cache_write_tokens", condition: "usage.advisory:v1:all-history:cache_write_tokens" },
];

const USAGE_ATTENTION_METADATA: Record<UsageAdvisoryState, {
  status: UsageAttentionStatus;
  severity: UsageAttentionSeverity;
  messageCode: string;
}> = {
  disabled: { status: "resolved", severity: "info", messageCode: "USAGE_ADVISORY_DISABLED" },
  unknown: { status: "active", severity: "info", messageCode: "USAGE_ADVISORY_UNKNOWN" },
  below: { status: "resolved", severity: "info", messageCode: "USAGE_ADVISORY_BELOW" },
  equal: { status: "active", severity: "warning", messageCode: "USAGE_ADVISORY_EQUAL" },
  above: { status: "active", severity: "critical", messageCode: "USAGE_ADVISORY_ABOVE" },
};

function readUsageAttentionItem(row: any): UsageAttentionItem {
  return {
    id: row.id,
    condition: row.condition,
    metric: row.metric as UsageAttentionMetric,
    status: row.status,
    evaluationState: row.evaluation_state,
    severity: row.severity,
    messageCode: row.message_code,
    observed: row.observed,
    threshold: row.threshold,
    availability: row.availability,
    freshness: row.freshness,
    range: { from: null, to: null },
    thresholdRevision: row.threshold_revision,
    openedAt: row.opened_at,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    reopenedAt: row.reopened_at,
    reopenCount: row.reopen_count,
    lastEvaluatedAt: row.last_evaluated_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function attentionMetric(
  evaluation: UsageAdvisoryEvaluation,
  metric: UsageAttentionMetric,
): UsageAdvisoryMetric {
  switch (metric) {
    case "request_count": return evaluation.metrics.requestCount;
    case "total_tokens": return evaluation.metrics.totalTokens;
    case "reported_cost_amount": return evaluation.metrics.reportedCostAmount;
    case "cache_read_tokens": return evaluation.metrics.cacheReadTokens;
    case "cache_write_tokens": return evaluation.metrics.cacheWriteTokens;
  }
}

function requireUsageAttentionSyncInterval(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new UsageError("INVALID_USAGE_INPUT");
  }
  return value;
}

/**
 * Freshness intentionally uses sync-state success evidence, never usage-event
 * recency. Every mapped source must have a successful sync; any stale source
 * makes the all-history advisory stale.
 */
function usageAttentionFreshness(
  projectId: string,
  syncIntervalMs: number,
  evaluatedAt: string,
): UsageAttentionFreshness {
  if (syncIntervalMs === 0) return "disabled";
  const sources = getDb().prepare(
    `SELECT mapping.source_instance, sync.last_successful_sync_at
     FROM usage_project_mappings mapping
     LEFT JOIN usage_sync_state sync
       ON sync.source_instance = mapping.source_instance AND sync.project_id = mapping.ingenium_project_id
     WHERE mapping.ingenium_project_id = ? AND mapping.status = 'mapped'`,
  ).all(projectId) as Array<{ source_instance: string; last_successful_sync_at: string | null }>;
  if (sources.length === 0) return "unknown";

  const evaluatedMs = Date.parse(evaluatedAt);
  const staleAfterMs = syncIntervalMs > Number.MAX_SAFE_INTEGER / 2
    ? Number.MAX_SAFE_INTEGER
    : syncIntervalMs * 2;
  let stale = false;
  for (const source of sources) {
    const successfulAt = source.last_successful_sync_at;
    const successfulMs = successfulAt === null ? Number.NaN : Date.parse(successfulAt);
    if (!Number.isFinite(successfulMs)) return "unknown";
    if (evaluatedMs - successfulMs > staleAfterMs) stale = true;
  }
  return stale ? "stale" : "fresh";
}

function attentionItemForEvaluation(
  definition: UsageAttentionDefinition,
  metric: UsageAdvisoryMetric,
  thresholdRevision: number,
  freshness: UsageAttentionFreshness,
  timestamp: string,
): UsageAttentionItem {
  const metadata = USAGE_ATTENTION_METADATA[metric.state];
  return {
    id: randomUUID(),
    condition: definition.condition,
    metric: definition.metric,
    status: metadata.status,
    evaluationState: metric.state,
    severity: metadata.severity,
    messageCode: metadata.messageCode,
    observed: metric.observed,
    threshold: metric.threshold,
    availability: metric.availability,
    freshness,
    range: { from: null, to: null },
    thresholdRevision,
    openedAt: timestamp,
    acknowledgedAt: null,
    resolvedAt: null,
    reopenedAt: null,
    reopenCount: 0,
    lastEvaluatedAt: timestamp,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function attentionItemWithLifecycle(
  previous: UsageAttentionItem,
  evaluated: UsageAttentionItem,
  timestamp: string,
): { item: UsageAttentionItem; transition: UsageAttentionTransition | null } {
  const reopening = previous.status === "resolved" && evaluated.status === "active";
  const resolving = previous.status === "active" && evaluated.status === "resolved";
  const materialActiveChange = previous.status === "active" && evaluated.status === "active" && (
    previous.evaluationState !== evaluated.evaluationState
    || previous.severity !== evaluated.severity
    || previous.freshness !== evaluated.freshness
    || previous.thresholdRevision !== evaluated.thresholdRevision
  );
  const transition: UsageAttentionTransition | null = reopening
    ? "reopened"
    : resolving
      ? "resolved"
      : materialActiveChange
        ? "changed"
        : null;
  return {
    item: {
      ...evaluated,
      id: previous.id,
      openedAt: previous.openedAt,
      acknowledgedAt: reopening || materialActiveChange ? null : previous.acknowledgedAt,
      resolvedAt: evaluated.status === "resolved"
        ? previous.status === "resolved" ? previous.resolvedAt : timestamp
        : null,
      reopenedAt: reopening ? timestamp : previous.reopenedAt,
      reopenCount: reopening ? previous.reopenCount + 1 : previous.reopenCount,
      revision: previous.revision + 1,
      createdAt: previous.createdAt,
      updatedAt: timestamp,
    },
    transition,
  };
}

function insertUsageAttentionItem(projectId: string, item: UsageAttentionItem): void {
  getDb().prepare(
    `INSERT INTO usage_attention_items (
      id, project_id, condition, metric, status, evaluation_state, severity, message_code,
      observed, threshold, availability, freshness, range_from, range_to, threshold_revision,
      opened_at, acknowledged_at, resolved_at, reopened_at, reopen_count, last_evaluated_at,
      revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id, projectId, item.condition, item.metric, item.status, item.evaluationState, item.severity, item.messageCode,
    item.observed, item.threshold, item.availability, item.freshness, item.thresholdRevision,
    item.openedAt, item.acknowledgedAt, item.resolvedAt, item.reopenedAt, item.reopenCount, item.lastEvaluatedAt,
    item.revision, item.createdAt, item.updatedAt,
  );
}

function updateUsageAttentionItem(
  projectId: string,
  previousRevision: number,
  item: UsageAttentionItem,
): void {
  const update = getDb().prepare(
    `UPDATE usage_attention_items SET
      status = ?, evaluation_state = ?, severity = ?, message_code = ?, observed = ?, threshold = ?,
      availability = ?, freshness = ?, range_from = NULL, range_to = NULL, threshold_revision = ?,
      acknowledged_at = ?, resolved_at = ?, reopened_at = ?, reopen_count = ?, last_evaluated_at = ?,
      revision = ?, updated_at = ?
     WHERE project_id = ? AND id = ? AND revision = ?`,
  ).run(
    item.status, item.evaluationState, item.severity, item.messageCode, item.observed, item.threshold,
    item.availability, item.freshness, item.thresholdRevision, item.acknowledgedAt, item.resolvedAt,
    item.reopenedAt, item.reopenCount, item.lastEvaluatedAt, item.revision, item.updatedAt,
    projectId, item.id, previousRevision,
  );
  if (update.changes !== 1) throw new UsageError("USAGE_ATTENTION_REVISION_CONFLICT", previousRevision);
}

function insertUsageAttentionEvent(
  projectId: string,
  transition: UsageAttentionTransition,
  previous: UsageAttentionItem | null,
  current: UsageAttentionItem,
  createdAt: string,
): UsageAttentionEvent {
  const id = randomUUID();
  getDb().prepare(
    `INSERT INTO usage_attention_events (
      id, project_id, item_id, transition,
      prior_status, current_status, prior_evaluation_state, current_evaluation_state,
      prior_severity, current_severity, prior_message_code, current_message_code,
      prior_observed, current_observed, prior_threshold, current_threshold,
      prior_availability, current_availability, prior_freshness, current_freshness,
      prior_threshold_revision, current_threshold_revision,
      prior_last_evaluated_at, current_last_evaluated_at,
      prior_acknowledged_at, current_acknowledged_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, projectId, current.id, transition,
    previous?.status ?? null, current.status,
    previous?.evaluationState ?? null, current.evaluationState,
    previous?.severity ?? null, current.severity,
    previous?.messageCode ?? null, current.messageCode,
    previous?.observed ?? null, current.observed,
    previous?.threshold ?? null, current.threshold,
    previous?.availability ?? null, current.availability,
    previous?.freshness ?? null, current.freshness,
    previous?.thresholdRevision ?? null, current.thresholdRevision,
    previous?.lastEvaluatedAt ?? null, current.lastEvaluatedAt,
    previous?.acknowledgedAt ?? null, current.acknowledgedAt,
    createdAt,
  );
  return { id, itemId: current.id, transition, createdAt };
}

/** Reconcile the five fixed all-history conditions in one transaction. */
export function reconcileUsageAttention(
  projectId: string,
  options: ReconcileUsageAttentionOptions,
): UsageAttentionReconciliation {
  const normalizedProjectId = requireIdentifier(projectId, "INVALID_USAGE_INPUT");
  const syncIntervalMs = requireUsageAttentionSyncInterval(options?.syncIntervalMs);
  const result = execTransaction(() => {
    assertProjectExists(normalizedProjectId);
    const evaluation = evaluateUsageAdvisoryThresholds(normalizedProjectId);
    const evaluatedAt = now();
    const freshness = usageAttentionFreshness(normalizedProjectId, syncIntervalMs, evaluatedAt);
    const items: UsageAttentionItem[] = [];
    const transitions: UsageAttentionEvent[] = [];

    for (const definition of USAGE_ATTENTION_DEFINITIONS) {
      const evaluated = attentionItemForEvaluation(
        definition,
        attentionMetric(evaluation, definition.metric),
        evaluation.thresholds.revision,
        freshness,
        evaluatedAt,
      );
      const row = getDb().prepare(
        "SELECT * FROM usage_attention_items WHERE project_id = ? AND condition = ?",
      ).get(normalizedProjectId, definition.condition);
      const previous = row ? readUsageAttentionItem(row) : null;

      // Disabled and below conditions are not attention until they have an
      // existing lifecycle to resolve.
      if (!previous && evaluated.status === "resolved") continue;
      if (!previous) {
        insertUsageAttentionItem(normalizedProjectId, evaluated);
        transitions.push(insertUsageAttentionEvent(normalizedProjectId, "opened", null, evaluated, evaluatedAt));
        items.push(evaluated);
        continue;
      }

      const reconciled = attentionItemWithLifecycle(previous, evaluated, evaluatedAt);
      updateUsageAttentionItem(normalizedProjectId, previous.revision, reconciled.item);
      if (reconciled.transition) {
        transitions.push(insertUsageAttentionEvent(
          normalizedProjectId,
          reconciled.transition,
          previous,
          reconciled.item,
          evaluatedAt,
        ));
      }
      items.push(reconciled.item);
    }
    return { evaluatedAt, items, transitions, written: items.length > 0 };
  });
  if (result.written) checkpointAfterWrite();
  return { evaluatedAt: result.evaluatedAt, items: result.items, transitions: result.transitions };
}

export function getUsageAttentionItem(projectId: string, itemId: string): UsageAttentionItem | null {
  const row = getDb().prepare(
    "SELECT * FROM usage_attention_items WHERE project_id = ? AND id = ?",
  ).get(requireIdentifier(projectId, "INVALID_USAGE_QUERY"), requireIdentifier(itemId, "INVALID_USAGE_QUERY"));
  return row ? readUsageAttentionItem(row) : null;
}

function encodeUsageAttentionCursor(item: UsageAttentionItem): string {
  return Buffer.from(JSON.stringify({ updatedAt: item.updatedAt, id: item.id }), "utf8").toString("base64url");
}

function decodeUsageAttentionCursor(value: string | undefined): UsageAttentionCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return {
      updatedAt: requireUtcTimestamp(parsed?.updatedAt, "INVALID_USAGE_QUERY"),
      id: requireIdentifier(parsed?.id, "INVALID_USAGE_QUERY"),
    };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError("INVALID_USAGE_QUERY");
  }
}

export function listUsageAttentionItems(
  projectId: string,
  options: { includeResolved?: boolean; limit?: number; cursor?: string } = {},
): UsageAttentionPage {
  const normalizedProjectId = requireIdentifier(projectId, "INVALID_USAGE_QUERY");
  assertProjectExists(normalizedProjectId);
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > USAGE_ATTENTION_PAGE_MAX) {
    throw new UsageError("INVALID_USAGE_QUERY");
  }
  const cursor = decodeUsageAttentionCursor(options.cursor);
  const clauses = ["project_id = ?"];
  const params: Array<string | number> = [normalizedProjectId];
  if (!options.includeResolved) clauses.push("status = 'active'");
  if (cursor) {
    clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  const where = clauses.join(" AND ");
  const rows = getDb().prepare(
    `SELECT * FROM usage_attention_items WHERE ${where}
     ORDER BY updated_at DESC, id DESC LIMIT ?`,
  ).all(...params, limit + 1).map(readUsageAttentionItem);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const countClauses = ["project_id = ?"];
  if (!options.includeResolved) countClauses.push("status = 'active'");
  const total = (getDb().prepare(
    `SELECT COUNT(*) AS count FROM usage_attention_items WHERE ${countClauses.join(" AND ")}`,
  ).get(normalizedProjectId) as { count: number }).count;
  return {
    data,
    nextCursor: hasMore && data.length > 0 ? encodeUsageAttentionCursor(data[data.length - 1]!) : null,
    hasMore,
    total,
  };
}

/** Active mapped projects are the scheduler's only automatic evaluation scope. */
export function listUsageAttentionMappedProjectIds(): string[] {
  return (getDb().prepare(
    `SELECT DISTINCT mapping.ingenium_project_id AS project_id
     FROM usage_project_mappings mapping
     JOIN projects project ON project.id = mapping.ingenium_project_id
     WHERE mapping.status = 'mapped'
       AND mapping.ingenium_project_id IS NOT NULL
       AND project.archived_at IS NULL
     ORDER BY mapping.ingenium_project_id ASC`,
  ).all() as Array<{ project_id: string }>).map((row) => row.project_id);
}

/** Acknowledge an item with revision CAS; exact retry replays return the prior result. */
export function acknowledgeUsageAttentionItem(
  projectId: string,
  itemId: string,
  expectedRevision: number,
): UsageAttentionItem {
  const normalizedProjectId = requireIdentifier(projectId, "INVALID_USAGE_INPUT");
  const normalizedItemId = requireIdentifier(itemId, "INVALID_USAGE_INPUT");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new UsageError("INVALID_USAGE_INPUT");
  }
  const result = execTransaction(() => {
    assertProjectExists(normalizedProjectId);
    const row = getDb().prepare(
      "SELECT * FROM usage_attention_items WHERE project_id = ? AND id = ?",
    ).get(normalizedProjectId, normalizedItemId);
    if (!row) throw new UsageError("USAGE_ATTENTION_ITEM_NOT_FOUND");
    const previous = readUsageAttentionItem(row);

    if (previous.revision !== expectedRevision) {
      if (previous.acknowledgedAt !== null && previous.revision === expectedRevision + 1) {
        return { item: previous, written: false };
      }
      throw new UsageError("USAGE_ATTENTION_REVISION_CONFLICT", previous.revision);
    }
    if (previous.acknowledgedAt !== null) return { item: previous, written: false };

    const acknowledgedAt = now();
    const acknowledged: UsageAttentionItem = {
      ...previous,
      acknowledgedAt,
      revision: previous.revision + 1,
      updatedAt: acknowledgedAt,
    };
    updateUsageAttentionItem(normalizedProjectId, previous.revision, acknowledged);
    insertUsageAttentionEvent(normalizedProjectId, "ack", previous, acknowledged, acknowledgedAt);
    return { item: acknowledged, written: true };
  });
  if (result.written) checkpointAfterWrite();
  return result.item;
}

export function getUsageBreakdown(projectId: string, query: UsageQuery): UsageBreakdownRow[] {
  const normalizedQuery = normalizeQuery(query);
  assertProjectExists(projectId);
  const filter = filterSql(projectId, normalizedQuery);
  const rows = getDb().prepare(
    `SELECT e.provider_id, e.model_id, e.agent_id, ${AGGREGATE_COLUMNS}
     FROM usage_events e WHERE ${filter.where}
     GROUP BY e.provider_id, e.model_id, e.agent_id
     ORDER BY e.provider_id ASC, e.model_id ASC, e.agent_id ASC`,
  ).all(...filter.params) as Array<UsageAggregateRow & {
    provider_id: string | null;
    model_id: string | null;
    agent_id: string | null;
  }>;
  return rows.map((row) => ({
    providerId: row.provider_id,
    modelId: row.model_id,
    agentId: row.agent_id,
    ...toMetrics(row),
  }));
}

export function listUsageEvents(
  projectId: string,
  query: UsageQuery,
  options: { limit?: number; cursor?: string; order?: "asc" | "desc" } = {},
): UsageCursorPage {
  const normalizedQuery = normalizeQuery(query);
  assertProjectExists(projectId);
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > USAGE_EVENT_PAGE_MAX) {
    throw new UsageError("INVALID_USAGE_QUERY");
  }
  const order = options.order ?? "desc";
  const filter = filterSql(projectId, normalizedQuery, decodeCursor(options.cursor), order);
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM usage_events e WHERE ${filter.where}
     ORDER BY e.occurred_at ${order.toUpperCase()}, e.id ${order.toUpperCase()}
     LIMIT ?`,
  ).all(...filter.params, limit + 1).map(readEvent);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const total = (db.prepare(
    `SELECT COUNT(*) AS count FROM usage_events e WHERE ${filterSql(projectId, normalizedQuery).where}`,
  ).get(...filterSql(projectId, normalizedQuery).params) as { count: number }).count;
  return {
    data,
    nextCursor: hasMore && data.length > 0 ? encodeCursor(data[data.length - 1]!) : null,
    hasMore,
    total,
  };
}

export function getUsageExportPage(
  projectId: string,
  query: UsageQuery,
  options: { limit?: number; cursor?: string } = {},
): UsageCursorPage {
  const limit = options.limit ?? USAGE_EXPORT_PAGE_MAX;
  if (!Number.isInteger(limit) || limit < 1 || limit > USAGE_EXPORT_PAGE_MAX) {
    throw new UsageError("INVALID_USAGE_QUERY");
  }
  const normalizedQuery = normalizeQuery(query);
  assertProjectExists(projectId);
  const filter = filterSql(projectId, normalizedQuery, decodeCursor(options.cursor), "asc");
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM usage_events e WHERE ${filter.where}
     ORDER BY e.occurred_at ASC, e.id ASC LIMIT ?`,
  ).all(...filter.params, limit + 1).map(readEvent);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const total = (db.prepare(
    `SELECT COUNT(*) AS count FROM usage_events e WHERE ${filterSql(projectId, normalizedQuery).where}`,
  ).get(...filterSql(projectId, normalizedQuery).params) as { count: number }).count;
  return {
    data,
    nextCursor: hasMore && data.length > 0 ? encodeCursor(data[data.length - 1]!) : null,
    hasMore,
    total,
  };
}

export function getUsageSyncState(sourceInstance: string, projectId: string): UsageSyncState | null {
  const row = getDb().prepare(
    `SELECT * FROM usage_sync_state WHERE source_instance = ? AND project_id = ?`,
  ).get(requireIdentifier(sourceInstance), requireIdentifier(projectId));
  return row ? readSyncState(row) : null;
}

export function saveUsageSyncState(state: UsageSyncState): UsageSyncState {
  const sourceInstance = requireIdentifier(state.sourceInstance);
  const projectId = requireIdentifier(state.projectId);
  assertProjectExists(projectId);
  const cursorUpdatedAt = state.cursorUpdatedAt === null ? null : requireUtcTimestamp(state.cursorUpdatedAt);
  const lastSyncStartedAt = state.lastSyncStartedAt === null ? null : requireUtcTimestamp(state.lastSyncStartedAt);
  const lastSyncCompletedAt = state.lastSyncCompletedAt === null ? null : requireUtcTimestamp(state.lastSyncCompletedAt);
  const lastSuccessfulSyncAt = state.lastSuccessfulSyncAt === null ? null : requireUtcTimestamp(state.lastSuccessfulSyncAt);
  const cursorSessionId = optionalIdentifier(state.cursorSessionId);
  const cursorPartId = optionalIdentifier(state.cursorPartId);
  const lastErrorCode = state.lastErrorCode === null ? null : requireIdentifier(state.lastErrorCode);
  const result = execTransaction(() => {
    getDb().prepare(
      `INSERT INTO usage_sync_state (
        source_instance, project_id, cursor_updated_at, cursor_session_id, cursor_part_id,
        last_sync_started_at, last_sync_completed_at, last_successful_sync_at, last_error_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_instance, project_id) DO UPDATE SET
        cursor_updated_at = excluded.cursor_updated_at,
        cursor_session_id = excluded.cursor_session_id,
        cursor_part_id = excluded.cursor_part_id,
        last_sync_started_at = excluded.last_sync_started_at,
        last_sync_completed_at = excluded.last_sync_completed_at,
        last_successful_sync_at = excluded.last_successful_sync_at,
        last_error_code = excluded.last_error_code`,
    ).run(
      sourceInstance,
      projectId,
      cursorUpdatedAt,
      cursorSessionId,
      cursorPartId,
      lastSyncStartedAt,
      lastSyncCompletedAt,
      lastSuccessfulSyncAt,
      lastErrorCode,
    );
    return getDb().prepare(
      `SELECT * FROM usage_sync_state WHERE source_instance = ? AND project_id = ?`,
    ).get(sourceInstance, projectId);
  });
  checkpointAfterWrite();
  return readSyncState(result);
}
