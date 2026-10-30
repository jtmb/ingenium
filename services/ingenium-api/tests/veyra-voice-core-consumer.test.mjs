import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoreVoiceOperations, agentResultFingerprint, agentInputFingerprint } from '../lib/voice-v2/core-operations.mjs';
import { ManagedCpuSpeech } from '../lib/voice-v2/managed-cpu-speech.mjs';
import { VoiceService } from '../lib/voice-v2/service.mjs';
import { CurrentAgentVoiceAdapter, nativeVoiceMessageId } from '../lib/voice-v2/current-agent.mjs';
import { hostedOpenCodeLifecycle, requireHostedOriginalRetirement } from '../lib/voice-v2/hosted-lifecycle.mjs';

const scope = { actorId:'actor',accountId:'account',organizationId:'org',projectId:'project',conversationId:'actual-selected',runtimeId:'runtime',executionBindingId:'binding',executionRevision:'revision',agentId:'agent' };
const turn = { sessionId:'call',turnId:1,generation:3,requestId:'voice:call:1' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve=yes; }); return {promise,resolve}; };
function wav() {
  const b = new Uint8Array(364), d = new DataView(b.buffer);
  for (const [at,s] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]) b.set(new TextEncoder().encode(s),at);
  for (const [at,n] of [[4,356],[16,16],[24,16000],[28,32000],[40,320]]) d.setUint32(at,n,true);
  for (const [at,n] of [[20,1],[22,1],[32,2],[34,16]]) d.setUint16(at,n,true); return b;
}
// Fixture ledger deliberately has no SQL/kernel authority. Root independently
// validates this consumer against its installed actual SQL128/Core callbacks.
function fixture() {
  const rows=new Map(), calls=[], proof={}, owner={fixture:true};
  const ledger={reserve(context,original,o){assert.equal(o,owner);calls.push(['reserve',original]);if(rows.has(original.operationId))throw Error('duplicate');
    const row={original,owner:o,state:'reserved',revision:0};rows.set(original.operationId,row);return {accepted:true,fresh:true,operation:row};},
    read(_c,id){return rows.get(id);},cas(_c,r){const row=rows.get(r.operationId);assert.equal(row.state,r.from);assert.equal(row.revision,r.expectedRevision);calls.push(['claim',r]);row.state=r.to;row.revision++;return row;},
    settle(_c,r){assert.equal(r.proof,proof);const row=rows.get(r.operationId);assert.equal(row.state,'running');calls.push(['settle',r]);row.state='terminal';row.resultFingerprint=r.resultFingerprint;return row;},
    retireOriginal(_c,r){assert.equal(r.physicalProof,proof);calls.push(['retire',r]);const row=rows.get(r.operationId);row.resourceRetired=true;return row;},
    quarantine(_c,id){calls.push(['unknown',id]);const row=rows.get(id);row.state='terminal';row.outcome='unknown';return row;}};
  const operations=new CoreVoiceOperations({ledger,bindOriginal:()=>({context:{original:true},owner,deadlineAt:Date.now()+30000})});
  return {operations,rows,calls,proof};
}

test('full semantic input and integer generation enter Core before effects; changed input cannot mint another UUID',()=>{
  const f=fixture(), input={context:{},scope,turn,requestId:turn.requestId,kind:'voice-agent-turn',text:'  exact text 😀  ',delivery:'prompt',deadlineAt:Date.now()+60000};
  const h=f.operations.reserve(input), original=f.calls[0][1];
  assert.equal(original.turnGeneration,3);assert.match(original.inputSha256,/^[a-f0-9]{64}$/);assert.match(h.operationId,/^[a-f0-9-]{36}$/);
  f.operations.claim(h);assert.equal(f.calls[1][0],'claim');
  assert.throws(()=>f.operations.reserve({...input,text:'different'}),/duplicate/);
  const result={scope,requestId:turn.requestId,text:' unmodified reply '};
  assert.throws(()=>f.operations.settle({reservation:h,outcome:'completed',result}),/VOICE_ORIGINAL_RETIREMENT_REQUIRED/);
  f.operations.settle({reservation:h,outcome:'completed',result,proof:f.proof});
  assert.equal(f.calls.at(-1)[1].resultFingerprint,agentResultFingerprint(result));
});

