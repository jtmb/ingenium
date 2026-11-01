import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readFileSync} from "node:fs";
import {dirname} from "node:path";
import {createHash} from "node:crypto";
import {isIP} from "node:net";
import {parseStrictJobJson} from "../dot-v2/job-bootstrap-frame.mjs";
import {publicWorkspaceProvisionRequest,decodeWorkspaceRuntimeOriginalProvision,provisionHash,type PublicWorkspaceProvisionRequest} from "ingenium-core/lib/tools/runtime-original-provision";
import {workspaceManagerCoreV2} from "../projects-v2/workspace-manager-core-client.js";
import type {WorkspaceV2ImageDefinition} from "../projects-v2/workspace-v2-image.mjs";
import {KubernetesApiClient} from "./api-client.js";
import {planKubernetesWorkspacePod,type KubernetesWorkspaceMapping,type KubernetesNodePidPolicy} from "./workspace-pod.js";
import {provisionKubernetesWorkspace,inspectKubernetesWorkspaceOriginal,retireKubernetesWorkspaceOriginal} from "./workspace-lifecycle.js";

const CONFIG="/run/ingenium-kubernetes-runtime/config.json",UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code,status:503});};
interface Configuration {schemaVersion:1;namespace:string;workspaceMappings:KubernetesWorkspaceMapping[];nodePidPolicies:KubernetesNodePidPolicy[]}
function configuration():{value:Configuration;sha256:string}{
  for(const path of ["/run",dirname(CONFIG)]){
    const st=lstatSync(path);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)||realpathSync(path)!==path)return fail("KUBERNETES_MANAGER_CONFIGURATION_OWNER");
  }
  const named=lstatSync(CONFIG);if(!named.isFile()||named.isSymbolicLink()||realpathSync(CONFIG)!==CONFIG)return fail("KUBERNETES_MANAGER_CONFIGURATION_OWNER");
  const fd=openSync(CONFIG,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const a=fstatSync(fd);if(a.uid!==0||a.nlink!==1||(a.mode&0o022)||a.size<2||a.size>65536||a.dev!==named.dev||a.ino!==named.ino)return fail("KUBERNETES_MANAGER_CONFIGURATION_OWNER");
    const bytes=readFileSync(fd),b=fstatSync(fd),c=lstatSync(CONFIG);
    if(bytes.length!==a.size||[b,c].some(st=>["dev","ino","size","mtimeMs","ctimeMs","uid","nlink","mode"].some(k=>st[k as keyof typeof st]!==a[k as keyof typeof a]))||realpathSync(CONFIG)!==CONFIG)return fail("KUBERNETES_MANAGER_CONFIGURATION_CHANGED");
    const value=parseStrictJobJson(bytes,65536) as Configuration;
    if(!value||Object.keys(value).sort().join("|")!=="namespace|nodePidPolicies|schemaVersion|workspaceMappings"||value.schemaVersion!==1||typeof value.namespace!=="string"||
      !Array.isArray(value.workspaceMappings)||value.workspaceMappings.length<1||value.workspaceMappings.length>128||new Set(value.workspaceMappings.map(row=>row.workspaceId)).size!==value.workspaceMappings.length||
      !Array.isArray(value.nodePidPolicies)||value.nodePidPolicies.length<1||value.nodePidPolicies.length>32||new Set(value.nodePidPolicies.map(row=>row.nodeName)).size!==value.nodePidPolicies.length)return fail("KUBERNETES_MANAGER_CONFIGURATION");
    return {value,sha256:createHash("sha256").update(bytes).digest("hex")};
  }finally{closeSync(fd);}
}
function immutableImage(definition:WorkspaceV2ImageDefinition){
  if(definition.schemaVersion!==2||definition.backendKind!=="kubernetes"||typeof definition.pullReference!=="string"||definition.validUntil<=Date.now()+45000)return fail("KUBERNETES_WORKSPACE_IMAGE_APPROVAL_REQUIRED");
  return {imageId:definition.imageId,pullReference:definition.pullReference,sourceRevision:definition.sourceRevision,validUntil:definition.validUntil};
}

/** Independent Kubernetes service composition. It never creates a Docker owner,
 * accesses a Docker socket or substitutes Kubernetes facts into Docker DTOs. */
