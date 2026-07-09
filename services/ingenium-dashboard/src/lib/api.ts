const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4097/api/v1";

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
export type Project = { id: string; name: string; path?: string; archived_at?: string; created_at: string; updated_at: string };

/** An AI agent skill with its full content. */
export type Skill = { id: string; name: string; description: string; content: string; category?: string; enabled: boolean };

/** A learning entry — decisions, patterns, bugs, or preferences. */
export type Learning = { id: number; entry_type: string; content: string; tags?: string; priority: number; created_at: string };

/** A Kaban-board-style task with column tracking. */
export type Task = { id: string; title: string; description?: string; column_id: string; assigned_to?: string; created_at: string; completed_at?: string };

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
export type Server = { id: string; name: string; command: string; running: boolean; enabled: boolean };

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
  },
  skills: {
    list: (project = "ingenium") => request<{ data: Skill[] }>(`/skills?project=${project}`),
    get: (name: string, project = "ingenium") => request<{ data: Skill }>(`/skills/${name}?project=${project}`),
    create: (name: string, description: string, content: string, project = "ingenium") =>
      request<{ data: Skill }>(`/skills?project=${project}`, { method: "POST", body: JSON.stringify({ name, description, content }) }),
    update: (name: string, content: string, project = "ingenium") =>
      request<{ data: Skill }>(`/skills/${name}?project=${project}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  },
  learnings: {
    list: (project = "ingenium") => request<{ data: Learning[] }>(`/learnings?project=${project}`),
    create: (entry_type: string, content: string, tags?: string, project = "ingenium") =>
      request<{ data: Learning }>(`/learnings?project=${project}`, { method: "POST", body: JSON.stringify({ entry_type, content, tags }) }),
  },
  tasks: {
    list: (project = "ingenium") => request<{ data: Task[] }>(`/tasks?project=${project}`),
    create: (title: string, project = "ingenium") =>
      request<{ data: Task }>(`/tasks?project=${project}`, { method: "POST", body: JSON.stringify({ title }) }),
    move: (id: string, column_id: string, project = "ingenium") =>
      request<{ data: Task }>(`/tasks/${id}?project=${project}`, { method: "PATCH", body: JSON.stringify({ column_id }) }),
    complete: (id: string, project = "ingenium") =>
      request<{ data: Task }>(`/tasks/${id}?project=${project}`, { method: "PATCH", body: "{}" }),
  },
  plugins: {
    list: (project = "ingenium") => request<{ data: Plugin[] }>(`/plugins?project=${project}`),
    get: (name: string, project = "ingenium") => request<{ data: Plugin }>(`/plugins/${name}?project=${project}`),
    create: (name: string, file_path: string, source_content?: string, project = "ingenium") =>
      request<{ data: Plugin }>(`/plugins?project=${project}`, {
        method: "POST", body: JSON.stringify({ name, file_path, source_content }),
      }),
    update: (name: string, data: { file_path?: string; source_content?: string }, project = "ingenium") =>
      request<{ data: Plugin }>(`/plugins/${name}?project=${project}`, {
        method: "PUT", body: JSON.stringify(data),
      }),
    delete: (name: string, project = "ingenium") =>
      request(`/plugins/${name}?project=${project}`, { method: "DELETE" }),
    enable: (name: string, project = "ingenium") =>
      request<{ data: Plugin }>(`/plugins/${name}/enable?project=${project}`, { method: "POST" }),
    disable: (name: string, project = "ingenium") =>
      request<{ data: Plugin }>(`/plugins/${name}/disable?project=${project}`, { method: "POST" }),
  },
  agents: {
    list: (project = "ingenium", category?: string) => {
      const url = category ? `/agents?project=${project}&category=${encodeURIComponent(category)}` : `/agents?project=${project}`;
      return request<{ data: Agent[]; total?: number }>(url);
    },
    get: (name: string, project = "ingenium") =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}?project=${project}`),
    create: (data: { name: string; content: string; description?: string; category?: string; mode?: string; model?: string }, project = "ingenium") =>
      request<{ data: Agent }>(`/agents?project=${project}`, { method: "POST", body: JSON.stringify(data) }),
    update: (name: string, data: { description?: string; category?: string; mode?: string; model?: string; content?: string }, project = "ingenium") =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}?project=${project}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (name: string, project = "ingenium") =>
      request(`/agents/${encodeURIComponent(name)}?project=${project}`, { method: "DELETE" }),
    enable: (name: string, project = "ingenium") =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}/enable?project=${project}`, { method: "POST" }),
    disable: (name: string, project = "ingenium") =>
      request<{ data: Agent }>(`/agents/${encodeURIComponent(name)}/disable?project=${project}`, { method: "POST" }),
  },
  servers: {
    list: (project = "ingenium") => request<{ data: Server[] }>(`/servers?project=${project}`),
    create: (name: string, command: string, project = "ingenium") =>
      request<{ data: Server }>(`/servers?project=${project}`, { method: "POST", body: JSON.stringify({ name, command }) }),
  },
  settings: {
    get: (key: string, project = "ingenium") => request<{ data: { key: string; value: string } }>(`/settings?project=${project}&key=${key}`),
    set: (key: string, value: string, project = "ingenium") =>
      request<{ data: { key: string; value: string } }>(`/settings?project=${project}`, { method: "POST", body: JSON.stringify({ key, value }) }),
  },
};
