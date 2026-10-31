/** Actual request/Core/manager producer composition; no caller-supplied positive ports. */
import {randomUUID,randomBytes,timingSafeEqual} from 'node:crypto';
import {getDb,runtimes,agents} from 'ingenium-core';
import * as provision from 'ingenium-core/lib/tools/runtime-original-provision';
import {workspaceRuntimeCredentialsV2 as credentials} from 'ingenium-core';
import {revalidateRequestIdentity} from '../request-identity.js';
import {runtimeNumberSetting} from '../runtime-provisioner.js';
import {deploymentMode} from '../runtime-mode.js';
import {loadManagerToken} from '../runtime-manager-auth.js';
import {loadInstalledWorkspaceRuntimeV2ImageDefinition} from '../dot-v2/core126-installed-image-owner.js';
import {postOriginalWorkspaceRuntimeV2,inspectOriginalWorkspaceRuntimeV2,authenticatedOriginalWorkspaceProvisionV2} from '../runtime-manager-client.js';
import {qualifyWorkspaceV2Placement} from './workspace-v2-placement.mjs';
const pending=new Map(),inFlight=new Map();
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const dbOf=()=>getDb(process.env.INGENIUM_CORE_DB_PATH);
function currentUser(request,selection){
 if(deploymentMode()!=='control-plane'||!selection||Object.keys(selection).sort().join('|')!=='projectId|runtimeId|workspaceId'||selection.projectId!==null)return fail('WORKSPACE_V2_SELECTION');
 const identity=revalidateRequestIdentity(request);if(identity?.principal.type!=='user'||!identity.principal.session)return fail('WORKSPACE_V2_USER_IDENTITY');
 const w=runtimes.getAuthorizedWorkspaceV2(selection.workspaceId),r=runtimes.getWorkspaceRuntimeV2(selection.runtimeId),db=dbOf();
 if(!w||!r||w.status!=='authorized'||w.ownerUserId!==identity.principal.id||r.workspaceId!==w.id||r.organizationId!==w.organizationId||r.ownerUserId!==w.ownerUserId||r.securityEpoch!==w.securityEpoch
 ||!db.prepare("SELECT 1 FROM organization_memberships m JOIN organizations organization ON organization.id=m.organization_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND organization.status='active'").get(w.organizationId,w.ownerUserId))return fail('WORKSPACE_V2_SCOPE');
 return {workspace:w,runtime:r,identityKey:JSON.stringify([identity.principal.id,identity.principal.session.id,identity.principal.session.security_epoch]),key:JSON.stringify([identity.principal.id,identity.principal.session.id,identity.principal.session.security_epoch,w,r])};
}
export async function provisionWorkspaceRuntimeFromRequestV2(request,selection){
 const first=currentUser(request,selection);if(first.runtime.state!=='ABSENT'||first.runtime.backendContainerId!==null||inFlight.has(first.runtime.id))return fail('WORKSPACE_V2_NEW_RUNTIME_REQUIRED');
 const key=first.runtime.id;inFlight.set(key,'entered');let credential,entry;
 try{
  // Approval/real-v2-bootstrap qualification is required BEFORE issuing a token/effect.
  agents.validateProtectedOpenCodeDeployment();
  const imageId=process.env.INGENIUM_USER_RUNTIME_IMAGE;const definition=loadInstalledWorkspaceRuntimeV2ImageDefinition(imageId);
  if(currentUser(request,selection).key!==first.key)return fail('WORKSPACE_V2_SCOPE_CHANGED');
  const expiresAt=new Date(Date.now()+runtimeNumberSetting('INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS',28800000,60000)),idleLeaseMs=runtimeNumberSetting('INGENIUM_RUNTIME_IDLE_LEASE_MS',1800000,60000);credential=credentials.issueWorkspaceRuntimeCredentialV2(key,expiresAt);
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
 return {publicRequest:e.publicRequest,definition:e.definition,nonce:e.nonce,credentialId:e.credentialId};
}
export function originalWorkspaceProfileV2(runtimeId){
 const db=dbOf(),r=runtimes.getWorkspaceRuntimeV2(runtimeId),raw=db.prepare('SELECT * FROM runtime_original_provisions WHERE runtime_id=? AND schema_version=2 AND project_id IS NULL').get(runtimeId);
 if(!r||!raw||!['STARTING','READY','IDLE'].includes(r.state))return fail('WORKSPACE_V2_ORIGINAL_PROFILE_UNAVAILABLE');
 const w=runtimes.getAuthorizedWorkspaceV2(r.workspaceId),original=provision.readWorkspaceRuntimeOriginalProvision(db,runtimeId);
 if(!w||!original||w.status!=='authorized'||w.securityEpoch!==r.securityEpoch||w.storageMappingHash!==original.bindingHash||w.ownerUserId!==r.ownerUserId||w.organizationId!==r.organizationId||r.backendContainerId!==original.parentContainerId)return fail('WORKSPACE_V2_ORIGINAL_PROFILE_CHANGED');
 return {runtime:r,workspace:w,original,definition:loadInstalledWorkspaceRuntimeV2ImageDefinition(original.imageId)};
}
function manager(request){
 if(request.headers.cookie!==undefined||request.headers.origin!==undefined||request.headers['content-type']!=='application/json')return fail('WORKSPACE_V2_MANAGER_AUTH');
 const a=request.headers.authorization,b='Bearer '+loadManagerToken();if(typeof a!=='string'||Buffer.byteLength(a)!==Buffer.byteLength(b)||!timingSafeEqual(Buffer.from(a),Buffer.from(b)))return fail('WORKSPACE_V2_MANAGER_AUTH');
}
/** Mount before generic user/service auth, exactly like the existing dedicated manager owner.
 * Only these exact private paths receive the original manager/bootstrap audiences. */
export function workspaceV2PrivateIngress(req,res,next){
 const path=req.path;
 if(!['/api/v1/internal/workspace-runtime-v2/admission','/api/v1/internal/workspace-runtime-v2/original','/api/v1/runtime/workspace-v2/bootstrap'].includes(path))return next();
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
   else{if(Object.keys(req.body).join('|')!=='runtimeId')return fail('WORKSPACE_V2_PROFILE_INPUT');data=originalWorkspaceProfileV2(req.body.runtimeId);}
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
 qualifyWorkspaceV2Placement(after.runtime,after.workspace,original,definition,proof);
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
