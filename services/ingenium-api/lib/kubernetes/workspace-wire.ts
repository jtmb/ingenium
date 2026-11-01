import type WebSocket from "ws";
import { KubernetesApiClient } from "./api-client.js";
import { parseStrictJobJson } from "../dot-v2/job-bootstrap-frame.mjs";

const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const active = new Map<string, Attachment>();
const error = (code: string) => Object.assign(new Error(code), { code, status: 503 });
export interface KubernetesAttachSource {
  namespaceUid: string;
  apiCaSha256: string;
  podUid: string;
  containerId: string;
  startedAt: string;
  nodeName: string;
}
export interface WorkspaceBootstrapExpectation {
  nonce: string; runtimeId: string; workspaceId: string; credentialId: string;
  bindingHash: string; bindingEpoch: number; startIdentity: string; requestId: string;
  podUid: string; containerId: string;
}
export interface WorkspaceBootstrapAck {
  schemaVersion: 2; protocol: "workspace-runtime-v2"; nonce: string; runtimeId: string;
  workspaceId: string; credentialId: string; bindingHash: string; bindingEpoch: number;
  startIdentity: string; mcpProtocol: 2;
}
interface Attachment {
  socket?: WebSocket;
  source?: Readonly<KubernetesAttachSource>;
  ack?: Readonly<WorkspaceBootstrapAck>;
  unknown?: string;
  closed: boolean;
}

/** The source is a new physical, verified Kubernetes connection. No input can
 * supply a socket, ACK, transport callback or reconstructed positive handle. */
