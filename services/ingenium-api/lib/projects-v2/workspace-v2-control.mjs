/** Actual request/Core/manager producer composition; no caller-supplied positive ports. */
import {randomUUID,randomBytes,timingSafeEqual} from 'node:crypto';
import {getDb,runtimes,agents} from 'ingenium-core';
import * as provision from 'ingenium-core/lib/tools/runtime-original-provision';
import {workspaceRuntimeCredentialsV2 as credentials} from 'ingenium-core';
import {revalidateRequestIdentity} from '../request-identity.js';
import {runtimeNumberSetting} from '../runtime-provisioner.js';
import {deploymentMode} from '../runtime-mode.js';
import {loadManagerToken} from '../runtime-manager-auth.js';
import {loadInstalledWorkspaceRuntimeV2ImageDefinition,configuredWorkspaceRuntimeImageV2} from '../dot-v2/core126-installed-image-owner.js';
import {preflightOriginalWorkspaceRuntimeV2,postOriginalWorkspaceRuntimeV2,inspectOriginalWorkspaceRuntimeV2,authenticatedOriginalWorkspaceProvisionV2,stopOriginalWorkspaceRuntimeV2,authenticatedWorkspaceRetirementV2,finishOriginalWorkspaceRetirementV2} from '../runtime-manager-client.js';
import {qualifyWorkspaceV2Placement} from './workspace-v2-placement.mjs';
const pending=new Map(),inFlight=new Map(),notDispatchedStarts=new WeakMap();
export function workspaceStartWasNotDispatched(error,runtimeId){return !!error&&typeof error==='object'&&notDispatchedStarts.get(error)===runtimeId;}
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const dbOf=()=>getDb(process.env.INGENIUM_CORE_DB_PATH);
function currentUser(request,selection){
 if(deploymentMode()!=='control-plane'||!selection||Object.keys(selection).sort().join('|')!=='projectId|runtimeId|workspaceId'||selection.projectId!==null)return fail('WORKSPACE_V2_SELECTION');
 const identity=revalidateRequestIdentity(request);if(identity?.principal.type!=='user'||!identity.principal.session)return fail('WORKSPACE_V2_USER_IDENTITY');
 const w=runtimes.getAuthorizedWorkspaceV2(selection.workspaceId),r=runtimes.getWorkspaceRuntimeV2(selection.runtimeId),db=dbOf();
 if(!w||!r||w.status!=='authorized'||w.ownerUserId!==identity.principal.id||r.workspaceId!==w.id||r.organizationId!==w.organizationId||r.ownerUserId!==w.ownerUserId||r.securityEpoch!==w.securityEpoch
 ||!db.prepare("SELECT 1 FROM organization_memberships m JOIN organizations organization ON organization.id=m.organization_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND organization.status='active'").get(w.organizationId,w.ownerUserId))return fail('WORKSPACE_V2_SCOPE');
 const installation=db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get();
 if(!installation||typeof installation.instance_id!=='string'||!/^[a-f0-9]{32}$/.test(installation.instance_id))return fail('WORKSPACE_V2_INSTALLATION_IDENTITY');
 const installationId=installation.instance_id;
 return {workspace:w,runtime:r,installationId,identityKey:JSON.stringify([identity.principal.id,identity.principal.session.id,identity.principal.session.security_epoch,installationId]),key:JSON.stringify([identity.principal.id,identity.principal.session.id,identity.principal.session.security_epoch,installationId,w,r])};
}
export async function provisionWorkspaceRuntimeFromRequestV2(request,selection){
 const first=currentUser(request,selection);if(first.runtime.state!=='ABSENT'||first.runtime.backendContainerId!==null||inFlight.has(first.runtime.id))return fail('WORKSPACE_V2_NEW_RUNTIME_REQUIRED');
 const key=first.runtime.id;inFlight.set(key,'entered');let credential,entry;
 try{
  // Approval/real-v2-bootstrap qualification is required BEFORE issuing a token/effect.
  let definition;
  try{
   agents.validateProtectedOpenCodeDeployment();
   definition=loadInstalledWorkspaceRuntimeV2ImageDefinition(configuredWorkspaceRuntimeImageV2());
   if(definition.backendKind==='kubernetes'){
    const w=first.workspace,r=first.runtime;
    const probe=provision.publicWorkspaceProvisionRequest({schemaVersion:2,scopeKind:'workspace',projectId:null,originalRequestId:randomUUID(),runtimeId:r.id,
      backendName:r.backendName,organizationId:r.organizationId,ownerUserId:r.ownerUserId,workspaceId:w.id,storagePath:w.storagePath,
      storageMappingHash:w.storageMappingHash,securityEpoch:w.securityEpoch,revision:r.revision,limits:Object.fromEntries(['cpuMillis','memoryBytes','pidsLimit','diskBytes','processLimit'].map(k=>[k,r[k]]))});
    await preflightOriginalWorkspaceRuntimeV2({publicRequest:probe,definition,retiredPredecessors:retiredPredecessorsV2(dbOf(),probe)});
   }
   if(currentUser(request,selection).key!==first.key)return fail('WORKSPACE_V2_SCOPE_CHANGED');
  }catch(cause){const error=Object.assign(Error('WORKSPACE_V2_START_NOT_DISPATCHED'),{code:'WORKSPACE_V2_START_NOT_DISPATCHED',status:503,cause});notDispatchedStarts.set(error,key);throw error;}
  // The sealed error above can exist only before credential issuance or runtime mutation.
  const expiresAt=new Date(Date.now()+runtimeNumberSetting('INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS',28800000,60000)),idleLeaseMs=runtimeNumberSetting('INGENIUM_RUNTIME_IDLE_LEASE_MS',1800000,60000);credential=credentials.issueWorkspaceRuntimeCredentialV2(key,expiresAt,{profile:'agent-memory-read'});
  runtimes.bindWorkspaceRuntimeCapabilityV2(key,credential.id);
  let runtime=runtimes.transitionWorkspaceRuntimeV2({id:key,expectedRevision:first.runtime.revision,toState:'PROVISIONING',actorType:'manager',actorId:'runtime-manager',backendContainerId:null,maxActiveRuntimes:runtimeNumberSetting('INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER',2,1),idleExpiresAt:new Date(Math.min(Date.now()+idleLeaseMs,expiresAt.getTime())),absoluteExpiresAt:expiresAt});
  runtime=runtimes.claimWorkspaceRuntimeLeaseV2({id:key,expectedRevision:runtime.revision,ownerToken:randomBytes(32).toString('base64url'),ttlMs:60000,actorId:'runtime-manager'});
  const originalRequestId=randomUUID(),nonce=randomBytes(32).toString('hex'),w=first.workspace;
  const publicRequest=provision.publicWorkspaceProvisionRequest({schemaVersion:2,scopeKind:'workspace',projectId:null,originalRequestId,runtimeId:runtime.id,backendName:runtime.backendName,organizationId:runtime.organizationId,ownerUserId:runtime.ownerUserId,workspaceId:w.id,storagePath:w.storagePath,storageMappingHash:w.storageMappingHash,securityEpoch:w.securityEpoch,revision:runtime.revision,limits:Object.fromEntries(['cpuMillis','memoryBytes','pidsLimit','diskBytes','processLimit'].map(k=>[k,runtime[k]]))});
  entry={request,selection:{...selection},identityKey:first.identityKey,publicRequest,definition,credentialId:credential.id,nonce,deadline:Date.now()+45000,db:dbOf(),bootstrapAcknowledged:false};pending.set(originalRequestId,entry);
  const result=await postOriginalWorkspaceRuntimeV2({...publicRequest,capability:credential.token,capabilityExpiresAt:credential.expiresAt,bootstrapNonce:nonce});
  credential.token='';
  const same=currentUser(request,selection);if(authenticatedOriginalWorkspaceProvisionV2(result)?.startIdentity!==entry.startIdentity||same.identityKey!==first.identityKey||same.workspace.storageMappingHash!==w.storageMappingHash||same.workspace.securityEpoch!==w.securityEpoch||same.runtime.revision!==runtime.revision||same.runtime.state!=='PROVISIONING'||!entry.bootstrapAcknowledged||Date.now()>=entry.deadline)return fail('WORKSPACE_V2_ORIGINAL_CHANGED');
  runtime=runtimes.transitionWorkspaceRuntimeV2({id:key,expectedRevision:runtime.revision,toState:'STARTING',actorType:'manager',actorId:'runtime-manager',backendContainerId:result.backendId,originalProvision:authenticatedOriginalWorkspaceProvisionV2(result)});
  return runtime; // STARTING is not READY, placement, MCP/voice acceptance or an engine conversation.
 }catch(error){if(credential){credential.token='';credentials.revokeWorkspaceRuntimeCredentialV2(key,credential.id);}throw error;}
 finally{if(entry)pending.delete(entry.publicRequest.originalRequestId);inFlight.delete(key);}
}
function pendingEntry(selector){
 const entry=pending.get(selector.requestId);if(!entry||entry.deadline<=Date.now()||entry.db!==dbOf()||selector.runtimeId!==entry.publicRequest.runtimeId||selector.requestSha256!==provision.provisionHash(entry.publicRequest))return fail('WORKSPACE_V2_ORIGINAL_ADMISSION_UNAVAILABLE');
 const identity=currentUser(entry.request,entry.selection);if(identity.identityKey!==entry.identityKey)return fail('WORKSPACE_V2_ORIGINAL_IDENTITY_CHANGED');
 const r=runtimes.getWorkspaceRuntimeV2(selector.runtimeId),w=runtimes.getAuthorizedWorkspaceV2(entry.publicRequest.workspaceId);
 if(!r||!w||r.state!=='PROVISIONING'||r.revision!==entry.publicRequest.revision||r.backendContainerId!==null||r.securityEpoch!==entry.publicRequest.securityEpoch||w.status!=='authorized'||w.securityEpoch!==r.securityEpoch||w.storageMappingHash!==entry.publicRequest.storageMappingHash||!Number.isFinite(Date.parse(r.leaseExpiresAt))||Date.parse(r.leaseExpiresAt)<=Date.now())return fail('WORKSPACE_V2_ORIGINAL_ADMISSION_CHANGED');
 return entry;
}
export function originalWorkspaceAdmissionV2(selector){
 const e=pendingEntry(selector);const current=loadInstalledWorkspaceRuntimeV2ImageDefinition(e.definition.imageId);
 if(JSON.stringify(current)!==JSON.stringify(e.definition))return fail('WORKSPACE_V2_IMAGE_APPROVAL_CHANGED');
 return {publicRequest:e.publicRequest,definition:e.definition,nonce:e.nonce,credentialId:e.credentialId,retiredPredecessors:retiredPredecessorsV2(e.db,e.publicRequest)};
}
// The stored receipt's recordedAt is database metadata, not a field in the
// closed physical-original protocol or its hash.
function wireWorkspaceOriginalV2(stored){
 const {recordedAt,...original}=stored;
 return provision.decodeWorkspaceRuntimeOriginalProvision(original);
}
function retiredPredecessorsV2(db,publicRequest){
 const rows=db.prepare('SELECT r.id,r.backend_name,r.state FROM runtime_instances r WHERE r.workspace_id=? AND r.id<>? ORDER BY r.id LIMIT 513').all(publicRequest.workspaceId,publicRequest.runtimeId);
 if(rows.length>512)return fail('WORKSPACE_V2_PREDECESSOR_BOUND');
 return rows.map(row=>{
  const original=provision.readWorkspaceRuntimeOriginalProvision(db,row.id),receipt=db.prepare('SELECT * FROM workspace_execution_retirements WHERE runtime_id=?').get(row.id);
  if(!original||!receipt||!['STOPPED','FAILED','REVOKED'].includes(row.state)||receipt.workspace_id!==publicRequest.workspaceId||receipt.parent_container_id!==original.parentContainerId||receipt.daemon_id!==original.daemonId||receipt.start_identity!==original.startIdentity||receipt.public_profile_sha256!==original.publicProfileSha256||receipt.original_request_sha256!==original.requestSha256)return fail('WORKSPACE_V2_PREDECESSOR_RETIREMENT_REQUIRED');
  return {runtimeId:row.id,backendName:row.backend_name,original:wireWorkspaceOriginalV2(original),finishedAt:receipt.finished_at,proofSha256:receipt.proof_sha256};
 });
}
export function originalWorkspaceProfileV2(runtimeId){
 const db=dbOf(),r=runtimes.getWorkspaceRuntimeV2(runtimeId),raw=db.prepare('SELECT * FROM runtime_original_provisions WHERE runtime_id=? AND schema_version=2 AND project_id IS NULL').get(runtimeId);
 if(!r||!raw||!['STARTING','READY','IDLE'].includes(r.state))return fail('WORKSPACE_V2_ORIGINAL_PROFILE_UNAVAILABLE');
 const w=runtimes.getAuthorizedWorkspaceV2(r.workspaceId),original=provision.readWorkspaceRuntimeOriginalProvision(db,runtimeId);
 if(!w||!original||w.status!=='authorized'||w.securityEpoch!==r.securityEpoch||w.storageMappingHash!==original.bindingHash||w.ownerUserId!==r.ownerUserId||w.organizationId!==r.organizationId||r.backendContainerId!==original.parentContainerId)return fail('WORKSPACE_V2_ORIGINAL_PROFILE_CHANGED');
 return {runtime:r,workspace:w,original:wireWorkspaceOriginalV2(original),definition:loadInstalledWorkspaceRuntimeV2ImageDefinition(original.imageId)};
}
function manager(request){
 if(request.headers.cookie!==undefined||request.headers.origin!==undefined||request.headers['content-type']!=='application/json')return fail('WORKSPACE_V2_MANAGER_AUTH');
 const a=request.headers.authorization,b='Bearer '+loadManagerToken();if(typeof a!=='string'||Buffer.byteLength(a)!==Buffer.byteLength(b)||!timingSafeEqual(Buffer.from(a),Buffer.from(b)))return fail('WORKSPACE_V2_MANAGER_AUTH');
}
/** Mount before generic user/service auth, exactly like the existing dedicated manager owner.
 * Only these exact private paths receive the original manager/bootstrap audiences. */
