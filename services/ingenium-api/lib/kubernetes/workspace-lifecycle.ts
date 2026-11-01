import { setTimeout as pause } from "node:timers/promises";
import { publicWorkspaceProvisionRequest, provisionHash, decodeWorkspaceRuntimeOriginalProvision,
  type PublicWorkspaceProvisionRequest, type KubernetesWorkspaceRuntimeOriginalProvision } from "ingenium-core/lib/tools/runtime-original-provision";
import { KubernetesApiClient, type KubernetesPod, type KubernetesClusterIdentity, type KubernetesNode } from "./api-client.js";
import { planKubernetesWorkspacePod, type KubernetesWorkspaceMapping, type KubernetesNodePidPolicy,
  type KubernetesWorkspaceImage, type KubernetesWorkspacePodPlan } from "./workspace-pod.js";
import { joinKubernetesWorkspaceAttach, requireRetainedKubernetesWorkspaceAttach, joinStoppedKubernetesWorkspaceAttach } from "./workspace-wire.js";

const fail = (code: string): never => { throw Object.assign(new Error(code), { code, status: 503 }); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("KUBERNETES_ORIGINAL_PROFILE");
  return value as Record<string, unknown>;
};
const equal = (a: unknown, b: unknown) => provisionHash(a) === provisionHash(b);
const stamp = (value: unknown): value is string => typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
const FINALIZER = "ingenium.io/runtime-retirement";

/** Compare API quantity spellings losslessly; hash the observed raw profile. */
function quantity(value: unknown): [bigint, bigint] {
  if (typeof value !== "string") return fail("KUBERNETES_PROFILE_QUANTITY");
  const match = /^(\d+)(?:\.(\d{1,9}))?(Ki|Mi|Gi|Ti|Pi|m|u|n|k|M|G|T|P)?$/.exec(value);
  if (!match) return fail("KUBERNETES_PROFILE_QUANTITY");
  const fraction = match[2] ?? "", unit = match[3] ?? "";
  const scales: Record<string, bigint> = { Ki: 1024n, Mi: 1024n ** 2n, Gi: 1024n ** 3n, Ti: 1024n ** 4n, Pi: 1024n ** 5n,
    k: 1000n, M: 1000n ** 2n, G: 1000n ** 3n, T: 1000n ** 4n, P: 1000n ** 5n };
  const divisors: Record<string, bigint> = { m: 1000n, u: 1000000n, n: 1000000000n };
  return [BigInt(match[1] + fraction) * (scales[unit] ?? 1n), 10n ** BigInt(fraction.length) * (divisors[unit] ?? 1n)];
}
function defaultTolerations(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  return ["node.kubernetes.io/not-ready", "node.kubernetes.io/unreachable"].every(key => value.some(raw => {
    const v = object(raw);
    return Object.keys(v).sort().join("|") === "effect|key|operator|tolerationSeconds" && v.key === key &&
      v.operator === "Exists" && v.effect === "NoExecute" && v.tolerationSeconds === 300;
  }));
}
function profileMatches(expected: unknown, actual: unknown, at: string, nodeName: string): void {
  if (/\/resources\/(?:limits|requests)\/(?:cpu|memory)$|\/volumes\/\d+\/emptyDir\/sizeLimit$/.test(at)) {
    const [a,b] = quantity(expected), [c,d] = quantity(actual);
    if (a * d !== c * b) return fail("KUBERNETES_ORIGINAL_RESOURCE_DRIFT");
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return fail("KUBERNETES_ORIGINAL_PROFILE");
    expected.forEach((item,index) => profileMatches(item,actual[index],at+"/"+index,nodeName));return;
  }
  if (expected && typeof expected === "object") {
    const want = object(expected), got = object(actual);
    for (const [key,value] of Object.entries(want)) profileMatches(value,got[key],at+"/"+key,nodeName);
    for (const [key,value] of Object.entries(got)) {
      if (Object.hasOwn(want,key)) continue;
      if (at === "/spec" && ((key === "nodeName" && value === nodeName) || (key === "preemptionPolicy" && value === "PreemptLowerPriority") ||
        (key === "priority" && value === 0) || (key === "serviceAccount" && value === "default") ||
        (key === "hostUsers" && value === true) || (key === "tolerations" && defaultTolerations(value)))) continue;
      if (at === "/spec/containers/0" && ((key === "terminationMessagePath" && value === "/dev/termination-log") ||
        (key === "terminationMessagePolicy" && value === "File"))) continue;
      if (/^\/spec\/containers\/0\/(startupProbe|readinessProbe)$/.test(at) && key === "successThreshold" && value === 1) continue;
      if (/^\/spec\/containers\/0\/(startupProbe|readinessProbe)\/tcpSocket$/.test(at) && key === "host" && value === "") continue;
      return fail("KUBERNETES_ORIGINAL_UNREQUESTED_PROFILE_FIELD");
    }
    return;
  }
  if (actual !== expected) return fail("KUBERNETES_ORIGINAL_PROFILE");
}

