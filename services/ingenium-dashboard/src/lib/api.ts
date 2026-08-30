import {
  DASHBOARD_MARKER_HEADER,
  DASHBOARD_MARKER_VALUE,
} from "./dashboard-auth";

/**
 * Canonical browser API base URL.
 *
 * Defaults to relative `/api/v1` for same-origin access through the Next.js proxy.
 * A deployment may override the relative proxy prefix, but never direct the browser
 * to the private API service.
 */
export function getApiBase(): string {
  const configured = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  return configured.startsWith("/") && !configured.startsWith("//") ? configured.replace(/\/+$/, "") : "/api/v1";
}

/**
 * Default project for API calls when no explicit project is selected.
 * The API resolves this to the global-default project (is_global=1).
 */
const DEFAULT_PROJECT = "global-default";

export type RetryAfterStatus = "missing" | "valid" | "invalid" | "excessive";

/**
 * Structured API error carrying the HTTP status and optional Retry-After header.
 *
 * Callers can check `instanceof ApiError` to distinguish API errors from network
 * failures, and read the parsed Retry-After status for rate-limit backoff.
 */
export class ApiError extends Error {
  /** HTTP status code (e.g. 429, 503). */
  status: number;
  /** Seconds to wait before retrying, parsed from the `Retry-After` header (capped at 60). */
  retryAfterSeconds: number | null;
  /** Whether the server supplied a bounded value safe for automatic retry. */
  retryAfterStatus: RetryAfterStatus;
  /** Bounded server error code; never includes response details. */
  code: string | null;
  /** Present only for safe optimistic-concurrency conflicts. */
  currentRevision: number | null;

  constructor(
    status: number,
    message: string,
    retryAfterSeconds: number | null,
    code: string | null = null,
    currentRevision: number | null = null,
    retryAfterStatus: RetryAfterStatus = retryAfterSeconds === null ? "missing" : "valid",
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.retryAfterStatus = retryAfterStatus;
    this.code = code;
    this.currentRevision = currentRevision;
  }
}

export type AuthFailure = "session-expired" | "csrf" | "reauth" | "mfa" | "verification" | "access-denied" | null;

export function classifyAuthFailure(status: number, code: string | null): AuthFailure {
  if (status === 401 || code === "UNAUTHORIZED" || code === "INVALID_TOKEN") return "session-expired";
  if (code === "CSRF_REJECTED" || code === "PRE_AUTH_CSRF_REJECTED" || code === "DASHBOARD_API_PROXY_CSRF_REJECTED") return "csrf";
  if (code === "STEP_UP_REQUIRED") return "reauth";
  if (code === "MFA_REQUIRED") return "mfa";
  if (code === "EMAIL_VERIFICATION_REQUIRED") return "verification";
  if (status === 403) return "access-denied";
  return null;
}

let sessionCsrfToken: string | null = null;
let csrfBootstrap: Promise<string> | null = null;
let expiryRedirectStarted = false;
const PRE_AUTH_CSRF_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/mfa/challenge",
  "/api/v1/auth/password/forgot",
  "/api/v1/auth/password/reset",
  "/api/v1/auth/email/verify",
  "/api/v1/auth/oidc/start",
  "/api/v1/bootstrap/claim",
]);

function isUnsafeMethod(method = "GET"): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return new URL(input, "http://dashboard.invalid").pathname;
  if (input instanceof URL) return input.pathname;
  return new URL(input.url).pathname;
}

async function responseError(response: Response): Promise<ApiError> {
  const retryAfter = parseRetryAfter(response.headers?.get?.("Retry-After") ?? null);
  const body = await response.json().catch(() => ({ error: { message: response.statusText } }));
  const code = typeof body.error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(body.error.code)
    ? body.error.code
    : null;
  if (classifyAuthFailure(response.status, code) === "session-expired") redirectExpiredSession();
  const currentRevision = typeof body.error?.currentRevision === "number"
    && Number.isSafeInteger(body.error.currentRevision)
    && body.error.currentRevision >= 0
    ? body.error.currentRevision
    : null;
  return new ApiError(
    response.status,
    body.error?.message ?? response.statusText,
    retryAfter.seconds,
    code,
    currentRevision,
    retryAfter.status,
  );
}

async function bootstrapSessionCsrf(): Promise<string> {
  if (sessionCsrfToken) return sessionCsrfToken;
  if (!csrfBootstrap) {
    csrfBootstrap = fetch(`${getApiBase()}/auth/session/csrf`, {
      method: "POST",
      credentials: "same-origin",
      headers: { [DASHBOARD_MARKER_HEADER]: DASHBOARD_MARKER_VALUE },
    })
      .then(async (response) => {
        if (!response.ok) throw await responseError(response);
        return (await response.json()).data.csrfToken as string;
      })
      .finally(() => { csrfBootstrap = null; });
  }
  sessionCsrfToken = await csrfBootstrap;
  return sessionCsrfToken;
}

async function retryRateLimitOnce<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ApiError)
      || error.status !== 429
      || error.retryAfterStatus !== "valid"
      || error.retryAfterSeconds === null) throw error;
    await new Promise((resolve) => setTimeout(resolve, error.retryAfterSeconds! * 1_000));
    return operation();
  }
}

function loadAuthenticatedSession(): Promise<{ data: AuthSessionState }> {
  return retryRateLimitOnce(async () => {
    await bootstrapSessionCsrf();
    return request<{ data: AuthSessionState }>("/auth/session");
  });
}

export function setSessionCsrfToken(value: string | null): void {
  sessionCsrfToken = value;
}

export function resetAuthClientForTest(): void {
  sessionCsrfToken = null;
  csrfBootstrap = null;
  expiryRedirectStarted = false;
}

function redirectExpiredSession(): void {
  if (expiryRedirectStarted || typeof window === "undefined" || window.location.pathname === "/login") return;
  expiryRedirectStarted = true;
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/login?reason=session-expired&returnTo=${encodeURIComponent(returnTo)}`);
}

/**
 * Parse the `Retry-After` header value into a bounded delay classification.
 * Accepts integer seconds only (the API emits seconds, not HTTP-date).
 */
function parseRetryAfter(header: string | null): { seconds: number | null; status: RetryAfterStatus } {
  if (header === null) return { seconds: null, status: "missing" };
  const value = header.trim();
  if (!/^\d+$/.test(value)) return { seconds: null, status: "invalid" };

  const seconds = Number(value);
  if (seconds <= 0) return { seconds: null, status: "invalid" };
  if (!Number.isSafeInteger(seconds) || seconds > 60) {
    return { seconds: Number.isFinite(seconds) ? 60 : null, status: "excessive" };
  }
  return { seconds, status: "valid" };
}

function setRequestHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  const existing = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  if (existing && existing !== name) delete headers[existing];
  headers[name] = value;
}

function requestHeaderEntries(
  input: HeadersInit | undefined,
): Array<[string, string]> {
  if (!input) return [];
  if (input instanceof Headers) {
    const entries: Array<[string, string]> = [];
    input.forEach((value, name) => entries.push([name, value]));
    return entries;
  }
  if (Array.isArray(input)) return input.map(([name, value]) => [name, value]);
  return Object.entries(input);
}

function buildRequestHeaders(options?: RequestInit, csrfToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  const suppliedEntries = requestHeaderEntries(options?.headers);

  for (const [name, value] of suppliedEntries) {
    const lowerName = name.toLowerCase();
    // These headers are controlled by the browser/server boundary, not by an
    // individual dashboard call site.
    if (
      lowerName === "authorization"
      || lowerName === "proxy-authorization"
      || lowerName === DASHBOARD_MARKER_HEADER
    ) {
      continue;
    }
    setRequestHeader(headers, name, value);
  }

  const isFormDataBody =
    typeof FormData !== "undefined" && options?.body instanceof FormData;
  if (!isFormDataBody && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
    setRequestHeader(headers, "Content-Type", "application/json");
  }

  // The marker is required by the proxy for mutations and is canonicalized so
  // a call site cannot replace it with an arbitrary value.
  setRequestHeader(headers, DASHBOARD_MARKER_HEADER, DASHBOARD_MARKER_VALUE);
  if (csrfToken) setRequestHeader(headers, "X-CSRF-Token", csrfToken);
  return headers;
}

/**
 * Canonical dashboard fetch path for exceptional call sites that need the raw
 * Response. It applies the same marker and browser-credential stripping as
 * request(), so raw mutation paths cannot silently bypass the CSRF contract.
 */
export function dashboardFetch(
  input: RequestInfo | URL,
  options?: RequestInit,
): Promise<Response> {
  return (async () => fetch(input, {
    ...options,
    credentials: "same-origin",
    headers: buildRequestHeaders(
      options,
      isUnsafeMethod(options?.method) && !PRE_AUTH_CSRF_PATHS.has(requestPath(input))
        ? await bootstrapSessionCsrf()
        : null,
    ),
  }))();
}

/**
 * Typed fetch wrapper for the Ingenium API.
 *
 * - Throws `ApiError` on non-OK responses, preserving status + Retry-After header
 * - Handles 204 No Content (returned by DELETE endpoints) without trying to parse JSON
 * - Sends the canonical dashboard marker and never forwards browser Authorization
 *   or Proxy-Authorization overrides
 * - Allows callers to provide a content type, while leaving multipart boundaries
 *   to the browser for FormData uploads
 */
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await dashboardFetch(`${getApiBase()}${path}`, options);
  if (!res.ok) throw await responseError(res);
  // 204 No Content — returned by DELETE endpoints; no body to parse
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** A project managed by Ingenium. */
export type Project = { id: string; name: string; path?: string; archived_at?: string; created_at: string; updated_at: string; is_global?: boolean };
export type AuthUser = { id: string; email_normalized: string; display_name: string; status: "active" | "disabled"; email_verified_at: string | null };
export type AuthSessionState = { user: AuthUser; session: { id: string; recentStepUp: boolean; mfaEnabled: boolean }; installationAdmin: boolean };
export type OrganizationSummary = { id: string; name: string; slug: string; status: "active" | "suspended"; role: "owner" | "admin" | "member" | "viewer" };
export type OrganizationCapabilities = { effectiveRole: OrganizationSummary["role"] | null; canManageMembers: boolean; canManageInvitations: boolean; canManageProjectMembers: boolean };
export type OrganizationMember = { userId: string; email: string; displayName: string; role: OrganizationSummary["role"]; status: string };
export type ProjectMember = { userId: string; email: string; displayName: string; role: "editor" | "viewer" };
export type SessionDevice = { id: string; device_label: string | null; idle_expires_at: string; absolute_expires_at: string; revoked_at: string | null; created_at: string; last_seen_at: string };
export type ApiTokenSummary = { id: string; name: string; tokenPrefix: string; token?: string; scopes: string[]; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; createdAt: string };

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

export type SkillProposalView = "open" | "history";

export type SkillProposalCounts = {
  open: number;
  history: number;
  byStatus: Record<string, number>;
};

export type SkillProposalSummary = {
  id: string;
  status: string;
  proposalType: string;
  targetName: string;
  sourceName: string | null;
  qualityScore: number;
  noveltyScore: number;
  createdAt: string;
};

export type SkillProposalPage = {
  data: SkillProposalSummary[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  };
};

export type SkillProposalPageOptions = {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
};

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

/** The only client-provided fields accepted when creating a task from a trusted source. */
export type EmailTaskCaptureInput = {
  source_type: "email";
  title: string;
  account_id: string;
  folder: string;
  uid: string;
};

export type ContextTaskCaptureInput = {
  source_type: "context";
  title: string;
  source_id: string;
};

export type DocsTaskCaptureInput = {
  source_type: "docs";
  title: string;
  page_id: number;
};

export type ChatTaskCaptureInput = {
  source_type: "chat";
  title: string;
  session_id: string;
};

export type TaskCaptureInput = EmailTaskCaptureInput | ContextTaskCaptureInput | DocsTaskCaptureInput | ChatTaskCaptureInput;
export type EmailTaskCaptureSource = Omit<EmailTaskCaptureInput, "title">;
export type ContextTaskCaptureSource = Omit<ContextTaskCaptureInput, "title">;
export type DocsTaskCaptureSource = Omit<DocsTaskCaptureInput, "title">;
export type ChatTaskCaptureSource = Omit<ChatTaskCaptureInput, "title">;
export type TaskCaptureSource = EmailTaskCaptureSource | ContextTaskCaptureSource | DocsTaskCaptureSource | ChatTaskCaptureSource;

/** Metadata-only source reference returned with a captured task. */
export type TaskCaptureReference = {
  id: string;
  source_type: "email" | "context" | "docs" | "chat";
  source_id: string;
  display_title: string;
  display_detail: string | null;
  source_timestamp: string | null;
  created_at: string;
  availability: "available";
};

export type TaskCaptureResult = { task: Task; reference: TaskCaptureReference };

/** Metadata-only source reference for a task detail view. */
export type TaskSourceReference = {
  id: string;
  source_type: "email" | "context" | "docs" | "chat" | "job";
  source_id: string;
  display_title: string;
  display_detail: string | null;
  source_timestamp: string | null;
  created_at: string;
  availability: "available" | "missing" | "unavailable";
};

/** Safe metadata projection for choosing a context source; source bodies are never included. */
export type ContextSourceProvenance =
  | "direct_upload"
  | "chunked_upload"
  | "opencode_session"
  | "learning_snapshot";

export type ContextSourceListItem = {
  id: string;
  title: string;
  provenance: ContextSourceProvenance;
  createdAt: string;
};

export type ContextSourceListResponse = {
  data: ContextSourceListItem[];
  total: number;
  limit: number;
  offset: number;
};

export function captureTask(input: EmailTaskCaptureInput): Promise<{ data: TaskCaptureResult }>;
export function captureTask(input: ChatTaskCaptureInput): Promise<{ data: TaskCaptureResult }>;
export function captureTask(input: ContextTaskCaptureInput, project: string): Promise<{ data: TaskCaptureResult }>;
export function captureTask(input: DocsTaskCaptureInput, project: string): Promise<{ data: TaskCaptureResult }>;
export async function captureTask(
  input: TaskCaptureInput,
  project?: string,
): Promise<{ data: TaskCaptureResult }> {
  const params = new URLSearchParams();
  if (input.source_type === "context" || input.source_type === "docs") {
    if (!project) throw new Error(`${input.source_type === "docs" ? "Docs" : "Context"} task capture requires a selected project`);
    params.set("project", project);
  }
  const suffix = params.size > 0 ? `?${params}` : "";
  return request<{ data: TaskCaptureResult }>(`/tasks/captures${suffix}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Context source listing always requires an explicit project selection. */
export function listContextSources(
  project: string,
  options?: { limit?: number; offset?: number },
): Promise<ContextSourceListResponse> {
  const params = new URLSearchParams({ project });
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.offset !== undefined) params.set("offset", String(options.offset));
  return request<ContextSourceListResponse>(`/context/sources/summary?${params}`);
}

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

