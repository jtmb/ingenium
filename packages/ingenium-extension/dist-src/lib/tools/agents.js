import { api } from "../client.js";
export async function agentList(project, category) {
    const url = category
        ? `/agents?project=${project}&category=${encodeURIComponent(category)}`
        : `/agents?project=${project}`;
    const res = await api.get(url);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function agentGet(project, name) {
    const res = await api.get(`/agents/${encodeURIComponent(name)}?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function agentCreate(project, name, content, description, category, mode, model) {
    const res = await api.post(`/agents?project=${project}`, { name, content, description, category, mode, model });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function agentUpdate(project, name, updates) {
    const res = await api.put(`/agents/${encodeURIComponent(name)}?project=${project}`, updates);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function agentDelete(project, name) {
    const res = await api.del(`/agents/${encodeURIComponent(name)}?project=${project}`);
    if (res.status === 204) {
        return { content: [{ type: "text", text: "Agent deleted" }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function agentEnable(project, name) {
    const res = await api.post(`/agents/${encodeURIComponent(name)}/enable?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function agentDisable(project, name) {
    const res = await api.post(`/agents/${encodeURIComponent(name)}/disable?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Sync an agent from its .md file on disk to the DB — edits made directly to the file are persisted. */
export async function agentSync(project, name) {
    const res = await api.post(`/agents/${encodeURIComponent(name)}/sync?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
