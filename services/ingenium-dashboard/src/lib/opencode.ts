/** Frontend API client for the OpenCode proxy at /api/v1/opencode/*. */
import { request } from "./api";

/**
 * Thin wrapper that unwraps the `{ data: T }` envelope the proxy routes return.
 * Every proxy endpoint at /api/v1/opencode/* wraps its payload in `{ data: ... }`.
 */
async function oc<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await request<{ data: T }>(path, options);
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  Types matching the verified OpenCode v1.18.9 contract             */
/* ------------------------------------------------------------------ */

/* ----- Session ----- */

export interface OpenCodeSession {
  id: string;
  slug: string;
  projectID: string;
  directory: string;
  path: string;
  title: string;
  version: string;
  time: { created: number; updated: number }; // epoch millis
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  // Optional (present after messages):
  summary?: { additions: number; deletions: number; files: number };
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  permission?: Array<{ permission: string; pattern: string; action: string }>;
  share?: { url: string };
  revert?: { messageID: string; snapshot?: string; diff?: string };
}

/* ----- Message ----- */

export interface OpenCodeMessage {
  info: MessageInfo;
  parts: OpenCodePart[];
}

export interface MessageInfo {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  time: { created: number; completed?: number };
  // Optional:
  agent?: string;
  model?: { providerID: string; modelID: string };
  parentID?: string;
  cost?: number;
  tokens?: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  finish?: "stop" | string;
}

/* ----- Part types ----- */

export interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  time?: { start?: number; end?: number };
}

export interface ReasoningPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
  time?: { start?: number; end?: number };
}

export interface StepStartPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-start";
  snapshot?: unknown;
}

export interface StepFinishPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason?: string;
  snapshot?: unknown;
  tokens?: unknown;
  cost?: unknown;
}

export interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  tool?: string;
  callID?: string;
  state?: {
    status: "pending" | "running" | "completed" | "error";
    input?: unknown;
    output?: unknown;
    error?: string;
  };
}

export interface FilePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "file";
  mime: string;
  url?: string;
  filename?: string;
  size?: number;
  data?: string;
  dataUrl?: string;
  content?: string;
}

export type OpenCodePart =
  | TextPart
  | ReasoningPart
  | StepStartPart
  | StepFinishPart
  | ToolPart
  | FilePart;

/* ----- Provider / Model / Agent ----- */

/**
 * The browser-facing provider DTO returned by the API proxy.
 *
 * The proxy intentionally exposes a small, stable shape instead of the raw
 * OpenCode provider object. Keep consumers on this shape so an upstream
 * provider contract change cannot break the Settings panel at runtime.
 */
export interface OpenCodeProviderModel {
  id: string;
  label: string;
}

export interface OpenCodeProvider {
  id: string;
  label: string;
  models: OpenCodeProviderModel[];
  defaultModel: string | null;
  connected: boolean;
}

export interface OpenCodeProviderCatalog {
  providers: OpenCodeProvider[];
}

interface ProviderRecord {
  [key: string]: unknown;
}

function isProviderRecord(value: unknown): value is ProviderRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function unwrapDataEnvelope(input: unknown): unknown {
  let value = input;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isProviderRecord(value) || !("data" in value)) return value;
    value = value.data;
  }
  return value;
}

function collectionValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isProviderRecord(value)) return [];
  return Object.entries(value).map(([key, entry]) => {
    if (!isProviderRecord(entry)) return entry;
    return { ...entry, id: nonEmptyString(entry.id) ?? key };
  });
}