test('service passes actual accepted parent UUID to serial CPU children and never exposes private proof',async()=>{
  const f=fixture(), inputs=[], effects=[], reply='Exact full reply 😀. '.repeat(45);
  const supervisor={status:()=>({ready:true,configuredDefaultVoice:'af_heart'}),openScope:async()=>{effects.push('open');},releaseSession:async()=>{effects.push('release');},
    reserveCpu(input){inputs.push(input);return {operationId:'cpu-'+inputs.length};},async executeCpu(){return {retired:true,resultAvailable:true,bytes:wav()};},cancelPrepared(){throw Error('unused');}};
  let redactions=0;
  const speech=new ManagedCpuSpeech({supervisor,redactSpeech:text=>{redactions++;return text;}});
  const service=new VoiceService({authorize:async()=>({allowed:true,scope}),operations:f.operations,speech,
    agent:{submit:async request=>{assert.equal(f.calls.at(-1)[0],'claim');assert.equal(request.originalOperation.operationId,f.calls[0][1].operationId);return {scope,requestId:turn.requestId,text:reply,retirementProof:f.proof};},closeVoice:async()=>{effects.push('agent-close');}}});
  await service.open({}, {scope,sessionId:turn.sessionId,mode:'conversation'});
  const result=await service.submit({}, {scope,turn,text:'prompt',delivery:'prompt'});
  assert.equal(result.text,reply);assert.equal(Object.hasOwn(result,'retirementProof'),false);
  const iterator=service.speechSequence({}, {scope,turn,text:reply});let child=await iterator.next();assert.equal(inputs.length,1);
  assert.equal(inputs[0].parentOperationId,f.calls[0][1].operationId);assert.equal(inputs[0].turn.generation,3);
  let spoken=child.value.segment.text;while(!(child=await iterator.next()).done)spoken+=child.value.segment.text;
  assert.equal(spoken,reply);assert.equal(redactions,1);assert.equal(f.calls.filter(c=>c[0]==='reserve').length,1);
  await service.close({}, {scope,sessionId:turn.sessionId});assert.deepEqual(effects,['open','agent-close','release']);
});

test('missing agent retirement proof quarantines Core and admits no speech child',async()=>{
  const f=fixture();let cpu=0;
  const service=new VoiceService({authorize:async()=>({allowed:true,scope}),operations:f.operations,
    speech:{health:async()=>{},ownedSequence:true,synthesizeSequence:async function*(){cpu++;}},
    agent:{submit:async()=>({scope,requestId:turn.requestId,text:'result',usage:{tokens:2}})}});
  await service.open({}, {scope,sessionId:turn.sessionId,mode:'conversation'});
  await assert.rejects(service.submit({}, {scope,turn,text:'prompt',delivery:'prompt'}),/VOICE_ORIGINAL_RETIREMENT_REQUIRED/);
  assert.equal(f.calls.at(-1)[0],'unknown');
  await assert.rejects(service.speechSequence({}, {scope,turn,text:'result'}).next(),/VOICE_TURN_CONFLICT/);assert.equal(cpu,0);
});

test('CPU session release runs even when agent cleanup fails; failed original is retained without retry',async()=>{
  let released=0,closed=0;
  const service=new VoiceService({authorize:async()=>({allowed:true,scope}),operations:{reserve(){},settle(){}},
    speech:{openOwned:async()=>{},releaseOwned:async()=>{released++;}},agent:{closeVoice:async()=>{closed++;throw Error('uncertain original');}}});
  await service.open({}, {scope,sessionId:turn.sessionId,mode:'conversation'});
  await assert.rejects(service.close({}, {scope,sessionId:turn.sessionId}),/uncertain original/);
  await assert.rejects(service.close({}, {scope,sessionId:turn.sessionId}),/uncertain original/);
  assert.equal(released,1);assert.equal(closed,1);
});

