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
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  path: z.string().optional(),
  archived_at: z.string().datetime().optional(),
  is_global: z.coerce.boolean().default(false),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** A learned or authored skill with full-text content, metadata, and file_tree for disk sync. */
export const SkillSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string(),
  name: z.string().min(1).max(64),
  description: z.string(),
  content: z.string(),
  category: z.string().optional(),
  tags: z.string().optional(),
  always_apply: z.coerce.number().default(0),
  file_tree: z.string().optional().nullable(),
  enabled: z.coerce.boolean().default(true),
  revision: z.coerce.number().default(0),
  archived_at: z.string().datetime().optional().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Skill = z.infer<typeof SkillSchema>;

/** An immutable snapshot of a skill's complete state at a specific revision. Created automatically by DB triggers. */
export const SkillVersionSchema = z.object({
  id: z.number(),
  skill_id: z.string(),
  revision: z.number(),
  name: z.string().min(1).max(64),
  description: z.string(),
  content: z.string(),
  category: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
  always_apply: z.coerce.number().default(0),
  file_tree: z.string().optional().nullable(),
  enabled: z.coerce.boolean().default(true),
  archived_at: z.string().datetime().optional().nullable(),
  created_by: z.string().default("system"),
  created_at: z.string().datetime(),
});
export type SkillVersion = z.infer<typeof SkillVersionSchema>;

/** A lineage record mapping a source skill (by project + name) to a canonical target skill. */
export const SkillLineageSchema = z.object({
  id: z.number(),
  project_id: z.string(),
  source_project_id: z.string(),
  source_name: z.string(),
  target_skill_id: z.string(),
  source_hash: z.string().default(""),
  merged_file_paths: z.string().default("[]"),
  tombstone_path: z.string().optional().nullable(),
  reason: z.string().default(""),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type SkillLineage = z.infer<typeof SkillLineageSchema>;

/** A governance proposal for a skill mutation: create, update, merge, or archive. */
export const SkillProposalSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string(),
  status: z.enum(["draft", "pending", "rejected", "applied", "rolled_back", "stale"]).default("draft"),
  proposal_type: z.enum(["create", "update", "merge", "archive"]),
  target_skill_id: z.string().optional().nullable(),
  target_name: z.string(),
  source_project_id: z.string().optional().nullable(),
  source_name: z.string().optional().nullable(),
  expected_revision: z.number().optional().nullable(),
  expected_source_revision: z.number().optional().nullable(),
  target_revision_before: z.number().optional().nullable(),
  source_revision_before: z.number().optional().nullable(),
  target_created: z.coerce.number().default(0),
  proposed_state: z.string(),
  evidence_json: z.string().default("[]"),
  observation_ids: z.string().default("[]"),
  quality_score: z.number().min(0).max(1).default(0),
  novelty_score: z.number().min(0).max(1).default(0),
  contradiction_flag: z.coerce.number().default(0),
  candidate_group_key: z.string().optional().nullable(),
  reviewer: z.string().optional().nullable(),
  review_reason: z.string().optional().nullable(),
  always_apply: z.coerce.number().default(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  reviewed_at: z.string().datetime().optional().nullable(),
  applied_at: z.string().datetime().optional().nullable(),
  rolled_back_at: z.string().datetime().optional().nullable(),
});
export type SkillProposal = z.infer<typeof SkillProposalSchema>;

/** A learning entry — a tagged, prioritised record of a decision, pattern, bug, or other context. */
export const LearningSchema = z.object({
  id: z.number(),
  project_id: z.string(),
  entry_type: z.enum(["decision", "bug", "pattern", "preference", "research", "skill", "agent", "config", "hook", "learning", "plugin", "architecture", "implementation", "code_change", "enhancement", "observation", "ops", "question", "review", "documentation", "improvement", "milestone"]),
  content: z.string().min(1),
  tags: z.string().optional(),
  status: z.enum(["pending", "processed", "failed"]).default("pending"),
  priority: z.number().min(0).max(10).default(5),
  session_id: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Learning = z.infer<typeof LearningSchema>;

/** A kanban task with sub-tasking, scheduling, and time-tracking support. */
export const TaskSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  column_id: z.string().default("todo"),
  assigned_to: z.string().optional(),
  depends_on: z.string().optional(),
  files: z.string().optional(),
  labels: z.string().optional(),
  session_id: z.string().optional(),
  parent_id: z.string().optional().nullable(),
  issue_type: z.enum(["epic", "story", "task", "subtask"]).default("task"),
  priority: z.number().int().default(0),
  due_date: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  estimate_minutes: z.number().int().optional().nullable(),
  spent_minutes: z.number().int().default(0),
  remaining_minutes: z.number().int().optional().nullable(),
  custom_fields: z.string().optional().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().optional().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

/** A threaded comment on a task, with parent_comment_id for nested replies. */
export const TaskCommentSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  parent_comment_id: z.string().optional().nullable(),
  author: z.string(),
  body: z.string(),
  reactions: z.string().default("{}"),
  edited_at: z.string().optional().nullable(),
  created_at: z.string().datetime(),
});
export type TaskComment = z.infer<typeof TaskCommentSchema>;

/** An audit event recording state transitions on a task (e.g., column move, assignment change). */
export const TaskActivitySchema = z.object({
  id: z.string(),
  task_id: z.string(),
  actor: z.string(),
  event_type: z.string(),
  payload: z.string().optional().nullable(),
  created_at: z.string().datetime(),
});
export type TaskActivity = z.infer<typeof TaskActivitySchema>;

/** A dependency link between two tasks: blocks, blocked_by, or relates_to. */
export const TaskLinkSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  linked_task_id: z.string(),
  link_type: z.enum(["blocks", "blocked_by", "relates_to"]),
});
export type TaskLink = z.infer<typeof TaskLinkSchema>;

