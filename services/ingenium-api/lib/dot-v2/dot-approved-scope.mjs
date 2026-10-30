import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable=code=>{throw Object.assign(Error(code),{code,status:503});};
const text=v=>typeof v==='string'&&v.length>0&&v.length<=512&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
/** Read-only reconstruction of an existing approved delegation. This returns
 * facts, not an HTTP principal, token, permission grant or launch readiness. */
export function createOriginalDotApprovedScopeReader(ports){
 const leases=new WeakMap();
 function approved(projectId,jobId){
  const db=ports.getDb(),rows=db.prepare("SELECT id,organization_id,owner_user_id,scope_key,revision,body FROM veyra_dot_records WHERE kind='followup' AND json_extract(body,'$.scope.projectId')=? AND json_extract(body,'$.jobId')=? AND json_extract(body,'$.state')!='cancelled' LIMIT 2").all(projectId,jobId);
  if(rows.length!==1)unavailable('DOT_APPROVAL_UNAVAILABLE');const f=JSON.parse(rows[0].body),scope=f.scope;
  if(!Number.isSafeInteger(f.revision)||f.revision<0||rows[0].revision!==f.revision||f.state!=='active'||!scope||scope.projectId!==projectId||f.jobId!==jobId||rows[0].id!==f.id||rows[0].organization_id!==scope.organizationId||rows[0].owner_user_id!==scope.ownerUserId||rows[0].scope_key!==ports.scopeKey(scope))unavailable('DOT_APPROVAL_UNAVAILABLE');
  const row=db.prepare("SELECT id,organization_id,owner_user_id,scope_key,revision,body FROM veyra_dot_records WHERE kind='suggestion' AND id=? AND scope_key=?").get(f.suggestionId,rows[0].scope_key),suggestion=row&&JSON.parse(row.body);
  if(!row||!suggestion||!Number.isSafeInteger(suggestion.revision)||suggestion.revision<1||row.revision!==suggestion.revision||suggestion.state!=='approved'||suggestion.id!==f.id||row.organization_id!==scope.organizationId||row.owner_user_id!==scope.ownerUserId||ports.scopeKey(suggestion.scope)!==ports.scopeKey(scope))unavailable('DOT_APPROVAL_UNAVAILABLE');
  const policy=ports.jobPolicy.describe(projectId,jobId,scope.ownerUserId),job=ports.jobs.getJob(projectId,jobId);
  if(!job||job.revision!==f.jobRevision||job.schedule_revision!==f.scheduleRevision||job.prompt_template!==suggestion.prompt||job.schedule_cron||!Array.isArray(f.capabilities)||!f.capabilities.includes(policy.descriptor)||!suggestion.capabilities?.includes(policy.descriptor))unavailable('DOT_APPROVED_POLICY_CHANGED');
  const {cursor:_progressCursor,...approvedFollowup}=f;
  // Cursor progress is not a new approval; the original followup revision still pins pause/resume/cancel.
  return {db,followup:f,suggestion,scope,job,approvalDigest:digest([approvedFollowup,row]),rowDigests:{followup:{id:f.id,revision:f.revision,rowDigest:digest(rows[0])},suggestion:{id:suggestion.id,revision:suggestion.revision,rowDigest:digest(row)}}};
 }
 const sourceChat=(admission)=>{
  const {scope,suggestion}=admission,source=suggestion.source,ref=ports.parseReference(source.reference);
  if(source.kind==='memory')unavailable('DOT_MEMORY_AUTONOMOUS_DELEGATION_UNAVAILABLE');
  let id=scope.conversationId??ref.chatId;
  if(source.kind==='event'){const event=ports.trustedJobEvents.getTrustedJobEvent(scope.projectId,ref.id);id=event?.payload?.targetConversationId??event?.payload?.conversationId;}
  if(!text(id)||source.kind==='user'&&ref.chatId!==id||scope.conversationId!==null&&id!==scope.conversationId)unavailable('DOT_SOURCE_REVOKED');
  const chat=ports.contextConversations.getContextConversation(scope.projectId,id);let meta;try{meta=JSON.parse(chat?.metadata);}catch{unavailable('DOT_SOURCE_REVOKED');}
  if(!chat||chat.id!==id||chat.project_id!==scope.projectId||chat.organization_id!==scope.organizationId||chat.owner_user_id!==scope.ownerUserId||chat.visibility!=='private'||meta?.source!=='opencode-chat'||!text(meta.sourceRuntimeId)||!text(meta.sourceSessionId)||!ports.conversationIsActive(scope.projectId,id))unavailable('DOT_SOURCE_REVOKED');
  return {id,chat,meta,ref};
 };
 function verifySource(a,execution,source){
  const {scope,suggestion}=a,{id,chat,meta,ref}=source;
  if(meta.sourceRuntimeId!==execution.runtimeId)unavailable('DOT_SOURCE_REVOKED');
  const matches=ports.findSourceIds(execution,meta.sourceSessionId);
  if(matches.length!==1||matches[0].id!==id||!ports.conversationIsActive(scope.projectId,id))unavailable('DOT_SOURCE_REVOKED');
  if(suggestion.source.kind==='user'){
   const m=ports.contextConversations.getContextMessage(scope.projectId,id,ref.id);let mm;try{mm=JSON.parse(m?.metadata);}catch{unavailable('DOT_SOURCE_REVOKED');}
   if(!m||m.id!==ref.id||m.project_id!==scope.projectId||m.conversation_id!==id||m.role!=='user'||m.content_hash!==ref.hash||createHash('sha256').update(m.content).digest('hex')!==ref.hash||mm?.source!=='opencode-chat'||mm.sourceRuntimeId!==execution.runtimeId||mm.sourceSessionId!==meta.sourceSessionId)unavailable('DOT_SOURCE_REVOKED');
  }else if(suggestion.source.kind==='event'){
   const e=ports.trustedJobEvents.getTrustedJobEvent(scope.projectId,ref.id);if(!e||e.project_id!==scope.projectId||e.schema_version!==1||e.producer!=='context.maintenance'||ports.eventDigest(e,meta.sourceSessionId)!==ref.hash)unavailable('DOT_SOURCE_REVOKED');
  }else unavailable('DOT_SOURCE_REVOKED');
  return digest(chat);
 }
 return Object.freeze({async resolve(projectId,jobId){
  const a=approved(projectId,jobId),source=sourceChat(a),{scope}=a,w=ports.runtimes.getAuthorizedWorkspace(scope.executionBindingId);
  if(!w||w.status!=='authorized'||!Number.isSafeInteger(w.securityEpoch)||w.securityEpoch<0||!text(w.storagePath)||createHash('sha256').update(w.id+'\0'+w.storagePath).digest('hex')!==w.storageMappingHash||w.organizationId!==scope.organizationId||w.projectId!==projectId||w.ownerUserId!==scope.ownerUserId)unavailable('DOT_EXECUTION_UNAVAILABLE');
  const installation=a.db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get();if(!installation)unavailable('DOT_EXECUTION_UNAVAILABLE');
  // Every currently supported user/event source has an original Context runtime ID. No latest/adopt fallback.
  const ids=[{id:source.meta.sourceRuntimeId}];
  if(ids.length>16)unavailable('DOT_EXECUTION_AMBIGUOUS');const matches=[];
  for(const {id}of ids){
   const r=ports.runtimes.getRuntimeInstance(id),now=ports.now();
   if(!r||r.workspaceId!==w.id||r.projectId!==projectId||r.organizationId!==scope.organizationId||r.ownerUserId!==scope.ownerUserId||r.securityEpoch!==w.securityEpoch||!['READY','IDLE'].includes(r.state)||!Number.isSafeInteger(r.revision)||r.revision<0||[r.absoluteExpiresAt,r.idleExpiresAt].some(t=>!Number.isFinite(Date.parse(t))||Date.parse(t)<=now)||r.leaseExpiresAt!==null&&(!Number.isFinite(Date.parse(r.leaseExpiresAt))||Date.parse(r.leaseExpiresAt)<=now))continue;
   const observation=await ports.inspectPlacement(r.id);
   const placement=ports.qualifyPlacement({organizationId:w.organizationId,ownerUserId:w.ownerUserId,projectId,workspaceId:w.id,bindingHash:w.storageMappingHash,bindingEpoch:w.securityEpoch,runtimeId:r.id,runtimeRevision:r.revision,backendName:r.backendName,backendContainerId:r.backendContainerId,now:ports.now()},observation,installation.instance_id);
   if(!placement)continue;const execution={organizationId:w.organizationId,ownerUserId:w.ownerUserId,projectId,workspaceId:w.id,bindingHash:w.storageMappingHash,bindingEpoch:w.securityEpoch,status:'authorized',runtimeId:r.id,mode:'runtime',hostId:placement.hostId,environmentId:placement.environmentId,available:true};
   if(ports.fingerprint(execution,scope.conversationId===null?null:source.meta.sourceSessionId)!==scope.executionBindingFingerprint)continue;
   if(JSON.stringify(ports.runtimes.getRuntimeInstance(id))!==JSON.stringify(r)||JSON.stringify(ports.runtimes.getAuthorizedWorkspace(w.id))!==JSON.stringify(w))unavailable('DOT_EXECUTION_REBOUND');
   verifySource(a,execution,source);matches.push({execution,expiresAt:placement.expiresAt,runtime:structuredClone(r),workspace:structuredClone(w),observation:structuredClone(observation),installationId:installation.instance_id});
  }
  if(matches.length!==1)unavailable(matches.length?'DOT_EXECUTION_AMBIGUOUS':'DOT_EXECUTION_UNAVAILABLE');
  const final=approved(projectId,jobId),after=sourceChat(final);
  if(final.db!==a.db||final.approvalDigest!==a.approvalDigest||digest(after.chat)!==digest(source.chat))unavailable('DOT_APPROVAL_REBOUND');
  if(matches[0].expiresAt<=ports.now())unavailable('DOT_EXECUTION_UNAVAILABLE');
  verifySource(final,matches[0].execution,after);
  const token=Object.freeze({followupId:a.followup.id,scope:Object.freeze(structuredClone(scope)),execution:Object.freeze({...matches[0].execution}),placementExpiresAt:matches[0].expiresAt,automationPrincipalId:a.job.service_principal_id,approvalDigest:a.approvalDigest,rowDigests:Object.freeze(final.rowDigests)});
  leases.set(token,{db:a.db,projectId,jobId,approvalDigest:a.approvalDigest,sourceDigest:digest(after.chat),jobRevision:a.followup.jobRevision,scheduleRevision:a.followup.scheduleRevision,...matches[0]});return token;
 },
 revalidate(token){
  const lease=leases.get(token);if(!lease||ports.getDb()!==lease.db)unavailable('DOT_APPROVAL_CONTEXT_UNAVAILABLE');
  const a=approved(lease.projectId,lease.jobId),source=sourceChat(a),runtime=ports.runtimes.getRuntimeInstance(lease.runtime.id),workspace=ports.runtimes.getAuthorizedWorkspace(lease.workspace.id);
  if(a.approvalDigest!==lease.approvalDigest||digest(source.chat)!==lease.sourceDigest||JSON.stringify(runtime)!==JSON.stringify(lease.runtime)||JSON.stringify(workspace)!==JSON.stringify(lease.workspace))unavailable('DOT_APPROVAL_REBOUND');
  const placement=ports.qualifyPlacement({organizationId:workspace.organizationId,ownerUserId:workspace.ownerUserId,projectId:workspace.projectId,workspaceId:workspace.id,bindingHash:workspace.storageMappingHash,bindingEpoch:workspace.securityEpoch,runtimeId:runtime.id,runtimeRevision:runtime.revision,backendName:runtime.backendName,backendContainerId:runtime.backendContainerId,now:ports.now()},lease.observation,lease.installationId);
  if(!placement||placement.expiresAt<=ports.now()||ports.fingerprint(lease.execution,a.scope.conversationId===null?null:source.meta.sourceSessionId)!==a.scope.executionBindingFingerprint)unavailable('DOT_EXECUTION_UNAVAILABLE');
  verifySource(a,lease.execution,source);
  return Object.freeze({followupId:a.followup.id,scope:Object.freeze(structuredClone(a.scope)),execution:Object.freeze({...lease.execution}),automationPrincipalId:a.job.service_principal_id,approvalDigest:a.approvalDigest,rowDigests:Object.freeze(a.rowDigests)});
 },
 operationEvidence(token,runId){
  const current=this.revalidate(token),lease=leases.get(token),rows=lease.db.prepare("SELECT id,organization_id,owner_user_id,scope_key,revision,body FROM veyra_dot_records WHERE kind='operation' AND scope_key=? AND json_extract(body,'$.followupId')=? AND json_extract(body,'$.runId')=? LIMIT 2").all(ports.scopeKey(current.scope),current.followupId,runId);
  if(rows.length!==1)unavailable('DOT_RUN_BINDING_CHANGED');const row=rows[0],operation=JSON.parse(row.body),run=ports.jobs.getJobRun(lease.projectId,runId);
  if(!Number.isSafeInteger(operation.revision)||operation.revision<0||!['claimed','running','cancel_requested','unknown','success','failed','cancelled'].includes(operation.state)||row.id!==operation.id||row.revision!==operation.revision||row.organization_id!==current.scope.organizationId||row.owner_user_id!==current.scope.ownerUserId||ports.scopeKey(operation.scope)!==row.scope_key||operation.followupId!==current.followupId||operation.runId!==runId||!run||run.id!==runId||run.job_id!==lease.jobId||run.project_id!==lease.projectId||run.organization_id!==current.scope.organizationId||run.effective_service_principal_id!==current.automationPrincipalId||run.job_revision!==lease.jobRevision||run.schedule_revision!==lease.scheduleRevision||!ports.jobs.isJobRunAuthorizationCurrent(lease.projectId,runId))unavailable('DOT_RUN_BINDING_CHANGED');
  return Object.freeze({...current,operation:Object.freeze({id:operation.id,revision:operation.revision,rowDigest:digest(row),state:operation.state}),runId,runIdentityHash:ports.runIdentity(run)});
 }
 });
}