/** An AI agent definition synced to OpenCode. Model metadata mirrors centralized opencode.json runtime config. */
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

/** A canonical child MCP server definition returned by /mcp-servers. */
export type ChildMcpDiscoveryStatus = "pending" | "ready" | "failed";
export type ChildMcpDiscoveryDiagnostic = "unavailable" | "unauthorized" | "invalid_response" | "timeout";
export type ChildMcpScope = "project" | "global";

export interface ChildMcpServer {
  id: string;
  project_id: string;
  name: string;
  executable: string;
  args: string[];
  scope: ChildMcpScope;
  enabled: boolean;
  discovery_status: ChildMcpDiscoveryStatus;
  discovery_diagnostic: ChildMcpDiscoveryDiagnostic | null;
  last_discovered_at: string | null;
  created_at: string;
  updated_at: string;
  /** Environment values are intentionally represented only by vault references. */
  environment: Record<string, { vault_item_id: string }>;
}

export interface ChildMcpServerInput {
  name: string;
  executable: string;
  args?: string[];
  environment?: Record<string, { vault_item_id: string }>;
  scope?: ChildMcpScope;
}

export interface ChildMcpDiscoveredTool {
  id: string;
  server_id: string;
  source_name: string;
  canonical_name: string;
  /** Child tools are grouped by server: `Child MCP / <server>`. */
  category: `Child MCP / ${string}`;
  description: string;
  input_schema: string;
  discovered_at: string;
  project_id?: string;
  scope?: ChildMcpScope;
}

export interface McpToolState {
  id?: number;
  project_id?: string;
  tool_name: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CategorizedMcpTool {
  category: string;
  enabled_count: number;
  total_count: number;
  tools: Array<{ tool_name: string; enabled: boolean }>;
}

/** Project-scoped MCP state projection; `project` is API-authoritative when present. */
export interface McpToolCatalogResponse {
  data: CategorizedMcpTool[];
  total: number;
  counts?: {
    visibleTools: number;
    visibleCategories: number;
  };
  project?: string;
  project_id?: string;
}

/** Bounded status vocabulary returned by the project-scoped MCP report. */
export type McpToolReportBoundary = "mcp-stdio" | "opencode-extension";
export type McpToolReportVisibility = "reachable" | "unreachable" | "unknown" | "not-applicable";
export type McpToolReportInvocation = "success" | "failed" | "not-run" | "unknown";
export type McpToolReportFreshness = "fresh" | "stale" | "unknown";
export type McpToolReportReason =
  | "PROJECT_IDENTITY_REQUIRED"
  | "TOOL_DISABLED"
  | "TOOL_STATE_UNAVAILABLE"
  | "transport-unavailable"
  | "list-unavailable"
  | "not-listed"
  | "invocation-failed"
  | "invalid-response"
  | "unsafe-invocation"
  | "not-requested";

export interface McpToolReportTool {
  name: string;
  category: string;
  enabled: boolean;
  boundary: McpToolReportBoundary;
  visibility: { status: McpToolReportVisibility; reason: McpToolReportReason | null };
  invocation: { status: McpToolReportInvocation; reason: McpToolReportReason | null };
}

export interface McpToolReport {
  schemaVersion: 1;
  provenance: "fixture" | "live";
  generatedAt: string;
  freshness: {
    status: McpToolReportFreshness;
    observedAt: string | null;
    durationMs: number;
  };
  catalog: {
    status: "conformant" | "nonconformant" | "unknown";
    issues: Array<{ code: string; toolName: string }>;
    authorizedVisibleExpected: {
      toolCount: number;
      categoryCount: number;
    };
  };
  tools: McpToolReportTool[];
}

/** The API owns project identity for both catalog state and report data. */
export interface McpToolReportResponse {
  project: string;
  project_id: string;
  data: McpToolReport;
  total: number;
}

export interface McpToolReportFilters {
  q?: string;
  category?: string;
  enabled?: boolean;
  boundary?: McpToolReportBoundary;
  visibility?: McpToolReportVisibility;
  invocation?: McpToolReportInvocation;
}

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

/** Immutable, project-scoped context conversation metadata. */
export type ContextConversation = {
  id: string;
  project_id: string;
  title: string;
  tags: string;
  priority: number;
  metadata: string;
  created_at: string;
};

/** Conversation metadata enriched with immutable stream and checkpoint counts. */
export type ContextConversationSummary = ContextConversation & {
  revision: number;
  message_count: number;
  checkpoint_count: number;
  latest_message_id: string | null;
};

export type ContextMessageRole = "system" | "user" | "assistant" | "tool";

/** A message list/search projection. Content requires an explicit retrieve call. */
export type ContextMessageSummary = {
  id: string;
  project_id: string;
  conversation_id: string;
  sequence: number;
  role: ContextMessageRole;
  content_hash: string;
  tags: string;
  priority: number;
  metadata: string;
  created_at: string;
};

/** An explicitly retrieved immutable context message, including its content. */
export type ContextMessage = ContextMessageSummary & { content: string };

export type ContextMessageSearchResult = ContextMessageSummary & { rank: number };

/** A bounded excerpt returned by project-scoped Context RAG search. */
export type ContextRagCitation = {
  citationId: string;
  sourceId: string;
  title: string;
  sourceHash: string | null;
  sourcePath: string | null;
  sourceType: string;
  mimeType: string | null;
  provenance: string;
  sourceReference: string | null;
  chunkIndex: number;
  availability: "available";
  heading: string | null;
  snippet: string;
  score: number;
  createdAt: string;
};

export type ContextCheckpoint = {
  id: string;
  project_id: string;
  conversation_id: string;
  sequence: number;
  through_message_id: string;
  message_count: number;
  state_hash: string;
  metadata: string;
  created_at: string;
};

export type ContextKeysetPage<T> = { data: T[]; nextCursor: string | null };

export type ContextMessageBatch = { messages: ContextMessage[]; missingIds: string[] };

export type ContextCheckpointRestoreResult = {
  conversation: ContextConversationSummary;
  checkpoint: ContextCheckpoint;
  revision: number;
  idempotent: boolean;
};

export type ContextChatTurnResult = {
  conversation: ContextConversationSummary;
  userMessage: ContextMessageSummary;
  assistantMessage: ContextMessageSummary;
  checkpoint: ContextCheckpoint;
  revision: number;
  idempotent: boolean;
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

/** Explicit operation for protected OAuth client-secret settings. */
export type OAuthClientSecretOperation =
  | { action: "preserve" }
  | { action: "replace"; value: string }
  | { action: "clear" };

/** Sanitized response for a protected OAuth client-secret setting. */
export interface OAuthClientSecretSetting {
  key: string;
  isSet: boolean;
  masked: boolean;
}

/** Response shape shared by ordinary and protected settings endpoints. */
export interface SettingResponse {
  key: string;
  // Ordinary settings include a value. Protected OAuth responses omit it at
  // runtime, but callers must use isSet/masked rather than this field.
  value: string;
  isSet?: boolean;
  masked?: boolean;
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
  revision: number;
  vault_references: JobVaultReference[];
  created_at: string;
  updated_at: string;
};

export type JobVaultReferenceStatus = "authorized" | "version_stale" | "unavailable";

/** Safe job authorization projection: no item names, values, or current versions. */
export type JobVaultReference = {
  item_id: string;
  status: JobVaultReferenceStatus;
  authorized_item_version: number;
  authorized_at: string;
};

/** Fixed-shape metadata-only audit entry for one job's vault access boundary. */
export type JobVaultAuditEntry = {
  id: string;
  job_id: string;
  item_id: string | null;
  action: "authorized" | "revoked" | "secret_read" | "access_denied";
  actor_category: "authenticated_api" | "job_run";
  run_id: string | null;
  version: number | null;
  timestamp: string;
};

/** The only event types that a new job may subscribe to. */
export const TRUSTED_JOB_EVENT_TYPES = [
  "context.conversation.archived",
  "context.conversation.unarchived",
  "context.checkpoint.restored_as_new",
] as const;

export type TrustedJobEventType = (typeof TRUSTED_JOB_EVENT_TYPES)[number];
export type JobEventDeliveryState = "queued" | "leased" | "retry_wait" | "succeeded" | "dead_letter";

/** Metadata-only projection. Payload and schema internals are deliberately omitted. */
export type TrustedJobEvent = {
  id: string;
  event_type: TrustedJobEventType;
  source_audit_event_id: string;
  created_at: string;
};

/** Credential-free delivery projection. Lease ownership and process details are deliberately omitted. */
export type JobEventDelivery = {
  id: string;
  trusted_event_id: string;
  event_type: TrustedJobEventType;
  job_id: string;
  job_name: string;
  state: JobEventDeliveryState;
  attempt_count: number;
  next_attempt_at: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type JobEventPage<T> = { data: T[]; nextCursor: string | null };

export type JobRunEventDelivery = {
  delivery_id: string;
  trusted_event_id: string;
  attempt_number: number;
  delivery_state: JobEventDeliveryState;
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
  event_delivery?: JobRunEventDelivery | null;
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

type JobTextOptions = { maxBytes?: number; maxLines?: number };

const JOB_TEXT_DEFAULTS = { maxBytes: 512, maxLines: 8 } as const;
const JOB_SECRET_NAME = "(?:authorization|proxy[-_ ]?authorization|cookie|set[-_ ]?cookie|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|secret|password|passwd|token|credential(?:s)?|[A-Z][A-Z0-9_]*(?:API_KEY|SECRET_ACCESS_KEY|ACCESS_KEY|TOKEN|PASSWORD|CREDENTIAL|AUTHORIZATION|COOKIE))";
const JOB_BEARER_OR_BASIC = /\b(Bearer|Basic)\s+[^\s,;]+/gi;
const JOB_KEY_VALUE_SECRET = new RegExp(`(["']?${JOB_SECRET_NAME}["']?\\s*[:=]\\s*)(?:"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'|[^\\s,;}&\\]]+)`, "gi");
const JOB_URL_SECRET = new RegExp(`([?&]\\s*${JOB_SECRET_NAME}\\s*=)[^&#\\s]*`, "gi");

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  const encoder = new TextEncoder();
  for (const character of value) {
    const nextBytes = encoder.encode(character).byteLength;
    if (bytes + nextBytes > maxBytes) break;
    result += character;
    bytes += nextBytes;
  }
  return result;
}

/** Normalize all user-visible Jobs text before it reaches component state or the DOM. */
export function sanitizeJobDisplayText(value: unknown, fallback = "Unavailable", options: JobTextOptions = {}): string {
  const maxBytes = options.maxBytes ?? JOB_TEXT_DEFAULTS.maxBytes;
  const maxLines = options.maxLines ?? JOB_TEXT_DEFAULTS.maxLines;
  if (typeof value !== "string" || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxLines) || maxLines < 1) return fallback;
  const redacted = value
    .split(/\r\n|\r|\n/).slice(0, maxLines).join(" ")
    .replace(JOB_BEARER_OR_BASIC, "$1 [REDACTED]")
    .replace(JOB_KEY_VALUE_SECRET, "$1[REDACTED]")
    .replace(JOB_URL_SECRET, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/gi, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateUtf8(redacted, maxBytes) || fallback;
}

export function normalizeJobErrorCode(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
    ? value
    : "job_event_failure";
}

function jobRecord(value: unknown, error = "Invalid job response."): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function jobId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`Invalid ${field} in job response.`);
  }
  return value;
}

function jobTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 64) throw new Error(`Invalid ${field} in job response.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(value);
  const date = match ? new Date(value) : null;
  if (!match || !date || Number.isNaN(date.getTime()) || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3]) || date.getUTCHours() !== Number(match[4]) || date.getUTCMinutes() !== Number(match[5]) || date.getUTCSeconds() !== Number(match[6])) {
    throw new Error(`Invalid ${field} in job response.`);
  }
  return value;
}

function nullableJobTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : jobTimestamp(value, field);
}

function jobInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${field} in job response.`);
  }
  return value;
}

function jobEventType(value: unknown): TrustedJobEventType {
  if (typeof value !== "string" || !(TRUSTED_JOB_EVENT_TYPES as readonly string[]).includes(value)) {
    throw new Error("Invalid event_type in job response.");
  }
  return value as TrustedJobEventType;
}

function jobDeliveryState(value: unknown): JobEventDeliveryState {
  if (value !== "queued" && value !== "leased" && value !== "retry_wait" && value !== "succeeded" && value !== "dead_letter") {
    throw new Error("Invalid delivery state in job response.");
  }
  return value;
}

function jobVaultReferenceStatus(value: unknown): JobVaultReferenceStatus {
  if (value !== "authorized" && value !== "version_stale" && value !== "unavailable") {
    throw new Error("Invalid vault reference status in job response.");
  }
  return value;
}

export function normalizeJobVaultReference(value: unknown): JobVaultReference {
  const record = jobRecord(value, "Invalid vault reference response.");
  return {
    item_id: jobId(record.item_id, "vault item ID"),
    status: jobVaultReferenceStatus(record.status),
    authorized_item_version: jobInteger(record.authorized_item_version, "authorized item version", 1, Number.MAX_SAFE_INTEGER),
    authorized_at: jobTimestamp(record.authorized_at, "vault authorization timestamp"),
  };
}

/** Drop every non-contract job field before it can reach dashboard state or the DOM. */
export function normalizeJob(value: unknown): Job {
  const record = jobRecord(value);
  if (typeof record.name !== "string" || record.name.length < 1 || record.name.length > 512
    || typeof record.agent !== "string" || record.agent.length < 1 || record.agent.length > 256
    || typeof record.prompt_template !== "string" || record.prompt_template.length > 262_144
    || (record.description !== null && record.description !== undefined && typeof record.description !== "string")
    || (record.schedule_cron !== null && record.schedule_cron !== undefined && typeof record.schedule_cron !== "string")
    || (record.trigger_event !== null && record.trigger_event !== undefined && typeof record.trigger_event !== "string")
    || !Array.isArray(record.vault_references)) {
    throw new Error("Invalid job response.");
  }
  if (record.enabled !== true && record.enabled !== false && record.enabled !== 0 && record.enabled !== 1) {
    throw new Error("Invalid enabled in job response.");
  }
  return {
    id: jobId(record.id, "job ID"),
    project_id: jobId(record.project_id, "project ID"),
    name: sanitizeJobDisplayText(record.name, "Unnamed job", { maxBytes: 512, maxLines: 2 }),
    description: record.description === null || record.description === undefined
      ? null
      : sanitizeJobDisplayText(record.description, "", { maxBytes: 4_096, maxLines: 16 }),
    agent: sanitizeJobDisplayText(record.agent, "Unknown agent", { maxBytes: 256, maxLines: 2 }),
    prompt_template: record.prompt_template,
    schedule_cron: record.schedule_cron === null || record.schedule_cron === undefined ? null : record.schedule_cron,
    trigger_event: record.trigger_event === null || record.trigger_event === undefined ? null : record.trigger_event,
    enabled: record.enabled === true || record.enabled === 1,
    timeout_minutes: jobInteger(record.timeout_minutes, "job timeout", 1, 1_440),
    revision: jobInteger(record.revision, "job revision", 0, Number.MAX_SAFE_INTEGER),
    vault_references: record.vault_references.map(normalizeJobVaultReference),
    created_at: jobTimestamp(record.created_at, "job creation timestamp"),
    updated_at: jobTimestamp(record.updated_at, "job update timestamp"),
  };
}

export function normalizeJobVaultAuditEntry(value: unknown): JobVaultAuditEntry {
  const record = jobRecord(value, "Invalid job vault audit response.");
  if ((record.action !== "authorized" && record.action !== "revoked" && record.action !== "secret_read" && record.action !== "access_denied")
    || (record.actor_category !== "authenticated_api" && record.actor_category !== "job_run")
    || (record.item_id !== null && typeof record.item_id !== "string")
    || (record.run_id !== null && typeof record.run_id !== "string")
    || (record.version !== null && (typeof record.version !== "number" || !Number.isSafeInteger(record.version) || record.version < 1))) {
    throw new Error("Invalid job vault audit response.");
  }
  const runtime = record.action === "secret_read" || record.action === "access_denied";
  if ((runtime && (record.actor_category !== "job_run" || record.run_id === null))
    || (!runtime && (record.actor_category !== "authenticated_api" || record.run_id !== null || record.item_id === null || record.version === null))
    || (record.action === "secret_read" && (record.item_id === null || record.version === null))
    || (record.action === "access_denied" && (record.item_id !== null || record.version !== null))) {
    throw new Error("Invalid job vault audit response.");
  }
  return {
    id: jobId(record.id, "job vault audit ID"),
    job_id: jobId(record.job_id, "job ID"),
    item_id: record.item_id === null ? null : jobId(record.item_id, "vault item ID"),
    action: record.action,
    actor_category: record.actor_category,
    run_id: record.run_id === null ? null : jobId(record.run_id, "run ID"),
    version: record.version,
    timestamp: jobTimestamp(record.timestamp, "job vault audit timestamp"),
  };
}

export function normalizeTrustedJobEvent(value: unknown): TrustedJobEvent {
  const record = jobRecord(value, "Invalid trusted event response.");
  return {
    id: jobId(record.id, "trusted event ID"),
    event_type: jobEventType(record.event_type),
    source_audit_event_id: jobId(record.source_audit_event_id, "source audit ID"),
    created_at: jobTimestamp(record.created_at, "trusted event timestamp"),
  };
}

export function normalizeJobEventDelivery(value: unknown): JobEventDelivery {
  const record = jobRecord(value, "Invalid event delivery response.");
  if (typeof record.job_name !== "string" || !record.job_name.trim() || (record.last_error_code !== null && typeof record.last_error_code !== "string") || (record.last_error_message !== null && typeof record.last_error_message !== "string")) {
    throw new Error("Invalid event delivery response.");
  }
  const jobName = sanitizeJobDisplayText(record.job_name, "Unnamed job", { maxBytes: 256, maxLines: 2 });
  return {
    id: jobId(record.id, "delivery ID"),
    trusted_event_id: jobId(record.trusted_event_id, "trusted event ID"),
    event_type: jobEventType(record.event_type),
    job_id: jobId(record.job_id, "job ID"),
    job_name: jobName,
    state: jobDeliveryState(record.state),
    attempt_count: jobInteger(record.attempt_count, "attempt count", 0, 5),
    next_attempt_at: nullableJobTimestamp(record.next_attempt_at, "next attempt timestamp"),
    lease_expires_at: nullableJobTimestamp(record.lease_expires_at, "lease expiry timestamp"),
    last_error_code: record.last_error_code === null ? null : normalizeJobErrorCode(record.last_error_code),
    last_error_message: record.last_error_message === null
      ? null
      : sanitizeJobDisplayText(record.last_error_message, "Event delivery failed.", { maxBytes: 512, maxLines: 8 }),
    created_at: jobTimestamp(record.created_at, "delivery creation timestamp"),
    updated_at: jobTimestamp(record.updated_at, "delivery update timestamp"),
  };
}

function normalizeJobRunEventDelivery(value: unknown): JobRunEventDelivery {
  const record = jobRecord(value, "Invalid run delivery metadata.");
  return {
    delivery_id: jobId(record.delivery_id, "delivery ID"),
    trusted_event_id: jobId(record.trusted_event_id, "trusted event ID"),
    attempt_number: jobInteger(record.attempt_number, "attempt number", 1, 5),
    delivery_state: jobDeliveryState(record.delivery_state),
  };
}

export function normalizeJobRun(value: unknown): JobRun {
  const record = jobRecord(value, "Invalid job run response.");
  if (record.status !== "queued" && record.status !== "running" && record.status !== "success" && record.status !== "failed" && record.status !== "timeout" && record.status !== "cancelled") {
    throw new Error("Invalid run status in job response.");
  }
  if (record.trigger !== "manual" && record.trigger !== "cron" && record.trigger !== "event") {
    throw new Error("Invalid run trigger in job response.");
  }
  const startedAt = record.started_at === undefined || record.started_at === null ? undefined : jobTimestamp(record.started_at, "run start timestamp");
  const finishedAt = record.finished_at === undefined || record.finished_at === null ? undefined : jobTimestamp(record.finished_at, "run finish timestamp");
  const exitCode = record.exit_code === undefined || record.exit_code === null ? undefined : jobInteger(record.exit_code, "exit code", -1_000_000, 1_000_000);
  return {
    id: jobId(record.id, "run ID"),
    job_id: jobId(record.job_id, "job ID"),
    status: record.status,
    trigger: record.trigger,
    ...(startedAt ? { started_at: startedAt } : {}),
    ...(finishedAt ? { finished_at: finishedAt } : {}),
    ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
    created_at: jobTimestamp(record.created_at, "run creation timestamp"),
    ...(record.event_delivery === undefined ? {} : { event_delivery: record.event_delivery === null ? null : normalizeJobRunEventDelivery(record.event_delivery) }),
  };
}

export function normalizeJobRunLog(value: unknown): JobRunLog {
  const record = jobRecord(value, "Invalid run log response.");
  if ((record.stream !== "stdout" && record.stream !== "stderr") || typeof record.line !== "string") throw new Error("Invalid log response.");
  return {
    id: jobInteger(record.id, "log ID", 0, Number.MAX_SAFE_INTEGER),
    run_id: jobId(record.run_id, "run ID"),
    seq: jobInteger(record.seq, "log sequence", 0, Number.MAX_SAFE_INTEGER),
    stream: record.stream,
    line: sanitizeJobDisplayText(record.line, "", { maxBytes: 4_096, maxLines: 16 }),
    created_at: jobTimestamp(record.created_at, "log timestamp"),
  };
}

export function normalizeJobPage<T>(value: unknown, normalizeEntry: (entry: unknown) => T): JobEventPage<T> {
  const record = jobRecord(value, "Invalid job page response.");
  if (!Array.isArray(record.data) || (record.nextCursor !== null && (typeof record.nextCursor !== "string" || record.nextCursor.length === 0 || record.nextCursor.length > 512))) {
    throw new Error("Invalid job page response.");
  }
  return { data: record.data.map(normalizeEntry), nextCursor: record.nextCursor };
}

