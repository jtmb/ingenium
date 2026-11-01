import type { PublicWorkspaceProvisionRequest } from "ingenium-core/lib/tools/runtime-original-provision";
import { publicWorkspaceProvisionRequest, provisionHash } from "ingenium-core/lib/tools/runtime-original-provision";
import { workspaceRuntimeEnvironmentV2 } from "../runtime-manager-contract.js";
import type { KubernetesClaim, KubernetesClusterIdentity, KubernetesNode } from "./api-client.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^[a-f0-9]{64}$/;
const DNS = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const fail = (code: string): never => { throw Object.assign(new Error(code), { code, status: 503 }); };

export interface KubernetesWorkspaceMapping {
  schemaVersion: 1;
  namespace: string;
  workspaceId: string;
  organizationId: string;
  ownerUserId: string;
  storagePath: string;
  claimName: string;
  claimUid: string;
  claimBytes: number;
}
export interface KubernetesWorkspaceImage {
  imageId: string;
  pullReference: string;
  sourceRevision: string;
  validUntil: number;
}
/** Operator qualification of the actual node's kubelet setting. This input is
 * descriptive configuration, never a runtime/bootstrap or readiness proof. */
export interface KubernetesNodePidPolicy {
  schemaVersion: 1;
  nodeName: string;
  nodeUid: string;
  nodeBootId: string;
  kubeletVersion: string;
  kernelVersion: string;
  containerRuntimeVersion: string;
  podPidsLimit: number;
  configurationSha256: string;
  validUntil: number;
}
export interface KubernetesWorkspacePodPlan {
  schemaVersion: 1;
  backendKind: "kubernetes";
  requestSha256: string;
  namespaceUid: string;
  nodeUid: string;
  claimUid: string;
  enforcedPodPidsLimit: number;
  imageId: string;
  pullReference: string;
  pod: Record<string, unknown>;
  specSha256: string;
}

function storageBytes(value: unknown): number {
  if (typeof value !== "string") return fail("KUBERNETES_CLAIM_CAPACITY");
  const match = /^([1-9]\d*)(Ki|Mi|Gi|Ti|Pi|K|M|G|T|P)?$/.exec(value);
  if (!match) return fail("KUBERNETES_CLAIM_CAPACITY");
  const units: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, K: 1000, M: 1000 ** 2, G: 1000 ** 3, T: 1000 ** 4, P: 1000 ** 5 };
  const bytes = Number(match[1]) * (units[match[2] ?? ""] ?? 1);
  if (!Number.isSafeInteger(bytes)) return fail("KUBERNETES_CLAIM_CAPACITY");
  return bytes;
}

/** Build the real Kubernetes profile directly. No Docker/CRI inspect objects,
 * host paths, capabilities, tokens, global Project or inferred READY rows. */
