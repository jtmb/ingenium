import {request as originalCandidateHttpRequest} from 'node:http';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {hash as candidateRpcHash} from '../../../packages/veyra-operations/core126-image-contract.mjs';
import {parseStrictJobJson as parseCandidateRpcJson} from './dot-v2/job-bootstrap-frame.mjs';
import {requireOriginalCandidateManagerRpcIdentity,assertOriginalCandidateManagerRpcIdentity,requireOriginalCandidateRpcFacts,requireOriginalCandidateRpcWithdrawalControl} from './dot-v2/candidate-rpc-identity.mjs';
import {consumeBoundedRawJson,RAW_ASSISTANT_LIMITS} from './voice-v2/raw-assistant-wire.mjs';
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import type {runtimes} from "ingenium-core";
import * as runtimeProvision from "ingenium-core/lib/tools/runtime-original-provision";
import {randomUUID} from "node:crypto";
import { isManagedRuntimeObservation, type ManagedRuntimeObservation } from "./runtime-placement-contract.js";

export interface RuntimeManagerInspect {
  placement?: unknown;
  backendId?: string;
  backendName?: string;
  runtimeId?: string;
  imageRevision?: string;
  state: string;
  health: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface RuntimeProvisionPayload {
  runtime: runtimes.RuntimeInstance;
  projectName: string;
  storagePath: string;
  storageMappingHash: string;
  capability: string;
  capabilityExpiresAt: string;
}

function managerUrl(): URL {
  const value = process.env.INGENIUM_RUNTIME_MANAGER_URL?.trim();
  if (!value) throw new Error("Runtime manager is not configured");
  const url = new URL(value);
  if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || !/^[a-z0-9][a-z0-9.-]*$/i.test(url.hostname)) throw new Error("Runtime manager URL is invalid");
  return url;
}

function managerToken(): string {
  const path = process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE?.trim();
  if (!path) throw new Error("Runtime manager authentication is not configured");
  const stat = lstatSync(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077) !== 0 || realpathSync(path) !== path) {
    throw new Error("Runtime manager token file is unsafe");
  }
  const token = readFileSync(path, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("Runtime manager token is invalid");
  return token;
}

