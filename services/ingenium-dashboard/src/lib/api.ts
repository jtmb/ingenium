/** @default "http://localhost:4097/api/v1" — overridden via NEXT_PUBLIC_API_URL env var at build or runtime. */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4097/api/v1";
/**
 * Default project for API calls when no explicit project is selected.
 * The API resolves this to the global-default project (is_global=1).
 */
const DEFAULT_PROJECT = "global-default";

/**
 * Typed fetch wrapper for the Ingenium API.
 *
 * - Throws on non-OK responses, extracting the server's error message when available
 * - Handles 204 No Content (returned by DELETE endpoints) without trying to parse JSON
 * - Overwrites the `Content-Type` header if `options.headers` is provided, so callers
 *   can pass FormData (for file uploads) without the default JSON header
 */
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-ingenium-ui": "dashboard",
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? res.statusText);
  }
  // 204 No Content — returned by DELETE endpoints; no body to parse
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** A project managed by Ingenium. */
export type Project = { id: string; name: string; path?: string; archived_at?: string; created_at: string; updated_at: string; is_global?: boolean };

/** An AI agent skill with its full content.
 * Matches the raw API row shape exactly (the API deliberately preserves raw DB rows):
 * - enabled is the raw numeric 0/1 (SQLite boolean)
 * - file_tree / category / tags / archived_at are nullable
 * - project_id and revision are always present in the raw row
 */
export type Skill = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  content: string;
  category: string | null;
  tags: string | null;
  always_apply: number;
  file_tree: string | null;
  enabled: 0 | 1;
  revision: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A learning entry — decisions, patterns, bugs, or preferences. */
export type Learning = { id: number; entry_type: string; content: string; tags?: string; priority: number; created_at: string };

/** A Kaban-board-style task with column tracking. */
export type Task = {
  id: string;
  title: string;
  description?: string;
  column_id: string;
  assigned_to?: string;
  priority?: string;
  due_date?: string;
  start_date?: string;
  epic_id?: string;
  story_id?: string;
  issue_type?: string;
  estimated_hours?: number;
  spent_hours?: number;
  estimate_minutes?: number;
  spent_minutes?: number;
  remaining_minutes?: number;
  sort_order?: number;
  custom_fields?: Record<string, any>;
  created_at: string;
  completed_at?: string;
};

/** A single board column definition. */
export type BoardColumn = { id: string; name: string; wip_limit?: number; order: number };

/** A custom field definition for the board. */
export type CustomFieldDef = {
  name: string;
  type: "text" | "paragraph" | "number" | "date" | "datetime" | "single_select" | "multi_select" | "checkboxes" | "radio" | "url";
  options?: string[];
  formula?: string;
};

/** Board configuration with columns and custom field definitions. */
export type BoardConfig = { columns: BoardColumn[]; custom_field_defs?: CustomFieldDef[] };

/** A comment on a task. */
export type TaskComment = {
  id: string;
  task_id: string;
  body: string;
  author?: string;
  parent_comment_id?: string;
  edited_at?: string;
  reactions?: Record<string, number>;
  created_at: string;
};

/** An activity log entry for a task. */
export type TaskActivity = { id: string; task_id: string; action: string; field?: string; old_value?: string; new_value?: string; actor?: string; created_at: string };

/** A link between tasks. */
export type TaskLink = { id: string; task_id: string; linked_task_id: string; link_type: string };

/** A task notification. */
export type TaskNotification = { id: string; task_id: string; recipient: string; type: string; message: string; read: boolean; created_at: string };

/** An MCP plugin registered in the system. */
export type Plugin = { id: string; name: string; file_path: string; enabled: boolean; source_content?: string };

