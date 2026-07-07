/**
 * MCP tool handlers for the learnings log.
 * Supports logging new entries and searching existing ones via the API.
 */
import { api } from "../client.js";
/** Log a new learning entry. Supports optional tags, priority, and session association. */
export async function learningLog(project, entryType, content, tags, priority, sessionId) {
    const res = await api.post("/learnings", { entry_type: entryType, content, tags, priority, session_id: sessionId }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Full-text search across learning entries. */
export async function learningSearch(project, query) {
    const res = await api.get("/learnings/search", { project, q: query });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
