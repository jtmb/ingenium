// Explicit Core137 credential owner. Never broadens v1 Project joins/DTOs.
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {getDb,execTransaction,checkpointAfterWrite} from '../db.js';
import {hashSecurityToken,encryptAuthSecret,decryptAuthSecret} from './authentication.js';
import {deriveWorkspaceRuntimeOpenCodePasswordV2} from './workspace-runtime-auth.mjs';
const bindingDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopes=Object.freeze(['child-mcp:runtime','runtime:activity','workspace-runtime:bootstrap']);
const memoryScopes=Object.freeze([...scopes,'memory:read']);
const recordedScopes=value=>value===JSON.stringify(scopes)?scopes:value===JSON.stringify(memoryScopes)?memoryScopes:null;
const fail=()=>{throw Object.assign(Error('WORKSPACE_RUNTIME_CREDENTIAL_UNAVAILABLE'),{code:'WORKSPACE_RUNTIME_CREDENTIAL_UNAVAILABLE',status:401});};
const dbOf=()=>getDb(process.env.INGENIUM_CORE_DB_PATH);
export function issueWorkspaceRuntimeCredentialV2(runtimeId,expiresAt,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='profile')||options.profile!==undefined&&!['scope-only','agent-memory-read'].includes(options.profile))return fail();
 const grantedScopes=options.profile==='agent-memory-read'?memoryScopes:scopes;
 const end=expiresAt instanceof Date?expiresAt.toISOString():null;if(!end||Date.parse(end)<=Date.now())return fail();
 const result=execTransaction(()=>{
  const db=dbOf(),w=db.prepare(`SELECT w.*,r.state,u.security_epoch AS user_epoch FROM runtime_instances r JOIN authorized_workspaces w ON w.id=r.workspace_id
   JOIN organization_memberships m ON m.organization_id=w.organization_id AND m.user_id=w.owner_user_id
   JOIN users u ON u.id=w.owner_user_id AND u.status='active' JOIN organizations organization ON organization.id=w.organization_id AND organization.status='active'
   WHERE r.id=? AND r.schema_version=2 AND r.project_id IS NULL AND r.state='ABSENT' AND r.backend_container_id IS NULL
   AND w.schema_version=2 AND w.project_id IS NULL AND w.status='authorized' AND w.security_epoch=r.security_epoch
   AND w.organization_id=r.organization_id AND w.owner_user_id=r.owner_user_id AND m.status='active'`).get(runtimeId);
  if(!w||db.prepare('SELECT 1 FROM runtime_capability_bindings WHERE runtime_id=?').get(runtimeId))return fail();
  if(!Number.isSafeInteger(w.user_epoch)||w.user_epoch<0)return fail();
  const secret=randomBytes(32);secret.writeBigUInt64BE(BigInt(w.user_epoch),0); // DB hash binds actual issued user epoch;192 random bits remain.
  const principalId=randomUUID(),id=randomUUID(),prefix='ing_'+randomBytes(9).toString('base64url'),token=prefix+'_'+secret.toString('base64url'),now=new Date().toISOString();secret.fill(0);
  db.prepare("INSERT INTO service_principals(id,organization_id,name,status,security_epoch,created_at,updated_at) VALUES(?,?,?,'active',?,?,?)").run(principalId,w.organization_id,'Workspace runtime '+runtimeId,w.security_epoch,now,now);
  db.prepare(`INSERT INTO mcp_credentials(id,service_principal_id,kind,audience,name,token_prefix,token_hash,scopes_json,organization_id,project_id,project_grants_json,workspace_id,launcher_worktree,security_epoch,expires_at,created_by_user_id,created_at,schema_version)
   VALUES(?,?,'runtime','runtime',?,?,?,?,?,NULL,'[]',?,?,?,?,?,?,2)`).run(id,principalId,'Workspace runtime '+runtimeId,prefix,hashSecurityToken(token),JSON.stringify(grantedScopes),w.organization_id,w.id,w.storage_path,w.security_epoch,end,w.owner_user_id,now);
  db.prepare('INSERT INTO mcp_credential_receipts(idempotency_key,request_hash,credential_id,encrypted_token) VALUES(?,?,?,?)').run('workspace-runtime-v2:'+runtimeId,bindingDigest([2,runtimeId,id,w.id,w.organization_id,w.owner_user_id,w.storage_mapping_hash,w.security_epoch,w.user_epoch,...(grantedScopes===memoryScopes?['agent-memory-read']:[])]),id,encryptAuthSecret(token));
  return {id,token,servicePrincipalId:principalId,expiresAt:end,projectId:null,workspaceId:w.id,organizationId:w.organization_id,ownerUserId:w.owner_user_id,bindingHash:w.storage_mapping_hash,bindingEpoch:w.security_epoch};
 });checkpointAfterWrite();return result;
}
function inspect(token,phase){
 if(typeof token!=='string'||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token))return undefined;
 const bytes=Buffer.from(token.slice(17),'base64url');if(bytes.length!==32)return undefined;const issuedUserEpoch=bytes.readBigUInt64BE(0);bytes.fill(0);if(issuedUserEpoch>BigInt(Number.MAX_SAFE_INTEGER))return undefined;
 const db=dbOf(),now=new Date().toISOString();
 const row=db.prepare(`SELECT c.id,c.service_principal_id,c.organization_id,c.workspace_id,c.created_by_user_id,c.security_epoch,c.expires_at,c.scopes_json,w.storage_mapping_hash,r.id AS runtime_id,r.state,receipt.request_hash AS grant_request_hash
 FROM mcp_credentials c JOIN service_principals p ON p.id=c.service_principal_id
 JOIN authorized_workspaces w ON w.id=c.workspace_id JOIN runtime_instances r ON r.workspace_id=w.id
 JOIN mcp_credential_receipts receipt ON receipt.idempotency_key='workspace-runtime-v2:'||r.id AND receipt.credential_id=c.id
 JOIN runtime_capability_bindings b ON b.runtime_id=r.id AND b.mcp_credential_id=c.id
 JOIN organization_memberships m ON m.organization_id=w.organization_id AND m.user_id=w.owner_user_id
 JOIN users u ON u.id=w.owner_user_id AND u.status='active' JOIN organizations organization ON organization.id=w.organization_id AND organization.status='active'
 WHERE c.token_hash=? AND c.schema_version=2 AND c.project_id IS NULL AND c.project_grants_json='[]' AND c.kind='runtime' AND c.audience='runtime'
 AND c.revoked_at IS NULL AND c.rotated_to_id IS NULL AND c.expires_at>? AND p.status='active'
 AND p.organization_id=c.organization_id AND p.security_epoch=c.security_epoch
 AND w.schema_version=2 AND w.project_id IS NULL AND w.status='authorized' AND w.organization_id=c.organization_id
 AND w.owner_user_id=c.created_by_user_id AND w.storage_path=c.launcher_worktree AND w.security_epoch=c.security_epoch
 AND r.schema_version=2 AND r.project_id IS NULL AND r.organization_id=w.organization_id AND r.owner_user_id=w.owner_user_id
 AND r.security_epoch=w.security_epoch AND r.absolute_expires_at>? AND r.idle_expires_at>?
 AND b.schema_version=2 AND b.project_id IS NULL AND b.organization_id=w.organization_id AND b.owner_user_id=w.owner_user_id
 AND u.security_epoch=?
 AND b.workspace_id=w.id AND b.security_epoch=w.security_epoch AND b.expires_at=c.expires_at AND b.revoked_at IS NULL AND m.status='active'
 AND (r.state='PROVISIONING' OR EXISTS(SELECT 1 FROM runtime_original_provisions original WHERE original.runtime_id=r.id AND original.schema_version=2 AND original.project_id IS NULL AND original.parent_container_id=r.backend_container_id AND original.workspace_id=w.id AND original.organization_id=w.organization_id AND original.owner_user_id=w.owner_user_id AND original.binding_hash=w.storage_mapping_hash AND original.binding_epoch=w.security_epoch))
 AND r.state IN (${phase==='bootstrap'?"'PROVISIONING','STARTING'":phase==='mcp'?"'PROVISIONING','STARTING','READY','IDLE'":"'READY','IDLE'"})`).get(hashSecurityToken(token),now,now,now,issuedUserEpoch);
 const grantedScopes=row?recordedScopes(row.scopes_json):null;if(!grantedScopes)return undefined;
 if(row.grant_request_hash!==bindingDigest([2,row.runtime_id,row.id,row.workspace_id,row.organization_id,row.created_by_user_id,row.storage_mapping_hash,row.security_epoch,Number(issuedUserEpoch),...(grantedScopes===memoryScopes?['agent-memory-read']:[])]))return undefined;
 return Object.freeze({schemaVersion:2,scopeKind:'workspace',projectId:null,projectIds:Object.freeze([]),credentialId:row.id,servicePrincipalId:row.service_principal_id,organizationId:row.organization_id,ownerUserId:row.created_by_user_id,workspaceId:row.workspace_id,runtimeId:row.runtime_id,bindingHash:row.storage_mapping_hash,bindingEpoch:row.security_epoch,expiresAt:row.expires_at,runtimeState:row.state,scopes:grantedScopes});
}
export const inspectWorkspaceBootstrapCredentialV2=token=>inspect(token,'bootstrap');
export const inspectActiveWorkspaceRuntimeCredentialV2=token=>inspect(token,'active');
export function revokeWorkspaceRuntimeCredentialV2(runtimeId,issuedCredentialId){
 execTransaction(()=>{const db=dbOf(),now=new Date().toISOString();if(issuedCredentialId)db.prepare(`UPDATE mcp_credentials SET revoked_at=? WHERE id=? AND schema_version=2 AND project_id IS NULL AND revoked_at IS NULL AND workspace_id IN(SELECT workspace_id FROM runtime_instances WHERE id=? AND schema_version=2 AND project_id IS NULL)`).run(now,issuedCredentialId,runtimeId);db.prepare(`UPDATE mcp_credentials SET revoked_at=? WHERE schema_version=2 AND project_id IS NULL AND revoked_at IS NULL AND id IN(SELECT mcp_credential_id FROM runtime_capability_bindings WHERE runtime_id=? AND schema_version=2 AND project_id IS NULL)`).run(now,runtimeId);db.prepare('UPDATE runtime_capability_bindings SET revoked_at=? WHERE runtime_id=? AND schema_version=2 AND project_id IS NULL AND revoked_at IS NULL').run(now,runtimeId);});checkpointAfterWrite();
}