function normalizeJobCollection<T>(value: unknown, normalizeEntry: (entry: unknown) => T): { data: T[]; total: number } {
  const record = jobRecord(value, "Invalid job collection response.");
  if (!Array.isArray(record.data)) throw new Error("Invalid job collection response.");
  return { data: record.data.map(normalizeEntry), total: record.data.length };
}

function normalizeJobData<T>(value: unknown, normalize: (data: unknown) => T): { data: T } {
  const record = jobRecord(value);
  return { data: normalize(record.data) };
}

async function jobsRequest<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, options);
  } catch (error: unknown) {
    const apiError = error instanceof ApiError ? error : null;
    throw new ApiError(
      apiError?.status ?? 0,
      sanitizeJobDisplayText(error instanceof Error ? error.message : undefined, "Job request failed.", { maxBytes: 512, maxLines: 8 }),
      apiError?.retryAfterSeconds ?? null,
      apiError?.code ?? null,
      apiError?.currentRevision ?? null,
      apiError?.retryAfterStatus,
    );
  }
}

async function normalizedJobsRequest<T>(path: string, normalize: (value: unknown) => T, options?: RequestInit): Promise<T> {
  try {
    return normalize(await jobsRequest<unknown>(path, options));
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, "Invalid job response.", null);
  }
}

function isValidDashboardProjectName(project: string): boolean {
  return project.length > 0
    && project.length <= 64
    && project === project.trim()
    && project !== "."
    && project !== ".."
    && !/[\\/\u0000-\u001f\u007f]/.test(project);
}

function jobsQuery(project: string, options?: { limit?: number; cursor?: string }): URLSearchParams {
  if (!isValidDashboardProjectName(project)) throw new Error("A validated project is required for job requests.");
  const params = new URLSearchParams({ project });
  if (options?.limit !== undefined) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new Error("Job request limit must be an integer between 1 and 100.");
    }
    params.set("limit", String(options.limit));
  }
  if (options?.cursor !== undefined) {
    if (options.cursor.length === 0 || options.cursor.length > 512) throw new Error("Job request cursor is invalid.");
    params.set("cursor", options.cursor);
  }
  return params;
}


export type VaultStatus = "sealed" | "unsealed";
export const EMPTY_VAULT_RESET_CONFIRMATION = "RESET EMPTY VAULT" as const;
export const EMPTY_VAULT_RESET_REASONS = {
  notInitialized: "The vault is not initialized.",
  unsealed: "Enter your current passphrase to continue, or lock the vault before checking reset eligibility.",
  protectedDependencies: "Protected provider or vault dependencies still exist. Enter the current passphrase, or remove/reconfigure those dependencies before trying again.",
} as const;

export type EmptyVaultResetEligibility =
  | { eligible: true; reason: null }
  | { eligible: false; reason: typeof EMPTY_VAULT_RESET_REASONS[keyof typeof EMPTY_VAULT_RESET_REASONS] };

export type VaultItemType = "login" | "api_key" | "note" | "oauth";

export interface VaultFolder {
  id: string;
  name: string;
  item_count: number;
  created_at: string;
  owner_kind?: "user" | "organization";
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
  version: number;
  created_at: string;
  updated_at: string;
  organization_id?: string;
  owner_kind?: "user" | "organization";
  owner_user_id?: string | null;
  effective_capabilities?: string[];
}

export interface VaultItemDetail extends VaultItem {
  value?: string; // only populated on reveal
  notes?: string;
  password_strength?: number;
}

export interface AuditEntry {
  id: number;
  item_id: string | null;
  event_type: string;
  actor: string;
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
  project: string | null;
  configured: boolean;
  primary: ChatConfigProviderInfo | null;
  backup: ChatConfigProviderInfo | null;
  agents: Array<{ name: string; label: string }>;
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
  allowPrivateNetwork?: boolean;
  apiKeySet: boolean;
  apiKey?: string;
  ownerKind?: "installation" | "user" | "organization";
  organizationId?: string;
  ownerUserId?: string | null;
  effectiveCapabilities?: string[];
}

function isApiRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function apiString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Preserve only a server-attested project name; never substitute browser state. */
function normalizeChatConfigProject(value: unknown): string | null {
  const project = apiString(value);
  return project.length > 0
    && project.length <= 64
    && project === project.trim()
    && project !== "."
    && project !== ".."
    && !/[\\/\u0000-\u001f\u007f]/.test(project)
    ? project
    : null;
}

function apiStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (!isApiRecord(value)) return [];
  return Object.keys(value);
}

function apiProviderSelection(value: unknown): { providerId: string; modelId: string } {
  if (!isApiRecord(value)) return { providerId: "", modelId: "" };
  return {
    providerId: apiString(value.providerId ?? value.provider ?? value.id),
    modelId: apiString(value.modelId ?? value.model),
  };
}

function unwrapApiData(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isApiRecord(current) || !("data" in current)) return current;
    current = current.data;
  }
  return current;
}

/** Normalize current, legacy, and malformed provider-config responses at the API boundary. */
export function normalizeManagedProviderConfigResponse(value: unknown): {
  providers: ManagedProviderConfig[];
  synthesis: {
    primary: { providerId: string; modelId: string };
    secondary: { providerId: string; modelId: string };
  };
} {
  const root = unwrapApiData(value);
  const record = isApiRecord(root) ? root : {};
  const source = Array.isArray(root)
    ? root
    : Array.isArray(record.providers)
      ? record.providers
      : Array.isArray(record.configuredProviders)
        ? record.configuredProviders
        : [];
  const providers = source.flatMap((entry): ManagedProviderConfig[] => {
    if (!isApiRecord(entry)) return [];
    const id = apiString(entry.id).trim();
    if (!id) return [];
    const models = apiStringArray(entry.models);
    const rolesValue = Array.isArray(entry.roles) ? entry.roles : [entry.role];
    const roles = rolesValue.filter(
      (role): role is ProviderRole => role === "available" || role === "primary" || role === "backup",
    );
    if (!roles.includes("available") && (roles.includes("primary") || roles.includes("backup"))) {
      roles.unshift("available");
    }
    return [{
      id,
      name: apiString(entry.name ?? entry.label, id),
      npm: apiString(entry.npm, "@ai-sdk/openai-compatible"),
      baseURL: apiString(entry.baseURL ?? entry.baseUrl),
      models,
      defaultModel: apiString(entry.defaultModel, models[0] ?? ""),
      roles: roles.length > 0 ? roles : ["available"],
      enabled: entry.enabled !== false,
      allowPrivateNetwork: entry.allowPrivateNetwork === true,
      apiKeySet: entry.apiKeySet === true,
      ...(typeof entry.apiKey === "string" ? { apiKey: entry.apiKey } : {}),
      ownerKind: entry.ownerKind === "user" || entry.ownerKind === "organization" ? entry.ownerKind : "installation",
      organizationId: apiString(entry.organizationId) || undefined,
      ownerUserId: typeof entry.ownerUserId === "string" ? entry.ownerUserId : null,
      effectiveCapabilities: apiStringArray(entry.effectiveCapabilities),
    }];
  });
  const synthesis = isApiRecord(record.synthesis) ? record.synthesis : {};
  const secondaryValue = synthesis.secondary ?? synthesis.backup ?? record.secondary ?? record.backup;
  return {
    providers,
    synthesis: {
      primary: apiProviderSelection(synthesis.primary ?? record.primary),
      secondary: apiProviderSelection(secondaryValue),
    },
  };
}

function normalizeChatProvider(value: unknown): ChatProviderInfo | null {
  if (!isApiRecord(value)) return null;
  const providerId = apiString(value.providerId ?? value.id).trim();
  if (!providerId) return null;
  const modelsValue = Array.isArray(value.models) ? value.models : [];
  const models = modelsValue.flatMap((model): ChatProviderModel[] => {
    if (typeof model === "string") return [{ id: model, label: model }];
    if (!isApiRecord(model)) return [];
    const id = apiString(model.id).trim();
    return id ? [{ id, label: apiString(model.label ?? model.name, id) }] : [];
  });
  return {
    providerId,
    label: apiString(value.label ?? value.name, providerId),
    models,
    defaultModel: apiString(value.defaultModel, models[0]?.id ?? ""),
    source: value.source === "builtin" ? "builtin" : "managed",
  };
}