export function planKubernetesWorkspacePod(input: {
  request: PublicWorkspaceProvisionRequest;
  mapping: KubernetesWorkspaceMapping;
  identity: KubernetesClusterIdentity;
  claim: KubernetesClaim;
  node: KubernetesNode;
  nodePidPolicy: KubernetesNodePidPolicy;
  image: KubernetesWorkspaceImage;
  apiUrl: string;
}): KubernetesWorkspacePodPlan {
  const request = publicWorkspaceProvisionRequest(input.request);
  const { mapping, identity, claim, node, nodePidPolicy: policy, image } = input;
  const now = Date.now();
  if (request.runtimeId !== request.runtimeId.toLowerCase() || mapping.schemaVersion !== 1 || mapping.namespace !== identity.namespace || !DNS.test(mapping.namespace) ||
    !UUID.test(identity.namespaceUid) || !HEX.test(identity.apiCaSha256) ||
    mapping.workspaceId !== request.workspaceId || mapping.organizationId !== request.organizationId ||
    mapping.ownerUserId !== request.ownerUserId || mapping.storagePath !== request.storagePath ||
    !DNS.test(mapping.claimName) || !UUID.test(mapping.claimUid) || !Number.isSafeInteger(mapping.claimBytes) ||
    mapping.claimBytes < 64 * 1024 * 1024 || mapping.claimBytes > request.limits.diskBytes) return fail("KUBERNETES_WORKSPACE_MAPPING");

  const annotations = claim.metadata.annotations ?? {};
  if (claim.metadata.namespace !== mapping.namespace || claim.metadata.name !== mapping.claimName ||
    claim.metadata.uid !== mapping.claimUid || claim.metadata.deletionTimestamp || claim.status?.phase !== "Bound" ||
    !claim.spec.volumeName || !["ReadWriteOnce", "ReadWriteOncePod"].some(mode =>
      claim.spec.accessModes?.length === 1 && claim.spec.accessModes[0] === mode) ||
    storageBytes(claim.spec.resources?.requests?.storage) !== mapping.claimBytes ||
    storageBytes(claim.status.capacity?.storage) !== mapping.claimBytes ||
    annotations["com.ingenium.runtime.workspace"] !== request.workspaceId ||
    annotations["com.ingenium.runtime.organization"] !== request.organizationId ||
    annotations["com.ingenium.runtime.owner"] !== request.ownerUserId ||
    annotations["com.ingenium.runtime.storage"] !== request.storageMappingHash) return fail("KUBERNETES_CLAIM_BINDING");

  const info = node.status?.nodeInfo;
  if (!info || node.metadata.deletionTimestamp || !UUID.test(node.metadata.uid) ||
    !node.status?.conditions?.some(condition => condition.type === "Ready" && condition.status === "True") ||
    policy.schemaVersion !== 1 || policy.nodeName !== node.metadata.name || policy.nodeUid !== node.metadata.uid ||
    policy.nodeBootId !== info.bootID || policy.kubeletVersion !== info.kubeletVersion ||
    policy.kernelVersion !== info.kernelVersion || policy.containerRuntimeVersion !== info.containerRuntimeVersion ||
    !HEX.test(policy.configurationSha256) || !Number.isSafeInteger(policy.validUntil) || policy.validUntil <= now + 45000 ||
    !Number.isSafeInteger(policy.podPidsLimit) || policy.podPidsLimit < 16 ||
    policy.podPidsLimit > Math.min(request.limits.pidsLimit, request.limits.processLimit)) return fail("KUBERNETES_POD_PID_LIMIT_UNQUALIFIED");
  if (!/^sha256:[a-f0-9]{64}$/.test(image.imageId) ||
    !/^[a-z0-9][a-z0-9./:_-]{0,254}@sha256:[a-f0-9]{64}$/.test(image.pullReference) ||
    !/^[a-f0-9]{40}$/.test(image.sourceRevision) ||
    !Number.isSafeInteger(image.validUntil) || image.validUntil <= now + 45000) return fail("KUBERNETES_IMMUTABLE_IMAGE_UNQUALIFIED");

  const labels = {
    "app.kubernetes.io/name": "veyra-workspace",
    "com.ingenium.managed": "runtime-manager",
    "com.ingenium.runtime.id": request.runtimeId,
    "com.ingenium.runtime.organization": request.organizationId,
    "com.ingenium.runtime.owner": request.ownerUserId,
    "com.ingenium.runtime.scope": "workspace",
    "com.ingenium.runtime.workspace": provisionHash(request.workspaceId).slice(0, 48),
  };
  const environment = workspaceRuntimeEnvironmentV2(request, input.apiUrl).map(value => {
    const split = value.indexOf("=");
    return { name: value.slice(0, split), value: value.slice(split + 1) };
  });
  const memory = String(request.limits.memoryBytes), cpu = request.limits.cpuMillis + "m";
  const pod = {
    apiVersion: "v1", kind: "Pod",
    metadata: {
      name: request.backendName, namespace: mapping.namespace, labels,
      finalizers: ["ingenium.io/runtime-retirement"],
      annotations: {
        "com.ingenium.runtime.workspace": request.workspaceId,
        "com.ingenium.runtime.storage": request.storageMappingHash,
        "com.ingenium.runtime.security-epoch": String(request.securityEpoch),
        "com.ingenium.runtime.revision": String(request.revision),
        "com.ingenium.runtime.request": request.originalRequestId,
        "com.ingenium.runtime.node-pid-policy": policy.configurationSha256,
      },
    },
    spec: {
      restartPolicy: "Never", terminationGracePeriodSeconds: 30,
      serviceAccountName: "default", automountServiceAccountToken: false, enableServiceLinks: false,
      hostNetwork: false, hostPID: false, hostIPC: false, shareProcessNamespace: false,
      dnsPolicy: "ClusterFirst", schedulerName: "default-scheduler",
      nodeSelector: { "kubernetes.io/os": "linux" },
      affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: {
        nodeSelectorTerms: [{ matchFields: [{ key: "metadata.name", operator: "In", values: [node.metadata.name] }] }],
      } } },
      securityContext: {
        runAsUser: 1000, runAsGroup: 1000, runAsNonRoot: true, fsGroup: 1000,
        fsGroupChangePolicy: "OnRootMismatch", supplementalGroupsPolicy: "Strict",
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [{
        name: "workspace", image: image.pullReference, imagePullPolicy: "IfNotPresent",
        workingDir: "/workspace", stdin: true, stdinOnce: true, tty: false,
        command: ["/app/scripts/runtime-entrypoint.sh"], args: [],
        env: environment,
        securityContext: {
          runAsUser: 1000, runAsGroup: 1000, runAsNonRoot: true, privileged: false,
          allowPrivilegeEscalation: false, readOnlyRootFilesystem: true,
          capabilities: { drop: ["ALL"] }, seccompProfile: { type: "RuntimeDefault" },
          appArmorProfile: { type: "RuntimeDefault" }, procMount: "Default",
        },
        resources: {
          requests: { cpu, memory },
          limits: { cpu, memory },
        },
        volumeMounts: [
          { name: "workspace", mountPath: "/workspace", readOnly: false },
          { name: "home", mountPath: "/home/appuser" },
          { name: "terminal-home", mountPath: "/home/ingenium-ttyd" },
          { name: "runtime", mountPath: "/run/ingenium-runtime" },
          { name: "temp", mountPath: "/tmp" },
          { name: "exec-temp", mountPath: "/home/appuser/.tmp" },
        ],
        startupProbe: { tcpSocket: { port: 4098 }, periodSeconds: 2, timeoutSeconds: 1, failureThreshold: 30 },
        readinessProbe: { tcpSocket: { port: 4098 }, periodSeconds: 3, timeoutSeconds: 1, failureThreshold: 2 },
      }],
      volumes: [
        { name: "workspace", persistentVolumeClaim: { claimName: mapping.claimName, readOnly: false } },
        { name: "home", emptyDir: { medium: "Memory", sizeLimit: String(request.limits.diskBytes) } },
        { name: "terminal-home", emptyDir: { medium: "Memory", sizeLimit: "67108864" } },
        { name: "runtime", emptyDir: { medium: "Memory", sizeLimit: "1048576" } },
        { name: "temp", emptyDir: { medium: "Memory", sizeLimit: "67108864" } },
        { name: "exec-temp", emptyDir: { medium: "Memory", sizeLimit: "67108864" } },
      ],
    },
  };
  return Object.freeze({
    schemaVersion: 1, backendKind: "kubernetes", requestSha256: provisionHash(request),
    namespaceUid: identity.namespaceUid, nodeUid: node.metadata.uid, claimUid: claim.metadata.uid,
    enforcedPodPidsLimit: policy.podPidsLimit, imageId: image.imageId, pullReference: image.pullReference,
    pod, specSha256: provisionHash(pod.spec),
  });
}
