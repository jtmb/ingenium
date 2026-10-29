import {createHash} from "node:crypto";
import {requireValue,text} from "../../../../packages/veyra-projects/domain.mjs";
import {immutableInput} from "./immutable-input.mjs";

function fingerprint(value) {
  function sorted(v) {
    if(Array.isArray(v)) return v.map(sorted);
    if(v && typeof v==="object") return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])]));
    return v;
  }
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}
function actorShape(actor) {
  requireValue(actor && typeof actor.ownerKey==="string" && actor.ownerKey.length===64 &&
    Array.from(actor.ownerKey).every(c=>"0123456789abcdef".includes(c)) &&
    Number.isSafeInteger(actor.authorityEpoch) && actor.authorityEpoch>=0,"PRIVATE_ACTOR_UNVERIFIED",403);
  return immutableInput(actor);
}
function id(value) {
  requireValue(typeof value==="string" && value.length===36 &&
    value!=="00000000-0000-0000-0000-000000000000" &&
    Array.from(value).every((c,i)=>[8,13,18,23].includes(i)?c==="-":"0123456789abcdef".includes(c)));
}
function exact(value,keys) { requireValue(value && typeof value==="object" && !Array.isArray(value) &&
  Object.keys(value).every(key=>keys.includes(key))); }
const operations=new Set(["terminal_open","terminal_input","terminal_resize","terminal_close","agent_turn"]);
function environment(value) {
  requireValue(value && ["windows","wsl"].includes(value.kind));
  exact(value,value.kind==="windows"?["kind"]:["kind","distro","user"]);
  if(value.kind==="wsl") requireValue(text(value.distro) && text(value.user));
}
function operation(value) {
  requireValue(value && operations.has(value.kind));
  const fields={terminal_open:["kind","shell","columns","rows"],terminal_input:["kind","terminalId","text"],
    terminal_resize:["kind","terminalId","columns","rows"],terminal_close:["kind","terminalId"],
    agent_turn:["kind","conversationRef","originalTurnRef"]};
  exact(value,fields[value.kind]);
  if(value.kind==="terminal_open") requireValue(text(value.shell) && value.shell.length<=32);
  if(value.kind==="terminal_open" || value.kind==="terminal_resize") requireValue(
    Number.isInteger(value.columns) && value.columns>=20 && value.columns<=300 &&
    Number.isInteger(value.rows) && value.rows>=5 && value.rows<=120);
  if(value.kind==="terminal_input" || value.kind==="terminal_resize" || value.kind==="terminal_close") id(value.terminalId);
  if(value.kind==="terminal_input") requireValue(typeof value.text==="string" && value.text.length>0 &&
    new TextEncoder().encode(value.text).byteLength<=65536);
  if(value.kind==="agent_turn") requireValue(text(value.conversationRef) && text(value.originalTurnRef));
}

