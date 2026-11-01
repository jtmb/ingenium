export const RAW_ASSISTANT_LIMITS:Readonly<{messageBytes:1048576;sessionBytes:131072;parts:256;textScalars:32000;textBytes:128000;depth:32;tokens:65536}>;
export interface RawTextPart {readonly contentIndex:number;readonly nativePartId:null;readonly text:string;readonly utf8Start:0;readonly utf8End:number;readonly textSha256:string}
export interface RawModel {readonly id:string;readonly providerID:string;readonly variant?:string}
export interface RawSessionSelection {readonly sessionId:string;readonly agentId:string;readonly directory:string;readonly model:Readonly<RawModel>}
export interface RawAssistantSnapshot {readonly sessionId:string;readonly messageId:string;readonly agentId:string;readonly model:Readonly<RawModel>;readonly parts:readonly RawTextPart[];readonly agentSettlementProof:false}
export interface RawJsonBody {raw:Uint8Array;sha256:string;json:unknown;http:Readonly<{status:200;contentType:string;bytes:number;bodyEnded:true}>}
export function rawSha256(bytes:Uint8Array|string):string;
export function parseUniqueRawJson(bytes:Uint8Array):unknown;
export function consumeBoundedRawJson(response:Response,expectedUrl:string,limit:1048576|131072,signal?:AbortSignal):Promise<RawJsonBody>;
export function validateRawSessionPayload(json:unknown,selected:{sessionId:string;directory:string;agentId:string}):RawSessionSelection;
export function validateRawAssistantPayload(json:unknown,selected:RawSessionSelection,messageId:string):RawAssistantSnapshot;
export function rawAssistantRange(part:RawTextPart,start:number,end:number):Readonly<{text:string;utf8Start:number;utf8End:number;rangeSha256:string;prefixSha256:string}>;
