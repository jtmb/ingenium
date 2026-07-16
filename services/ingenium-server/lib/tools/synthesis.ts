/**
 * MCP tool handlers for the synthesis pipeline.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Supports triggering synthesis runs, checking pipeline status, and cross-project evaluation.
 */
import { api } from "../client.js";

/** Trigger the synthesis pipeline */
export async function synthesisRun(project: string) {
  const res = await api.post("/synthesis/run", {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get synthesis pipeline status */
export async function synthesisStatus(project: string) {
  const res = await api.get("/synthesis/status", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Trigger cross-project synthesis — evaluates patterns across all projects. */
// NOTE: Returns `res` (full response) instead of `res.data`, unlike other tools.
// The cross-project endpoint returns top-level metadata plus per-project results.
export async function synthesisCrossProject(project: string) {
  const res = await api.post("/synthesis/cross-project", {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res) }] };
}
