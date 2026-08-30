import { z } from "zod";

/**
 * Zod schemas for the Ingenium domain model.
 *
 * NOTE: Zod schemas are NOT the primary runtime enforcement gate (see AGENTS.md rule #13).
 * SQL CHECK constraints in the migration files serve as the actual data integrity layer.
 * These schemas provide TypeScript type inference and API-layer validation.
 *
 * `z.coerce.boolean()` / `z.coerce.number()` are used throughout because SQLite
 * represents booleans as INTEGER 0/1 — without `coerce`, a raw DB row would fail
 * TypeScript-level validation.
 */

/** A workspace project. Supports soft-delete via `archived_at` and cross-project identity via `is_global`. */
export interface Project {
  id: string;
  name: string;
  path?: string;
  archived_at?: string;
  is_global: boolean;
  created_at: string;
  updated_at: string;
  organization_id: string;
}

export interface User {
  id: string;
  email_normalized: string;
  display_name: string;
  status: "active" | "disabled";
  email_verified_at: string | null;
  security_epoch: number;
  created_at: string;
  updated_at: string;
}

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";
export type ProjectRole = "editor" | "viewer";

export interface EffectiveProjectAccess {
  canRead: boolean;
  canWrite: boolean;
}

export interface AuthSession {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_hash: string;
  security_epoch: number;
  device_label: string | null;
  idle_expires_at: string;
  absolute_expires_at: string;
  recent_step_up_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_seen_at: string;
}

export const BootstrapClaimInputSchema = z.object({
  email: z.string().trim().min(3).max(320),
  displayName: z.string().trim().min(1).max(128),
  password: z.string().min(12).max(1024),
}).strict();
export type BootstrapClaimInput = z.infer<typeof BootstrapClaimInputSchema>;

export interface BootstrapStatus {
  state: "pending" | "claimed";
  revision: number;
}

export const SecurityAuditEventInputSchema = z.object({
  actorType: z.enum(["compatibility", "user", "service", "system"]),
  actorId: z.string().min(1).max(128).optional(),
  action: z.string().min(1).max(128),
  organizationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  outcome: z.enum(["success", "denied", "failure"]),
}).strict();
export type SecurityAuditEventInput = z.infer<typeof SecurityAuditEventInputSchema>;

