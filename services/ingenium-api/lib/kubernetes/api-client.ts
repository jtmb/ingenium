import { request as httpsRequest, type RequestOptions } from "node:https";
import { readFileSync, statSync, realpathSync } from "node:fs";
import { createHash, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { parseStrictJobJson } from "../dot-v2/job-bootstrap-frame.mjs";

const PROJECTED = "/var/run/secrets/kubernetes.io/serviceaccount";
const NAME = /^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_REQUEST = 64 * 1024;

export class KubernetesRequestError extends Error {
  readonly code: string;
  constructor(code: string, readonly httpStatus?: number) {
    super(code);
    this.name = "KubernetesRequestError";
    this.code = code;
  }
}
const fail = (code: string): never => { throw new KubernetesRequestError(code); };
const name = (value: string): string => NAME.test(value) ? value : fail("KUBERNETES_RESOURCE_NAME");
const uid = (value: unknown): string => typeof value === "string" && UUID.test(value) ? value : fail("KUBERNETES_RESOURCE_UID");
const encode = (value: string) => encodeURIComponent(name(value));

export interface KubernetesMetadata {
  name: string;
  namespace?: string;
  uid: string;
  resourceVersion: string;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}
export interface KubernetesResource {
  apiVersion: string;
  kind: string;
  metadata: KubernetesMetadata;
  [key: string]: unknown;
}
export interface KubernetesContainerStatus {
  name: string;
  image: string;
  imageID: string;
  containerID?: string;
  ready: boolean;
  restartCount: number;
  state: {
    running?: { startedAt: string };
    terminated?: { containerID?: string; exitCode: number; startedAt: string; finishedAt: string; reason?: string };
    waiting?: { reason?: string };
  };
}
export interface KubernetesPod extends KubernetesResource {
  kind: "Pod";
  spec: Record<string, unknown> & { nodeName?: string; containers: Array<Record<string, unknown>> };
  status?: {
    phase?: string;
    podIP?: string;
    conditions?: Array<{ type: string; status: string }>;
    containerStatuses?: KubernetesContainerStatus[];
  };
}
export interface KubernetesClaim extends KubernetesResource {
  kind: "PersistentVolumeClaim";
  spec: { volumeName?: string; accessModes?: string[]; resources?: { requests?: { storage?: string } } };
  status?: { phase?: string; capacity?: { storage?: string } };
}
export interface KubernetesNode extends KubernetesResource {
  kind: "Node";
  status?: {
    conditions?: Array<{ type: string; status: string }>;
    nodeInfo?: { bootID: string; kernelVersion: string; containerRuntimeVersion: string; kubeletVersion: string };
  };
}
interface Credentials { token?: string; cert?: string; key?: string; }
export interface OperatorKubernetesCredentials {
  /** Existing operator credentials, supplied only by a trusted operator command. Never an HTTP input. */
  server: string;
  namespace: string;
  ca: string;
  cert: string;
  key: string;
}
export interface KubernetesClusterIdentity {
  namespace: string;
  namespaceUid: string;
  apiCaSha256: string;
  apiOrigin: string;
}

/** Bounded descriptor input from the fixed, read-only Kubernetes projected volume.
 * Token rotation can change the projection target; it cannot escape that volume. */
function projectedFile(file: string, maximum: number): string {
  if (!["token", "ca.crt", "namespace"].includes(file)) return fail("KUBERNETES_CREDENTIAL_PATH");
  const base = realpathSync(PROJECTED), root = statSync(base);
  if (!root.isDirectory() || root.uid !== 0 || (root.mode & 0o022) !== 0) return fail("KUBERNETES_CREDENTIAL_DIRECTORY");
  const target = realpathSync(PROJECTED + "/" + file);
  if (!target.startsWith(base + "/")) return fail("KUBERNETES_CREDENTIAL_PATH");
  const before = statSync(target);
  if (!before.isFile() || before.uid !== 0 || before.nlink !== 1 || (before.mode & 0o022) !== 0 || before.size < 1 || before.size > maximum) return fail("KUBERNETES_CREDENTIAL_FILE");
  const raw = readFileSync(target), after = statSync(target);
  if (raw.length !== before.size || ["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key =>
    before[key as keyof typeof before] !== after[key as keyof typeof after])) return fail("KUBERNETES_CREDENTIAL_CHANGED");
  return raw.toString("utf8").trim();
}

function origin(server: string): URL {
  const url = new URL(server);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    url.pathname !== "/" || !url.hostname || url.hostname.includes("%")) return fail("KUBERNETES_API_ORIGIN");
  return url;
}

