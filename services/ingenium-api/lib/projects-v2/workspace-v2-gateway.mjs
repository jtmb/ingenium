/** Invoked ONLY inside original gateway-token authenticated /runtimes/gateway/validate.
 * A version2 canonical session row selects this path. No browser scope/password DTO grants. */
import {getDb,authentication,runtimes} from 'ingenium-core';
import {originalWorkspaceProfileV2} from './workspace-v2-control.mjs';
import {qualifyWorkspaceV2Placement,qualifiedWorkspaceV2BackendAddress} from './workspace-v2-placement.mjs';
import {inspectOriginalWorkspaceRuntimeV2} from '../runtime-manager-client.js';
import {workspaceRuntimeCredentialsV2 as credentials} from 'ingenium-core';
async function withOriginalWorkspaceGatewaySessionV2(input,work){
 if(!input||typeof input.sessionToken!=='string'||!/^rbs_[A-Za-z0-9_-]{43}$/.test(input.sessionToken)||!['web','cli'].includes(input.audience)||typeof input.host!=='string'||typeof input.origin!=='string')return undefined;
 const db=getDb(process.env.INGENIUM_CORE_DB_PATH),now=new Date().toISOString();
 const read=()=>db.prepare(`SELECT s.*,r.backend_name FROM runtime_browser_sessions s
 JOIN runtime_instances r ON r.id=s.runtime_id JOIN authorized_workspaces w ON w.id=s.workspace_id
 JOIN auth_sessions a ON a.id=s.auth_session_id JOIN users u ON u.id=a.user_id
 JOIN organizations o ON o.id=s.organization_id JOIN organization_memberships m ON m.organization_id=o.id AND m.user_id=s.owner_user_id
 JOIN runtime_browser_generations g ON g.runtime_id=r.id
 WHERE s.token_hash=? AND s.schema_version=2 AND s.project_id IS NULL AND s.audience=? AND s.host=? AND s.origin=?
 AND s.revoked_at IS NULL AND s.expires_at>? AND s.generation=g.generation AND o.status='active' AND m.status='active'
 AND a.user_id=s.owner_user_id AND a.revoked_at IS NULL AND a.security_epoch=u.security_epoch AND u.status='active' AND a.idle_expires_at>? AND a.absolute_expires_at>?
 AND r.schema_version=2 AND r.project_id IS NULL AND r.organization_id=s.organization_id AND r.owner_user_id=s.owner_user_id
 AND r.workspace_id=w.id AND r.state IN ('READY','IDLE') AND r.absolute_expires_at>? AND r.idle_expires_at>?
 AND w.schema_version=2 AND w.project_id IS NULL AND w.status='authorized' AND w.organization_id=r.organization_id
 AND w.owner_user_id=r.owner_user_id AND w.security_epoch=r.security_epoch`).get(authentication.hashSecurityToken(input.sessionToken),input.audience,input.host,input.origin,now,now,now,now,now);
 const row=read();if(!row)return undefined;
 const installation=db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get();
 if(!installation||typeof installation.instance_id!=='string'||!/^[a-f0-9]{32}$/.test(installation.instance_id))throw Error('WORKSPACE_V2_INSTALLATION_IDENTITY');
 const installationId=installation.instance_id;
 const original=db.prepare('SELECT * FROM runtime_original_provisions WHERE runtime_id=? AND schema_version=2 AND project_id IS NULL').get(row.runtime_id);
 if(!original)return undefined;
 const context=originalWorkspaceProfileV2(row.runtime_id),proof=await inspectOriginalWorkspaceRuntimeV2(row.runtime_id);
 qualifyWorkspaceV2Placement(context.runtime,context.workspace,context.original,context.definition,proof,installationId);
 if(db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get()?.instance_id!==installationId)throw Error('WORKSPACE_V2_GATEWAY_INSTALLATION_CHANGED');
 if(JSON.stringify(read())!==JSON.stringify(row))return undefined;
 return work(row,context.original,proof);
}
export function validateWorkspaceGatewaySessionV2(input){
 return withOriginalWorkspaceGatewaySessionV2(input,(row,original,proof)=>{
  // Private server-to-server field. Never send/log this on public responses.
  const workspaceV2AuthHeader=credentials.workspaceRuntimeOpenCodeAuthV2(row.runtime_id);
  const backendAddress=qualifiedWorkspaceV2BackendAddress(original,proof);
  return {backendName:row.backend_name,...(backendAddress===undefined?{}:{backendAddress}),session:{expiresAt:row.expires_at,launcherOrigin:row.launcher_origin},workspaceV2AuthHeader};
 });
}
export function recordWorkspaceGatewayActivityV2(input,idleLeaseMs){
 if(!input||!['connection_opened','connection_closed','generation_started','generation_finished'].includes(input.kind))return Promise.resolve(undefined);
 return withOriginalWorkspaceGatewaySessionV2(input,row=>{
  const runtime=runtimes.getWorkspaceRuntimeV2(row.runtime_id);
  if(!runtime||runtime.workspaceId!==row.workspace_id||runtime.ownerUserId!==row.owner_user_id||runtime.organizationId!==row.organization_id)return undefined;
  runtimes.recordWorkspaceRuntimeActivityV2({id:runtime.id,expectedRevision:runtime.revision,kind:input.kind,actorId:row.owner_user_id,idleLeaseMs});
  return {accepted:true};
 });
}