export class KubernetesWorkspaceManager {
  readonly #client=KubernetesApiClient.inCluster();
  readonly #configuration=configuration();
  readonly #inFlight=new Set<string>();
  constructor(){if(this.#configuration.value.namespace!==this.#client.namespace)return fail("KUBERNETES_MANAGER_NAMESPACE");}
  #config(){const current=configuration();if(current.sha256!==this.#configuration.sha256)return fail("KUBERNETES_MANAGER_CONFIGURATION_CHANGED");return current.value;}
  #profile(request:PublicWorkspaceProvisionRequest){
    const config=this.#config(),mapping=config.workspaceMappings.find(row=>row.workspaceId===request.workspaceId);
    if(!mapping)return fail("KUBERNETES_WORKSPACE_MAPPING");
    const policy=config.nodePidPolicies.find(row=>row.validUntil>Date.now()+45000&&row.podPidsLimit>=16&&row.podPidsLimit<=Math.min(request.limits.pidsLimit,request.limits.processLimit));
    if(!policy)return fail("KUBERNETES_POD_PID_LIMIT_UNQUALIFIED");
    return {mapping,policy};
  }
  async preflight(input:Record<string,unknown>,signal?:AbortSignal){
    if(Object.keys(input).sort().join("|")!=="definition|publicRequest|retiredPredecessors")return fail("KUBERNETES_PREFLIGHT_INPUT");
    const request=publicWorkspaceProvisionRequest(input.publicRequest as PublicWorkspaceProvisionRequest),definition=input.definition as WorkspaceV2ImageDefinition;
    const {mapping,policy}=this.#profile(request),identity=await this.#client.identify(signal),node=await this.#client.node(policy.nodeName,signal),claim=await this.#client.claim(mapping.claimName,signal);
    planKubernetesWorkspacePod({request,mapping,nodePidPolicy:policy,identity,node,claim,image:immutableImage(definition),apiUrl:process.env.INGENIUM_RUNTIME_API_URL!});
    await this.#predecessors(request,input.retiredPredecessors,mapping,signal);
    this.#config();return {available:true,requestSha256:provisionHash(request),definitionSha256:provisionHash(definition)};
  }
  async #predecessors(request:PublicWorkspaceProvisionRequest,predecessors:unknown,mapping:KubernetesWorkspaceMapping,signal?:AbortSignal){
    if(!Array.isArray(predecessors)||predecessors.length>512)return fail("KUBERNETES_PREDECESSOR_BOUND");
    const retired=new Map<string,{podUid:string;finishedAt:string}>();
    for(const row of predecessors){
      const o=decodeWorkspaceRuntimeOriginalProvision(row.original);
      if(o.backendKind!=="kubernetes"||o.runtimeId!==row.runtimeId||o.runtimeId===request.runtimeId||retired.has(o.runtimeId)||
        o.workspaceId!==request.workspaceId||o.organizationId!==request.organizationId||o.ownerUserId!==request.ownerUserId||o.bindingHash!==request.storageMappingHash||
        o.kubernetes.namespace!==mapping.namespace||o.kubernetes.claimUid!==mapping.claimUid||o.kubernetes.claimName!==mapping.claimName||
        !/^[a-f0-9]{64}$/.test(row.proofSha256)||!Number.isFinite(Date.parse(row.finishedAt)))return fail("KUBERNETES_PREDECESSOR_SCOPE");
      retired.set(o.runtimeId,{podUid:o.kubernetes.podUid,finishedAt:row.finishedAt});
      const existing=await this.#client.pod(o.runtimeId,signal);
      if(existing){
        const statuses=existing.status?.containerStatuses,container=statuses?.length===1&&statuses[0]?.name==="workspace"?statuses[0]:undefined;
        if(existing.metadata.uid!==o.kubernetes.podUid||container?.containerID!=="containerd://"+o.parentContainerId||container.restartCount!==0||
          container.state.terminated?.containerID!=="containerd://"+o.parentContainerId||container.state.terminated.startedAt!==o.kubernetes.startedAt||
          container.state.terminated.finishedAt!==row.finishedAt||!["Failed","Succeeded"].includes(existing.status?.phase??""))return fail("KUBERNETES_PREDECESSOR_NOT_RETIRED");
      }
    }
    const users=await this.#client.claimPods(mapping.claimName,signal);
    for(const pod of users){
      const id=pod.metadata.labels?.["com.ingenium.runtime.id"],prior=id&&retired.get(id);
      if(!prior||prior.podUid!==pod.metadata.uid||!["Failed","Succeeded"].includes(pod.status?.phase??""))return fail("KUBERNETES_UNRECONCILED_CLAIM_USER");
    }
  }
  async provision(input:Record<string,unknown>,signal?:AbortSignal){
    const {capability,capabilityExpiresAt,bootstrapNonce,...publicInput}=input;
    const request=publicWorkspaceProvisionRequest(publicInput as unknown as PublicWorkspaceProvisionRequest),runtimeId=request.runtimeId;
    if(Object.keys(input).sort().join("|")!==[...Object.keys(request),"capability","capabilityExpiresAt","bootstrapNonce"].sort().join("|")||
      typeof capability!=="string"||typeof capabilityExpiresAt!=="string"||typeof bootstrapNonce!=="string"||this.#inFlight.has(runtimeId))return fail("KUBERNETES_ORIGINAL_REQUEST");
    this.#inFlight.add(runtimeId);
    try{
      const admission=await workspaceManagerCoreV2("admission",{runtimeId,requestId:request.originalRequestId,requestSha256:provisionHash(request)},signal);
      if(provisionHash(admission.publicRequest)!==provisionHash(request)||admission.nonce!==bootstrapNonce||!UUID.test(admission.credentialId))return fail("KUBERNETES_ORIGINAL_ADMISSION");
      const {mapping,policy}=this.#profile(request);
      await this.#predecessors(request,admission.retiredPredecessors,mapping,signal);this.#config();
      const original=await provisionKubernetesWorkspace(this.#client,{request,mapping,nodePidPolicy:policy,image:immutableImage(admission.definition),
        apiUrl:process.env.INGENIUM_RUNTIME_API_URL!,capability,capabilityExpiresAt,bootstrapNonce,credentialId:admission.credentialId,admissionSha256:provisionHash(admission),signal});
      return {disposition:"new_created",runtimeId,backendId:original.parentContainerId,backendName:request.backendName,
        imageRevision:admission.definition.sourceRevision,state:"running",health:"starting",originalProvision:original};
    }finally{input.capability="";this.#inFlight.delete(runtimeId);}
  }
  async placement(runtimeId:string,signal?:AbortSignal){
    if(!UUID.test(runtimeId)||this.#inFlight.has(runtimeId))return fail("KUBERNETES_ORIGINAL_REQUEST");
    this.#config();
    const before=await workspaceManagerCoreV2("original",{runtimeId},signal),{runtime:r,workspace:w,original:o,definition:d}=before;
    if(o.backendKind!=="kubernetes"||!d||d.backendKind!=="kubernetes"||r.backendContainerId!==o.parentContainerId||o.imageId!==d.imageId||d.pullReference!==o.kubernetes.pullReference)return fail("KUBERNETES_ORIGINAL_SCOPE");
    const observedAt=Date.now(),first=await inspectKubernetesWorkspaceOriginal(runtimeId,signal);
    if(!first.ready||provisionHash(first.original)!==provisionHash(o))return fail("KUBERNETES_ORIGINAL_NOT_READY");
    const artifacts=await this.#client.measureWorkspaceImageArtifacts(runtimeId,o.kubernetes,d.files,signal);
    const final=await inspectKubernetesWorkspaceOriginal(runtimeId,signal),after=await workspaceManagerCoreV2("original",{runtimeId},signal);
    this.#config();
    const address=final.pod.status?.podIP;
    if(!final.ready||provisionHash(before)!==provisionHash(after)||provisionHash(final.original)!==provisionHash(o)||typeof address!=="string"||!isIP(address)||Date.now()>=observedAt+5000)return fail("KUBERNETES_ORIGINAL_PLACEMENT_CHANGED");
    return {schemaVersion:2,kind:"original-workspace-runtime-v2-placement",runtimeId,parentContainerId:o.parentContainerId,startIdentity:o.startIdentity,
      publicProfileSha256:o.publicProfileSha256,provisioningRevision:o.provisioningRevision,imageId:o.imageId,daemonId:o.daemonId,hostId:o.hostId,
      organizationId:w.organizationId,ownerUserId:w.ownerUserId,projectId:null,workspaceId:w.id,bindingHash:w.storageMappingHash,bindingEpoch:w.securityEpoch,
      state:"running",health:"healthy",artifacts,definitionSha256:provisionHash(d),observedAt,expiresAt:observedAt+5000,
      kubernetes:{schemaVersion:1,namespaceUid:o.kubernetes.namespaceUid,podUid:o.kubernetes.podUid,containerId:o.parentContainerId,backendAddress:address}};
  }
  async stop(runtimeId:string,signal?:AbortSignal){
    if(!UUID.test(runtimeId)||this.#inFlight.has(runtimeId))return fail("KUBERNETES_ORIGINAL_REQUEST");
    this.#inFlight.add(runtimeId);
    try{
      this.#config();const before=await workspaceManagerCoreV2("retirement",{runtimeId},signal);
      if(before.runtime.state!=="STOPPING"||before.original.backendKind!=="kubernetes"||before.runtime.backendContainerId!==before.original.parentContainerId)return fail("KUBERNETES_RETIREMENT_SCOPE");
      const proof=await retireKubernetesWorkspaceOriginal(runtimeId,signal);
      const after=await workspaceManagerCoreV2("retirement",{runtimeId},signal);this.#config();
      if(provisionHash(before)!==provisionHash(after)||proof.parentContainerId!==before.original.parentContainerId)return fail("KUBERNETES_RETIREMENT_SCOPE_CHANGED");
      return proof;
    }finally{this.#inFlight.delete(runtimeId);}
  }
}
