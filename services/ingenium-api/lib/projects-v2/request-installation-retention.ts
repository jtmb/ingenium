import {authenticateRequestWithoutActivity} from '../middleware/auth.js';
import type {Request} from 'express';
import type {OwnerScope} from '../../../../packages/veyra-projects/contracts.js';
import {getDb,execTransaction,checkpointAfterWrite,settings,authorization} from 'ingenium-core';
import {revalidateRequestIdentity} from '../request-identity.js';
import {toAuthorizationPrincipal} from '../authorization-policy.js';
import {InstallationRetentionOwner,type InstallationRetentionIntent} from './installation-retention.mjs';
import {ProjectError} from './catalog.mjs';
function fail(code:string,status:number):never{throw new ProjectError(code,status)}
function currentBrowser(request:Request){
 const actual=revalidateRequestIdentity(request);
 if(actual?.principal.type!=='user'||!actual.principal.session)fail('BROWSER_SESSION_REQUIRED',401);
 return actual.principal;
}
function owner(request:Request){
 const admitted=currentBrowser(request),db=getDb(process.env.INGENIUM_CORE_DB_PATH);
 if(!authorization.requireInstallationPermission(toAuthorizationPrincipal(admitted),'settings','read').allowed)fail('FORBIDDEN',403);
 const ref=db.prepare(`SELECT i.instance_id,p.organization_id FROM veyra_installation_identity i
  JOIN veyra_installation_legacy_refs r ON r.instance_id=i.instance_id
  JOIN projects p ON p.id=r.legacy_project_id AND p.archived_at IS NULL WHERE i.singleton=1`).get()as{instance_id:string;organization_id:string}|undefined;
 if(!ref||!/^[a-f0-9]{32}$/.test(ref.instance_id))fail('INSTALLATION_MAPPING_REQUIRED',503);
 const scope:OwnerScope=Object.freeze({instanceId:ref.instance_id,organizationId:ref.organization_id,ownerUserId:admitted.id});
 const key=JSON.stringify([admitted.id,admitted.session?.id,admitted.session?.security_epoch]);
 const authorize=(candidate:OwnerScope,action:string,preference:string)=>{
  if(JSON.stringify(candidate)!==JSON.stringify(scope)||preference!=='archive_retention_days'||!['installation:preferences:read','installation:preferences:write'].includes(action))return false;
  const now=currentBrowser(request);if(JSON.stringify([now.id,now.session?.id,now.session?.security_epoch])!==key)return false;
  return authorization.requireInstallationPermission(toAuthorizationPrincipal(now),'settings',action.endsWith(':write')?'write':'read').allowed;
 };
 return{scope,service:new InstallationRetentionOwner({db,transaction:execTransaction,checkpointAfterWrite,authorize,readPreference:settings.getSetting,writePreference:settings.setSetting})};
}
export function readInstallationRetention(request:Request){const o=owner(request);return{data:o.service.read(o.scope)}}
export function writeInstallationRetention(request:Request,intent:InstallationRetentionIntent){const o=owner(request);return o.service.write(o.scope,intent)}

/** Non-secret Chat choices belong to the installation. The protected legacy
 * reference is storage compatibility only; no selected/active workspace owns
 * these preferences. Existing installation permission remains authoritative. */