/** An AI agent definition synced to OpenCode. */
export type Agent = {
  id: string;
  name: string;
  description: string;
  category: string;
  mode: string;
  model?: string;
  reasoning_effort?: string;
  content: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

/** An MCP server configuration. */
export type Server = { id: string; name: string; command: string; running: boolean; enabled: boolean; source?: "opencode" | "ingenium" };

/** An observation recorded by the agent during interactions. */
export type Observation = {
  id: number;
  project_id: string;
  observation_type: string;
  content: string;
  importance?: number;
  status: string;
  source?: string;
  context?: string;
  session_id?: string;
  created_at: string;
  updated_at: string;
};

/** A system log entry from the Ingenium server. */
export type LogEntry = {
  timestamp: string;
  source: string;
  level: string;
  message: string;
  data: any;
};

/** A pipeline event recorded during observation/synthesis/trait lifecycles. */
export type PipelineEvent = {
  id: number;
  project_id: string;
  event_type: string;
  event_source: string;
  title: string;
  description?: string;
  data?: any;
  parent_event_id?: number;
  session_id?: string;
  importance: number;
  created_at: string;
};

/** ========== Email Types ========== */

export type EmailProvider = "gmail" | "outlook" | "yahoo" | "custom";

export type AuthType = "oauth2" | "app_password";

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailAttachment {
  partId: string;
  filename: string;
  size: number;
  mimeType: string;
}

export interface EmailMessage {
  uid: number;
  messageId?: string;
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  date: string;
  body: {
    text?: string;
    html?: string;
  };
  attachments: EmailAttachment[];
  flags: string[];
  folder: string;
  threadId?: string;
}

export interface EmailFolder {
  name: string;
  path: string;
  delimiter: string;
  flags: string[];
  totalMessages: number;
  unreadMessages: number;
}

export interface EmailAccount {
  id: string;
  email: string;
  name: string;
  provider: EmailProvider;
  authType: AuthType;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  connected: boolean;
  lastSync?: string;
}

export interface TriageResult {
  emailUid: number;
  category: string;
  priority: "high" | "medium" | "low";
  suggestedAction: "reply_now" | "draft" | "review_later" | "ignore";
  matchedSkills: string[];
  confidence: number;
}

export interface ResponseSuggestion {
  emailUid: number;
  subject: string;
  body: string;
  matchedSkill: string;
  confidence: number;
}

/** A scheduled/triggered job that runs agents. */
export type Job = {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
  agent: string;
  prompt_template: string;
  schedule_cron?: string | null;
  trigger_event?: string | null;
  /**
   * SQLite stores booleans as 0/1 integers. The API returns them as numbers,
   * but we type as `boolean` for ergonomic usage. Truthy/falsy coercion works
   * for checkboxes and ternaries; use `!!enabled` when a strict boolean is needed.
   */
  enabled: boolean;
  timeout_minutes: number;
  created_at: string;
  updated_at: string;
};

/** A single execution run of a job. */
export type JobRun = {
  id: string;
  job_id: string;
  status: "queued" | "running" | "success" | "failed" | "timeout" | "cancelled";
  trigger: "manual" | "cron" | "event";
  started_at?: string;
  finished_at?: string;
  exit_code?: number;
  created_at: string;
};

/** A single log line from a job run. */
export type JobRunLog = {
  id: number;
  run_id: string;
  seq: number;
  stream: "stdout" | "stderr";
  line: string;
  created_at: string;
};

/** ========== Vault Types ========== */

export type VaultStatus = "sealed" | "unsealed";

export type VaultItemType = "login" | "api_key" | "note" | "oauth";

export interface VaultFolder {
  id: string;
  name: string;
  item_count: number;
  created_at: string;
}

export interface VaultItem {
  id: string;
  name: string;
  type: VaultItemType;
  folder_id: string | null;
  folder_name?: string;
  username?: string;
  urls?: string;
  tags?: string;
  created_at: string;
  updated_at: string;
}

export interface VaultItemDetail extends VaultItem {
  value?: string; // only populated on reveal
  notes?: string;
  password_strength?: number;
}

export interface AuditEntry {
  id: string;
  item_id: string;
  item_name: string;
  action: string;
  actor?: string;
  created_at: string;
}

/** A backup file with metadata. */
export type BackupType = "manual" | "hourly" | "daily";

export interface Backup {
  id: string;
  filename: string;
  type: BackupType;
  /** Raw size in bytes */
  size: number;
  created_at: string;
  status: "completed" | "in_progress" | "failed";
}

/** The backup schedule configuration. */
export interface BackupSchedule {
  hourly: { enabled: boolean; retention: number };
  daily: { enabled: boolean; retention: number };
  manual_retention: number;
}

/** A learned personality trait derived from observations via synthesis. */
export type PersonalityTrait = {
  id: number;
  project_id: string;
  trait_type: string;
  trait_value: string;
  display_label?: string;
  confidence?: number;
  exemplar_text?: string;
  source?: string;
  is_active?: boolean;
  created_at: string;
  updated_at: string;
};

/** Dashboard summary types — matching GET /api/v1/dashboard/summary response. */

/** Sanitized Chat config response — no API keys exposed. */
export interface ChatConfigProviderInfo {
  providerId: string;
  modelId: string;
  label: string;
  isCustom: boolean;
}

/** A single model within a provider. */
export interface ChatProviderModel {
  id: string;
  label: string;
}

/** Expanded provider info used in the providers[] array. */
export interface ChatProviderInfo {
  providerId: string;
  label: string;
  models: ChatProviderModel[];
  defaultModel: string;
  source: "managed" | "builtin";
}

export interface ChatConfigResponse {
  configured: boolean;
  primary: ChatConfigProviderInfo | null;
  backup: ChatConfigProviderInfo | null;
  agents: Array<{ name: string; label: string }>;
  restartRequired: boolean;
  providers: ChatProviderInfo[];
  defaultSelection: { providerId: string; modelId: string } | null;
}

/** POST /settings/llm-config request body — primary + backup LLM config. */
export interface LlmConfigBody {
  primary: {
    provider: string;
    model: string;
    apiKey?: string;
    endpoint?: string;
  };
  backup?: {
    provider: string;
    model: string;
    apiKey?: string;
    endpoint?: string;
  };
}

/** Sanitized LLM configuration returned to Settings — never contains API keys. */
export interface LlmConfigEntry {
  provider: string;
  model: string;
  endpoint: string;
  apiKeySet: boolean;
}

export interface LlmConfigResponse {
  primary: LlmConfigEntry;
  backup: LlmConfigEntry | null;
}

export type ProviderRole = "available" | "primary" | "backup";

export interface ManagedProviderConfig {
  id: string;
  name: string;
  npm: string;
  baseURL: string;
  models: string[];
  defaultModel: string;
  roles: ProviderRole[];
  enabled: boolean;
  apiKeySet: boolean;
  apiKey?: string;
}

interface LearningSummary {
  pendingObservations: number;
  displayTraitsCount: number;
  lastSynthesisAt: string | null;
  synthesisIntervalMs: number;
}

interface TasksSummary {
  todoCount: number;
  inProgressCount: number;
  reviewCount: number;
  nextTask: { id: string; title: string } | null;
}

interface JobsSummary {
  total: number;
  enabledCount: number;
  failedRecently: Array<{ id: string; name: string; finishedAt: string | null }>;
}

interface MailSummary {
  accountCount: number;
  engineRunning: boolean;
  engineHealthy: boolean;
}

export interface AttentionItem {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  timestamp: string;
  action?: { label: string; route: string };
}

export interface AttentionData {
  items: AttentionItem[];
  count: number;
}

export interface ResumeData {
  lastVisitedPages: Array<{
    route: string;
    label: string;
    timestamp: string;
  }>;
  activeSession?: {
    type: "opencode" | "mail" | "docs";
    label: string;
    detail?: string;
  };
}

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  timestamp: string;
  route?: string;
}

export interface HealthData {
  api: { status: "ok" | "degraded" | "down"; uptime: number };
  dashboard: { status: "ok" | "down" };
  opencode: { status: "ok" | "down" };
  docker: { status: "healthy" | "unhealthy" | "unknown" };
  services: Array<{ name: string; status: string; uptime?: number }>;
}

export interface DashboardSummary {
  learning: LearningSummary | null;
  tasks: TasksSummary | null;
  jobs: JobsSummary | null;
  mail: MailSummary | null;
  attention: AttentionData | null;
  resume: ResumeData | null;
  activity: ActivityItem[] | null;
  health: HealthData | null;
  generatedAt: string;
}

/** ========== Docs Types (re-exported from canonical docs-types.ts) ========== */

export type {
  DocSpace,
  DocPage,
  DocPageTree,
  DocDraft,
  DocComment,
  DocVersion,
  DocSearchResult,
  DocTag,
  DocBacklink,
  DocTemplate,
  DocTrashItem,
  DocAttachment,
  DocProjectLink,
  DocStats,
  DocExportData,
  ImportPreview,
} from "./docs-types";

/**
 * Typed API client for the Ingenium backend.
 *
 * Every method accepts an optional `project` parameter defaulting to `"global-default"`.
 * Methods that accept user-controlled path segments (names, IDs) use `encodeURIComponent`
 * to prevent path-traversal injection.
 *
 * The client exposes 15 resource groups: projects, skills, learnings, tasks, plugins,
 * agents, servers, observations, personality, synthesis, pipeline, emails, settings,
 * configs, logs, mcpTools, jobs, docs, and home (dashboard summary).
 */