export function workspaceV2PrivateIngress(req,res,next){
 const path=req.path;
 if(!['/api/v1/internal/workspace-runtime-v2/admission','/api/v1/internal/workspace-runtime-v2/original','/api/v1/internal/workspace-runtime-v2/retirement','/api/v1/internal/workspace-runtime-v2/retired','/api/v1/runtime/workspace-v2/bootstrap'].includes(path))return next();
 try{
  if(req.method!=='POST'||req.originalUrl!==path||!req.body||JSON.stringify(req.body).length>2048)return fail('WORKSPACE_V2_PRIVATE_INPUT');
  let data;
  if(path.endsWith('/bootstrap')){
   if(req.headers.cookie!==undefined||req.headers.origin!==undefined||req.headers['content-type']!=='application/json')return fail('WORKSPACE_V2_BOOTSTRAP_AUTH');
   const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
   const c=credentials.inspectWorkspaceBootstrapCredentialV2(token),input=req.body;
   if(!c||Object.keys(input).sort().join('|')!=='bindingHash|nonce|requestId|runtimeId|schemaVersion|startIdentity|workspaceId'||input.schemaVersion!==2||input.runtimeId!==c.runtimeId||input.workspaceId!==c.workspaceId||input.bindingHash!==c.bindingHash)return fail('WORKSPACE_V2_BOOTSTRAP_AUTH');
   const entries=[...pending.values()].filter(e=>e.publicRequest.runtimeId===c.runtimeId&&e.credentialId===c.credentialId&&e.nonce===input.nonce&&e.deadline>Date.now());if(entries.length!==1)return fail('WORKSPACE_V2_BOOTSTRAP_ADMISSION');
   const e=entries[0];if(input.requestId!==e.publicRequest.originalRequestId||typeof input.startIdentity!=='string'||!(/^[a-f0-9]{64}$/).test(input.startIdentity)||(e.startIdentity&&e.startIdentity!==input.startIdentity))return fail('WORKSPACE_V2_BOOTSTRAP_START_CHANGED');e.startIdentity=input.startIdentity;pendingEntry({requestId:e.publicRequest.originalRequestId,runtimeId:c.runtimeId,requestSha256:provision.provisionHash(e.publicRequest)});e.bootstrapAcknowledged=true;
   data={schemaVersion:2,nonce:e.nonce,runtimeId:c.runtimeId,workspaceId:c.workspaceId,bindingHash:c.bindingHash,bindingEpoch:c.bindingEpoch,credentialId:c.credentialId,organizationId:c.organizationId,ownerUserId:c.ownerUserId,projectId:null,startIdentity:e.startIdentity,requestId:e.publicRequest.originalRequestId};
  }else{
   manager(req);
   if(path.endsWith('/admission')){if(Object.keys(req.body).sort().join('|')!=='requestId|requestSha256|runtimeId')return fail('WORKSPACE_V2_ADMISSION_INPUT');data=originalWorkspaceAdmissionV2(req.body);}
   else{if(Object.keys(req.body).join('|')!=='runtimeId')return fail('WORKSPACE_V2_PROFILE_INPUT');data=path.endsWith('/retirement')?originalWorkspaceRetirementProfileV2(req.body.runtimeId):path.endsWith('/retired')?originalWorkspaceRetiredProfileV2(req.body.runtimeId):originalWorkspaceProfileV2(req.body.runtimeId);}
  }
  res.status(200).json({data});
 }catch(error){res.status(error.status??503).json({error:{code:error.code??'WORKSPACE_V2_PRIVATE_UNAVAILABLE'}});}
}
export async function refreshWorkspaceRuntimeFromRequestV2(request,selection){
 const before=currentUser(request,selection);if(before.runtime.state!=='STARTING')return fail('WORKSPACE_V2_STARTING_REQUIRED');
 const proof=await inspectOriginalWorkspaceRuntimeV2(selection.runtimeId); // fixed original manager/authenticated response
 const after=currentUser(request,selection);if(after.key!==before.key)return fail('WORKSPACE_V2_SCOPE_CHANGED');
 const original=provision.readWorkspaceRuntimeOriginalProvision(dbOf(),selection.runtimeId);
 const definition=loadInstalledWorkspaceRuntimeV2ImageDefinition(original?.imageId);
 qualifyWorkspaceV2Placement(after.runtime,after.workspace,original,definition,proof,after.installationId);
 const runtime=runtimes.recordWorkspaceRuntimeHealthV2(after.runtime.id,after.runtime.revision,after.runtime.backendContainerId);
 return runtimes.transitionWorkspaceRuntimeV2({id:runtime.id,expectedRevision:runtime.revision,toState:'READY',actorType:'manager',actorId:'runtime-manager'});
}

