import {workspaceV2ImageDefinition} from '../projects-v2/workspace-v2-image.mjs';
import {readInstalledCandidateSource} from '../../../../packages/veyra-operations/core126-candidate-observation.mjs';
import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readFileSync} from "node:fs";
import {dirname} from "node:path";
import {createHash} from "node:crypto";
import {getDb,runtimes} from "ingenium-core";
import {createCore126ObservationClient,createCore126ImageRegistry,createCore126ImageOwner,type Core126ImageOwner,type Core126ImageApproval} from "../../../../packages/veyra-operations/core126-image-owner.mjs";
import {inspectManagedRuntimeCandidateClosure,inspectManagedRuntimeJobRole} from "../runtime-manager-client.js";
import {parseStrictJobJson} from "./job-bootstrap-frame.mjs";

const POLICY_DIRECTORY="/run/ingenium-core126",POLICY_FILE=POLICY_DIRECTORY+"/approval.json";
const deny=():never=>{throw Object.assign(Error("Original managed image approval unavailable"),{status:503});};
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
/** Private fixed root-owned deployment input; never a request path or user vault item. */
function readProtected(file:string,maximum:number):Buffer {
 if(process.platform!=="linux"||!file.startsWith(POLICY_DIRECTORY+"/")||dirname(file)!==POLICY_DIRECTORY)return deny();
 for(const directory of ["/run",POLICY_DIRECTORY]){const s=lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0||realpathSync(directory)!==directory)return deny();}
 let fd:number|undefined;
 try{
  const named=lstatSync(file);if(!named.isFile()||named.isSymbolicLink()||realpathSync(file)!==file)return deny();
  fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const before=fstatSync(fd);
  if(!before.isFile()||before.uid!==0||before.nlink!==1||(before.mode&0o022)!==0||before.size<2||before.size>maximum||named.dev!==before.dev||named.ino!==before.ino)return deny();
  const bytes=readFileSync(fd),after=fstatSync(fd),current=lstatSync(file);
  if(bytes.length!==before.size||[after,current].some(s=>s.dev!==before.dev||s.ino!==before.ino||s.size!==before.size||s.mtimeMs!==before.mtimeMs||s.ctimeMs!==before.ctimeMs||s.uid!==0||s.nlink!==1||(s.mode&0o022)!==0)||current.isSymbolicLink()||realpathSync(file)!==file)return deny();
  return bytes;
 }finally{if(fd!==undefined)closeSync(fd);}
}
/** No approval is manufactured here. Root mounts actual independently reviewed
 * approval/manifest bytes only after real immutable-image qualification. Missing,
 * expired or changed policy refuses execution and preserves original withdrawals.
 */
export function loadInstalledCore126ImageOwner():Core126ImageOwner {
 const bytes=readProtected(POLICY_FILE,64*1024),policyDigest=digest(bytes);
 const raw:unknown=parseStrictJobJson(bytes,64*1024);
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).sort().join(",")!=="approvedImages,schemaVersion"||!("schemaVersion" in raw)||raw.schemaVersion!==1||!("approvedImages" in raw)||!Array.isArray(raw.approvedImages)||raw.approvedImages.length<1||raw.approvedImages.length>32)return deny();
 const approvals:Core126ImageApproval[]=[];const seen=new Set<string>();
 for(const entry of raw.approvedImages){
  if(!entry||typeof entry!=="object"||Array.isArray(entry)||Object.keys(entry).sort().join(",")!=="imageId,manifestSha256,sourceRevision,sourceSha256,validUntil"||typeof entry.imageId!=="string"||!/^sha256:[a-f0-9]{64}$/.test(entry.imageId)||seen.has(entry.imageId)||typeof entry.manifestSha256!=="string"||!/^[a-f0-9]{64}$/.test(entry.manifestSha256)||typeof entry.sourceSha256!=="string"||!/^[a-f0-9]{64}$/.test(entry.sourceSha256)||typeof entry.sourceRevision!=="string"||!/^[a-f0-9]{40}$/.test(entry.sourceRevision)||!Number.isSafeInteger(entry.validUntil)||entry.validUntil<=Date.now())return deny();
  seen.add(entry.imageId);approvals.push({...entry});
 }
 const assertPolicyCurrent=()=>{if(digest(readProtected(POLICY_FILE,64*1024))!==policyDigest)return deny();};
 const client=createCore126ObservationClient({requestOriginalManager:async path=>{
  const match=/^\/v1\/runtimes\/([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/job-role-proof$/.exec(path);
  if(!match?.[1])return deny();assertPolicyCurrent();return await inspectManagedRuntimeJobRole(match[1]);
 }});
 const registry=createCore126ImageRegistry({loadManifestBytes:async imageId=>{
  assertPolicyCurrent();const approval=approvals.find(a=>a.imageId===imageId);if(!approval)return deny();
  return readProtected(POLICY_DIRECTORY+"/"+approval.manifestSha256+".json",2*1024*1024);
 }},approvals);
 return createCore126ImageOwner({client,registry,inTransaction:()=>getDb().inTransaction,originalProvisionProfile:facts=>{
  assertPolicyCurrent();return runtimes.getRuntimeOriginalProvision(facts.runtime.id);
 }});
}
/** Explicit PRIVATE coordinator construction only. Never a missing-approval fallback. */
export function loadInstalledCore126UnapprovedCandidateImageOwner():Core126ImageOwner {
 readInstalledCandidateSource();
 const client=createCore126ObservationClient({requestOriginalManager:async path=>{
  readInstalledCandidateSource();
  const match=/^\/v1\/runtimes\/([a-f0-9-]+)\/(job-role-proof|candidate-closure)$/.exec(path);
  if(!match?.[1])return deny();return match[2]==='candidate-closure'?inspectManagedRuntimeCandidateClosure(match[1]):inspectManagedRuntimeJobRole(match[1]);
 }});
 const registry=createCore126ImageRegistry({loadManifestBytes:async()=>deny()},[]);
 return createCore126ImageOwner({client,registry,inTransaction:()=>getDb().inTransaction,originalProvisionProfile:facts=>runtimes.getRuntimeOriginalProvision(facts.runtime.id)});
}

/** Additive export in the EXISTING root-owned Core126 policy loader. No new approval source. */
export function loadInstalledWorkspaceRuntimeV2ImageDefinition(imageId:string):unknown {
 const policy=readProtected(POLICY_FILE,64*1024),raw=parseStrictJobJson(policy,64*1024) as {schemaVersion?:unknown;approvedImages?:Array<Core126ImageApproval>};
 if(raw.schemaVersion!==1||!Array.isArray(raw.approvedImages)||raw.approvedImages.length<1||raw.approvedImages.length>32)return deny();
 const rows=raw.approvedImages.filter(row=>row.imageId===imageId);if(rows.length!==1)return deny();const approval=rows[0]!;
 if(!/^sha256:[a-f0-9]{64}$/.test(imageId)||!/^[a-f0-9]{64}$/.test(approval.manifestSha256)||approval.validUntil<=Date.now())return deny();
 const bytes=readProtected(POLICY_DIRECTORY+'/'+approval.manifestSha256+'.json',2*1024*1024);
 if(digest(bytes)!==approval.manifestSha256)return deny();
 const definition=workspaceV2ImageDefinition(parseStrictJobJson(bytes,2*1024*1024),approval);
 if(digest(readProtected(POLICY_FILE,64*1024))!==digest(policy))return deny();return definition;
}