export const api = {
  projects: {
    list: () => request<{ data: Project[] }>("/projects"),
    create: (name: string) => request<{ data: Project }>("/projects", { method: "POST", body: JSON.stringify({ name }) }),
    archive: (name: string) => request<{ data: { archived: boolean } }>(`/projects/${name}`, { method: "DELETE" }),
    restore: (name: string) => request<{ data: { restored: boolean } }>(`/projects/${name}/restore`, { method: "POST" }),
    purge: (retentionDays?: number) =>
      request<{ data: { purged_count: number } }>("/projects/purge", { method: "POST", body: JSON.stringify({ retention_days: retentionDays ?? 7 }) }),
    listArchived: () => request<{ data: Project[] }>("/projects/archive"),
    update: (currentName: string, newName: string) =>
      request<{ data: Project }>(`/projects/${encodeURIComponent(currentName)}`, { method: "PATCH", body: JSON.stringify({ name: newName }) }),
    detail: (name: string) => request<{ data: any }>(`/projects/${encodeURIComponent(name)}/detail`),
    purgeOne: (name: string) => request<null>(`/projects/${encodeURIComponent(name)}/purge`, { method: "DELETE" }),
  },
  skills: {
    list: (project = DEFAULT_PROJECT) => request<{ data: Skill[] }>(`/skills?project=${project}`),
    get: (name: string, project = DEFAULT_PROJECT) => request<{ data: Skill }>(`/skills/${name}?project=${project}`),
    create: (name: string, description: string, content: string, project = DEFAULT_PROJECT) =>
      request<{ data: Skill }>(`/skills?project=${project}`, { method: "POST", body: JSON.stringify({ name, description, content }) }),
    update: (name: string, content: string, extra?: { tags?: string; always_apply?: number; files?: string }, project = DEFAULT_PROJECT) =>
      request<{ data: Skill }>(`/skills/${encodeURIComponent(name)}?project=${project}`, { 
        method: "PATCH", 
        body: JSON.stringify({ content, ...(extra || {}) })
      }),
    // Governance
    proposals: {
      list: (project = DEFAULT_PROJECT, status?: string) => 
        request<{ data: any[] }>(`/skills/proposals?project=${project}${status ? `&status=${status}` : ''}`),
      get: (proposalId: string, project = DEFAULT_PROJECT) => 
        request<{ data: any }>(`/skills/proposals/${encodeURIComponent(proposalId)}?project=${project}`),
      create: (body: any, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/skills/proposals?project=${project}`, { method: 'POST', body: JSON.stringify(body) }),
      submit: (proposalId: string, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/skills/proposals/${encodeURIComponent(proposalId)}/submit?project=${project}`, { method: 'POST' }),
      approve: (proposalId: string, reviewer: string, reason?: string, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/skills/proposals/${encodeURIComponent(proposalId)}/approve?project=${project}`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) }),
      reject: (proposalId: string, reviewer: string, reason?: string, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/skills/proposals/${encodeURIComponent(proposalId)}/reject?project=${project}`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) }),
      rollback: (proposalId: string, reviewer: string, reason?: string, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/skills/proposals/${encodeURIComponent(proposalId)}/rollback?project=${project}`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) }),
    },
    versions: {
      list: (name: string, project = DEFAULT_PROJECT) =>
        request<{ data: any[] }>(`/skills/${encodeURIComponent(name)}/versions?project=${project}`),
    },
    archived: {
      list: (project = DEFAULT_PROJECT) =>
        request<{ data: any[] }>(`/skills/archived?project=${project}`),
      restore: (name: string, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/skills/${encodeURIComponent(name)}/restore?project=${project}`, { method: 'POST' }),
    },
  },
  learnings: {
    list: (project = DEFAULT_PROJECT) => request<{ data: Learning[] }>(`/learnings?project=${project}`),
    create: (entry_type: string, content: string, tags?: string, project = DEFAULT_PROJECT) =>
      request<{ data: Learning }>(`/learnings?project=${project}`, { method: "POST", body: JSON.stringify({ entry_type, content, tags }) }),
  },
  tasks: {
    list: (project = DEFAULT_PROJECT) => request<{ data: Task[] }>(`/tasks?project=${project}`),
    create: (title: string, project = DEFAULT_PROJECT, fields?: Partial<Task>) =>
      request<{ data: Task }>(`/tasks?project=${project}`, { method: "POST", body: JSON.stringify({ title, ...fields }) }),
    move: (id: string, column_id: string, project = DEFAULT_PROJECT) =>
      request<{ data: Task }>(`/tasks/${id}?project=${project}`, { method: "PATCH", body: JSON.stringify({ column_id }) }),
    update: (id: string, fields: Partial<Task>, project = DEFAULT_PROJECT) =>
      request<{ data: Task }>(`/tasks/${id}?project=${project}`, { method: "PATCH", body: JSON.stringify(fields) }),
    delete: (id: string, project = DEFAULT_PROJECT) =>
      request(`/tasks/${id}?project=${project}`, { method: "DELETE" }),
    complete: (id: string, project = DEFAULT_PROJECT) =>
      request<{ data: Task }>(`/tasks/${id}?project=${project}`, { method: "PATCH", body: JSON.stringify({ column_id: "done" }) }),
    search: (query: string, project = DEFAULT_PROJECT) =>
      request<{ data: Task[] }>(`/tasks/search?project=${project}&q=${encodeURIComponent(query)}`),
    comments: (taskId: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskComment[] }>(`/tasks/${taskId}/comments?project=${project}`),
    addComment: (taskId: string, body: string, author = "user", parentCommentId?: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskComment }>(`/tasks/${taskId}/comments?project=${project}`, { method: "POST", body: JSON.stringify({ author, body, parent_comment_id: parentCommentId }) }),
    reactToComment: (taskId: string, commentId: string, reaction: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskComment }>(`/tasks/${taskId}/comments/${commentId}/react?project=${project}`, { method: "POST", body: JSON.stringify({ reaction }) }),
    boardConfig: (project = DEFAULT_PROJECT) =>
      request<{ data: BoardConfig }>(`/tasks/board-config?project=${project}`),
    updateBoardConfig: (data: BoardConfig, project = DEFAULT_PROJECT) =>
      request<{ data: BoardConfig }>(`/tasks/board-config?project=${project}`, { method: "PUT", body: JSON.stringify(data) }),
    notifications: (recipient?: string, unread?: boolean, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project });
      if (recipient) params.set("recipient", recipient);
      if (unread) params.set("unread", "1");
      return request<{ data: TaskNotification[] }>(`/tasks/notifications?${params}`);
    },
    readNotification: (notificationId: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskNotification }>(`/tasks/notifications/${notificationId}/read?project=${project}`, { method: "POST" }),
    activity: (taskId: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskActivity[] }>(`/tasks/${taskId}/activity?project=${project}`),
    links: (taskId: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskLink[] }>(`/tasks/${taskId}/links?project=${project}`),
    addLink: (taskId: string, data: { linked_task_id: string; link_type: string }, project = DEFAULT_PROJECT) =>
      request<{ data: TaskLink }>(`/tasks/${taskId}/links?project=${project}`, { method: "POST", body: JSON.stringify(data) }),
    removeLink: (taskId: string, linkId: string, project = DEFAULT_PROJECT) =>
      request(`/tasks/${taskId}/links/${linkId}?project=${project}`, { method: "DELETE" }),
    bulkUpdate: (data: { task_ids: string[]; column_id?: string; assigned_to?: string; priority?: string }, project = DEFAULT_PROJECT) =>
      request<{ data: { updated: number } }>(`/tasks/bulk?project=${project}`, { method: "POST", body: JSON.stringify(data) }),
  },
  plugins: {
    list: (project = DEFAULT_PROJECT) => request<{ data: Plugin[] }>(`/plugins?project=${project}`),
    get: (name: string, project = DEFAULT_PROJECT) => request<{ data: Plugin }>(`/plugins/${name}?project=${project}`),
    create: (name: string, file_path: string, source_content?: string, project = DEFAULT_PROJECT) =>
      request<{ data: Plugin }>(`/plugins?project=${project}`, {
        method: "POST", body: JSON.stringify({ name, file_path, source_content }),
      }),
    update: (name: string, data: { file_path?: string; source_content?: string }, project = DEFAULT_PROJECT) =>
      request<{ data: Plugin }>(`/plugins/${name}?project=${project}`, {
        method: "PUT", body: JSON.stringify(data),
      }),
    delete: (name: string, project = DEFAULT_PROJECT) =>
      request(`/plugins/${name}?project=${project}`, { method: "DELETE" }),
    enable: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: Plugin }>(`/plugins/${name}/enable?project=${project}`, { method: "POST" }),
    disable: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: Plugin }>(`/plugins/${name}/disable?project=${project}`, { method: "POST" }),
    getSource: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: { source: string } }>(`/plugins/${encodeURIComponent(name)}/source?project=${project}`),
  },
  agents: {
    list: (project = DEFAULT_PROJECT, category?: string) => {
      const url = category ? `/agents?project=${project}&category=${encodeURIComponent(category)}` : `/agents?project=${project}`;
      return request<{ data: Agent[]; total?: number }>(url);
    },
    get: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}?project=${project}`),
    create: (data: { name: string; content: string; description?: string; category?: string; mode?: string; model?: string }, project = DEFAULT_PROJECT) =>
      request<{ data: Agent }>(`/agents?project=${project}`, { method: "POST", body: JSON.stringify(data) }),
    update: (name: string, data: { description?: string; category?: string; mode?: string; model?: string; content?: string }, project = DEFAULT_PROJECT) =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}?project=${project}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (name: string, project = DEFAULT_PROJECT) =>
      request(`/agents/${encodeURIComponent(name)}?project=${project}`, { method: "DELETE" }),
    enable: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}/enable?project=${project}`, { method: "POST" }),
    disable: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}/disable?project=${project}`, { method: "POST" }),
  },
  servers: {
    list: (project = DEFAULT_PROJECT) => request<{ data: Server[]; is_global: boolean }>(`/servers?project=${project}`),
    create: (name: string, command: string, project = DEFAULT_PROJECT) =>
      request<{ data: Server }>(`/servers?project=${project}`, { method: "POST", body: JSON.stringify({ name, command }) }),
  },
  observations: {
    list: (project = DEFAULT_PROJECT, status?: string, type?: string) => {
      const params = new URLSearchParams({ project });
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      return request<{ data: Observation[]; total: number }>(`/observations?${params}`);
    },
    get: (id: number, project = DEFAULT_PROJECT) =>
      request<{ data: Observation }>(`/observations/${id}?project=${project}`),
    create: (observationType: string, content: string, importance?: number, source?: string, project = DEFAULT_PROJECT) =>
      request<{ data: Observation }>(`/observations?project=${project}`, { method: "POST", body: JSON.stringify({ observation_type: observationType, content, importance, source }) }),
    stats: (project = DEFAULT_PROJECT) =>
      request<{ data: { total: number; pending: number } }>(`/observations/stats?project=${project}`),
  },
  personality: {
    list: (project = DEFAULT_PROJECT, traitType?: string) => {
      const params = new URLSearchParams({ project });
      if (traitType) params.set("trait_type", traitType);
      return request<{ data: PersonalityTrait[]; total: number }>(`/personality?${params}`);
    },
    profile: (project = DEFAULT_PROJECT) =>
      request<{ data: any }>(`/personality/profile?project=${project}`),
    dismiss: (id: number, project = DEFAULT_PROJECT) =>
      request<{ data: { id: number } }>(`/personality/${id}/dismiss?project=${project}`, { method: "POST" }),
  },
  synthesis: {
    run: (project = DEFAULT_PROJECT) =>
      request<{ data: any }>(`/synthesis/run?project=${project}`, { method: "POST" }),
    status: (project = DEFAULT_PROJECT) =>
      request<{ data: any }>(`/synthesis/status?project=${project}`),
  },
  pipeline: {
    events: (project = DEFAULT_PROJECT, options?: { source?: string; type?: string; limit?: number }) => {
      const params = new URLSearchParams({ project });
      if (options?.source) params.set("source", options.source);
      if (options?.type) params.set("type", options.type);
      if (options?.limit) params.set("limit", String(options.limit));
      return request<{ data: any[]; total: number }>(`/pipeline/events?${params}`);
    },
    timeline: (project = DEFAULT_PROJECT, options?: { source?: string; limit?: number }) => {
      const params = new URLSearchParams({ project });
      if (options?.source) params.set("source", options.source);
      if (options?.limit) params.set("limit", String(options.limit));
      return request<{ data: any[]; total: number }>(`/pipeline/timeline?${params}`);
    },
  },
  emails: {
    accounts: {
      list: (project = DEFAULT_PROJECT) =>
        request<{ data: EmailAccount[] }>(`/emails/accounts?project=${project}`),
      create: (data: {
        email: string; name: string; provider: EmailProvider; authType: AuthType;
        imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number;
        password?: string;
      }, project = DEFAULT_PROJECT) =>
        request<{ data: EmailAccount }>(`/emails/accounts?project=${project}`, {
          method: "POST", body: JSON.stringify(data),
        }),
      delete: (id: string, project = DEFAULT_PROJECT) =>
        request(`/emails/accounts/${id}?project=${project}`, { method: "DELETE" }),
      test: (data: {
        email: string; provider: EmailProvider; authType: AuthType;
        imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number;
        password?: string;
      }, project = DEFAULT_PROJECT) =>
        request<{ data: { success: boolean; message: string } }>(`/emails/accounts/test?project=${project}`, {
          method: "POST", body: JSON.stringify(data),
        }),
      oauthUrl: (provider: string, project = DEFAULT_PROJECT) =>
        request<{ data: { url: string } }>(`/emails/accounts/oauth/url?project=${project}&provider=${provider}`),
      oauthCallback: (provider: string, code: string, redirectUri: string, project = DEFAULT_PROJECT) =>
        request<{ data: EmailAccount }>(`/emails/accounts/oauth?project=${project}`, {
          method: "POST", body: JSON.stringify({ provider, code, redirectUri }),
        }),
    },
    list: (folder?: string, accountId?: string, page = 1, limit = 50, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project, page: String(page), limit: String(limit) });
      if (folder) params.set("folder", folder);
      if (accountId) params.set("account_id", accountId);
      return request<{ data: EmailMessage[]; total: number }>(`/emails?${params}`);
    },
    search: (query: string, folder?: string, accountId?: string, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project, query });
      if (folder) params.set("folder", folder);
      if (accountId) params.set("account_id", accountId);
      return request<{ data: EmailMessage[]; total: number }>(`/emails/search?${params}`);
    },
    get: (uid: number, accountId?: string, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project, uid: String(uid) });
      if (accountId) params.set("account_id", accountId);
      return request<{ data: EmailMessage }>(`/emails/${uid}?${params}`);
    },
    send: (data: {
      to: string; cc?: string; bcc?: string; subject: string; body: string;
      accountId?: string;
    }, project = DEFAULT_PROJECT) =>
      request<{ data: { success: boolean } }>(`/emails/send?project=${project}`, {
        method: "POST", body: JSON.stringify(data),
      }),
    draft: (data: {
      to?: string; cc?: string; bcc?: string; subject?: string; body?: string;
      accountId?: string;
    }, project = DEFAULT_PROJECT) =>
      request<{ data: { uid: number } }>(`/emails/draft?project=${project}`, {
        method: "POST", body: JSON.stringify(data),
      }),
    move: (uid: number, folder: string, accountId?: string, project = DEFAULT_PROJECT) =>
      request<{ data: { success: boolean } }>(`/emails/${uid}/move?project=${project}`, {
        method: "POST", body: JSON.stringify({ folder, account_id: accountId }),
      }),
    setFlags: (uid: number, flags: string[], accountId?: string, project = DEFAULT_PROJECT) =>
      request<{ data: { success: boolean } }>(`/emails/${uid}/flags?project=${project}`, {
        method: "PATCH", body: JSON.stringify({ flags, account_id: accountId }),
      }),
    delete: (uid: number, accountId?: string, project = DEFAULT_PROJECT) =>
      request(`/emails/${uid}?project=${project}`, {
        method: "DELETE", body: JSON.stringify({ account_id: accountId }),
      }),
    folders: (accountId?: string, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project });
      if (accountId) params.set("account_id", accountId);
      return request<{ data: EmailFolder[] }>(`/emails/folders?${params}`);
    },
    triage: (uid: number, accountId?: string, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project, uid: String(uid) });
      if (accountId) params.set("account_id", accountId);
      return request<{ data: TriageResult }>(`/emails/triage?${params}`);
    },
    suggest: (uid?: number, accountId?: string, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project });
      if (uid) params.set("uid", String(uid));
      if (accountId) params.set("account_id", accountId);
      return request<{ data: ResponseSuggestion }>(`/emails/suggest?${params}`);
    },
  },
  settings: {
    get: (key: string, project = DEFAULT_PROJECT) => request<{ data: { key: string; value: string } }>(`/settings?project=${project}&key=${key}`),
    set: (key: string, value: string, project = DEFAULT_PROJECT) =>
      request<{ data: { key: string; value: string } }>(`/settings?project=${project}`, { method: "POST", body: JSON.stringify({ key, value }) }),

    testLlm: (endpoint: string, model: string, apiKey: string, project = DEFAULT_PROJECT) =>
      request<{ data: { ok: boolean; status?: number; message?: string } }>(`/settings/test-llm?project=${project}`, {
        method: "POST", body: JSON.stringify({ endpoint, model, apiKey }),
      }).then((r) => r.data),

    /**
     * Atomic LLM config save — POSTs both primary and backup config in one
     * request. Triggers projectToOpenCodeConfig() on the server to create
     * synthetic OpenCode providers.
     */
    saveLlmConfig: (config: LlmConfigBody, project = DEFAULT_PROJECT) =>
      request<{ data: { saved: boolean; restartRequired: boolean } }>(
        `/settings/llm-config?project=${project}`,
        { method: "POST", body: JSON.stringify(config) },
      ),

    /** Sanitized Settings config — exposes only provider metadata and key presence. */
    getLlmConfig: (project = DEFAULT_PROJECT) =>
      request<{ data: LlmConfigResponse }>(`/settings/llm-config?project=${project}`),

    getProviderConfigs: (project = DEFAULT_PROJECT) =>
      request<{ data: { providers: ManagedProviderConfig[] } }>(`/settings/provider-configs?project=${project}`),

    saveProviderConfigs: (providers: ManagedProviderConfig[], project = DEFAULT_PROJECT) =>
      request<{ data: { saved: boolean; restartRequired: boolean; warnings: string[] } }>(
        `/settings/provider-configs?project=${project}`,
        { method: "PUT", body: JSON.stringify({ providers }) },
      ),

    /** Sanitized Chat config — returns the configured providers/agents for the Chat page without exposing API keys. */
    chatConfig: (project = DEFAULT_PROJECT) =>
      request<{ data: ChatConfigResponse }>(`/opencode/chat-config?project=${project}`),
  },
  configs: {
    get: (type: string = "project", project = DEFAULT_PROJECT) =>
      request<{ data: { id: string; content: string } | null }>(`/config?project=${encodeURIComponent(project)}&type=${encodeURIComponent(type)}`),
    set: (type: string, content: string, project = DEFAULT_PROJECT) =>
      request<{ data: { id: string; content: string } }>(`/config?project=${encodeURIComponent(project)}&type=${encodeURIComponent(type)}`, { method: "PUT", body: JSON.stringify({ content }) }),
    sync: (type: string = "project", project = DEFAULT_PROJECT) =>
      request<{ data: { id: string; content: string } | null }>(`/config/sync?project=${encodeURIComponent(project)}&type=${encodeURIComponent(type)}`, { method: "POST" }),
  },
  logs: {
    list: (project = DEFAULT_PROJECT, since?: string, limit = 200) => {
      const params = new URLSearchParams({ project, limit: String(limit) });
      if (since) params.set("since", since);
      return request<{ data: { entries: LogEntry[]; sources: string[]; total: number } }>(`/logs?${params}`);
    },
  },
  mcpTools: {
    list: (project = DEFAULT_PROJECT, includeCategories = false) =>
      request<{ data: any[]; total: number }>(`/mcp-tools?project=${encodeURIComponent(project)}&include_categories=${includeCategories}`),
    toggle: (name: string, enabled: boolean, project = DEFAULT_PROJECT) =>
      request<{ data: any }>(`/mcp-tools/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`, {
        method: "PUT", body: JSON.stringify({ enabled }),
      }),
    toggleCategory: (category: string, enabled: boolean, project = DEFAULT_PROJECT) =>
      request<{ data: any }>(`/mcp-tools/category/${encodeURIComponent(category)}?project=${encodeURIComponent(project)}`, {
        method: "PUT", body: JSON.stringify({ enabled }),
      }),
  },
  jobs: {
    list: (project = DEFAULT_PROJECT) =>
      request<{ data: Job[]; total: number }>(`/jobs?project=${encodeURIComponent(project)}`),
    get: (jobId: string, project = DEFAULT_PROJECT) =>
      request<{ data: Job }>(`/jobs/${encodeURIComponent(jobId)}?project=${encodeURIComponent(project)}`),
    create: (data: {
      name: string;
      description?: string;
      agent: string;
      prompt_template: string;
      schedule_cron?: string;
      trigger_event?: string;
      timeout_minutes?: number;
    }, project = DEFAULT_PROJECT) =>
      request<{ data: Job }>(`/jobs?project=${encodeURIComponent(project)}`, {
        method: "POST", body: JSON.stringify(data),
      }),
    update: (jobId: string, data: Partial<{
      name: string;
      description: string;
      agent: string;
      prompt_template: string;
      schedule_cron: string;
      trigger_event: string;
      enabled: boolean;
      timeout_minutes: number;
    }>, project = DEFAULT_PROJECT) =>
      request<{ data: Job }>(`/jobs/${encodeURIComponent(jobId)}?project=${encodeURIComponent(project)}`, {
        method: "PATCH", body: JSON.stringify(data),
      }),
    delete: (jobId: string, project = DEFAULT_PROJECT) =>
      request(`/jobs/${encodeURIComponent(jobId)}?project=${encodeURIComponent(project)}`, {
        method: "DELETE",
      }),
    run: (jobId: string, project = DEFAULT_PROJECT) =>
      request<{ data: JobRun }>(`/jobs/${encodeURIComponent(jobId)}/run?project=${encodeURIComponent(project)}`, {
        method: "POST",
      }),
    runs: (jobId: string, project = DEFAULT_PROJECT, limit = 50) =>
      request<{ data: JobRun[]; total: number }>(`/jobs/${encodeURIComponent(jobId)}/runs?project=${encodeURIComponent(project)}&limit=${limit}`),
    runLogs: (runId: string, afterSeq?: number, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project: encodeURIComponent(project) });
      if (afterSeq !== undefined) params.set("after", String(afterSeq));
      return request<{ data: JobRunLog[]; total: number }>(`/jobs/runs/${encodeURIComponent(runId)}/logs?${params}`);
    },
    cancelRun: (runId: string, project = DEFAULT_PROJECT) =>
      request<{ data: JobRun }>(`/jobs/runs/${encodeURIComponent(runId)}/cancel?project=${encodeURIComponent(project)}`, {
        method: "POST",
      }),
  },
  docs: {
    /** Spaces — top-level doc containers. */
    spaces: {
      list: (project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocSpace[]; total: number }>(`/docs/spaces?project=${encodeURIComponent(project)}`),
      get: (idOrSlug: number | string, project = DEFAULT_PROJECT) => {
        if (typeof idOrSlug === "number") {
          return request<{ data: import("./docs-types").DocSpace }>(`/docs/spaces/${idOrSlug}?project=${encodeURIComponent(project)}`);
        }
        return request<{ data: import("./docs-types").DocSpace }>(`/docs/spaces?slug=${encodeURIComponent(idOrSlug)}&project=${encodeURIComponent(project)}`);
      },
      create: (name: string, slug: string, description?: string, icon?: string, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocSpace }>(`/docs/spaces?project=${encodeURIComponent(project)}`, {
          method: "POST", body: JSON.stringify({ name, slug, description, icon }),
        }),
      update: (id: number, data: { name?: string; slug?: string; description?: string; icon?: string }, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocSpace }>(`/docs/spaces/${id}?project=${encodeURIComponent(project)}`, {
          method: "PUT", body: JSON.stringify(data),
        }),
      delete: (id: number, project = DEFAULT_PROJECT) =>
        request(`/docs/spaces/${id}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
    },

    /** Pages — individual documents within a space. */
    pages: {
      list: (spaceId: number, parentPageId?: number, project = DEFAULT_PROJECT) => {
        const params = new URLSearchParams({ project: String(project) });
        if (parentPageId) params.set("parentPageId", String(parentPageId));
        return request<{ data: import("./docs-types").DocPage[]; total: number }>(`/docs/spaces/${spaceId}/pages?${params}`);
      },
      tree: (spaceId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocPageTree[] }>(`/docs/spaces/${spaceId}/tree?project=${encodeURIComponent(project)}`),
      get: (id: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocPage }>(`/docs/pages/${id}?project=${encodeURIComponent(project)}`),
      getBySlug: (spaceId: number, slug: string, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocPage }>(`/docs/pages?spaceId=${spaceId}&slug=${encodeURIComponent(slug)}&project=${encodeURIComponent(project)}`),
      create: (spaceId: number, data: { title: string; slug: string; content?: string; parentPageId?: number; status?: string }, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocPage }>(`/docs/spaces/${spaceId}/pages?project=${encodeURIComponent(project)}`, {
          method: "POST", body: JSON.stringify(data),
        }),
      /** PUT /pages/:id — reads expectedRevision (camelCase) for optimistic concurrency. */
      update: (id: number, data: { title?: string; slug?: string; content?: string; status?: string }, expectedRevision?: number, project = DEFAULT_PROJECT) => {
        const body: Record<string, unknown> = { ...data };
        if (expectedRevision !== undefined) body.expectedRevision = expectedRevision;
        return request<{ data: import("./docs-types").DocPage }>(`/docs/pages/${id}?project=${encodeURIComponent(project)}`, {
          method: "PUT", body: JSON.stringify(body),
        });
      },
      delete: (id: number, project = DEFAULT_PROJECT) =>
        request(`/docs/pages/${id}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
      restore: (pageId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocPage }>(`/docs/pages/${pageId}/restore?project=${encodeURIComponent(project)}`, { method: "POST" }),
      move: (id: number, newParentId?: number, newSortOrder?: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocPage }>(`/docs/pages/${id}/move?project=${encodeURIComponent(project)}`, {
          method: "POST", body: JSON.stringify({ newParentId, newSortOrder }),
        }),
      publish: (id: number, expectedRevision?: number, project = DEFAULT_PROJECT) => {
        const body: Record<string, unknown> = {};
        if (expectedRevision !== undefined) body.expectedRevision = expectedRevision;
        return request<{ data: import("./docs-types").DocPage }>(`/docs/pages/${id}/publish?project=${encodeURIComponent(project)}`, {
          method: "POST", body: JSON.stringify(body),
        });
      },
      toggleFavorite: (id: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocPage }>(`/docs/pages/${id}/favorite?project=${encodeURIComponent(project)}`, { method: "POST" }),
      /** Draft sub-resource. */
      draft: {
        get: (pageId: number, project = DEFAULT_PROJECT) =>
          request<{ data: import("./docs-types").DocDraft }>(`/docs/pages/${pageId}/draft?project=${encodeURIComponent(project)}`),
        save: (pageId: number, content: string, title?: string, slug?: string, baseRevision?: number, project = DEFAULT_PROJECT) => {
          const body: Record<string, unknown> = { content };
          if (title !== undefined) body.title = title;
          if (slug !== undefined) body.slug = slug;
          if (baseRevision !== undefined) body.baseRevision = baseRevision;
          return request<{ data: import("./docs-types").DocDraft }>(`/docs/pages/${pageId}/draft?project=${encodeURIComponent(project)}`, {
            method: "PUT", body: JSON.stringify(body),
          });
        },
        delete: (pageId: number, project = DEFAULT_PROJECT) =>
          request(`/docs/pages/${pageId}/draft?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
      },
    },

    /** Comments — threaded discussion on pages. */
    comments: {
      list: (pageId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocComment[]; total: number }>(
          `/docs/pages/${pageId}/comments?project=${encodeURIComponent(project)}`,
        ),
      create: (
        pageId: number,
        content: string,
        parentCommentId?: number,
        selectionText?: string,
        selectionOffset?: number,
        project = DEFAULT_PROJECT,
      ) =>
        request<{ data: import("./docs-types").DocComment }>(
          `/docs/pages/${pageId}/comments?project=${encodeURIComponent(project)}`,
          {
            method: "POST",
            body: JSON.stringify({ content, parentCommentId, selectionText, selectionOffset }),
          },
        ),
      /** PUT /pages/:pageId/comments/:commentId/resolve — resolve (toggle) a comment. */
      resolve: (pageId: number, commentId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocComment }>(
          `/docs/pages/${pageId}/comments/${commentId}/resolve?project=${encodeURIComponent(project)}`,
          { method: "PUT" },
        ),
      /** DELETE /pages/:pageId/comments/:commentId */
      delete: (pageId: number, commentId: number, project = DEFAULT_PROJECT) =>
        request(`/docs/pages/${pageId}/comments/${commentId}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
    },

    /** Versions — point-in-time page snapshots. */
    versions: {
      list: (pageId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocVersion[]; total: number }>(
          `/docs/pages/${pageId}/versions?project=${encodeURIComponent(project)}`,
        ),
      /** GET /pages/:pageId/versions/:versionId (page-scoped). */
      get: (pageId: number, versionId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocVersion }>(
          `/docs/pages/${pageId}/versions/${versionId}?project=${encodeURIComponent(project)}`,
        ),
      /** POST /pages/:pageId/restore/:versionId */
      restore: (pageId: number, versionId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocPage }>(
          `/docs/pages/${pageId}/restore/${versionId}?project=${encodeURIComponent(project)}`,
          { method: "POST" },
        ),
    },

    /** Search — full-text search across all spaces/pages. */
    search: (query: string, spaceId?: number, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project, q: query });
      if (spaceId) params.set("spaceId", String(spaceId));
      return request<{ data: import("./docs-types").DocSearchResult[]; total: number }>(
        `/docs/search?${params}`,
      );
    },

    /** Tags — per-page tag management. */
    tags: {
      list: (pageId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocTag[] }>(
          `/docs/pages/${pageId}/tags?project=${encodeURIComponent(project)}`,
        ),
      /** POST /pages/:id/tags — body { tagName } */
      add: (pageId: number, tagName: string, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocTag }>(
          `/docs/pages/${pageId}/tags?project=${encodeURIComponent(project)}`,
          { method: "POST", body: JSON.stringify({ tagName }) },
        ),
      remove: (pageId: number, tagId: number, project = DEFAULT_PROJECT) =>
        request(
          `/docs/pages/${pageId}/tags/${tagId}?project=${encodeURIComponent(project)}`,
          { method: "DELETE" },
        ),
      allUnique: (project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocTag[]; total: number }>(
          `/docs/tags?project=${encodeURIComponent(project)}`,
        ),
    },

    /** Backlinks — pages that link to the current page. */
    backlinks: {
      list: (pageId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocBacklink[]; total: number }>(
          `/docs/pages/${pageId}/backlinks?project=${encodeURIComponent(project)}`,
        ),
    },

    /** Templates — reusable page templates. */
    templates: {
      list: (project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocTemplate[]; total: number }>(
          `/docs/templates?project=${encodeURIComponent(project)}`,
        ),
      get: (id: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocTemplate }>(
          `/docs/templates/${id}?project=${encodeURIComponent(project)}`,
        ),
      create: (name: string, content: string, description?: string, category?: string, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocTemplate }>(`/docs/templates?project=${encodeURIComponent(project)}`, {
          method: "POST", body: JSON.stringify({ name, content, description, category }),
        }),
      /** PUT /templates/:id */
      update: (id: number, data: { name?: string; content?: string; description?: string; category?: string }, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocTemplate }>(`/docs/templates/${id}?project=${encodeURIComponent(project)}`, {
          method: "PUT", body: JSON.stringify(data),
        }),
      delete: (id: number, project = DEFAULT_PROJECT) =>
        request(`/docs/templates/${id}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
    },

    /** Attachments — file uploads on pages. */
    attachments: {
      list: (pageId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocAttachment[]; total: number }>(
          `/docs/pages/${pageId}/attachments?project=${encodeURIComponent(project)}`,
        ),
      /** Upload multipart file. */
      upload: (pageId: number, formData: FormData, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocAttachment }>(
          `/docs/pages/${pageId}/attachments?project=${encodeURIComponent(project)}`,
          { method: "POST", headers: {}, body: formData },
        ),
      /** GET /pages/:pageId/attachments/:attId/download — returns download URL. The caller opens this as a blob download. */
      downloadUrl: (pageId: number, attId: number, project = DEFAULT_PROJECT): string =>
        `${API_URL}/docs/pages/${pageId}/attachments/${attId}/download?project=${encodeURIComponent(project)}`,
      /** DELETE /pages/:pageId/attachments/:attId */
      delete: (pageId: number, attId: number, project = DEFAULT_PROJECT) =>
        request(`/docs/pages/${pageId}/attachments/${attId}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
    },

    /** Project Links — link pages to Ingenium projects. */
    projectLinks: {
      /** GET /pages/:id/projects */
      list: (pageId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocProjectLink[] }>(
          `/docs/pages/${pageId}/projects?project=${encodeURIComponent(project)}`,
        ),
      /** POST /pages/:id/projects — body { projectId: string } */
      link: (pageId: number, projectId: string, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocProjectLink }>(
          `/docs/pages/${pageId}/projects?project=${encodeURIComponent(project)}`,
          { method: "POST", body: JSON.stringify({ projectId }) },
        ),
      /** DELETE /pages/:pageId/projects/:linkedProjectId */
      unlink: (pageId: number, linkedProjectId: string, project = DEFAULT_PROJECT) =>
        request(
          `/docs/pages/${pageId}/projects/${encodeURIComponent(linkedProjectId)}?project=${encodeURIComponent(project)}`,
          { method: "DELETE" },
        ),
    },

    /** Favorites. */
    favorites: {
      list: (project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocPage[]; total: number }>(
          `/docs/favorites?project=${encodeURIComponent(project)}`,
        ),
    },

    /** Import / Export. */
    importExport: {
      /** POST /docs/import — JSON body { spaceId, format, data } */
      importJson: (spaceId: number, format: string, data: unknown, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocPage[]; total: number }>(
          `/docs/import?project=${encodeURIComponent(project)}`,
          { method: "POST", body: JSON.stringify({ spaceId, format, data }) },
        ),
      /** GET /docs/spaces/:spaceId/export — canonical export response. */
      exportSpace: (spaceId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocExportData }>(
          `/docs/spaces/${spaceId}/export?project=${encodeURIComponent(project)}`,
        ),
    },

    /** Trash — soft-deleted pages. */
    trash: {
      /** GET /spaces/:spaceId/trash */
      list: (spaceId: number, project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocTrashItem[]; total: number }>(
          `/docs/spaces/${spaceId}/trash?project=${encodeURIComponent(project)}`,
        ),
      /** DELETE /spaces/:spaceId/trash — purge all archived. */
      empty: (spaceId: number, project = DEFAULT_PROJECT) =>
        request(
          `/docs/spaces/${spaceId}/trash?project=${encodeURIComponent(project)}`,
          { method: "DELETE" },
        ),
    },

    /** Stats. */
    stats: {
      get: (project = DEFAULT_PROJECT) =>
        request<{ data: import("./docs-types").DocStats }>(
          `/docs/stats?project=${encodeURIComponent(project)}`,
        ),
    },
  },
  /** RAG — Retrieval-Augmented Generation for docs. */
  rag: {
    /** POST /rag/ask — ask a natural language question about documentation. Returns answer with citations. */
    ask: (question: string, spaceId?: number, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project });
      return request<{ data: { answer: string; citations: Array<{ id: string; title: string; score: number }> } }>(
        `/rag/ask?${params}`,
        { method: "POST", body: JSON.stringify({ question, spaceId }) },
      );
    },

    /** GET /rag/search — keyword/embedding search across docs. */
    search: (query: string, spaceId?: number, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project, q: query });
      if (spaceId) params.set("spaceId", String(spaceId));
      return request<{ data: Array<{ id: number; title: string; slug: string; snippet: string; score: number }> }>(
        `/rag/search?${params}`,
      );
    },

    /** POST /rag/ingest — trigger ingestion of all docs into the vector index. */
    ingest: (project = DEFAULT_PROJECT) =>
      request<{ data: { ingested: number; failed: number } }>(
        `/rag/ingest?project=${encodeURIComponent(project)}`,
        { method: "POST" },
      ),

    /** Sources — manage ingested document records. */
    sources: {
      /** GET /rag/sources */
      list: (project = DEFAULT_PROJECT) =>
        request<{ data: Array<{ id: number; title: string; slug: string; pageId: number; chunkCount: number; indexedAt: string }>; total: number }>(
          `/rag/sources?project=${encodeURIComponent(project)}`,
        ),

      /** GET /rag/sources/:id */
      get: (id: number, project = DEFAULT_PROJECT) =>
        request<{ data: { id: number; title: string; slug: string; pageId: number; chunkCount: number; indexedAt: string } }>(
          `/rag/sources/${id}?project=${encodeURIComponent(project)}`,
        ),

      /** DELETE /rag/sources/:id */
      delete: (id: number, project = DEFAULT_PROJECT) =>
        request(`/rag/sources/${id}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),

      /** POST /rag/sources/:id/ingest — re-ingest a single source. */
      ingest: (id: number, project = DEFAULT_PROJECT) =>
        request<{ data: { ingested: boolean } }>(
          `/rag/sources/${id}/ingest?project=${encodeURIComponent(project)}`,
          { method: "POST" },
        ),
    },

    /** GET /rag/stats — vector index statistics. */
    stats: (project = DEFAULT_PROJECT) =>
      request<{ data: { totalSources: number; totalChunks: number; lastIndexedAt: string | null } }>(
        `/rag/stats?project=${encodeURIComponent(project)}`,
      ),
  },
  home: {
    summary: (project = DEFAULT_PROJECT) =>
      request<{ data: DashboardSummary; unavailable: string[] }>(
        `/dashboard/summary?project=${encodeURIComponent(project)}`,
      ),
  },
  backups: {
    /** GET /backups — list all backups */
    list: (project = DEFAULT_PROJECT) =>
      request<{ data: Backup[]; total: number }>(`/backups?project=${encodeURIComponent(project)}`),
    /** GET /backups/:id — single backup detail */
    get: (id: string, project = DEFAULT_PROJECT) =>
      request<{ data: Backup }>(`/backups/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`),
    /** POST /backups — trigger a new manual backup */
    create: (project = DEFAULT_PROJECT) =>
      request<{ data: Backup }>(`/backups?project=${encodeURIComponent(project)}`, { method: "POST" }),
    /** DELETE /backups/:id — delete a backup */
    delete: (id: string, project = DEFAULT_PROJECT) =>
      request(`/backups/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
    /** GET /backups/:id/download — download URL for a backup file (returns a redirect-able URL string) */
    download: (id: string, project = DEFAULT_PROJECT): string =>
      `${API_URL}/backups/${encodeURIComponent(id)}/download?project=${encodeURIComponent(project)}`,
    restore: {
      /** GET /backups/:id/restore/preview — preview what would be restored */
      preview: (id: string, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/backups/restore/preview?project=${encodeURIComponent(project)}`, {
          method: "POST",
          body: JSON.stringify({ backupId: id }),
        }),
      /** POST /backups/:id/restore — start a restore from backup */
      start: (id: string, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/backups/restore?project=${encodeURIComponent(project)}`, {
          method: "POST",
          body: JSON.stringify({ backupId: id, confirm: true }),
        }),
    },
    schedule: {
      /** GET /backups/schedule — get the current backup schedule configuration */
      get: (project = DEFAULT_PROJECT) =>
        request<{ data: BackupSchedule }>(`/backups/schedule?project=${encodeURIComponent(project)}`),
      /** PUT /backups/schedule — update the backup schedule */
      set: (data: { hourly?: { enabled?: boolean; retention?: number }; daily?: { enabled?: boolean; retention?: number }; manual_retention?: number }, project = DEFAULT_PROJECT) =>
        request<{ data: BackupSchedule }>(`/backups/schedule?project=${encodeURIComponent(project)}`, { method: "PUT", body: JSON.stringify(data) }),
    },
  },
  vault: {
    /** GET /vault/status — returns { sealed: boolean } */
    status: (project = DEFAULT_PROJECT) =>
      request<{ data: { sealed: boolean; initialized: boolean; stats?: { itemCount: number; folderCount: number }; created_at?: string } }>(
        `/vault/status?project=${encodeURIComponent(project)}`,
      ),

    /** POST /vault/initialize — first-run: create the vault with a new passphrase */
    initialize: (passphrase: string, confirmation: string, project = DEFAULT_PROJECT) =>
      request<{ data: { ok: boolean; unsealed: boolean } }>(
        `/vault/initialize?project=${encodeURIComponent(project)}`,
        { method: "POST", body: JSON.stringify({ password: passphrase, confirmation }) },
      ),

    /** POST /vault/unseal — passphrase to unlock */
    unseal: (passphrase: string, project = DEFAULT_PROJECT) =>
      request<{ data: { unsealed: boolean } }>(
        `/vault/unseal?project=${encodeURIComponent(project)}`,
        { method: "POST", body: JSON.stringify({ password: passphrase }) },
      ),

    /** POST /vault/seal — lock the vault */
    seal: (project = DEFAULT_PROJECT) =>
      request<{ data: { sealed: boolean } }>(
        `/vault/seal?project=${encodeURIComponent(project)}`,
        { method: "POST" },
      ),

    items: {
      /** GET /vault/items — list items, optionally filtered by folder_id */
      list: (folderId?: string, project = DEFAULT_PROJECT) => {
        const params = new URLSearchParams({ project });
        if (folderId) params.set("folder_id", folderId);
        return request<{ data: VaultItem[]; total: number }>(
          `/vault/items?${params}`,
        );
      },

      /** POST /vault/items — create a new vault item */
      create: (data: {
        name: string;
        type: VaultItemType;
        value: string;
        folder_id?: string;
        username?: string;
        urls?: string;
        tags?: string;
        notes?: string;
      }, project = DEFAULT_PROJECT) =>
        request<{ data: VaultItemDetail }>(
          `/vault/items?project=${encodeURIComponent(project)}`,
          { method: "POST", body: JSON.stringify(data) },
        ),

      /** GET /vault/items/:id — full item detail (without decrypted value) */
      get: (id: string, project = DEFAULT_PROJECT) =>
        request<{ data: VaultItemDetail }>(
          `/vault/items/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`,
        ),

      /** PATCH /vault/items/:id — update item metadata */
      update: (id: string, data: {
        name?: string;
        type?: VaultItemType;
        folder_id?: string;
        username?: string;
        urls?: string;
        tags?: string;
        notes?: string;
      }, project = DEFAULT_PROJECT) =>
        request<{ data: VaultItemDetail }>(
          `/vault/items/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`,
          { method: "PATCH", body: JSON.stringify(data) },
        ),

      /** DELETE /vault/items/:id */
      delete: (id: string, project = DEFAULT_PROJECT) =>
        request(`/vault/items/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`, {
          method: "DELETE",
        }),

      /** POST /vault/items/:id/reveal — decrypt and return value (auto-hides server-side after TTL) */
      reveal: (id: string, project = DEFAULT_PROJECT) =>
        request<{ data: { value: string; password_strength?: number } }>(
          `/vault/items/${encodeURIComponent(id)}/reveal?project=${encodeURIComponent(project)}`,
          { method: "POST" },
        ),

      /** POST /vault/items/:id/rotate — generate new password and update */
      rotate: (id: string, project = DEFAULT_PROJECT) =>
        request<{ data: { value: string; password_strength?: number } }>(
          `/vault/items/${encodeURIComponent(id)}/rotate?project=${encodeURIComponent(project)}`,
          { method: "POST" },
        ),
    },

    folders: {
      /** GET /vault/folders */
      list: (project = DEFAULT_PROJECT) =>
        request<{ data: VaultFolder[] }>(
          `/vault/folders?project=${encodeURIComponent(project)}`,
        ),

      /** POST /vault/folders */
      create: (name: string, project = DEFAULT_PROJECT) =>
        request<{ data: VaultFolder }>(
          `/vault/folders?project=${encodeURIComponent(project)}`,
          { method: "POST", body: JSON.stringify({ name }) },
        ),

      /** DELETE /vault/folders/:id */
      delete: (id: string, project = DEFAULT_PROJECT) =>
        request(`/vault/folders/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`, {
          method: "DELETE",
        }),
    },

    password: {
      /** POST /vault/password/generate */
      generate: (project = DEFAULT_PROJECT) =>
        request<{ data: { password: string; strength: number } }>(
          `/vault/password/generate?project=${encodeURIComponent(project)}`,
          { method: "POST" },
        ),
    },

    audit: {
      /** GET /vault/audit — list audit log entries */
      list: (itemId?: string, project = DEFAULT_PROJECT) => {
        const params = new URLSearchParams({ project });
        if (itemId) params.set("item_id", itemId);
        return request<{ data: AuditEntry[]; total: number }>(
          `/vault/audit?${params}`,
        );
      },
    },
  },
};
