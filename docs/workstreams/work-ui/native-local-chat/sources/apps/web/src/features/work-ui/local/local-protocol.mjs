export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const text = (value, maximum = 512) => typeof value === "string" && value.length > 0 && value.length <= maximum;
export const clone = value => JSON.parse(JSON.stringify(value));
export function requireValue(ok, message) { if (!ok) throw new Error(message); }
export function environment(value) {
  if (exact(value, ["kind"]) && value.kind === "windows") return { kind: "windows" };
  requireValue(exact(value, ["kind", "distro", "user"]) && value.kind === "wsl" && text(value.distro, 256) && text(value.user, 256), "Choose the exact local environment.");
  return { kind: "wsl", distro: value.distro, user: value.user };
}
export function identity(value) {
  requireValue(exact(value, ["installation_id", "custodian_key", "service_instance_id", "environment"]) &&
    text(value.installation_id) && text(value.custodian_key) && text(value.service_instance_id), "Veyra has not confirmed local ownership.");
  return { installation_id: value.installation_id, custodian_key: value.custodian_key,
    service_instance_id: value.service_instance_id, environment: environment(value.environment) };
}
export function owner(value) {
  requireValue(exact(value, ["installation_id", "custodian_key", "workspace_id", "revision", "service_instance_id", "environment"]) &&
    text(value.installation_id) && text(value.custodian_key) && UUID.test(value.workspace_id) &&
    Number.isSafeInteger(value.revision) && value.revision >= 0 && text(value.service_instance_id), "The local workspace owner is unavailable.");
  // This is the original Rust struct's serialized field order, not key sorting.
  return { installation_id: value.installation_id, custodian_key: value.custodian_key, workspace_id: value.workspace_id,
    revision: value.revision, service_instance_id: value.service_instance_id, environment: environment(value.environment) };
}
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function realm(value) {
  const checked = identity(value);
  return JSON.stringify([checked.installation_id, checked.custodian_key, checked.environment]);
}
export function createWire(requestID, value) {
  requireValue(UUID.test(requestID), "The original workspace request is invalid.");
  return JSON.stringify({ request_id: requestID, environment: environment(value) });
}
export function operationWire(requestID, value, operation) {
  requireValue(UUID.test(requestID), "The original operation ID is invalid.");
  let typed;
  if (operation?.kind === "session_create") {
    requireValue(exact(operation, ["kind", "title", "agent"]) && text(operation.title, 256) && text(operation.agent, 128), "Choose an actual available agent before creating a conversation.");
    typed = { kind: "session_create", title: operation.title, agent: operation.agent };
  } else if (["session_interrupt", "session_select_model", "session_select_agent"].includes(operation?.kind)) {
    const field = operation.kind === "session_select_model" ? "model_id" : operation.kind === "session_select_agent" ? "agent" : null;
    requireValue(exact(operation, field ? ["kind", "session_id", field] : ["kind", "session_id"]) &&
      /^ses_[0-9a-f]{32}$/.test(operation.session_id) && (!field || text(operation[field], field === "agent" ? 128 : 512)), "Invalid local conversation control.");
    typed = { kind: operation.kind, session_id: operation.session_id };
    if (field) typed[field] = operation[field];
  } else {
    requireValue(exact(operation, ["kind", "session_id", "text"]) && operation.kind === "agent_turn" &&
      /^ses_[0-9a-f]{32}$/.test(operation.session_id) && text(operation.text, 65536) && operation.text.trim(), "The original local prompt is invalid.");
    // Refuse invalid Unicode rather than normalizing a captured prompt.
    requireValue(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(operation.text), "This draft contains an invalid Unicode sequence; it was kept.");
    typed = { kind: "agent_turn", session_id: operation.session_id, text: operation.text };
  }
  return JSON.stringify({ request_id: requestID, owner: owner(value), operation: typed });
}
export async function sha256(wire) {
  requireValue(globalThis.crypto?.subtle, "Original verification is unavailable; nothing was sent.");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(wire));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function workspaceObservation(reply, originalIdentity, workspaceID) {
  const actual = owner(reply?.owner), record = reply?.workspace;
  requireValue(same(identity({ installation_id: actual.installation_id, custodian_key: actual.custodian_key,
    service_instance_id: actual.service_instance_id, environment: actual.environment }), identity(originalIdentity)) &&
    actual.workspace_id === workspaceID && record?.id === workspaceID && record.state === "active" &&
    record.revision === actual.revision && same(environment(record.environment), actual.environment) &&
    text(record.root_path, 32768) && text(record.root_identity, 4096), "The returned local workspace does not match this original.");
  return { owner: actual, workspace: clone(record) };
}
export function verifiedReceipt(reply, seal) {
  const body = JSON.parse(seal.wire);
  requireValue(object(reply) && reply.request_id === body.request_id &&
    same(owner(reply.owner), owner(body.owner)) && reply.request_sha256 === seal.sha256 &&
    ["intent", "unknown", "committed", "denied"].includes(reply.state), "The receipt does not match the exact original.");
  return clone(reply);
}
export function createdSession(receipt, workspace) {
  const result = receipt.result, body = JSON.parse(workspace.sessionWire);
  const expected = "ses_" + body.request_id.replaceAll("-", "");
  requireValue(receipt.state === "committed" && result?.result_kind === "session_created" &&
    result.session?.id === expected && result.session.location?.directory === workspace.rootPath,
    "The original session identity has not been confirmed.");
  return clone(result.session);
}

