import {AsyncLocalStorage} from 'node:async_hooks';
import {getDb,runtimes} from 'ingenium-core';
import * as provision from 'ingenium-core/lib/tools/runtime-original-provision';
import {revalidateRequestIdentity} from '../request-identity.js';
import {deploymentMode} from '../runtime-mode.js';
import {loadInstalledWorkspaceRuntimeV2ImageDefinition} from '../dot-v2/core126-installed-image-owner.js';
import {inspectOriginalWorkspaceRuntimeV2} from '../runtime-manager-client.js';
const local=new AsyncLocalStorage();
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
function current(request,selection){
 if(deploymentMode()!=='control-plane'||!selection||Object.keys(selection).sort().join('|')!=='projectId|runtimeId|workspaceId'||selection.projectId!==null)return fail('WORKSPACE_V2_EXECUTION_SELECTION');
 const identity=revalidateRequestIdentity(request);if(identity?.principal.type!=='user'||!identity.principal.session)return fail('WORKSPACE_V2_USER_IDENTITY');
 const db=getDb(process.env.INGENIUM_CORE_DB_PATH),runtime=runtimes.getWorkspaceRuntimeV2(selection.runtimeId),workspace=runtimes.getAuthorizedWorkspaceV2(selection.workspaceId),original=provision.readWorkspaceRuntimeOriginalProvision(db,selection.runtimeId);
 if(!runtime||!workspace||!original||workspace.status!=='authorized'||runtime.workspaceId!==workspace.id||workspace.ownerUserId!==identity.principal.id||runtime.ownerUserId!==workspace.ownerUserId||runtime.organizationId!==workspace.organizationId||runtime.securityEpoch!==workspace.securityEpoch
 ||!db.prepare("SELECT 1 FROM organization_memberships WHERE organization_id=? AND user_id=? AND status='active'").get(workspace.organizationId,workspace.ownerUserId))return fail('WORKSPACE_V2_EXECUTION_SCOPE');
 const definition=loadInstalledWorkspaceRuntimeV2ImageDefinition(original.imageId);
 return {db,runtime,workspace,original,definition,key:JSON.stringify([identity.principal.id,identity.principal.session.id,identity.principal.session.security_epoch,runtime,workspace,original,definition])};
}
/** Complete original-profile binding; a label or healthy current row cannot mint it. */
export function qualifyWorkspaceV2Placement(r,w,o,d,proof){
 const now=Date.now();if(!r||!w||!o||!d||r.projectId!==null||w.projectId!==null||o.projectId!==null||o.schemaVersion!==2||d.schemaVersion!==2||!Number.isSafeInteger(d.validUntil)||d.validUntil<=now||!proof||proof.schemaVersion!==2||proof.kind!=='original-workspace-runtime-v2-placement'||proof.observedAt>now||proof.expiresAt!==proof.observedAt+5000||proof.expiresAt<=now||proof.definitionSha256!==provision.provisionHash(d)||proof.imageId!==d.imageId||proof.imageId!==o.imageId||proof.daemonId!==o.daemonId||proof.hostId!==o.hostId
 ||proof.runtimeId!==r.id||proof.parentContainerId!==r.backendContainerId||proof.parentContainerId!==o.parentContainerId||proof.startIdentity!==o.startIdentity||proof.publicProfileSha256!==o.publicProfileSha256||proof.provisioningRevision!==o.provisioningRevision
 ||proof.organizationId!==r.organizationId||proof.ownerUserId!==r.ownerUserId||proof.workspaceId!==w.id||proof.projectId!==null||proof.bindingHash!==w.storageMappingHash||proof.bindingEpoch!==w.securityEpoch||r.securityEpoch!==w.securityEpoch||o.bindingHash!==w.storageMappingHash||o.bindingEpoch!==w.securityEpoch||proof.health!=='healthy'||proof.state!=='running'
 ||!Array.isArray(proof.artifacts)||proof.artifacts.length!==d.files.length||d.files.some(f=>!proof.artifacts.some(p=>p.path===f.path&&p.sha256===f.sha256&&p.bytes===f.bytes))
 ||[r.absoluteExpiresAt,r.idleExpiresAt,...(r.leaseExpiresAt===null?[]:[r.leaseExpiresAt])].some(v=>!Number.isFinite(Date.parse(v))||Date.parse(v)<=now))return fail('WORKSPACE_V2_ORIGINAL_PLACEMENT_UNAVAILABLE');
 return Object.freeze({organizationId:w.organizationId,ownerUserId:w.ownerUserId,projectId:null,workspaceId:w.id,bindingHash:w.storageMappingHash,bindingEpoch:w.securityEpoch,status:'authorized',runtimeId:r.id,mode:'runtime',hostId:proof.hostId,environmentId:'managed-workspace-runtime-v2:'+proof.imageId,available:true});
}
export async function withManagedWorkspaceV2Placement(request,selection,work){
 if(typeof work!=='function')return fail('WORKSPACE_V2_WORK_CALLBACK');const initial=current(request,selection);
 if(!['READY','IDLE'].includes(initial.runtime.state))return fail('WORKSPACE_V2_RUNTIME_NOT_READY');
 const proof=await inspectOriginalWorkspaceRuntimeV2(initial.runtime.id),final=current(request,selection);
 if(final.key!==initial.key)return fail('WORKSPACE_V2_BINDING_CHANGED');qualifyWorkspaceV2Placement(final.runtime,final.workspace,final.original,final.definition,proof);
 const lease={key:final.key,proof,db:final.db,active:true};try{return await local.run(lease,work);}finally{lease.active=false;}
}
export function resolveCurrentWorkspaceV2Execution(request,selection){
 const lease=local.getStore(),facts=current(request,selection);if(!lease?.active||lease.db!==facts.db||lease.key!==facts.key||!['READY','IDLE'].includes(facts.runtime.state))return fail('WORKSPACE_V2_ORIGINAL_PLACEMENT_CONTEXT_REQUIRED');
 return qualifyWorkspaceV2Placement(facts.runtime,facts.workspace,facts.original,facts.definition,lease.proof);
}
