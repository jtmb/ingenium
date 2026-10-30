import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTextSpeech, planPcmSpeech, pcmRanges, sourceDigest } from './segments.mjs';
import { UtteranceSegmenter } from './audio.mjs';
import { VoiceSession } from './session.mjs';
import { VoiceService } from '../../services/ingenium-api/lib/voice-v2/service.mjs';
import { SpeechWorker } from '../../services/ingenium-api/lib/voice-v2/speech-worker.mjs';

const scope = {actorId:'a',accountId:'a',organizationId:null,projectId:'p',conversationId:'c',runtimeId:'r',executionBindingId:'b',executionRevision:'v',agentId:'g'};
const tick = () => new Promise(resolve => setImmediate(resolve));
const turn = {sessionId:'s',turnId:1,generation:0,requestId:'voice:s:1'};
const encode = value => new TextEncoder().encode(value);
function wav() {
  const bytes = new Uint8Array(364), d = new DataView(bytes.buffer);
  for (const [at,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]) bytes.set(encode(text),at);
  for (const [at,value] of [[4,356],[16,16],[24,16000],[28,32000],[40,320]]) d.setUint32(at,value,true);
  for (const [at,value] of [[20,1],[22,1],[32,2],[34,16]]) d.setUint16(at,value,true);
  return bytes;
}
test('text partitions recover exact full UTF8 source across 600 and 2000 boundaries', async () => {
  for (const source of ['x'.repeat(601),'😀漢\r\n'.repeat(701),'a'.repeat(32000),' '.repeat(601)]) {
    const plan = await planTextSpeech(source), bytes=encode(source);
    assert.equal(plan.sourceDigest,await sourceDigest(bytes));
    assert.equal(plan.segments.map(s=>s.text).join(''),source);
    let offset=0;
    for (const child of plan.segments) {
      assert.equal(child.sourceStart,offset); offset=child.sourceEnd;
      assert.ok([...child.text].length<=160); assert.ok(encode(child.text).length<=640);
      assert.equal(child.digest,await sourceDigest(bytes.subarray(child.sourceStart,child.sourceEnd)));
    }
    assert.equal(offset,bytes.length);
  }
});
test('ASR exact boundary and tiny tail have no overlap, padding or dropped bytes', async () => {
  for (const length of [8000,479998,480000,480002,487998,960002,1920000]) {
    const pcm=Uint8Array.from({length},(_,i)=>i%251), plan=await planPcmSpeech(pcm);
    let offset=0;
    for (const child of plan.segments) {
      assert.equal(child.sourceStart,offset); assert.ok(child.sourceEnd-offset>=8000&&child.sourceEnd-offset<=480000);
      assert.equal(child.digest,await sourceDigest(pcm.subarray(offset,child.sourceEnd))); offset=child.sourceEnd;
    }
    assert.equal(offset,length);
  }
  for (const length of [0,7998,8001,1920002]) assert.throws(()=>pcmRanges(length));
});
test('capture crossing limit retains whole last frame and never emits partial utterance', () => {
  const emitted=[],overflow=[];
  const s=new UtteranceSegmenter(pcm=>emitted.push(pcm),{maxMs:1000,onOverflow:pcm=>overflow.push(pcm)});
  const frame=new Uint8Array(6200); new Int16Array(frame.buffer).fill(700);
  for(let i=0;i<6;i++) s.push(frame);
  assert.equal(overflow.length,1); assert.equal(overflow[0].length,37200);
  assert.deepEqual(overflow[0].subarray(-6200),frame); assert.equal(emitted.length,0);
  s.flush(); assert.equal(emitted.length,0); assert.equal(s.push(frame),false);
  assert.equal(s.retainedPcm().length,37200);
});
test('ordinary silence-separated capture rearms for multiple utterances', () => {
  const emitted=[],s=new UtteranceSegmenter(pcm=>emitted.push(pcm));
  const voiced=new Uint8Array(6400);new Int16Array(voiced.buffer).fill(700);
  for(let turn=0;turn<3;turn++){for(let i=0;i<3;i++)s.push(voiced);for(let i=0;i<4;i++)s.push(new Uint8Array(6400));}
  assert.equal(emitted.length,3); assert.ok(emitted.every(pcm=>pcm.length===44800));
});
function fixture({reply='  '+('Full answer. '.repeat(190))+'  ',play,redact=x=>x}={}) {
  const requests=[],reservations=[],settled=[],played=[],prompts=[];
  const speech=new SpeechWorker({baseUrl:'http://worker.invalid',token:'fixture',voice:'af_sarah',backend:'cpu-onnx',redactSpeech:redact,fetch:async(url,options)=>{
    requests.push([url.pathname,options.body]);return new Response(wav());
  }});
  speech.health=async()=>({ready:true});
  const service=new VoiceService({authorize:async()=>({allowed:true,scope}),speech,
    operations:{reserve:async r=>{reservations.push(r);return {accepted:true};},settle:async r=>settled.push(r)},
    agent:{submit:async r=>{prompts.push(r);return {scope,requestId:r.turn.requestId,text:reply};},interrupt:async r=>({scope,requestId:r.turn.requestId,acknowledged:true})}});
  let connected=false;
  const ports={connect:r=>{const result=connected?service.resume({},r):service.open({},r);connected=true;return result;},submit:r=>service.submit({},r),speechSequence:r=>service.speechSequence({},r),
    complete:r=>service.complete({},r),interrupt:r=>service.interrupt({},r),stopPlayback(){},stopCapture(){},disconnect:async()=>{},
    play:async r=>{played.push(r);await play?.(r);}};
  return {session:new VoiceSession({scope,mode:'conversation',sessionId:'s',ports}),requests,reservations,settled,played,prompts,reply,service,speech};
}
test('full reply plays child sequence with one prompt per turn, then rearms', async () => {
  const f=fixture();await f.session.connect();
  for(let i=0;i<2;i++) {
    await f.session.sendText('hello');assert.equal(f.session.getSnapshot().phase,'ready');
    assert.equal(f.session.getSnapshot().reply,f.reply);
  }
  assert.equal(f.prompts.length,2);assert.ok(f.played.length>20);
  const children=f.reservations.filter(r=>r.kind==='voice-speech-tts');
  assert.equal(children.length,f.played.length); assert.equal(new Set(children.map(r=>r.requestId)).size,children.length);
  assert.equal(f.requests.map(([,body])=>JSON.parse(body).text).join(''),f.reply.repeat(2));
  assert.ok(children.every(r=>r.parentRequestId===f.prompts.find(p=>p.turn.requestId===r.parentRequestId)?.turn.requestId));
});
test('whole-reply redaction occurs once before child partition and original remains intact', async () => {
  let calls=0;const source='x'.repeat(155)+'SECRET VALUE'+' tail'.repeat(180);
  const f=fixture({reply:source,redact:s=>{calls++;return s.replace('SECRET VALUE','[redacted]');}});
  await f.session.connect();await f.session.sendText('hello');
  assert.equal(calls,1);assert.equal(f.session.getSnapshot().reply,source);
  const spoken=f.requests.map(([,body])=>JSON.parse(body).text).join('');
  assert.equal(spoken,source.replace('SECRET VALUE','[redacted]'));
  assert.equal(f.reservations[1].source.originalDigest,await sourceDigest(encode(source)));
});
test('no next synthesis before playback completes; cancel prevents remaining children', async () => {
  let release,entered;const started=new Promise(resolve=>entered=resolve);
  const f=fixture({play:r=>new Promise(resolve=>{release=resolve;entered();r.signal.addEventListener('abort',resolve,{once:true});})});
  await f.session.connect();const pending=f.session.sendText('hello');await started;
  assert.equal(f.requests.length,1);await tick();assert.equal(f.requests.length,1);
  await f.session.interrupt();release();await pending;
  assert.equal(f.requests.length,1);assert.equal(f.prompts.length,1);assert.equal(f.session.getSnapshot().phase,'ready');
});
test('reconnect during playback fences old generation without replaying prompt or audio', async () => {
  let entered;const started=new Promise(resolve=>entered=resolve);
  const f=fixture({play:r=>new Promise(resolve=>{entered();r.signal.addEventListener('abort',resolve,{once:true});})});
  await f.session.connect();const pending=f.session.sendText('hello');await started;
  await f.session.reconnect();await pending;assert.equal(f.requests.length,1);assert.equal(f.prompts.length,1);
  assert.equal(f.session.getSnapshot().phase,'ready');assert.equal(f.session.getSnapshot().reply,'');
});
test('legacy one-shot synthesis refuses oversize text before effects instead of clipping', async () => {
  const f=fixture();await assert.rejects(()=>f.speech.synthesize({text:'x'.repeat(601),turn}),/VOICE_SPEECH_TEXT_LIMIT/);
  assert.equal(f.requests.length,0);
});
test('child ledger refusal dispatches no speech and does not retry original prompt', async () => {
  const f=fixture();f.service.operations.reserve=async r=>({accepted:r.kind==='voice-agent-turn'});
  await f.session.connect();await f.session.sendText('hello');assert.equal(f.requests.length,0);assert.equal(f.prompts.length,1);
  assert.equal(f.session.getSnapshot().error,'VOICE_DUPLICATE_OR_UNKNOWN');
});
