import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalCapture, retainUnsubmitted } from './local-capture.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function stream({stopFails=false}={}) {
  const track={readyState:'live',onended:null,stops:0,stop(){this.stops++;if(stopFails)throw new Error('driver stop unknown');this.readyState='ended';}};
  return {track,getTracks:()=>[track],getAudioTracks:()=>[track]};
}
function fixture(t,{permission, resume, close, processorFails=false, stopFails=false}={}) {
  const capture=new LocalCapture(), calls=[],contexts=[],frames=[],problems=[],streams=[];let current=true;
  const node=()=>({disconnects:0,connections:[],connect(next){this.connections.push(next);},disconnect(){this.disconnects++;}});
  const ports={
    media:{getUserMedia:async()=>{calls.push('permission');const value=permission?await permission:stream({stopFails});streams.push(value);return value;}},
    createContext:()=>{const source=node(),processor={...node(),onaudioprocess:null},gain={...node(),gain:{value:1}};
      const context={sampleRate:48000,destination:{},source,processor,gain,closes:0,
        resume:async()=>{calls.push('resume');if(resume)await resume;},close(){this.closes++;return close??Promise.resolve();},
        createMediaStreamSource:()=>source,createScriptProcessor:()=>{if(processorFails)throw new Error('processor failed');return processor;},createGain:()=>gain};
      contexts.push(context);return context;},
    isCurrent:()=>current,claim:()=>{calls.push('lease-claim');return true;},release:()=>calls.push('lease-release'),
    onPcm:(frame,rate)=>frames.push({frame,rate}),onEnded:()=>calls.push('ended'),onProblem:message=>problems.push(message),
  };
  t.after(async()=>{capture.stop();await tick();});
  const fire=(callback=contexts.at(-1)?.processor.onaudioprocess)=>callback?.({outputBuffer:{getChannelData:()=>new Float32Array(4).fill(1)},inputBuffer:{sampleRate:48000,getChannelData:()=>new Float32Array([.02,.03,-.04,.05])}});
  return{capture,ports,calls,contexts,frames,problems,streams,fire,setCurrent:value=>{current=value;}};
}
test('local mute promptly ends tracks and processor without mutating an original call or claim',async t=>{
  const f=fixture(t), original=Object.freeze({sessionId:'original',turnId:'active-agent',generation:7,claimId:'already-claimed',childGeneration:1});
  const receipt=JSON.stringify(original), ticket=f.capture.begin();assert.equal(await f.capture.open(ticket,f.ports),true);
  const stale=f.contexts[0].processor.onaudioprocess;f.fire();assert.equal(f.frames.length,1);
  const result=f.capture.stop();
  assert.equal(result.released,true);assert.equal(f.streams[0].track.readyState,'ended');assert.equal(f.streams[0].track.stops,1);
  assert.equal(f.contexts[0].processor.onaudioprocess,null);assert.equal(f.contexts[0].processor.disconnects,1);assert.equal(f.contexts[0].closes,1);
  f.fire(stale);assert.equal(f.frames.length,1);assert.equal(JSON.stringify(original),receipt);
  assert.equal(f.calls.includes('ended'),false);
});
test('explicit unmute creates a fresh device ticket, never revives a stopped graph',async t=>{
  const f=fixture(t);let ticket=f.capture.begin();await f.capture.open(ticket,f.ports);f.capture.stop();await tick();
  const next=f.capture.begin();assert.notEqual(next,ticket);assert.equal(f.capture.current(ticket),false);
  await f.capture.open(next,f.ports);assert.equal(f.contexts.length,2);assert.equal(f.streams[0].track.readyState,'ended');assert.equal(f.streams[1].track.readyState,'live');
});
test('muting pending permission closes the late stream before any context is created',async t=>{
  const permission=deferred(),f=fixture(t,{permission:permission.promise}),ticket=f.capture.begin();
  const pending=f.capture.open(ticket,f.ports);f.capture.stop();const late=stream();permission.resolve(late);
  assert.equal(await pending,false);assert.equal(late.track.stops,1);assert.equal(f.contexts.length,0);assert.equal(f.capture.intent,false);
});
test('mute while context resume is pending releases its actual tracks immediately',async t=>{
  const resume=deferred(),f=fixture(t,{resume:resume.promise});const ticket=f.capture.begin(),pending=f.capture.open(ticket,f.ports);
  await tick();assert.equal(f.contexts.length,1);f.capture.stop();assert.equal(f.streams[0].track.stops,1);assert.equal(f.contexts[0].closes,1);
  resume.resolve();assert.equal(await pending,false);assert.equal(f.contexts[0].closes,1);
});
test('view or owner revocation during permission cannot publish capture',async t=>{
  const permission=deferred(),f=fixture(t,{permission:permission.promise}),ticket=f.capture.begin();
  const pending=f.capture.open(ticket,f.ports);f.setCurrent(false);const late=stream();permission.resolve(late);
  assert.equal(await pending,false);assert.equal(late.track.stops,1);assert.equal(f.frames.length,0);
});
test('an old cancelled permission cannot release the newer capture lease',async t=>{
  const old=deferred(),f=fixture(t,{permission:old.promise}),ticket=f.capture.begin(),pending=f.capture.open(ticket,f.ports);
  f.capture.stop();const next=f.capture.begin();const oldStream=stream();old.resolve(oldStream);
  assert.equal(await pending,false);assert.equal(f.capture.current(next),true);assert.equal(f.calls.filter(x=>x==='lease-release').length,0);
});
test('closing is a gate, not permission to automatically reopen later',async t=>{
  const close=deferred(),f=fixture(t,{close:close.promise});const ticket=f.capture.begin();await f.capture.open(ticket,f.ports);f.capture.stop();
  assert.throws(()=>f.capture.begin(),/cleanup is still pending/);close.resolve();await tick();
  assert.equal(f.calls.filter(x=>x==='permission').length,1);assert.equal(f.capture.intent,false);
  assert.ok(f.capture.begin()>ticket);
});
test('failed track release preserves the original failure and blocks replacement devices',async t=>{
  const f=fixture(t,{stopFails:true}),ticket=f.capture.begin();await f.capture.open(ticket,f.ports);
  assert.equal(f.capture.stop().released,false);assert.equal(f.capture.blocked,true);assert.equal(f.capture.failures[0].resource.stream,f.streams[0]);
  assert.equal(f.problems.length,1);assert.throws(()=>f.capture.begin(),/cleanup needs attention/);
  assert.equal(f.contexts[0].processor.disconnects,1);assert.equal(f.calls.filter(x=>x==='permission').length,1);
});
test('failed graph construction still closes every already-created resource',async t=>{
  const f=fixture(t,{processorFails:true}),ticket=f.capture.begin();await assert.rejects(()=>f.capture.open(ticket,f.ports),/processor failed/);
  assert.equal(f.streams[0].track.stops,1);assert.equal(f.contexts[0].source.disconnects,1);assert.equal(f.contexts[0].closes,1);
});
test('async close failure is retained without automatic capture fallback',async t=>{
  const close=deferred(),f=fixture(t,{close:close.promise}),ticket=f.capture.begin();await f.capture.open(ticket,f.ports);f.capture.stop();
  close.reject(new Error('close unknown'));await tick();assert.equal(f.capture.blocked,true);assert.equal(f.problems.length,1);
  assert.throws(()=>f.capture.begin(),/cleanup needs attention/);assert.equal(f.calls.filter(x=>x==='permission').length,1);
});
test('unconfirmed onset and crossing frames retain every source sample for export only',()=>{
  const first=new Float32Array([.01,.02,.03]),tail=new Float32Array([.04,.05]);
  const capture={frames:[first,tail],confirmed:false},resource={context:{sampleRate:48000}};
  const retained=retainUnsubmitted(null,capture,resource);assert.equal(retained.rate,48000);assert.deepEqual(retained.frames,[first,tail]);
  capture.frames.push(new Float32Array([.9]));assert.equal(retained.frames.length,2);assert.deepEqual([...retained.frames.flatMap(x=>[...x])],[...first,...tail]);
});
test('queued original remains exact, and there is no phantom retained source',()=>{
  const queued={frames:[new Float32Array([.1,.2,.3])],rate:44100};const retained=retainUnsubmitted(queued,null,null);
  assert.deepEqual(retained,queued);assert.notEqual(retained.frames,queued.frames);
  assert.equal(retainUnsubmitted(null,null,null),null);assert.equal(retainUnsubmitted({frames:[],rate:16000},null,null),null);
});
test('capture mute/unmute does not alter a legitimate independently fenced played ACK',async t=>{
  const f=fixture(t), claim=Object.freeze({claimId:'original-claim',parentRequestId:'original-turn',generation:1}),callEpoch=9;
  const before=JSON.stringify(claim),ack=[];const ended=()=>ack.push({...claim,callEpoch});
  await f.capture.open(f.capture.begin(),f.ports);f.capture.stop();await tick();
  await f.capture.open(f.capture.begin(),f.ports);ended();
  assert.deepEqual(ack,[{...claim,callEpoch:9}]);assert.equal(JSON.stringify(claim),before);
  assert.equal(f.calls.some(call=>/prompt|session|utterance|interrupt|stop-call/.test(call)),false);
});
test('lease refusal dispatches no permission request or graph',async t=>{
  const f=fixture(t);f.ports.claim=()=>false;
  await assert.rejects(()=>f.capture.open(f.capture.begin(),f.ports),/audio lease is unavailable/);
  assert.equal(f.streams.length,0);assert.equal(f.contexts.length,0);
});
test('permission rejection never publishes a microphone or falls back',async t=>{
  const f=fixture(t);f.ports.media.getUserMedia=async()=>{throw new Error('permission denied');};
  await assert.rejects(()=>f.capture.open(f.capture.begin(),f.ports),/permission denied/);
  assert.equal(f.capture.resource,null);assert.equal(f.contexts.length,0);
});
test('empty or already-ended audio stream is refused before graph construction',async t=>{
  const f=fixture(t);const empty=stream();empty.getAudioTracks=()=>[];f.ports.media.getUserMedia=async()=>empty;
  await assert.rejects(()=>f.capture.open(f.capture.begin(),f.ports),/no live audio track/);
  assert.equal(empty.track.stops,1);assert.equal(f.contexts.length,0);
});
test('track ending during context resume cannot appear as microphone on',async t=>{
  const resume=deferred(),f=fixture(t,{resume:resume.promise});const pending=f.capture.open(f.capture.begin(),f.ports);
  await tick();f.streams[0].track.readyState='ended';resume.resolve();
  await assert.rejects(()=>pending,/ended before capture/);assert.equal(f.capture.resource,null);assert.equal(f.contexts[0].closes,1);
});
test('a lease lost during permission closes capture before publication',async t=>{
  const f=fixture(t);let claims=0;f.ports.claim=()=>++claims===1;
  await assert.rejects(()=>f.capture.open(f.capture.begin(),f.ports),/lease changed before microphone publication/);
  assert.equal(f.capture.resource,null);assert.equal(f.streams[0].track.stops,1);assert.equal(f.frames.length,0);
});