/** A learned or authored skill with full-text content, metadata, and file_tree for disk sync. */
export interface Skill {
  id: string;
  project_id: string;
  name: string;
  description: string;
  content: string;
  category?: string;
  tags?: string;
  always_apply: number;
  file_tree?: string | null;
  enabled: boolean;
  revision: number;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** An immutable snapshot of a skill's complete state at a specific revision. Created automatically by DB triggers. */
export interface SkillVersion {
  id: number;
  skill_id: string;
  revision: number;
  name: string;
  description: string;
  content: string;
  category?: string | null;
  tags?: string | null;
  always_apply: number;
  file_tree?: string | null;
  enabled: boolean;
  archived_at?: string | null;
  created_by: string;
  created_at: string;
}

/** A lineage record mapping a source skill (by project + name) to a canonical target skill. */
export interface SkillLineage {
  id: number;
  project_id: string;
  source_project_id: string;
  source_name: string;
  target_skill_id: string;
  source_hash: string;
  merged_file_paths: string;
  tombstone_path?: string | null;
  reason: string;
  created_at: string;
  updated_at: string;
}

export const SKILL_PROPOSAL_STATUSES = [
  "draft",
  "pending",
  "rejected",
  "applied",
  "rolled_back",
  "stale",
] as const;
export type SkillProposalStatus = typeof SKILL_PROPOSAL_STATUSES[number];

export const SKILL_PROPOSAL_PAGE_VIEWS = ["open", "history"] as const;
export type SkillProposalPageView = typeof SKILL_PROPOSAL_PAGE_VIEWS[number];

export const SKILL_PROPOSAL_PAGE_CURSOR_VERSION = 1 as const;
export const SKILL_PROPOSAL_RETENTION_INDEX = "idx_skill_proposals_project_status_created_id";
export const SKILL_PROPOSAL_RETENTION_DELETE_TRIGGER = "skill_proposals_retain_before_delete";
export const SKILL_PROPOSAL_RETENTION_DELETE_ERROR = "skill proposals are retained";

/** A governance proposal for a skill mutation: create, update, merge, or archive. */
export interface SkillProposal {
  id: string;
  project_id: string;
  status: SkillProposalStatus;
  proposal_type: "create" | "update" | "merge" | "archive";
  target_skill_id?: string | null;
  target_name: string;
  source_project_id?: string | null;
  source_name?: string | null;
  expected_revision?: number | null;
  expected_source_revision?: number | null;
  target_revision_before?: number | null;
  source_revision_before?: number | null;
  target_created: number;
  proposed_state: string;
  evidence_json: string;
  observation_ids: string;
  quality_score: number;
  novelty_score: number;
  contradiction_flag: number;
  candidate_group_key?: string | null;
  reviewer?: string | null;
  review_reason?: string | null;
  always_apply: number;
  created_at: string;
  updated_at: string;
  reviewed_at?: string | null;
  applied_at?: string | null;
  rolled_back_at?: string | null;
}

/** Opaque versioned anchor for proposal keyset pagination. */
export interface SkillProposalPageCursor {
  v: typeof SKILL_PROPOSAL_PAGE_CURSOR_VERSION;
  createdAt: string;
  id: string;
}

/** Bounded proposal-list fields that intentionally exclude payload and review text. */
export interface SkillProposalSummary {
  id: string;
  status: SkillProposalStatus;
  proposal_type: SkillProposal["proposal_type"];
  target_name: string;
  source_name: string | null;
  quality_score: number;
  novelty_score: number;
  created_at: string;
}

export interface SkillProposalPage {
  data: SkillProposalSummary[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface SkillProposalCounts {
  open: number;
  history: number;
  byStatus: {
    draft: number;
    pending: number;
    stale: number;
    rejected: number;
    applied: number;
    rolledBack: number;
  };
}

/** A kanban task with sub-tasking, scheduling, and time-tracking support. */
export interface Task {
  id: string;
  project_id: string;
  organization_id: string;
  owner_kind: "user" | "organization";
  owner_user_id?: string | null;
  visibility: "private" | "organization";
  title: string;
  description?: string;
  column_id: string;
  assigned_to?: string;
  depends_on?: string;
  files?: string;
  labels?: string;
  session_id?: string;
  parent_id?: string | null;
  issue_type: "epic" | "story" | "task" | "subtask";
  priority: number;
  due_date?: string | null;
  start_date?: string | null;
  estimate_minutes?: number | null;
  spent_minutes: number;
  remaining_minutes?: number | null;
  custom_fields?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  revision: number;
  reservation_state: "available" | "reserved" | "quarantined";
  reservation_owner?: string | null;
  reservation_worktree?: string | null;
}

/** Immutable, metadata-only snapshot of a trusted source attached to a task. */
export const TASK_SOURCE_TYPES = ["email", "context", "docs", "chat", "job"] as const;
export type TaskSourceType = typeof TASK_SOURCE_TYPES[number];

export interface TaskSourceReference {
  id: string;
  project_id: string;
  organization_id: string;
  task_id: string;
  source_type: TaskSourceType;
  source_id: string;
  display_title: string;
  display_detail: string | null;
  source_timestamp: string | null;
  created_at: string;
}

/** Client input deliberately excludes all server-derived display metadata. */
const TaskMutationTransportFields = {
  expected_revision: z.number().int().nonnegative().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  idempotency_key: z.string().min(1).max(128).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
};

export const TaskSourceReferenceCreateInputSchema = z.object({
  source_type: z.enum(TASK_SOURCE_TYPES),
  source_id: z.string().min(1).max(512),
  ...TaskMutationTransportFields,
}).strict();
export type TaskSourceReferenceCreateInput = z.infer<typeof TaskSourceReferenceCreateInputSchema>;

/** Shared capture contract. Only a task title and a trusted source identity cross this boundary. */
const TaskCaptureTitleSchema = z.string().trim().min(1).max(256)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Invalid task title");
const TaskCaptureSourceComponentSchema = z.string().min(1).max(256)
  .refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value), "Invalid task source identity");
const TaskCaptureSessionIdSchema = TaskCaptureSourceComponentSchema
  .refine((value) => !/[\\/]/.test(value) && value !== "." && value !== "..", "Invalid task source identity");
const TaskCaptureDocsPageIdSchema = z.number().int().positive().max(999_999_999_999_999);

export const TaskCaptureInputSchema = z.discriminatedUnion("source_type", [
  z.object({
    source_type: z.literal("email"),
    title: TaskCaptureTitleSchema,
    account_id: TaskCaptureSourceComponentSchema,
    folder: TaskCaptureSourceComponentSchema,
    uid: TaskCaptureSourceComponentSchema,
    ...TaskMutationTransportFields,
  }).strict(),
  z.object({
    source_type: z.literal("context"),
    title: TaskCaptureTitleSchema,
    source_id: z.string().uuid(),
    ...TaskMutationTransportFields,
  }).strict(),
  z.object({
    source_type: z.literal("docs"),
    title: TaskCaptureTitleSchema,
    page_id: TaskCaptureDocsPageIdSchema,
    ...TaskMutationTransportFields,
  }).strict(),
  z.object({
    source_type: z.literal("chat"),
    title: TaskCaptureTitleSchema,
    session_id: TaskCaptureSessionIdSchema,
    ...TaskMutationTransportFields,
  }).strict(),
]);
export type TaskCaptureInput = z.infer<typeof TaskCaptureInputSchema>;
export type TaskCaptureSourceType = TaskCaptureInput["source_type"];

/** A threaded comment on a task, with parent_comment_id for nested replies. */
export interface TaskComment {
  id: string;
  task_id: string;
  parent_comment_id?: string | null;
  author: string;
  body: string;
  reactions: string;
  edited_at?: string | null;
  created_at: string;
}

/** An audit event recording state transitions on a task (e.g., column move, assignment change). */
export interface TaskActivity {
  id: string;
  task_id: string;
  actor: string;
  event_type: string;
  payload?: string | null;
  created_at: string;
}

/** A dependency link between two tasks: blocks, blocked_by, or relates_to. */
export interface TaskLink {
  id: string;
  task_id: string;
  linked_task_id: string;
  link_type: "blocks" | "blocked_by" | "relates_to";
}

/** A notification targeting a specific user about a task event (mention, assignment, watch status change). */
export interface TaskNotification {
  id: string;
  project_id: string;
  recipient: string;
  task_id: string;
  kind: "mentioned" | "assigned" | "watched_status";
  read_at?: string | null;
  created_at: string;
}

/** Kanban board layout: column definitions and custom field config stored as JSON strings. */
export interface BoardConfig {
  id: string;
  project_id: string;
  columns: string;
  custom_field_defs: string;
  created_at: string;
  updated_at: string;
}

/** Metadata-only provenance for a job authorization to a vault item. */
export interface JobVaultReference {
  item_id: string;
  authorized_at: string;
  authorized_item_version: number;
  status: "authorized" | "version_stale" | "unavailable";
}

/** A recurring or event-triggered job definition with agent assignment and scheduling config. */
export interface Job {
  id: string;
  project_id: string;
  organization_id: string;
  owner_kind: "user" | "organization";
  owner_user_id?: string | null;
  visibility: "private" | "organization";
  service_principal_id: string;
  name: string;
  description?: string | null;
  agent: string;
  prompt_template: string;
  schedule_cron?: string | null;
  trigger_event?: string | null;
  enabled: boolean;
  timeout_minutes: number;
  revision: number;
  schedule_revision: number;
  vault_references: JobVaultReference[];
  created_at: string;
  updated_at: string;
}

export const MAX_CONCURRENT_AUTOMATION_RUNS = 2;
export const MAX_CONCURRENT_RUNS_PER_ORGANIZATION = 1;
export const MAX_CONCURRENT_RUNS_PER_SERVICE_PRINCIPAL = 1;

/** JOB-100's intentionally small, trusted-only trigger catalog. */
export const TRUSTED_JOB_EVENT_TYPES = [
  "context.conversation.archived",
  "context.conversation.unarchived",
  "context.checkpoint.restored_as_new",
] as const;
export const TrustedJobEventTypeSchema = z.enum(TRUSTED_JOB_EVENT_TYPES);
export type TrustedJobEventType = z.infer<typeof TrustedJobEventTypeSchema>;

export const TRUSTED_JOB_EVENT_SCHEMA_VERSION = 1 as const;
export const TRUSTED_JOB_EVENT_PRODUCER = "context.maintenance" as const;
export const TrustedJobEventProducerSchema = z.literal(TRUSTED_JOB_EVENT_PRODUCER);

const TrustedJobEventIdentifierSchema = z.string().uuid();
const TrustedJobEventRevisionSchema = z.number().int().nonnegative();

export const TrustedJobEventArchivePayloadSchema = z.object({
  conversationId: TrustedJobEventIdentifierSchema,
  expectedRevision: TrustedJobEventRevisionSchema,
  archiveSequence: TrustedJobEventRevisionSchema,
}).strict();
export type TrustedJobEventArchivePayload = z.infer<typeof TrustedJobEventArchivePayloadSchema>;

export const TrustedJobEventRestorePayloadSchema = z.object({
  sourceConversationId: TrustedJobEventIdentifierSchema,
  sourceCheckpointId: TrustedJobEventIdentifierSchema,
  targetConversationId: TrustedJobEventIdentifierSchema,
  expectedRevision: TrustedJobEventRevisionSchema,
}).strict();
export type TrustedJobEventRestorePayload = z.infer<typeof TrustedJobEventRestorePayloadSchema>;

export type TrustedJobEventPayload = TrustedJobEventArchivePayload | TrustedJobEventRestorePayload;

/** Stored trusted event metadata. Payload is parsed against event_type by core tooling. */
export const TrustedJobEventRecordSchema = z.object({
  id: TrustedJobEventIdentifierSchema,
  project_id: TrustedJobEventIdentifierSchema,
  event_type: TrustedJobEventTypeSchema,
  schema_version: z.literal(TRUSTED_JOB_EVENT_SCHEMA_VERSION),
  producer: TrustedJobEventProducerSchema,
  source_audit_event_id: TrustedJobEventIdentifierSchema,
  dedupe_key: TrustedJobEventIdentifierSchema,
  payload: z.string().max(2048),
  created_at: z.string().datetime(),
}).strict();
export type TrustedJobEventRecord = z.infer<typeof TrustedJobEventRecordSchema>;

/** A single execution of a job, tracking its lifecycle from queued through completion or failure. */
export interface JobRun {
  id: string;
  job_id: string;
  project_id: string;
  organization_id: string;
  effective_service_principal_id: string;
  delegator_actor_type?: "compatibility" | "user" | "service" | "system" | null;
  delegator_actor_id?: string | null;
  source_actor_type?: "compatibility" | "user" | "service" | "system" | null;
  source_actor_id?: string | null;
  job_revision: number;
  schedule_revision?: number | null;
  scheduled_for?: string | null;
  authorization_revision: number;
  status: "queued" | "running" | "success" | "failed" | "timeout" | "cancelled";
  trigger: "manual" | "cron" | "event";
  started_at?: string | null;
  finished_at?: string | null;
  exit_code?: number | null;
  created_at: string;
}

/** An individual line of stdout/stderr output from a job run, ordered by sequence number. */
export interface JobRunLog {
  id: number;
  run_id: string;
  seq: number;
  stream: "stdout" | "stderr";
  line: string;
  created_at: string;
}

export type JobEventDeliveryState = "queued" | "leased" | "retry_wait" | "succeeded" | "dead_letter";

/** Credential-free queue view; ownership hashes and process nonces never leave core internals. */
export interface JobEventDelivery {
  id: string;
  trusted_event_id: string;
  event_type: TrustedJobEventType;
  job_id: string;
  job_name: string;
  state: JobEventDeliveryState;
  attempt_count: number;
  next_attempt_at: string | null;
  lease_revision: number;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** Bounded event execution metadata embedded in project-scoped run DTOs. */
export interface JobRunEventMetadata {
  delivery_id: string;
  trusted_event_id: string;
  attempt_number: number;
  delivery_state: JobEventDeliveryState;
}

export interface JobRunWithEventMetadata extends JobRun {
  event_delivery: JobRunEventMetadata | null;
}

/** A contextual memory entry with priority ranking — used by agents to recall past session context. */
export interface ContextEntry {
  id: number;
  project_id: string;
  content: string;
  priority: number;
  tags: string;
  session_id?: string | null;
  source: "manual" | "agent" | "import" | "system";
  metadata: string;
  created_at: string;
  updated_at: string;
}

/** Immutable conversation/checkpoint/message limits enforced by migration 063. */
export const CONTEXT_CONVERSATION_TITLE_MAX_LENGTH = 256;
export const CONTEXT_MESSAGE_CONTENT_MAX_LENGTH = 262_144;
export const CONTEXT_TAGS_MAX_BYTES = 4_096;
export const CONTEXT_METADATA_MAX_BYTES = 16_384;
export const CONTEXT_MAX_TAG_COUNT = 64;
export const CONTEXT_MAX_RAG_SOURCES_PER_CHECKPOINT = 64;
export const CONTEXT_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
/** File-snapshot imports support long histories while retaining a hard request bound. */
export const CONTEXT_SNAPSHOT_MAX_ENTRIES = 10_000;
export const CONTEXT_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
export const CONTEXT_SNAPSHOT_SOURCE_KEY_MAX_LENGTH = 256;
export const CONTEXT_SNAPSHOT_SOURCE_SESSION_MAX_LENGTH = 512;
export const CONTEXT_SNAPSHOT_INPUT_METADATA_MAX_BYTES = 12_288;
/** Response-only timing metadata is coarse and bounded by this maximum. */
export const CONTEXT_SNAPSHOT_TIMING_MAX_MS = 60_000;

/**
 * Convert a monotonic elapsed duration into bounded whole-millisecond metadata.
 * This prevents timing fields from becoming an unbounded precision channel.
 */
export function toBoundedContextSnapshotTimingMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  return Math.min(
    CONTEXT_SNAPSHOT_TIMING_MAX_MS,
    Math.max(0, Math.round(elapsedMs)),
  );
}

export type ContextMetadata = Record<string, unknown>;

function isBoundedContextJson(value: unknown, maxBytes: number): boolean {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > 128 || depth > 8) return false;
    if (candidate === null || typeof candidate === "boolean") return true;
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate === "string") return candidate.length <= 4_096;
    if (Array.isArray(candidate)) return candidate.length <= 64 && candidate.every((entry) => visit(entry, depth + 1));
    if (!candidate || typeof candidate !== "object") return false;
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const entries = Object.entries(candidate as Record<string, unknown>);
    return entries.length <= 64 && entries.every(([key, entry]) => (
      key.length <= 128
      && key !== "__proto__"
      && key !== "prototype"
      && key !== "constructor"
      && visit(entry, depth + 1)
    ));
  };

  if (!visit(value, 0)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes;
  } catch {
    return false;
  }
}

