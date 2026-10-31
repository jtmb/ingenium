import {createHash} from 'node:crypto';
import type {VoiceGpuDescriptor,VoiceGpuControlOriginal,VoiceGpuSpeechOriginal} from './voice-gpu-contract.js';

// DATA validation only. A valid descriptor/identity is never positive authority.
type Row=Record<string,unknown>;
const deny=(code:string):never=>{throw Object.assign(Error(code),{code,status:503});};
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function exact(v:unknown,keys:string[]):asserts v is Row {if(!record(v)||Object.keys(v).sort().join()!==[...keys].sort().join())deny('VOICE_GPU_DATA_SHAPE');}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=256&&Buffer.from(v).toString()===v;
function canonical(v:unknown):string {
 if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'&&Number.isSafeInteger(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(!record(v))return deny('VOICE_GPU_DATA_JSON');
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
}
export function gpuDataDigest(v:unknown):string {return createHash('sha256').update(canonical(v)).digest('hex');}
export function validateGpuDescriptorData(v:unknown):VoiceGpuDescriptor {
 exact(v,['version','resourceKind','backend','platform','providerDigest','deviceIdentityDigest','deviceBootId','profileDigest','modelSetDigest','measurementDigest','admissionId']);
 if(v.version!==1||v.resourceKind!=='voice-gpu-v1'||!['directml','rocm','cuda'].includes(String(v.backend))||
  (v.backend==='directml'?v.platform!=='win32':v.platform!=='linux')||!uuid(v.deviceBootId)||!uuid(v.admissionId)||
  ['providerDigest','deviceIdentityDigest','profileDigest','modelSetDigest','measurementDigest'].some(k=>!hash(v[k])))return deny('VOICE_GPU_DESCRIPTOR_DATA_INVALID');
 return Object.freeze({...v}) as unknown as VoiceGpuDescriptor;
}
function scopeData(v:unknown){
 exact(v,['actorId','accountId','organizationId','projectId','conversationId','runtimeId','executionBindingId','executionRevision','agentId']);
 if(Object.values(v).some(x=>!text(x)))return deny('VOICE_GPU_HOSTED_SCOPE_DATA_INVALID');return Object.freeze({...v});
}
export function validateGpuControlData(v:unknown):VoiceGpuControlOriginal {
 exact(v,['version','kind','operationId','requestId','scope','descriptor','deadlineAt']);
 if(v.version!==1||v.kind!=='voice-gpu-supervisor'||!uuid(v.operationId)||!text(v.requestId)||!integer(v.deadlineAt))return deny('VOICE_GPU_CONTROL_DATA_INVALID');
 return Object.freeze({...v,scope:scopeData(v.scope),descriptor:validateGpuDescriptorData(v.descriptor)}) as unknown as VoiceGpuControlOriginal;
}
export function validateGpuSpeechData(v:unknown):VoiceGpuSpeechOriginal {
 exact(v,['version','kind','operationId','requestId','scope','turnGeneration','controlOperationId','deadlineAt','identity']);
 if(v.version!==1||!['voice-gpu-speech-stt','voice-gpu-speech-tts'].includes(String(v.kind))||!uuid(v.operationId)||!text(v.requestId)||!integer(v.turnGeneration)||!uuid(v.controlOperationId)||!integer(v.deadlineAt))return deny('VOICE_GPU_SPEECH_DATA_INVALID');
 exact(v.identity,['version','resourceKind','controlOperationId','operationId','requestId','generation','workerBootId','kind','inputSha256','descriptor']);
 const d=v.identity;if(d.version!==1||d.resourceKind!=='voice-gpu-dispatch-v1'||d.controlOperationId!==v.controlOperationId||d.operationId!==v.operationId||d.requestId!==v.operationId||!uuid(d.generation)||!uuid(d.workerBootId)||!hash(d.inputSha256)||(v.kind==='voice-gpu-speech-stt'?d.kind!=='transcribe':d.kind!=='synthesize'))return deny('VOICE_GPU_DISPATCH_DATA_INVALID');
 return Object.freeze({...v,scope:scopeData(v.scope),identity:Object.freeze({...d,descriptor:validateGpuDescriptorData(d.descriptor)})}) as unknown as VoiceGpuSpeechOriginal;
}
/** Fixed unavailable methods: no optional injected positive callback, token
 * constructor, DATA->lease cast, CPU proof conversion or serialized adoption. */
export function reserveGpuControl(..._args:unknown[]):never {return deny('VOICE_GPU_ORIGINAL_PRODUCER_UNAVAILABLE');}
export function reserveGpuSpeech(..._args:unknown[]):never {return deny('VOICE_GPU_ORIGINAL_PRODUCER_UNAVAILABLE');}
export function claimGpuDispatch(..._args:unknown[]):never {return deny('VOICE_GPU_ORIGINAL_DISPATCH_UNAVAILABLE');}
export function retainGpuResult(..._args:unknown[]):never {return deny('VOICE_GPU_ORIGINAL_RESULT_UNAVAILABLE');}
export function retireGpuOriginal(..._args:unknown[]):never {return deny('VOICE_GPU_ORIGINAL_CLEANUP_UNAVAILABLE');}
