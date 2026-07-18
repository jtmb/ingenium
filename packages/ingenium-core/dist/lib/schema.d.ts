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
export declare const ProjectSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    archived_at: z.ZodOptional<z.ZodString>;
    is_global: z.ZodDefault<z.ZodBoolean>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    name: string;
    is_global: boolean;
    created_at: string;
    path?: string | undefined;
    archived_at?: string | undefined;
}, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    path?: string | undefined;
    archived_at?: string | undefined;
    is_global?: boolean | undefined;
}>;
export type Project = z.infer<typeof ProjectSchema>;
/** A learned or authored skill with full-text content, metadata, and file_tree for disk sync. */
export declare const SkillSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    content: z.ZodString;
    category: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodString>;
    always_apply: z.ZodDefault<z.ZodNumber>;
    file_tree: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    revision: z.ZodDefault<z.ZodNumber>;
    archived_at: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    description: string;
    content: string;
    always_apply: number;
    enabled: boolean;
    revision: number;
    archived_at?: string | null | undefined;
    category?: string | undefined;
    tags?: string | undefined;
    file_tree?: string | null | undefined;
}, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    description: string;
    content: string;
    archived_at?: string | null | undefined;
    category?: string | undefined;
    tags?: string | undefined;
    always_apply?: number | undefined;
    file_tree?: string | null | undefined;
    enabled?: boolean | undefined;
    revision?: number | undefined;
}>;
export type Skill = z.infer<typeof SkillSchema>;
/** An immutable snapshot of a skill's complete state at a specific revision. Created automatically by DB triggers. */
export declare const SkillVersionSchema: z.ZodObject<{
    id: z.ZodNumber;
    skill_id: z.ZodString;
    revision: z.ZodNumber;
    name: z.ZodString;
    description: z.ZodString;
    content: z.ZodString;
    category: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    tags: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    always_apply: z.ZodDefault<z.ZodNumber>;
    file_tree: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    archived_at: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    created_by: z.ZodDefault<z.ZodString>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: number;
    name: string;
    created_at: string;
    description: string;
    content: string;
    always_apply: number;
    enabled: boolean;
    revision: number;
    skill_id: string;
    created_by: string;
    archived_at?: string | null | undefined;
    category?: string | null | undefined;
    tags?: string | null | undefined;
    file_tree?: string | null | undefined;
}, {
    id: number;
    name: string;
    created_at: string;
    description: string;
    content: string;
    revision: number;
    skill_id: string;
    archived_at?: string | null | undefined;
    category?: string | null | undefined;
    tags?: string | null | undefined;
    always_apply?: number | undefined;
    file_tree?: string | null | undefined;
    enabled?: boolean | undefined;
    created_by?: string | undefined;
}>;
export type SkillVersion = z.infer<typeof SkillVersionSchema>;
/** A lineage record mapping a source skill (by project + name) to a canonical target skill. */
export declare const SkillLineageSchema: z.ZodObject<{
    id: z.ZodNumber;
    project_id: z.ZodString;
    source_project_id: z.ZodString;
    source_name: z.ZodString;
    target_skill_id: z.ZodString;
    source_hash: z.ZodDefault<z.ZodString>;
    merged_file_paths: z.ZodDefault<z.ZodString>;
    tombstone_path: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    reason: z.ZodDefault<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: number;
    created_at: string;
    project_id: string;
    source_project_id: string;
    source_name: string;
    target_skill_id: string;
    source_hash: string;
    merged_file_paths: string;
    reason: string;
    tombstone_path?: string | null | undefined;
}, {
    updated_at: string;
    id: number;
    created_at: string;
    project_id: string;
    source_project_id: string;
    source_name: string;
    target_skill_id: string;
    source_hash?: string | undefined;
    merged_file_paths?: string | undefined;
    tombstone_path?: string | null | undefined;
    reason?: string | undefined;
}>;
export type SkillLineage = z.infer<typeof SkillLineageSchema>;
/** A governance proposal for a skill mutation: create, update, merge, or archive. */
export declare const SkillProposalSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<["draft", "pending", "rejected", "applied", "rolled_back", "stale"]>>;
    proposal_type: z.ZodEnum<["create", "update", "merge", "archive"]>;
    target_skill_id: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    target_name: z.ZodString;
    source_project_id: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    source_name: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    expected_revision: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    expected_source_revision: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    target_revision_before: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    source_revision_before: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    target_created: z.ZodDefault<z.ZodNumber>;
    proposed_state: z.ZodString;
    evidence_json: z.ZodDefault<z.ZodString>;
    observation_ids: z.ZodDefault<z.ZodString>;
    quality_score: z.ZodDefault<z.ZodNumber>;
    novelty_score: z.ZodDefault<z.ZodNumber>;
    contradiction_flag: z.ZodDefault<z.ZodNumber>;
    candidate_group_key: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    reviewer: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    review_reason: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    always_apply: z.ZodDefault<z.ZodNumber>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
    reviewed_at: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    applied_at: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    rolled_back_at: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    target_created: number;
    updated_at: string;
    id: string;
    created_at: string;
    status: "draft" | "pending" | "rejected" | "applied" | "rolled_back" | "stale";
    project_id: string;
    always_apply: number;
    proposal_type: "create" | "update" | "merge" | "archive";
    target_name: string;
    proposed_state: string;
    evidence_json: string;
    observation_ids: string;
    quality_score: number;
    novelty_score: number;
    contradiction_flag: number;
    target_revision_before?: number | null | undefined;
    source_revision_before?: number | null | undefined;
    expected_source_revision?: number | null | undefined;
    source_project_id?: string | null | undefined;
    source_name?: string | null | undefined;
    target_skill_id?: string | null | undefined;
    expected_revision?: number | null | undefined;
    candidate_group_key?: string | null | undefined;
    reviewer?: string | null | undefined;
    review_reason?: string | null | undefined;
    reviewed_at?: string | null | undefined;
    applied_at?: string | null | undefined;
    rolled_back_at?: string | null | undefined;
}, {
    updated_at: string;
    id: string;
    created_at: string;
    project_id: string;
    proposal_type: "create" | "update" | "merge" | "archive";
    target_name: string;
    proposed_state: string;
    target_revision_before?: number | null | undefined;
    source_revision_before?: number | null | undefined;
    target_created?: number | undefined;
    expected_source_revision?: number | null | undefined;
    status?: "draft" | "pending" | "rejected" | "applied" | "rolled_back" | "stale" | undefined;
    always_apply?: number | undefined;
    source_project_id?: string | null | undefined;
    source_name?: string | null | undefined;
    target_skill_id?: string | null | undefined;
    expected_revision?: number | null | undefined;
    evidence_json?: string | undefined;
    observation_ids?: string | undefined;
    quality_score?: number | undefined;
    novelty_score?: number | undefined;
    contradiction_flag?: number | undefined;
    candidate_group_key?: string | null | undefined;
    reviewer?: string | null | undefined;
    review_reason?: string | null | undefined;
    reviewed_at?: string | null | undefined;
    applied_at?: string | null | undefined;
    rolled_back_at?: string | null | undefined;
}>;
export type SkillProposal = z.infer<typeof SkillProposalSchema>;
/** A learning entry — a tagged, prioritised record of a decision, pattern, bug, or other context. */
export declare const LearningSchema: z.ZodObject<{
    id: z.ZodNumber;
    project_id: z.ZodString;
    entry_type: z.ZodEnum<["decision", "bug", "pattern", "preference", "research", "skill", "agent", "config", "hook", "learning", "plugin", "architecture", "implementation", "code_change", "enhancement", "observation", "ops", "question", "review", "documentation", "improvement", "milestone"]>;
    content: z.ZodString;
    tags: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["pending", "processed", "failed"]>>;
    priority: z.ZodDefault<z.ZodNumber>;
    session_id: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: number;
    created_at: string;
    status: "pending" | "processed" | "failed";
    project_id: string;
    content: string;
    entry_type: "decision" | "bug" | "pattern" | "preference" | "research" | "skill" | "agent" | "config" | "hook" | "learning" | "plugin" | "architecture" | "implementation" | "code_change" | "enhancement" | "observation" | "ops" | "question" | "review" | "documentation" | "improvement" | "milestone";
    priority: number;
    tags?: string | undefined;
    session_id?: string | undefined;
}, {
    updated_at: string;
    id: number;
    created_at: string;
    project_id: string;
    content: string;
    entry_type: "decision" | "bug" | "pattern" | "preference" | "research" | "skill" | "agent" | "config" | "hook" | "learning" | "plugin" | "architecture" | "implementation" | "code_change" | "enhancement" | "observation" | "ops" | "question" | "review" | "documentation" | "improvement" | "milestone";
    status?: "pending" | "processed" | "failed" | undefined;
    tags?: string | undefined;
    priority?: number | undefined;
    session_id?: string | undefined;
}>;
export type Learning = z.infer<typeof LearningSchema>;
/** A kanban task with sub-tasking, scheduling, and time-tracking support. */
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    column_id: z.ZodDefault<z.ZodString>;
    assigned_to: z.ZodOptional<z.ZodString>;
    depends_on: z.ZodOptional<z.ZodString>;
    files: z.ZodOptional<z.ZodString>;
    labels: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    parent_id: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    issue_type: z.ZodDefault<z.ZodEnum<["epic", "story", "task", "subtask"]>>;
    priority: z.ZodDefault<z.ZodNumber>;
    due_date: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    start_date: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    estimate_minutes: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    spent_minutes: z.ZodDefault<z.ZodNumber>;
    remaining_minutes: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    custom_fields: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
    completed_at: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    created_at: string;
    project_id: string;
    priority: number;
    title: string;
    column_id: string;
    issue_type: "epic" | "story" | "task" | "subtask";
    spent_minutes: number;
    description?: string | undefined;
    session_id?: string | undefined;
    assigned_to?: string | undefined;
    depends_on?: string | undefined;
    files?: string | undefined;
    labels?: string | undefined;
    parent_id?: string | null | undefined;
    due_date?: string | null | undefined;
    start_date?: string | null | undefined;
    estimate_minutes?: number | null | undefined;
    remaining_minutes?: number | null | undefined;
    custom_fields?: string | null | undefined;
    completed_at?: string | null | undefined;
}, {
    updated_at: string;
    id: string;
    created_at: string;
    project_id: string;
    title: string;
    description?: string | undefined;
    priority?: number | undefined;
    session_id?: string | undefined;
    column_id?: string | undefined;
    assigned_to?: string | undefined;
    depends_on?: string | undefined;
    files?: string | undefined;
    labels?: string | undefined;
    parent_id?: string | null | undefined;
    issue_type?: "epic" | "story" | "task" | "subtask" | undefined;
    due_date?: string | null | undefined;
    start_date?: string | null | undefined;
    estimate_minutes?: number | null | undefined;
    spent_minutes?: number | undefined;
    remaining_minutes?: number | null | undefined;
    custom_fields?: string | null | undefined;
    completed_at?: string | null | undefined;
}>;
export type Task = z.infer<typeof TaskSchema>;
/** A threaded comment on a task, with parent_comment_id for nested replies. */
export declare const TaskCommentSchema: z.ZodObject<{
    id: z.ZodString;
    task_id: z.ZodString;
    parent_comment_id: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    author: z.ZodString;
    body: z.ZodString;
    reactions: z.ZodDefault<z.ZodString>;
    edited_at: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: string;
    task_id: string;
    author: string;
    body: string;
    reactions: string;
    parent_comment_id?: string | null | undefined;
    edited_at?: string | null | undefined;
}, {
    id: string;
    created_at: string;
    task_id: string;
    author: string;
    body: string;
    parent_comment_id?: string | null | undefined;
    reactions?: string | undefined;
    edited_at?: string | null | undefined;
}>;
export type TaskComment = z.infer<typeof TaskCommentSchema>;
/** An audit event recording state transitions on a task (e.g., column move, assignment change). */
export declare const TaskActivitySchema: z.ZodObject<{
    id: z.ZodString;
    task_id: z.ZodString;
    actor: z.ZodString;
    event_type: z.ZodString;
    payload: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: string;
    task_id: string;
    actor: string;
    event_type: string;
    payload?: string | null | undefined;
}, {
    id: string;
    created_at: string;
    task_id: string;
    actor: string;
    event_type: string;
    payload?: string | null | undefined;
}>;
export type TaskActivity = z.infer<typeof TaskActivitySchema>;
/** A dependency link between two tasks: blocks, blocked_by, or relates_to. */
export declare const TaskLinkSchema: z.ZodObject<{
    id: z.ZodString;
    task_id: z.ZodString;
    linked_task_id: z.ZodString;
    link_type: z.ZodEnum<["blocks", "blocked_by", "relates_to"]>;
}, "strip", z.ZodTypeAny, {
    id: string;
    task_id: string;
    linked_task_id: string;
    link_type: "blocks" | "blocked_by" | "relates_to";
}, {
    id: string;
    task_id: string;
    linked_task_id: string;
    link_type: "blocks" | "blocked_by" | "relates_to";
}>;
export type TaskLink = z.infer<typeof TaskLinkSchema>;
/** A notification targeting a specific user about a task event (mention, assignment, watch status change). */
export declare const TaskNotificationSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    recipient: z.ZodString;
    task_id: z.ZodString;
    kind: z.ZodEnum<["mentioned", "assigned", "watched_status"]>;
    read_at: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: string;
    project_id: string;
    task_id: string;
    recipient: string;
    kind: "mentioned" | "assigned" | "watched_status";
    read_at?: string | null | undefined;
}, {
    id: string;
    created_at: string;
    project_id: string;
    task_id: string;
    recipient: string;
    kind: "mentioned" | "assigned" | "watched_status";
    read_at?: string | null | undefined;
}>;
export type TaskNotification = z.infer<typeof TaskNotificationSchema>;
/** Kanban board layout: column definitions and custom field config stored as JSON strings. */
export declare const BoardConfigSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    columns: z.ZodString;
    custom_field_defs: z.ZodDefault<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    created_at: string;
    project_id: string;
    columns: string;
    custom_field_defs: string;
}, {
    updated_at: string;
    id: string;
    created_at: string;
    project_id: string;
    columns: string;
    custom_field_defs?: string | undefined;
}>;
export type BoardConfig = z.infer<typeof BoardConfigSchema>;
/** A recurring or event-triggered job definition with agent assignment and scheduling config. */
export declare const JobSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    agent: z.ZodString;
    prompt_template: z.ZodString;
    schedule_cron: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    trigger_event: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    timeout_minutes: z.ZodDefault<z.ZodNumber>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    enabled: boolean;
    agent: string;
    prompt_template: string;
    timeout_minutes: number;
    description?: string | null | undefined;
    schedule_cron?: string | null | undefined;
    trigger_event?: string | null | undefined;
}, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    agent: string;
    prompt_template: string;
    description?: string | null | undefined;
    enabled?: boolean | undefined;
    schedule_cron?: string | null | undefined;
    trigger_event?: string | null | undefined;
    timeout_minutes?: number | undefined;
}>;
export type Job = z.infer<typeof JobSchema>;
/** A single execution of a job, tracking its lifecycle from queued through completion or failure. */
export declare const JobRunSchema: z.ZodObject<{
    id: z.ZodString;
    job_id: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<["queued", "running", "success", "failed", "timeout", "cancelled"]>>;
    trigger: z.ZodEnum<["manual", "cron", "event"]>;
    started_at: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    finished_at: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    exit_code: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: string;
    status: "failed" | "queued" | "running" | "success" | "timeout" | "cancelled";
    job_id: string;
    trigger: "manual" | "cron" | "event";
    started_at?: string | null | undefined;
    finished_at?: string | null | undefined;
    exit_code?: number | null | undefined;
}, {
    id: string;
    created_at: string;
    job_id: string;
    trigger: "manual" | "cron" | "event";
    status?: "failed" | "queued" | "running" | "success" | "timeout" | "cancelled" | undefined;
    started_at?: string | null | undefined;
    finished_at?: string | null | undefined;
    exit_code?: number | null | undefined;
}>;
export type JobRun = z.infer<typeof JobRunSchema>;
/** An individual line of stdout/stderr output from a job run, ordered by sequence number. */
export declare const JobRunLogSchema: z.ZodObject<{
    id: z.ZodNumber;
    run_id: z.ZodString;
    seq: z.ZodNumber;
    stream: z.ZodEnum<["stdout", "stderr"]>;
    line: z.ZodString;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: number;
    created_at: string;
    run_id: string;
    seq: number;
    stream: "stdout" | "stderr";
    line: string;
}, {
    id: number;
    created_at: string;
    run_id: string;
    seq: number;
    stream: "stdout" | "stderr";
    line: string;
}>;
export type JobRunLog = z.infer<typeof JobRunLogSchema>;
/** A contextual memory entry with priority ranking — used by agents to recall past session context. */
export declare const ContextSchema: z.ZodObject<{
    id: z.ZodNumber;
    project_id: z.ZodString;
    content: z.ZodString;
    priority: z.ZodDefault<z.ZodNumber>;
    tags: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: number;
    created_at: string;
    project_id: string;
    content: string;
    priority: number;
    tags?: string | undefined;
    session_id?: string | undefined;
}, {
    id: number;
    created_at: string;
    project_id: string;
    content: string;
    tags?: string | undefined;
    priority?: number | undefined;
    session_id?: string | undefined;
}>;
export type ContextEntry = z.infer<typeof ContextSchema>;
/** A registered child MCP server with its command, arguments, environment, and origin source tracking. */
export declare const ServerSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    name: z.ZodString;
    command: z.ZodString;
    args: z.ZodOptional<z.ZodString>;
    env: z.ZodOptional<z.ZodString>;
    source: z.ZodDefault<z.ZodEnum<["opencode", "ingenium"]>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    running: z.ZodDefault<z.ZodBoolean>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    source: "opencode" | "ingenium";
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    enabled: boolean;
    running: boolean;
    command: string;
    args?: string | undefined;
    env?: string | undefined;
}, {
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    command: string;
    source?: "opencode" | "ingenium" | undefined;
    enabled?: boolean | undefined;
    running?: boolean | undefined;
    args?: string | undefined;
    env?: string | undefined;
}>;
export type Server = z.infer<typeof ServerSchema>;
/** An observation about user behavior — the raw input to the self-learning pipeline. */
export declare const ObservationSchema: z.ZodObject<{
    id: z.ZodNumber;
    project_id: z.ZodString;
    observation_type: z.ZodEnum<["correction", "preference", "pattern", "insight", "feedback", "behavior", "terminology", "workflow", "error", "goal"]>;
    content: z.ZodString;
    importance: z.ZodDefault<z.ZodNumber>;
    source: z.ZodDefault<z.ZodEnum<["agent", "email", "chat", "document", "calendar", "synthesis", "import", "manual", "auto-observer"]>>;
    context: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["pending", "processed", "skipped", "failed"]>>;
    session_id: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    source: "auto-observer" | "agent" | "manual" | "email" | "chat" | "document" | "calendar" | "synthesis" | "import";
    updated_at: string;
    id: number;
    created_at: string;
    status: "pending" | "processed" | "failed" | "skipped";
    project_id: string;
    content: string;
    observation_type: "error" | "pattern" | "preference" | "correction" | "insight" | "feedback" | "behavior" | "terminology" | "workflow" | "goal";
    importance: number;
    session_id?: string | undefined;
    context?: string | undefined;
}, {
    updated_at: string;
    id: number;
    created_at: string;
    project_id: string;
    content: string;
    observation_type: "error" | "pattern" | "preference" | "correction" | "insight" | "feedback" | "behavior" | "terminology" | "workflow" | "goal";
    source?: "auto-observer" | "agent" | "manual" | "email" | "chat" | "document" | "calendar" | "synthesis" | "import" | undefined;
    status?: "pending" | "processed" | "failed" | "skipped" | undefined;
    session_id?: string | undefined;
    importance?: number | undefined;
    context?: string | undefined;
}>;
export type Observation = z.infer<typeof ObservationSchema>;
/** A consolidated personality trait derived from observations by the synthesis pipeline. Confidence reflects corroboration strength. */
export declare const PersonalityTraitSchema: z.ZodObject<{
    id: z.ZodNumber;
    project_id: z.ZodString;
    trait_type: z.ZodEnum<["communication_style", "code_preference", "workflow_pattern", "terminology", "priority_signal", "feedback_style", "interaction_pattern", "domain_knowledge", "learned_skill", "personality_trait"]>;
    trait_value: z.ZodString;
    display_label: z.ZodOptional<z.ZodString>;
    confidence: z.ZodDefault<z.ZodNumber>;
    exemplar_observation_id: z.ZodOptional<z.ZodNumber>;
    exemplar_text: z.ZodOptional<z.ZodString>;
    source: z.ZodDefault<z.ZodString>;
    is_active: z.ZodDefault<z.ZodBoolean>;
    metadata: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    source: string;
    updated_at: string;
    id: number;
    created_at: string;
    project_id: string;
    trait_type: "terminology" | "communication_style" | "code_preference" | "workflow_pattern" | "priority_signal" | "feedback_style" | "interaction_pattern" | "domain_knowledge" | "learned_skill" | "personality_trait";
    trait_value: string;
    confidence: number;
    is_active: boolean;
    display_label?: string | undefined;
    exemplar_observation_id?: number | undefined;
    exemplar_text?: string | undefined;
    metadata?: string | undefined;
}, {
    updated_at: string;
    id: number;
    created_at: string;
    project_id: string;
    trait_type: "terminology" | "communication_style" | "code_preference" | "workflow_pattern" | "priority_signal" | "feedback_style" | "interaction_pattern" | "domain_knowledge" | "learned_skill" | "personality_trait";
    trait_value: string;
    source?: string | undefined;
    display_label?: string | undefined;
    confidence?: number | undefined;
    exemplar_observation_id?: number | undefined;
    exemplar_text?: string | undefined;
    is_active?: boolean | undefined;
    metadata?: string | undefined;
}>;
export type PersonalityTrait = z.infer<typeof PersonalityTraitSchema>;
/** An OpenCode plugin with file path and optional source content cache for disk-write operations. */
export declare const PluginSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    name: z.ZodString;
    file_path: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    source_content: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    enabled: boolean;
    file_path: string;
    source_content?: string | undefined;
}, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    file_path: string;
    enabled?: boolean | undefined;
    source_content?: string | undefined;
}>;
export type Plugin = z.infer<typeof PluginSchema>;
/** Per-tool enable/disable state for child MCP servers — allows toggling individual tools at runtime. */
export declare const MCPToolStateSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodNumber>;
    project_id: z.ZodString;
    tool_name: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    created_at: string;
    project_id: string;
    enabled: boolean;
    tool_name: string;
    id?: number | undefined;
}, {
    updated_at: string;
    created_at: string;
    project_id: string;
    tool_name: string;
    id?: number | undefined;
    enabled?: boolean | undefined;
}>;
export type MCPToolState = z.infer<typeof MCPToolStateSchema>;
/** A slash-command definition with an associated file path and optional content. */
export declare const CommandSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    name: z.ZodString;
    file_path: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    file_path: string;
    content?: string | undefined;
}, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    file_path: string;
    content?: string | undefined;
}>;
export type Command = z.infer<typeof CommandSchema>;
/** An agent profile with category, model, permission, and skill assignments. */
export declare const AgentSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    name: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    category: z.ZodDefault<z.ZodEnum<["primary", "execution", "research", "security"]>>;
    mode: z.ZodDefault<z.ZodEnum<["primary", "subagent"]>>;
    model: z.ZodOptional<z.ZodString>;
    reasoning_effort: z.ZodOptional<z.ZodString>;
    permissions: z.ZodDefault<z.ZodString>;
    skills: z.ZodDefault<z.ZodString>;
    content: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    description: string;
    content: string;
    category: "research" | "primary" | "execution" | "security";
    enabled: boolean;
    mode: "primary" | "subagent";
    permissions: string;
    skills: string;
    model?: string | undefined;
    reasoning_effort?: string | undefined;
}, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    project_id: string;
    content: string;
    description?: string | undefined;
    category?: "research" | "primary" | "execution" | "security" | undefined;
    enabled?: boolean | undefined;
    mode?: "primary" | "subagent" | undefined;
    model?: string | undefined;
    reasoning_effort?: string | undefined;
    permissions?: string | undefined;
    skills?: string | undefined;
}>;
export type Agent = z.infer<typeof AgentSchema>;
/** Project-level or global `opencode.json` configuration stored in the DB for API-driven editing. */
export declare const ConfigSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    type: z.ZodEnum<["project", "global"]>;
    content: z.ZodString;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    created_at: string;
    type: "project" | "global";
    project_id: string;
    content: string;
}, {
    updated_at: string;
    id: string;
    created_at: string;
    type: "project" | "global";
    project_id: string;
    content: string;
}>;
export type Config = z.infer<typeof ConfigSchema>;
/** An event in the self-learning pipeline timeline — tracks extraction, synthesis, and trait/skill lifecycle. */
export declare const PipelineEventSchema: z.ZodObject<{
    id: z.ZodNumber;
    project_id: z.ZodString;
    event_type: z.ZodEnum<["session_created", "session_idle", "observation_created", "observation_imported", "observation_detected", "synthesis_triggered", "synthesis_started", "synthesis_completed", "synthesis_failed", "extraction_completed", "extraction_failed", "trait_created", "trait_updated", "skill_created", "skill_updated", "proposal_created", "proposal_submitted", "proposal_approved", "proposal_rejected", "proposal_applied", "proposal_rolled_back", "plugin_initialized", "plugin_error"]>;
    event_source: z.ZodEnum<["agent", "plugin", "synthesis", "system"]>;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    data: z.ZodOptional<z.ZodString>;
    parent_event_id: z.ZodOptional<z.ZodNumber>;
    session_id: z.ZodOptional<z.ZodString>;
    importance: z.ZodDefault<z.ZodNumber>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: number;
    created_at: string;
    project_id: string;
    title: string;
    event_type: "extraction_completed" | "session_created" | "session_idle" | "observation_created" | "observation_imported" | "observation_detected" | "synthesis_triggered" | "synthesis_started" | "synthesis_completed" | "synthesis_failed" | "extraction_failed" | "trait_created" | "trait_updated" | "skill_created" | "skill_updated" | "proposal_created" | "proposal_submitted" | "proposal_approved" | "proposal_rejected" | "proposal_applied" | "proposal_rolled_back" | "plugin_initialized" | "plugin_error";
    importance: number;
    event_source: "system" | "agent" | "plugin" | "synthesis";
    description?: string | undefined;
    session_id?: string | undefined;
    data?: string | undefined;
    parent_event_id?: number | undefined;
}, {
    id: number;
    created_at: string;
    project_id: string;
    title: string;
    event_type: "extraction_completed" | "session_created" | "session_idle" | "observation_created" | "observation_imported" | "observation_detected" | "synthesis_triggered" | "synthesis_started" | "synthesis_completed" | "synthesis_failed" | "extraction_failed" | "trait_created" | "trait_updated" | "skill_created" | "skill_updated" | "proposal_created" | "proposal_submitted" | "proposal_approved" | "proposal_rejected" | "proposal_applied" | "proposal_rolled_back" | "plugin_initialized" | "plugin_error";
    event_source: "system" | "agent" | "plugin" | "synthesis";
    description?: string | undefined;
    session_id?: string | undefined;
    importance?: number | undefined;
    data?: string | undefined;
    parent_event_id?: number | undefined;
}>;
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;
/** Non-sensitive metadata for an encrypted vault item. */
export declare const VaultItemSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    folder_id: z.ZodNullable<z.ZodString>;
    name: z.ZodString;
    type: z.ZodEnum<["login", "api_key", "note", "oauth"]>;
    tags: z.ZodDefault<z.ZodString>;
    urls: z.ZodDefault<z.ZodString>;
    username: z.ZodNullable<z.ZodString>;
    version: z.ZodDefault<z.ZodNumber>;
    access_policy: z.ZodDefault<z.ZodString>;
    expires_at: z.ZodNullable<z.ZodString>;
    lease_duration_seconds: z.ZodNullable<z.ZodNumber>;
    last_accessed_at: z.ZodNullable<z.ZodString>;
    access_count: z.ZodDefault<z.ZodNumber>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    type: "login" | "api_key" | "note" | "oauth";
    project_id: string;
    tags: string;
    folder_id: string | null;
    urls: string;
    username: string | null;
    version: number;
    access_policy: string;
    expires_at: string | null;
    lease_duration_seconds: number | null;
    last_accessed_at: string | null;
    access_count: number;
}, {
    updated_at: string;
    id: string;
    name: string;
    created_at: string;
    type: "login" | "api_key" | "note" | "oauth";
    project_id: string;
    folder_id: string | null;
    username: string | null;
    expires_at: string | null;
    lease_duration_seconds: number | null;
    last_accessed_at: string | null;
    tags?: string | undefined;
    urls?: string | undefined;
    version?: number | undefined;
    access_policy?: string | undefined;
    access_count?: number | undefined;
}>;
export type VaultItem = z.infer<typeof VaultItemSchema>;
/** A folder used to organize vault items within a project. */
export declare const VaultFolderSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    name: z.ZodString;
    parent_folder_id: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    project_id: string;
    parent_folder_id: string | null;
}, {
    id: string;
    name: string;
    project_id: string;
    parent_folder_id: string | null;
}>;
export type VaultFolder = z.infer<typeof VaultFolderSchema>;
/** An immutable audit record for vault activity. */
export declare const VaultAuditSchema: z.ZodObject<{
    id: z.ZodNumber;
    project_id: z.ZodString;
    event_type: z.ZodString;
    item_id: z.ZodNullable<z.ZodString>;
    actor: z.ZodString;
    details: z.ZodNullable<z.ZodString>;
    ip_address: z.ZodNullable<z.ZodString>;
    user_agent: z.ZodNullable<z.ZodString>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: number;
    created_at: string;
    project_id: string;
    actor: string;
    event_type: string;
    item_id: string | null;
    details: string | null;
    ip_address: string | null;
    user_agent: string | null;
}, {
    id: number;
    created_at: string;
    project_id: string;
    actor: string;
    event_type: string;
    item_id: string | null;
    details: string | null;
    ip_address: string | null;
    user_agent: string | null;
}>;
export type VaultAudit = z.infer<typeof VaultAuditSchema>;
/** The current status of the in-memory vault session and project inventory. */
export declare const VaultStatusSchema: z.ZodObject<{
    sealed: z.ZodBoolean;
    items_count: z.ZodNumber;
    folders_count: z.ZodNumber;
    last_unsealed: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    sealed: boolean;
    items_count: number;
    folders_count: number;
    last_unsealed: string | null;
}, {
    sealed: boolean;
    items_count: number;
    folders_count: number;
    last_unsealed: string | null;
}>;
export type VaultStatus = z.infer<typeof VaultStatusSchema>;
/** Metadata for a project-scoped Ingenium and OpenCode database snapshot. */
export declare const BackupRecordSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    filename: z.ZodString;
    size_bytes: z.ZodNumber;
    sha256: z.ZodString;
    backup_type: z.ZodEnum<["manual", "scheduled_hourly", "scheduled_daily", "pre_restore"]>;
    components: z.ZodDefault<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["pending", "in_progress", "completed", "failed"]>>;
    error_message: z.ZodNullable<z.ZodString>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: string;
    status: "pending" | "failed" | "in_progress" | "completed";
    project_id: string;
    filename: string;
    size_bytes: number;
    sha256: string;
    backup_type: "manual" | "scheduled_hourly" | "scheduled_daily" | "pre_restore";
    components: string;
    error_message: string | null;
}, {
    id: string;
    created_at: string;
    project_id: string;
    filename: string;
    size_bytes: number;
    sha256: string;
    backup_type: "manual" | "scheduled_hourly" | "scheduled_daily" | "pre_restore";
    error_message: string | null;
    status?: "pending" | "failed" | "in_progress" | "completed" | undefined;
    components?: string | undefined;
}>;
export type BackupRecord = z.infer<typeof BackupRecordSchema>;
/** Lifecycle state for a restore request associated with a backup snapshot. */
export declare const BackupRestoreJobSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    backup_id: z.ZodNullable<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["validating", "confirmed", "applying", "completed", "failed", "rolled_back"]>>;
    components: z.ZodDefault<z.ZodString>;
    error_message: z.ZodNullable<z.ZodString>;
    started_at: z.ZodNullable<z.ZodString>;
    completed_at: z.ZodNullable<z.ZodString>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: string;
    status: "rolled_back" | "failed" | "completed" | "validating" | "confirmed" | "applying";
    project_id: string;
    completed_at: string | null;
    started_at: string | null;
    components: string;
    error_message: string | null;
    backup_id: string | null;
}, {
    id: string;
    created_at: string;
    project_id: string;
    completed_at: string | null;
    started_at: string | null;
    error_message: string | null;
    backup_id: string | null;
    status?: "rolled_back" | "failed" | "completed" | "validating" | "confirmed" | "applying" | undefined;
    components?: string | undefined;
}>;
export type BackupRestoreJob = z.infer<typeof BackupRestoreJobSchema>;
/** An ingestion source for RAG-backed documentation search. */
export declare const RagSourceSchema: z.ZodObject<{
    id: z.ZodString;
    project_id: z.ZodString;
    title: z.ZodString;
    source_type: z.ZodEnum<["file", "thread_import", "text", "url"]>;
    source_path: z.ZodNullable<z.ZodString>;
    source_hash: z.ZodNullable<z.ZodString>;
    mime_type: z.ZodNullable<z.ZodString>;
    byte_size: z.ZodNullable<z.ZodNumber>;
    chunk_count: z.ZodDefault<z.ZodNumber>;
    metadata: z.ZodDefault<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updated_at: string;
    id: string;
    created_at: string;
    project_id: string;
    source_hash: string | null;
    title: string;
    metadata: string;
    source_type: "file" | "thread_import" | "text" | "url";
    source_path: string | null;
    mime_type: string | null;
    byte_size: number | null;
    chunk_count: number;
}, {
    updated_at: string;
    id: string;
    created_at: string;
    project_id: string;
    source_hash: string | null;
    title: string;
    source_type: "file" | "thread_import" | "text" | "url";
    source_path: string | null;
    mime_type: string | null;
    byte_size: number | null;
    metadata?: string | undefined;
    chunk_count?: number | undefined;
}>;
export type RagSource = z.infer<typeof RagSourceSchema>;
/** A token-aware, searchable segment belonging to a RAG source. */
export declare const RagChunkSchema: z.ZodObject<{
    id: z.ZodString;
    source_id: z.ZodString;
    chunk_index: z.ZodNumber;
    content: z.ZodString;
    token_count: z.ZodDefault<z.ZodNumber>;
    heading_path: z.ZodNullable<z.ZodString>;
    priority: z.ZodDefault<z.ZodNumber>;
    tags: z.ZodDefault<z.ZodString>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: string;
    content: string;
    tags: string;
    priority: number;
    source_id: string;
    chunk_index: number;
    token_count: number;
    heading_path: string | null;
}, {
    id: string;
    created_at: string;
    content: string;
    source_id: string;
    chunk_index: number;
    heading_path: string | null;
    tags?: string | undefined;
    priority?: number | undefined;
    token_count?: number | undefined;
}>;
export type RagChunk = z.infer<typeof RagChunkSchema>;
/** A RAG chunk enriched with FTS relevance rank and highlighted excerpt. */
export declare const RagSearchResultSchema: z.ZodObject<{
    id: z.ZodString;
    source_id: z.ZodString;
    chunk_index: z.ZodNumber;
    content: z.ZodString;
    token_count: z.ZodDefault<z.ZodNumber>;
    heading_path: z.ZodNullable<z.ZodString>;
    priority: z.ZodDefault<z.ZodNumber>;
    tags: z.ZodDefault<z.ZodString>;
    created_at: z.ZodString;
} & {
    rank: z.ZodNumber;
    snippet: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: string;
    content: string;
    tags: string;
    priority: number;
    source_id: string;
    chunk_index: number;
    token_count: number;
    heading_path: string | null;
    rank: number;
    snippet: string;
}, {
    id: string;
    created_at: string;
    content: string;
    source_id: string;
    chunk_index: number;
    heading_path: string | null;
    rank: number;
    snippet: string;
    tags?: string | undefined;
    priority?: number | undefined;
    token_count?: number | undefined;
}>;
export type RagSearchResult = z.infer<typeof RagSearchResultSchema>;
//# sourceMappingURL=schema.d.ts.map