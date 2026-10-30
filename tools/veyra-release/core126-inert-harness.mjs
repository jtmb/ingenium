import {createHash,randomUUID} from 'node:crypto';
import {createCore126DockerProbeOwner,originalContainerProfileSha256} from './core126-docker-binary.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
const must=(v,c)=>{if(!v)throw fail(c);};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const AGENT_FIELDS=['description','mode','system','hidden','permissions'];
const JOB_MCP='/app/services/ingenium-api/dist/scripts/runtime-job-mcp.js';
const BUILTINS=['opencode.models.dev','opencode.provider.opencode','opencode.config.policy'];
const PLUGINS=['/usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker','/usr/local/share/ingenium/opencode-managed/plugins/enforce-job-agent'];
export const INERT_CASE_IDS=Object.freeze(['hostile-project-config-excluded','plugin-unload-denial','plugin-transform-fault-denial','session-rule-override-denial','native-reload-definition-stable','agent-definition-binding','changed-agent-denial','changed-permissions-denial','closed-job-config','reserved-broker-denial','child-model-binding','job-broker-route','wrong-audience-denial','wrong-run-attempt-denial','private-tool-denial','changed-grant-denial','unqualified-assignment-denial','original-result-route']);
const NATIVE=new Set(INERT_CASE_IDS.slice(0,6).concat('closed-job-config'));
const NEGATIVE_NATIVE=new Set(['plugin-unload-denial','plugin-transform-fault-denial','session-rule-override-denial']);
function json(bytes){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function rows(report,id){const item=report?.before?.[id]?.data;must(item!==undefined,'NATIVE_ACTUAL_INVENTORY_MISSING');return id==='config.get'?item:item?.data;}
export function nativeAgentProjection(inventory){must(Array.isArray(inventory),'NATIVE_AGENT_SHAPE');const selected=inventory.find(a=>a.id==='qualification');must(selected,'NATIVE_QUALIFICATION_AGENT_MISSING');return Object.fromEntries(AGENT_FIELDS.map(k=>[k,selected[k]]));}
export function assertNativePluginInventory(plugins){
 const expected=[...BUILTINS,'ingenium.enforce-reserved-broker','ingenium.enforce-job-agent'].sort();
 must(Array.isArray(plugins)&&JSON.stringify(plugins.map(p=>p.id).sort())===JSON.stringify(expected),'NATIVE_ACTIVE_PLUGIN_SET');
 for(const plugin of plugins){must(plugin.state?.status==='active','NATIVE_PROTECTED_PLUGIN_NOT_ACTIVE');if(BUILTINS.includes(plugin.id))must(plugin.source?.type==='builtin','NATIVE_BUILTIN_SOURCE_CHANGED');else must(plugin.source?.type==='local'&&plugin.source.path===PLUGINS[plugin.id==='ingenium.enforce-job-agent'?1:0],'NATIVE_PROTECTED_PLUGIN_SOURCE_CHANGED');}
}
function nativeFacts(report){const agents=rows(report,'agent.list'),plugins=rows(report,'plugin.list'),config=rows(report,'config.get'),mcp=rows(report,'mcp.list'),models=rows(report,'model.list');must([agents,plugins,config,mcp,models].every(Array.isArray),'NATIVE_V2_INVENTORY_SHAPE');return{agents,plugins,config,mcp,models};}
/** Derived from raw native inventory; name-only and config intention cannot pass. */
export function evaluateNativeCase(caseId,report,context){
 const f=nativeFacts(report);assertNativePluginInventory(f.plugins);const agent=nativeAgentProjection(f.agents),agentHash=sha(JSON.stringify(agent));
 must(agentHash===context.agentHash,'NATIVE_ACTUAL_AGENT_HASH_MISMATCH');
 must(f.agents.length===2&&f.agents.some(a=>a.id==='ingenium-llm-broker'),'NATIVE_EXTRA_AGENT_OR_BROKER_MISSING');
 must(report.originalNativeExit&&!report.originalNativeExit.spawnError&&!report.originalNativeExit.stopUnconfirmed&&(Number.isInteger(report.originalNativeExit.code)||['SIGTERM','SIGINT'].includes(report.originalNativeExit.signal)),'NATIVE_ORIGINAL_CHILD_RETIREMENT_UNCONFIRMED');
 must(report.rawSchemaSha256===context.schemaSha256,'NATIVE_RAW_SCHEMA_BINDING');
 const observations={effectiveAgentHash:agentHash,inventorySha256:Object.fromEntries(Object.entries(report.before).map(([k,v])=>[k,v.rawSha256])),schemaSha256:report.rawSchemaSha256,originalChildExitCode:report.originalNativeExit.code,originalChildExitSignal:report.originalNativeExit.signal};
 if(caseId==='agent-definition-binding'){must(Array.isArray(report.records)&&report.records.length===0,'NATIVE_UNEXPECTED_MODEL_REQUEST');return{...observations,coreAgentHash:context.agentHash,projection:'native-v2-agents',modelDispatches:report.records.length};}
 if(caseId==='native-reload-definition-stable'){
  must(report.reload?.status>=200&&report.reload.status<300,'NATIVE_RELOAD_NOT_EXERCISED');
  const after=nativeAgentProjection(report.after?.['agent.list']?.data?.data);must(sha(JSON.stringify(after))===agentHash,'NATIVE_RELOAD_AGENT_CHANGED');throw fail('ORIGINAL_NATIVE_RELOAD_DISPATCH_EVENT_PRODUCER_REQUIRED');
 }
 if(caseId==='closed-job-config'||caseId==='hostile-project-config-excluded'){
  // Native MCP status is NOT its command definition. Inspect actual Config.Entry documents.
  const docs=f.config.filter(c=>c.type==='document'),definitions=docs.flatMap(d=>Object.entries(d.info?.mcp?.servers??{}));
  must(definitions.length===1&&definitions[0][0]==='ingenium','NATIVE_MCP_DEFINITION_UNAVAILABLE');const definition=definitions[0][1];
  must(JSON.stringify(definition.command)===JSON.stringify(['node',JOB_MCP]),'NATIVE_GENERIC_MCP_COMMAND');
  must(f.mcp.length===1&&f.mcp[0].name==='ingenium','NATIVE_EXTRA_MCP_SERVER');
  const configured=docs.flatMap(d=>d.info?.plugins??[]);must(PLUGINS.every(p=>configured.includes(p)),'NATIVE_JOB_PLUGINS_NOT_IN_ACTUAL_CONFIG');
  // Plugin state DTO and source provenance must be verified by original native event producer.
  throw fail(caseId==='hostile-project-config-excluded'?'ORIGINAL_HOSTILE_CANARY_PROVENANCE_REQUIRED':'NATIVE_PLUGIN_ACTIVE_AND_BOOTSTRAP_EVENT_PRODUCER_REQUIRED');
 }
 if(NEGATIVE_NATIVE.has(caseId)){
  must(Number.isSafeInteger(report.calibrationRequests)&&report.calibrationRequests>0,'NATIVE_INERT_COUNTER_NOT_CALIBRATED');
  must(Number.isFinite(report.operationAttemptedAt)&&report.requestsAfterAttempt===0,'NATIVE_NEGATIVE_PROVIDER_EFFECT');
  must(report.prompt?.status>=400||['failed','interrupted'].includes(report.sessionOutcome),'NATIVE_NEGATIVE_COMPLETION_UNCONFIRMED');
  // Zero provider traffic cannot prove an unattempted reserved tool, default-agent fallback,
  // original Core revocation, actual unload or grouped transform hook invocation.
  throw fail('ORIGINAL_NATIVE_LOSS_HOOK_AND_REVOCATION_PRODUCER_REQUIRED');
 }
 throw fail('NATIVE_CASE_PRIMITIVE_UNAVAILABLE');
}
function validateCandidate(c){must(c&&/^sha256:[a-f0-9]{64}$/.test(c.imageId)&&hex(c.schemaSha256)&&hex(c.source?.sha256)&&/^[a-f0-9]{40}$/.test(c.source?.revision??'')&&hex(c.agentHash),'ORIGINAL_CANDIDATE_IDENTITY');for(const rows of [c.source.files,c.files])must(Array.isArray(rows)&&rows.length>0&&rows.length<=128&&new Set(rows.map(r=>r.path)).size===rows.length&&rows.every(r=>typeof r.path==='string'&&hex(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0),'ORIGINAL_CANDIDATE_ACTUAL_CLOSURE');must(c.files.length<=64,'PROBE_ARTIFACT_BOUND');}
async function dockerJson(io,path){const r=await io.request('GET',path);must(r.status===200,'ORIGINAL_DOCKER_INSPECT_STATUS');return{data:json(r.bytes),rawSha256:sha(r.bytes)};}
async function actualCoreRequest(api,path,body){
 must(api&&typeof api.origin==='string'&&typeof api.token==='string'&&api.token.length>0&&uuid(api.runId)&&uuid(api.attemptId),'ORIGINAL_CORE_FIXTURE_REQUIRED');const u=new URL(api.origin);must(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&typeof path==='string'&&path.startsWith('/api/v1/runtime/job-runs/'),'ORIGINAL_CORE_ROUTE_SCOPE');
 const r=await fetch(new URL(path,u),{method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body),redirect:'error',headers:{Authorization:'Bearer '+api.token,'x-ingenium-audience':'job-run','x-ingenium-job-attempt':api.attemptId,...(body===undefined?{}:{'Content-Type':'application/json'})},signal:AbortSignal.timeout(7000)});let bytes=0;const h=createHash('sha256');for await(const b of r.body??[]){bytes+=b.length;must(bytes<=1024*1024,'CORE_RESPONSE_BOUND');h.update(b);}return{status:r.status,rawSha256:h.digest('hex'),bytes};
}
/** Called INSIDE the original manager. open/withdraw are original Core fixture
 * lifecycle operations, not outcome/trace callbacks. No Docker socket, token CLI,
 * model executor, expected trace, second assignment owner or approval is created. */
export function createCore126InertHarness({io,probeSource,probeSha256,openOriginalCase,withdrawOriginalCase,mutateOriginalCase}){
 must(typeof openOriginalCase==='function'&&typeof withdrawOriginalCase==='function','ORIGINAL_CORE_FIXTURE_OWNER_REQUIRED');const probe=createCore126DockerProbeOwner({io,probeSource,probeSha256});
 return Object.freeze({async run(candidate){
  validateCandidate(candidate);const results=[];
  for(const caseId of INERT_CASE_IDS){const nonce=randomUUID();let fixture,retirement,observation,error,cleanupError;
   try{
    fixture=await openOriginalCase({caseId,nonce,imageId:candidate.imageId,sourceSha256:candidate.source.sha256,probeSha256});
    must(fixture&&fixture.kind==='core126-original-public-canary-v1'&&fixture.caseId===caseId&&fixture.nonce===nonce,'ORIGINAL_ONE_USE_CASE_REQUIRED');
    const b=fixture.binding;must(b?.imageId===candidate.imageId&&hex(b.containerId),'ORIGINAL_CASE_IMAGE_BINDING');
    const daemon=await dockerJson(io,'/info'),container=await dockerJson(io,'/containers/'+b.containerId+'/json'),image=await dockerJson(io,'/images/'+candidate.imageId+'/json');
    must(daemon.data.ID===b.daemonId&&image.data.Id===candidate.imageId&&container.data.Image===candidate.imageId&&container.data.Id===b.containerId&&container.data.State?.Running===true&&container.data.State.StartedAt===b.startedAt&&originalContainerProfileSha256(container.data)===b.publicProfileSha256,'ORIGINAL_CASE_IDENTITY_CHANGED');
    const base={fixtureKind:'core126-public-canary-v1',caseId,nonce};
    const versionExec=await probe.exec(b.containerId,{...base,action:'version'}),version=json(versionExec.stdout);must(versionExec.exitCode===0&&version.result?.version==='2.0.11','NATIVE_PINNED_VERSION_UNCONFIRMED');
    const staticExec=await probe.exec(b.containerId,{...base,action:'static-files',paths:candidate.files.map(r=>r.path)}),staticResult=json(staticExec.stdout);must(staticExec.exitCode===0&&staticResult.result?.files,'ORIGINAL_STATIC_ARTIFACT_PRODUCER_UNAVAILABLE');
    for(const expected of candidate.files){const actual=staticResult.result.files.find(r=>r.path===expected.path);must(actual&&actual.sha256===expected.sha256&&actual.bytes===expected.bytes&&actual.uid===0&&actual.gid===0&&!(actual.mode&0o022),'ORIGINAL_STATIC_ARTIFACT_CHANGED');}
    if(NATIVE.has(caseId)){
     must(!fixture.nativeInput?.mutation,'IMMUTABLE_ARTIFACT_MUTATION_CANNOT_QUALIFY_CANDIDATE');
     const input={...fixture.nativeInput,...base,action:'native',schemaSha256:candidate.schemaSha256,inventoryOnly:!NEGATIVE_NATIVE.has(caseId),reload:caseId==='native-reload-definition-stable',permissionOverride:caseId==='session-rule-override-denial'};
     // Fixture cannot substitute the case/nonce/schema/action or bypass negative calibration.
     if(NEGATIVE_NATIVE.has(caseId)){input.mutationPhase='after-calibration';input.skipMutation=caseId==='session-rule-override-denial';if(!input.skipMutation)must(typeof mutateOriginalCase==='function','ORIGINAL_MUTATION_PRODUCER_REQUIRED');}
     const execution=probe.exec(b.containerId,input,{timeoutMs:30000});execution.catch(()=>{});
     if(input.mutationPhase&&!input.skipMutation){try{const until=Date.now()+15000;for(;;){const gate=await probe.exec(b.containerId,{...base,action:'read-gate'});const r=json(gate.stdout);if(r.result?.ready)break;must(Date.now()<until,'ORIGINAL_MUTATION_GATE_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,50));}await mutateOriginalCase(fixture,{caseId,nonce});await probe.exec(b.containerId,{...base,action:'signal-mutation'});}catch(e){await execution.catch(()=>{});throw e;}}
     const executed=await execution,result=json(executed.stdout);must(executed.exitCode===0&&!result.incomplete,'NATIVE_EXECUTION_INCOMPLETE');observation=evaluateNativeCase(caseId,result.result,candidate);
    }else if(['wrong-audience-denial','wrong-run-attempt-denial','private-tool-denial','changed-grant-denial'].includes(caseId)){
     const api=fixture.coreApi;must(api,'ORIGINAL_CORE_FIXTURE_REQUIRED');
     if(caseId==='changed-grant-denial'){must(typeof mutateOriginalCase==='function','ORIGINAL_GRANT_MUTATION_REQUIRED');await mutateOriginalCase(fixture,{caseId,nonce});}
     const requestApi=caseId==='wrong-audience-denial'?{...api,token:fixture.otherAudienceToken}:caseId==='wrong-run-attempt-denial'?{...api,attemptId:randomUUID()}:api;
     const privateCall=caseId==='private-tool-denial'||caseId==='changed-grant-denial';if(privateCall)must(typeof fixture.privateToolName==='string'&&/^ingenium_[A-Za-z0-9_]+$/.test(fixture.privateToolName)&&typeof fixture.publicProjectName==='string','ORIGINAL_PRIVATE_TOOL_POST_FIXTURE_REQUIRED');
     const path='/api/v1/runtime/job-runs/'+api.runId+(privateCall?'/mcp/'+fixture.privateToolName:'/mcp-tools');const response=await actualCoreRequest(requestApi,path,privateCall?{name:fixture.publicProjectName}:undefined),expected=caseId.startsWith('wrong-')?401:403;
     // Private tool authorization requires a REAL tool call/catalog/project fixture, not tools/list.

     must(response.status===expected,'ACTUAL_CORE_DENIAL_STATUS_MISMATCH');observation={...response,method:privateCall?'POST':'GET',route:privateCall?'original-run/mcp/original-tool':'original-run/mcp-tools'};
     throw fail('ORIGINAL_PREMODEL_EFFECT_OBSERVER_REQUIRED');
    }else if(caseId==='job-broker-route'){
     const executed=await probe.exec(b.containerId,{...fixture.nativeInput,...base,action:'mcp',projectName:fixture.publicProjectName},{timeoutMs:30000}),result=json(executed.stdout);must(executed.exitCode===0&&result.result?.originalChildExit,'ACTUAL_MCP_STDIO_INCOMPLETE');observation={protocolVersion:result.result.protocolVersion,callResultSha256:result.result.callResultSha256,transcriptSha256:sha(JSON.stringify(result.result.transcript)),childExit:result.result.originalChildExit};throw fail('ORIGINAL_AUTHENTICATED_MCP_ROUTE_EVENT_PRODUCER_REQUIRED');
    }else throw fail({ 'reserved-broker-denial':'ACTUAL_RESERVED_TOOL_HOOK_PRIMITIVE_REQUIRED','child-model-binding':'ORIGINAL_AUTHENTICATED_RAW_SPAWN_PRODUCER_REQUIRED','job-broker-route':'ACTUAL_MCP_STDIO_AND_ORIGINAL_ROUTE_PRODUCER_REQUIRED','original-result-route':'ORIGINAL_SANITIZED_RESULT_JOURNAL_PRODUCER_REQUIRED','changed-agent-denial':'ORIGINAL_CHANGED_AGENT_AND_RAW_SPAWN_PRODUCER_REQUIRED','changed-permissions-denial':'ORIGINAL_CHANGED_PERMISSION_AND_RAW_SPAWN_PRODUCER_REQUIRED','unqualified-assignment-denial':'ORIGINAL_UNQUALIFIED_ASSIGNMENT_AND_RAW_SPAWN_PRODUCER_REQUIRED'}[caseId]??'ACTUAL_CASE_PRIMITIVE_REQUIRED');
   }catch(e){error=e.code??'ACTUAL_CASE_EXECUTION_FAILED';}
   finally{if(fixture){try{await withdrawOriginalCase(fixture,{caseId,nonce});retirement=probe.retirementFacts(await probe.waitOriginalContainer(fixture.binding,{timeoutMs:30000}));}catch(e){cleanupError=e.code??'ORIGINAL_SCOPE_RETIREMENT_UNCONFIRMED';}}}
   results.push({caseId,state:error||cleanupError?'incomplete':'pass',...(error?{reason:error}:{}),...(cleanupError?{retirementError:cleanupError}:{}),...(observation?{observation}:{}),...(retirement?{retirement}:{}),retainedContainer:fixture?.binding?.containerId,retentionReason:'Original owner must reconcile final evidence consumer and removal safety; failed retirement protects exact container'});
  }
  return{schemaVersion:1,kind:'actual-original-candidate-inert-observations',imageId:candidate.imageId,sourceSha256:candidate.source.sha256,probeSha256,schemaSha256:candidate.schemaSha256,filesSha256:sha(JSON.stringify(candidate.files)),cases:results,state:results.every(r=>r.state==='pass')?'observations-ready-for-original-independent-review':'incomplete',imageApproved:false,approvalProduced:false};
 }});
}