function normalizeProviderModels(value: unknown): OpenCodeProviderModel[] {
  const models: OpenCodeProviderModel[] = [];
  const modelIds = new Set<string>();

  const addModel = (value: unknown, fallbackId?: string) => {
    if (typeof value === "string") {
      const id = nonEmptyString(value) ?? fallbackId ?? null;
      if (!id || modelIds.has(id)) return;
      models.push({ id, label: id });
      modelIds.add(id);
      return;
    }
    if (!isProviderRecord(value)) return;
    const id = nonEmptyString(value.id) ?? fallbackId ?? null;
    if (!id || modelIds.has(id)) return;
    const label = nonEmptyString(value.label) ?? nonEmptyString(value.name) ?? id;
    models.push({ id, label });
    modelIds.add(id);
  };

  if (Array.isArray(value)) {
    for (const model of value) addModel(model);
  } else if (isProviderRecord(value)) {
    for (const [modelId, model] of Object.entries(value)) addModel(model, modelId);
  }

  return models;
}

/**
 * Normalize both the current browser DTO (`providers`) and the historical
 * OpenCode response (`all`) into one always-array catalog for callers.
 */
export function normalizeOpenCodeProviderCatalog(input: unknown): OpenCodeProviderCatalog {
  const root = unwrapDataEnvelope(input);
  if (!isProviderRecord(root)) return { providers: [] };

  const defaults = isProviderRecord(root.default) ? root.default : {};
  const connected = new Set(
    Array.isArray(root.connected)
      ? root.connected.filter((value): value is string => typeof value === "string")
      : [],
  );
  const candidates = collectionValues(root.providers ?? root.all);
  const providers: OpenCodeProvider[] = [];
  const providerIds = new Set<string>();

  for (const candidate of candidates) {
    if (!isProviderRecord(candidate)) continue;
    const id = nonEmptyString(candidate.id);
    if (!id || providerIds.has(id)) continue;

    const label = nonEmptyString(candidate.label) ?? nonEmptyString(candidate.name) ?? id;
    const models = normalizeProviderModels(candidate.models);
    const configuredDefault = nonEmptyString(candidate.defaultModel) ?? nonEmptyString(defaults[id]);
    const defaultModel = configuredDefault && models.some((model) => model.id === configuredDefault)
      ? configuredDefault
      : null;

    providers.push({
      id,
      label,
      models,
      defaultModel,
      connected: typeof candidate.connected === "boolean"
        ? candidate.connected
        : connected.has(id),
    });
    providerIds.add(id);
  }

  return { providers };
}

export interface OpenCodeAgent {
  name: string;
  description?: string;
  mode: string;
  native?: boolean;
  hidden?: boolean;
  permission?: Array<{ permission: string; pattern: string; action: string }>;
}

export interface OpenCodeIntegrationPrompt {
  type: "text" | "select";
  key: string;
  message: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string; hint?: string }>;
}

export interface OpenCodeIntegrationMethod {
  id?: string;
  type: "key" | "env" | "oauth";
  label?: string;
  names?: string[];
  prompts?: OpenCodeIntegrationPrompt[];
}

export interface OpenCodeIntegration {
  id: string;
  name: string;
  methods: OpenCodeIntegrationMethod[];
  connections: Array<{ type: string; id?: string; label?: string; name?: string }>;
}

function normalizeIntegrationPrompts(value: unknown): OpenCodeIntegrationPrompt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((prompt): OpenCodeIntegrationPrompt[] => {
    if (!isProviderRecord(prompt)) return [];
    const type = prompt.type === "select" ? "select" : prompt.type === "text" ? "text" : null;
    const key = nonEmptyString(prompt.key);
    const message = nonEmptyString(prompt.message);
    if (!type || !key || !message) return [];
    const options = Array.isArray(prompt.options)
      ? prompt.options.flatMap((option) => {
        if (!isProviderRecord(option)) return [];
        const label = nonEmptyString(option.label);
        const value = nonEmptyString(option.value);
        const hint = nonEmptyString(option.hint);
        if (!label || !value) return [];
        return [{ label, value, ...(hint ? { hint } : {}) }];
      })
      : undefined;
    const placeholder = nonEmptyString(prompt.placeholder);
    return [{
      type,
      key,
      message,
      ...(placeholder ? { placeholder } : {}),
      ...(options ? { options } : {}),
    }];
  });
}