/** Bounded JSON object contract shared by immutable context metadata fields. */
export function isBoundedContextMetadata(value: unknown): value is ContextMetadata {
  return Boolean(value)
    && !Array.isArray(value)
    && typeof value === "object"
    && isBoundedContextJson(value, CONTEXT_METADATA_MAX_BYTES);
}

/** Durable, project-scoped state for one cooperative coordination session. */
export type CoordinationSessionState = "active" | "quarantined" | "closed";
export type CoordinationClaimState = "active" | "released" | "dirty" | "quarantined" | "collision";

export interface CoordinationSession {
  id: string;
  project_id: string;
  worktree_id: string;
  session_id: string;
  incarnation: number;
  revision: number;
  fence: number;
  state: CoordinationSessionState;
  heartbeat_at: string;
  expires_at: string;
  snapshot: ContextMetadata;
  snapshot_revision: number;
  current_task_id: string | null;
  current_task_revision: number | null;
  context_conversation_id: string | null;
  context_revision: number | null;
  created_at: string;
  updated_at: string;
}

export interface CoordinationClaim {
  id: string;
  project_id: string;
  coordination_session_id: string;
  worktree_id: string;
  incarnation: number;
  fence: number;
  kind: "path" | "tree" | "reserved";
  value: string;
  baseline_sha256: string | null;
  state: CoordinationClaimState;
  created_at: string;
  updated_at: string;
  released_at: string | null;
}