test('current-agent Core path refuses absent proof producer before prompt and waits actual retained proof separately from result',async()=>{
  for(const hasProofProducer of [false,true]){
    const retirement=deferred(), proof={}, prompts=[];let observation,stops=0;
    const originalOperation={operationId:'00000000-0000-4000-8000-000000000001',scope,requestId:turn.requestId,turnGeneration:3,kind:'voice-agent-turn',parentOperationId:null,
      inputSha256:agentInputFingerprint({scope,turn,text:'prompt',delivery:'prompt'})};
    const binding={verified:true,scope,sessionId:scope.conversationId,directory:'/existing',protocol:'opencode-v2.0.11'};
    const adapter=new CurrentAgentVoiceAdapter({resolveBinding:async()=>binding,withBinding:async(_b,work)=>work(),
      observeTurn:async input=>{observation=input;return {ready:Promise.resolve(),result:Promise.resolve({scope,nativeSessionId:scope.conversationId,promptId:input.promptId,outcome:'succeeded',text:'actual result'}),
        ...(hasProofProducer?{retirement:retirement.promise}:{}),stop(){stops++;},ownsPermission(){return false;},ownsExecution(){return true;}};},
      request:async(path,options)=>{if(path.endsWith('/prompt')){prompts.push(options.body);return {data:{id:options.body.id,sessionID:scope.conversationId}};}
        return {data:{id:scope.conversationId,location:{directory:'/existing'},agent:scope.agentId,model:{id:'selected',providerID:'existing'}}};}});
    const running=adapter.submit({scope,turn,text:'prompt',delivery:'prompt',originalOperation});
    if(!hasProofProducer){await assert.rejects(running,/VOICE_ORIGINAL_RETIREMENT_UNAVAILABLE/);assert.equal(prompts.length,0);continue;}
    let resolved=false;running.then(()=>{resolved=true;});await tick();assert.equal(resolved,false);assert.equal(prompts.length,1);
    assert.equal(observation.originalOperation,originalOperation);assert.equal(prompts[0].id,nativeVoiceMessageId(scope,originalOperation.operationId));
    retirement.resolve(proof);assert.equal((await running).retirementProof,proof);
    assert.equal(stops,0);
    await assert.rejects(adapter.closeVoice({scope,sessionId:turn.sessionId}),/VOICE_ORIGINAL_RETIREMENT_UNCONFIRMED/);
    await adapter.finalizeOriginal(originalOperation);assert.equal(stops,1);
  }
});

test('CPU transcription uses a separate durable request namespace and unavailable result never replays',async()=>{
  const reserved=[], executed=[];
  const supervisor={openScope(){},releaseSession(){},status:()=>({ready:true}),cancelPrepared(){},
    reserveCpu(input){reserved.push(input);return {operationId:'fixture-cpu'};},
    executeCpu:async handle=>{executed.push(handle);return {retired:true,resultAvailable:false};}};
  const speech=new ManagedCpuSpeech({supervisor,redactSpeech:text=>text});
  await assert.rejects(speech.transcribe({context:{},scope,turn,deadlineAt:Date.now()+1000,pcm:new Uint8Array(8000)}),/VOICE_TRANSCRIPTION_UNKNOWN/);
  assert.equal(executed.length,1);assert.equal(reserved.length,1);
  assert.match(reserved[0].requestId,/^voice-stt:[a-f0-9]{64}$/);assert.notEqual(reserved[0].requestId,turn.requestId);
});

test('pinned public transport stays unavailable; Core interrupt never falls back to generic session ACK or idle',async()=>{
  assert.equal(hostedOpenCodeLifecycle.originalRetirementAvailable,false);
  assert.throws(()=>requireHostedOriginalRetirement(),/VOICE_HOSTED_ORIGINAL_SETTLEMENT_NOT_EXPOSED/);
  let requests=0;
  const adapter=new CurrentAgentVoiceAdapter({resolveBinding:async()=>{requests++;throw Error('must not open generic HTTP');},request:async()=>{requests++;},withBinding:async(_b,run)=>run()});
  await assert.rejects(adapter.interrupt({scope,turn,originalOperation:{operationId:'original'}}),/VOICE_ORIGINAL_INTERRUPT_UNAVAILABLE/);
  assert.equal(requests,0);
});

test('generic positive interrupt acknowledgement cannot reopen Core-backed session without original proof',async()=>{
  const f=fixture(), result=deferred();
  const service=new VoiceService({authorize:async()=>({allowed:true,scope}),operations:f.operations,speech:{health:async()=>{}},
    agent:{submit:()=>result.promise,interrupt:async input=>{assert.equal(input.originalOperation.operationId,f.calls[0][1].operationId);return {acknowledged:true,scope,requestId:turn.requestId};}}});
  await service.open({}, {scope,sessionId:turn.sessionId,mode:'conversation'});
  const running=service.submit({}, {scope,turn,text:'prompt',delivery:'prompt'});const outcome=assert.rejects(running,/VOICE_TURN_CANCELLED/);
  await tick();
  await assert.rejects(service.interrupt({}, {scope,turn}),/VOICE_ORIGINAL_RETIREMENT_REQUIRED/);
  await assert.rejects(service.submit({}, {scope,turn:{...turn,turnId:2,requestId:'voice:call:2'},text:'next',delivery:'prompt'}),/VOICE_SCOPE_EXPIRED/);
  assert.equal(f.calls.some(call=>call[0]==='retire'),false);
  result.resolve({scope,requestId:turn.requestId,text:'late result',retirementProof:f.proof});await outcome;
  assert.equal(f.calls.at(-1)[0],'unknown');
});
