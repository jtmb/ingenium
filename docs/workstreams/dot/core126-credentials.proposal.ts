// Append inside the existing mcp-credentials.ts owner, retaining its original private factories/imports.
// No legacy kind/audience union, table row, receipt, encryption key or workspace is rewritten.
export interface ManagedJobCredential {
  id:string;kind:"job-run";audience:"job-run";runId:string;attemptId:string;
  servicePrincipalId:string;organizationId:string;projectId:string;ownerUserId:string;
  workspaceId:string;storageMappingHash:string;securityEpoch:number;principalSecurityEpoch:number;
  scopes:string[];expiresAt:string;
}
function managedJobCredentialBinding(runId:string,attemptId?:string,now=new Date()) {
  const db=getDb(process.env.INGENIUM_CORE_DB_PATH),timestamp=now.toISOString();
  const row=db.prepare(`SELECT e.*,run.effective_service_principal_id,
      principal.security_epoch AS principal_epoch,workspace.security_epoch AS workspace_epoch
    FROM job_run_managed_execution e
    JOIN job_runs run ON run.id=e.run_id AND run.job_id=e.job_id AND run.project_id=e.project_id
      AND run.organization_id=e.organization_id AND run.status='running'
    JOIN service_principals principal ON principal.id=run.effective_service_principal_id
      AND principal.organization_id=e.organization_id AND principal.status='active'
    JOIN authorized_workspaces workspace ON workspace.id=e.workspace_id AND workspace.status='authorized'
      AND workspace.organization_id=e.organization_id AND workspace.project_id=e.project_id
      AND workspace.owner_user_id=e.owner_user_id AND workspace.storage_mapping_hash=e.binding_hash
      AND workspace.security_epoch=e.binding_epoch
    JOIN runtime_instances runtime ON runtime.id=e.runtime_id AND runtime.workspace_id=e.workspace_id
      AND runtime.organization_id=e.organization_id AND runtime.project_id=e.project_id
      AND runtime.owner_user_id=e.owner_user_id AND runtime.security_epoch=e.binding_epoch
      AND runtime.revision=e.runtime_revision AND runtime.backend_container_id=e.parent_container_id
      AND runtime.state IN ('READY','IDLE') AND runtime.absolute_expires_at>? AND runtime.idle_expires_at>?
    JOIN users owner ON owner.id=e.owner_user_id AND owner.status='active'
    JOIN organization_memberships member ON member.user_id=e.owner_user_id
      AND member.organization_id=e.organization_id AND member.status='active'
    LEFT JOIN project_memberships pm ON pm.project_id=e.project_id AND pm.user_id=e.owner_user_id
    WHERE e.run_id=? AND e.deadline_at>? AND e.phase IN ('prepared','create_intent','created','start_intent','running')
      AND (member.role IN ('owner','admin') OR pm.user_id IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM veyra_dot_records op WHERE op.kind='operation'
        AND json_extract(op.body,'$.runId')=e.run_id AND json_extract(op.body,'$.state')='cancel_requested')
    `).get(timestamp,timestamp,runId,timestamp) as Record<string,unknown>|undefined;
  if(!row||attemptId!==undefined&&row.attempt_id!==attemptId)return undefined;
  const granted=db.prepare(`SELECT 1 FROM job_runs run JOIN jobs job ON job.id=run.job_id AND job.project_id=run.project_id
    JOIN projects project ON project.id=run.project_id AND project.organization_id=run.organization_id AND project.archived_at IS NULL
    JOIN automation_principal_grants grant_row ON grant_row.project_id=run.project_id AND grant_row.organization_id=run.organization_id
      AND grant_row.service_principal_id=run.effective_service_principal_id AND grant_row.permission='execute' AND grant_row.status='active'
    WHERE run.id=? AND run.job_revision=job.revision AND job.service_principal_id=run.effective_service_principal_id
      AND run.authorization_revision=grant_row.revision`).get(runId);
  if(!granted)return undefined;
  const a=JSON.parse(String(row.admission_json));
  if(!Array.isArray(a.approvedScopes)||!a.approvedScopes.length||a.approvedScopes.length>64||a.approvedScopes.some((scope:unknown)=>typeof scope!=="string"||!/^[a-z][a-z0-9:._-]{0,127}$/.test(scope)||scope==="child-mcp:runtime"))return undefined;
  return {row,a};
}
export function issueManagedJobCredential(input:{runId:string;attemptId:string}):ManagedJobCredential&{token:string} {
  const issued=execTransaction(()=>{
    const binding=managedJobCredentialBinding(input.runId,input.attemptId);if(!binding||binding.row.phase!=="prepared")throw Error("Original JobRun credential binding unavailable");
    const db=getDb(process.env.INGENIUM_CORE_DB_PATH),prior=db.prepare("SELECT * FROM job_run_mcp_credentials WHERE run_id=?").get(input.runId) as Record<string,unknown>|undefined;
    if(prior)throw Error("Original JobRun credential already issued; no rotation/replacement fallback");
    const generated=newCredentialToken(),encrypted=encryptAuthSecret(generated.token),a=binding.a,row=binding.row;
    db.prepare(`INSERT INTO job_run_mcp_credentials(id,run_id,attempt_id,kind,audience,service_principal_id,
      principal_security_epoch,workspace_security_epoch,token_prefix,token_hash,encrypted_token,scopes_json,expires_at,created_at)
      VALUES(?,?,?,'job-run','job-run',?,?,?,?,?,?,?,?,?)`).run(generated.id,input.runId,input.attemptId,row.effective_service_principal_id,
        row.principal_epoch,row.workspace_epoch,generated.tokenPrefix,hashSecurityToken(generated.token),encrypted,JSON.stringify(a.approvedScopes),row.deadline_at,new Date().toISOString());
    return {id:generated.id,kind:"job-run" as const,audience:"job-run" as const,runId:input.runId,attemptId:input.attemptId,
      servicePrincipalId:String(row.effective_service_principal_id),organizationId:a.organizationId,projectId:a.projectId,ownerUserId:a.ownerUserId,
      workspaceId:a.workspaceId,storageMappingHash:a.bindingHash,securityEpoch:Number(row.workspace_epoch),principalSecurityEpoch:Number(row.principal_epoch),scopes:[...a.approvedScopes],expiresAt:String(row.deadline_at),token:generated.token};
  });
  checkpointAfterWrite();return issued;
}
/** This resolver is deliberately separate from generic MCP/service/runtime/browser authentication. */
export function inspectManagedJobCredential(token:string,audience:"job-run",now=new Date()):ManagedJobCredential|undefined {
  if(audience!=="job-run"||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token))return undefined;
  const db=getDb(process.env.INGENIUM_CORE_DB_PATH),credential=db.prepare("SELECT * FROM job_run_mcp_credentials WHERE token_hash=? AND kind='job-run' AND audience='job-run' AND revoked_at IS NULL AND expires_at>?")
    .get(hashSecurityToken(token),now.toISOString()) as Record<string,unknown>|undefined;
  if(!credential)return undefined;const binding=managedJobCredentialBinding(String(credential.run_id),String(credential.attempt_id),now);
  if(!binding||binding.row.principal_epoch!==credential.principal_security_epoch||binding.row.workspace_epoch!==credential.workspace_security_epoch||credential.service_principal_id!==binding.row.effective_service_principal_id||credential.scopes_json!==JSON.stringify(binding.a.approvedScopes)||binding.row.credential_id!==credential.id)return undefined;
  const a=binding.a;return {id:String(credential.id),kind:"job-run",audience:"job-run",runId:String(credential.run_id),attemptId:String(credential.attempt_id),servicePrincipalId:String(credential.service_principal_id),organizationId:a.organizationId,projectId:a.projectId,ownerUserId:a.ownerUserId,workspaceId:a.workspaceId,storageMappingHash:a.bindingHash,securityEpoch:Number(credential.workspace_security_epoch),principalSecurityEpoch:Number(credential.principal_security_epoch),scopes:[...a.approvedScopes],expiresAt:String(credential.expires_at)};
}
export function revokeManagedJobCredential(runId:string):void {
  execTransaction(()=>getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("UPDATE job_run_mcp_credentials SET revoked_at=? WHERE run_id=? AND revoked_at IS NULL").run(new Date().toISOString(),runId));checkpointAfterWrite();
}