/** Keep ChatShell provider/model collections array-shaped even for old API payloads. */
export function normalizeChatConfigResponse(value: unknown): ChatConfigResponse {
  const root = unwrapApiData(value);
  const record = isApiRecord(root) ? root : {};
  const providers = (Array.isArray(record.providers) ? record.providers : [])
    .map(normalizeChatProvider)
    .filter((provider): provider is ChatProviderInfo => provider !== null);
  const agents = (Array.isArray(record.agents) ? record.agents : []).flatMap((agent): Array<{ name: string; label: string }> => {
    if (!isApiRecord(agent)) return [];
    const name = apiString(agent.name).trim();
    if (!name) return [];
    return [{ name, label: apiString(agent.label ?? agent.name, name) }];
  });
  const primary = isApiRecord(record.primary) ? {
    ...apiProviderSelection(record.primary),
    label: apiString(record.primary.label, apiProviderSelection(record.primary).providerId),
    isCustom: record.primary.isCustom === true,
  } : null;
  const backup = isApiRecord(record.backup) ? {
    ...apiProviderSelection(record.backup),
    label: apiString(record.backup.label, apiProviderSelection(record.backup).providerId),
    isCustom: record.backup.isCustom === true,
  } : null;
  const defaultSelection = isApiRecord(record.defaultSelection)
    ? apiProviderSelection(record.defaultSelection)
    : null;
  return {
    project: normalizeChatConfigProject(record.project),
    configured: record.configured === true,
    primary,
    backup,
    agents,
    providers,
    defaultSelection: defaultSelection && (defaultSelection.providerId || defaultSelection.modelId)
      ? defaultSelection
      : null,
  };
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
  services: Array<{ name: string; status: string; uptime?: number; required?: boolean }>;
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

/** Provider-neutral usage telemetry returned by the usage API. */
export type UsageAvailability = "known" | "partial" | "unavailable";
export type UsageStatus = "success" | "error" | "partial" | "unknown";

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

export interface UsageEvent {
  id: string;
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
  tokens: {
    total: number | null;
    input: number | null;
    output: number | null;
    reasoning: number | null;
  };
  cache: {
    read: number | null;
    write: number | null;
  };
  cost: { amount: number | null; availability: UsageAvailability };
  createdAt: string;
  updatedAt: string;
}

export interface UsageEventsPage {
  data: UsageEvent[];
  pagination: { nextCursor: string | null; hasMore: boolean; total: number };
}

/** Advisory configuration is deliberately separate from raw usage telemetry. */
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

export interface UsageAdvisoryThresholdReplacement {
  expectedRevision: number;
  requestCount: number | null;
  totalTokens: number | null;
  reportedCostAmount: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export type UsageAdvisoryState = "disabled" | "unknown" | "below" | "equal" | "above";
export type UsageAttentionStatus = "active" | "resolved";
export type UsageAttentionSeverity = "info" | "warning" | "critical";
export type UsageAttentionFreshness = "disabled" | "unknown" | "fresh" | "stale";
export type UsageAttentionMetric = "request_count" | "total_tokens" | "reported_cost_amount" | "cache_read_tokens" | "cache_write_tokens";

export interface UsageAdvisoryMetric {
  observed: number | null;
  threshold: number | null;
  availability: UsageAvailability;
  state: UsageAdvisoryState;
}

export interface UsageAdvisoryEvaluation {
  range: { from: string; to: string };
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

/** Safe advisory-only attention DTO. No source, provider, payload, prompt, or enforcement fields enter UI state. */
export interface UsageAttentionItem {
  id: string;
  metric: UsageAttentionMetric;
  status: UsageAttentionStatus;
  evaluationState: UsageAdvisoryState;
  severity: UsageAttentionSeverity;
  observed: number | null;
  threshold: number | null;
  availability: UsageAvailability;
  freshness: UsageAttentionFreshness;
  thresholdRevision: number;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  reopenedAt: string | null;
  reopenCount: number;
  lastEvaluatedAt: string;
  revision: number;
  updatedAt: string;
}

export interface UsageAttentionPage {
  data: UsageAttentionItem[];
  pagination: { nextCursor: string | null; hasMore: boolean; total: number };
}

export interface UsageQuery {
  from: string;
  to: string;
  providerIds?: string[];
  modelIds?: string[];
  agentIds?: string[];
  statuses?: UsageStatus[];
}

function usageUtcTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 64) throw new Error(`Invalid ${field} for usage request.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(value);
  const date = match ? new Date(value) : null;
  if (!match || !date || Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3]) || date.getUTCHours() !== Number(match[4])
    || date.getUTCMinutes() !== Number(match[5]) || date.getUTCSeconds() !== Number(match[6])) {
    throw new Error(`Invalid ${field} for usage request.`);
  }
  return value;
}

function usageProjectParams(project: string): URLSearchParams {
  if (!isValidDashboardProjectName(project)) throw new Error("A validated project is required for usage requests.");
  return new URLSearchParams({ project });
}

function usageCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 512) throw new Error("Usage request cursor is invalid.");
  return value;
}

function usageLimit(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("Usage request limit must be an integer between 1 and 100.");
  return value;
}

/** Serialize raw usage filter values without normalizing provider or model IDs. */
export function usageQueryParams(project: string, query: UsageQuery, extras?: { limit?: number; cursor?: string }): URLSearchParams {
  const from = usageUtcTimestamp(query.from, "from timestamp");
  const to = usageUtcTimestamp(query.to, "to timestamp");
  if (Date.parse(to) <= Date.parse(from)) throw new Error("The usage end timestamp must be after the start timestamp.");
  const params = usageProjectParams(project);
  params.set("from", from);
  params.set("to", to);
  query.providerIds?.forEach((providerId) => params.append("provider", providerId));
  query.modelIds?.forEach((modelId) => params.append("model", modelId));
  query.agentIds?.forEach((agentId) => params.append("agent", agentId));
  query.statuses?.forEach((status) => {
    if (status !== "success" && status !== "error" && status !== "partial" && status !== "unknown") {
      throw new Error("Usage request status is invalid.");
    }
    params.append("status", status);
  });
  const limit = usageLimit(extras?.limit);
  const cursor = usageCursor(extras?.cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  if (cursor !== undefined) params.set("cursor", cursor);
  return params;
}

function usageRecord(value: unknown, error = "Invalid usage advisory response."): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function usageId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`Invalid ${field} in usage advisory response.`);
  return value;
}

function usageInteger(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${field} in usage advisory response.`);
  return value;
}

function usageFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${field} in usage advisory response.`);
  return value;
}

function usageNullableNumber(value: unknown, field: string): number | null {
  return value === null ? null : usageFiniteNumber(value, field);
}

function usageNullableInteger(value: unknown, field: string): number | null {
  return value === null ? null : usageInteger(value, field);
}

function usageEnum<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`Invalid ${field} in usage advisory response.`);
  return value as T;
}

function usageNullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : usageUtcTimestamp(value, field);
}

export function normalizeUsageAdvisoryThresholds(value: unknown): UsageAdvisoryThresholds {
  const record = usageRecord(value);
  return {
    requestCount: usageNullableInteger(record.requestCount, "request count threshold"),
    totalTokens: usageNullableInteger(record.totalTokens, "total tokens threshold"),
    reportedCostAmount: usageNullableNumber(record.reportedCostAmount, "reported cost amount threshold"),
    cacheReadTokens: usageNullableInteger(record.cacheReadTokens, "cache read threshold"),
    cacheWriteTokens: usageNullableInteger(record.cacheWriteTokens, "cache write threshold"),
    revision: usageInteger(record.revision, "threshold revision", 1),
    createdAt: usageNullableTimestamp(record.createdAt, "threshold creation timestamp"),
    updatedAt: usageNullableTimestamp(record.updatedAt, "threshold update timestamp"),
  };
}

function normalizeUsageAdvisoryMetric(value: unknown, integer: boolean): UsageAdvisoryMetric {
  const record = usageRecord(value);
  return {
    observed: integer ? usageNullableInteger(record.observed, "advisory observed value") : usageNullableNumber(record.observed, "advisory observed value"),
    threshold: integer ? usageNullableInteger(record.threshold, "advisory threshold") : usageNullableNumber(record.threshold, "advisory threshold"),
    availability: usageEnum(record.availability, ["known", "partial", "unavailable"] as const, "advisory availability"),
    state: usageEnum(record.state, ["disabled", "unknown", "below", "equal", "above"] as const, "advisory state"),
  };
}

export function normalizeUsageAdvisoryEvaluation(value: unknown): UsageAdvisoryEvaluation {
  const record = usageRecord(value);
  const range = usageRecord(record.range);
  const metrics = usageRecord(record.metrics);
  return {
    range: {
      from: usageUtcTimestamp(range.from, "advisory range start"),
      to: usageUtcTimestamp(range.to, "advisory range end"),
    },
    generatedAt: usageUtcTimestamp(record.generatedAt, "advisory generated timestamp"),
    thresholds: normalizeUsageAdvisoryThresholds(record.thresholds),
    metrics: {
      requestCount: normalizeUsageAdvisoryMetric(metrics.requestCount, true),
      totalTokens: normalizeUsageAdvisoryMetric(metrics.totalTokens, true),
      reportedCostAmount: normalizeUsageAdvisoryMetric(metrics.reportedCostAmount, false),
      cacheReadTokens: normalizeUsageAdvisoryMetric(metrics.cacheReadTokens, true),
      cacheWriteTokens: normalizeUsageAdvisoryMetric(metrics.cacheWriteTokens, true),
    },
  };
}

export function normalizeUsageAttentionItem(value: unknown): UsageAttentionItem {
  const record = usageRecord(value);
  const metric = usageEnum(record.metric, ["request_count", "total_tokens", "reported_cost_amount", "cache_read_tokens", "cache_write_tokens"] as const, "attention metric");
  const integer = metric !== "reported_cost_amount";
  return {
    id: usageId(record.id, "attention ID"),
    metric,
    status: usageEnum(record.status, ["active", "resolved"] as const, "attention status"),
    evaluationState: usageEnum(record.evaluationState, ["disabled", "unknown", "below", "equal", "above"] as const, "attention state"),
    severity: usageEnum(record.severity, ["info", "warning", "critical"] as const, "attention severity"),
    observed: integer ? usageNullableInteger(record.observed, "attention observed value") : usageNullableNumber(record.observed, "attention observed value"),
    threshold: integer ? usageNullableInteger(record.threshold, "attention threshold") : usageNullableNumber(record.threshold, "attention threshold"),
    availability: usageEnum(record.availability, ["known", "partial", "unavailable"] as const, "attention availability"),
    freshness: usageEnum(record.freshness, ["disabled", "unknown", "fresh", "stale"] as const, "attention freshness"),
    thresholdRevision: usageInteger(record.thresholdRevision, "attention threshold revision", 1),
    openedAt: usageUtcTimestamp(record.openedAt, "attention opened timestamp"),
    acknowledgedAt: usageNullableTimestamp(record.acknowledgedAt, "attention acknowledgement timestamp"),
    resolvedAt: usageNullableTimestamp(record.resolvedAt, "attention resolution timestamp"),
    reopenedAt: usageNullableTimestamp(record.reopenedAt, "attention reopen timestamp"),
    reopenCount: usageInteger(record.reopenCount, "attention reopen count"),
    lastEvaluatedAt: usageUtcTimestamp(record.lastEvaluatedAt, "attention evaluation timestamp"),
    revision: usageInteger(record.revision, "attention revision", 1),
    updatedAt: usageUtcTimestamp(record.updatedAt, "attention update timestamp"),
  };
}

export function normalizeUsageAttentionPage(value: unknown): UsageAttentionPage {
  const record = usageRecord(value);
  const pagination = usageRecord(record.pagination);
  if (!Array.isArray(record.data)) throw new Error("Invalid usage attention response.");
  const nextCursor = pagination.nextCursor;
  if (nextCursor !== null && (typeof nextCursor !== "string" || nextCursor.length === 0 || nextCursor.length > 512)) {
    throw new Error("Invalid usage attention response.");
  }
  return {
    data: record.data.map(normalizeUsageAttentionItem),
    pagination: {
      nextCursor,
      hasMore: typeof pagination.hasMore === "boolean" ? pagination.hasMore : (() => { throw new Error("Invalid usage attention response."); })(),
      total: usageInteger(pagination.total, "attention total"),
    },
  };
}

function normalizeUsageData<T>(value: unknown, normalize: (data: unknown) => T): { data: T } {
  return { data: normalize(usageRecord(value).data) };
}

async function normalizedUsageRequest<T>(path: string, normalize: (value: unknown) => T, options?: RequestInit): Promise<T> {
  try {
    return normalize(await request<unknown>(path, options));
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, "Invalid usage advisory response.", null);
  }
}


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
 * The client exposes the dashboard's supported resource groups and their typed
 * HTTP operations.
 */
export const api = {
  auth: {
    csrf: () => request<{ data: { csrfToken: string } }>("/auth/csrf"),
    session: loadAuthenticatedSession,
    login: (email: string, password: string, csrfToken: string, deviceLabel?: string) => request<{ data: { user?: AuthUser; csrfToken?: string; mfaRequired?: boolean; challengeToken?: string } }>("/auth/login", { method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ email, password, deviceLabel }) }),
    mfaChallenge: (challengeToken: string, code: string, csrfToken: string) => request<{ data: { user: AuthUser; csrfToken: string } }>("/auth/mfa/challenge", { method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ challengeToken, code }) }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    forgotPassword: (email: string, csrfToken: string) => request<{ data: { accepted: boolean } }>("/auth/password/forgot", { method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ email }) }),
    resetPassword: (token: string, password: string, csrfToken: string) => request<void>("/auth/password/reset", { method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ token, password }) }),
    verifyEmail: (token: string, csrfToken: string) => request<void>("/auth/email/verify", { method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ token }) }),
    invitationPreview: (token: string) => request<{ data: { organizationName: string; email: string; role: string; expiresAt: string } }>(`/auth/invitations/preview?token=${encodeURIComponent(token)}`),
    acceptInvitation: (token: string) => request<void>("/auth/invitations/accept", { method: "POST", body: JSON.stringify({ token }) }),
    oidcProviders: () => request<{ data: Array<{ id: string; name: string }> }>("/auth/oidc/providers"),
    oidcStart: (providerId: string, csrfToken: string) => request<{ data: { authorizationUrl: string; state: string } }>("/auth/oidc/start", { method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ providerId }) }),
    oidcCallback: (state: string, code: string) => request<{ data: { user: AuthUser; csrfToken: string } }>(`/auth/oidc/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`),
    sessions: () => request<{ data: SessionDevice[] }>("/auth/sessions"),
    revokeSession: (id: string) => request<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    revokeOtherSessions: () => request<{ data: { revoked: number } }>("/auth/sessions/revoke-others", { method: "POST" }),
    stepUp: async (credential: string) => {
      const response = await request<{ data: { csrfToken: string; recentStepUp: true } }>("/auth/step-up", { method: "POST", body: JSON.stringify({ credential }) });
      setSessionCsrfToken(response.data.csrfToken);
      return response;
    },
    changePassword: (currentPassword: string, password: string) => request<{ data: { csrfToken: string } }>("/auth/password/change", { method: "POST", body: JSON.stringify({ currentPassword, password }) }),
    totpEnroll: () => request<{ data: { factorId: string; secret: string } }>("/auth/totp/enroll", { method: "POST" }),
    totpConfirm: (factorId: string, code: string) => request<{ data: { recoveryCodes: string[]; csrfToken: string } }>("/auth/totp/confirm", { method: "POST", body: JSON.stringify({ factorId, code }) }),
    totpRemove: (code: string) => request<{ data: { csrfToken: string } }>("/auth/totp", { method: "DELETE", body: JSON.stringify({ code }) }),
    tokens: () => request<{ data: ApiTokenSummary[] }>("/auth/tokens"),
    createToken: (input: { name: string; scopes: string[]; expiresAt: string; organizationId?: string; projectId?: string }) => request<{ data: ApiTokenSummary }>("/auth/tokens", { method: "POST", body: JSON.stringify(input) }),
    revokeToken: (id: string) => request<void>(`/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  bootstrap: {
    status: () => request<{ data: { state: "pending" | "claimed"; revision: number } }>("/bootstrap/status"),
    claim: (email: string, displayName: string, password: string) => request<{ data: { userId: string; organizationId: string } }>("/bootstrap/claim", { method: "POST", body: JSON.stringify({ email, displayName, password }) }),
  },
  organizations: {
    list: () => request<{ data: OrganizationSummary[] }>("/organizations"),
    members: (id: string) => request<{ data: OrganizationMember[]; capabilities: OrganizationCapabilities }>(`/organizations/${encodeURIComponent(id)}/members`),
    invitations: (id: string) => request<{ data: Array<{ id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null }> }>(`/organizations/${encodeURIComponent(id)}/invitations`),
    invite: (id: string, email: string, role: string) => request<{ data: { invited: true } }>(`/organizations/${encodeURIComponent(id)}/invitations`, { method: "POST", body: JSON.stringify({ email, role }) }),
    revokeInvitation: (id: string, invitationId: string) => request<void>(`/organizations/${encodeURIComponent(id)}/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE" }),
    setMemberRole: (id: string, userId: string, role: string) => request<void>(`/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    removeMember: (id: string, userId: string) => request<void>(`/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
    projectMembers: (id: string, project: string) => request<{ data: ProjectMember[]; capabilities: OrganizationCapabilities }>(`/organizations/${encodeURIComponent(id)}/projects/${encodeURIComponent(project)}/members`),
    setProjectMember: (id: string, project: string, userId: string, role: string) => request<void>(`/organizations/${encodeURIComponent(id)}/projects/${encodeURIComponent(project)}/members/${encodeURIComponent(userId)}`, { method: "PUT", body: JSON.stringify({ role }) }),
    removeProjectMember: (id: string, project: string, userId: string) => request<void>(`/organizations/${encodeURIComponent(id)}/projects/${encodeURIComponent(project)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  },
  projects: {
    list: () => request<{ data: Project[] }>("/projects"),
    create: (name: string) => request<{ data: Project }>("/projects", { method: "POST", body: JSON.stringify({ name }) }),
    archive: (name: string) => request<{ data: { archived: boolean } }>(`/projects/${encodeURIComponent(name)}`, { method: "DELETE" }),
    restore: (name: string) => request<{ data: { restored: boolean } }>(`/projects/${encodeURIComponent(name)}/restore`, { method: "POST" }),
    purge: (retentionDays?: number) =>
      request<{ data: { purged_count: number } }>("/projects/purge", { method: "POST", body: JSON.stringify({ retention_days: retentionDays ?? 7 }) }),
    listArchived: () => request<{ data: Project[] }>("/projects/archive"),
    update: (currentName: string, newName: string) =>
      request<{ data: Project }>(`/projects/${encodeURIComponent(currentName)}`, { method: "PATCH", body: JSON.stringify({ name: newName }) }),
    detail: (name: string) => request<{ data: any }>(`/projects/${encodeURIComponent(name)}/detail`),
    purgeOne: (name: string) => request<null>(`/projects/${encodeURIComponent(name)}/purge`, { method: "DELETE" }),
  },
  skills: {
    list: (project = DEFAULT_PROJECT) => request<{ data: Skill[] }>(`/skills?project=${encodeURIComponent(project)}`),
    get: (name: string, project = DEFAULT_PROJECT) => request<{ data: Skill }>(`/skills/${name}?project=${encodeURIComponent(project)}`),
    create: (name: string, description: string, content: string, project = DEFAULT_PROJECT) =>
      request<{ data: Skill }>(`/skills?project=${encodeURIComponent(project)}`, { method: "POST", body: JSON.stringify({ name, description, content }) }),
    update: (name: string, content: string, extra?: { tags?: string; always_apply?: number; files?: string }, project = DEFAULT_PROJECT) =>
      request<{ data: Skill }>(`/skills/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`, {
        method: "PATCH", 
        body: JSON.stringify({ content, ...(extra || {}) })
      }),
    // Governance
    proposals: {
      list: (project = DEFAULT_PROJECT, status?: string) => 
        request<{ data: any[] }>(`/skills/proposals?project=${encodeURIComponent(project)}${status ? `&status=${status}` : ''}`),
      counts: (project = DEFAULT_PROJECT, signal?: AbortSignal) =>
        request<{ data: SkillProposalCounts }>(
          `/skills/proposals/counts?project=${encodeURIComponent(project)}`,
          { signal },
        ),
      page: (view: SkillProposalView, project = DEFAULT_PROJECT, options: SkillProposalPageOptions = {}) => {
        const params = new URLSearchParams({
          project,
          view,
          limit: String(options.limit ?? 25),
        });
        if (options.cursor) params.set("cursor", options.cursor);
        return request<SkillProposalPage>(`/skills/proposals/page?${params}`, { signal: options.signal });
      },
      get: (proposalId: string, project = DEFAULT_PROJECT) => 
        request<{ data: any }>(`/skills/proposals/${encodeURIComponent(proposalId)}?project=${encodeURIComponent(project)}`),
      approve: (proposalId: string, reviewer: string, reason?: string, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/skills/proposals/${encodeURIComponent(proposalId)}/approve?project=${encodeURIComponent(project)}`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) }),
      reject: (proposalId: string, reviewer: string, reason?: string, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/skills/proposals/${encodeURIComponent(proposalId)}/reject?project=${encodeURIComponent(project)}`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) }),
      rollback: (proposalId: string, reviewer: string, reason?: string, project = DEFAULT_PROJECT) =>
        request<{ data: any }>(`/skills/proposals/${encodeURIComponent(proposalId)}/rollback?project=${encodeURIComponent(project)}`, { method: 'POST', body: JSON.stringify({ reviewer, reason }) }),
    },
  },
  tasks: {
    list: (project = DEFAULT_PROJECT) => request<{ data: Task[] }>(`/tasks?project=${encodeURIComponent(project)}`),
    create: (title: string, project = DEFAULT_PROJECT, fields?: Partial<Task>) =>
      request<{ data: Task }>(`/tasks?project=${encodeURIComponent(project)}`, { method: "POST", body: JSON.stringify({ title, ...fields }) }),
    capture: captureTask,
    move: (id: string, column_id: string, project = DEFAULT_PROJECT) =>
      request<{ data: Task }>(`/tasks/${id}?project=${encodeURIComponent(project)}`, { method: "PATCH", body: JSON.stringify({ column_id }) }),
    update: (id: string, fields: Partial<Task>, project = DEFAULT_PROJECT) =>
      request<{ data: Task }>(`/tasks/${id}?project=${encodeURIComponent(project)}`, { method: "PATCH", body: JSON.stringify(fields) }),
    delete: (id: string, project = DEFAULT_PROJECT) =>
      request(`/tasks/${id}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
    search: (query: string, project = DEFAULT_PROJECT) =>
      request<{ data: Task[] }>(`/tasks/search?project=${encodeURIComponent(project)}&q=${encodeURIComponent(query)}`),
    comments: (taskId: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskComment[] }>(`/tasks/${taskId}/comments?project=${encodeURIComponent(project)}`),
    addComment: (taskId: string, body: string, author = "user", parentCommentId?: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskComment }>(`/tasks/${taskId}/comments?project=${encodeURIComponent(project)}`, { method: "POST", body: JSON.stringify({ author, body, parent_comment_id: parentCommentId }) }),
    reactToComment: (taskId: string, commentId: string, reaction: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskComment }>(`/tasks/${taskId}/comments/${commentId}/react?project=${encodeURIComponent(project)}`, { method: "POST", body: JSON.stringify({ reaction }) }),
    boardConfig: (project = DEFAULT_PROJECT) =>
      request<{ data: BoardConfig }>(`/tasks/board-config?project=${encodeURIComponent(project)}`),
    notifications: (recipient?: string, unread?: boolean, project = DEFAULT_PROJECT) => {
      const params = new URLSearchParams({ project });
      if (recipient) params.set("recipient", recipient);
      if (unread) params.set("unread", "1");
      return request<{ data: TaskNotification[] }>(`/tasks/notifications?${params}`);
    },
    readNotification: (notificationId: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskNotification }>(`/tasks/notifications/${notificationId}/read?project=${encodeURIComponent(project)}`, { method: "POST" }),
    activity: (taskId: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskActivity[] }>(`/tasks/${taskId}/activity?project=${encodeURIComponent(project)}`),
    references: {
      list: (taskId: string, project: string) =>
        request<{ data: TaskSourceReference[] }>(
          `/tasks/${encodeURIComponent(taskId)}/references?project=${encodeURIComponent(project)}`,
        ),
    },
    links: (taskId: string, project = DEFAULT_PROJECT) =>
      request<{ data: TaskLink[] }>(`/tasks/${taskId}/links?project=${encodeURIComponent(project)}`),
    addLink: (taskId: string, data: { linked_task_id: string; link_type: string }, project = DEFAULT_PROJECT) =>
      request<{ data: TaskLink }>(`/tasks/${taskId}/links?project=${encodeURIComponent(project)}`, { method: "POST", body: JSON.stringify(data) }),
    removeLink: (taskId: string, linkId: string, project = DEFAULT_PROJECT) =>
      request(`/tasks/${taskId}/links/${linkId}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
    bulkUpdate: (data: { task_ids: string[]; column_id?: string; assigned_to?: string; priority?: string }, project = DEFAULT_PROJECT) =>
      request<{ data: { updated: number } }>(`/tasks/bulk?project=${encodeURIComponent(project)}`, { method: "POST", body: JSON.stringify(data) }),
  },
  plugins: {
    list: (project = DEFAULT_PROJECT) => request<{ data: Plugin[] }>(`/plugins?project=${encodeURIComponent(project)}`),
    get: (name: string, project = DEFAULT_PROJECT) => request<{ data: Plugin }>(`/plugins/${name}?project=${encodeURIComponent(project)}`),
    create: (name: string, file_path: string, source_content?: string, project = DEFAULT_PROJECT) =>
      request<{ data: Plugin }>(`/plugins?project=${encodeURIComponent(project)}`, {
        method: "POST", body: JSON.stringify({ name, file_path, source_content }),
      }),
    update: (name: string, data: { file_path?: string; source_content?: string }, project = DEFAULT_PROJECT) =>
      request<{ data: Plugin }>(`/plugins/${name}?project=${encodeURIComponent(project)}`, {
        method: "PUT", body: JSON.stringify(data),
      }),
    delete: (name: string, project = DEFAULT_PROJECT) =>
      request(`/plugins/${name}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
    enable: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: Plugin }>(`/plugins/${name}/enable?project=${encodeURIComponent(project)}`, { method: "POST" }),
    disable: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: Plugin }>(`/plugins/${name}/disable?project=${encodeURIComponent(project)}`, { method: "POST" }),
    getSource: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: { source: string } }>(`/plugins/${encodeURIComponent(name)}/source?project=${encodeURIComponent(project)}`),
  },
  agents: {
    list: (project = DEFAULT_PROJECT, category?: string) => {
      const url = category ? `/agents?project=${encodeURIComponent(project)}&category=${encodeURIComponent(category)}` : `/agents?project=${encodeURIComponent(project)}`;
      return request<{ data: Agent[]; total?: number }>(url);
    },
    get: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`),
    create: (data: { name: string; content: string; description?: string; category?: string; mode?: string; model?: string }, project = DEFAULT_PROJECT) =>
      request<{ data: Agent }>(`/agents?project=${encodeURIComponent(project)}`, { method: "POST", body: JSON.stringify(data) }),
    update: (name: string, data: { description?: string; category?: string; mode?: string; model?: string; content?: string }, project = DEFAULT_PROJECT) =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (name: string, project = DEFAULT_PROJECT) =>
      request(`/agents/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
    enable: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}/enable?project=${encodeURIComponent(project)}`, { method: "POST" }),
    disable: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}/disable?project=${encodeURIComponent(project)}`, { method: "POST" }),
  },
  /** Canonical child MCP definitions and persisted discovery metadata. */
  mcpServers: {
    list: (project = DEFAULT_PROJECT) =>
      request<{ data: ChildMcpServer[]; total: number }>(`/mcp-servers?project=${encodeURIComponent(project)}`),
    listTools: (project = DEFAULT_PROJECT) =>
      request<{ data: ChildMcpDiscoveredTool[]; total: number }>(`/mcp-servers/tools?project=${encodeURIComponent(project)}`),
    listServerTools: (name: string, project = DEFAULT_PROJECT) =>
      request<{ data: ChildMcpDiscoveredTool[]; total: number }>(
        `/mcp-servers/${encodeURIComponent(name)}/tools?project=${encodeURIComponent(project)}`,
      ),
    create: (data: ChildMcpServerInput, project = DEFAULT_PROJECT) =>
      request<{ data: ChildMcpServer }>(`/mcp-servers?project=${encodeURIComponent(project)}`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    remove: (name: string, project = DEFAULT_PROJECT) =>
      request(`/mcp-servers/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
  },
  observations: {
    list: (project = DEFAULT_PROJECT, status?: string, type?: string) => {
      const params = new URLSearchParams({ project });
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      return request<{ data: Observation[]; total: number }>(`/observations?${params}`);
    },
    get: (id: number, project = DEFAULT_PROJECT) =>
      request<{ data: Observation }>(`/observations/${id}?project=${encodeURIComponent(project)}`),
    stats: (project = DEFAULT_PROJECT) =>
      request<{ data: { total: number; pending: number } }>(`/observations/stats?project=${encodeURIComponent(project)}`),
  },
  personality: {
    list: (project = DEFAULT_PROJECT, traitType?: string) => {
      const params = new URLSearchParams({ project });
      if (traitType) params.set("trait_type", traitType);
      return request<{ data: PersonalityTrait[]; total: number }>(`/personality?${params}`);
    },
    dismiss: (id: number, project = DEFAULT_PROJECT) =>
      request<{ data: { id: number } }>(`/personality/${id}/dismiss?project=${encodeURIComponent(project)}`, { method: "POST" }),
  },
  pipeline: {
    events: (project = DEFAULT_PROJECT, options?: { source?: string; type?: string; limit?: number }) => {
      const params = new URLSearchParams({ project });
      if (options?.source) params.set("source", options.source);
      if (options?.type) params.set("type", options.type);
      if (options?.limit) params.set("limit", String(options.limit));
      return request<{ data: any[]; total: number }>(`/pipeline/events?${params}`);
    },
  },
  /** Immutable, project-scoped conversation memory. */
  context: {
    chat: {
      link: (input: { runtimeId: string | null; sessionId: string; title: string }, project = DEFAULT_PROJECT) =>
        request<{ data: ContextConversationSummary }>(
          `/context/chat-sessions/link?project=${encodeURIComponent(project)}`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      persistTurn: (
        conversationId: string,
        input: {
          runtimeId: string | null;
          sessionId: string;
          userMessageId: string;
          assistantMessageId: string;
          userContent: string;
          assistantContent: string;
          expectedRevision: number;
        },
        project = DEFAULT_PROJECT,
      ) => request<{ data: ContextChatTurnResult }>(
        `/context/conversations/${encodeURIComponent(conversationId)}/chat-turns?project=${encodeURIComponent(project)}`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    },
    sources: {
      list: listContextSources,
    },
    rag: {
      /** Search current project context sources; snippets are intentionally bounded by the caller. */
      search: (query: string, project: string, limit = 5) => {
        const params = new URLSearchParams({ project, q: query, limit: String(limit) });
        return request<{ data: ContextRagCitation[]; total: number }>(`/context/rag/search?${params}`);
      },
    },
    conversations: {
      list: (project = DEFAULT_PROJECT, options?: { limit?: number; cursor?: string }) => {
        const params = new URLSearchParams({ project });
        if (options?.limit !== undefined) params.set("limit", String(options.limit));
        if (options?.cursor) params.set("cursor", options.cursor);
        return request<{ data: ContextKeysetPage<ContextConversationSummary> }>(
          `/context/conversations?${params}`,
        );
      },
      get: (conversationId: string, project = DEFAULT_PROJECT) =>
        request<{ data: ContextConversationSummary }>(
          `/context/conversations/${encodeURIComponent(conversationId)}?project=${encodeURIComponent(project)}`,
        ),
    },
    messages: {
      list: (conversationId: string, project = DEFAULT_PROJECT, options?: { limit?: number; cursor?: string }) => {
        const params = new URLSearchParams({ project });
        if (options?.limit !== undefined) params.set("limit", String(options.limit));
        if (options?.cursor) params.set("cursor", options.cursor);
        return request<{ data: ContextKeysetPage<ContextMessageSummary> }>(
          `/context/conversations/${encodeURIComponent(conversationId)}/messages?${params}`,
        );
      },
      search: (conversationId: string, query: string, project = DEFAULT_PROJECT, limit?: number) => {
        const params = new URLSearchParams({ project, q: query });
        if (limit !== undefined) params.set("limit", String(limit));
        return request<{ data: ContextMessageSearchResult[] }>(
          `/context/conversations/${encodeURIComponent(conversationId)}/messages/search?${params}`,
        );
      },
      batch: (conversationId: string, messageIds: string[], project = DEFAULT_PROJECT) =>
        request<{ data: ContextMessageBatch }>(
          `/context/conversations/${encodeURIComponent(conversationId)}/messages/batch?project=${encodeURIComponent(project)}`,
          { method: "POST", body: JSON.stringify({ messageIds }) },
        ),
    },
    checkpoints: {
      list: (conversationId: string, project = DEFAULT_PROJECT, options?: { limit?: number; cursor?: string }) => {
        const params = new URLSearchParams({ project });
        if (options?.limit !== undefined) params.set("limit", String(options.limit));
        if (options?.cursor) params.set("cursor", options.cursor);
        return request<{ data: ContextKeysetPage<ContextCheckpoint> }>(
          `/context/conversations/${encodeURIComponent(conversationId)}/checkpoints?${params}`,
        );
      },
      restore: (
        conversationId: string,
        checkpointId: string,
        input: {
          expectedRevision: number;
          title?: string;
          metadata?: Record<string, unknown>;
          idempotencyKey?: string;
        },
        project = DEFAULT_PROJECT,
      ) =>
        request<{ data: ContextCheckpointRestoreResult }>(
          `/context/conversations/${encodeURIComponent(conversationId)}/checkpoints/${encodeURIComponent(checkpointId)}/restore?project=${encodeURIComponent(project)}`,
          { method: "POST", body: JSON.stringify(input) },
        ),
    },
  },
  emails: {
    accounts: {
      list: (project = DEFAULT_PROJECT) =>
        request<{ data: EmailAccount[] }>(`/emails/accounts?project=${encodeURIComponent(project)}`),
      create: (data: {
        email: string; name: string; provider: EmailProvider; authType: AuthType;
        imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number;
        password?: string;
      }, project = DEFAULT_PROJECT) =>
        request<{ data: EmailAccount }>(`/emails/accounts?project=${encodeURIComponent(project)}`, {
          method: "POST", body: JSON.stringify(data),
        }),
      delete: (id: string, project = DEFAULT_PROJECT) =>
        request(`/emails/accounts/${id}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),
      test: (data: {
        email: string; provider: EmailProvider; authType: AuthType;
        imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number;
        password?: string;
      }, project = DEFAULT_PROJECT) =>
        request<{ data: { success: boolean; message: string } }>(`/emails/accounts/test?project=${encodeURIComponent(project)}`, {
          method: "POST", body: JSON.stringify(data),
        }),
      oauthUrl: (provider: string, project = DEFAULT_PROJECT) =>
        request<{ data: { url: string } }>(`/emails/accounts/oauth/url?project=${encodeURIComponent(project)}&provider=${provider}`),
      oauthCallback: (provider: string, code: string, redirectUri: string, project = DEFAULT_PROJECT) =>
        request<{ data: EmailAccount }>(`/emails/accounts/oauth?project=${encodeURIComponent(project)}`, {
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
      request<{ data: { success: boolean } }>(`/emails/send?project=${encodeURIComponent(project)}`, {
        method: "POST", body: JSON.stringify(data),
      }),
    draft: (data: {
      to?: string; cc?: string; bcc?: string; subject?: string; body?: string;
      accountId?: string;
    }, project = DEFAULT_PROJECT) =>
      request<{ data: { uid: number } }>(`/emails/draft?project=${encodeURIComponent(project)}`, {
        method: "POST", body: JSON.stringify(data),
      }),
    move: (uid: number, folder: string, accountId?: string, project = DEFAULT_PROJECT) =>
      request<{ data: { success: boolean } }>(`/emails/${uid}/move?project=${encodeURIComponent(project)}`, {
        method: "POST", body: JSON.stringify({ folder, account_id: accountId }),
      }),
    setFlags: (uid: number, flags: string[], accountId?: string, project = DEFAULT_PROJECT) =>
      request<{ data: { success: boolean } }>(`/emails/${uid}/flags?project=${encodeURIComponent(project)}`, {
        method: "PATCH", body: JSON.stringify({ flags, account_id: accountId }),
      }),
    delete: (uid: number, accountId?: string, project = DEFAULT_PROJECT) =>
      request(`/emails/${uid}?project=${encodeURIComponent(project)}`, {
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
    get: (key: string, project = DEFAULT_PROJECT) => request<{ data: SettingResponse }>(`/settings?project=${encodeURIComponent(project)}&key=${key}`),
    /**
     * Save an ordinary setting or an explicit protected-secret operation.
     *
     * Protected OAuth secrets must never use an empty string as an implicit
     * clear. Callers pass `preserve`, `replace`, or `clear` so the server can
     * apply its canonical vault semantics.
     */
    set: (key: string, valueOrOperation: string | OAuthClientSecretOperation, project = DEFAULT_PROJECT) =>
      request<{ data: SettingResponse | OAuthClientSecretSetting }>(`/settings?project=${encodeURIComponent(project)}`, {
        method: "POST",
        body: JSON.stringify(
          typeof valueOrOperation === "string"
            ? { key, value: valueOrOperation }
            : { key, ...valueOrOperation },
        ),
      }),

    testLlm: (endpoint: string, model: string, apiKey: string, project = DEFAULT_PROJECT) =>
      request<{ data: { ok: boolean; status?: number; message?: string } }>(`/settings/test-llm?project=${encodeURIComponent(project)}`, {
        method: "POST", body: JSON.stringify({ endpoint, model, apiKey }),
      }).then((r) => r.data),

    /**
     * Atomic LLM config save — POSTs both primary and backup config in one
     * request. Triggers projectToOpenCodeConfig() on the server to create
     * synthetic OpenCode providers.
     */
    saveLlmConfig: (config: LlmConfigBody, project = DEFAULT_PROJECT) =>
      request<{ data: { saved: boolean } }>(
        `/settings/llm-config?project=${encodeURIComponent(project)}`,
        { method: "POST", body: JSON.stringify(config) },
      ),

    /** Sanitized Settings config — exposes only provider metadata and key presence. */
    getLlmConfig: (project = DEFAULT_PROJECT) =>
      request<{ data: LlmConfigResponse }>(`/settings/llm-config?project=${encodeURIComponent(project)}`),

    getProviderConfigs: async (project = DEFAULT_PROJECT) => {
      const response = await request<{ data: unknown }>(`/settings/provider-configs?project=${encodeURIComponent(project)}`);
      return { data: normalizeManagedProviderConfigResponse(response.data) };
    },

    saveProviderConfigs: async (
      providers: ManagedProviderConfig[],
      project = DEFAULT_PROJECT,
      synthesis?: { primary: { providerId: string; modelId: string }; secondary: { providerId: string; modelId: string } },
    ) => {
      const response = await request<{ data: unknown }>(
        `/settings/provider-configs?project=${encodeURIComponent(project)}`,
        { method: "PUT", body: JSON.stringify({ providers, synthesis }) },
      );
      const data = isApiRecord(response.data) ? response.data : {};
      return {
        data: {
          saved: data.saved === true,
          warnings: Array.isArray(data.warnings)
            ? data.warnings.filter((warning): warning is string => typeof warning === "string")
            : [],
        },
      };
    },

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
    list: (project = DEFAULT_PROJECT, since?: string, limit = 200, signal?: AbortSignal) => {
      const params = new URLSearchParams({ project, limit: String(limit) });
      if (since) params.set("since", since);
      return request<{ data: { entries: LogEntry[]; sources: string[]; total: number } }>(`/logs?${params}`, { signal });
    },
  },
  mcpTools: {
    list: (project = DEFAULT_PROJECT, includeCategories = false) =>
      request<McpToolCatalogResponse>(`/mcp-tools?project=${encodeURIComponent(project)}&include_categories=${includeCategories}`),
    report: (project = DEFAULT_PROJECT, filters: McpToolReportFilters = {}) => {
      const params = new URLSearchParams({ project });
      if (filters.q) params.set("q", filters.q);
      if (filters.category) params.set("category", filters.category);
      if (filters.enabled !== undefined) params.set("enabled", String(filters.enabled));
      if (filters.boundary) params.set("boundary", filters.boundary);
      if (filters.visibility) params.set("visibility", filters.visibility);
      if (filters.invocation) params.set("invocation", filters.invocation);
      return request<McpToolReportResponse>(`/mcp-tools/report?${params.toString()}`);
    },
    toggle: (name: string, enabled: boolean, project = DEFAULT_PROJECT) =>
      request<{ data: McpToolState }>(`/mcp-tools/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`, {
        method: "PUT", body: JSON.stringify({ enabled }),
      }),
    toggleCategory: (category: string, enabled: boolean, project = DEFAULT_PROJECT) =>
      request<{ data: { category: string; enabled: boolean; tools_changed: number } }>(`/mcp-tools/category/${encodeURIComponent(category)}?project=${encodeURIComponent(project)}`, {
        method: "PUT", body: JSON.stringify({ enabled }),
      }),
  },
  jobs: {
    list: (project: string) =>
      normalizedJobsRequest(`/jobs?${jobsQuery(project)}`, (value) => normalizeJobCollection(value, normalizeJob)),
    get: (jobId: string, project: string) =>
      normalizedJobsRequest(`/jobs/${encodeURIComponent(jobId)}?${jobsQuery(project)}`, (value) => normalizeJobData(value, normalizeJob)),
    create: (data: {
      name: string;
      description?: string;
      agent: string;
      prompt_template: string;
      schedule_cron?: string;
      trigger_event?: TrustedJobEventType | null;
      timeout_minutes?: number;
      vault_item_ids?: string[];
    }, project: string) =>
      normalizedJobsRequest(`/jobs?${jobsQuery(project)}`, (value) => normalizeJobData(value, normalizeJob), {
        method: "POST", body: JSON.stringify(data),
      }),
    update: (jobId: string, data: Partial<{
      name: string;
      description: string;
      agent: string;
      prompt_template: string;
      schedule_cron: string;
      trigger_event: TrustedJobEventType | null;
      enabled: boolean;
      timeout_minutes: number;
      vault_item_ids: string[];
    }> & { expected_revision: number }, project: string) => {
      if (!Number.isSafeInteger(data.expected_revision) || data.expected_revision < 0) {
        throw new Error("Job expected revision must be a nonnegative integer.");
      }
      return normalizedJobsRequest(`/jobs/${encodeURIComponent(jobId)}?${jobsQuery(project)}`, (value) => normalizeJobData(value, normalizeJob), {
        method: "PATCH", body: JSON.stringify(data),
      });
    },
    delete: (jobId: string, expectedRevision: number, project: string) => {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new Error("Job expected revision must be a nonnegative integer.");
      }
      return jobsRequest(`/jobs/${encodeURIComponent(jobId)}?${jobsQuery(project)}`, {
        method: "DELETE", body: JSON.stringify({ expected_revision: expectedRevision }),
      });
    },
    vaultAudit: (jobId: string, project: string, options: { limit?: number; cursor?: string } = {}) =>
      normalizedJobsRequest(
        `/jobs/${encodeURIComponent(jobId)}/vault-audit?${jobsQuery(project, options)}`,
        (value) => normalizeJobPage(value, normalizeJobVaultAuditEntry),
      ),
    run: (jobId: string, project: string) =>
      normalizedJobsRequest(
        `/jobs/${encodeURIComponent(jobId)}/run?${jobsQuery(project)}`,
        (value) => normalizeJobData(value, normalizeJobRun),
        { method: "POST" },
      ),
    runs: (jobId: string, project: string, limit = 50) =>
      normalizedJobsRequest(
        `/jobs/${encodeURIComponent(jobId)}/runs?${jobsQuery(project, { limit })}`,
        (value) => normalizeJobCollection(value, normalizeJobRun),
      ),
    runLogs: (runId: string, afterSeq: number | undefined, project: string) => {
      const params = jobsQuery(project);
      if (afterSeq !== undefined) params.set("after", String(afterSeq));
      return normalizedJobsRequest(
        `/jobs/runs/${encodeURIComponent(runId)}/logs?${params}`,
        (value) => normalizeJobCollection(value, normalizeJobRunLog),
      );
    },
    cancelRun: (runId: string, project: string) =>
      normalizedJobsRequest(
        `/jobs/runs/${encodeURIComponent(runId)}/cancel?${jobsQuery(project)}`,
        (value) => normalizeJobData(value, normalizeJobRun),
        { method: "POST" },
      ),
    eventDeliveries: (project: string, options: { limit?: number; cursor?: string } = {}) =>
      normalizedJobsRequest(`/jobs/event-deliveries?${jobsQuery(project, options)}`, (value) => normalizeJobPage(value, normalizeJobEventDelivery)),
    eventDelivery: (deliveryId: string, project: string) =>
      normalizedJobsRequest(`/jobs/event-deliveries/${encodeURIComponent(deliveryId)}?${jobsQuery(project)}`, (value) => normalizeJobData(value, normalizeJobEventDelivery)),
    trustedEvents: (project: string, options: { limit?: number; cursor?: string } = {}) =>
      normalizedJobsRequest(`/jobs/events?${jobsQuery(project, options)}`, (value) => normalizeJobPage(value, normalizeTrustedJobEvent)),
    suggest: (description: string, project: string) =>
      request<{ data: { prompt_template: string | null; schedule_cron: string | null; trigger_event: string | null; configured: boolean } }>(
        `/jobs/suggest?${jobsQuery(project)}`,
        { method: "POST", body: JSON.stringify({ description }) },
      ),
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
        `${getApiBase()}/docs/pages/${pageId}/attachments/${attId}/download?project=${encodeURIComponent(project)}`,
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
        request<{ data: Array<{ id: string; project_id: string; title: string; source_type: "file" | "text" | "url"; source_path: string | null; source_hash: string | null; chunk_count: number; metadata: string; created_at: string; updated_at: string }>; total: number }>(
          `/rag/sources?project=${encodeURIComponent(project)}`,
        ),

      /** GET /rag/sources/:id */
      get: (id: string, project = DEFAULT_PROJECT) =>
        request<{ data: { id: string; project_id: string; title: string; source_type: "file" | "text" | "url"; source_path: string | null; source_hash: string | null; chunk_count: number; metadata: string; created_at: string; updated_at: string } }>(
          `/rag/sources/${id}?project=${encodeURIComponent(project)}`,
        ),

      /** DELETE /rag/sources/:id */
      delete: (id: string, project = DEFAULT_PROJECT) =>
        request(`/rag/sources/${id}?project=${encodeURIComponent(project)}`, { method: "DELETE" }),

      /** POST /rag/sources/:id/ingest — re-ingest a single source. */
      ingest: (id: string, project = DEFAULT_PROJECT) =>
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
  usage: {
    summary: (query: UsageQuery, project = DEFAULT_PROJECT) =>
      request<{ data: UsageSummary }>(`/usage/summary?${usageQueryParams(project, query)}`),
    breakdown: (query: UsageQuery, project = DEFAULT_PROJECT) =>
      request<{ data: UsageBreakdownRow[] }>(`/usage/breakdown?${usageQueryParams(project, query)}`),
    events: (query: UsageQuery, project = DEFAULT_PROJECT, options?: { limit?: number; cursor?: string }) =>
      request<UsageEventsPage>(`/usage/events?${usageQueryParams(project, query, options)}`),
    exportUrl: (query: UsageQuery, project = DEFAULT_PROJECT, options?: { limit?: number; cursor?: string }) =>
      `${getApiBase()}/usage/export?${usageQueryParams(project, query, options)}`,
    thresholds: {
      get: (project = DEFAULT_PROJECT) =>
        normalizedUsageRequest(
          `/usage/thresholds?${usageProjectParams(project)}`,
          (value) => normalizeUsageData(value, normalizeUsageAdvisoryThresholds),
        ),
      replace: (replacement: UsageAdvisoryThresholdReplacement, project = DEFAULT_PROJECT) => {
        const body = {
          expected_revision: usageInteger(replacement.expectedRevision, "threshold revision", 1),
          request_count: replacement.requestCount === null ? null : usageInteger(replacement.requestCount, "request count threshold"),
          total_tokens: replacement.totalTokens === null ? null : usageInteger(replacement.totalTokens, "total tokens threshold"),
          reported_cost_amount: replacement.reportedCostAmount === null ? null : usageFiniteNumber(replacement.reportedCostAmount, "reported cost amount threshold"),
          cache_read_tokens: replacement.cacheReadTokens === null ? null : usageInteger(replacement.cacheReadTokens, "cache read threshold"),
          cache_write_tokens: replacement.cacheWriteTokens === null ? null : usageInteger(replacement.cacheWriteTokens, "cache write threshold"),
        };
        return normalizedUsageRequest(
          `/usage/thresholds?${usageProjectParams(project)}`,
          (value) => normalizeUsageData(value, normalizeUsageAdvisoryThresholds),
          { method: "PUT", body: JSON.stringify(body) },
        );
      },
      evaluate: (range: Pick<UsageQuery, "from" | "to">, project = DEFAULT_PROJECT) => {
        const params = usageProjectParams(project);
        params.set("from", usageUtcTimestamp(range.from, "advisory range start"));
        params.set("to", usageUtcTimestamp(range.to, "advisory range end"));
        if (Date.parse(range.to) <= Date.parse(range.from)) throw new Error("The advisory range end must be after the start.");
        return normalizedUsageRequest(
          `/usage/thresholds/evaluate?${params}`,
          (value) => normalizeUsageData(value, normalizeUsageAdvisoryEvaluation),
        );
      },
    },
    attention: {
      list: (options: { includeResolved?: boolean; limit?: number; cursor?: string } = {}, project = DEFAULT_PROJECT) => {
        const params = usageProjectParams(project);
        if (options.includeResolved !== undefined) {
          if (typeof options.includeResolved !== "boolean") throw new Error("Usage attention includeResolved is invalid.");
          params.set("include_resolved", String(options.includeResolved));
        }
        const limit = usageLimit(options.limit);
        const cursor = usageCursor(options.cursor);
        if (limit !== undefined) params.set("limit", String(limit));
        if (cursor !== undefined) params.set("cursor", cursor);
        return normalizedUsageRequest(`/usage/attention?${params}`, normalizeUsageAttentionPage);
      },
      // This endpoint rejects any payload. Do not add an empty JSON body here.
      evaluate: (project = DEFAULT_PROJECT) =>
        normalizedUsageRequest(
          `/usage/attention/evaluate?${usageProjectParams(project)}`,
          (value) => {
            const data = usageRecord(usageRecord(value).data);
            return { evaluatedAt: usageUtcTimestamp(data.evaluatedAt, "attention evaluation timestamp") };
          },
          { method: "POST" },
        ),
      acknowledge: (id: string, expectedRevision: number, project = DEFAULT_PROJECT) =>
        normalizedUsageRequest(
          `/usage/attention/${encodeURIComponent(usageId(id, "attention ID"))}/acknowledge?${usageProjectParams(project)}`,
          (value) => normalizeUsageData(value, normalizeUsageAttentionItem),
          {
            method: "POST",
            body: JSON.stringify({ expected_revision: usageInteger(expectedRevision, "attention revision", 1) }),
          },
        ),
    },
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
      `${getApiBase()}/backups/${encodeURIComponent(id)}/download?project=${encodeURIComponent(project)}`,
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
    /** GET /vault/status — returns lock state plus an actionable nextAction. */
    status: (project = DEFAULT_PROJECT) =>
      request<{ data: {
        sealed: boolean;
        initialized: boolean;
        nextAction?: "initialize" | "unseal" | null;
        stats?: { itemCount: number; folderCount: number };
        created_at?: string;
      } }>(
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

    emptyReset: {
      eligibility: (project = DEFAULT_PROJECT) =>
        request<{ data: EmptyVaultResetEligibility }>(`/vault/empty-reset?project=${encodeURIComponent(project)}`),
      reset: (confirmation: typeof EMPTY_VAULT_RESET_CONFIRMATION, project = DEFAULT_PROJECT) =>
        request<{ data: { reset: boolean; initialized: false } }>(
          `/vault/empty-reset?project=${encodeURIComponent(project)}`,
          { method: "POST", body: JSON.stringify({ confirmation }) },
        ),
    },

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
