import { request as httpsRequest, type RequestOptions } from "node:https";
import { readFileSync, statSync, realpathSync } from "node:fs";
import { createHash, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { parseStrictJobJson } from "../dot-v2/job-bootstrap-frame.mjs";
import { WORKSPACE_V2_ARTIFACTS, type WorkspaceV2File } from "../projects-v2/workspace-v2-image.mjs";

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
  finalizers?: string[];
  ownerReferences?: unknown[];
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
    images?: Array<{names?:string[];sizeBytes?:number}>;
    nodeInfo?: { bootID: string; kernelVersion: string; containerRuntimeVersion: string; kubeletVersion: string };
  };
}
export interface KubernetesRuntimeClass extends KubernetesResource {
  apiVersion:"node.k8s.io/v1";kind:"RuntimeClass";handler:string;
  overhead?:unknown;scheduling?:unknown;
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

/** AtomicWriter's mount root can be 1777 even though the container's bind mount
 * is read-only. Trust that exception only at this exact kernel-reported tmpfs
 * mount; an ordinary writable directory is never an acceptable token owner. */
function readOnlyProjectedMount(base: string): boolean {
  const text = readFileSync("/proc/self/mountinfo", "utf8");
  if (Buffer.byteLength(text) > 1024 * 1024) return false;
  return text.split("\n").some(line => {
    const parts = line.split(" - ");
    if (parts.length !== 2) return false;
    const fields = parts[0]!.split(" ");
    const mount = fields[4]?.replace(/\\([0-7]{3})/g, (_all, octal: string) => String.fromCharCode(parseInt(octal, 8)));
    return mount === base && fields[5]?.split(",").includes("ro") === true && parts[1]!.split(" ")[0] === "tmpfs";
  });
}

/** Bounded descriptor input from the fixed, read-only Kubernetes projected volume.
 * Token rotation can change the projection target; it cannot escape that volume. */
function projectedFile(file: string, maximum: number): string {
  if (!["token", "ca.crt", "namespace"].includes(file)) return fail("KUBERNETES_CREDENTIAL_PATH");
  const base = realpathSync(PROJECTED), root = statSync(base);
  if (!root.isDirectory() || root.uid !== 0 || ((root.mode & 0o022) !== 0 && !readOnlyProjectedMount(base))) return fail("KUBERNETES_CREDENTIAL_DIRECTORY");
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

function resource<T extends KubernetesResource>(raw: unknown, kind: string, expectedName: string, namespace?: string,apiVersion="v1",typedListItem=false): T {
  const value = raw as T;
  if (!value || typeof value !== "object" || Array.isArray(value) || (value.apiVersion !== apiVersion && !(typedListItem && value.apiVersion === undefined)) ||
    (value.kind !== kind && !(typedListItem && value.kind === undefined)) ||
    !value.metadata || typeof value.metadata.name !== "string" || !NAME.test(value.metadata.name) || value.metadata.name !== expectedName || !value.metadata.resourceVersion ||
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

  async #request(method: "GET" | "POST" | "DELETE" | "PATCH", path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; value: unknown }> {
    signal?.throwIfAborted();
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    if (payload && payload.length > MAX_REQUEST) return fail("KUBERNETES_REQUEST_BOUND");
    const credentials = this.#credentials();
    const url = new URL(path, this.apiOrigin);
    const runtimeClassPrefix = "/apis/node.k8s.io/v1/runtimeclasses/";
    const runtimeClassRead = method === "GET" && path.startsWith(runtimeClassPrefix) && NAME.test(path.slice(runtimeClassPrefix.length));
    if (url.origin !== this.apiOrigin || (!path.startsWith("/api/v1/") && !runtimeClassRead)) return fail("KUBERNETES_REQUEST_PATH");
    return await new Promise((resolve, reject) => {
      let settled = false, bytes = 0;
      const options: RequestOptions = {
        method, ca: this.#ca, cert: credentials.cert, key: credentials.key,
        rejectUnauthorized: true, agent: false,
        headers: {
          Accept: "application/json", "Accept-Encoding": "identity",
          ...(credentials.token ? { Authorization: "Bearer " + credentials.token } : {}),
          ...(payload ? { "Content-Type": method === "PATCH" ? "application/json-patch+json" : "application/json", "Content-Length": payload.length } : {}),
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

  /** Includes unlabelled claim users, so a label cannot hide a conflicting
   * workspace mount. The namespace list is complete and bounded or refused. */
  async claimPods(claimName: string, signal?: AbortSignal): Promise<KubernetesPod[]> {
    name(claimName);
    const response=await this.#request("GET","/api/v1/namespaces/"+encode(this.namespace)+"/pods?limit=513",undefined,signal);
    const list=response.value as {apiVersion?:unknown;kind?:unknown;metadata?:{resourceVersion?:unknown;continue?:unknown};items?:unknown};
    if(response.status!==200||list?.apiVersion!=="v1"||list.kind!=="PodList"||typeof list.metadata?.resourceVersion!=="string"||!list.metadata.resourceVersion||list.metadata.continue||!Array.isArray(list.items)||list.items.length>512)return fail("KUBERNETES_CLAIM_POD_LIST_UNAVAILABLE");
    return list.items.map(value=>{
      const pod=value as KubernetesPod;
      // Typed list items inherit only the envelope type; retain each actual item's identity.
      return resource<KubernetesPod>(value,"Pod",pod?.metadata?.name,this.namespace,"v1",true);
    }).filter(pod=>Array.isArray(pod.spec.volumes)&&pod.spec.volumes.some(raw=>(raw as {persistentVolumeClaim?:{claimName?:unknown}})?.persistentVolumeClaim?.claimName===claimName));
  }

  async node(nodeName: string, signal?: AbortSignal): Promise<KubernetesNode> {
    const response = await this.#request("GET", "/api/v1/nodes/" + encode(nodeName), undefined, signal);
    if (response.status !== 200) throw new KubernetesRequestError("KUBERNETES_NODE_UNAVAILABLE", response.status);
    return resource<KubernetesNode>(response.value, "Node", nodeName);
  }

  async runtimeClass(className:string,signal?:AbortSignal):Promise<KubernetesRuntimeClass>{
    const response=await this.#request("GET","/apis/node.k8s.io/v1/runtimeclasses/"+encode(className),undefined,signal);
    if(response.status!==200)throw new KubernetesRequestError("KUBERNETES_RUNTIME_CLASS_UNAVAILABLE",response.status);
    return resource<KubernetesRuntimeClass>(response.value,"RuntimeClass",className,undefined,"node.k8s.io/v1");
  }

  async createPod(runtimeId: string, spec: Record<string, unknown>, signal?: AbortSignal): Promise<KubernetesPod> {
    const podName = this.runtimeName(runtimeId), metadata = spec.metadata as Partial<KubernetesMetadata> | undefined;
    if (spec.apiVersion !== "v1" || spec.kind !== "Pod" || metadata?.name !== podName || metadata.namespace !== this.namespace ||
      metadata.uid !== undefined || metadata.resourceVersion !== undefined || metadata.deletionTimestamp !== undefined) return fail("KUBERNETES_NEW_POD_REQUIRED");
    const response = await this.#request("POST", "/api/v1/namespaces/" + encode(this.namespace) + "/pods", spec, signal);
    if (response.status !== 201) throw new KubernetesRequestError("KUBERNETES_POD_CREATE_UNCONFIRMED", response.status);
    return resource<KubernetesPod>(response.value, "Pod", podName, this.namespace);
  }

  async #workspaceStream(runtimeId: string, operation: "attach" | "exec", command: readonly string[], signal?: AbortSignal): Promise<import("ws").default> {
    const credentials = this.#credentials();
    const url = new URL("/api/v1/namespaces/" + encode(this.namespace) + "/pods/" + this.runtimeName(runtimeId) + "/" + operation, this.apiOrigin);
    url.protocol = "wss:";
    for (const [key,value] of Object.entries({container:"workspace",stdin:operation === "attach" ? "true" : "false",stdout:"true",stderr:"true",tty:"false"})) url.searchParams.set(key,value);
    for (const value of command) url.searchParams.append("command",value);
    const { default: WebSocket } = await import("ws");
    const socket = new WebSocket(url, ["v5.channel.k8s.io"], {
      ca: this.#ca, cert: credentials.cert, key: credentials.key, rejectUnauthorized: true,
      agent: false, followRedirects: false, perMessageDeflate: false, handshakeTimeout: 10000, maxPayload: 65536,
      headers: credentials.token ? { Authorization: "Bearer " + credentials.token } : {},
    });
    socket.on("error", () => {});
    try {
      await new Promise<void>((resolve, reject) => {
        const aborted = () => { socket.terminate(); reject(new KubernetesRequestError("KUBERNETES_STREAM_ABORTED")); };
        const clear = () => signal?.removeEventListener("abort", aborted);
        socket.once("open", () => { clear(); socket.protocol === "v5.channel.k8s.io" ? resolve() : reject(new KubernetesRequestError("KUBERNETES_STREAM_PROTOCOL")); });
        socket.once("error", () => { clear(); reject(new KubernetesRequestError("KUBERNETES_STREAM_UNAVAILABLE")); });
        socket.once("unexpected-response", (_request, response) => { clear(); response.destroy(); reject(new KubernetesRequestError("KUBERNETES_STREAM_UPGRADE_REFUSED")); });
        socket.once("close", () => { clear(); reject(new KubernetesRequestError("KUBERNETES_STREAM_CLOSED")); });
        signal?.addEventListener("abort", aborted, { once: true });
        if (signal?.aborted) aborted();
      });
      return socket;
    } catch (cause) { socket.terminate(); throw cause; }
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
    const initial = current(before), socket = await this.#workspaceStream(runtimeId,"attach",[],signal);
    try {
      const final = current(await this.pod(runtimeId, signal));
      const afterIdentity = await this.identify(signal);
      if (afterIdentity.namespaceUid !== identity.namespaceUid || final.pod.spec.nodeName !== initial.pod.spec.nodeName ||
        final.status.state.running?.startedAt !== initial.status.state.running?.startedAt || socket.readyState !== 1) return fail("KUBERNETES_ATTACH_ORIGINAL_CHANGED");
      return {
        socket,
        source: Object.freeze({ namespaceUid: identity.namespaceUid, apiCaSha256: identity.apiCaSha256,
          podUid: expected.podUid, containerId: expected.containerId,
          startedAt: final.status.state.running!.startedAt, nodeName: final.pod.spec.nodeName! }),
      };
    } catch (cause) { socket.terminate(); throw cause; }
  }

  /** Fixed read-only image measurement, never a browser/agent exec endpoint.
   * Only the canonical immutable runtime artifacts may be read; paths, commands,
   * filesystem content and credentials are never accepted from a public request. */
  async measureWorkspaceImageArtifacts(runtimeId: string, expected: {podUid:string;containerId:string;startedAt:string}, files: readonly WorkspaceV2File[], signal?: AbortSignal): Promise<Array<{path:string;sha256:string;bytes:number}>> {
    if (files.length !== WORKSPACE_V2_ARTIFACTS.length || new Set(files.map(file=>file.path)).size !== files.length ||
      WORKSPACE_V2_ARTIFACTS.some(path=>!files.some(file=>file.path === path))) return fail("KUBERNETES_IMAGE_ARTIFACT_SET");
    const identity = await this.identify(signal);
    const current = (pod: KubernetesPod | undefined) => {
      const statuses = pod?.status?.containerStatuses, container = statuses?.length === 1 && statuses[0]?.name === "workspace" ? statuses[0] : undefined;
      if (!pod || pod.metadata.uid !== expected.podUid || pod.metadata.deletionTimestamp || !pod.spec.nodeName ||
        container?.containerID !== "containerd://"+expected.containerId || container.restartCount !== 0 ||
        container.state.running?.startedAt !== expected.startedAt) return fail("KUBERNETES_IMAGE_ORIGINAL_CHANGED");
      return pod;
    };
    const before = current(await this.pod(runtimeId,signal));
    const program = "import fs from 'node:fs';import{createHash}from'node:crypto';const paths="+JSON.stringify(WORKSPACE_V2_ARTIFACTS)+";let total=0;const rows=paths.map(path=>{if(fs.realpathSync(path)!==path)throw Error('artifact');const named=fs.lstatSync(path),fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const a=fs.fstatSync(fd);if(!a.isFile()||a.uid!==0||a.gid!==0||a.nlink!==1||(a.mode&0o022)||a.size<1||a.size>4194304||a.dev!==named.dev||a.ino!==named.ino||(total+=a.size)>16777216)throw Error('artifact');const bytes=fs.readFileSync(fd),b=fs.fstatSync(fd),c=fs.lstatSync(path);if(bytes.length!==a.size||[b,c].some(s=>['dev','ino','size','mtimeMs','ctimeMs'].some(k=>s[k]!==a[k]))||fs.realpathSync(path)!==path)throw Error('artifact');return {path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,uid:a.uid,gid:a.gid,mode:a.mode&0o7777,kind:'file'}}finally{fs.closeSync(fd)}});process.stdout.write(JSON.stringify(rows)+'\\n');";
    const socket = await this.#workspaceStream(runtimeId,"exec",["/usr/local/bin/node","--input-type=module","--eval",program],signal);
    let stdout = Buffer.alloc(0);
    try {
      const raw = await new Promise<unknown>((resolve,reject)=>{
        let settled = false, exited = false;
        const done = (cause?: Error) => {
          if (settled) return;
          if (!cause && (!exited || stdout.at(-1) !== 10)) return;
          settled = true;clearTimeout(timer);signal?.removeEventListener("abort",aborted);
          if (cause) reject(cause);
          else { try { resolve(parseStrictJobJson(stdout,16384)); } catch { reject(new KubernetesRequestError("KUBERNETES_IMAGE_ARTIFACT_RESPONSE")); } }
        };
        const aborted = () => done(new KubernetesRequestError("KUBERNETES_IMAGE_ARTIFACT_ABORTED"));
        const timer = setTimeout(()=>done(new KubernetesRequestError("KUBERNETES_IMAGE_ARTIFACT_TIMEOUT")),10000);timer.unref();
        signal?.addEventListener("abort",aborted,{once:true});
        socket.on("message",(data,binary)=>{
          const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          if (!binary || frame.length < 1) return done(new KubernetesRequestError("KUBERNETES_IMAGE_ARTIFACT_CHANNEL"));
          const channel = frame[0], body = frame.subarray(1);
          if (channel === 1) {
            if (stdout.length+body.length > 16384) return done(new KubernetesRequestError("KUBERNETES_IMAGE_ARTIFACT_BOUND"));
            stdout = Buffer.concat([stdout,body]);done();
          } else if (channel === 3) {
            try { if ((parseStrictJobJson(body,4096) as {status?:string})?.status !== "Success") return done(new KubernetesRequestError("KUBERNETES_IMAGE_ARTIFACT_EXEC_FAILED")); }
            catch { return done(new KubernetesRequestError("KUBERNETES_IMAGE_ARTIFACT_STATUS")); }
            exited = true;done();
          } else if (channel !== 255 || body.length !== 1 || ![1,2].includes(body[0]!)) return done(new KubernetesRequestError("KUBERNETES_IMAGE_ARTIFACT_CHANNEL"));
        });
        socket.once("error",()=>done(new KubernetesRequestError("KUBERNETES_IMAGE_ARTIFACT_STREAM")));
        socket.once("close",()=>done(new KubernetesRequestError("KUBERNETES_IMAGE_ARTIFACT_CLOSED")));
        if (signal?.aborted) aborted();
      });
      if (!Array.isArray(raw) || raw.length !== files.length || new Set(raw.map(row=>row?.path)).size !== files.length || files.some(file=>!raw.some(row=>row && Object.keys(row).sort().join("|") === "bytes|gid|kind|mode|path|sha256|uid" && ["path","sha256","bytes","uid","gid","mode","kind"].every(key=>row[key] === file[key as keyof WorkspaceV2File])))) return fail("KUBERNETES_IMAGE_ARTIFACT_MISMATCH");
      const after = current(await this.pod(runtimeId,signal)), finalIdentity = await this.identify(signal);
      if (after.spec.nodeName !== before.spec.nodeName || finalIdentity.namespaceUid !== identity.namespaceUid) return fail("KUBERNETES_IMAGE_ORIGINAL_CHANGED");
      return files.map(({path,sha256,bytes})=>({path,sha256,bytes}));
    } finally { stdout.fill(0);socket.terminate(); }
  }

  async deletePod(runtimeId: string, expected: { uid: string; resourceVersion: string }, signal?: AbortSignal): Promise<void> {
    uid(expected.uid);
    if (!/^\d+$/.test(expected.resourceVersion)) return fail("KUBERNETES_DELETE_PRECONDITION");
    const response = await this.#request("DELETE", "/api/v1/namespaces/" + encode(this.namespace) + "/pods/" + this.runtimeName(runtimeId),
      { apiVersion: "v1", kind: "DeleteOptions", gracePeriodSeconds: 30, propagationPolicy: "Foreground", preconditions: expected }, signal);
    if (response.status !== 200 && response.status !== 202) throw new KubernetesRequestError("KUBERNETES_POD_DELETE_UNCONFIRMED", response.status);
    // Accepted deletion is deliberately not a stopped/retired witness.
  }

  /** Remove only our original retirement finalizer, after the lifecycle owner
   * has observed termination. Optimistic tests prevent changing another Pod or
   * removing a finalizer added by a different controller. */
  async finishPodRetirement(runtimeId: string, observed: KubernetesPod, signal?: AbortSignal): Promise<void> {
    const { metadata } = observed, finalizer = "ingenium.io/runtime-retirement";
    uid(metadata.uid);
    if (metadata.name !== this.runtimeName(runtimeId) || metadata.namespace !== this.namespace ||
      !/^\d+$/.test(metadata.resourceVersion) || !metadata.deletionTimestamp ||
      !Array.isArray(metadata.finalizers) || metadata.finalizers.filter(value => value === finalizer).length !== 1) return fail("KUBERNETES_RETIREMENT_FINALIZER");
    const response = await this.#request("PATCH", "/api/v1/namespaces/" + encode(this.namespace) + "/pods/" + this.runtimeName(runtimeId), [
      { op: "test", path: "/metadata/uid", value: metadata.uid },
      { op: "test", path: "/metadata/resourceVersion", value: metadata.resourceVersion },
      { op: "test", path: "/metadata/deletionTimestamp", value: metadata.deletionTimestamp },
      { op: "test", path: "/metadata/finalizers", value: metadata.finalizers },
      { op: "remove", path: "/metadata/finalizers/" + metadata.finalizers.indexOf(finalizer) },
    ], signal);
    if (response.status !== 200) throw new KubernetesRequestError("KUBERNETES_RETIREMENT_FINALIZER_UNCONFIRMED", response.status);
  }
}
