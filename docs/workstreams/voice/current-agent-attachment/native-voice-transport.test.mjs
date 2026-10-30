// Pure route/identity fixtures. No positive native/Node call, auth, model, CPU,
// microphone, playback or retirement qualification is asserted by this harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_VOICE_PROTOCOL,nativeVoiceEndpoint as endpoint,bindNativeVoiceRequests as bind} from './native-voice-transport.mjs';
const id='4a8f16a5-3934-4d5c-8b70-b99ca1647261',base=`/v1/voice/sessions/${id}`;
test('all observed native endpoints classify with exact native wire; never claim attachment',()=>{
 for(const [method,path,action]of [
  ['GET','/v1/speech/status','speech-status'],['POST','/v1/speech/transcribe','dictation'],['POST','/v1/speech/synthesize','speech-synthesize'],['GET',`/v1/speech/operations/${id}`,'speech-operation'],['POST',`/v1/speech/operations/${id}/cancel`,'speech-cancel'],
  ['GET','/v1/voice/status','voice-status'],['GET','/v1/voice/owner?session_id=ses_original','voice-owner'],['POST','/v1/voice/sessions','voice-start'],['GET',base,'voice-session'],['POST',base+'/utterances','voice-utterance'],['GET',base+`/utterances/${id}`,'voice-utterance-result'],['POST',base+`/utterances/${id}/playback`,'voice-playback'],['POST',base+'/barge-in','voice-barge'],['POST',base+'/stop','voice-stop'],['GET',base+`/controls/${id}`,'voice-control'],
 ])assert.equal(endpoint(method,path).action,action);
 assert.equal(NATIVE_VOICE_PROTOCOL.attachedCall,false);assert.equal(NATIVE_VOICE_PROTOCOL.callSemantics,'owned-agent-turn');
});
test('Node prefix/method, redirects, aliases, query injection, traversal and path drift refuse',()=>{
 for(const [method,path]of [['POST','/api/voice/v2/open'],['POST','/api/voice/v2/transcribe'],['GET','/v1/voice/sessions'],['GET',base+'/stop'],['POST',base+`/controls/${id}`],['GET','https://host/v1/voice/status'],['GET','//host/v1/voice/status'],['GET','/v1/voice/status?next=1'],['GET','/v1/voice/owner?session_id=ses_x&runtime=other'],['GET','/v1/voice/owner?session_id=..'],['GET','/v1/voice/owner?session_id=%2fother'],['GET','/v1/voice/sessions/%252F'],['GET',base+'/controls/x/playback'],['GET',base+'/unknown']])assert.throws(()=>endpoint(method,path),/original native endpoint/);
});
test('original transport Promise/body/callback/result identities and failures pass unchanged',async()=>{
 let seen;const body={request_id:id,wav_base64:'fixture-not-audio'},current=()=>false,result={fixture:'not-an-operation'},promise=Promise.resolve(result);
 const transport=bind((...args)=>{seen=args;return promise;});
 assert.equal(transport.dictation('POST','/v1/speech/transcribe',body,current),promise);assert.equal(seen[2],body);assert.equal(seen[3],current);assert.equal(await promise,result);
 const error=Error('original transport failure');assert.throws(()=>bind(()=>{throw error;}).ownedVoice('GET','/v1/voice/status'),value=>value===error);
});
test('dictation and owned-voice channels never silently cross protocols or rewrite Node PCM/WAV/NDJSON',()=>{
 let calls=0;const native=bind(()=>{calls++;return Promise.resolve({fixture:true});});
 assert.throws(()=>native.dictation('POST','/api/voice/v2/transcribe',{scope:{},turn:{}}));
 assert.throws(()=>native.dictation('GET','/v1/voice/status'));
 assert.throws(()=>native.ownedVoice('POST','/v1/speech/synthesize',{request_id:id,text:'fixture'}));
 assert.throws(()=>native.dictation('POST','/v1/speech/transcribe',{scope:{},turn:{},pcm:'fixture'}));
 assert.throws(()=>native.ownedVoice('POST',base+'/barge-in',{request_id:id,expected_turn_request_id:null,agentCompleted:true}));
 assert.equal(calls,0);
});
test('wire shapes are Native JSON receipts; callback availability grants no backend authority',()=>{
 let calls=0;const native=bind(()=>{calls++;return Promise.resolve({fixture:true});});
 const playback={child_request_id:id,claim_id:id,generation:1,played:false};native.ownedVoice('POST',base+`/utterances/${id}/playback`,playback,()=>false);
 native.ownedVoice('GET','/v1/speech/status');
 assert.throws(()=>native.ownedVoice('POST',base+`/utterances/${id}/playback`,{...playback,generation:0}));
 assert.throws(()=>native.ownedVoice('POST',base+'/stop',{request_id:id,retired:true}));
 assert.throws(()=>native.dictation('GET','/v1/speech/status',{}));assert.equal(calls,2);
});