function resource<T extends KubernetesResource>(raw: unknown, kind: string, expectedName: string, namespace?: string): T {
  const value = raw as T;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.apiVersion !== "v1" || value.kind !== kind ||
    !value.metadata || value.metadata.name !== expectedName || !value.metadata.resourceVersion ||
    typeof value.metadata.resourceVersion !== "string" || (namespace && value.metadata.namespace !== namespace)) return fail("KUBERNETES_RESOURCE_IDENTITY");
  uid(value.metadata.uid);
  return value;
}

/** Namespace-bound Kubernetes transport. It does not decide tenant authorization,
 * image approval, readiness, original bootstrap custody or retirement authority.
 * Mutations are single attempts: an observation error never retries a create/delete. */
export class KubernetesApiClient {
  readonly namespace: string;
  readonly apiOrigin: string;
  readonly apiCaSha256: string;
  readonly #ca: string;
  readonly #credentials: () => Credentials;
  #identity?: Readonly<KubernetesClusterIdentity>;

  private constructor(server: string, namespace: string, ca: string, credentials: () => Credentials) {
    this.apiOrigin = origin(server).origin;
    this.namespace = name(namespace);
    if (namespace.includes(".") || namespace.length > 63) throw new KubernetesRequestError("KUBERNETES_NAMESPACE");
    const certificate = new X509Certificate(ca);
    if (!certificate.ca) throw new KubernetesRequestError("KUBERNETES_CA_CERTIFICATE");
    this.#ca = ca;
    this.apiCaSha256 = createHash("sha256").update(certificate.raw).digest("hex");
    this.#credentials = credentials;
  }

