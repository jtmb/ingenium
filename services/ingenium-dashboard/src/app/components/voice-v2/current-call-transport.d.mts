export interface CurrentCallSelection {projectId:string;workspaceId:string;runtimeId:string;contextConversationId:string;agentId:string}
export interface CurrentCallTranscription {requestId:string;text:string;language:'en';durationMs:number;executionCompleted:false;agentSettlementProof:false}
export interface CurrentCallEvent {type:'selected'|'gap';data:Record<string,unknown>}
export class CurrentCallTransport {
 constructor(input:{request:typeof fetch;basePath?:string});
 selection(input:{workspaceId:string;runtimeId:string;engineSessionId:string},signal:AbortSignal):Promise<{selection:CurrentCallSelection}>;
 begin(selection:CurrentCallSelection & {requestId?:string},signal:AbortSignal):Promise<{attachmentId:string;call:Record<string,unknown>}>;
 operation(id:string,action:'inspect'|'message'|'plan'|'prepare'|'barge'|'end',input:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>>;
 transcribe(id:string,requestId:string,pcm:Uint8Array,signal:AbortSignal):Promise<CurrentCallTranscription>;
 execute(id:string,preparedId:string,signal:AbortSignal):Promise<Uint8Array>;
 events(id:string,signal:AbortSignal,onEvent:(event:CurrentCallEvent)=>void):Promise<void>;
}
export function boundedResponse(response:Response,limit:number,signal:AbortSignal):Promise<Uint8Array>;