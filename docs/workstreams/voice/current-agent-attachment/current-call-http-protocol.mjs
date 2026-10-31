import {parseUniqueRawJson} from './raw-assistant-wire.mjs';
import {validateWav} from '../../../../packages/veyra-voice/audio.mjs';
export const CURRENT_CALL_PREFIX='/api/v1/voice/current-calls';
export const CURRENT_CALL_BODY_LIMIT=20000;
export const CURRENT_CALL_AUDIO_LIMIT=1440044;
const fields={begin:['projectId','workspaceId','runtimeId','contextConversationId','agentId'],inspect:[],events:[],plan:['messageId'],prepare:['planId'],execute:['preparedId'],barge:[],end:[]};
const fail=code=>{throw Object.assign(Error(code),{code,status:422});};
export const currentCallIdentifier=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
export function isCurrentCallHttpPath(path){return typeof path==='string'&&(path.split('?')[0]===CURRENT_CALL_PREFIX||path.split('?')[0].startsWith(CURRENT_CALL_PREFIX+'/'));}
export function parseCurrentCallEnvelope(bytes,action){
 if(!(bytes instanceof Uint8Array)||bytes.length<2||bytes.length>CURRENT_CALL_BODY_LIMIT||!Object.hasOwn(fields,action))fail('CALL_HTTP_BODY_INVALID');
 let value;try{value=parseUniqueRawJson(bytes);}catch{fail('CALL_HTTP_BODY_INVALID');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...fields[action]].sort().join())fail('CALL_HTTP_FIELDS_INVALID');
 for(const key of fields[action])if(typeof value[key]!=='string'||!value[key]||value[key]!==value[key].trim()||value[key].length>512||/[\u0000-\u001f\u007f]/.test(value[key]))fail('CALL_HTTP_FIELD_INVALID');
 if(action==='prepare'&&!currentCallIdentifier(value.planId)||action==='execute'&&!currentCallIdentifier(value.preparedId))fail('CALL_HTTP_SELECTOR_INVALID');
 return Object.freeze(value);
}
/** Shape bound only, not CPU authority: caller must use actual execute result. */
export function boundedAttachedWav(result){
 if(!result||typeof result!=='object'||result.retired!==true||result.resultAvailable!==true||result.status!==200||!(result.bytes instanceof Uint8Array)||result.bytes.length<44||result.bytes.length>CURRENT_CALL_AUDIO_LIMIT)fail('CALL_HTTP_AUDIO_UNAVAILABLE');
 validateWav(result.bytes);return result.bytes;
}
