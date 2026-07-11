import { api } from "../client.js";
export async function configGet(project, type) {
    const res = await api.get("/config", { project, type });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function configSet(project, type, content) {
    const res = await api.put("/config", { content }, { project, type });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function configSync(project, type) {
    const res = await api.post("/config/sync", {}, { project, type });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
