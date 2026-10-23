/**
 * MCP tool handlers for plugin lifecycle management.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Plugins are auto-synced to disk on lifecycle changes per the plugin convention.
 */
import { api } from "../client.js";
import { textResult } from "./result.js";
import { z } from "zod";

const pluginUpdateFields = z.object({
  description: z.string().max(2000).refine((value) => !value.includes("\0"), "Description must not contain NUL").optional(),
  file_path: z.string().optional(),
  source_content: z.string().optional(),
}).strict();
const isSeparateUpdate = (value: z.infer<typeof pluginUpdateFields>) => value.description !== undefined
  ? value.file_path === undefined && value.source_content === undefined
  : value.file_path !== undefined || value.source_content !== undefined;
export const pluginUpdateInputSchema = pluginUpdateFields.extend({
  project: z.string().min(1).max(256), name: z.string().min(1).max(256),
});

/** List all plugins available for a project. */
export async function pluginList(project: string) {
  const res = await api.get("/plugins", { project });
  return textResult(res.data);
}

/** Enable a plugin for a project. Synced to disk + opencode.json plugin array. */
export async function pluginEnable(project: string, name: string) {
  const res = await api.post(`/plugins/${encodeURIComponent(name)}/enable`, {}, { project });
  return textResult(res.data);
}

/** Disable a plugin for a project. Synced to disk + opencode.json plugin array. */
export async function pluginDisable(project: string, name: string) {
  const res = await api.post(`/plugins/${encodeURIComponent(name)}/disable`, {}, { project });
  return textResult(res.data);
}

/** Create a new plugin. Auto-populates sourceContent from disk if empty. */
export async function pluginCreate(project: string, name: string, filePath: string, sourceContent?: string) {
  const res = await api.post("/plugins", { name, file_path: filePath, source_content: sourceContent ?? "" }, { project });
  return textResult(res.data);
}

/** Delete a plugin from a project. */
export async function pluginDelete(project: string, name: string) {
  await api.del(`/plugins/${encodeURIComponent(name)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }) }] };
}

/** Description edits are project-local metadata, never executable configuration. */
export async function pluginUpdate(project: string, name: string, updates: z.infer<typeof pluginUpdateFields>) {
  const fields = pluginUpdateFields.refine(isSeparateUpdate, "Provide description alone, or executable fields alone").parse(updates);
  pluginUpdateInputSchema.parse({ ...fields, project, name });
  const res = await api.put(`/plugins/${encodeURIComponent(name)}`, fields, { project });
  return textResult(res.data);
}

/** Get a plugin by name. */
// FIXME: `name` is not URI-encoded here (unlike pluginDelete, pluginUpdate, pluginSource).
// Will fail for plugin names with special characters.
export async function pluginGet(project: string, name: string) {
  const res = await api.get(`/plugins/${name}?project=${project}`);
  return textResult(res.data);
}

/** Get a plugin's source content directly from disk (not from DB cache). */
export async function pluginSource(project: string, name: string) {
  const res = await api.get(`/plugins/${encodeURIComponent(name)}/source?project=${project}`);
  return textResult(res.data);
}
