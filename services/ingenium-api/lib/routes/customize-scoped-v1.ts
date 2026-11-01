import {isInstallationStorageProject} from "ingenium-core";
import {committedPluginProjectionPaths,createPositivePluginProjectionOwner,createCapturedProjectRestoreOwner,createRestoredProjectInitializationOwner,PluginProjectionTransitionRequired} from 'ingenium-core/lib/tools/plugin-projection-transition';
import {ActiveSubsetRefusal} from 'ingenium-core/lib/tools/plugin-projection-active-subset';
/** Request-bound composition: original cookie/CSRF + private paired TLS + original Core writer. */
import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {getDb,execTransaction,checkpointAfterWrite,authorization,authentication,createHostedGovernanceOwner,HostedRefusal,customizeCatalog} from 'ingenium-core';
import {SCOPED_PROTOCOL,ScopedConsentRequestSchema,ScopedReadSchema,ScopedEffectSchema,ScopedNodeReceiptSchema,scopedRequestHash,requireScopedSubset,scopedReadVerbs,type ScopedVerb,type ScopedVisibility} from 'ingenium-core/lib/tools/customize-scoped-v1-contracts';
import {createNodeNativePairingOwner} from '../node-native-pairing-custody.js';
import {createNativeCustomizeContextOwner,type VerifiedNativeContextOwner} from './native-customize-context.js';
import {contextProof,type NativeOwner} from '../paired-native-proof.js';
import type {NativeProofReader} from '../native-hosted-connection-owner.js';
import {verifyScopedProof,verifyScopedOriginal} from '../customize-scoped-v1-proof.js';
import {authMiddleware,authenticateRequestWithoutActivity} from '../middleware/auth.js';
import {csrfMiddleware} from '../middleware/csrf.js';
import {toAuthorizationPrincipal} from '../authorization-policy.js';
type Row=Record<string,any>;
const uuid=z.string().uuid(),parent=z.string().min(1).max(256),hash=z.string().regex(/^[a-f0-9]{64}$/),resource=z.enum(['plugin','skill']);
function refuse(code:string,status=409):never{throw new HostedRefusal(code,status);}
function need(value:unknown,code:string,status=409):asserts value{if(!value)refuse(code,status);}
function session(req:Request,res:Response){authMiddleware(req,res,()=>{});csrfMiddleware(req,res,()=>{});const p=req.principal;need(p?.type==='user'&&p.session,'BROWSER_SESSION_REQUIRED',401);return p;}
const instance=()=>{const r=getDb().prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get() as Row|undefined;need(r?.instance_id,'HOST_IDENTITY_UNAVAILABLE',503);return r.instance_id as string;};
function ownedConsent(req:Request,consentId:string):Row{
 const p=req.principal;need(p?.type==='user'&&p.session,'BROWSER_SESSION_REQUIRED',401);
 const row=getDb().prepare('SELECT * FROM customize_native_consents WHERE id=? AND owner_user_id=? AND installation_id=?').get(uuid.parse(consentId),p.id,instance()) as Row|undefined;need(row,'NOT_FOUND',404);return row;
}
function projectRow(projectId:string):Row{const row=getDb().prepare('SELECT * FROM projects WHERE id=? AND archived_at IS NULL').get(projectId) as Row|undefined;need(row,'NOT_FOUND',404);return row;}
function allow(req:Request,projectId:string,kind:'plugin'|'skill',permission:'read'|'admin'|'execute'){
 const p=req.principal;need(p?.type==='user'&&p.session,'BROWSER_SESSION_REQUIRED',401);
 return authorization.requireProjectPermission(toAuthorizationPrincipal(p),projectId,kind==='plugin'?'plugins':'skills',permission).allowed;
}
function sourceFacts(id:string,organizationId:string):Row{
 const row=getDb().prepare('SELECT * FROM customize_catalog_sources WHERE id=? AND organization_id=? AND installation_id=?').get(uuid.parse(id),organizationId,instance()) as Row|undefined;need(row,'NOT_FOUND',404);return row;
}
/** No injected Native or database owner; all reads use the enrolled private credential. */
async function paired<T>(req:Request,parentGrantId:string,work:(reader:NativeProofReader,binding:Row,organization:Row,check:()=>void)=>Promise<T>){
 const p=req.principal;need(p?.type==='user'&&p.session,'BROWSER_SESSION_REQUIRED',401);const actorId=p.id,installationId=instance();
 const g=getDb().prepare('SELECT * FROM native_hosted_governance_grants WHERE id=? AND owner_user_id=? AND installation_id=? AND revoked_at IS NULL').get(parent.parse(parentGrantId),actorId,installationId) as Row|undefined;need(g,'NOT_FOUND',404);
 return createNodeNativePairingOwner(req).custody.withOriginal(actorId,installationId,g.enrollment_request_id,async reader=>{
  const started=performance.now(),n:NativeOwner=contextProof(await reader.readContext(),reader.original);
  const check=()=>{reader.assertCurrent();need(performance.now()-started<=2000,'NATIVE_PROOF_EXPIRED',503);};
  const verified:VerifiedNativeContextOwner={enrollment(){return refuse('ENROLLMENT_UNSUPPORTED',403);},current(_req,grant,recovery,actor){
   check();need(!recovery&&actor===actorId&&grant.id===g.id&&grant.owner_user_id===actorId&&grant.installation_id===installationId&&grant.enrollment_request_id===reader.original.enrollmentRequestId&&grant.hosted_project_id===reader.original.hostedProjectId&&grant.native_library_id===n.library_id&&grant.native_service_instance_id===n.service_instance_id&&grant.native_project_id===(n.project?.id??null)&&grant.native_project_revision===(n.project?.revision??null),'NATIVE_OWNER_CHANGED',503);
  }};
  const owner=createHostedGovernanceOwner(createNativeCustomizeContextOwner(verified)(req));
  const binding=owner.binding(g.id).binding,organization=projectRow(binding.hostedProjectId);
  const current=()=>{check();need(scopedRequestHash(owner.binding(g.id).binding)===scopedRequestHash(binding),'SCOPED_PARENT_CHANGED');};
  current();return work(reader,binding,organization,current);
 });
}
function offer(req:Request,binding:Row,live=false){
 const projectId=binding.hostedProjectId,scopes:ScopedVisibility[]=['project','personal','public'];
 if(binding.visibility==='system')scopes.push('system');
 const verbs:ScopedVerb[]=[...scopedReadVerbs],pluginAdmin=allow(req,projectId,'plugin','admin'),skillAdmin=allow(req,projectId,'skill','admin');
 let namespaceAvailable=isInstallationStorageProject(projectRow(projectId).id);
 if(!namespaceAvailable){try{committedPluginProjectionPaths(projectId);namespaceAvailable=true;}catch{namespaceAvailable=false;}}
 if(pluginAdmin||skillAdmin){verbs.push('publish');if(namespaceAvailable)verbs.push('connect');}
 if(pluginAdmin){verbs.push('withdraw','restore-source','revise-plugin-source','reconcile-local-metadata');if(namespaceAvailable)verbs.push('archive-plugin','restore-plugin','reconcile-plugin-projection');}
 if(pluginAdmin&&namespaceAvailable&&allow(req,projectId,'plugin','execute'))verbs.push('activate-plugin','deactivate-plugin');
 const p=req.principal,recent=p?.type==='user'&&!!p.session&&authentication.hasRecentStepUp(p.session);
 const sensitive=new Set<ScopedVerb>(['publish','activate-plugin','withdraw','restore-source','revise-plugin-source','reconcile-plugin-projection','reconcile-local-metadata']);
 return {scopes,verbs:live&&!recent?verbs.filter(v=>!sensitive.has(v)):verbs};
}
function currentConsent(row:Row,proof:ReturnType<typeof verifyScopedProof>,binding:Row,check:()=>void){
 check();const now=getDb().prepare('SELECT * FROM customize_native_consents WHERE id=?').get(row.id) as Row|undefined;
 const parentProject=projectRow(binding.hostedProjectId);
 need(now&&now.organization_id===parentProject.organization_id&&now.hosted_project_id===binding.hostedProjectId&&now.parent_grant_id===binding.grantId&&now.enrollment_request_id===proof.context.enrollment_request_id&&now.native_custodian_grant_id===(proof.context.grant as Row|undefined)?.id&&scopedRequestHash(JSON.parse(now.original_json))===now.request_sha256,'SCOPED_CONSENT_OWNER_CHANGED');
 need(now&&!now.revoked_at&&now.revision===row.revision&&now.request_sha256===row.request_sha256&&proof.consentRevision===row.revision&&proof.requestSha256===row.request_sha256&&scopedRequestHash(proof.original)===row.request_sha256&&scopedRequestHash(proof.original.baseBinding)===scopedRequestHash(binding),'SCOPED_CONSENT_CHANGED');
}
function scopedAuthority(req:Request,row:Row,proof:ReturnType<typeof verifyScopedProof>,binding:Row,check:()=>void,nativeRequestSha256?:string){
 const current=()=>currentConsent(row,proof,binding,check),selection=proof.original.selection;
 function verb(value:ScopedVerb){current();need(selection.verbs.includes(value)&&proof.effectiveVerbs.includes(value),'SCOPED_VERB_DENIED',403);}
 function scope(value:ScopedVisibility){need(selection.scopes.includes(value),'SCOPED_VISIBILITY_DENIED',403);}
 function project(id:string){scope('project');need(id===row.hosted_project_id,'NOT_FOUND',404);}
 function source(id:string){const source=sourceFacts(id,row.organization_id);scope(source.visibility);return source;}
 function operation(id:string){const original=getDb().prepare('SELECT * FROM customize_commands WHERE id=? AND native_consent_id=? AND actor_id=? AND installation_id=?').get(uuid.parse(id),row.id,row.owner_user_id,row.installation_id) as Row|undefined;need(original,'NOT_FOUND',404);return original;}
 const native:customizeCatalog.VerifiedScopedCustomizeContext={consentId:row.id,organizationId:row.organization_id,nativeRequestSha256,assertCurrent:current,authorizeCommand(c){
  verb(c.op);if('projectId' in c)project(c.projectId);if('sourceId' in c)source(c.sourceId);if(c.op==='publish')scope(c.visibility);
  if('sourceOperationId' in c){const old=operation(c.sourceOperationId);if(old.project_id)project(old.project_id);const stored=JSON.parse(old.original_json);if(stored.command.sourceId)source(stored.command.sourceId);}
 }};
 const p=req.principal;need(p?.type==='user'&&p.session,'BROWSER_SESSION_REQUIRED',401);
 return {owner:customizeCatalog.createCustomizeCatalogOwner(toAuthorizationPrincipal(p),native),verb,scope,project,source,operation,current};
}
export function createNativeScopedCustomizeRouter(){
 const router=Router();
 const run=(work:(req:Request,res:Response)=>Promise<unknown>|unknown)=>async(req:Request,res:Response,next:NextFunction)=>{
  res.set('Cache-Control','no-store');try{session(req,res);res.json({data:await work(req,res)});}catch(e){
   if(e instanceof HostedRefusal||e instanceof customizeCatalog.CustomizeCatalogRefusal||e instanceof ActiveSubsetRefusal){res.status(e.status).json({error:{code:e.code,message:'Scoped Customize request refused'}});return;}
   if(e instanceof PluginProjectionTransitionRequired){res.status(409).json({error:{code:e.code,message:'Project namespace requires its original owner'}});return;}
   if(e instanceof z.ZodError){res.status(422).json({error:{code:'INVALID_SCOPED_CONTRACT',message:'Use the explicit versioned consent contract'}});return;}next(e);
  }
 };
 /** Deliberate browser administrator transition. No Native proof/renderer grant can invoke this owner. */
 const withProjectOwner=<Owner>(req:Request,write:boolean,factory:(principal:Parameters<typeof createPositivePluginProjectionOwner>[0],current:()=>void)=>Owner,work:(owner:Owner)=>unknown)=>{
  const original=req.principal;need(original?.type==='user'&&original.session,'BROWSER_SESSION_REQUIRED',401);const actorId=original.id,sessionId=original.session.id;
  const assertCurrent=()=>{authenticateRequestWithoutActivity(req);csrfMiddleware(req,{} as Response,()=>{});const p=req.principal;need(p?.type==='user'&&p.session&&p.id===actorId&&p.session.id===sessionId,'BROWSER_SESSION_CHANGED',401);if(write)need(authentication.hasRecentStepUp(p.session),'RECENT_STEP_UP_REQUIRED',403);};
  assertCurrent();const result=work(factory(toAuthorizationPrincipal(original),assertCurrent));assertCurrent();return result;
 };
 const withTransitionOwner=(req:Request,write:boolean,work:(owner:ReturnType<typeof createPositivePluginProjectionOwner>)=>unknown)=>withProjectOwner(req,write,createPositivePluginProjectionOwner,work);
 const restoreSelection=z.object({projectId:uuid}).strict(),restoreApply=restoreSelection.extend({operationId:uuid,reviewSha256:hash}).strict();
 router.post('/project-restore/review',run(req=>withProjectOwner(req,false,createCapturedProjectRestoreOwner,owner=>owner.review(restoreSelection.parse(req.body).projectId))));
 router.post('/project-restore/apply',run(req=>withProjectOwner(req,true,createCapturedProjectRestoreOwner,owner=>owner.apply(restoreApply.parse(req.body)))));
 router.get('/project-restore/operations/:id',run(req=>withProjectOwner(req,false,createCapturedProjectRestoreOwner,owner=>owner.inspect(uuid.parse(req.params.id)))));
 const disabledSelection=z.object({projectId:uuid,configOrigin:z.enum(['new-empty','database-project','existing-target'])}).strict();
 router.post('/plugin-namespace/restore-initialization/review',run(req=>withProjectOwner(req,false,createRestoredProjectInitializationOwner,owner=>{const q=disabledSelection.parse(req.body);return owner.review(q.projectId,q.configOrigin);} )));
 router.post('/plugin-namespace/restore-initialization/apply',run(req=>withProjectOwner(req,true,createRestoredProjectInitializationOwner,owner=>owner.apply(disabledSelection.extend({operationId:uuid,reviewSha256:hash}).strict().parse(req.body)))));
 router.post('/plugin-namespace/restore-initialization/reconcile',run(req=>withProjectOwner(req,true,createRestoredProjectInitializationOwner,owner=>owner.reconcile(z.object({operationId:uuid,sourceOperationId:uuid,sourcePayloadSha256:hash}).strict().parse(req.body)))));
 router.get('/plugin-namespace/restore-initialization/operations/:id',run(req=>withProjectOwner(req,false,createRestoredProjectInitializationOwner,owner=>owner.inspect(uuid.parse(req.params.id)))));
 const configOrigin=z.enum(['new-empty','database-project','reviewed-legacy-raw']);
 const transitionSelection=z.object({mode:z.enum(['fresh-project','captured-legacy-cohort','captured-active-subset']),projectId:uuid,configOrigin:z.union([configOrigin,z.record(uuid,configOrigin)])}).strict();
 router.post('/plugin-namespace/review',run(req=>withTransitionOwner(req,false,owner=>{const q=transitionSelection.parse(req.body);return owner.review(q.mode,q.projectId,q.configOrigin);})));
 router.post('/plugin-namespace/apply',run(req=>withTransitionOwner(req,true,owner=>owner.apply(transitionSelection.extend({operationId:uuid,reviewSha256:hash}).strict().parse(req.body)))));
 router.post('/plugin-namespace/reconcile',run(req=>withTransitionOwner(req,true,owner=>owner.reconcile(z.object({operationId:uuid,sourceOperationId:uuid,sourcePayloadSha256:hash}).strict().parse(req.body)))));
 router.get('/plugin-namespace/operations/:id',run(req=>withTransitionOwner(req,false,owner=>owner.inspect(uuid.parse(req.params.id)))));
 router.get('/offer',run(req=>{const q=z.object({parentGrantId:parent}).strict().parse(req.query);return paired(req,q.parentGrantId,async(_reader,binding,project,check)=>{check();return {protocol:SCOPED_PROTOCOL,baseBinding:binding,organizationId:project.organization_id,selection:offer(req,binding),recentStepUp:req.principal?.type==='user'&&!!req.principal.session&&authentication.hasRecentStepUp(req.principal.session),requiresSeparateConsent:true};});}));
 router.post('/consents',run(async req=>{
  const body=ScopedConsentRequestSchema.parse(req.body),p=req.principal;need(p?.type==='user'&&p.session&&authentication.hasRecentStepUp(p.session),'STEP_UP_REQUIRED',403);
  return paired(req,body.parentGrantId,async(reader,binding,project,check)=>{
   need(reader.original.enrollmentRequestId===body.enrollmentRequestId,'NATIVE_OWNER_CHANGED',503);
   const proof=verifyScopedProof(await reader.readScopedConsent(body.consentId,'prepare'),reader.original,{consentId:body.consentId,requestSha256:body.requestSha256,purpose:'prepare'});
   need(scopedRequestHash(proof.original.baseBinding)===scopedRequestHash(binding),'SCOPED_PARENT_CHANGED');requireScopedSubset(offer(req,binding),proof.original.selection);requireScopedSubset({scopes:proof.original.selection.scopes,verbs:proof.effectiveVerbs},proof.original.selection);
   const receipt=ScopedNodeReceiptSchema.parse({protocol:SCOPED_PROTOCOL,consentId:body.consentId,revision:1,requestSha256:body.requestSha256,actorId:p.id,installationId:instance(),enrollmentRequestId:body.enrollmentRequestId,baseBindingSha256:scopedRequestHash(binding),selection:proof.original.selection,physicalErasure:false});
   const result=execTransaction(()=>{check();const freshSession=session(req,{} as Response);need(authentication.hasRecentStepUp(freshSession.session!),'STEP_UP_REQUIRED',403);
    const old=getDb().prepare('SELECT * FROM customize_native_consents WHERE id=?').get(body.consentId) as Row|undefined;
    if(old){need(old.owner_user_id===p.id&&old.installation_id===instance()&&old.request_sha256===body.requestSha256&&old.parent_grant_id===body.parentGrantId,'SCOPED_CONSENT_REUSE_CONFLICT');need(!old.revoked_at,'SCOPED_CONSENT_REVOKED');return ScopedNodeReceiptSchema.parse(JSON.parse(old.registration_json));}
    getDb().prepare('INSERT INTO customize_native_consents(id,owner_user_id,installation_id,parent_grant_id,enrollment_request_id,organization_id,hosted_project_id,native_custodian_grant_id,original_json,request_sha256,registration_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(body.consentId,p.id,instance(),body.parentGrantId,body.enrollmentRequestId,project.organization_id,binding.hostedProjectId,reader.original.grantId,JSON.stringify(proof.original),body.requestSha256,JSON.stringify(receipt),new Date().toISOString());return receipt;
   },1,'immediate');checkpointAfterWrite();return result;
  });
 }));
 router.get('/consents/:consentId/context',run(async req=>{
  const q=z.object({requestSha256:hash,consentRevision:z.coerce.number().int().min(1)}).strict().parse(req.query),row=ownedConsent(req,String(req.params.consentId));
  need(q.requestSha256===row.request_sha256&&q.consentRevision===row.revision,'SCOPED_CONSENT_CHANGED');
  return paired(req,row.parent_grant_id,async(reader,binding,_project,check)=>{
   const proof=verifyScopedProof(await reader.readScopedConsent(row.id,'domain'),reader.original,{consentId:row.id,requestSha256:row.request_sha256,purpose:'domain'});currentConsent(row,proof,binding,check);
   const available=offer(req,binding,true);return {protocol:SCOPED_PROTOCOL,consentId:row.id,consentRevision:row.revision,consentRequestSha256:row.request_sha256,baseBinding:binding,selection:proof.original.selection,capabilities:proof.effectiveVerbs.filter(v=>available.verbs.includes(v)),localProfileRevision:proof.localProfileRevision,parentProfileRevision:proof.parentProfileRevision};
  });
 }));
 // Metadata recovery is same-account only. It never establishes current Native/domain authority.
 router.get('/consents/:consentId/receipt',run(req=>{const q=z.object({requestSha256:hash}).strict().parse(req.query),row=ownedConsent(req,String(req.params.consentId));need(row.request_sha256===q.requestSha256,'SCOPED_CONSENT_REUSE_CONFLICT');return {receipt:JSON.parse(row.registration_json),revoked:Boolean(row.revoked_at),revision:row.revision,liveBinding:false,domainReadback:'not_requested'};}));
 router.get('/consents/:consentId/operations/:operationId',run(req=>{
  const q=z.object({nativeRequestSha256:hash}).strict().parse(req.query),row=ownedConsent(req,String(req.params.consentId)),p=req.principal;need(p?.type==='user','BROWSER_SESSION_REQUIRED',401);
  need(authorization.requireOrganizationPermission(toAuthorizationPrincipal(p),row.organization_id,'plugins','read').allowed,'NOT_FOUND',404);
  const op=getDb().prepare('SELECT * FROM customize_commands WHERE id=? AND native_consent_id=? AND actor_id=? AND installation_id=?').get(uuid.parse(req.params.operationId),row.id,p.id,row.installation_id) as Row|undefined;
  if(!op)return {protocol:SCOPED_PROTOCOL,operationId:req.params.operationId,nativeRequestSha256:q.nativeRequestSha256,consentId:row.id,outcome:'unknown',liveBinding:false,domainReadback:'not_requested'};
  need(op.native_request_sha256===q.nativeRequestSha256,'SCOPED_ORIGINAL_REUSE_CONFLICT');const result=op.result_json?JSON.parse(op.result_json):null;
  return {protocol:SCOPED_PROTOCOL,operationId:op.id,nativeRequestSha256:op.native_request_sha256,consentId:row.id,outcome:result?.outcome??'unknown',code:result?.code??null,liveBinding:false,domainReadback:'not_requested'};
 }));
 router.post('/consents/:consentId/revoke',run(req=>{const body=z.object({requestSha256:hash,expectedRevision:z.number().int().min(1)}).strict().parse(req.body),row=ownedConsent(req,String(req.params.consentId));need(row.request_sha256===body.requestSha256,'SCOPED_CONSENT_REUSE_CONFLICT');
  const result=execTransaction(()=>{const fresh=ownedConsent(req,row.id);if(fresh.revoked_at)return {consentId:row.id,revision:fresh.revision,revoked:true,physicalErasure:false};need(fresh.revision===body.expectedRevision,'SCOPED_CONSENT_CHANGED');getDb().prepare('UPDATE customize_native_consents SET revoked_at=?,revision=revision+1 WHERE id=? AND revision=? AND revoked_at IS NULL').run(new Date().toISOString(),row.id,body.expectedRevision);return {consentId:row.id,revision:body.expectedRevision+1,revoked:true,physicalErasure:false};},1,'immediate');checkpointAfterWrite();return result;
 }));
 router.post('/read',run(async req=>{const input=ScopedReadSchema.parse(req.body),row=ownedConsent(req,input.consentId);need(scopedReadVerbs.has(input.verb),'SCOPED_READ_REQUIRED',422);
  return paired(req,row.parent_grant_id,async(reader,binding,_project,check)=>{const proof=verifyScopedProof(await reader.readScopedConsent(row.id,'domain'),reader.original,{consentId:row.id,requestSha256:row.request_sha256,purpose:'domain'}),s=scopedAuthority(req,row,proof,binding,check);need(input.consentRevision===row.revision,'SCOPED_CONSENT_CHANGED');s.verb(input.verb);let value:unknown;
   switch(input.verb){
    case 'discover':{const q=z.object({visibility:z.enum(['project','personal','public','system']),kind:resource.default('plugin'),after:z.string().max(128).default(''),limit:z.number().int().min(1).max(100).default(50)}).strict().parse(input.query);s.scope(q.visibility);value=q.visibility==='project'?(s.project(row.hosted_project_id),s.owner.projectCatalog(row.hosted_project_id,q.kind)):s.owner.discover(q.visibility,q.after,q.limit);break;}
    case 'source':{const q=z.object({sourceId:uuid}).strict().parse(input.query);s.source(q.sourceId);value=s.owner.source(q.sourceId);break;}
    case 'project-source':{const q=z.object({projectId:uuid,kind:resource,name:z.string().min(1).max(64)}).strict().parse(input.query);s.project(q.projectId);value=s.owner.projectSource(q.projectId,q.kind,q.name);break;}
    case 'archived-plugins':case 'installations':{const q=z.object({projectId:uuid}).strict().parse(input.query);s.project(q.projectId);value=input.verb==='archived-plugins'?s.owner.archivedPlugins(q.projectId):s.owner.installations(q.projectId);break;}
    case 'operation':{const q=z.object({operationId:uuid,review:z.boolean().default(false)}).strict().parse(input.query);s.operation(q.operationId);value=q.review?s.owner.reconciliationReview(q.operationId):s.owner.inspect(q.operationId);break;}
    case 'pending':{z.object({}).strict().parse(input.query);value=getDb().prepare('SELECT id,native_request_sha256 FROM customize_commands WHERE native_consent_id=? AND actor_id=? AND installation_id=? AND result_json IS NULL ORDER BY id').all(row.id,row.owner_user_id,row.installation_id);break;}
    default:return refuse('SCOPED_READ_UNSUPPORTED',422);
   }s.current();return {protocol:SCOPED_PROTOCOL,consentId:row.id,consentRevision:row.revision,value};
  });
 }));
 router.post('/effects',run(async req=>{const input=ScopedEffectSchema.parse(req.body),row=ownedConsent(req,input.consentId),digest=scopedRequestHash(input);return paired(req,row.parent_grant_id,async(reader,binding,_project,check)=>{
  const verified=verifyScopedOriginal(await reader.readScopedOriginal(row.id,input.id,digest),reader.original,input),s=scopedAuthority(req,row,verified.proof,binding,check,digest),command=customizeCatalog.CatalogCommandSchema.parse(input.command);
  need(command.operationId===input.id,'SCOPED_ORIGINAL_ID_CONFLICT');const p=req.principal;need(p?.type==='user'&&p.session,'BROWSER_SESSION_REQUIRED',401);
  if(['activate-plugin','withdraw','restore-source','revise-plugin-source','reconcile-plugin-projection','reconcile-local-metadata'].includes(command.op)||command.op==='publish'&&command.visibility!=='personal')need(authentication.hasRecentStepUp(p.session),'STEP_UP_REQUIRED',403);
  const value=s.owner.command(command);return {protocol:SCOPED_PROTOCOL,operationId:input.id,nativeRequestSha256:digest,consentId:row.id,outcome:value.outcome,value:value.outcome==='succeeded'?value.value:null,error:value.code?{code:value.code}:null};
 });}));
 return router;
}