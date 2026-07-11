import { api } from "../client.js";

export async function configGet(project: string, type: string) {
  const res = await api.get("/config", { project, type });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

export async function configSet(project: string, type: string, content: string) {
  const res = await api.put("/config", { content }, { project, type });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

export async function configSync(project: string, type: string) {
  const res = await api.post("/config/sync", {}, { project, type });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