/** Exact closed routes only. The existing gateway/desktop owner must admit these
 * specific shapes; this is not an arbitrary URL, Project or organization proxy. */
export function createLocalTransport(gateway) {
  const request = (method, path, body, current) => {
    requireValue(typeof gateway.workbench === "function", "Local chats are unavailable.");
    return gateway.workbench(method, path, body, current);
  };
  const id = value => { requireValue(UUID.test(value), "Invalid original ID."); return value; };
  const session = value => { requireValue(/^ses_[0-9a-f]{32}$/.test(value), "Invalid bound session ID."); return value; };
  const base = value => "/v1/local-workspaces/" + id(value);
  return {
    readContext: current => request("GET", "/v1/local-workspaces/context", undefined, current),
    readRuntime: (workspaceID, current) => request("GET", base(workspaceID) + "/runtime", undefined, current),
    readSessions: (workspaceID, after, current) => {
      requireValue(after === null || (typeof after === "string" && after.length > 0 && after.length <= 4096 && !/[\x00-\x1f\x7f]/.test(after)), "Invalid conversation cursor.");
      return request("GET", base(workspaceID) + "/sessions?limit=50" + (after === null ? "" : "&after=" + encodeURIComponent(after)), undefined, current);
    },
    readMessages: (workspaceID, sessionID, cursor, current) => {
      requireValue(cursor === null || (typeof cursor === "string" && cursor.length > 0 && cursor.length <= 4096 && !/[\x00-\x1f\x7f]/.test(cursor)), "Invalid message cursor.");
      return request("GET", base(workspaceID) + "/sessions/" + session(sessionID) + "/messages?limit=50" + (cursor === null ? "" : "&cursor=" + encodeURIComponent(cursor)), undefined, current);
    },
    readStatus: (workspaceID, sessionID, current) => request("GET", base(workspaceID) + "/sessions/" + session(sessionID) + "/status", undefined, current),
    createWorkspace: (body, current) => { requireValue(same(JSON.parse(createWire(body.request_id, body.environment)), body), "Invalid creation body."); return request("POST", "/v1/local-workspaces/", body, current); },
    readWorkspace: (value, current) => request("GET", "/v1/local-workspaces/" + id(value), undefined, current),
    dispatch: (body, current) => { requireValue(operationWire(body.request_id, body.owner, body.operation) === JSON.stringify(body), "Invalid local operation."); return request("POST", "/v1/local-workspaces/operations", body, current); },
    readReceipt: (value, current) => request("GET", "/v1/local-workspaces/operations/" + id(value), undefined, current),
    readSession: (workspaceID, sessionID, current) => {
      requireValue(/^ses_[0-9a-f]{32}$/.test(sessionID), "Invalid bound session ID.");
      return request("GET", "/v1/local-workspaces/" + id(workspaceID) + "/sessions/" + sessionID, undefined, current);
    },
  };
}