/** A notification targeting a specific user about a task event (mention, assignment, watch status change). */
export const TaskNotificationSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  recipient: z.string(),
  task_id: z.string(),
  kind: z.enum(["mentioned", "assigned", "watched_status"]),
  read_at: z.string().optional().nullable(),
  created_at: z.string().datetime(),
});
export type TaskNotification = z.infer<typeof TaskNotificationSchema>;

/** Kanban board layout: column definitions and custom field config stored as JSON strings. */
export const BoardConfigSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  columns: z.string(),
  custom_field_defs: z.string().default("[]"),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type BoardConfig = z.infer<typeof BoardConfigSchema>;

/** A recurring or event-triggered job definition with agent assignment and scheduling config. */
export const JobSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string().min(1).max(128),
  description: z.string().optional().nullable(),
  agent: z.string().min(1),
  prompt_template: z.string().min(1),
  schedule_cron: z.string().optional().nullable(),
  trigger_event: z.string().optional().nullable(),
  enabled: z.coerce.boolean().default(true),
  timeout_minutes: z.number().int().min(1).default(30),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Job = z.infer<typeof JobSchema>;

/** A single execution of a job, tracking its lifecycle from queued through completion or failure. */
export const JobRunSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  status: z.enum(["queued", "running", "success", "failed", "timeout", "cancelled"]).default("queued"),
  trigger: z.enum(["manual", "cron", "event"]),
  started_at: z.string().datetime().optional().nullable(),
  finished_at: z.string().datetime().optional().nullable(),
  exit_code: z.number().int().optional().nullable(),
  created_at: z.string().datetime(),
});
export type JobRun = z.infer<typeof JobRunSchema>;

/** An individual line of stdout/stderr output from a job run, ordered by sequence number. */
export const JobRunLogSchema = z.object({
  id: z.number(),
  run_id: z.string(),
  seq: z.number(),
  stream: z.enum(["stdout", "stderr"]),
  line: z.string(),
  created_at: z.string().datetime(),
});
export type JobRunLog = z.infer<typeof JobRunLogSchema>;