const ContextTagsInputSchema = z.array(z.string().trim().min(1).max(64))
  .max(CONTEXT_MAX_TAG_COUNT)
  .default([]);
const ContextMetadataInputSchema = z.unknown().superRefine((value, context) => {
  if (!isBoundedContextMetadata(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid context metadata" });
  }
});
const ContextHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ContextIdempotencyKeySchema = z.string()
  .min(1)
  .max(CONTEXT_IDEMPOTENCY_KEY_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const ContextExpectedRevisionSchema = z.number().int().nonnegative();
const ContextConfirmationTokenSchema = z.string().min(32).max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const ContextSnapshotSourceIdentifierSchema = z.string()
  .min(1)
  .max(CONTEXT_SNAPSHOT_SOURCE_SESSION_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const ContextSnapshotSourceKeySchema = ContextSnapshotSourceIdentifierSchema
  .max(CONTEXT_SNAPSHOT_SOURCE_KEY_MAX_LENGTH);
const ContextSnapshotSourceMessageIdSchema = z.string().min(1).max(512)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Invalid source message identifier");
const ContextSnapshotMetadataInputSchema = z.unknown().superRefine((value, context) => {
  if (!isBoundedContextMetadata(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid context snapshot metadata" });
    return;
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > CONTEXT_SNAPSHOT_INPUT_METADATA_MAX_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Context snapshot metadata exceeds its import budget" });
  }
});

/** A file-snapshot entry may retain an opaque source ID or provide its own hash, never both. */
export const ContextConversationSnapshotEntryInputSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(CONTEXT_MESSAGE_CONTENT_MAX_LENGTH)
    .refine((value) => value.trim().length > 0, "Message content is required"),
  sourceMessageId: ContextSnapshotSourceMessageIdSchema.optional(),
  fingerprint: ContextHashSchema.optional(),
  createdAt: z.string().datetime().optional(),
  metadata: ContextSnapshotMetadataInputSchema.default({}),
}).strict().superRefine((value, context) => {
  if ((value.sourceMessageId === undefined) === (value.fingerprint === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceMessageId"],
      message: "Exactly one of sourceMessageId or fingerprint is required",
    });
  }
});
export type ContextConversationSnapshotEntryInput = z.input<typeof ContextConversationSnapshotEntryInputSchema>;

const ContextConversationSnapshotBaseInputSchema = z.object({
  sourceKey: ContextSnapshotSourceKeySchema,
  sourceSessionId: ContextSnapshotSourceIdentifierSchema.optional(),
  title: z.string().trim().min(1).max(CONTEXT_CONVERSATION_TITLE_MAX_LENGTH),
  existingConversationId: z.string().uuid().optional(),
  entries: z.array(ContextConversationSnapshotEntryInputSchema).min(1).max(CONTEXT_SNAPSHOT_MAX_ENTRIES),
  tags: ContextTagsInputSchema,
  priority: z.number().int().min(0).max(10).default(5),
  metadata: ContextSnapshotMetadataInputSchema.default({}),
}).strict();

function refineContextConversationSnapshotBudget(
  value: z.infer<typeof ContextConversationSnapshotBaseInputSchema>,
  context: z.RefinementCtx,
): void {
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > CONTEXT_SNAPSHOT_MAX_BYTES) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Context snapshot exceeds its import budget" });
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Context snapshot is not serializable" });
  }
}

/** Input used to calculate the caller-supplied deterministic snapshot hash. */
export const ContextConversationSnapshotUnsignedInputSchema = ContextConversationSnapshotBaseInputSchema
  .superRefine(refineContextConversationSnapshotBudget);
export type ContextConversationSnapshotUnsignedInput = z.input<typeof ContextConversationSnapshotUnsignedInputSchema>;

/** Transactional import contract for Context-native conversation file snapshots. */
export const ImportContextConversationSnapshotInputSchema = ContextConversationSnapshotBaseInputSchema.extend({
  snapshotHash: ContextHashSchema,
}).superRefine(refineContextConversationSnapshotBudget);
export type ImportContextConversationSnapshotInput = z.input<typeof ImportContextConversationSnapshotInputSchema>;

