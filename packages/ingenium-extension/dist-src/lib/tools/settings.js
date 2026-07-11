/**
 * MCP tool handlers for project-level settings.
 * Supports fetching and updating settings by key.
 */
import { api } from "../client.js";
export async function settingGet(project, key) {
    const res = await api.get(`/settings?project=${project}&key=${key}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function settingSet(project, key, value) {
    const res = await api.post(`/settings?project=${project}`, { key, value });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
