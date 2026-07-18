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
/** An audit event recording state transitions on a task (e.g., column move, assignment change). */
export const TaskActivitySchema = z.object({
    id: z.string(),
    task_id: z.string(),
    actor: z.string(),
    event_type: z.string(),
    payload: z.string().optional().nullable(),
    created_at: z.string().datetime(),
});
/** A dependency link between two tasks: blocks, blocked_by, or relates_to. */
export const TaskLinkSchema = z.object({
    id: z.string(),
    task_id: z.string(),
    linked_task_id: z.string(),
    link_type: z.enum(["blocks", "blocked_by", "relates_to"]),
});
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
/** Kanban board layout: column definitions and custom field config stored as JSON strings. */
export const BoardConfigSchema = z.object({
    id: z.string(),
    project_id: z.string(),
    columns: z.string(),
    custom_field_defs: z.string().default("[]"),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
});
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
/** An individual line of stdout/stderr output from a job run, ordered by sequence number. */
export const JobRunLogSchema = z.object({
    id: z.number(),
    run_id: z.string(),
    seq: z.number(),
    stream: z.enum(["stdout", "stderr"]),
    line: z.string(),
    created_at: z.string().datetime(),
});
/** A contextual memory entry with priority ranking — used by agents to recall past session context. */
export const ContextSchema = z.object({
    id: z.number(),
    project_id: z.string(),
    content: z.string().min(1),
    priority: z.number().min(0).max(10).default(5),
    tags: z.string().optional(),
    session_id: z.string().optional(),
    created_at: z.string().datetime(),
});
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
/** Per-tool enable/disable state for child MCP servers — allows toggling individual tools at runtime. */
export const MCPToolStateSchema = z.object({
    id: z.number().optional(),
    project_id: z.string(),
    tool_name: z.string(),
    enabled: z.coerce.boolean().default(true),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
});
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
/** An agent profile with category, model, permission, and skill assignments. */
export const AgentSchema = z.object({
    id: z.string(),
    project_id: z.string(),
    name: z.string().min(1).max(64),
    description: z.string().default(""),
    category: z.enum(["primary", "execution", "research", "security"]).default("execution"),
    mode: z.enum(["primary", "subagent"]).default("subagent"),
    model: z.string().optional(),
    reasoning_effort: z.string().optional(),
    permissions: z.string().default("{}"),
    skills: z.string().default("[]"),
    content: z.string().min(1),
    enabled: z.coerce.boolean().default(true),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
});
/** Project-level or global `opencode.json` configuration stored in the DB for API-driven editing. */
export const ConfigSchema = z.object({
    id: z.string(),
    project_id: z.string(),
    type: z.enum(["project", "global"]),
    content: z.string(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
});
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
/** A folder used to organize vault items within a project. */
export const VaultFolderSchema = z.object({
    id: z.string().uuid(),
    project_id: z.string(),
    name: z.string().min(1),
    parent_folder_id: z.string().nullable(),
});
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
/** The current status of the in-memory vault session and project inventory. */
export const VaultStatusSchema = z.object({
    sealed: z.coerce.boolean(),
    items_count: z.coerce.number().int().nonnegative(),
    folders_count: z.coerce.number().int().nonnegative(),
    last_unsealed: z.string().nullable(),
});
/** Metadata for a project-scoped Ingenium and OpenCode database snapshot. */
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
/** An ingestion source for RAG-backed documentation search. */
export const RagSourceSchema = z.object({
    id: z.string().uuid(), project_id: z.string(), title: z.string().min(1),
    source_type: z.enum(["file", "thread_import", "text", "url"]),
    source_path: z.string().nullable(), source_hash: z.string().nullable(), mime_type: z.string().nullable(),
    byte_size: z.coerce.number().int().nullable(), chunk_count: z.coerce.number().int().nonnegative().default(0),
    metadata: z.string().default("{}"), created_at: z.string(), updated_at: z.string(),
});
/** A token-aware, searchable segment belonging to a RAG source. */
export const RagChunkSchema = z.object({
    id: z.string().uuid(), source_id: z.string().uuid(), chunk_index: z.coerce.number().int().nonnegative(), content: z.string(),
    token_count: z.coerce.number().int().nonnegative().default(0), heading_path: z.string().nullable(),
    priority: z.coerce.number().int().min(0).max(10).default(5), tags: z.string().default("[]"), created_at: z.string(),
});
/** A RAG chunk enriched with FTS relevance rank and highlighted excerpt. */
export const RagSearchResultSchema = RagChunkSchema.extend({ rank: z.coerce.number(), snippet: z.string() });