/** Coarse timing metadata exposed by the transactional core snapshot importer. */
export const ContextSnapshotImportTimingSchema = z.object({
  validationMs: z.number().int().min(0).max(CONTEXT_SNAPSHOT_TIMING_MAX_MS),
  prefixQueryMs: z.number().int().min(0).max(CONTEXT_SNAPSHOT_TIMING_MAX_MS),
  transactionMs: z.number().int().min(0).max(CONTEXT_SNAPSHOT_TIMING_MAX_MS),
  checkpointMs: z.number().int().min(0).max(CONTEXT_SNAPSHOT_TIMING_MAX_MS),
}).strict();
export type ContextSnapshotImportTiming = z.infer<typeof ContextSnapshotImportTimingSchema>;

/** Coarse transport timing metadata exposed only for successful API imports. */
export const ContextSnapshotIngestTimingSchema = z.object({
  bodyReadMs: z.number().int().min(0).max(CONTEXT_SNAPSHOT_TIMING_MAX_MS),
  decompressionMs: z.number().int().min(0).max(CONTEXT_SNAPSHOT_TIMING_MAX_MS),
  jsonValidationMs: z.number().int().min(0).max(CONTEXT_SNAPSHOT_TIMING_MAX_MS),
  coreImportMs: z.number().int().min(0).max(CONTEXT_SNAPSHOT_TIMING_MAX_MS),
  totalMs: z.number().int().min(0).max(CONTEXT_SNAPSHOT_TIMING_MAX_MS),
}).strict();
export type ContextSnapshotIngestTiming = z.infer<typeof ContextSnapshotIngestTimingSchema>;

export const ContextMessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type ContextMessageRole = z.infer<typeof ContextMessageRoleSchema>;

export const CreateContextConversationInputSchema = z.object({
  title: z.string().trim().min(1).max(CONTEXT_CONVERSATION_TITLE_MAX_LENGTH),
  tags: ContextTagsInputSchema,
  priority: z.number().int().min(0).max(10).default(5),
  metadata: ContextMetadataInputSchema.default({}),
  idempotencyKey: ContextIdempotencyKeySchema.optional(),
  organizationId: z.string().uuid().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  visibility: z.enum(["private", "organization", "project"]).default("project"),
}).strict();
export type CreateContextConversationInput = z.input<typeof CreateContextConversationInputSchema>;

export const AppendContextMessageInputSchema = z.object({
  role: ContextMessageRoleSchema,
  content: z.string().min(1).max(CONTEXT_MESSAGE_CONTENT_MAX_LENGTH)
    .refine((value) => value.trim().length > 0, "Message content is required"),
  tags: ContextTagsInputSchema,
  priority: z.number().int().min(0).max(10).default(5),
  metadata: ContextMetadataInputSchema.default({}),
  expectedRevision: ContextExpectedRevisionSchema,
  idempotencyKey: ContextIdempotencyKeySchema.optional(),
}).strict();
export type AppendContextMessageInput = z.input<typeof AppendContextMessageInputSchema>;

export const CreateContextCheckpointInputSchema = z.object({
  ragSourceIds: z.array(z.string().uuid()).max(CONTEXT_MAX_RAG_SOURCES_PER_CHECKPOINT).default([]),
  metadata: ContextMetadataInputSchema.default({}),
  expectedRevision: ContextExpectedRevisionSchema,
  idempotencyKey: ContextIdempotencyKeySchema.optional(),
}).strict();
export type CreateContextCheckpointInput = z.input<typeof CreateContextCheckpointInputSchema>;

export const PersistContextChatTurnInputSchema = z.object({
  sourceRuntimeId: z.string().min(1).max(64)
    .refine((value) => value === "compatibility" || /^[0-9a-f-]{36}$/i.test(value), "Invalid runtime identifier"),
  sourceSessionId: z.string().min(1).max(512)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Invalid session identifier"),
  userMessageId: z.string().min(1).max(512)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Invalid message identifier"),
  assistantMessageId: z.string().min(1).max(512)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Invalid message identifier"),
  userContent: AppendContextMessageInputSchema.shape.content,
  assistantContent: AppendContextMessageInputSchema.shape.content,
  expectedRevision: ContextExpectedRevisionSchema,
}).strict().refine((value) => value.userMessageId !== value.assistantMessageId, {
  message: "Chat message identifiers must be distinct",
});
export type PersistContextChatTurnInput = z.input<typeof PersistContextChatTurnInputSchema>;

export const RestoreContextCheckpointInputSchema = z.object({
  expectedRevision: ContextExpectedRevisionSchema,
  confirmationToken: ContextConfirmationTokenSchema,
  title: z.string().trim().min(1).max(CONTEXT_CONVERSATION_TITLE_MAX_LENGTH).optional(),
  metadata: ContextMetadataInputSchema.default({}),
  idempotencyKey: ContextIdempotencyKeySchema.optional(),
}).strict();
export type RestoreContextCheckpointInput = z.input<typeof RestoreContextCheckpointInputSchema>;

export const ContextMaintenanceOperationSchema = z.enum([
  "archive_conversation",
  "unarchive_conversation",
  "restore_checkpoint",
]);
export type ContextMaintenanceOperation = z.infer<typeof ContextMaintenanceOperationSchema>;

export const PreviewContextMaintenanceInputSchema = z.object({
  conversationIds: z.array(z.string().uuid()).max(100).optional(),
  staleBefore: z.string().datetime().optional(),
  includeConflicts: z.boolean().default(true),
  includeInvalid: z.boolean().default(true),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();
export type PreviewContextMaintenanceInput = z.input<typeof PreviewContextMaintenanceInputSchema>;

export const AuthorizeContextMaintenanceInputSchema = z.object({
  operation: ContextMaintenanceOperationSchema,
  checkpointId: z.string().uuid().optional(),
  expectedRevision: ContextExpectedRevisionSchema,
}).strict().superRefine((value, context) => {
  const hasCheckpoint = value.checkpointId !== undefined;
  if ((value.operation === "restore_checkpoint") !== hasCheckpoint) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checkpointId"],
      message: "checkpointId is required only for checkpoint restoration",
    });
  }
});
export type AuthorizeContextMaintenanceInput = z.input<typeof AuthorizeContextMaintenanceInputSchema>;

export const ContextConversationArchiveInputSchema = z.object({
  expectedRevision: ContextExpectedRevisionSchema,
  confirmationToken: ContextConfirmationTokenSchema,
}).strict();
export type ContextConversationArchiveInput = z.input<typeof ContextConversationArchiveInputSchema>;