export interface OriginalInstallationChatOwner {readonly projectId:string;readonly projectName:string;readonly __originalInstallationChatOwner:never;}
type ChatPermission='read'|'write';
const originalChatOwners=new WeakMap<object,{request:Request;database:ReturnType<typeof getDb>;permission:ChatPermission;identity:string;reference:string}>();
function chatIdentity(request:Request,permission:ChatPermission){
 // Preserve the existing legacy bearer contract ONLY after the SAME original
 // authenticator revalidates it. A caller's principal DTO never suffices.
 if(request.principal?.type==='compatibility'){
  const candidate=Object.create(request)as Request;
  Object.defineProperties(candidate,{principal:{value:undefined,writable:true,configurable:true},attestedCoordinationIdentity:{value:undefined,writable:true,configurable:true}});
  try{authenticateRequestWithoutActivity(candidate)}catch{fail('INSTALLATION_CHAT_IDENTITY_REQUIRED',401)}
  if(candidate.principal?.type!=='compatibility'||candidate.principal.id!==request.principal.id||!authorization.requireInstallationPermission(toAuthorizationPrincipal(candidate.principal),'opencode',permission).allowed)fail('INSTALLATION_CHAT_IDENTITY_REQUIRED',401);
  return JSON.stringify({type:candidate.principal.type,id:candidate.principal.id,scopes:candidate.principal.scopes});
 }
 const actual=revalidateRequestIdentity(request);if(!actual)fail('INSTALLATION_CHAT_IDENTITY_REQUIRED',401);
 if(!authorization.requireInstallationPermission(toAuthorizationPrincipal(actual.principal),'opencode',permission).allowed)fail('FORBIDDEN',403);
 const principal=actual.principal;
 return JSON.stringify({type:principal.type,id:principal.id,tokenId:principal.tokenId,organizationId:principal.organizationId,projectId:principal.projectId,scopes:[...new Set(principal.scopes)].sort(),...(principal.type==='user'?{sessionId:principal.session?.id,securityEpoch:principal.session?.security_epoch}:{projectIds:principal.projectIds,workspaceId:principal.workspaceId,audience:principal.audience})});
}
function chatReference(database:ReturnType<typeof getDb>){
 const row=database.prepare(`SELECT i.instance_id,r.legacy_project_id,r.revision,p.name,p.organization_id
  FROM veyra_installation_identity i JOIN veyra_installation_legacy_refs r ON r.instance_id=i.instance_id
  JOIN projects p ON p.id=r.legacy_project_id WHERE i.singleton=1`).get()as{instance_id:string;legacy_project_id:string;revision:number;name:string;organization_id:string}|undefined;
 if(!row||!/^[a-f0-9]{32}$/.test(row.instance_id)||!Number.isSafeInteger(row.revision)||row.revision<1)fail('INSTALLATION_MAPPING_REQUIRED',503);
 return row;
}
export function acquireInstallationChatOwner(request:Request,permission:ChatPermission):OriginalInstallationChatOwner{
 const identity=chatIdentity(request,permission),database=getDb(process.env.INGENIUM_CORE_DB_PATH),reference=chatReference(database);
 const original=Object.freeze({projectId:reference.legacy_project_id,projectName:reference.name})as OriginalInstallationChatOwner;
 originalChatOwners.set(original,{request,database,permission,identity,reference:JSON.stringify(reference)});assertInstallationChatOwner(original,request,permission);return original;
}
/** Revalidate after async catalog work and inside the existing final writer.
 * A copied DTO, changed request, identity, mapping or database cannot be adopted. */
export function assertInstallationChatOwner(original:OriginalInstallationChatOwner,request:Request,permission:ChatPermission):void{
 const retained=originalChatOwners.get(original);
 if(!retained||retained.request!==request||retained.permission!==permission||getDb(process.env.INGENIUM_CORE_DB_PATH)!==retained.database)fail('INSTALLATION_CHAT_OWNER_CHANGED',409);
 if(chatIdentity(request,permission)!==retained.identity||JSON.stringify(chatReference(retained.database))!==retained.reference)fail('INSTALLATION_CHAT_OWNER_CHANGED',409);
}
export function writeInstallationChatPreference(original:OriginalInstallationChatOwner,request:Request,key:'chat_defaults'|'chat_selection',value:string):void{
 if(!['chat_defaults','chat_selection'].includes(key)||typeof value!=='string'||Buffer.byteLength(value)>8192)fail('INVALID_INSTALLATION_PREFERENCE',422);
 execTransaction(()=>{assertInstallationChatOwner(original,request,'write');settings.setSetting(original.projectId,key,value);if(settings.getSetting(original.projectId,key)!==value)fail('INSTALLATION_WRITE_UNVERIFIED',503)});
 checkpointAfterWrite();
}
