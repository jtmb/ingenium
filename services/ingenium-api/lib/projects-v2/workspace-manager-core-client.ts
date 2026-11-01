import {loadManagerToken} from "../runtime-manager-auth.js";
import {parseStrictJobJson} from "../dot-v2/job-bootstrap-frame.mjs";
import type {PublicWorkspaceProvisionRequest,WorkspaceRuntimeOriginalProvision} from "ingenium-core/lib/tools/runtime-original-provision";
import type {WorkspaceV2ImageDefinition} from "./workspace-v2-image.mjs";

export interface WorkspaceManagerAdmissionV2 {
  publicRequest:PublicWorkspaceProvisionRequest;definition:WorkspaceV2ImageDefinition;nonce:string;credentialId:string;
  retiredPredecessors:Array<{runtimeId:string;backendName:string;original:WorkspaceRuntimeOriginalProvision;finishedAt:string;proofSha256:string}>;
}
export interface WorkspaceManagerOriginalV2 {
  runtime:{id:string;state:string;backendContainerId:string;backendName:string;[key:string]:unknown};
  workspace:{id:string;organizationId:string;ownerUserId:string;storageMappingHash:string;securityEpoch:number;[key:string]:unknown};
  original:WorkspaceRuntimeOriginalProvision;definition?:WorkspaceV2ImageDefinition;
}
export interface WorkspaceManagerRetiredV2 extends WorkspaceManagerOriginalV2 {
  retirement:{finishedAt:string;proofSha256:string};
}
/** The original private Core endpoint/token owner. No caller-provided URL,
 * credentials, transport, positive response or database connection is accepted. */
export async function workspaceManagerCoreV2(operation:"admission",body:unknown,signal?:AbortSignal):Promise<WorkspaceManagerAdmissionV2>;
export async function workspaceManagerCoreV2(operation:"original"|"retirement"|"commit",body:unknown,signal?:AbortSignal):Promise<WorkspaceManagerOriginalV2>;
export async function workspaceManagerCoreV2(operation:"retired",body:unknown,signal?:AbortSignal):Promise<WorkspaceManagerRetiredV2>;
export async function workspaceManagerCoreV2(operation:"admission"|"original"|"retirement"|"retired"|"commit",body:unknown,signal?:AbortSignal):Promise<WorkspaceManagerAdmissionV2|WorkspaceManagerOriginalV2|WorkspaceManagerRetiredV2> {
  const setting=process.env.INGENIUM_RUNTIME_API_URL;
  if(typeof setting!=="string"||!setting||setting!==setting.trim())throw Error("WORKSPACE_V2_CORE_URL");
  const base=new URL(setting);
  if(base.protocol!=="http:"||base.pathname!=="/api/v1"||base.username||base.password||base.search||base.hash)throw Error("WORKSPACE_V2_CORE_URL");
  base.pathname+="/internal/workspace-runtime-v2/"+operation;
  const timeout=AbortSignal.timeout(10000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const response=await fetch(base,{method:"POST",redirect:"error",credentials:"omit",cache:"no-store",signal:combined,
    headers:{Authorization:"Bearer "+loadManagerToken(),"Content-Type":"application/json",Accept:"application/json","Accept-Encoding":"identity"},body:JSON.stringify(body)});
  if(response.status!==200||!response.body){await response.body?.cancel();throw Error("WORKSPACE_V2_CORE_OWNER_UNAVAILABLE");}
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw Error("WORKSPACE_V2_CORE_BOUND");chunks.push(Buffer.from(chunk));}
  const bytes=Buffer.concat(chunks);
  try{
    const envelope=parseStrictJobJson(bytes,1024*1024) as {data?:WorkspaceManagerAdmissionV2|WorkspaceManagerOriginalV2|WorkspaceManagerRetiredV2};
    if(!envelope.data||typeof envelope.data!=="object"||Array.isArray(envelope.data))throw Error("WORKSPACE_V2_CORE_RESPONSE");
    return envelope.data;
  }finally{bytes.fill(0);}
}