export function requireOriginalWorkspaceMcpAdmissionV2(c,nonce){
 if(c.runtimeState==='PROVISIONING'){
  const entries=[...pending.values()].filter(e=>e.publicRequest.runtimeId===c.runtimeId&&e.credentialId===c.credentialId&&e.nonce===nonce&&e.bootstrapAcknowledged&&e.deadline>Date.now());if(entries.length!==1)return fail('WORKSPACE_MCP_ORIGINAL_ADMISSION_REQUIRED');
  const e=entries[0];pendingEntry({runtimeId:c.runtimeId,requestId:e.publicRequest.originalRequestId,requestSha256:provision.provisionHash(e.publicRequest)});return;
 }
 const original=provision.readWorkspaceRuntimeOriginalProvision(dbOf(),c.runtimeId),r=runtimes.getWorkspaceRuntimeV2(c.runtimeId);
 if(!original||!r||!['STARTING','READY','IDLE'].includes(r.state)||original.projectId!==null||original.workspaceId!==c.workspaceId||original.organizationId!==c.organizationId||original.ownerUserId!==c.ownerUserId||original.bindingHash!==c.bindingHash||original.bindingEpoch!==c.bindingEpoch||original.parentContainerId!==r.backendContainerId)return fail('WORKSPACE_MCP_PERSISTED_ORIGINAL_REQUIRED');
}

