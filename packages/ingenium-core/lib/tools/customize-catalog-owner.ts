import {isInstallationStorageProject} from './paths.js';
/** Real scoped catalog owner. Published content only; no vault/token/provider-secret access. */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {getDb,execTransaction,checkpointAfterWrite} from '../db.js';
import * as auth from './authorization.js';
import * as plugins from './plugins.js';
import * as lifecycle from './plugin-lifecycle.js';
import * as projection from './plugin-projection-reconciliation.js';
import * as skills from './skills.js';
import * as governance from './skill-governance.js';
import {payloadHash} from './hosted-governance.js';
type Row=Record<string,any>;
const id=z.string().uuid(),revision=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),hash=z.string().regex(/^[a-f0-9]{64}$/);
const name=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),kind=z.enum(['plugin','skill']),visibility=z.enum(['personal','public','system']);
const common={operationId:id};
export const CatalogCommandSchema=z.discriminatedUnion('op',[
 z.object({...common,op:z.literal('reconcile-local-metadata'),sourceOperationId:id,reviewSha256:hash}).strict(),
 z.object({...common,op:z.literal('reconcile-plugin-projection'),sourceOperationId:id,reviewSha256:hash}).strict(),
 z.object({...common,op:z.literal('publish'),projectId:id,kind,name,expectedRevision:revision,sourceSha256:hash,visibility}).strict(),
 z.object({...common,op:z.literal('withdraw'),sourceId:id,expectedRevision:revision}).strict(),
 z.object({...common,op:z.literal('restore-source'),sourceId:id,expectedRevision:revision}).strict(),
 z.object({...common,op:z.literal('revise-plugin-source'),sourceId:id,expectedRevision:revision,sourceSha256:hash,description:z.string().max(2000).refine(v=>!v.includes('\0')),source:z.string().max(1000000)}).strict(),
 z.object({...common,op:z.literal('connect'),sourceId:id,expectedRevision:revision,sourceSha256:hash,projectId:id,targetName:name}).strict(),
 z.object({...common,op:z.enum(['archive-plugin','restore-plugin','activate-plugin','deactivate-plugin']),projectId:id,name,expectedRevision:revision}).strict(),
]);
export class CustomizeCatalogRefusal extends Error{constructor(public code:string,public status=409){super(code);}}
function refuse(code:string,status=409):never{throw new CustomizeCatalogRefusal(code,status);}
function requireValue(value:unknown,code:string,status=409):asserts value{if(!value)refuse(code,status);}
const db=()=>getDb();
function project(principal:auth.AuthorizationPrincipal,projectId:string,resource:string,permission:auth.AuthorizationPermission):Row{
 requireValue(auth.requireProjectPermission(principal,projectId,resource,permission).allowed,'NOT_FOUND',404);
 const row=db().prepare('SELECT * FROM projects WHERE id=? AND archived_at IS NULL').get(projectId) as Row|undefined;requireValue(row,'NOT_FOUND',404);return row;
}
function instance():string{const row=db().prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get() as Row|undefined;requireValue(row?.instance_id,'INSTALLATION_IDENTITY_UNAVAILABLE',503);return row.instance_id;}
function active(principal:auth.AuthorizationPrincipal):void{
 requireValue(principal.type==='browser-user'&&db().prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(principal.id),'BROWSER_SESSION_REQUIRED',401);
}
function sourceAllowed(principal:auth.AuthorizationPrincipal,row:Row,write=false):void{
 active(principal);requireValue(row.installation_id===instance(),'NOT_FOUND',404);
 requireValue(auth.requireOrganizationPermission(principal,row.organization_id,row.kind==='plugin'?'plugins':'skills',write?'admin':'read').allowed,'NOT_FOUND',404);
 if(row.visibility==='personal')requireValue(row.owner_user_id===principal.id,'NOT_FOUND',404);
 if(write&&row.visibility==='system')requireValue(auth.requireInstallationPermission(principal,'plugins','admin').allowed,'NOT_FOUND',404);
}
function sourceRow(principal:auth.AuthorizationPrincipal,sourceId:string):Row{
 const row=db().prepare('SELECT * FROM customize_catalog_sources WHERE id=?').get(sourceId) as Row|undefined;requireValue(row,'NOT_FOUND',404);sourceAllowed(principal,row);return row;
}
function dto(row:Row){return {id:row.id,kind:row.kind,name:row.name,description:row.description,visibility:row.visibility,revision:row.revision,sourceSha256:row.payload_sha256,archived:Boolean(row.archived_at),organizationId:row.organization_id,parentSourceId:row.parent_source_id??null,connectNeedsProject:true};}
function projectSnapshot(principal:auth.AuthorizationPrincipal,projectId:string,resourceKind:'plugin'|'skill',resourceName:string):Row{
 project(principal,projectId,resourceKind==='plugin'?'plugins':'skills','admin');
 const row=(resourceKind==='plugin'?lifecycle.record(projectId,resourceName):skills.getSkill(projectId,resourceName)) as Row|undefined;
 requireValue(row&&!row.archived_at,'NOT_FOUND',404);
 requireValue(typeof row.content==='string'||typeof row.source_content==='string','API_OWNED_SOURCE_REQUIRED',503);
 const payload=resourceKind==='plugin'?{kind:resourceKind,name:row.name,description:row.description??'',source:row.source_content}:
  {kind:resourceKind,name:row.name,description:row.description??'',content:row.content,category:row.category??null,tags:row.tags??null,always_apply:row.always_apply??0,file_tree:row.file_tree??null};
 return {row,payload,sourceSha256:payloadHash(payload)};
}
/** Every callback is synchronous under the original Core writer. */
export interface VerifiedScopedCustomizeContext {
 /** Only the actual request-bound Native proof owner constructs this callback. */
 consentId:string;organizationId:string;nativeRequestSha256?:string;assertCurrent():void;authorizeCommand(command:z.infer<typeof CatalogCommandSchema>):void;
}
export function createCustomizeCatalogOwner(principal:auth.AuthorizationPrincipal,native?:VerifiedScopedCustomizeContext){
 active(principal);
 function current(){active(principal);native?.assertCurrent();return principal;}
 function reconciliation(sourceOperationId:string,ignoreOperationId?:string):Row{
  current();const original=db().prepare('SELECT * FROM customize_commands WHERE id=? AND actor_id=? AND installation_id=?').get(id.parse(sourceOperationId),principal.id,instance()) as Row|undefined;
  requireValue(original&&original.project_id&&original.kind==='plugin'&&!original.result_json,'ORIGINAL_NOT_PENDING');
  const stored=JSON.parse(original.original_json);requireValue(payloadHash(stored)===original.payload_sha256,'ORIGINAL_CORRUPT',503);
  const command=CatalogCommandSchema.parse(stored.command);requireValue(['archive-plugin','restore-plugin','activate-plugin','deactivate-plugin'].includes(command.op),'LOCAL_PLUGIN_PROJECTION_ORIGINAL_REQUIRED');
  project(principal,original.project_id,'plugins','admin');project(principal,original.project_id,'plugins','execute');
  const witness=db().prepare('SELECT * FROM customize_projection_preimages WHERE command_id=?').get(original.id) as Row|undefined;
  requireValue(witness,'ORIGINAL_PROJECTION_PREIMAGE_UNAVAILABLE',503);const before=JSON.parse(witness.snapshot_json);requireValue(payloadHash(before)===witness.snapshot_sha256,'ORIGINAL_PROJECTION_PREIMAGE_CORRUPT',503);
  const row=lifecycle.record(original.project_id,before.resource.name);requireValue(row&&row.id===original.resource_key&&row.id===before.resource.id,'ORIGINAL_RESOURCE_CHANGED');
  const observed=projection.reviewProjectionRollback(before,row);
  const pending=(db().prepare("SELECT * FROM customize_commands WHERE project_id=? AND kind='plugin' AND result_json IS NULL ORDER BY id").all(original.project_id) as Row[]).filter(r=>r.id!==ignoreOperationId);
  requireValue(pending.length<=128,'ORIGINAL_CHAIN_REVIEW_LIMIT');
  for(const held of pending){requireValue(held.actor_id===principal.id&&held.installation_id===instance(),'OTHER_ORIGINAL_REQUIRES_ITS_OWNER');
   if(held.id===original.id)continue;const linked=JSON.parse(held.original_json);requireValue(payloadHash(linked)===held.payload_sha256&&linked.command.op==='reconcile-plugin-projection'&&linked.command.sourceOperationId===original.id,'UNRELATED_ORIGINAL_REQUIRES_RECONCILIATION');
  }
  const review={protocol:'customize-projection-preimage-v1',sourceOperationId:original.id,sourcePayloadSha256:original.payload_sha256,preimageSha256:witness.snapshot_sha256,observationSha256:payloadHash(observed),pending:pending.map(r=>({operationId:r.id,payloadSha256:r.payload_sha256}))};
  return {original,before,row,observed,pending,review,reviewSha256:payloadHash(review)};
 }
 const metadataOps=new Set(['publish','withdraw','restore-source','revise-plugin-source','connect','reconcile-local-metadata']);
 function atomicReconciliation(sourceOperationId:string,ignoreOperationId?:string):Row{
  current();const original=db().prepare('SELECT * FROM customize_commands WHERE id=? AND actor_id=? AND installation_id=?').get(id.parse(sourceOperationId),principal.id,instance()) as Row|undefined;
  requireValue(original&&!original.result_json,'ORIGINAL_NOT_PENDING');const stored=JSON.parse(original.original_json);requireValue(payloadHash(stored)===original.payload_sha256&&metadataOps.has(stored.command.op),'LOCAL_ATOMIC_METADATA_ORIGINAL_REQUIRED');
  const witness=db().prepare('SELECT * FROM customize_projection_preimages WHERE command_id=?').get(original.id) as Row|undefined;requireValue(witness,'ORIGINAL_SERVER_WITNESS_UNAVAILABLE',503);
  const marker=JSON.parse(witness.snapshot_json);requireValue(payloadHash(marker)===witness.snapshot_sha256&&marker.protocol==='customize-atomic-metadata-v1'&&marker.requestSha256===original.payload_sha256,'ORIGINAL_SERVER_WITNESS_CORRUPT',503);
  if(original.project_id)project(principal,original.project_id,original.kind==='plugin'?'plugins':'skills','admin');
  else if(stored.command.sourceId)sourceAllowed(principal,sourceRow(principal,stored.command.sourceId),true);
  const candidates=db().prepare('SELECT * FROM customize_commands WHERE actor_id=? AND installation_id=? AND project_id IS ? AND kind=? AND result_json IS NULL ORDER BY id').all(principal.id,instance(),original.project_id,original.kind) as Row[];
  const pending=candidates.filter(r=>{if(r.id===ignoreOperationId)return false;if(r.id===original.id)return true;const linked=JSON.parse(r.original_json);return linked.command.op==='reconcile-local-metadata'&&linked.command.sourceOperationId===original.id;});requireValue(pending.length<=128,'ORIGINAL_CHAIN_REVIEW_LIMIT');
  for(const row of pending)requireValue(payloadHash(JSON.parse(row.original_json))===row.payload_sha256,'ORIGINAL_CORRUPT',503);
  const review={protocol:'customize-atomic-metadata-v1',sourceOperationId:original.id,sourcePayloadSha256:original.payload_sha256,witnessSha256:witness.snapshot_sha256,pending:pending.map(r=>({operationId:r.id,payloadSha256:r.payload_sha256})),proof:'same_SQLite_domain_and_first_receipt_commit'};
  return {original,pending,review,reviewSha256:payloadHash(review)};
 }
 function authorize(command:z.infer<typeof CatalogCommandSchema>):{projectId:string|null;kind:'plugin'|'skill';resourceKey:string}{
  current();native?.authorizeCommand(command);
  if(command.op==='reconcile-local-metadata'){const state=atomicReconciliation(command.sourceOperationId,command.operationId);return {projectId:state.original.project_id,kind:state.original.kind,resourceKey:state.original.resource_key};}
  if(command.op==='reconcile-plugin-projection'){const state=reconciliation(command.sourceOperationId,command.operationId);return {projectId:state.original.project_id,kind:'plugin',resourceKey:state.original.resource_key};}
  if(command.op==='publish'){const p=project(principal,command.projectId,command.kind==='plugin'?'plugins':'skills','admin');
   if(command.visibility!=='personal')requireValue(auth.requireOrganizationPermission(principal,p.organization_id,command.kind==='plugin'?'plugins':'skills','admin').allowed,'NOT_FOUND',404);
   if(command.visibility==='system')requireValue(isInstallationStorageProject(command.projectId)&&auth.requireInstallationPermission(principal,'plugins','admin').allowed,'SYSTEM_SOURCE_OWNER_REQUIRED',403);
   return {projectId:command.projectId,kind:command.kind,resourceKey:command.name};
  }
  if(command.op==='withdraw'||command.op==='restore-source'||command.op==='revise-plugin-source'){const row=sourceRow(principal,command.sourceId);sourceAllowed(principal,row,true);return {projectId:null,kind:row.kind,resourceKey:row.id};}
  if(command.op==='connect'){const row=sourceRow(principal,command.sourceId);project(principal,command.projectId,row.kind==='plugin'?'plugins':'skills','admin');return {projectId:command.projectId,kind:row.kind,resourceKey:command.targetName};}
  project(principal,command.projectId,'plugins',command.op==='activate-plugin'?'execute':'admin');
  const row=lifecycle.record(command.projectId,command.name);requireValue(row,'NOT_FOUND',404);return {projectId:command.projectId,kind:'plugin',resourceKey:row.id};
 }
 // Reject stale/invalid reviews before consuming an operation. Existing terminal
 // originals are looked up first, so reading a receipt never repeats its effect.
 function review(c:z.infer<typeof CatalogCommandSchema>):Row|undefined{
  if(c.op==='reconcile-local-metadata'){const state=atomicReconciliation(c.sourceOperationId,c.operationId);requireValue(state.reviewSha256===c.reviewSha256,'METADATA_REVIEW_CONFLICT');return;}
  if(c.op==='reconcile-plugin-projection'){const state=reconciliation(c.sourceOperationId,c.operationId);requireValue(state.reviewSha256===c.reviewSha256,'PROJECTION_REVIEW_CONFLICT');return;}
  if(c.op==='publish'){const v=projectSnapshot(principal,c.projectId,c.kind,c.name);requireValue(v.row.revision===c.expectedRevision&&v.sourceSha256===c.sourceSha256,'SOURCE_REVIEW_CONFLICT');return;}
  if(c.op==='withdraw'||c.op==='restore-source'||c.op==='revise-plugin-source'){
   const row=sourceRow(principal,c.sourceId);requireValue(row.revision===c.expectedRevision,'SOURCE_REVIEW_CONFLICT');
   if(c.op==='revise-plugin-source')requireValue(row.kind==='plugin'&&!row.archived_at&&row.payload_sha256===c.sourceSha256,'SOURCE_REVIEW_CONFLICT');
   else requireValue(Boolean(row.archived_at)===(c.op==='restore-source'),'SOURCE_REVIEW_CONFLICT');return;
  }
  if(c.op==='connect'){const row=sourceRow(principal,c.sourceId);requireValue(!row.archived_at&&row.revision===c.expectedRevision&&row.payload_sha256===c.sourceSha256,'SOURCE_REVIEW_CONFLICT');requireValue(!(row.kind==='plugin'?lifecycle.record(c.projectId,c.targetName):skills.getSkill(c.projectId,c.targetName)),'TARGET_ALREADY_EXISTS');return;}
  const row=lifecycle.record(c.projectId,c.name);requireValue(row&&row.revision===c.expectedRevision,'PLUGIN_REVIEW_CONFLICT');
  requireValue(Boolean(row.archived_at)===(c.op==='restore-plugin'),'PLUGIN_REVIEW_CONFLICT');
  if(c.op==='activate-plugin')requireValue(typeof row.source_content==='string'&&row.source_content.length>0,'PLUGIN_SOURCE_UNAVAILABLE');
  return projection.captureProjectionPreimage(row);
 }
 function execute(command:z.infer<typeof CatalogCommandSchema>):Row{
  authorize(command);const now=new Date().toISOString();
  if(command.op==='reconcile-local-metadata'){
   const state=atomicReconciliation(command.sourceOperationId,command.operationId);requireValue(state.reviewSha256===command.reviewSha256,'METADATA_REVIEW_CONFLICT');
   for(const held of state.pending){const receipt={operationId:held.id,payloadSha256:held.payload_sha256,outcome:'refused',code:'ATOMIC_LOCAL_METADATA_DOMAIN_TRANSACTION_NOT_COMMITTED',value:{reconciledBy:command.operationId,proof:'same_SQLite_domain_and_first_receipt_commit',remoteOutcome:'not_interpreted'}};requireValue(db().prepare('UPDATE customize_commands SET result_json=? WHERE id=? AND result_json IS NULL').run(JSON.stringify(receipt),held.id).changes===1,'FIRST_RECEIPT_CONFLICT');}
   return {sourceOperationId:state.original.id,releasedOriginals:state.pending.map((r:Row)=>r.id),proof:'same_SQLite_domain_and_first_receipt_commit',remoteOutcome:'not_interpreted'};
  }
  if(command.op==='reconcile-plugin-projection'){
   const state=reconciliation(command.sourceOperationId,command.operationId);requireValue(state.reviewSha256===command.reviewSha256,'PROJECTION_REVIEW_CONFLICT');
   const proof=projection.restoreProjectionPreimage(state.before,state.row,state.observed);
   for(const held of state.pending){const receipt={operationId:held.id,payloadSha256:held.payload_sha256,outcome:'refused',code:'LOCAL_DOMAIN_TRANSACTION_NOT_COMMITTED_PREIMAGE_RESTORED',value:{reconciledBy:command.operationId,proof}};requireValue(db().prepare('UPDATE customize_commands SET result_json=? WHERE id=? AND result_json IS NULL').run(JSON.stringify(receipt),held.id).changes===1,'FIRST_RECEIPT_CONFLICT');}
   return {sourceOperationId:state.original.id,releasedOriginals:state.pending.map((r:Row)=>r.id),proof};
  }
  if(command.op==='publish'){
   const p=project(principal,command.projectId,command.kind==='plugin'?'plugins':'skills','admin'),snapshot=projectSnapshot(principal,command.projectId,command.kind,command.name);
   requireValue(snapshot.row.revision===command.expectedRevision&&snapshot.sourceSha256===command.sourceSha256,'SOURCE_REVIEW_CONFLICT');
   const sourceId=randomUUID();db().prepare(`INSERT INTO customize_catalog_sources(id,installation_id,organization_id,owner_user_id,visibility,kind,name,description,source_project_id,source_resource_id,source_revision,payload_json,payload_sha256,published_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(sourceId,instance(),p.organization_id,command.visibility==='personal'?principal.id:null,command.visibility,command.kind,snapshot.row.name,snapshot.row.description??'',command.projectId,snapshot.row.id,snapshot.row.revision,JSON.stringify(snapshot.payload),snapshot.sourceSha256,principal.id,now);
   return dto(sourceRow(principal,sourceId));
  }
  if(command.op==='withdraw'||command.op==='restore-source'){
   const row=sourceRow(principal,command.sourceId);sourceAllowed(principal,row,true);requireValue(row.revision===command.expectedRevision&&Boolean(row.archived_at)===(command.op==='restore-source'),'SOURCE_REVIEW_CONFLICT');
   db().prepare('UPDATE customize_catalog_sources SET archived_at=?,revision=revision+1 WHERE id=? AND revision=?').run(command.op==='withdraw'?now:null,row.id,row.revision);return dto(sourceRow(principal,row.id));
  }
  if(command.op==='revise-plugin-source'){
   const row=sourceRow(principal,command.sourceId);sourceAllowed(principal,row,true);requireValue(row.kind==='plugin'&&!row.archived_at&&row.revision===command.expectedRevision&&row.payload_sha256===command.sourceSha256,'SOURCE_REVIEW_CONFLICT');
   const old=JSON.parse(row.payload_json);requireValue(payloadHash(old)===row.payload_sha256,'SOURCE_SNAPSHOT_CORRUPT',503);
   const payload={...old,description:command.description,source:command.source},sourceId=randomUUID(),digest=payloadHash(payload);
   db().prepare('INSERT INTO customize_catalog_sources(id,parent_source_id,installation_id,organization_id,owner_user_id,visibility,kind,name,description,source_project_id,source_resource_id,source_revision,payload_json,payload_sha256,published_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(sourceId,row.id,instance(),row.organization_id,row.owner_user_id,row.visibility,'plugin',row.name,command.description,row.source_project_id,row.source_resource_id,row.source_revision,JSON.stringify(payload),digest,principal.id,now);
   return dto(sourceRow(principal,sourceId));
  }
  if(command.op==='connect'){
   const source=sourceRow(principal,command.sourceId);requireValue(!source.archived_at&&source.revision===command.expectedRevision&&source.payload_sha256===command.sourceSha256,'SOURCE_REVIEW_CONFLICT');
   const payload=JSON.parse(source.payload_json);requireValue(payloadHash(payload)===source.payload_sha256,'SOURCE_SNAPSHOT_CORRUPT',503);
   const installedId=randomUUID();let resourceId:string|null=null,proposalId:string|null=null;
   if(source.kind==='plugin'){
    requireValue(!lifecycle.record(command.projectId,command.targetName),'TARGET_ALREADY_EXISTS');
    // Existing project owner stages source without ever writing executable bytes.
    const row=plugins.createPlugin(command.projectId,command.targetName,command.targetName+'.ts',payload.source,false) as lifecycle.PluginRecord;
    plugins.updatePluginDescription(command.projectId,command.targetName,payload.description);resourceId=row.id;
    const actual=lifecycle.record(command.projectId,command.targetName)!;requireValue(!actual.enabled&&!actual.archived_at,'PLUGIN_NOT_STAGED');lifecycle.verifyProjection(actual);
   }else{
    requireValue(!skills.getSkill(command.projectId,command.targetName),'TARGET_ALREADY_EXISTS');
    // Skills keep their original proposal/review/application/activation authority.
    const proposal=governance.createProposal(command.projectId,'create',command.targetName,JSON.stringify({description:payload.description,content:payload.content,category:payload.category,tags:payload.tags,always_apply:payload.always_apply,file_tree:payload.file_tree}));proposalId=proposal.id;
   }
   db().prepare('INSERT INTO customize_installations(id,source_id,source_sha256,project_id,kind,target_name,resource_id,proposal_id,command_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(installedId,source.id,source.payload_sha256,command.projectId,source.kind,command.targetName,resourceId,proposalId,command.operationId,principal.id,now);
   return {installationId:installedId,kind:source.kind,projectId:command.projectId,resourceId,proposalId,state:source.kind==='plugin'?'staged-disabled':'proposal-review-required',sourceSha256:source.payload_sha256};
  }
  const row=lifecycle.record(command.projectId,command.name);requireValue(row&&row.revision===command.expectedRevision,'PLUGIN_REVIEW_CONFLICT');
  lifecycle.verifyProjection(row); // Refuse changed/unowned preimages before any executable file effect.
  if(command.op==='archive-plugin')requireValue(lifecycle.archive(command.projectId,command.name),'PLUGIN_ALREADY_ARCHIVED');
  else if(command.op==='restore-plugin')requireValue(lifecycle.restore(command.projectId,command.name),'PLUGIN_NOT_ARCHIVED');
  else if(command.op==='activate-plugin'){requireValue(!row.archived_at&&typeof row.source_content==='string'&&row.source_content.length>0,'PLUGIN_SOURCE_UNAVAILABLE');plugins.enablePlugin(command.projectId,command.name);}
  else{requireValue(!row.archived_at,'PLUGIN_ARCHIVED');plugins.disablePlugin(command.projectId,command.name);}
  const actual=lifecycle.record(command.projectId,command.name)!;lifecycle.verifyProjection(actual);
  return {pluginId:actual.id,projectId:actual.project_id,revision:actual.revision,archived:Boolean(actual.archived_at),enabled:Boolean(actual.enabled)};
 }
 function command(input:unknown):Row{
  if(native)requireValue(native.nativeRequestSha256,'NATIVE_ORIGINAL_PROOF_REQUIRED',503);
  const c=CatalogCommandSchema.parse(input),scope=authorize(c),installationId=instance(),original={command:c,actorId:principal.id,installationId,...(native?{nativeConsentId:native.consentId,nativeRequestSha256:native.nativeRequestSha256}: {})},digest=payloadHash(original);
  if(native)requireValue(native.nativeRequestSha256,'NATIVE_ORIGINAL_PROOF_REQUIRED',503);
  const prior=execTransaction(()=>{
   authorize(c);const old=db().prepare('SELECT * FROM customize_commands WHERE id=?').get(c.operationId) as Row|undefined;
   if(old){requireValue(old.actor_id===principal.id&&old.installation_id===installationId&&old.payload_sha256===digest,'ORIGINAL_REUSE_CONFLICT');return old;}
   const observedPreimage=review(c);
   if(scope.projectId&&c.op!=='reconcile-plugin-projection'&&c.op!=='reconcile-local-metadata')requireValue(!db().prepare('SELECT 1 FROM customize_commands WHERE project_id=? AND kind=? AND result_json IS NULL LIMIT 1').get(scope.projectId,scope.kind),'ORIGINAL_RECONCILIATION_REQUIRED');
   db().prepare('INSERT INTO customize_commands(id,installation_id,actor_id,project_id,kind,resource_key,original_json,payload_sha256,created_at,native_consent_id,native_request_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(c.operationId,installationId,principal.id,scope.projectId,scope.kind,scope.resourceKey,JSON.stringify(original),digest,new Date().toISOString(),native?.consentId??null,native?.nativeRequestSha256??null);
   const witness=observedPreimage??(metadataOps.has(c.op)?{protocol:'customize-atomic-metadata-v1',requestSha256:digest,implementation:'local_SQLite_only_v1'}:undefined);
   if(witness)db().prepare('INSERT INTO customize_projection_preimages(command_id,snapshot_json,snapshot_sha256) VALUES(?,?,?)').run(c.operationId,JSON.stringify(witness),payloadHash(witness));return undefined;
  },1,'immediate');checkpointAfterWrite();
  if(prior)return prior.result_json?JSON.parse(prior.result_json):{operationId:c.operationId,outcome:'unknown',code:'ORIGINAL_RECONCILIATION_REQUIRED'};
  try{
   const related=c.op==='reconcile-plugin-projection'?reconciliation(c.sourceOperationId,c.operationId).pending.map((r:Row)=>r.id):[];
   const receipt=execTransaction(()=>lifecycle.withPluginCommand(c.operationId,()=>{
    const value=execute(c),receipt={operationId:c.operationId,payloadSha256:digest,outcome:'succeeded',value};
    requireValue(db().prepare('UPDATE customize_commands SET result_json=? WHERE id=? AND result_json IS NULL').run(JSON.stringify(receipt),c.operationId).changes===1,'FIRST_RECEIPT_CONFLICT');return receipt;
   },related),1,'immediate');checkpointAfterWrite();return receipt;
  }catch{
   // Domain SQL may have rolled back after a real projection changed. Preserve
   // consumed original and first receipt NULL; never retry executable effects.
   checkpointAfterWrite();return {operationId:c.operationId,payloadSha256:digest,outcome:'unknown',code:'ORIGINAL_RECONCILIATION_REQUIRED'};
  }
 }
 return {
  command,
  projectCatalog(projectId:string,resourceKind:'plugin'|'skill'){
   current();project(principal,id.parse(projectId),resourceKind==='plugin'?'plugins':'skills','read');
   const rows=resourceKind==='plugin'?plugins.listPlugins(projectId):skills.listSkills(projectId);
   return {data:rows.map(row=>({id:row.id,kind:resourceKind,name:row.name,description:row.description??'',visibility:'project',installed:true,enabled:Boolean(row.enabled),revision:(row as Row).revision??null})),projectId};
  },
  reconciliationReview(sourceOperationId:string){const witness=db().prepare('SELECT snapshot_json FROM customize_projection_preimages WHERE command_id=?').get(id.parse(sourceOperationId)) as Row|undefined;requireValue(witness,'ORIGINAL_SERVER_WITNESS_UNAVAILABLE',503);const marker=JSON.parse(witness.snapshot_json);const v=marker.protocol==='customize-atomic-metadata-v1'?atomicReconciliation(sourceOperationId):reconciliation(sourceOperationId);return {protocol:v.review.protocol,sourceOperationId:v.original.id,reviewSha256:v.reviewSha256,pluginId:v.row?.id??null,projectId:v.original.project_id,revision:v.row?.revision??null,pendingOriginals:v.pending.map((r:Row)=>r.id),purpose:marker.protocol==='customize-atomic-metadata-v1'?'atomic_local_metadata_only':'local_projection_preimage_only',remoteOutcome:'never_interpreted'};},
  projectSource(projectId:string,resourceKind:'plugin'|'skill',resourceName:string){current();const v=projectSnapshot(principal,id.parse(projectId),kind.parse(resourceKind),name.parse(resourceName));return {id:v.row.id,revision:v.row.revision,sourceSha256:v.sourceSha256,payload:v.payload};},
  catalogPage(input:unknown){
   current();const q=z.object({projectId:id,visibility,kind,after:z.string().max(128).default(''),limit:z.number().int().min(1).max(100).default(50)}).strict().parse(input);
   project(principal,q.projectId,q.kind==='plugin'?'plugins':'skills','read');
   const rows=db().prepare(`SELECT s.* FROM customize_catalog_sources s
    JOIN organization_memberships m ON m.organization_id=s.organization_id AND m.user_id=? AND m.status='active'
    WHERE s.installation_id=? AND s.visibility=? AND s.kind=? AND s.archived_at IS NULL
     AND (s.owner_user_id IS NULL OR s.owner_user_id=?) AND s.id>?
     AND (? IS NULL OR s.organization_id=?) ORDER BY s.id LIMIT ?`)
    .all(principal.id,instance(),q.visibility,q.kind,principal.id,q.after,native?.organizationId??null,native?.organizationId??null,q.limit+1) as Row[];
   const data=rows.slice(0,q.limit).map(source=>{
    sourceAllowed(principal,source);
    const installs=db().prepare('SELECT * FROM customize_installations WHERE project_id=? AND source_id=? AND kind=? ORDER BY created_at DESC,id DESC LIMIT 101').all(q.projectId,source.id,q.kind) as Row[];
    requireValue(installs.length<=100,'CATALOG_INSTALLATION_REVIEW_LIMIT',503);
    let resolved:Row|null=null,connectionState=installs.length?'unavailable':'available';
    for(const installation of installs){
     let resource:Row|undefined;
     if(q.kind==='plugin')resource=db().prepare('SELECT id,name,project_id,enabled,archived_at,revision FROM plugins WHERE project_id=? AND id=?').get(q.projectId,installation.resource_id) as Row|undefined;
     else if(installation.proposal_id){
      const proposal=db().prepare('SELECT status,target_skill_id FROM skill_proposals WHERE project_id=? AND id=?').get(q.projectId,installation.proposal_id) as Row|undefined;
      if(proposal?.status==='applied'&&proposal.target_skill_id)resource=db().prepare('SELECT id,name,project_id,enabled,archived_at,revision FROM skills WHERE project_id=? AND id=?').get(q.projectId,proposal.target_skill_id) as Row|undefined;
      else if(proposal&&!['rejected','rolled_back'].includes(proposal.status))connectionState='proposal-review-required';
     }
     if(resource){resolved={...resource,installationId:installation.id,sourceSha256:installation.source_sha256};connectionState=resource.archived_at?'archived':resource.enabled?'installed':'disabled';break;}
    }
    return {...dto(source),projectId:q.projectId,installed:resolved!==null,enabled:Boolean(resolved?.enabled),archived:Boolean(resolved?.archived_at),
     resourceId:resolved?.id??null,targetName:resolved?.name??null,resourceRevision:resolved?.revision??null,connectionState,
     installedSourceSha256:resolved?.sourceSha256??null,actions:installs.length?['review']:['connect']};
   });
   current();project(principal,q.projectId,q.kind==='plugin'?'plugins':'skills','read');
   return {projectId:q.projectId,visibility:q.visibility,kind:q.kind,data,next:rows.length>q.limit?rows[q.limit-1]!.id:null};
  },
  discover(scope:unknown,after:unknown='',limit:unknown=50){current();const v=visibility.parse(scope),take=z.number().int().min(1).max(100).parse(limit),cursor=z.string().max(128).parse(after);
   const rows=db().prepare(`SELECT s.* FROM customize_catalog_sources s JOIN organization_memberships m ON m.organization_id=s.organization_id AND m.user_id=? AND m.status='active' WHERE s.installation_id=? AND s.visibility=? AND s.archived_at IS NULL AND (s.owner_user_id IS NULL OR s.owner_user_id=?) AND s.id>? AND (? IS NULL OR s.organization_id=?) ORDER BY s.id LIMIT ?`).all(principal.id,instance(),v,principal.id,cursor,native?.organizationId??null,native?.organizationId??null,take+1) as Row[];
   for(const row of rows)sourceAllowed(principal,row);return {data:rows.slice(0,take).map(dto),next:rows.length>take?rows[take-1]!.id:null};
  },
  source(sourceId:string){current();const row=sourceRow(principal,id.parse(sourceId));requireValue(!row.archived_at,'NOT_FOUND',404);const payload=JSON.parse(row.payload_json);requireValue(payloadHash(payload)===row.payload_sha256,'SOURCE_SNAPSHOT_CORRUPT',503);return {...dto(row),payload};},
  inspect(operationId:string){current();const row=db().prepare('SELECT * FROM customize_commands WHERE id=? AND actor_id=? AND installation_id=?').get(id.parse(operationId),principal.id,instance()) as Row|undefined;requireValue(row,'NOT_FOUND',404);if(row.project_id){const p=db().prepare('SELECT organization_id,archived_at FROM projects WHERE id=?').get(row.project_id) as Row|undefined;requireValue(p,'NOT_FOUND',404);if(!p.archived_at)project(principal,row.project_id,row.kind==='plugin'?'plugins':'skills','read');else requireValue(auth.requireOrganizationPermission(principal,p.organization_id,row.kind==='plugin'?'plugins':'skills','read').allowed,'NOT_FOUND',404);}else{const original=JSON.parse(row.original_json);sourceRow(principal,original.command.sourceId);}return {operationId:row.id,payloadSha256:row.payload_sha256,...(row.result_json?JSON.parse(row.result_json):{outcome:'unknown',code:'ORIGINAL_RECONCILIATION_REQUIRED'})};},
  archivedPlugins(projectId:string){current();project(principal,id.parse(projectId),'plugins','read');return lifecycle.archived(projectId);},
  installations(projectId:string){current();project(principal,id.parse(projectId),'plugins','read');return db().prepare('SELECT * FROM customize_installations WHERE project_id=? ORDER BY created_at,id').all(projectId);},
 };
}