/**
 * MCP tool handlers for the observations pipeline.
 * Supports storing new observations, searching via FTS5, listing, and stats.
 */
import { api } from "../client.js";
/** Store a new observation. The agent calls this naturally during workflow. */
export async function observationStore(project, observationType, content, importance, source, context, sessionId) {
    const res = await api.post("/observations", {
        observation_type: observationType,
        content,
        importance,
        source: source || "agent",
        context,
        session_id: sessionId,
    }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Search observations via FTS5 */
export async function observationSearch(project, query) {
    const res = await api.get("/observations/search", { project, q: query });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** List observations with optional status/type filters */
export async function observationList(project, status, type) {
    const params = { project };
    if (status)
        params.status = status;
    if (type)
        params.type = type;
    const res = await api.get("/observations", params);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get observation stats */
export async function observationStats(project) {
    const res = await api.get("/observations/stats", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
