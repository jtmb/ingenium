/**
 * MCP tool handlers for the synthesis pipeline.
 * Supports triggering synthesis runs and checking pipeline status.
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
