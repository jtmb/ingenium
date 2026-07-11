/**
 * MCP tool handlers for the synthesis pipeline.
 * Supports triggering synthesis runs and checking pipeline status.
 */
import { api } from "../client.js";
/** Trigger the synthesis pipeline */
export async function synthesisRun(project) {
    const res = await api.post("/synthesis/run", {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get synthesis pipeline status */
export async function synthesisStatus(project) {
    const res = await api.get("/synthesis/status", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Trigger cross-project synthesis */
export async function synthesisCrossProject(project) {
    const res = await api.post("/synthesis/cross-project", {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res) }] };
}