export const inspectWorkspaceMcpCredentialV2=token=>inspect(token,'mcp');

/** Private Core reader. Only original authenticated request/gateway scope owners call it.
 * No token/password is returned to a browser, DTO or generic credential inspector. */
export function workspaceRuntimeOpenCodeAuthV2(runtimeId){
 const db=dbOf(),receipt=db.prepare('SELECT credential_id,encrypted_token,request_hash FROM mcp_credential_receipts WHERE idempotency_key=?').get('workspace-runtime-v2:'+runtimeId),original=db.prepare('SELECT * FROM runtime_original_provisions WHERE runtime_id=? AND schema_version=2 AND project_id IS NULL').get(runtimeId);
 if(!receipt||!original)return fail();let token=decryptAuthSecret(receipt.encrypted_token);
 try{
  const c=inspectWorkspaceMcpCredentialV2(token);if(!c||c.runtimeId!==runtimeId||c.credentialId!==receipt.credential_id||!['STARTING','READY','IDLE'].includes(c.runtimeState)||c.workspaceId!==original.workspace_id||c.organizationId!==original.organization_id||c.ownerUserId!==original.owner_user_id||c.bindingHash!==original.binding_hash||c.bindingEpoch!==original.binding_epoch)return fail();
  const secret=Buffer.from(token.slice(17),'base64url'),epoch=Number(secret.readBigUInt64BE(0));secret.fill(0);
  if(receipt.request_hash!==bindingDigest([2,runtimeId,c.credentialId,c.workspaceId,c.organizationId,c.ownerUserId,c.bindingHash,c.bindingEpoch,epoch,...(c.scopes.includes('memory:read')?['agent-memory-read']:[])]))return fail();
  const password=deriveWorkspaceRuntimeOpenCodePasswordV2(token,{...c,projectId:null,executionGeneration:original.start_identity,requestId:original.request_id});
  return 'Basic '+Buffer.from('opencode:'+password).toString('base64');
 }finally{token='';}
}