function normalizeOpenCodeIntegrations(input: unknown): OpenCodeIntegration[] {
  const root = unwrapDataEnvelope(input);
  const candidates = Array.isArray(root)
    ? root
    : isProviderRecord(root)
      ? collectionValues(root.integrations ?? root.items ?? root.data)
      : [];

  return candidates.flatMap((candidate): OpenCodeIntegration[] => {
    if (!isProviderRecord(candidate)) return [];
    const id = nonEmptyString(candidate.id);
    if (!id) return [];
    const methods = Array.isArray(candidate.methods)
      ? candidate.methods.flatMap((method): OpenCodeIntegrationMethod[] => {
        if (!isProviderRecord(method)) return [];
        const type = method.type === "key" || method.type === "env" || method.type === "oauth"
          ? method.type
          : null;
        if (!type) return [];
        const methodId = nonEmptyString(method.id);
        const methodLabel = nonEmptyString(method.label);
        return [{
          type,
          ...(methodId ? { id: methodId } : {}),
          ...(methodLabel ? { label: methodLabel } : {}),
          ...(Array.isArray(method.names)
            ? { names: method.names.filter((name): name is string => typeof name === "string") }
            : {}),
          prompts: normalizeIntegrationPrompts(method.prompts),
        }];
      })
      : [];
    const connections = Array.isArray(candidate.connections)
      ? candidate.connections.flatMap((connection) => {
        if (!isProviderRecord(connection)) return [];
        const type = nonEmptyString(connection.type);
        if (!type) return [];
        const connectionId = nonEmptyString(connection.id);
        const connectionLabel = nonEmptyString(connection.label);
        const connectionName = nonEmptyString(connection.name);
        return [{
          type,
          ...(connectionId ? { id: connectionId } : {}),
          ...(connectionLabel ? { label: connectionLabel } : {}),
          ...(connectionName ? { name: connectionName } : {}),
        }];
      })
      : [];
    return [{
      id,
      name: nonEmptyString(candidate.name) ?? nonEmptyString(candidate.label) ?? id,
      methods,
      connections,
    }];
  });
}

function normalizeOpenCodeAgents(input: unknown): OpenCodeAgent[] {
  const root = unwrapDataEnvelope(input);
  if (!Array.isArray(root)) return [];
  return root.flatMap((agent): OpenCodeAgent[] => {
    if (!isProviderRecord(agent)) return [];
    const name = nonEmptyString(agent.name);
    if (!name) return [];
    const description = nonEmptyString(agent.description);
    return [{
      name,
      ...(description ? { description } : {}),
      mode: typeof agent.mode === "string" ? agent.mode : "subagent",
      ...(typeof agent.native === "boolean" ? { native: agent.native } : {}),
      ...(typeof agent.hidden === "boolean" ? { hidden: agent.hidden } : {}),
      ...(Array.isArray(agent.permission) ? { permission: agent.permission } : {}),
    }];
  });
}

export interface OpenCodeIntegrationAttempt {
  attemptID: string;
  url: string;
  instructions: string;
  mode: "auto" | "code";
  time: { created: number; expires: number };
}

/* ------------------------------------------------------------------ */
/*  Prompt body types                                                 */
/* ------------------------------------------------------------------ */

export interface OpenCodePromptParams {
  parts: Array<
    | { type: "text"; text: string }
    | { type: "file"; mime: string; url: string; filename?: string }
  >;
  model?: { providerID: string; modelID: string };
  agent?: string;
  system?: string;
  tools?: Record<string, boolean>;
  variant?: string;
}

/* ------------------------------------------------------------------ */
/*  API client                                                        */
/* ------------------------------------------------------------------ */

