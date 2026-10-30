import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable=()=>{throw Object.assign(Error('DOT_CAPABILITIES_UNAVAILABLE'),{code:'DOT_CAPABILITIES_UNAVAILABLE'});};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** Read-only approval/comparison descriptor. It is never a bearer, tool list or grant. */
export function createOriginalDotJobPolicy({getDb,jobs,agents,jobProviders}){
 function describe(projectId,jobId,ownerUserId){
  if(!uuid.test(jobId))unavailable();const db=getDb(),job=jobs.getJob(projectId,jobId);
  if(!job||job.id!==jobId||job.project_id!==projectId||!job.enabled||job.owner_kind==='user'&&job.owner_user_id!==ownerUserId||job.visibility==='private'&&job.owner_user_id!==ownerUserId)unavailable();
  const authority=db.prepare(`SELECT principal.id,principal.organization_id,principal.security_epoch,
   grant_row.id AS grant_id,grant_row.revision AS grant_revision,grant_row.permission,
   owner.security_epoch AS owner_epoch,m.role AS organization_role,pm.role AS project_role
   FROM service_principals principal JOIN automation_principal_grants grant_row
    ON grant_row.service_principal_id=principal.id AND grant_row.organization_id=principal.organization_id
    AND grant_row.project_id=? AND grant_row.permission='execute' AND grant_row.status='active'
   JOIN projects project ON project.id=grant_row.project_id AND project.organization_id=principal.organization_id AND project.archived_at IS NULL
   JOIN users owner ON owner.id=? AND owner.status='active'
   JOIN organization_memberships m ON m.organization_id=project.organization_id AND m.user_id=owner.id AND m.status='active'
   LEFT JOIN project_memberships pm ON pm.project_id=project.id AND pm.user_id=owner.id
   WHERE principal.id=? AND principal.organization_id=? AND principal.status='active'`).get(projectId,ownerUserId,job.service_principal_id,job.organization_id);
  if(!authority||!['owner','admin'].includes(authority.organization_role)&&!(authority.organization_role!=='viewer'&&authority.project_role==='editor'))unavailable();
  const provider=jobProviders.getJobProvider(projectId,jobId);if(!provider?.authorized)unavailable();
  const rows=db.prepare(`SELECT connection.id,connection.revision,connection.owner_kind,connection.organization_id,
   connection.provider_type,connection.provider_key,connection.config_json,
   grant_row.id AS grant_id,grant_row.revision AS grant_revision,grant_row.permissions_json,grant_row.expires_at
   FROM provider_connections connection JOIN resource_grants grant_row
    ON grant_row.resource_id=connection.id AND grant_row.resource_type='provider_connection'
    AND grant_row.organization_id=? AND grant_row.grantee_kind='service' AND grant_row.grantee_id=?
   WHERE connection.enabled=1 AND connection.owner_kind IN ('organization','installation')
    AND (connection.organization_id=? OR connection.owner_kind='installation')
    AND (connection.provider_type<>'native' OR connection.id=?)
    AND grant_row.revoked_at IS NULL AND (grant_row.expires_at IS NULL OR grant_row.expires_at>?)
    AND EXISTS(SELECT 1 FROM json_each(grant_row.permissions_json) WHERE value IN ('*','read','execute','admin'))
   ORDER BY connection.id LIMIT 2`).all(job.organization_id,job.service_principal_id,job.organization_id,'job-native:'+jobId,new Date().toISOString());
  if(rows.length!==1)unavailable();
  const models=db.prepare('SELECT purpose,model_id,revision FROM provider_model_policies WHERE connection_id=? ORDER BY purpose').all(rows[0].id);
  const agentHash=hash(agents.getJobAgentConfig(projectId,job.agent));
  const policyHash=hash({schemaVersion:1,jobId,projectId,ownerUserId,job,authority,provider,providerApproval:rows[0],models,agentHash});
  if(getDb()!==db)unavailable();return Object.freeze({jobId,descriptor:'dot-job-policy:v1:'+jobId+':'+policyHash});
 }
 return Object.freeze({describe,require(projectId,ownerUserId,descriptor){const match=/^dot-job-policy:v1:([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(descriptor);if(!match||describe(projectId,match[1],ownerUserId).descriptor!==descriptor)unavailable();return match[1];}});
}