interface Original {
  client: KubernetesApiClient; request: PublicWorkspaceProvisionRequest;
  mapping: KubernetesWorkspaceMapping; nodePidPolicy: KubernetesNodePidPolicy; image: KubernetesWorkspaceImage; apiUrl: string;
  plan?: KubernetesWorkspacePodPlan; created?: KubernetesPod; original?: KubernetesWorkspaceRuntimeOriginalProvision;
  state: "creating" | "starting" | "stopping" | "stopped" | "unknown";
}
const originals = new Map<string, Original>();
function running(state: Original, pod: KubernetesPod, node: KubernetesNode, identity: KubernetesClusterIdentity): {containerId:string;startedAt:string} {
  const { request, plan, created } = state;
  if (!plan || !created || pod.metadata.uid !== created.metadata.uid || pod.metadata.name !== request.backendName ||
    pod.metadata.namespace !== identity.namespace || identity.namespaceUid !== plan.namespaceUid ||
    pod.metadata.deletionTimestamp || pod.metadata.ownerReferences?.length || !equal(pod.metadata.finalizers,[FINALIZER]) ||
    !stamp(pod.metadata.creationTimestamp) || !node.status?.nodeInfo || pod.spec.nodeName !== node.metadata.name ||
    node.metadata.uid !== plan.nodeUid || node.status.nodeInfo.bootID !== state.nodePidPolicy.nodeBootId) return fail("KUBERNETES_ORIGINAL_CHANGED");
  const requested = object(plan.pod.metadata);
  for (const category of ["labels","annotations"] as const) {
    const expected = object(requested[category]), actual = pod.metadata[category] ?? {};
    if (Object.entries(expected).some(([key,value]) => actual[key] !== value)) return fail("KUBERNETES_ORIGINAL_SCOPE");
  }
  if (pod.metadata.labels?.["com.ingenium.runtime.project"] !== undefined) return fail("KUBERNETES_ORIGINAL_SCOPE");
  profileMatches(plan.pod.spec,pod.spec,"/spec",node.metadata.name);
  const statuses = pod.status?.containerStatuses;
  const container = statuses?.length === 1 && statuses[0]?.name === "workspace" ? statuses[0] : undefined;
  const startedAt = container?.state.running?.startedAt, containerId = container?.containerID;
  if (!container || !stamp(startedAt) || Date.parse(startedAt) < Date.parse(pod.metadata.creationTimestamp) ||
    container.restartCount !== 0 || typeof containerId !== "string" || !/^containerd:\/\/[a-f0-9]{64}$/.test(containerId) ||
    ![plan.pullReference,plan.imageId,"docker-pullable://"+plan.pullReference].includes(container.imageID)) return fail("KUBERNETES_ORIGINAL_CONTAINER");
  return {containerId:containerId.slice("containerd://".length),startedAt};
}
async function recheck(state: Original, signal?: AbortSignal) {
  const identity = await state.client.identify(signal), node = await state.client.node(state.nodePidPolicy.nodeName,signal);
  const claim = await state.client.claim(state.mapping.claimName,signal);
  const plan = planKubernetesWorkspacePod({request:state.request,mapping:state.mapping,identity,node,claim,
    nodePidPolicy:state.nodePidPolicy,image:state.image,apiUrl:state.apiUrl});
  if (state.plan && !equal(state.plan,plan)) return fail("KUBERNETES_ORIGINAL_CONFIGURATION_CHANGED");
  return {identity,node,plan};
}

/** Own the actual create/start/attach sequence. No supplied Pod/ACK/current
 * labels can substitute for this original connection. Returns STARTING metadata,
 * never image qualification, READY, workspace authorization or a Core write. */
