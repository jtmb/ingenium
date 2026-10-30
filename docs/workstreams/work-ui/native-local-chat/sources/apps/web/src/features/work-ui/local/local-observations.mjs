import { identity, owner, same, environment, requireValue, clone } from "./local-protocol.mjs";

/** Map only the enrolled library/custodian response. Snapshot is not a source. */
export function identityFromContext(reply, selectedEnvironment) {
  const selected = environment(selectedEnvironment);
  requireValue(Array.isArray(reply?.supported_environment_kinds) && reply.supported_environment_kinds.includes(selected.kind), "The selected local environment is unavailable.");
  return identity({ installation_id: reply.library_id, custodian_key: reply.custodian?.key,
    service_instance_id: reply.service_instance_id, environment: selected });
}
export function boundRead(reply, actualOwner, sessionID) {
  requireValue(same(owner(reply?.owner), owner(actualOwner)) && (!sessionID || reply.session_id === sessionID), "The observation belongs to another local owner or session.");
  return clone(reply);
}
export function messagePage(reply, actualOwner, sessionID, cursor = null) {
  const page = boundRead(reply, actualOwner, sessionID);
  requireValue(page.order === (cursor === null ? "desc" : "cursor") && Array.isArray(page.data) && page.data.length <= 50 &&
    new TextEncoder().encode(JSON.stringify(reply)).length <= 4 * 1024 * 1024 && page.cursor &&
    [page.cursor.next, page.cursor.previous].every(value => value === null || (typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value))), "Invalid bounded message page.");
  const ids = new Set();
  for (const message of page.data) {
    requireValue(typeof message.id === "string" && message.id && !ids.has(message.id) && message.sessionID === sessionID &&
      typeof message.type === "string" && (message.text === null || typeof message.text === "string") && Array.isArray(message.content), "The transcript contains an invalid or foreign message.");
    ids.add(message.id);
  }
  // Keep the server's order. IDs and dual cursors do not prove chronology/hasMore.
  return page;
}
export async function readConversation(transport, actualOwner, sessionID, current, cursor = null) {
  requireValue(current(), "The local selection changed.");
  const workspaceID = owner(actualOwner).workspace_id;
  const runtime = boundRead(await transport.readRuntime(workspaceID, current), actualOwner);
  requireValue(current(), "The local selection changed.");
  const status = boundRead(await transport.readStatus(workspaceID, sessionID, current), actualOwner, sessionID);
  requireValue(typeof status.running === "boolean" && status.terminal_observed === false, "Conversation activity is unavailable.");
  requireValue(current(), "The local selection changed.");
  const page = messagePage(await transport.readMessages(workspaceID, sessionID, cursor, current), actualOwner, sessionID, cursor);
  requireValue(current(), "The local selection changed.");
  return { runtime, status, page };
}
