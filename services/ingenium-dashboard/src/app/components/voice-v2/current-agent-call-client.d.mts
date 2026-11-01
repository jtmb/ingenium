import type {VoiceMode}from'../../../../../../packages/veyra-voice/session.mjs';
import type {VoicePanelClient}from'./VoicePanel';
import type {CurrentCallTransport}from'./current-call-transport.mjs';
export class CurrentAgentCallClient implements VoicePanelClient {
 constructor(input:{transport:CurrentCallTransport;selection:{workspaceId:string;runtimeId:string;engineSessionId:string};mode:VoiceMode;onDictation:(text:string)=>void|Promise<void>;onAdmitted:()=>void|Promise<void>;onResync?:()=>void;onEnded?:()=>void});
 session:VoicePanelClient['session'];media:VoicePanelClient['media'];inputDeviceId:string;outputDeviceId:string;selectedBackend:string;attentionText:string;
 setPresentationActive(active:boolean):Promise<void>;
 start():Promise<void>;mute(muted:boolean):Promise<void>;selectDevices(input:string,output:string):Promise<void>;reconnect():Promise<void>;end():Promise<void>;
 hasRetainedCapture():boolean;getRetainedCapture():Uint8Array|null;discardRetainedCapture():void;
}