// Executable policy model for the native patch ports. No DB connection, directory or process is owned here.
export class PrivateWorkspaceBoundary {
  constructor({owner,custody,execution,authorize,serviceInstanceId}) {
    Object.assign(this,{owner,custody,execution,authorize,serviceInstanceId});id(serviceInstanceId);
  }
  async actor(context,action,workspaceId) {return actorShape(await this.authorize(context,action,workspaceId));}
  view(record,actor) {
    requireValue(record.ownerKey===actor.ownerKey,"NOT_FOUND",404);
    return {projectId:null,id:record.id,revision:record.revision,state:record.state,
      environment:record.environment,serviceInstanceId:this.serviceInstanceId,
      authorityEpoch:actor.authorityEpoch,directory:record.directory,rootIdentity:record.rootIdentity};
  }
  async create(context,input) {
    const original=immutableInput(input);
    exact(original,["requestId","workspaceId","environment","serviceInstanceId","authorityEpoch"]);
    id(original.requestId);id(original.workspaceId);environment(original.environment);
    requireValue(original.serviceInstanceId===this.serviceInstanceId,"STALE_PRIVATE_BINDING",409);
    const actor=await this.actor(context,"private-workspaces:create",null);
    requireValue(original.authorityEpoch===actor.authorityEpoch,"STALE_PRIVATE_AUTHORITY",409);
    requireValue(this.custody.supports(original.environment)===true,"PRIVATE_ENVIRONMENT_UNSUPPORTED",501);
    const reserved=await this.owner.reserveCreate(actor,original,fingerprint(original));
    if(!reserved.fresh) return this.view(reserved.record,actor);
    try {
      const lease=await this.custody.prepareOnce({actor,original});
      await this.verify(lease,actor,reserved.record);
      const refreshed=await this.actor(context,"private-workspaces:create",original.workspaceId);
      requireValue(refreshed.ownerKey===actor.ownerKey && refreshed.authorityEpoch===actor.authorityEpoch,
        "PRIVATE_AUTHORITY_CHANGED",403);
      const record=await this.owner.activate(actor,original.workspaceId,{
        directory:lease.directory,rootIdentity:lease.rootIdentity});
      return this.view(record,actor);
    } catch {
      const record=await this.owner.markUnknown(actor,original.workspaceId);
      return this.view(record,actor);
    }
  }
  async reconnect(context,workspaceId) {
    id(workspaceId);const actor=await this.actor(context,"private-workspaces:read",workspaceId);
    return this.view(await this.owner.get(actor,workspaceId),actor);
  }
  async verify(lease,actor,record) {
    requireValue(lease && typeof lease.verify==="function" &&
      lease.workspaceId===record.id && lease.ownerKey===actor.ownerKey &&
      text(lease.directory,32760) && text(lease.rootIdentity) &&
      await lease.verify()===true,"PRIVATE_CUSTODY_UNAVAILABLE",409);
    requireValue(record.state!=="active" ||
      (lease.directory===record.directory && lease.rootIdentity===record.rootIdentity),
      "PRIVATE_ROOT_CHANGED",409);
  }
  async execute(context,input) {
    const original=immutableInput(input);
    exact(original,["projectId","workspaceId","expectedRevision","serviceInstanceId","authorityEpoch","requestId","operation"]);
    requireValue(Object.hasOwn(original,"projectId") && original.projectId===null,"PRIVATE_SCOPE_REQUIRED",422);
    id(original.workspaceId);id(original.requestId);
    requireValue(original.serviceInstanceId===this.serviceInstanceId,"STALE_PRIVATE_BINDING",409);
    operation(original.operation);
    const action="private-workspaces:execute:"+original.operation.kind;
    const actor=await this.actor(context,action,original.workspaceId);
    requireValue(original.authorityEpoch===actor.authorityEpoch,"STALE_PRIVATE_AUTHORITY",409);
    const record=immutableInput(await this.owner.get(actor,original.workspaceId));
    requireValue(record.ownerKey===actor.ownerKey,"NOT_FOUND",404);
    requireValue(record.state==="active" && record.revision===original.expectedRevision,"PRIVATE_WORKSPACE_UNAVAILABLE",409);
    requireValue(this.execution.supports(original.operation.kind,record.environment)===true,
      "PRIVATE_EXECUTION_UNSUPPORTED",501);
    const admitted=await this.owner.reserveOperation(actor,record,original,fingerprint(original));
    if(!admitted.fresh) return admitted.receipt;
    try {
      const lease=await this.custody.acquireExisting({actor,record});
      await this.verify(lease,actor,record);
      const refreshed=await this.actor(context,action,record.id);
      requireValue(refreshed.ownerKey===actor.ownerKey && refreshed.authorityEpoch===actor.authorityEpoch,
        "PRIVATE_AUTHORITY_CHANGED",403);
      const verifyNow=async()=>{
        const currentRecord=await this.owner.get(actor,record.id);
        requireValue(currentRecord.state==="active" && currentRecord.revision===record.revision &&
          currentRecord.directory===record.directory && currentRecord.rootIdentity===record.rootIdentity,
          "PRIVATE_WORKSPACE_CHANGED",409);
        await this.verify(lease,actor,record);
        const current=await this.actor(context,action,record.id);
        requireValue(current.ownerKey===actor.ownerKey && current.authorityEpoch===actor.authorityEpoch,
          "PRIVATE_AUTHORITY_CHANGED",403);
      };
      const observed=await this.execution.executeOnce({lease,actor,original,verifyNow});
      requireValue(observed && ["succeeded","failed","unknown"].includes(observed.state),"PRIVATE_OUTCOME_UNKNOWN",502);
      // Existing native/engine owner retains actual originals/transcripts. Only its opaque receipt ref is stored here.
      return await this.owner.settleOperation(actor,original.requestId,observed.state,observed.resultRef??null);
    } catch {
      return await this.owner.settleOperation(actor,original.requestId,"unknown",null);
    }
  }
  async receipt(context,workspaceId,requestId) {
    id(workspaceId);id(requestId);const actor=await this.actor(context,"private-workspaces:read",workspaceId);
    // Observation only: neither root creation/acquisition nor execution is reachable on this path.
    return this.owner.readOperation(actor,workspaceId,requestId);
  }
}
export const privateWorkspaceFingerprint=fingerprint;
