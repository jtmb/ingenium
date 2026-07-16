/**
 * MCP tool handlers for the Jobs feature.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Supports job CRUD, manual triggering, run history, log streaming, and run cancellation.
 */
import { api } from "../client.js";

/** List all jobs for a project. */
export async function jobList(project: string) {
  const res = await api.get("/jobs", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Create a new job with optional schedule cron, trigger event, and timeout. */
export async function jobCreate(
  project: string,
  name: string,
  description: string | undefined,
  agent: string,
  prompt_template: string,
  schedule_cron?: string,
  trigger_event?: string,
  timeout_minutes?: number,
) {
  const body: Record<string, unknown> = { name, agent, prompt_template };
  if (description) body.description = description;
  if (schedule_cron) body.schedule_cron = schedule_cron;
  if (trigger_event) body.trigger_event = trigger_event;
  if (timeout_minutes !== undefined) body.timeout_minutes = timeout_minutes;
  const res = await api.post("/jobs", body, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Update an existing job's fields. */
export async function jobUpdate(project: string, jobId: string, fields: Record<string, unknown>) {
  const res = await api.patch(`/jobs/${jobId}`, fields, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a job by ID. */
export async function jobDelete(project: string, jobId: string) {
  await api.del(`/jobs/${jobId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: jobId }) }] };
}

/** Manually trigger a job run. */
export async function jobRun(project: string, jobId: string) {
  const res = await api.post(`/jobs/${jobId}/run`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List all runs for a job. */
export async function jobRuns(project: string, jobId: string) {
  const res = await api.get(`/jobs/${jobId}/runs`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get log entries for a specific run, optionally after a sequence number for tail polling. */
export async function jobRunLogs(project: string, runId: string, after?: number) {
  const params: Record<string, string> = { project };
  if (after !== undefined) params.after = String(after);
  const res = await api.get(`/jobs/runs/${runId}/logs`, params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Cancel a running job. */
export async function jobRunCancel(project: string, runId: string) {
  const res = await api.post(`/jobs/runs/${runId}/cancel`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a single job by ID. */
export async function jobGet(project: string, jobId: string) {
  const res = await api.get(`/jobs/${jobId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get LLM-generated job suggestions based on a natural-language description. */
export async function jobSuggest(project: string, description: string) {
  const res = await api.post("/jobs/suggest", { description }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
