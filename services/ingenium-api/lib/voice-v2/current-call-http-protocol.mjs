import {parseUniqueRawJson} from './raw-assistant-wire.mjs';
import {validateWav} from '../../../../packages/veyra-voice/audio.mjs';
export const CURRENT_CALL_PREFIX='/api/v1/voice/current-calls';
export const CURRENT_CALL_BODY_LIMIT=20000;
export const CURRENT_CALL_AUDIO_LIMIT=1440044;
const fields={selection:['workspaceId','runtimeId','engineSessionId'],message:['requestId','text','delivery'],begin:['projectId','workspaceId','runtimeId','contextConversationId','agentId'],inspect:[],events:[],plan:['messageId'],prepare:['planId'],execute:['preparedId'],barge:[],end:[]};
const fail=code=>{throw Object.assign(Error(code),{code,status:422});};
export const currentCallIdentifier=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
export function isCurrentCallHttpPath(path){return typeof path==='string'&&(path.split('?')[0]===CURRENT_CALL_PREFIX||path.split('?')[0].startsWith(CURRENT_CALL_PREFIX+'/'));}
export function parseCurrentCallEnvelope(bytes,action){
 if(!(bytes instanceof Uint8Array)||bytes.length<2||bytes.length>CURRENT_CALL_BODY_LIMIT||!Object.hasOwn(fields,action))fail('CALL_HTTP_BODY_INVALID');
 let value;try{value=parseUniqueRawJson(bytes);}catch{fail('CALL_HTTP_BODY_INVALID');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('CALL_HTTP_FIELDS_INVALID');
 const expected=[...fields[action],...(action==='begin'&&Object.hasOwn(value,'requestId')?['requestId']:[])];
 if(Object.keys(value).sort().join()!==expected.sort().join())fail('CALL_HTTP_FIELDS_INVALID');
 if(action==='begin'&&Object.hasOwn(value,'requestId')&&!currentCallIdentifier(value.requestId))fail('CALL_HTTP_SELECTOR_INVALID');
 for(const key of expected){const v=value[key];if(action==='message'&&key==='text'){if(typeof v!=='string'||!v.trim()||[...v].length>2000||Buffer.byteLength(v)>8000||Buffer.from(v).toString()!==v||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v))fail('CALL_HTTP_FIELD_INVALID');}else if(typeof v!=='string'||!v||v!==v.trim()||v.length>512||/[\u0000-\u001f\u007f]/.test(v))fail('CALL_HTTP_FIELD_INVALID');}
 if(action==='message'&&(!currentCallIdentifier(value.requestId)||!['queue','steer'].includes(value.delivery)))fail('CALL_HTTP_SELECTOR_INVALID');
 if(action==='prepare'&&!currentCallIdentifier(value.planId)||action==='execute'&&!currentCallIdentifier(value.preparedId))fail('CALL_HTTP_SELECTOR_INVALID');
 return Object.freeze(value);
}
/** Shape bound only, not CPU authority: caller must use actual execute result. */
export function boundedAttachedWav(result){
 if(!result||typeof result!=='object'||result.retired!==true||result.resultAvailable!==true||result.status!==200||!(result.bytes instanceof Uint8Array)||result.bytes.length<44||result.bytes.length>CURRENT_CALL_AUDIO_LIMIT)fail('CALL_HTTP_AUDIO_UNAVAILABLE');
 validateWav(result.bytes);return result.bytes;
}

export const CURRENT_CALL_PCM_LIMIT=480000;
export function isCurrentCallPcmPath(path){return typeof path==='string'&&/^\/api\/v1\/voice\/current-calls\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\/transcribe\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(path.split('?')[0]);}
/** DATA validation after the genuine supervisor execute Promise. No result
 * object or public retired flag grants CPU/resource/ledger authority. */
export function decodeOriginalTranscriptionResult(result,pcmBytes){
 if(!Number.isSafeInteger(pcmBytes)||pcmBytes<8000||pcmBytes>CURRENT_CALL_PCM_LIMIT||pcmBytes%2||!result||result.retired!==true||result.resultAvailable!==true||result.status!==200||!(result.bytes instanceof Uint8Array)||result.bytes.length<2||result.bytes.length>16384)fail('CALL_TRANSCRIPTION_UNAVAILABLE');
 let data;try{data=parseUniqueRawJson(result.bytes);}catch{fail('CALL_TRANSCRIPTION_INVALID');}
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join()!=='durationMs,language,text'||data.language!=='en'||data.durationMs!==pcmBytes/32
  ||typeof data.text!=='string'||data.text!==data.text.trim()||[...data.text].length>2000||Buffer.byteLength(data.text)>8000||Buffer.from(data.text).toString()!==data.text||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(data.text))fail('CALL_TRANSCRIPTION_INVALID');
 return Object.freeze({text:data.text,language:'en',durationMs:data.durationMs});
}