async function requestManager(path: string, method = "GET", body?: unknown): Promise<RuntimeManagerInspect> {
  const base = managerUrl();
  const response = await fetch(new URL(path, base), {
    method,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${managerToken()}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Runtime manager request failed");
  }
  const result = await response.json() as { data?: RuntimeManagerInspect };
  if (!result.data || typeof result.data.state !== "string" || typeof result.data.health !== "string") {
    throw new Error("Runtime manager response is invalid");
  }
  if (result.data.state !== "absent" && (!result.data.runtimeId || !UUID.test(result.data.runtimeId)
    || !result.data.backendId || !SHA256.test(result.data.backendId)
    || result.data.backendName !== `ingenium-runtime-${result.data.runtimeId.replaceAll("-", "")}`
    || !result.data.imageRevision || !SHA1.test(result.data.imageRevision))) {
    throw new Error("Runtime manager response is invalid");
  }
  return result.data;
}

const originalProvisionReceipts=new WeakMap<RuntimeManagerInspect,runtimes.RuntimeOriginalProvision>();
/** No DTO constructor: only the same object returned by private authenticated POST. */
export function authenticatedOriginalProvision(result:RuntimeManagerInspect):runtimes.RuntimeOriginalProvision|undefined{return originalProvisionReceipts.get(result);}
export async function provisionManagedRuntime(payload: RuntimeProvisionPayload): Promise<RuntimeManagerInspect> {
  const { runtime } = payload;
  const originalRequestId=randomUUID();
  const managerRequest={
    originalRequestId,
    runtimeId: runtime.id,
    backendName: runtime.backendName,
    organizationId: runtime.organizationId,
    projectId: runtime.projectId,
    projectName: payload.projectName,
    ownerUserId: runtime.ownerUserId,
    workspaceId: runtime.workspaceId,
    storagePath: payload.storagePath,
    storageMappingHash: payload.storageMappingHash,
    securityEpoch: runtime.securityEpoch,
    revision: runtime.revision,
    capability: payload.capability,
    capabilityExpiresAt: payload.capabilityExpiresAt,
    limits: {
      cpuMillis: runtime.cpuMillis,
      memoryBytes: runtime.memoryBytes,
      pidsLimit: runtime.pidsLimit,
      diskBytes: runtime.diskBytes,
      processLimit: runtime.processLimit,
    },
  };
  const result=await requestManager("/v1/runtimes","POST",managerRequest);
  const fields=result as RuntimeManagerInspect&{provisionDisposition?:unknown;originalProvision?:unknown};
  // Only this immediate authenticated response plus this exact local request
  // can create an entry. A copied DTO/current probe has no WeakMap identity.
  if(fields.provisionDisposition==="new_created"){
    try{originalProvisionReceipts.set(result,runtimeProvision.validateProvisionResponse(fields.originalProvision,managerRequest,result.backendId));}
    catch{/* Preserve ordinary runtime lifecycle; no original role authority. */}
  }
  delete fields.originalProvision;delete fields.provisionDisposition;
  return result;
}

export function inspectManagedRuntime(runtimeId: string): Promise<RuntimeManagerInspect> {
  return requestManager(`/v1/runtimes/${encodeURIComponent(runtimeId)}`);
}

export async function inspectManagedRuntimePlacement(runtimeId: string): Promise<ManagedRuntimeObservation> {
  if (!UUID.test(runtimeId)) throw new Error("Runtime placement identity is invalid");
  const result=await requestManager(`/v1/runtimes/${encodeURIComponent(runtimeId)}/placement`);
  if (!isManagedRuntimeObservation(result.placement) || result.placement.runtimeId!==runtimeId
    || result.placement.backendId!==result.backendId || result.placement.backendName!==result.backendName
    || result.placement.imageRevision!==result.imageRevision || result.placement.state!==result.state
    || result.placement.health!==result.health) throw new Error("Runtime placement evidence is invalid");
  return Object.freeze({...result.placement});
}

export function stopManagedRuntime(runtimeId: string): Promise<RuntimeManagerInspect> {
  return requestManager(`/v1/runtimes/${encodeURIComponent(runtimeId)}/stop`, "POST");
}

export function removeManagedRuntime(runtimeId: string): Promise<RuntimeManagerInspect> {
  return requestManager(`/v1/runtimes/${encodeURIComponent(runtimeId)}`, "DELETE");
}

export async function runtimeManagerHealth(): Promise<boolean> {
  try {
    const base = managerUrl();
    const response = await fetch(new URL("/v1/health", base), {
      headers: { Authorization: `Bearer ${managerToken()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(2_000),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}

export interface ManagedJobObservation {state:"active"|"settled"|"unknown"|"removed";code:string;proof?:unknown}
async function requestManagedJob(runId:string,operation:"inspect"|"launch"|"cancel"|"cleanup",runtimeId?:string):Promise<ManagedJobObservation>{
  if(!UUID.test(runId)||(operation==="launch"&&(!runtimeId||!UUID.test(runtimeId))))throw Error("Managed JobRun identity is invalid");
  const response=await fetch(new URL(`/v1/job-runs/${encodeURIComponent(runId)}${operation==="inspect"?"":"/"+operation}`,managerUrl()),{
    method:operation==="inspect"?"GET":"POST",redirect:"error",headers:{Authorization:`Bearer ${managerToken()}`,Accept:"application/json",...(operation==="launch"?{"Content-Type":"application/json"}:{})},
    body:operation==="launch"?JSON.stringify({runId,runtimeId}):undefined,signal:AbortSignal.timeout(30_000),
  });
  if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw Error("Managed JobRun owner unavailable");}
  const result=await response.json() as {data?:ManagedJobObservation};
  if(!result.data||!["active","settled","unknown",...(operation==="cleanup"?["removed"]:[])].includes(result.data.state)||typeof result.data.code!=="string"||result.data.code.length>128||(result.data.state==="settled"&&!result.data.proof))throw Error("Managed JobRun owner response invalid");
  return result.data;
}
export const launchManagedJobRun=(runId:string,runtimeId:string)=>requestManagedJob(runId,"launch",runtimeId);
export const inspectManagedJobRun=(runId:string)=>requestManagedJob(runId,"inspect");
export const cancelManagedJobRun=(runId:string)=>requestManagedJob(runId,"cancel");

export const cleanupManagedJobRun=(runId:string)=>requestManagedJob(runId,"cleanup");

/** Read-only actual same-manager/full-parent proof. Only the sealed image consumer grants a role. */
export async function inspectManagedRuntimeJobRole(runtimeId:string):Promise<unknown>{
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runtimeId))throw Error("Original runtime identity is invalid");
 const result=await requestManager('/v1/runtimes/'+runtimeId+'/job-role-proof');
 if(!('jobRoleProof' in result)||!result.jobRoleProof||typeof result.jobRoleProof!=='object')throw Error("Original manager job-role proof unavailable");
 const proof=result.jobRoleProof;
 if(!('parent' in proof)||!proof.parent||typeof proof.parent!=='object'||!('runtimeId' in proof.parent)||proof.parent.runtimeId!==runtimeId||!('id' in proof.parent)||proof.parent.id!==result.backendId||!('name' in proof.parent)||proof.parent.name!==result.backendName)throw Error("Original manager job-role identity changed");
 return proof;
}

/** Same original private manager/token; no caller-selected closure paths. */
export async function inspectManagedRuntimeCandidateClosure(runtimeId:string):Promise<unknown>{
 if(!UUID.test(runtimeId))throw Error('Original candidate runtime identity');const result=await requestManager('/v1/runtimes/'+runtimeId+'/candidate-closure');
 if(!('candidateClosure' in result)||!result.candidateClosure||typeof result.candidateClosure!=='object')throw Error('Original candidate closure unavailable');
 const value=result.candidateClosure as {proof?:{parent?:{runtimeId?:string;id?:string;name?:string}}};
 if(value.proof?.parent?.runtimeId!==runtimeId||value.proof.parent.id!==result.backendId||value.proof.parent.name!==result.backendName)throw Error('Original candidate parent changed');return value;
}

// APPEND to actual runtime-manager-client.ts with raw-helper import. Legacy
// requestManager unchanged: new call path owns strict body/cancel evidence.
const originalCallManagerFetch=globalThis.fetch.bind(globalThis);
export async function inspectOriginalCallRuntimeJobRole(runtimeId:string,signal:AbortSignal):Promise<unknown> {
 if(!UUID.test(runtimeId)||!(signal instanceof AbortSignal))throw Object.assign(Error('RAW_CALL_MANAGER_INPUT'),{code:'RAW_CALL_MANAGER_INPUT'});
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(15000)]);bounded.throwIfAborted();
 const url=new URL('/v1/runtimes/'+runtimeId+'/job-role-proof',managerUrl()).href;
 try{
  const response=await originalCallManagerFetch(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:bounded,
   headers:{Authorization:`Bearer ${managerToken()}`,Accept:'application/json','Accept-Encoding':'identity'}});
  const body=await consumeBoundedRawJson(response,url,RAW_ASSISTANT_LIMITS.sessionBytes,bounded);
  try{
   const envelope=body.json as {data?:RuntimeManagerInspect},result=envelope?.data;
   if(!result||result.runtimeId!==runtimeId||typeof result.state!=='string'||typeof result.health!=='string'
    ||!result.backendId||!SHA256.test(result.backendId)||result.backendName!==`ingenium-runtime-${runtimeId.replaceAll('-','')}`
    ||!result.imageRevision||!SHA1.test(result.imageRevision)||!('jobRoleProof'in result)||!result.jobRoleProof||typeof result.jobRoleProof!=='object')throw Error('invalid original manager selection');
   const proof=result.jobRoleProof;
   if(!('parent'in proof)||!proof.parent||typeof proof.parent!=='object'||!('runtimeId'in proof.parent)||proof.parent.runtimeId!==runtimeId
    ||!('id'in proof.parent)||proof.parent.id!==result.backendId||!('name'in proof.parent)||proof.parent.name!==result.backendName)throw Error('invalid original manager parent');
   bounded.throwIfAborted();return proof;
  }finally{body.raw.fill(0);}
 }catch(error:unknown){
  const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^RAW_[A-Z_]+$/u.test(error.code)?error.code:bounded.aborted?'RAW_READ_ABORTED':'RAW_CALL_MANAGER_FAILED';
  throw Object.assign(Error(code),{code});
 }
}

// Fixed candidate ORIGINAL RPC. Existing production fetch/provision paths unchanged.
// No endpoint/token/transport/signer/Core factory/callback parameter is accepted.
export interface ManagedCandidateRpcOriginal {readonly __managedCandidateRpcOriginal:never;}
export interface ManagedCandidateRpcPhase {readonly __managedCandidateRpcPhase:never;}
const candidateRpcSessions=new WeakMap<object,any>(),candidateRpcByRun=new Map<string,object>(),candidateRpcPhases=new WeakMap<object,any>();
const rpcFailure=(code:string):never=>{throw Object.assign(Error(code),{code,status:503});};
const rpcNeed=(value:unknown,code='MANAGED_CANDIDATE_RPC_ORIGINAL_UNAVAILABLE'):void=>{if(!value)rpcFailure(code);};
const rpcUnknown=(s:any,reason:string)=>{if(s.status==='pending')s.status='unknown';s.failure=reason;for(const slot of s.slots.values())slot.valid=false;};
function rpcPending(s:any):void{
 rpcNeed(s&&s.status==='pending'&&!s.settled&&s.request&&s.socket&&s.request.socket===s.socket&&!s.request.destroyed&&!s.socket.destroyed&&!s.response?.complete&&Date.now()<s.snapshot.binding.deadlineMs,'MANAGED_CANDIDATE_RPC_NOT_PENDING');
 rpcNeed(managerToken()===s.token,'MANAGED_CANDIDATE_RPC_TOKEN_CHANGED');
 assertOriginalCandidateManagerRpcIdentity(s.managerIdentity,{origin:s.origin,socket:s.socket,request:s.request,response:s.response,pending:s.promise});
}
/** ONE actual request on existing canonical private manager URL/token channel.
 * Missing actual manager identity refuses BEFORE enrolling or opening network. */
export async function launchOriginalManagedCandidateRun(runId:string):Promise<unknown>{
 if(!UUID.test(runId)||candidateRpcByRun.has(runId))return rpcFailure('MANAGED_CANDIDATE_RPC_ALREADY_SEEN');
 const [{actualManagedJobOwner},{withPersistedOriginalCandidateOperation}]=await Promise.all([import('./dot-v2/core126-runtime.js'),import('./dot-v2/dot-original-context.js')]);
 return withPersistedOriginalCandidateOperation(runId,async context=>{
  const owner=actualManagedJobOwner().owner,managerIdentity=requireOriginalCandidateManagerRpcIdentity(),base=managerUrl(),token=managerToken();
  // Original API/Core private method returns an opaque RPC preparation linked to
  // retained ORIGINAL prepare key; it never prepares/reconstructs a Run or lease.
  const preparation=owner.candidateOriginalRpcPreparation(runId,context),snapshot=owner.requireOriginalCandidateRpcPreparation(preparation,context);
  const challenge=randomBytes(32),challengeHex=challenge.toString('hex'),binding=snapshot.binding;
  const custodyId=candidateRpcHash(['managed-candidate-rpc-custody-v1',challengeHex,runId,binding.attemptId,binding.candidateIntentHash,binding.specHash,binding.selectionSha256]);
  const handle=Object.freeze({});let resolve!:(v:unknown)=>void,reject!:(e:unknown)=>void;
  const promise=new Promise<unknown>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});
  const s:any={handle,owner,preparation,snapshot,managerIdentity,origin:base.origin,token,challenge,custodyId,request:null,socket:null,response:null,promise,status:'pending',settled:false,slots:new Map()};
  // Private enrollment happens BEFORE httpRequest or request.end/network.
  candidateRpcSessions.set(handle,s);candidateRpcByRun.set(runId,handle);
  const payload=Buffer.from(JSON.stringify({challenge:challengeHex,runId,attemptId:binding.attemptId,intentHash:binding.candidateIntentHash,specHash:binding.specHash,selectionSha256:binding.selectionSha256,deadlineAt:binding.deadlineAt}));
  const finish=(error?:unknown,value?:unknown)=>{if(s.settled)return;s.settled=true;clearTimeout(s.timer);rpcUnknown(s,error?'MANAGED_CANDIDATE_RPC_ACK_UNKNOWN':'MANAGED_CANDIDATE_RPC_ENDED');challenge.fill(0);error?reject(error):resolve(value);};
  s.timer=setTimeout(()=>{finish(Error('MANAGED_CANDIDATE_RPC_DEADLINE_UNKNOWN'));s.request?.destroy();},Math.max(1,binding.deadlineMs-Date.now()));s.timer.unref?.();
  try{
   rpcNeed(Date.now()<binding.deadlineMs,'MANAGED_CANDIDATE_RPC_DEADLINE_UNKNOWN');
   const url=new URL('/v1/candidate-job-runs/'+runId+'/launch',base);
   s.request=originalCandidateHttpRequest(url,{method:'POST',agent:false,headers:{Authorization:'Bearer '+token,Accept:'application/json','Content-Type':'application/json','Content-Length':payload.length,'Accept-Encoding':'identity',Connection:'close'}},response=>{
    s.response=response;const chunks:Buffer[]=[];let bytes=0;response.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65536){finish(Error('MANAGED_CANDIDATE_RPC_RESPONSE_LIMIT'));response.destroy();return;}chunks.push(Buffer.from(chunk));});response.once('aborted',()=>finish(Error('MANAGED_CANDIDATE_RPC_RESPONSE_UNKNOWN')));response.once('error',()=>finish(Error('MANAGED_CANDIDATE_RPC_RESPONSE_UNKNOWN')));response.once('end',()=>{if(response.statusCode!==200||!response.complete){finish(Error('MANAGED_CANDIDATE_RPC_RESPONSE_UNKNOWN'));return;}try{const value:any=parseCandidateRpcJson(Buffer.concat(chunks),65536);rpcNeed(value?.data?.custodyId===s.custodyId&&value.data.runId===runId&&value.data.attemptId===binding.attemptId&&value.data.intentHash===binding.candidateIntentHash&&value.data.specHash===binding.specHash&&value.data.deadlineAt===binding.deadlineAt);finish(undefined,value);}catch{finish(Error('MANAGED_CANDIDATE_RPC_RESPONSE_INVALID'));}});response.once('close',()=>{if(!response.complete)finish(Error('MANAGED_CANDIDATE_RPC_RESPONSE_UNKNOWN'));});
   });
   s.request.once('socket',socket=>{s.socket=socket;socket.once('close',()=>{if(!s.settled)finish(Error('MANAGED_CANDIDATE_RPC_SOCKET_UNKNOWN'));});});
   s.request.once('error',()=>finish(Error('MANAGED_CANDIDATE_RPC_ACK_UNKNOWN')));s.request.end(payload);
  }catch(error){finish(error);}
  return promise; // same original promise retained by the session; no retry.
 });
}
/** Fixed API route calls after its strict manager auth/shape/MAC checks. Even a
 * correctly signed copied DTO has NO authority without the enrolled pending RPC.
 * handle represents DELEGATED manager-original authority, not API-owned Docker IO. */
export function verifyPendingOriginalCandidatePhase(request:any,context:object):ManagedCandidateRpcPhase{
 const match=/^\/internal\/original-candidate-job-runs\/([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/(create-intent|created|start-intent|waiting|ready)$/.exec(request.path);
 rpcNeed(match&&request.method==='POST'&&Object.keys(request.query??{}).length===0);const runId=match![1]!,operation=match![2]!;
 const token=managerToken(),headers=request.headers??{},header=headers.authorization;rpcNeed(typeof header==='string'&&header.startsWith('Bearer '));const supplied=Buffer.from(header.slice(7)),expected=Buffer.from(token);rpcNeed(supplied.length===expected.length&&timingSafeEqual(supplied,expected)&&headers['content-type']==='application/json'&&!['cookie','origin','x-ingenium-audience','x-ingenium-job-attempt','x-ingenium-internal-service','transfer-encoding','content-encoding'].some(k=>headers[k]!==undefined));
 rpcNeed(Buffer.isBuffer(request.originalCandidateBody)&&request.originalCandidateBody.length<=65536);const body:any=parseCandidateRpcJson(request.originalCandidateBody,65536);
 const session=candidateRpcByRun.get(runId),s=session&&candidateRpcSessions.get(session);rpcPending(s);
 const snapshot=s.owner.requireOriginalCandidateRpcPreparation(s.preparation,context),b=snapshot.binding,o=body?.observation;
 rpcNeed(body&&Object.keys(body).sort().join('|')==='custodyId|observation|signature'&&o&&body.custodyId===s.custodyId&&o.custodyId===s.custodyId,'MANAGED_CANDIDATE_RPC_CUSTODY_CHANGED');
 const keys=['schemaVersion','domain','kind','custodyId','runId','attemptId','candidateIntentHash','specHash','selectionSha256','containerId','daemonId','childBirthHash','childStartHash','attachIdentityHash','deadlineAt','expectedRevision','observedAt','expiresAt','facts'];
 rpcNeed(Object.keys(o).sort().join('|')===keys.sort().join('|')&&o.schemaVersion===1&&o.domain==='candidate-observation-v1'&&o.kind==='original-candidate-'+operation+'-v1');
 rpcNeed(token===s.token&&typeof body.signature==='string'&&/^[a-f0-9]{64}$/.test(body.signature));const key=createHmac('sha256',token).update('candidate-observation-v1/key\0').digest(),mac=createHmac('sha256',key).update('candidate-observation-v1/payload\0').update(candidateRpcHash(o)).digest();rpcNeed(timingSafeEqual(mac,Buffer.from(body.signature,'hex')));
 const phase:Record<string,string>={'create-intent':'prepared',created:'create_intent','start-intent':'created',waiting:'start_intent',ready:'waiting'};
 rpcNeed(Object.hasOwn(phase,operation)&&snapshot.phase===phase[operation]&&!snapshot.unknown&&!snapshot.cancelRequested&&snapshot.revision===o.expectedRevision&&!s.slots.has(operation));
 rpcNeed(['runId','attemptId','candidateIntentHash','specHash','selectionSha256','daemonId','deadlineAt'].every(k=>o[k]===b[k])&&o.runId===runId);
 const now=Date.now();rpcNeed(Number.isSafeInteger(o.observedAt)&&Number.isSafeInteger(o.expiresAt)&&o.observedAt<=now&&now<o.expiresAt&&o.expiresAt-o.observedAt<=5000&&o.expiresAt>o.observedAt&&o.expiresAt<=b.deadlineMs);
 for(const k of ['containerId','childBirthHash','childStartHash','attachIdentityHash']){const introduced=operation==='created'&&['containerId','childBirthHash'].includes(k)||operation==='start-intent'&&k==='attachIdentityHash'||operation==='waiting'&&k==='childStartHash';rpcNeed(introduced?b[k]===null&&typeof o[k]==='string'&&/^[a-f0-9]{64}$/.test(o[k]):o[k]===b[k]);}
 // Fixed HTTP DATA verifier MUST additionally validate exact per-kind facts.
 // No callback can mark arbitrary facts qualified: this fixed gate stays closed
 // until Root assembles that verifier with its actual private API entrypoint.
 requireOriginalCandidateRpcFacts(o,operation,snapshot);
 const handle=Object.freeze({}),slot={handle,session:s,operation,expectedRevision:snapshot.revision,observation:structuredClone(o),valid:true,spent:false};s.slots.set(operation,slot);candidateRpcPhases.set(handle,slot);return handle as ManagedCandidateRpcPhase;
}
/** Called synchronously INSIDE original Core final refreshed write transaction.
 * Failure after one-shot spend strands the slot as unknown; never retry it. */
export function spendOriginalCandidateRpcPhase(handle:ManagedCandidateRpcPhase,operation:string,binding:any,context:object):unknown{
 const slot=candidateRpcPhases.get(handle);rpcNeed(slot&&slot.valid&&!slot.spent&&slot.operation===operation);const s=slot.session;rpcPending(s);const current=s.owner.requireOriginalCandidateRpcFinalWrite(s.preparation,context);
 rpcNeed(current.revision===slot.expectedRevision&&candidateRpcHash(binding)===candidateRpcHash(current.binding)&&Date.now()<slot.observation.expiresAt);
 slot.spent=true;slot.valid=false;return Object.freeze(structuredClone(slot.observation.facts));
}
export function retainOriginalCandidateRpcPhaseUnknown(handle:ManagedCandidateRpcPhase):void{const slot=candidateRpcPhases.get(handle);rpcNeed(slot);rpcUnknown(slot.session,'MANAGED_CANDIDATE_RPC_FINAL_CAS_UNKNOWN');}

/** Negative control ONLY: no new effect, material, replay or retirement. Fixed
 * original withdrawal constructor is separate from current execute approval. */
export function withdrawOriginalManagedCandidateRpc(runId:string,control:unknown):void{
 const original=candidateRpcByRun.get(runId),s=original&&candidateRpcSessions.get(original);rpcNeed(s);
 requireOriginalCandidateRpcWithdrawalControl(control,s.preparation);rpcUnknown(s,'MANAGED_CANDIDATE_RPC_WITHDRAWN');
}
