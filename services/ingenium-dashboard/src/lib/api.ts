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
export type Project = { id: string; name: string; path?: string; created_at: string; updated_at: string };

/** An AI agent skill with its full content. */
export type Skill = { id: string; name: string; description: string; content: string; category?: string; enabled: boolean };

/** A learning entry — decisions, patterns, bugs, or preferences. */
export type Learning = { id: number; entry_type: string; content: string; tags?: string; priority: number; created_at: string };

/** A Kaban-board-style task with column tracking. */
export type Task = { id: string; title: string; description?: string; column_id: string; assigned_to?: string; created_at: string; completed_at?: string };

/** An MCP plugin registered in the system. */
export type Plugin = { id: string; name: string; file_path: string; enabled: boolean };

/** An MCP server configuration. */
export type Server = { id: string; name: string; command: string; running: boolean; enabled: boolean };

/**
 * Typed API client for the Ingenium backend.
 * All methods accept an optional `project` parameter that defaults to "default".
 */
export const api = {
  projects: {
    list: () => request<{ data: Project[] }>("/projects"),
    create: (name: string) => request<{ data: Project }>("/projects", { method: "POST", body: JSON.stringify({ name }) }),
  },
  skills: {
    list: (project = "default") => request<{ data: Skill[] }>(`/skills?project=${project}`),
    get: (name: string, project = "default") => request<{ data: Skill }>(`/skills/${name}?project=${project}`),
    create: (name: string, description: string, content: string, project = "default") =>
      request<{ data: Skill }>(`/skills?project=${project}`, { method: "POST", body: JSON.stringify({ name, description, content }) }),
    update: (name: string, content: string, project = "default") =>
      request<{ data: Skill }>(`/skills/${name}?project=${project}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  },
  learnings: {
    list: (project = "default") => request<{ data: Learning[] }>(`/learnings?project=${project}`),
    create: (entry_type: string, content: string, tags?: string, project = "default") =>
      request<{ data: Learning }>(`/learnings?project=${project}`, { method: "POST", body: JSON.stringify({ entry_type, content, tags }) }),
  },
  tasks: {
    list: (project = "default") => request<{ data: Task[] }>(`/tasks?project=${project}`),
    create: (title: string, project = "default") =>
      request<{ data: Task }>(`/tasks?project=${project}`, { method: "POST", body: JSON.stringify({ title }) }),
    move: (id: string, column_id: string, project = "default") =>
      request<{ data: Task }>(`/tasks/${id}?project=${project}`, { method: "PATCH", body: JSON.stringify({ column_id }) }),
  },
  plugins: {
    list: (project = "default") => request<{ data: Plugin[] }>(`/plugins?project=${project}`),
    enable: (name: string, project = "default") => request<{ data: Plugin }>(`/plugins/${name}/enable?project=${project}`, { method: "POST" }),
    disable: (name: string, project = "default") => request<{ data: Plugin }>(`/plugins/${name}/disable?project=${project}`, { method: "POST" }),
  },
  servers: {
    list: (project = "default") => request<{ data: Server[] }>(`/servers?project=${project}`),
    create: (name: string, command: string, project = "default") =>
      request<{ data: Server }>(`/servers?project=${project}`, { method: "POST", body: JSON.stringify({ name, command }) }),
  },
};