function originalWorkspaceRetirementProfileV2(runtimeId){
 const r=runtimes.getWorkspaceRuntimeV2(runtimeId),db=dbOf(),o=provision.readWorkspaceRuntimeOriginalProvision(db,runtimeId),w=o&&runtimes.getAuthorizedWorkspaceV2(o.workspaceId);
 if(!r||!o||!w||r.state!=='STOPPING'||r.backendContainerId!==o.parentContainerId||r.workspaceId!==o.workspaceId||w.id!==o.workspaceId||r.ownerUserId!==o.ownerUserId||r.organizationId!==o.organizationId||w.ownerUserId!==o.ownerUserId||w.organizationId!==o.organizationId||w.storageMappingHash!==o.bindingHash) return fail('WORKSPACE_V2_RETIREMENT_PROFILE_UNAVAILABLE');
 return {runtime:r,workspace:w,original:wireWorkspaceOriginalV2(o)};
}
function originalWorkspaceRetiredProfileV2(runtimeId){
 const db=dbOf(),r=runtimes.getWorkspaceRuntimeV2(runtimeId),o=provision.readWorkspaceRuntimeOriginalProvision(db,runtimeId),w=o&&runtimes.getAuthorizedWorkspaceV2(o.workspaceId);
 const receipt=db.prepare('SELECT * FROM workspace_execution_retirements WHERE runtime_id=?').get(runtimeId);
 if(!r||!o||!w||o.backendKind!=='kubernetes'||!['STOPPED','FAILED','REVOKED'].includes(r.state)||!receipt||r.backendContainerId!==o.parentContainerId||r.workspaceId!==o.workspaceId||r.ownerUserId!==o.ownerUserId||r.organizationId!==o.organizationId||w.ownerUserId!==o.ownerUserId||w.organizationId!==o.organizationId||w.storageMappingHash!==o.bindingHash||receipt.workspace_id!==o.workspaceId||receipt.parent_container_id!==o.parentContainerId||receipt.daemon_id!==o.daemonId||receipt.start_identity!==o.startIdentity||receipt.public_profile_sha256!==o.publicProfileSha256||receipt.original_request_sha256!==o.requestSha256||!Number.isFinite(Date.parse(receipt.finished_at))||!(/^[a-f0-9]{64}$/).test(receipt.proof_sha256))return fail('WORKSPACE_V2_RETIRED_PROFILE_UNAVAILABLE');
 return {runtime:r,workspace:w,original:wireWorkspaceOriginalV2(o),retirement:{finishedAt:receipt.finished_at,proofSha256:receipt.proof_sha256}};
}
export async function stopWorkspaceRuntimeFromRequestV2(request,selection){
 const first=currentUser(request,selection);if(inFlight.has(first.runtime.id))return fail('WORKSPACE_V2_IN_FLIGHT');
 inFlight.set(first.runtime.id,'retirement');
 try{
  const original=provision.readWorkspaceRuntimeOriginalProvision(dbOf(),first.runtime.id);
  if(original?.backendKind==='kubernetes'&&['STOPPED','FAILED'].includes(first.runtime.state)){
   originalWorkspaceRetiredProfileV2(first.runtime.id);
   await finishOriginalWorkspaceRetirementV2(first.runtime.id);
   return currentUser(request,selection).runtime;
  }
  const stopping=runtimes.beginWorkspaceRuntimeRetirementV2(first.runtime.id,first.runtime.revision,first.workspace.ownerUserId);
  const proof=await stopOriginalWorkspaceRuntimeV2(stopping.id),same=currentUser(request,selection);
  if(!authenticatedWorkspaceRetirementV2(proof)||same.identityKey!==first.identityKey||same.workspace.storageMappingHash!==first.workspace.storageMappingHash||same.workspace.securityEpoch!==first.workspace.securityEpoch||same.runtime.revision!==stopping.revision||same.runtime.state!=='STOPPING')return fail('WORKSPACE_V2_RETIREMENT_SCOPE_CHANGED');
  const stopped=runtimes.recordWorkspaceRuntimeRetirementV2(stopping.id,stopping.revision,proof,'runtime-manager');
  // Persist the physical stopped receipt before releasing Kubernetes' finalizer.
  // An interrupted cleanup can then be retried without replaying an old start.
  if(original?.backendKind==='kubernetes')await finishOriginalWorkspaceRetirementV2(stopped.id);
  return stopped;
 }finally{inFlight.delete(first.runtime.id);}
}
export function prepareWorkspaceSuccessorFromRequestV2(request,selection){
 const first=currentUser(request,selection),r=first.runtime;
 if(!['STOPPED','FAILED'].includes(r.state)||inFlight.has(r.id))return fail('WORKSPACE_V2_RETIRED_RUNTIME_REQUIRED');
 const receipt=dbOf().prepare('SELECT runtime_id FROM workspace_execution_retirements WHERE runtime_id=?').get(r.id);
 if(!receipt)return fail('WORKSPACE_V2_RETIREMENT_REQUIRED');
 const current=dbOf().prepare('SELECT runtime_id FROM workspace_execution_generations WHERE workspace_id=? ORDER BY generation DESC LIMIT 1').get(r.workspaceId);
 if(current?.runtime_id!==r.id||currentUser(request,selection).key!==first.key)return fail('WORKSPACE_V2_SCOPE_CHANGED');
 return runtimes.createWorkspaceRuntimeV2(r.workspaceId,Object.fromEntries(['cpuMillis','memoryBytes','pidsLimit','diskBytes','processLimit'].map(key=>[key,r[key]])));
}