/** Immutable conversation metadata and its project ownership. */
export const ContextConversationSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable(),
  visibility: z.enum(["private", "organization", "project"]),
  title: z.string().min(1).max(CONTEXT_CONVERSATION_TITLE_MAX_LENGTH),
  tags: z.string().max(CONTEXT_TAGS_MAX_BYTES),
  priority: z.coerce.number().int().min(0).max(10),
  metadata: z.string().max(CONTEXT_METADATA_MAX_BYTES),
  created_at: z.string().datetime(),
});
export type ContextConversation = z.infer<typeof ContextConversationSchema>;

/** One ordered, immutable message in a project-scoped conversation. */
export const ContextMessageSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  sequence: z.coerce.number().int().nonnegative(),
  role: ContextMessageRoleSchema,
  content: z.string().min(1).max(CONTEXT_MESSAGE_CONTENT_MAX_LENGTH),
  content_hash: ContextHashSchema,
  tags: z.string().max(CONTEXT_TAGS_MAX_BYTES),
  priority: z.coerce.number().int().min(0).max(10),
  metadata: z.string().max(CONTEXT_METADATA_MAX_BYTES),
  created_at: z.string().datetime(),
});
export type ContextMessage = z.infer<typeof ContextMessageSchema>;

/** Immutable snapshot of a conversation's messages through a specific message. */
export const ContextCheckpointSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  sequence: z.coerce.number().int().nonnegative(),
  through_message_id: z.string().uuid(),
  message_count: z.coerce.number().int().positive(),
  state_hash: ContextHashSchema,
  metadata: z.string().max(CONTEXT_METADATA_MAX_BYTES),
  created_at: z.string().datetime(),
});
export type ContextCheckpoint = z.infer<typeof ContextCheckpointSchema>;

/** Append-only, content-free evidence for context maintenance operations. */
export const ContextCheckpointAuditEventSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  event_type: z.enum([
    "conversation_archived",
    "conversation_unarchived",
    "checkpoint_restored_as_new",
  ]),
  conversation_id: z.string().uuid(),
  checkpoint_id: z.string().uuid().nullable(),
  target_conversation_id: z.string().uuid().nullable(),
  expected_revision: z.coerce.number().int().nonnegative(),
  checkpoint_state_hash: ContextHashSchema.nullable(),
  archive_sequence: z.coerce.number().int().nonnegative().nullable(),
  source_actor_type: z.enum(["compatibility", "user", "service", "system"]),
  source_actor_id: z.string().max(128).nullable(),
  delegator_actor_type: z.enum(["compatibility", "user", "service", "system"]).nullable(),
  delegator_actor_id: z.string().max(128).nullable(),
  request_id: z.string().max(128).nullable(),
  correlation_id: z.string().max(128).nullable(),
  created_at: z.string().datetime(),
});
export type ContextCheckpointAuditEvent = z.infer<typeof ContextCheckpointAuditEventSchema>;

/** Immutable association between a checkpoint and a project-owned RAG source. */
export const ContextCheckpointRagSourceSchema = z.object({
  project_id: z.string().uuid(),
  checkpoint_id: z.string().uuid(),
  rag_source_id: z.string().uuid(),
  ordinal: z.coerce.number().int().nonnegative(),
  metadata: z.string().max(CONTEXT_METADATA_MAX_BYTES),
  created_at: z.string().datetime(),
});
export type ContextCheckpointRagSource = z.infer<typeof ContextCheckpointRagSourceSchema>;

/** A registered child MCP server with its command, arguments, environment, and origin source tracking. */
export interface Server {
  id: string;
  project_id: string;
  name: string;
  command: string;
  args?: string;
  env?: string;
  source: "opencode" | "ingenium";
  enabled: boolean;
  running: boolean;
  created_at: string;
}

/**
 * Canonical child MCP server identifiers are deliberately narrower than general
 * project names because they become part of an externally visible tool name.
 */
export const MCP_CHILD_SERVER_NAME_MAX_LENGTH = 48;
export const MCP_CHILD_TOOL_NAME_MAX_LENGTH = 64;
export const MCP_CHILD_TOOL_DESCRIPTION_MAX_LENGTH = 1024;
export const MCP_CHILD_TOOL_SCHEMA_MAX_BYTES = 16 * 1024;

const ChildMcpServerNameSchema = z.string().superRefine((value, context) => {
  if (!/^[a-z][a-z0-9]{0,47}$/.test(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid child MCP server name" });
  }
});

const ChildMcpToolNameSchema = z.string().superRefine((value, context) => {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value) || value.startsWith("ingenium_")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid child MCP tool name" });
  }
});

const ChildMcpExecutableSchema = z.string().superRefine((value, context) => {
  const segments = value.split("/");
  const isSafeSegment = (segment: string) => /^[A-Za-z0-9_+@.:-]+$/.test(segment)
    && segment !== "."
    && segment !== "..";
  const hasLeadingSlash = value.startsWith("/");
  const pathSegments = hasLeadingSlash ? segments.slice(1) : segments;
  if (
    value.length === 0
    || value.length > 1024
    || /[\s\u0000-\u001f\u007f]/.test(value)
    || pathSegments.length === 0
    || pathSegments.some((segment) => !isSafeSegment(segment))
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Executable must be a shell-free executable path" });
  }
});

const ChildMcpArgumentSchema = z.string().superRefine((value, context) => {
  if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid child MCP argument" });
  }
});

const ChildMcpEnvironmentKeySchema = z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/);

const ChildMcpVaultReferenceSchema = z.object({
  vault_item_id: z.string().uuid(),
}).strict();

function isBoundedJsonSchema(value: unknown): boolean {
  let nodeCount = 0;
  const visit = (candidate: unknown, depth: number): boolean => {
    nodeCount += 1;
    if (nodeCount > 128 || depth > 8) return false;
    if (candidate === null || typeof candidate === "boolean" || typeof candidate === "number") return true;
    if (typeof candidate === "string") return candidate.length <= 2048;
    if (Array.isArray(candidate)) return candidate.length <= 64 && candidate.every((entry) => visit(entry, depth + 1));
    if (typeof candidate !== "object") return false;
    const entries = Object.entries(candidate as Record<string, unknown>);
    return entries.length <= 64 && entries.every(([key, entry]) => (
      key.length <= 128
      && key !== "__proto__"
      && key !== "prototype"
      && key !== "constructor"
      && visit(entry, depth + 1)
    ));
  };

  if (!visit(value, 0)) return false;
  try {
    return JSON.stringify(value).length <= MCP_CHILD_TOOL_SCHEMA_MAX_BYTES;
  } catch {
    return false;
  }
}