  static inCluster(): KubernetesApiClient {
    const host = process.env.KUBERNETES_SERVICE_HOST, port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? "443";
    if (!host || (!isIP(host) && !NAME.test(host)) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return fail("KUBERNETES_SERVICE_ENDPOINT");
    const namespace = projectedFile("namespace", 256), ca = projectedFile("ca.crt", 64 * 1024);
    const server = "https://" + (isIP(host) === 6 ? "[" + host + "]" : host) + ":" + port;
    // Read the original projection again for every request, so short-lived
    // service-account rotation does not require copying a token into app state.
    return new KubernetesApiClient(server, namespace, ca, () => {
      if (projectedFile("namespace", 256) !== namespace || projectedFile("ca.crt", 64 * 1024) !== ca) return fail("KUBERNETES_CREDENTIAL_SCOPE_CHANGED");
      const token = projectedFile("token", 16 * 1024);
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return fail("KUBERNETES_SERVICE_TOKEN");
      return { token };
    });
  }

  /** For attended operator qualification with the existing verified kubeconfig.
   * A service cannot select this factory through a request or environment flag. */
  static operator(input: OperatorKubernetesCredentials): KubernetesApiClient {
    if (!input.cert.includes("BEGIN CERTIFICATE") || !input.key.includes("PRIVATE KEY") ||
      input.cert.length > 64 * 1024 || input.key.length > 64 * 1024) return fail("KUBERNETES_OPERATOR_CREDENTIAL");
    const { cert, key } = input;
    return new KubernetesApiClient(input.server, input.namespace, input.ca, () => ({ cert, key }));
  }

  async #request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; value: unknown }> {
    signal?.throwIfAborted();
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    if (payload && payload.length > MAX_REQUEST) return fail("KUBERNETES_REQUEST_BOUND");
    const credentials = this.#credentials();
    const url = new URL(path, this.apiOrigin);
    if (url.origin !== this.apiOrigin || !path.startsWith("/api/v1/")) return fail("KUBERNETES_REQUEST_PATH");
    return await new Promise((resolve, reject) => {
      let settled = false, bytes = 0;
      const options: RequestOptions = {
        method, ca: this.#ca, cert: credentials.cert, key: credentials.key,
        rejectUnauthorized: true, agent: false,
        headers: {
          Accept: "application/json", "Accept-Encoding": "identity",
          ...(credentials.token ? { Authorization: "Bearer " + credentials.token } : {}),
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        },
      };
      const request = httpsRequest(url, options);
      const timer = setTimeout(() => request.destroy(new KubernetesRequestError("KUBERNETES_REQUEST_TIMEOUT")), 10000);
      timer.unref();
      const abort = () => request.destroy(new KubernetesRequestError("KUBERNETES_REQUEST_ABORTED"));
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); payload?.fill(0); };
      const failed = (code: string) => { if (!settled) { settled = true; cleanup(); reject(new KubernetesRequestError(code)); } request.destroy(); };
      request.once("response", response => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE) { response.destroy(); failed("KUBERNETES_RESPONSE_BOUND"); return; }
          chunks.push(Buffer.from(chunk));
        });
        response.once("aborted", () => failed("KUBERNETES_RESPONSE_TRUNCATED"));
        response.once("error", () => failed("KUBERNETES_RESPONSE_UNKNOWN"));
        response.once("end", () => {
          if (settled) return;
          if (!response.complete) return failed("KUBERNETES_RESPONSE_TRUNCATED");
          try {
            const value = parseStrictJobJson(Buffer.concat(chunks), MAX_RESPONSE);
            settled = true; cleanup(); resolve({ status: response.statusCode ?? 500, value });
          } catch { failed("KUBERNETES_RESPONSE_INVALID"); }
        });
      });
      request.once("error", error => failed(error instanceof KubernetesRequestError ? error.code : "KUBERNETES_TRANSPORT_UNAVAILABLE"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else request.end(payload);
    });
  }

  async identify(signal?: AbortSignal): Promise<Readonly<KubernetesClusterIdentity>> {
    const response = await this.#request("GET", "/api/v1/namespaces/" + encode(this.namespace), undefined, signal);
    if (response.status !== 200) throw new KubernetesRequestError("KUBERNETES_NAMESPACE_UNAVAILABLE", response.status);
    const ns = resource<KubernetesResource>(response.value, "Namespace", this.namespace);
    const identity = Object.freeze({ namespace: this.namespace, namespaceUid: ns.metadata.uid, apiCaSha256: this.apiCaSha256, apiOrigin: this.apiOrigin });
    if (this.#identity && this.#identity.namespaceUid !== identity.namespaceUid) return fail("KUBERNETES_NAMESPACE_REPLACED");
    this.#identity = identity;
    return identity;
  }

  async pod(runtimeId: string, signal?: AbortSignal): Promise<KubernetesPod | undefined> {
    const podName = this.runtimeName(runtimeId);
    const response = await this.#request("GET", "/api/v1/namespaces/" + encode(this.namespace) + "/pods/" + podName, undefined, signal);
    if (response.status === 404) return undefined;
    if (response.status !== 200) throw new KubernetesRequestError("KUBERNETES_POD_UNAVAILABLE", response.status);
    return resource<KubernetesPod>(response.value, "Pod", podName, this.namespace);
  }

  runtimeName(runtimeId: string): string {
    uid(runtimeId);
    return "ingenium-runtime-" + runtimeId.toLowerCase().replaceAll("-", "");
  }

  async claim(claimName: string, signal?: AbortSignal): Promise<KubernetesClaim> {
    const response = await this.#request("GET", "/api/v1/namespaces/" + encode(this.namespace) + "/persistentvolumeclaims/" + encode(claimName), undefined, signal);
    if (response.status !== 200) throw new KubernetesRequestError("KUBERNETES_WORKSPACE_CLAIM_UNAVAILABLE", response.status);
    return resource<KubernetesClaim>(response.value, "PersistentVolumeClaim", claimName, this.namespace);
  }

  async node(nodeName: string, signal?: AbortSignal): Promise<KubernetesNode> {
    const response = await this.#request("GET", "/api/v1/nodes/" + encode(nodeName), undefined, signal);
    if (response.status !== 200) throw new KubernetesRequestError("KUBERNETES_NODE_UNAVAILABLE", response.status);
    return resource<KubernetesNode>(response.value, "Node", nodeName);
  }

  async createPod(runtimeId: string, spec: Record<string, unknown>, signal?: AbortSignal): Promise<KubernetesPod> {
    const podName = this.runtimeName(runtimeId), metadata = spec.metadata as Partial<KubernetesMetadata> | undefined;
    if (spec.apiVersion !== "v1" || spec.kind !== "Pod" || metadata?.name !== podName || metadata.namespace !== this.namespace ||
      metadata.uid !== undefined || metadata.resourceVersion !== undefined || metadata.deletionTimestamp !== undefined) return fail("KUBERNETES_NEW_POD_REQUIRED");
    const response = await this.#request("POST", "/api/v1/namespaces/" + encode(this.namespace) + "/pods", spec, signal);
    if (response.status !== 201) throw new KubernetesRequestError("KUBERNETES_POD_CREATE_UNCONFIRMED", response.status);
    return resource<KubernetesPod>(response.value, "Pod", podName, this.namespace);
  }

  /** New Kubernetes v5 stdin/stdout connection, bracketed by actual Pod reads.
   * It does not issue credentials or claim readiness. */
  async attachWorkspace(runtimeId: string, expected: { podUid: string; containerId: string }, signal?: AbortSignal): Promise<{
    socket: import("ws").default;
    source: Readonly<{ namespaceUid: string; apiCaSha256: string; podUid: string; containerId: string; startedAt: string; nodeName: string }>;
  }> {
    uid(expected.podUid);
    if (!/^[a-f0-9]{64}$/.test(expected.containerId)) return fail("KUBERNETES_ATTACH_CONTAINER_ID");
    const identity = await this.identify(signal), before = await this.pod(runtimeId, signal);
    const current = (pod: KubernetesPod | undefined) => {
      const statuses = pod?.status?.containerStatuses;
      const status = statuses?.length === 1 && statuses[0]?.name === "workspace" ? statuses[0] : undefined;
      if (!pod || pod.metadata.uid !== expected.podUid || pod.metadata.deletionTimestamp || !pod.spec.nodeName ||
        !status || status.containerID !== "containerd://" + expected.containerId || status.restartCount !== 0 ||
        !status.state.running?.startedAt) return fail("KUBERNETES_ATTACH_ORIGINAL_CHANGED");
      return { status, pod };
    };
    const initial = current(before), credentials = this.#credentials();
    const url = new URL("/api/v1/namespaces/" + encode(this.namespace) + "/pods/" + this.runtimeName(runtimeId) +
      "/attach?container=workspace&stdin=true&stdout=true&stderr=true&tty=false", this.apiOrigin);
    url.protocol = "wss:";
    const { default: WebSocket } = await import("ws");
    const socket = new WebSocket(url, ["v5.channel.k8s.io"], {
      ca: this.#ca, cert: credentials.cert, key: credentials.key, rejectUnauthorized: true,
      agent: false, followRedirects: false, perMessageDeflate: false, handshakeTimeout: 10000, maxPayload: 65536,
      headers: credentials.token ? { Authorization: "Bearer " + credentials.token } : {},
    });
    // Keep an error listener throughout the handoff to the retaining owner.
    socket.on("error", () => {});
    try {
      await new Promise<void>((resolve, reject) => {
        const aborted = () => { socket.terminate(); reject(new KubernetesRequestError("KUBERNETES_ATTACH_ABORTED")); };
        const clear = () => signal?.removeEventListener("abort", aborted);
        socket.once("open", () => { clear(); socket.protocol === "v5.channel.k8s.io" ? resolve() : reject(new KubernetesRequestError("KUBERNETES_ATTACH_PROTOCOL")); });
        socket.once("error", () => { clear(); reject(new KubernetesRequestError("KUBERNETES_ATTACH_UNAVAILABLE")); });
        socket.once("unexpected-response", (_request, response) => { clear(); response.destroy(); reject(new KubernetesRequestError("KUBERNETES_ATTACH_UPGRADE_REFUSED")); });
        socket.once("close", () => { clear(); reject(new KubernetesRequestError("KUBERNETES_ATTACH_CLOSED")); });
        signal?.addEventListener("abort", aborted, { once: true });
        if (signal?.aborted) aborted();
      });
      const final = current(await this.pod(runtimeId, signal));
      const afterIdentity = await this.identify(signal);
      if (afterIdentity.namespaceUid !== identity.namespaceUid || final.pod.spec.nodeName !== initial.pod.spec.nodeName ||
        final.status.state.running?.startedAt !== initial.status.state.running?.startedAt || socket.readyState !== WebSocket.OPEN) return fail("KUBERNETES_ATTACH_ORIGINAL_CHANGED");
      return {
        socket,
        source: Object.freeze({ namespaceUid: identity.namespaceUid, apiCaSha256: identity.apiCaSha256,
          podUid: expected.podUid, containerId: expected.containerId,
          startedAt: final.status.state.running!.startedAt, nodeName: final.pod.spec.nodeName! }),
      };
    } catch (cause) { socket.terminate(); throw cause; }
  }

  async deletePod(runtimeId: string, expected: { uid: string; resourceVersion: string }, signal?: AbortSignal): Promise<void> {
    uid(expected.uid);
    if (!/^\d+$/.test(expected.resourceVersion)) return fail("KUBERNETES_DELETE_PRECONDITION");
    const response = await this.#request("DELETE", "/api/v1/namespaces/" + encode(this.namespace) + "/pods/" + this.runtimeName(runtimeId),
      { apiVersion: "v1", kind: "DeleteOptions", gracePeriodSeconds: 30, propagationPolicy: "Foreground", preconditions: expected }, signal);
    if (response.status !== 200 && response.status !== 202) throw new KubernetesRequestError("KUBERNETES_POD_DELETE_UNCONFIRMED", response.status);
    // Accepted deletion is deliberately not a stopped/retired witness.
  }
}