export async function joinKubernetesWorkspaceAttach(client: KubernetesApiClient, capability: string,
  expected: WorkspaceBootstrapExpectation, signal?: AbortSignal): Promise<Readonly<WorkspaceBootstrapAck>> {
  const runtimeId = expected.runtimeId;
  if (!(client instanceof KubernetesApiClient) || !UUID.test(runtimeId) || !UUID.test(expected.podUid) ||
    !HEX.test(expected.containerId) || !HEX.test(expected.nonce) || !HEX.test(expected.startIdentity) ||
    !HEX.test(expected.bindingHash) || !UUID.test(expected.requestId) || !UUID.test(expected.credentialId) ||
    !Number.isSafeInteger(expected.bindingEpoch) || expected.bindingEpoch < 0 ||
    !/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(capability) || active.has(runtimeId) || active.size >= 1024) throw error("KUBERNETES_ORIGINAL_ATTACH_INPUT");
  const state: Attachment = { closed: false };
  active.set(runtimeId, state);
  try {
    const connection = await client.attachWorkspace(runtimeId, expected, signal);
    state.socket = connection.socket;
    state.source = connection.source;
    const frame = Buffer.from(JSON.stringify({
      schemaVersion: 2, protocol: "workspace-runtime-v2", nonce: expected.nonce,
      capability, startIdentity: expected.startIdentity, requestId: expected.requestId,
    }) + "\n");
    if (frame.length > 1024) throw error("KUBERNETES_BOOTSTRAP_FRAME_BOUND");
    return await new Promise((resolve, reject) => {
      let settled = false, ackBytes = Buffer.alloc(0), total = 0;
      const timer = setTimeout(() => fail("KUBERNETES_BOOTSTRAP_ACK_TIMEOUT"), 10000);
      timer.unref();
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", aborted); frame.fill(0); };
      const fail = (code: string) => {
        state.unknown ??= code;
        if (!settled) { settled = true; cleanup(); ackBytes.fill(0); reject(error(code)); }
        state.socket?.terminate();
      };
      const aborted = () => fail("KUBERNETES_BOOTSTRAP_ABORTED");
      signal?.addEventListener("abort", aborted, { once: true });
      connection.socket.on("message", (data, binary) => {
        const message = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (!binary || message.length < 1 || message.length > 65536) return fail("KUBERNETES_ATTACH_CHANNEL_INVALID");
        const channel = message[0], body = message.subarray(1);
        if (state.ack) {
          if (channel === 255) state.unknown ??= "KUBERNETES_ATTACH_STREAM_CLOSED";
          if (channel === 3) {
            try { if ((parseStrictJobJson(body, 4096) as { status?: string })?.status !== "Success") return fail("KUBERNETES_ATTACH_REMOTE_ERROR"); }
            catch { return fail("KUBERNETES_ATTACH_STATUS_INVALID"); }
          }
          return; // Runtime logs never accumulate in the original connection owner.
        }
        if (channel !== 1) return fail("KUBERNETES_BOOTSTRAP_STDOUT_REQUIRED");
        total += body.length;
        if (total > 128 * 1024) return fail("KUBERNETES_BOOTSTRAP_ACK_BOUND");
        const newline = body.indexOf(10), fragment = newline < 0 ? body : body.subarray(0, newline);
        ackBytes = Buffer.concat([ackBytes, fragment]);
        if (ackBytes.length > 4096) return fail("KUBERNETES_BOOTSTRAP_ACK_BOUND");
        if (newline < 0) return;
        const wanted: WorkspaceBootstrapAck = {
          schemaVersion: 2, protocol: "workspace-runtime-v2", nonce: expected.nonce,
          runtimeId, workspaceId: expected.workspaceId, credentialId: expected.credentialId,
          bindingHash: expected.bindingHash, bindingEpoch: expected.bindingEpoch,
          startIdentity: expected.startIdentity, mcpProtocol: 2,
        };
        let value: Record<string, unknown>;
        try { value = parseStrictJobJson(ackBytes, 4096) as Record<string, unknown>; }
        catch { return fail("KUBERNETES_BOOTSTRAP_ACK_INVALID"); }
        if (!value || Object.keys(value).sort().join("|") !== Object.keys(wanted).sort().join("|") ||
          Object.entries(wanted).some(([key, item]) => value[key] !== item)) return fail("KUBERNETES_BOOTSTRAP_ACK_BINDING");
        state.ack = Object.freeze(wanted);
        settled = true; cleanup(); ackBytes.fill(0);
        resolve(state.ack);
      });
      connection.socket.once("error", () => fail("KUBERNETES_ORIGINAL_ATTACH_ERROR"));
      connection.socket.once("close", () => { state.closed = true; state.unknown ??= "KUBERNETES_ORIGINAL_ATTACH_CLOSED"; if (!settled) fail(state.unknown); });
      if (signal?.aborted || connection.socket.readyState !== 1) return aborted();
      // Channel 0 is stdin. Keep the original connection open after the ACK;
      // neither a timer nor a later reconnect can replace its lifetime.
      connection.socket.send(Buffer.concat([Buffer.from([0]), frame]), { binary: true, compress: false }, cause => {
        frame.fill(0);
        if (cause) fail("KUBERNETES_BOOTSTRAP_WRITE_UNKNOWN");
      });
    });
  } catch (cause) {
    state.unknown ??= cause instanceof Error && /^KUBERNETES_[A-Z_]+$/.test(cause.message) ? cause.message : "KUBERNETES_ORIGINAL_ATTACH_UNAVAILABLE";
    state.socket?.terminate();
    throw cause;
  }
}

export function requireRetainedKubernetesWorkspaceAttach(runtimeId: string): {
  source: Readonly<KubernetesAttachSource>; ack: Readonly<WorkspaceBootstrapAck>;
} {
  const state = active.get(runtimeId);
  if (!state?.ack || !state.source || state.unknown || state.closed || state.socket?.readyState !== 1) throw error("KUBERNETES_ORIGINAL_ATTACH_UNAVAILABLE");
  return Object.freeze({ source: state.source, ack: state.ack });
}

/** A closed channel alone does not prove that the Pod/container has stopped.
 * The lifecycle owner must independently confirm that same original container. */
export async function joinStoppedKubernetesWorkspaceAttach(runtimeId: string, podUid: string): Promise<void> {
  const state = active.get(runtimeId);
  if (!state?.ack || state.source?.podUid !== podUid) throw error("KUBERNETES_RETIREMENT_ORIGINAL_UNAVAILABLE");
  const deadline = Date.now() + 3000;
  while (!state.closed) {
    if (Date.now() >= deadline) throw error("KUBERNETES_RETIREMENT_ATTACH_UNCONFIRMED");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (state.socket?.readyState !== 3) throw error("KUBERNETES_RETIREMENT_ATTACH_UNCONFIRMED");
  active.delete(runtimeId);
}