const ChildMcpInputSchema = z.unknown().superRefine((value, context) => {
  if (!isBoundedJsonSchema(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Child MCP input schema is invalid" });
  }
});

export const ChildMcpServerDefinitionInputSchema = z.object({
  name: ChildMcpServerNameSchema,
  executable: ChildMcpExecutableSchema,
  args: z.array(ChildMcpArgumentSchema).max(32).default([]),
  environment: z.record(ChildMcpEnvironmentKeySchema, ChildMcpVaultReferenceSchema)
    .superRefine((value, context) => {
      if (Object.keys(value).length > 16) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Too many child MCP environment references" });
      }
    })
    .default({}),
  scope: z.enum(["project", "global"]).default("project"),
}).strict();
export type ChildMcpServerDefinitionInput = z.infer<typeof ChildMcpServerDefinitionInputSchema>;

export const ChildMcpDiscoveredToolInputSchema = z.object({
  name: ChildMcpToolNameSchema,
  description: z.string().min(1).max(MCP_CHILD_TOOL_DESCRIPTION_MAX_LENGTH),
  input_schema: ChildMcpInputSchema.default({ type: "object", properties: {} }),
}).strict();
export type ChildMcpDiscoveredToolInput = z.infer<typeof ChildMcpDiscoveredToolInputSchema>;

export const ChildMcpDiscoveryReportInputSchema = z.object({
  status: z.enum(["ready", "failed"]),
  diagnostic: z.enum(["unavailable", "unauthorized", "invalid_response", "timeout"]).optional(),
  tools: z.array(ChildMcpDiscoveredToolInputSchema).max(128).default([]),
}).strict().superRefine((value, context) => {
  if (value.status === "ready" && value.diagnostic !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Ready discovery reports cannot include diagnostics" });
  }
  if (value.status === "failed" && value.tools.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Failed discovery reports cannot include tools" });
  }
  const names = new Set<string>();
  for (const tool of value.tools) {
    if (names.has(tool.name)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate child MCP tool name" });
      break;
    }
    names.add(tool.name);
  }
});
export type ChildMcpDiscoveryReportInput = z.infer<typeof ChildMcpDiscoveryReportInputSchema>;

/** Persisted child MCP definition. Environment values live in a normalized vault-reference table. */
export const ChildMcpServerDefinitionSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: ChildMcpServerNameSchema,
  executable: z.string(),
  args: z.string(),
  scope: z.enum(["project", "global"]),
  enabled: z.coerce.boolean(),
  discovery_status: z.enum(["pending", "ready", "failed"]),
  discovery_diagnostic: z.enum(["unavailable", "unauthorized", "invalid_response", "timeout"]).nullable(),
  last_discovered_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ChildMcpServerDefinition = z.infer<typeof ChildMcpServerDefinitionSchema>;

export interface ChildMcpDiscoveredTool {
  id: string;
  server_id: string;
  source_name: string;
  canonical_name: string;
  category: string;
  description: string;
  input_schema: string;
  discovered_at: string;
}

/** Observation provenance values accepted by the persistence constraint. */
export const OBSERVATION_SOURCES = [
  "agent",
  "email",
  "chat",
  "document",
  "calendar",
  "synthesis",
  "import",
  "manual",
  "auto-observer",
] as const;
export const ObservationSourceSchema = z.enum(OBSERVATION_SOURCES);
export type ObservationSource = z.infer<typeof ObservationSourceSchema>;

/** An observation about user behavior — the raw input to the self-learning pipeline. */
export interface Observation {
  id: number;
  project_id: string;
  organization_id: string;
  owner_user_id?: string | null;
  visibility: "private" | "organization";
  observation_type: "correction" | "preference" | "pattern" | "insight" | "feedback" | "behavior" | "terminology" | "workflow" | "error" | "goal";
  content: string;
  importance: number;
  source: ObservationSource;
  context?: string;
  status: "pending" | "processed" | "skipped" | "failed";
  session_id?: string;
  created_at: string;
  updated_at: string;
}

export const SYNTHESIS_BATCH_STAGES = [
  "created",
  "traits_applied",
  "proposals_applied",
  "complete",
] as const;
export type SynthesisBatchStage = typeof SYNTHESIS_BATCH_STAGES[number];

