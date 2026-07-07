/**
 * MCP tool handlers for project management.
 * Supports listing all projects and initializing new ones.
 */
import { api } from "../client.js";

/** List all projects known to the Ingenium API. */
export async function projectList() {
  const res = await api.get("/projects");
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Initialise a new project on the Ingenium API. */
export async function projectInit(name: string) {
  const res = await api.post("/projects", { name });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
