// APPEND to actual opencode-client.ts with the separate import splice.
// Existing client/request/stream/synthesis paths are not changed.
declare const originalRawAssistantReadBrand:unique symbol;
export interface OriginalRawAssistantRead {readonly [originalRawAssistantReadBrand]:true}
export interface OriginalRawAssistantReadData {
 readonly selection:RawSessionSelection;
 readonly assistant:RawAssistantSnapshot;
 readonly directory:string;
 readonly startedAt:number;
 readonly observedAt:number;
 readonly deadlineAt:number;
 readonly sessionBeforeSha256:string;
 readonly responseSha256:string;
 readonly sessionAfterSha256:string;
 readonly sessionBeforeBytes:Uint8Array;
 readonly rawResponseBytes:Uint8Array;
 readonly sessionAfterBytes:Uint8Array;
 readonly http:RawJsonBody['http'];
 readonly agentSettlementProof:false;
}
// Fixed original Node transport captured at module initialization; no fetch,
// response, positive-proof or caller auth/URL port can be passed to this reader.
const originalAssistantFetch=globalThis.fetch.bind(globalThis);
const rawAssistantReads=new Map<OriginalRawAssistantRead,OriginalRawAssistantReadData>();
const rawAssistantReadExpiries=new Map<OriginalRawAssistantRead,ReturnType<typeof setTimeout>>();
let rawAssistantPending=0;
const rawReadFail=(code:string):never=>{throw Object.assign(Error(code),{code});};
function forgetRawAssistantRead(handle:OriginalRawAssistantRead):boolean {
 const timer=rawAssistantReadExpiries.get(handle);if(timer)clearTimeout(timer);rawAssistantReadExpiries.delete(handle);return rawAssistantReads.delete(handle);
}
function expireRawAssistantReads():void {
 const at=Date.now();for(const [handle,value]of rawAssistantReads)if(value.deadlineAt<=at)forgetRawAssistantRead(handle);
}
/** Read-only HTTP provenance, NOT call/plan/permission/agent retirement authority.
 * Requires the original scoped target. Default installation mapping is not
 * inferred from env/hostname. Existing default client behavior is untouched.
 */