/** Durable ownership and phase state for a bounded set of observations. */
export interface SynthesisBatch {
  id: string;
  project_id: string;
  stage: SynthesisBatchStage;
  observation_count: number;
  observation_ids: number[];
  owner_token: string | null;
  lease_expires_at: string | null;
  proposal_plan: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  error_count: number;
  revision: number;
  traits_applied_at: string | null;
  proposals_applied_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SynthesisBatchLeaseState = "available" | "owned";

export interface IncompleteSynthesisBatchStatus {
  stage: Exclude<SynthesisBatchStage, "complete">;
  observationCount: number;
  hasStoredProposalPlan: boolean;
  errorCount: number;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  leaseState: SynthesisBatchLeaseState;
}

export interface SynthesisStatus {
  total_observations: number;
  pending_count: number;
  processed_count: number;
  trait_count: number;
  last_synthesis_at: string | null;
  incompleteBatch: IncompleteSynthesisBatchStatus | null;
}

/** A consolidated personality trait derived from observations by the synthesis pipeline. Confidence reflects corroboration strength. */
export interface PersonalityTrait {
  id: number;
  project_id: string;
  organization_id: string;
  owner_user_id?: string | null;
  visibility: "private" | "organization";
  trait_type: "communication_style" | "code_preference" | "workflow_pattern" | "terminology" | "priority_signal" | "feedback_style" | "interaction_pattern" | "domain_knowledge" | "learned_skill" | "personality_trait";
  trait_value: string;
  display_label?: string;
  confidence: number;
  exemplar_observation_id?: number;
  exemplar_text?: string;
  source: string;
  is_active: boolean;
  metadata?: string;
  created_at: string;
  updated_at: string;
}

/** An OpenCode plugin with file path and optional source content cache for disk-write operations. */
export interface Plugin {
  id: string;
  project_id: string;
  name: string;
  file_path: string;
  enabled: boolean;
  source_content?: string;
  created_at: string;
  updated_at: string;
}

/** Per-tool enable/disable state for child MCP servers — allows toggling individual tools at runtime. */
export interface MCPToolState {
  id?: number;
  project_id: string;
  tool_name: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** A slash-command definition with an associated file path and optional content. */
export interface Command {
  id: string;
  project_id: string;
  name: string;
  file_path: string;
  content?: string;
  created_at: string;
  updated_at: string;
}

/** An agent profile with category, model, permission, and skill assignments. */
export interface Agent {
  id: string;
  project_id: string;
  name: string;
  description: string;
  category: "primary" | "execution" | "research" | "security" | "chat";
  mode: "primary" | "subagent";
  model?: string;
  reasoning_effort?: string;
  permissions: string;
  metadata: string;
  skills: string;
  content: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Project-level or global `opencode.json` configuration stored in the DB for API-driven editing. */
export interface Config {
  id: string;
  project_id: string;
  type: "project" | "global";
  content: string;
  created_at: string;
  updated_at: string;
}

/** An event in the self-learning pipeline timeline — tracks extraction, synthesis, and trait/skill lifecycle. */
export interface PipelineEvent {
  id: number;
  project_id: string;
  organization_id: string;
  owner_user_id?: string | null;
  visibility: "private" | "organization";
  event_type: "session_created" | "session_idle" | "observation_created" | "observation_imported" | "observation_detected" | "synthesis_triggered" | "synthesis_started" | "synthesis_completed" | "synthesis_failed" | "extraction_completed" | "extraction_failed" | "trait_created" | "trait_updated" | "skill_created" | "skill_updated" | "proposal_created" | "proposal_submitted" | "proposal_approved" | "proposal_rejected" | "proposal_applied" | "proposal_rolled_back" | "plugin_initialized" | "plugin_error";
  event_source: "agent" | "plugin" | "synthesis" | "system";
  title: string;
  description?: string;
  data?: string;
  parent_event_id?: number;
  session_id?: string;
  importance: number;
  created_at: string;
}

/** Non-sensitive metadata for an encrypted vault item. */
export interface VaultItem {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  type: "login" | "api_key" | "note" | "oauth";
  tags: string;
  urls: string;
  username: string | null;
  version: number;
  access_policy: string;
  expires_at: string | null;
  lease_duration_seconds: number | null;
  last_accessed_at: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
}

/** A folder used to organize vault items within a project. */
export interface VaultFolder {
  id: string;
  project_id: string;
  name: string;
  parent_folder_id: string | null;
}

/** An immutable audit record for vault activity. */
export interface VaultAudit {
  id: number;
  project_id: string;
  event_type: string;
  item_id: string | null;
  actor: string;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

/** The current status of the in-memory vault session and project inventory. */
export interface VaultStatus {
  sealed: boolean;
  items_count: number;
  folders_count: number;
  last_unsealed: string | null;
}

/** Metadata for a server-owned Ingenium and OpenCode database snapshot. */
export interface BackupRecord {
  id: string;
  project_id: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  backup_type: "manual" | "scheduled_hourly" | "scheduled_daily" | "pre_restore";
  components: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  error_message: string | null;
  created_at: string;
}

/** RESTORE-100's durable, dry-run-only restore approval plan. */
export interface BackupRestorePlanRecord {
  id: string;
  project_id: string;
  backup_id: string;
  state: "previewed" | "authorized" | "confirmed" | "ready_for_executor" | "execution_authorized" | "queued" | "executor_claimed" | "quiescing" | "snapshotting" | "swapping" | "verifying" | "restarting" | "completed" | "rolling_back" | "rolled_back" | "rollback_failed" | "failed" | "cancelled";
  revision: number;
  dry_run: 1;
  manifest_hash: string;
  plan_hash: string;
  blockers_json: string;
  warnings_json: string;
  created_at: string;
  updated_at: string;
}

/** An ingestion source for RAG-backed documentation search. */
export interface RagSource {
  id: string;
  project_id: string;
  organization_id: string;
  visibility: "organization" | "project" | "restricted";
  owner_user_id: string | null;
  title: string;
  source_type: "file" | "text" | "url";
  source_path: string | null;
  source_hash: string | null;
  mime_type: string | null;
  byte_size: number | null;
  chunk_count: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

/** A token-aware, searchable segment belonging to a RAG source. */
export interface RagChunk {
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  heading_path: string | null;
  priority: number;
  tags: string;
  created_at: string;
}

/** A RAG chunk enriched with FTS relevance rank and highlighted excerpt. */
export interface RagSearchResult extends RagChunk {
  rank: number;
  snippet: string;
  source_name: string;
  source_path: string | null;
  source_type: string;
  project_id: string;
}

/**
 * Provider-neutral usage metadata. Deliberately excludes prompts, message text,
 * reasoning content, tool payloads, and credentials.
 */
export interface UsageEventRecord {
  id: string;
  project_id: string;
  source_instance: string;
  source_part_id: string;
  source_session_id: string;
  source_message_id: string;
  source_project_id: string;
  provider_id: string | null;
  model_id: string | null;
  agent_id: string | null;
  status: "success" | "error" | "partial" | "unknown";
  occurred_at: string;
  total_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_amount: number | null;
  cost_status: "known" | "partial" | "unavailable";
  created_at: string;
  updated_at: string;
}

/** Advisory-only project thresholds over provider-reported usage aggregates. */
export interface UsageAdvisoryThresholdRecord {
  project_id: string;
  request_count: number | null;
  total_tokens: number | null;
  reported_cost_amount: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

/** Durable, provider-neutral advisory attention lifecycle metadata (USAGE-101). */
export interface UsageAttentionItemRecord {
  id: string;
  project_id: string;
  condition: string;
  metric: string;
  status: "active" | "resolved";
  evaluation_state: "disabled" | "unknown" | "below" | "equal" | "above";
  severity: "info" | "warning" | "critical";
  message_code: string;
  observed: number | null;
  threshold: number | null;
  availability: "known" | "partial" | "unavailable";
  freshness: "disabled" | "unknown" | "fresh" | "stale";
  range_from: null;
  range_to: null;
  threshold_revision: number;
  opened_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  reopened_at: string | null;
  reopen_count: number;
  last_evaluated_at: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
