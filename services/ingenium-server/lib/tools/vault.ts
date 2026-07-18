/**
 * MCP tool handlers for vault management (password/secret store).
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 */
import { api } from "../client.js";

/** Get vault status (sealed/unsealed). */
export async function vaultStatus(project: string) {
  const res = await api.get(`/vault/status?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Unseal the vault with a passphrase. */
export async function vaultUnseal(project: string, passphrase: string) {
  const res = await api.post(`/vault/unseal`, { passphrase }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Seal the vault. */
export async function vaultSeal(project: string) {
  const res = await api.post(`/vault/seal`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List vault items, optionally filtered by folder. */
export async function vaultItemList(project: string, folder?: string) {
  const params: Record<string, string> = { project };
  if (folder) params.folder = folder;
  const res = await api.get("/vault/items", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Create a new vault item. */
export async function vaultItemCreate(
  project: string,
  name: string,
  type: string,
  value: string,
  folderId?: string,
  tags?: string,
  urls?: string,
  username?: string,
) {
  const body: Record<string, unknown> = { name, type, value };
  if (folderId) body.folder_id = folderId;
  if (tags) body.tags = tags;
  if (urls) body.urls = urls;
  if (username) body.username = username;
  const res = await api.post("/vault/items", body, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a single vault item by ID (metadata only, no secret value). */
export async function vaultItemGet(project: string, itemId: string) {
  const res = await api.get(`/vault/items/${encodeURIComponent(itemId)}?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Update a vault item's value. */
export async function vaultItemUpdate(project: string, itemId: string, value: string) {
  const res = await api.put(`/vault/items/${encodeURIComponent(itemId)}`, { value }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a vault item by ID. */
export async function vaultItemDelete(project: string, itemId: string) {
  const res = await api.del(`/vault/items/${encodeURIComponent(itemId)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: res.ok }) }] };
}

/** Generate a secure password. */
export async function vaultPasswordGen(project: string, length?: number) {
  const params: Record<string, string> = { project };
  if (length !== undefined) params.length = String(length);
  const res = await api.post("/vault/generate-password", {}, params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List vault audit log entries. */
export async function vaultAuditList(project: string) {
  const res = await api.get(`/vault/audit?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
