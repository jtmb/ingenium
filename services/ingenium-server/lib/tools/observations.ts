/**
 * MCP tool handlers for the observations pipeline.
 * Supports storing new observations, searching via FTS5, listing, stats, enrichment, and deletion.
 */
import { api } from "../client.js";

/** Store a new observation. The agent calls this naturally during workflow. */
export async function observationStore(project: string, observationType: string, content: string, importance?: number, source?: string, context?: string, sessionId?: string) {
  const res = await api.post("/observations", {
    observation_type: observationType,
    content,
    importance,
    source: source || "agent",
    context,
    session_id: sessionId,
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Search observations via FTS5 */
export async function observationSearch(project: string, query: string) {
  const res = await api.get("/observations/search", { project, q: query });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List observations with optional status/type filters */
export async function observationList(project: string, status?: string, type?: string) {
  const params: Record<string, string> = { project };
  if (status) params.status = status;
  if (type) params.type = type;
  const res = await api.get("/observations", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get observation stats */
export async function observationStats(project: string) {
  const res = await api.get("/observations/stats", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a single observation by ID */
export async function observationGet(project: string, observationId: number) {
  const res = await api.get(`/observations/${observationId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Update an observation (status, importance) */
export async function observationUpdate(project: string, observationId: number, status?: string, importance?: number) {
  const body: Record<string, unknown> = {};
  if (status !== undefined) body.status = status;
  if (importance !== undefined) body.importance = importance;
  const res = await api.patch(`/observations/${observationId}`, body, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Enrich raw observations via LLM */
export async function observationEnrich(project: string, observations: unknown[]) {
  const res = await api.post("/observations/enrich", { observations }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Hard delete a single observation */
export async function observationDelete(project: string, observationId: number) {
  const res = await api.del(`/observations/${observationId}`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: observationId }) }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Bulk hard delete observations by source — 🔴 requires confirm === true */
export async function observationDeleteBySource(project: string, source: string, confirm: boolean) {
  if (confirm !== true) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ error: "SAFETY_GUARD", message: "Set confirm=true to delete all observations for this source." }),
      }],
    };
  }
  const res = await api.del("/observations", { project, source });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