export async function provisionKubernetesWorkspace(client: KubernetesApiClient, input: {
  request: PublicWorkspaceProvisionRequest; mapping: KubernetesWorkspaceMapping; nodePidPolicy: KubernetesNodePidPolicy;
  image: KubernetesWorkspaceImage; apiUrl: string; capability: string; capabilityExpiresAt: string;
  bootstrapNonce: string; credentialId: string; signal?: AbortSignal;
}): Promise<KubernetesWorkspaceRuntimeOriginalProvision> {
  const request = publicWorkspaceProvisionRequest(input.request), {runtimeId} = request;
  if (!(client instanceof KubernetesApiClient) || originals.has(runtimeId) || originals.size >= 1024 ||
    !/^[a-f0-9]{64}$/.test(input.bootstrapNonce) || !/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(input.capability) ||
    !stamp(input.capabilityExpiresAt) || Date.parse(input.capabilityExpiresAt) <= Date.now()+45000 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.credentialId)) return fail("KUBERNETES_ORIGINAL_PROVISION_INPUT");
  const state: Original = {client,request,mapping:structuredClone(input.mapping),nodePidPolicy:structuredClone(input.nodePidPolicy),
    image:structuredClone(input.image),apiUrl:input.apiUrl,state:"creating"};
  originals.set(runtimeId,state);
  try {
    const initial = await recheck(state,input.signal);state.plan = initial.plan;
    state.created = await client.createPod(runtimeId,state.plan.pod,input.signal);
    const deadline = Math.min(Date.now()+40000,Date.parse(input.capabilityExpiresAt));let pod: KubernetesPod | undefined;
    while (Date.now() < deadline) {
      input.signal?.throwIfAborted();pod = await client.pod(runtimeId,input.signal);
      if (!pod || pod.metadata.uid !== state.created.metadata.uid || pod.metadata.deletionTimestamp || ["Failed","Succeeded"].includes(pod.status?.phase ?? "")) return fail("KUBERNETES_ORIGINAL_START_FAILED");
      if (pod.status?.containerStatuses?.[0]?.state.running) break;
      await pause(250,undefined,{signal:input.signal});
    }
    if (!pod?.status?.containerStatuses?.[0]?.state.running) return fail("KUBERNETES_ORIGINAL_START_TIMEOUT");
    const observed = running(state,pod,initial.node,initial.identity);
    const startIdentity = provisionHash([pod.metadata.uid,observed.containerId,observed.startedAt,0]);
    await joinKubernetesWorkspaceAttach(client,input.capability,{nonce:input.bootstrapNonce,runtimeId,workspaceId:request.workspaceId,
      credentialId:input.credentialId,bindingHash:request.storageMappingHash,bindingEpoch:request.securityEpoch,startIdentity,
      requestId:request.originalRequestId,podUid:pod.metadata.uid,containerId:observed.containerId},input.signal);
    const final = await recheck(state,input.signal), current = await client.pod(runtimeId,input.signal);
    if (!current) return fail("KUBERNETES_ORIGINAL_CHANGED");
    const container = running(state,current,final.node,final.identity), attachment = requireRetainedKubernetesWorkspaceAttach(runtimeId);
    if (!equal(container,observed) || attachment.source.podUid !== current.metadata.uid || attachment.source.containerId !== observed.containerId ||
      attachment.source.namespaceUid !== final.identity.namespaceUid || attachment.source.apiCaSha256 !== final.identity.apiCaSha256 ||
      attachment.source.nodeName !== final.node.metadata.name || attachment.source.startedAt !== observed.startedAt || attachment.ack.startIdentity !== startIdentity) return fail("KUBERNETES_ORIGINAL_ATTACH_CHANGED");
    const daemonId = "kubernetes-api:"+provisionHash(["veyra-kubernetes-api-v1",final.identity.namespaceUid,final.identity.apiCaSha256]);
    const original = decodeWorkspaceRuntimeOriginalProvision({schemaVersion:2,scopeKind:"workspace",projectId:null,
      kind:"original-kubernetes-workspace-runtime-provision-v1",backendKind:"kubernetes",requestId:request.originalRequestId,
      requestSha256:provisionHash(request),runtimeId,parentContainerId:container.containerId,daemonId,
      hostId:"kubernetes-node:"+provisionHash(["veyra-kubernetes-node-v1",daemonId,final.node.metadata.uid,state.nodePidPolicy.nodeBootId]),
      imageId:state.image.imageId,startIdentity,publicProfileSha256:provisionHash(current.spec),specSha256:state.plan.specSha256,
      workspaceId:request.workspaceId,organizationId:request.organizationId,ownerUserId:request.ownerUserId,bindingHash:request.storageMappingHash,
      bindingEpoch:request.securityEpoch,provisioningRevision:request.revision,limits:request.limits,containerCreatedAt:current.metadata.creationTimestamp,
      kubernetes:{schemaVersion:1,namespace:final.identity.namespace,namespaceUid:final.identity.namespaceUid,apiCaSha256:final.identity.apiCaSha256,
        podName:current.metadata.name,podUid:current.metadata.uid,containerId:container.containerId,nodeName:final.node.metadata.name,
        nodeUid:final.node.metadata.uid,nodeBootId:state.nodePidPolicy.nodeBootId,startedAt:container.startedAt,claimName:state.mapping.claimName,
        claimUid:state.mapping.claimUid,pullReference:state.image.pullReference,enforcedPodPidsLimit:state.nodePidPolicy.podPidsLimit,
        nodePidPolicySha256:state.nodePidPolicy.configurationSha256}});
    if (original.backendKind !== "kubernetes") return fail("KUBERNETES_ORIGINAL_BACKEND");
    state.original = original;state.state = "starting";return original;
  } catch (cause) { state.state = "unknown";throw cause; }
}

