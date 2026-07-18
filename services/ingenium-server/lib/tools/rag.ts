/**
 * MCP tool handlers for RAG (Retrieval-Augmented Generation).
 * Each function calls the Ingenium API via HTTP and returns MCP-formatted results.
 * The server has ZERO database access — all data goes through the API layer.
 *
 * API routes:
 *   GET    /api/v1/rag/search?q=&limit=
 *   POST   /api/v1/rag/ask
 *   POST   /api/v1/rag/sources          (ingest new document)
 *   GET    /api/v1/rag/sources
 *   GET    /api/v1/rag/sources/:id
 *   DELETE /api/v1/rag/sources/:id
 *   POST   /api/v1/rag/sources/:id/ingest (re-ingest existing source)
 *   GET    /api/v1/rag/stats
 */
import { api } from "../client.js";

/** Search across RAG documents */
export async function ragSearch(project: string, query: string, limit?: number) {
  const params: Record<string, string> = { project, q: query };
  if (limit !== undefined) params.limit = String(limit);
  const res = await api.get("/rag/search", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Ask a question against the RAG index */
export async function ragAsk(project: string, question: string) {
  const res = await api.post("/rag/ask", { question }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Ingest a new document into the RAG index */
export async function ragIngestDocument(project: string, title: string, text: string, format?: string) {
  // Step 1: Create a source entry
  const createRes = await api.post("/rag/sources", { title, format: format ?? "text" }, { project });
  if (!createRes.ok) {
    return { content: [{ type: "text" as const, text: JSON.stringify(createRes.data) }] };
  }
  const sourceId = createRes.data?.id ?? createRes.data?.source?.id;
  if (!sourceId) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to create source — no ID returned" }) }],
    };
  }

  // Step 2: Ingest text into the source
  const ingestRes = await api.post(`/rag/sources/${sourceId}/ingest`, { text, format: format ?? "text" }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ source: createRes.data, ingest: ingestRes.data }) }] };
}

/** List all RAG sources */
export async function ragListSources(project: string) {
  const res = await api.get("/rag/sources", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a single RAG source by ID */
export async function ragGetSource(project: string, sourceId: string) {
  const res = await api.get(`/rag/sources/${encodeURIComponent(sourceId)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a RAG source by ID */
export async function ragDeleteSource(project: string, sourceId: string) {
  const res = await api.del(`/rag/sources/${encodeURIComponent(sourceId)}`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Source deleted" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Re-ingest an existing RAG source with new text */
export async function ragReingest(project: string, sourceId: string, text: string, format?: string) {
  const res = await api.post(`/rag/sources/${encodeURIComponent(sourceId)}/ingest`, { text, format: format ?? "text" }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get RAG statistics */
export async function ragStats(project: string) {
  const res = await api.get("/rag/stats", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