/** A contextual memory entry with priority ranking — used by agents to recall past session context. */
export const ContextSchema = z.object({
  id: z.number(),
  project_id: z.string(),
  content: z.string().min(1),
  priority: z.number().min(0).max(10).default(5),
  tags: z.string().default("[]"),
  session_id: z.string().optional().nullable(),
  source: z.enum(["manual", "agent", "import", "system"]).default("manual"),
  metadata: z.string().default("{}"),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ContextEntry = z.infer<typeof ContextSchema>;

/** Immutable conversation/checkpoint/message limits enforced by migration 063. */
export const CONTEXT_CONVERSATION_TITLE_MAX_LENGTH = 256;
export const CONTEXT_MESSAGE_CONTENT_MAX_LENGTH = 262_144;
export const CONTEXT_TAGS_MAX_BYTES = 4_096;
export const CONTEXT_METADATA_MAX_BYTES = 16_384;
export const CONTEXT_MAX_TAG_COUNT = 64;
export const CONTEXT_MAX_RAG_SOURCES_PER_CHECKPOINT = 64;
export const CONTEXT_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

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

export const ContextMessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type ContextMessageRole = z.infer<typeof ContextMessageRoleSchema>;

export const CreateContextConversationInputSchema = z.object({
  title: z.string().trim().min(1).max(CONTEXT_CONVERSATION_TITLE_MAX_LENGTH),
  tags: ContextTagsInputSchema,
  priority: z.number().int().min(0).max(10).default(5),
  metadata: ContextMetadataInputSchema.default({}),
  idempotencyKey: ContextIdempotencyKeySchema.optional(),
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
export const ServerSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string().min(1).max(64),
  command: z.string(),
  args: z.string().optional(),
  env: z.string().optional(),
  source: z.enum(["opencode", "ingenium"]).default("opencode"),
  enabled: z.coerce.boolean().default(true),
  running: z.coerce.boolean().default(false),
  created_at: z.string().datetime(),
});
export type Server = z.infer<typeof ServerSchema>;

/**
 * Canonical child MCP server identifiers are deliberately narrower than general
 * project names because they become part of an externally visible tool name.
 */
export const MCP_CHILD_SERVER_NAME_MAX_LENGTH = 48;
export const MCP_CHILD_TOOL_NAME_MAX_LENGTH = 64;
export const MCP_CHILD_TOOL_DESCRIPTION_MAX_LENGTH = 1024;
export const MCP_CHILD_TOOL_SCHEMA_MAX_BYTES = 16 * 1024;

const ChildMcpServerNameSchema = z.string().superRefine((value, context) => {
  // `thread` was the retired direct integration namespace. Thread now runs as
  // the explicitly namespaced `threadbridge` child MCP so it cannot shadow or
  // resurrect the former transport surface.
  if (!/^[a-z][a-z0-9]{0,47}$/.test(value) || value === "thread") {
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

export const ChildMcpDiscoveredToolSchema = z.object({
  id: z.string().uuid(),
  server_id: z.string().uuid(),
  source_name: ChildMcpToolNameSchema,
  canonical_name: z.string().regex(/^ingenium_[a-z][a-z0-9]*_[a-z][a-z0-9_]*$/),
  // Child tools are grouped by their owning server so operators can distinguish
  // two independently managed child catalogs without relying on a name prefix.
  category: z.string().regex(/^Child MCP \/ [a-z][a-z0-9]{0,47}$/),
  description: z.string().min(1).max(MCP_CHILD_TOOL_DESCRIPTION_MAX_LENGTH),
  input_schema: z.string(),
  discovered_at: z.string().datetime(),
});
export type ChildMcpDiscoveredTool = z.infer<typeof ChildMcpDiscoveredToolSchema>;

/** An observation about user behavior — the raw input to the self-learning pipeline. */
export const ObservationSchema = z.object({
  id: z.number(),
  project_id: z.string(),
  observation_type: z.enum([
    "correction", "preference", "pattern", "insight", "feedback",
    "behavior", "terminology", "workflow", "error", "goal"
  ]),
  content: z.string().min(1),
  importance: z.number().min(1).max(10).default(5),
  source: z.enum(["agent", "email", "chat", "document", "calendar", "synthesis", "import", "manual", "auto-observer"]).default("agent"),
  context: z.string().optional(),
  status: z.enum(["pending", "processed", "skipped", "failed"]).default("pending"),
  session_id: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Observation = z.infer<typeof ObservationSchema>;

/** A consolidated personality trait derived from observations by the synthesis pipeline. Confidence reflects corroboration strength. */
export const PersonalityTraitSchema = z.object({
  id: z.number(),
  project_id: z.string(),
  trait_type: z.enum([
    "communication_style", "code_preference", "workflow_pattern",
    "terminology", "priority_signal", "feedback_style",
    "interaction_pattern", "domain_knowledge", "learned_skill", "personality_trait"
  ]),
  trait_value: z.string().min(1),
  display_label: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  exemplar_observation_id: z.number().optional(),
  exemplar_text: z.string().optional(),
  source: z.string().default("synthesis"),
  is_active: z.coerce.boolean().default(true),
  metadata: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type PersonalityTrait = z.infer<typeof PersonalityTraitSchema>;

/** An OpenCode plugin with file path and optional source content cache for disk-write operations. */
export const PluginSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string().min(1).max(64),
  file_path: z.string(),
  enabled: z.coerce.boolean().default(true),
  source_content: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Plugin = z.infer<typeof PluginSchema>;

/** Per-tool enable/disable state for child MCP servers — allows toggling individual tools at runtime. */
export const MCPToolStateSchema = z.object({
  id: z.number().optional(),
  project_id: z.string(),
  tool_name: z.string(),
  enabled: z.coerce.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type MCPToolState = z.infer<typeof MCPToolStateSchema>;

/** A slash-command definition with an associated file path and optional content. */
export const CommandSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string().min(1).max(64),
  file_path: z.string(),
  content: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Command = z.infer<typeof CommandSchema>;

/** An agent profile with category, model, permission, and skill assignments. */
export const AgentSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string().min(1).max(64),
  description: z.string().default(""),
  category: z.enum(["primary", "execution", "research", "security", "chat"]).default("execution"),
  mode: z.enum(["primary", "subagent"]).default("subagent"),
  model: z.string().optional(),
  reasoning_effort: z.string().optional(),
  permissions: z.string().default("{}"),
  metadata: z.string().default("{}"),
  skills: z.string().default("[]"),
  content: z.string().min(1),
  enabled: z.coerce.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Agent = z.infer<typeof AgentSchema>;

/** Project-level or global `opencode.json` configuration stored in the DB for API-driven editing. */
export const ConfigSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  type: z.enum(["project", "global"]),
  content: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Config = z.infer<typeof ConfigSchema>;

/** An event in the self-learning pipeline timeline — tracks extraction, synthesis, and trait/skill lifecycle. */
export const PipelineEventSchema = z.object({
  id: z.number(),
  project_id: z.string(),
  event_type: z.enum([
    "session_created", "session_idle", "observation_created", "observation_imported",
    "observation_detected",
    "synthesis_triggered", "synthesis_started", "synthesis_completed", "synthesis_failed",
    "extraction_completed", "extraction_failed",
    "trait_created", "trait_updated", "skill_created", "skill_updated",
    "proposal_created", "proposal_submitted", "proposal_approved", "proposal_rejected",
    "proposal_applied", "proposal_rolled_back",
    "plugin_initialized", "plugin_error",
  ]),
  event_source: z.enum(["agent", "plugin", "synthesis", "system"]),
  title: z.string().min(1),
  description: z.string().optional(),
  data: z.string().optional(),
  parent_event_id: z.number().optional(),
  session_id: z.string().optional(),
  importance: z.number().min(1).max(10).default(5),
  created_at: z.string().datetime(),
});
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;

/** Non-sensitive metadata for an encrypted vault item. */
export const VaultItemSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string(),
  folder_id: z.string().nullable(),
  name: z.string().min(1),
  type: z.enum(["login", "api_key", "note", "oauth"]),
  tags: z.string().default("[]"),
  urls: z.string().default("[]"),
  username: z.string().nullable(),
  version: z.coerce.number().int().default(1),
  access_policy: z.string().default('{"mode":"restricted"}'),
  expires_at: z.string().nullable(),
  lease_duration_seconds: z.coerce.number().int().nullable(),
  last_accessed_at: z.string().nullable(),
  access_count: z.coerce.number().int().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});
export type VaultItem = z.infer<typeof VaultItemSchema>;

/** A folder used to organize vault items within a project. */
export const VaultFolderSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string(),
  name: z.string().min(1),
  parent_folder_id: z.string().nullable(),
});
export type VaultFolder = z.infer<typeof VaultFolderSchema>;

/** An immutable audit record for vault activity. */
export const VaultAuditSchema = z.object({
  id: z.coerce.number().int(),
  project_id: z.string(),
  event_type: z.string(),
  item_id: z.string().nullable(),
  actor: z.string(),
  details: z.string().nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: z.string(),
});
export type VaultAudit = z.infer<typeof VaultAuditSchema>;

/** The current status of the in-memory vault session and project inventory. */
export const VaultStatusSchema = z.object({
  sealed: z.coerce.boolean(),
  items_count: z.coerce.number().int().nonnegative(),
  folders_count: z.coerce.number().int().nonnegative(),
  last_unsealed: z.string().nullable(),
});
export type VaultStatus = z.infer<typeof VaultStatusSchema>;

/** Metadata for a server-owned Ingenium and OpenCode database snapshot. */
export const BackupRecordSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string(),
  filename: z.string(),
  size_bytes: z.coerce.number().int().nonnegative(),
  sha256: z.string(),
  backup_type: z.enum(["manual", "scheduled_hourly", "scheduled_daily", "pre_restore"]),
  components: z.string().default("{}"),
  status: z.enum(["pending", "in_progress", "completed", "failed"]).default("completed"),
  error_message: z.string().nullable(),
  created_at: z.string(),
});
export type BackupRecord = z.infer<typeof BackupRecordSchema>;

/** Lifecycle state for a restore request associated with a backup snapshot. */
export const BackupRestoreJobSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string(),
  backup_id: z.string().nullable(),
  status: z.enum(["validating", "confirmed", "applying", "completed", "failed", "rolled_back"]).default("validating"),
  components: z.string().default("{}"),
  error_message: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
});
export type BackupRestoreJob = z.infer<typeof BackupRestoreJobSchema>;

/** An ingestion source for RAG-backed documentation search. */
export const RagSourceSchema = z.object({
  id: z.string().uuid(), project_id: z.string(), title: z.string().min(1),
  source_type: z.enum(["file", "text", "url"]),
  source_path: z.string().nullable(), source_hash: z.string().nullable(), mime_type: z.string().nullable(),
  byte_size: z.coerce.number().int().nullable(), chunk_count: z.coerce.number().int().nonnegative().default(0),
  metadata: z.string().default("{}"), created_at: z.string(), updated_at: z.string(),
});
export type RagSource = z.infer<typeof RagSourceSchema>;

/** A token-aware, searchable segment belonging to a RAG source. */
export const RagChunkSchema = z.object({
  id: z.string().uuid(), source_id: z.string().uuid(), chunk_index: z.coerce.number().int().nonnegative(), content: z.string(),
  token_count: z.coerce.number().int().nonnegative().default(0), heading_path: z.string().nullable(),
  priority: z.coerce.number().int().min(0).max(10).default(5), tags: z.string().default("[]"), created_at: z.string(),
});
export type RagChunk = z.infer<typeof RagChunkSchema>;

/** A RAG chunk enriched with FTS relevance rank and highlighted excerpt. */
export const RagSearchResultSchema = RagChunkSchema.extend({
  rank: z.coerce.number(), snippet: z.string(), source_name: z.string(),
  source_path: z.string().nullable(), source_type: z.string(), project_id: z.string(),
});
export type RagSearchResult = z.infer<typeof RagSearchResultSchema>;

/**
 * Provider-neutral usage metadata. Deliberately excludes prompts, message text,
 * reasoning content, tool payloads, and credentials.
 */
export const UsageEventSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string(),
  source_instance: z.string().min(1).max(512),
  source_part_id: z.string().min(1).max(512),
  source_session_id: z.string().min(1).max(512),
  source_message_id: z.string().min(1).max(512),
  source_project_id: z.string().min(1).max(512),
  provider_id: z.string().min(1).max(512).nullable(),
  model_id: z.string().min(1).max(512).nullable(),
  agent_id: z.string().min(1).max(512).nullable(),
  status: z.enum(["success", "error", "partial", "unknown"]),
  occurred_at: z.string().datetime(),
  total_tokens: z.coerce.number().int().nonnegative().nullable(),
  input_tokens: z.coerce.number().int().nonnegative().nullable(),
  output_tokens: z.coerce.number().int().nonnegative().nullable(),
  reasoning_tokens: z.coerce.number().int().nonnegative().nullable(),
  cache_read_tokens: z.coerce.number().int().nonnegative().nullable(),
  cache_write_tokens: z.coerce.number().int().nonnegative().nullable(),
  cost_amount: z.coerce.number().nonnegative().nullable(),
  cost_status: z.enum(["known", "partial", "unavailable"]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type UsageEventRecord = z.infer<typeof UsageEventSchema>;
