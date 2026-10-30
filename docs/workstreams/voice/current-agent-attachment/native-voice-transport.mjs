// Route/wire classification only. It grants no auth, readiness, original owner,
// call attachment, CPU admission, completion or retirement. No network fallback.
export const NATIVE_VOICE_PROTOCOL=Object.freeze({id:'native-v1-owned-voice',wire:'json-base64-jobs',callSemantics:'owned-agent-turn',attachedCall:false});
const fail=()=>{throw Object.assign(Error('The voice request does not match its original native endpoint contract.'),{code:'VOICE_NATIVE_PROTOCOL_MISMATCH'});};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,required,optional=[])=>object(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>[...required,...optional].includes(k));
function segment(value){
 try{const decoded=decodeURIComponent(value);return decoded.length>0&&decoded.length<=256&&!['.','..'].includes(decoded)&&!/[\\/%\u0000-\u001f\u007f]/u.test(decoded)&&encodeURIComponent(decoded)===value;}catch{return false;}
}
export function nativeVoiceEndpoint(method,path){
 if(!['GET','POST'].includes(method)||typeof path!=='string'||path.length>1024||/[\u0000-\u0020\u007f#]/u.test(path))return fail();
 let action,surface,match;
 if(method==='GET'&&path==='/v1/speech/status'){surface='speech';action='speech-status';}
 else if(method==='POST'&&path==='/v1/speech/transcribe'){surface='speech';action='dictation';}
 else if(method==='POST'&&path==='/v1/speech/synthesize'){surface='speech';action='speech-synthesize';}
 else if((match=path.match(/^\/v1\/speech\/operations\/([^/?]+)(\/cancel)?$/u))&&segment(match[1])&&method===(match[2]?'POST':'GET')){surface='speech';action=match[2]?'speech-cancel':'speech-operation';}
 else if(method==='GET'&&path==='/v1/voice/status'){surface='voice';action='voice-status';}
 else if(method==='GET'&&path.startsWith('/v1/voice/owner?session_id=')&&segment(path.slice('/v1/voice/owner?session_id='.length))){surface='voice';action='voice-owner';}
 else if(method==='POST'&&path==='/v1/voice/sessions'){surface='voice';action='voice-start';}
 else if((match=path.match(/^\/v1\/voice\/sessions\/([^/?]+)(?:\/(utterances|barge-in|stop|controls)(?:\/([^/?]+)(\/playback)?)?)?$/u))&&segment(match[1])){
  surface='voice';const [,session,kind,id,playback]=match;void session;
  if(!kind&&method==='GET')action='voice-session';
  else if(kind==='utterances'&&!id&&method==='POST')action='voice-utterance';
  else if(kind==='utterances'&&id&&segment(id)&&method===(playback?'POST':'GET'))action=playback?'voice-playback':'voice-utterance-result';
  else if(kind==='controls'&&id&&!playback&&segment(id)&&method==='GET')action='voice-control';
  else if(['barge-in','stop'].includes(kind)&&!id&&method==='POST')action=kind==='stop'?'voice-stop':'voice-barge';
 }
 if(!action)return fail();return Object.freeze({protocol:NATIVE_VOICE_PROTOCOL.id,surface,action});
}
function wireBody(action,body){
 if(['speech-status','speech-operation','voice-status','voice-owner','voice-session','voice-utterance-result','voice-control'].includes(action))return body===undefined;
 if(action==='dictation'||action==='voice-utterance')return exact(body,['request_id','wav_base64'])&&typeof body.request_id==='string'&&typeof body.wav_base64==='string';
 if(action==='speech-synthesize')return exact(body,['request_id','text'],['voice'])&&typeof body.request_id==='string'&&typeof body.text==='string'&&(body.voice===undefined||typeof body.voice==='string');
 if(action==='speech-cancel')return exact(body,[]);
 if(action==='voice-start')return exact(body,['request_id','project_id','session_id','send_transcripts','read_replies','owner'],['voice'])
  &&['request_id','project_id','session_id'].every(k=>typeof body[k]==='string')&&typeof body.send_transcripts==='boolean'&&typeof body.read_replies==='boolean'&&object(body.owner)&&(body.voice===undefined||typeof body.voice==='string');
 if(action==='voice-stop')return exact(body,['request_id'])&&typeof body.request_id==='string';
 if(action==='voice-barge')return exact(body,['request_id','expected_turn_request_id'])&&typeof body.request_id==='string'&&(body.expected_turn_request_id===null||typeof body.expected_turn_request_id==='string');
 if(action==='voice-playback')return exact(body,['child_request_id','claim_id','generation','played'])&&typeof body.child_request_id==='string'&&typeof body.claim_id==='string'&&Number.isSafeInteger(body.generation)&&body.generation>=1&&typeof body.played==='boolean';
 return false;
}
/** request is the ORIGINAL existing native Workbench gateway, not a fetch/auth
 * substitute. Preserve method/path/body/current callback/result/error identities.
 * The backend remains the authority for all receipt/owner/capacity semantics.
 */
export function bindNativeVoiceRequests(request){
 if(typeof request!=='function')return fail();
 const bind=surface=>(method,path,body,current)=>{
  const endpoint=nativeVoiceEndpoint(method,path);
  // Existing VoiceChat also reads native speech status for its audio limits.
  if(surface==='dictation'&&endpoint.surface!=='speech'||surface==='ownedVoice'&&endpoint.surface!=='voice'&&endpoint.action!=='speech-status'||!wireBody(endpoint.action,body))return fail();
  return request(method,path,body,current);
 };
 return Object.freeze({dictation:bind('dictation'),ownedVoice:bind('ownedVoice')});
}