/** Fresh observation remains linked to the retained original, not adoption. The
 * manager must additionally qualify the immutable image's files before READY. */
export async function inspectKubernetesWorkspaceOriginal(runtimeId: string, signal?: AbortSignal) {
  const state = originals.get(runtimeId);
  if (!state?.original || state.state !== "starting") return fail("KUBERNETES_ORIGINAL_UNAVAILABLE");
  const facts = await recheck(state,signal), pod = await state.client.pod(runtimeId,signal);
  if (!pod) return fail("KUBERNETES_ORIGINAL_CHANGED");
  const container = running(state,pod,facts.node,facts.identity), retained = requireRetainedKubernetesWorkspaceAttach(runtimeId), original = state.original;
  if (container.containerId !== original.parentContainerId || container.startedAt !== original.kubernetes.startedAt ||
    retained.source.podUid !== pod.metadata.uid || retained.ack.startIdentity !== original.startIdentity ||
    provisionHash(pod.spec) !== original.publicProfileSha256) return fail("KUBERNETES_ORIGINAL_CHANGED");
  const ready = pod.status?.phase === "Running" && pod.status.containerStatuses?.[0]?.ready === true &&
    pod.status.conditions?.some(condition => condition.type === "Ready" && condition.status === "True") === true;
  return {original,pod,ready};
}

/** Retain the API object until this same original CRI container reports a
 * terminal state on the original healthy node. A 404/Failed phase is insufficient. */
export async function retireKubernetesWorkspaceOriginal(runtimeId: string, signal?: AbortSignal) {
  const state = originals.get(runtimeId);
  if (!state?.original || !["starting","stopping"].includes(state.state)) return fail("KUBERNETES_RETIREMENT_ORIGINAL_UNAVAILABLE");
  const original = state.original, k = original.kubernetes;
  let pod = await state.client.pod(runtimeId,signal);
  if (!pod || pod.metadata.uid !== k.podUid || pod.spec.nodeName !== k.nodeName) return fail("KUBERNETES_RETIREMENT_ORIGINAL_CHANGED");
  state.state = "stopping";
  if (!pod.metadata.deletionTimestamp) await state.client.deletePod(runtimeId,{uid:pod.metadata.uid,resourceVersion:pod.metadata.resourceVersion},signal);
  const deadline = Date.now()+35000;let finishedAt: string | undefined;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();pod = await state.client.pod(runtimeId,signal);
    if (!pod || pod.metadata.uid !== k.podUid || pod.spec.nodeName !== k.nodeName || !pod.metadata.finalizers?.includes(FINALIZER)) return fail("KUBERNETES_RETIREMENT_UNCONFIRMED");
    const statuses = pod.status?.containerStatuses, container = statuses?.length === 1 && statuses[0]?.name === "workspace" ? statuses[0] : undefined;
    const terminated = container?.state.terminated;
    if (terminated) {
      const node = await state.client.node(k.nodeName,signal), identity = await state.client.identify(signal);
      if (node.metadata.uid !== k.nodeUid || node.status?.nodeInfo?.bootID !== k.nodeBootId ||
        !node.status.conditions?.some(condition => condition.type === "Ready" && condition.status === "True") ||
        identity.namespaceUid !== k.namespaceUid || identity.apiCaSha256 !== k.apiCaSha256 ||
        container?.restartCount !== 0 || container.containerID !== "containerd://"+k.containerId ||
        terminated.containerID !== "containerd://"+k.containerId || terminated.startedAt !== k.startedAt ||
        !stamp(terminated.finishedAt) || Date.parse(terminated.finishedAt) < Date.parse(k.startedAt) ||
        !Number.isSafeInteger(terminated.exitCode) || !["Failed","Succeeded"].includes(pod.status?.phase ?? "")) return fail("KUBERNETES_RETIREMENT_TERMINATION_CHANGED");
      finishedAt = terminated.finishedAt;break;
    }
    await pause(250,undefined,{signal});
  }
  if (!finishedAt || !pod) return fail("KUBERNETES_RETIREMENT_TIMEOUT");
  await joinStoppedKubernetesWorkspaceAttach(runtimeId,k.podUid);
  const observedAt = Date.now();
  await state.client.finishPodRetirement(runtimeId,pod,signal);
  state.state = "stopped";originals.delete(runtimeId);
  return Object.freeze({schemaVersion:2,kind:"original-workspace-runtime-v2-retirement",runtimeId,workspaceId:original.workspaceId,
    parentContainerId:original.parentContainerId,daemonId:original.daemonId,startIdentity:original.startIdentity,
    publicProfileSha256:original.publicProfileSha256,requestSha256:original.requestSha256,state:"stopped",finishedAt,
    observedAt,expiresAt:observedAt+5000});
}
