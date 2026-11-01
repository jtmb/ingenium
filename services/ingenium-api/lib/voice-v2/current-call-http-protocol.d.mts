export const CURRENT_CALL_PREFIX:'/api/v1/voice/current-calls';
export const CURRENT_CALL_BODY_LIMIT:20000;
export const CURRENT_CALL_AUDIO_LIMIT:1440044;
export function currentCallIdentifier(value:unknown):value is string;
export function isCurrentCallHttpPath(path:unknown):boolean;
export function parseCurrentCallEnvelope(bytes:Uint8Array,action:string):Readonly<Record<string,string>>;
export function boundedAttachedWav(result:unknown):Uint8Array;

export const CURRENT_CALL_PCM_LIMIT:480000;
export function isCurrentCallPcmPath(path:unknown):boolean;
export function decodeOriginalTranscriptionResult(result:unknown,pcmBytes:number):Readonly<{text:string;language:'en';durationMs:number}>;
