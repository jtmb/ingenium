type NativeRequest=(method:'GET'|'POST',path:string,body?:unknown,current?:()=>boolean)=>Promise<unknown>;
export const NATIVE_VOICE_PROTOCOL:Readonly<{id:'native-v1-owned-voice';wire:'json-base64-jobs';callSemantics:'owned-agent-turn';attachedCall:false}>;
export function nativeVoiceEndpoint(method:'GET'|'POST',path:string):Readonly<{protocol:'native-v1-owned-voice';surface:'speech'|'voice';action:string}>;
export function bindNativeVoiceRequests(request:NativeRequest):Readonly<{dictation:NativeRequest;ownedVoice:NativeRequest}>;
