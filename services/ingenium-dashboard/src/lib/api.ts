const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4097/api/v1";
const DEFAULT_PROJECT = "global-default";

/** Internal fetch wrapper that handles errors and content types uniformly. */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? res.statusText);
  }
  // Handle 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** A project managed by Ingenium. */
export type Project = { id: string; name: string; path?: string; archived_at?: string; created_at: string; updated_at: string; is_global?: boolean };

/** An AI agent skill with its full content. */
export type Skill = { id: string; name: string; description: string; content: string; category?: string; enabled: boolean; tags?: string; always_apply?: number; file_tree?: string; created_at: string; updated_at: string };

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
  /** Runtime value is 0/1 (number) from SQLite; truthy/falsy coercion works for checkboxes and ternaries. */
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

/**
 * Typed API client for the Ingenium backend.
 * All methods accept an optional `project` parameter that defaults to "ingenium".
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

    /** Fetch the full LLM synthesis config (model, API key, endpoint) in parallel. */
    getConfig: (project = DEFAULT_PROJECT) =>
      Promise.all([
        request<{ data: { key: string; value: string } }>(`/settings?project=${project}&key=synthesis_model`),
        request<{ data: { key: string; value: string } }>(`/settings?project=${project}&key=synthesis_api_key`),
        request<{ data: { key: string; value: string } }>(`/settings?project=${project}&key=synthesis_endpoint`),
      ]).then(([model, key, endpoint]) => ({
        model: model.data?.value || "",
        apiKey: key.data?.value || "",
        endpoint: endpoint.data?.value || "",
      })),
    testLlm: (endpoint: string, model: string, apiKey: string, project = DEFAULT_PROJECT) =>
      request<{ data: { ok: boolean; status?: number; message?: string } }>(`/settings/test-llm?project=${project}`, {
        method: "POST", body: JSON.stringify({ endpoint, model, apiKey }),
      }).then((r) => r.data),
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
  home: {
    summary: (project = DEFAULT_PROJECT) =>
      request<{ data: DashboardSummary; unavailable: string[] }>(
        `/dashboard/summary?project=${encodeURIComponent(project)}`,
      ),
  },
};