export async function readOriginalRawAssistantMessage(input:{sessionId:string;messageId:string;agentId:string;deadlineAt:number;signal:AbortSignal}):Promise<OriginalRawAssistantRead> {
 expireRawAssistantReads();
 if(!input||Object.keys(input).sort().join()!==['sessionId','messageId','agentId','deadlineAt','signal'].sort().join()
  ||typeof input.sessionId!=='string'||!validNativeSessionId(input.sessionId)||!input.sessionId.startsWith('ses_')
  ||typeof input.messageId!=='string'||!validNativeSessionId(input.messageId)||!input.messageId.startsWith('msg_')||typeof input.agentId!=='string'||!input.agentId||input.agentId.length>256
  ||Buffer.from(input.agentId).toString()!==input.agentId||/[\u0000-\u001f\u007f]/u.test(input.agentId)
  ||!Number.isSafeInteger(input.deadlineAt)||input.deadlineAt<=Date.now()||input.deadlineAt>Date.now()+10000||!(input.signal instanceof AbortSignal))return rawReadFail('RAW_READ_INPUT');
 input.signal.throwIfAborted();
 if(rawAssistantPending+rawAssistantReads.size>=4)return rawReadFail('RAW_READ_CAPACITY');
 const target=currentOpenCodeRuntimeTarget();
 if(!target||typeof target.directory!=='string'||!target.directory.startsWith('/')||/[\u0000-\u001f\u007f]/u.test(target.directory))return rawReadFail('RAW_READ_SCOPED_TARGET_REQUIRED');
 const captured=Object.freeze({...target});let base:URL;
 try{base=new URL(captured.baseUrl);}catch{return rawReadFail('RAW_READ_TARGET');}
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')return rawReadFail('RAW_READ_TARGET');
 const auth=captured.authHeader??(captured.password?`Basic ${Buffer.from(`opencode:${captured.password}`).toString('base64')}`:null);
 const directory=captured.directory!;
 const bound=():void=>{
  if(currentOpenCodeRuntimeTarget()!==target||target.baseUrl!==captured.baseUrl||target.directory!==captured.directory
   ||target.authHeader!==captured.authHeader||target.password!==captured.password)return rawReadFail('RAW_READ_TARGET_CHANGED');
 };
 const controller=new AbortController(),startedAt=Date.now();
 const abort=()=>controller.abort();input.signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,Math.max(1,input.deadlineAt-Date.now()));timer.unref();
 const signal=controller.signal;
 const checkpoint=():void=>{bound();input.signal.throwIfAborted();signal.throwIfAborted();if(Date.now()>=input.deadlineAt)return rawReadFail('RAW_READ_DEADLINE');};
 const get=async(path:string,limit:1048576|131072):Promise<RawJsonBody>=>{
  checkpoint();const url=new URL(path,base).href;
  const headers:Record<string,string>={Accept:'application/json','Accept-Encoding':'identity','x-opencode-directory':encodeURIComponent(directory)};
  if(auth)headers.Authorization=auth;
  // Three fixed GETs, no redirect/retry/cookie/default-target fallback. Full
  // original body EOF/cancellation joins before another request or capability.
  const response=await originalAssistantFetch(url,{method:'GET',headers,signal,redirect:'manual',cache:'no-store',credentials:'omit'});
  const result=await consumeBoundedRawJson(response,url,limit,signal);checkpoint();return result;
 };
 rawAssistantPending++;
 try{
  checkpoint();const sessionPath=`/api/session/${pathSegment(input.sessionId)}`;
  const before=await get(sessionPath,RAW_ASSISTANT_LIMITS.sessionBytes);
  const selected=validateRawSessionPayload(before.json,{sessionId:input.sessionId,directory,agentId:input.agentId});
  const response=await get(`${sessionPath}/message/${pathSegment(input.messageId)}`,RAW_ASSISTANT_LIMITS.messageBytes);
  const assistant=validateRawAssistantPayload(response.json,selected,input.messageId);
  const after=await get(sessionPath,RAW_ASSISTANT_LIMITS.sessionBytes);
  const finalSelection=validateRawSessionPayload(after.json,{sessionId:input.sessionId,directory,agentId:input.agentId});
  if(finalSelection.model.id!==selected.model.id||finalSelection.model.providerID!==selected.model.providerID||finalSelection.model.variant!==selected.model.variant)return rawReadFail('RAW_READ_SELECTION_CHANGED');
  checkpoint();const handle=Object.freeze({}) as OriginalRawAssistantRead;
  rawAssistantReads.set(handle,Object.freeze({selection:selected,assistant,directory,startedAt,observedAt:Date.now(),deadlineAt:input.deadlineAt,
   sessionBeforeSha256:before.sha256,responseSha256:response.sha256,sessionAfterSha256:after.sha256,
   sessionBeforeBytes:before.raw,rawResponseBytes:response.raw,sessionAfterBytes:after.raw,http:response.http,agentSettlementProof:false}));
  const expiry=setTimeout(()=>forgetRawAssistantRead(handle),Math.max(1,input.deadlineAt-Date.now()));expiry.unref();rawAssistantReadExpiries.set(handle,expiry);
  return handle;
 }catch(error:unknown){
  const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^RAW_[A-Z_]+$/u.test(error.code)?error.code:signal.aborted?'RAW_READ_ABORTED':'RAW_READ_FAILED';
  return rawReadFail(code);
 }finally{clearTimeout(timer);input.signal.removeEventListener('abort',abort);controller.abort();rawAssistantPending--;}
}
/** Consume only the exact retained original once. Returned data is not a new
 * call/plan capability; the future fixed observation producer must invoke the
 * reader and consume internally, never accept this DTO from its caller.
 */
export function takeOriginalRawAssistantRead(handle:OriginalRawAssistantRead):OriginalRawAssistantReadData {
 expireRawAssistantReads();const value=rawAssistantReads.get(handle);if(!value)return rawReadFail('RAW_READ_ORIGINAL_REQUIRED');
 forgetRawAssistantRead(handle);
 return Object.freeze({...value,sessionBeforeBytes:Uint8Array.from(value.sessionBeforeBytes),rawResponseBytes:Uint8Array.from(value.rawResponseBytes),sessionAfterBytes:Uint8Array.from(value.sessionAfterBytes)});
}
export function discardOriginalRawAssistantRead(handle:OriginalRawAssistantRead):void {
 expireRawAssistantReads();if(!forgetRawAssistantRead(handle))return rawReadFail('RAW_READ_ORIGINAL_REQUIRED');
}