export const opencode = {
  sessions: {
    list: (directory?: string) =>
      oc<OpenCodeSession[]>(
        `/opencode/sessions${directory ? `?directory=${encodeURIComponent(directory)}` : ""}`,
      ),

    create: (body: { title?: string; directory?: string }) =>
      oc<OpenCodeSession>("/opencode/sessions", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    get: (id: string) =>
      oc<OpenCodeSession>(`/opencode/sessions/${encodeURIComponent(id)}`),

    update: (id: string, body: { title?: string }) =>
      oc<OpenCodeSession>(`/opencode/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),

    delete: (id: string) =>
      oc<void>(`/opencode/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),

    messages: (id: string, limit?: number, before?: string) => {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set("limit", String(limit));
      if (before) params.set("before", before);
      const qs = params.toString();
      return oc<OpenCodeMessage[]>(
        `/opencode/sessions/${encodeURIComponent(id)}/messages${qs ? `?${qs}` : ""}`,
      );
    },

    getMessage: (sessionId: string, messageId: string) =>
      oc<OpenCodeMessage>(
        `/opencode/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
      ),

    prompt: (id: string, body: OpenCodePromptParams) =>
      oc<OpenCodeMessage>(`/opencode/sessions/${encodeURIComponent(id)}/prompt`, {
        method: "POST",
        body: JSON.stringify(body),
      }),

    abort: (id: string) =>
      oc<unknown>(`/opencode/sessions/${encodeURIComponent(id)}/abort`, {
        method: "POST",
      }),

    fork: (id: string, messageId?: string) =>
      oc<OpenCodeSession>(
        `/opencode/sessions/${encodeURIComponent(id)}/fork`,
        {
          method: "POST",
          body: JSON.stringify({ messageID: messageId }),
        },
      ),

    share: (id: string) =>
      oc<OpenCodeSession>(
        `/opencode/sessions/${encodeURIComponent(id)}/share`,
        { method: "POST" },
      ),

    unshare: (id: string) =>
      oc<void>(`/opencode/sessions/${encodeURIComponent(id)}/share`, {
        method: "DELETE",
      }),

    compact: (
      id: string,
      body?: { providerID?: string; modelID?: string },
    ) =>
      oc<unknown>(
        `/opencode/sessions/${encodeURIComponent(id)}/compact`,
        {
          method: "POST",
          body: body ? JSON.stringify(body) : undefined,
        },
      ),

    deleteMessage: (sessionId: string, messageId: string) =>
      oc<void>(
        `/opencode/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
        { method: "DELETE" },
      ),

    revert: (sessionId: string, messageId: string, partId?: string) =>
      oc<OpenCodeSession>(
        `/opencode/sessions/${encodeURIComponent(sessionId)}/revert`,
        {
          method: "POST",
          body: JSON.stringify({ messageID: messageId, partID: partId }),
        },
      ),

    unrevert: (sessionId: string) =>
      oc<OpenCodeSession>(
        `/opencode/sessions/${encodeURIComponent(sessionId)}/unrevert`,
        { method: "POST" },
      ),

    children: (sessionId: string) =>
      oc<OpenCodeSession[]>(
        `/opencode/sessions/${encodeURIComponent(sessionId)}/children`,
      ),

    diff: (sessionId: string, messageId?: string) =>
      oc<unknown>(
        `/opencode/sessions/${encodeURIComponent(sessionId)}/diff${messageId ? `?messageID=${encodeURIComponent(messageId)}` : ""}`,
      ),

    status: () =>
      oc<unknown>("/opencode/sessions/status"),

    init: (
      sessionId: string,
      body: { modelID?: string; providerID?: string; messageID?: string },
    ) =>
      oc<unknown>(`/opencode/sessions/${encodeURIComponent(sessionId)}/init`, {
        method: "POST",
        body: JSON.stringify(body),
      }),

    command: (sessionId: string, command: string, args: string) =>
      oc<unknown>(
        `/opencode/sessions/${encodeURIComponent(sessionId)}/command`,
        {
          method: "POST",
          body: JSON.stringify({ command, arguments: args }),
        },
      ),
  },

  providers: {
    list: async (directory?: string): Promise<OpenCodeProviderCatalog> => {
      const response = await oc<unknown>(
        `/opencode/providers${directory ? `?directory=${encodeURIComponent(directory)}` : ""}`,
      );
      return normalizeOpenCodeProviderCatalog(response);
    },
  },

  integrations: {
    list: async (directory = "/workspace") => {
      const response = await oc<unknown>(
        `/opencode/integrations?directory=${encodeURIComponent(directory)}`,
      );
      const location = isProviderRecord(response) && isProviderRecord(response.location)
        ? response.location
        : {};
      return { location, data: normalizeOpenCodeIntegrations(response) };
    },

    connectKey: (integrationID: string, key: string) =>
      oc<unknown>(`/opencode/integrations/${encodeURIComponent(integrationID)}/connect/key`, {
        method: "POST",
        body: JSON.stringify({ key }),
      }),

    beginOAuth: (integrationID: string, methodID: string, inputs: Record<string, string>) =>
      oc<{ location: Record<string, unknown>; data: OpenCodeIntegrationAttempt }>(
        `/opencode/integrations/${encodeURIComponent(integrationID)}/connect/oauth`,
        { method: "POST", body: JSON.stringify({ methodID, inputs }) },
      ),

    attemptStatus: (attemptID: string) =>
      oc<{ location: Record<string, unknown>; data: { status: string; message?: string } }>(
        `/opencode/integration-attempts/${encodeURIComponent(attemptID)}`,
      ),

    completeAttempt: (attemptID: string, code?: string) =>
      oc<unknown>(`/opencode/integration-attempts/${encodeURIComponent(attemptID)}/complete`, {
        method: "POST",
        body: JSON.stringify(code ? { code } : {}),
      }),

    cancelAttempt: (attemptID: string) =>
      oc<unknown>(`/opencode/integration-attempts/${encodeURIComponent(attemptID)}`, { method: "DELETE" }),
  },

  auth: {
    disconnect: (providerID: string) =>
      oc<unknown>(`/opencode/auth/${encodeURIComponent(providerID)}`, { method: "DELETE" }),
  },

  agents: {
    list: async () => normalizeOpenCodeAgents(await oc<unknown>("/opencode/agents")),
  },

  mcp: {
    status: () => oc<Record<string, unknown>>("/opencode/mcp"),

    connect: (name: string) =>
      oc<unknown>(
        `/opencode/mcp/${encodeURIComponent(name)}/connect`,
        { method: "POST" },
      ),

    disconnect: (name: string) =>
      oc<unknown>(
        `/opencode/mcp/${encodeURIComponent(name)}/disconnect`,
        { method: "POST" },
      ),
  },

  permissions: {
    list: () =>
      oc<
        Array<{
          id: string;
          permission: string;
          pattern: string;
          action: string;
        }>
      >("/opencode/permissions"),

    reply: (sessionId: string, permissionId: string, response: "once" | "always" | "reject") =>
      oc<unknown>(
        `/opencode/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}`,
        {
          method: "POST",
          body: JSON.stringify({ response }),
        },
      ),
  },

  /* ── Questions ── */

  questions: {
    /**
     * List pending questions for a session/directory.
     * v1.18.9 contract: GET /question returns array of { id, text } objects.
     */
    list: (directory?: string) =>
      oc<Array<{ id: string; text?: string }>>(
        `/opencode/questions${directory ? `?directory=${encodeURIComponent(directory)}` : ""}`,
      ),
  },

  /* ── File upload ── */

  upload: {
    /**
     * Upload a file for use in chat attachments.
     * Accepts any File/Blob and uploads via multipart/form-data.
     * Returns the server-side file URL and metadata.
     */
    file: async (
      file: File,
    ): Promise<{ url: string; filename: string; mime: string; size: number }> => {
      const formData = new FormData();
      formData.append("file", file);
      // Use request() with empty headers to override the default JSON Content-Type
      // so the browser auto-sets multipart/form-data with the boundary.
      return request("/opencode/upload", {
        method: "POST",
        headers: {},
        body: formData,
      });
    },
  },
};
