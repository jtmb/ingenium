// APPEND to current actual opencode-client.ts; reuses actual captured Node fetch,
// scoped target, strict raw helper. DATA returned directly only to fixed owner.
export async function readOriginalCallSessionSelection(input:{sessionId:string;agentId:string;deadlineAt:number;signal:AbortSignal}):Promise<{selection:RawSessionSelection;raw:Uint8Array;sha256:string}> {
 if(!input||Object.keys(input).sort().join()!==['sessionId','agentId','deadlineAt','signal'].sort().join()
  ||typeof input.sessionId!=='string'||!validNativeSessionId(input.sessionId)||!input.sessionId.startsWith('ses_')
  ||typeof input.agentId!=='string'||!input.agentId||input.agentId.length>256||Buffer.from(input.agentId).toString()!==input.agentId
  ||/[\u0000-\u001f\u007f]/u.test(input.agentId)||!Number.isSafeInteger(input.deadlineAt)||input.deadlineAt<=Date.now()
  ||input.deadlineAt>Date.now()+10000||!(input.signal instanceof AbortSignal))return rawReadFail('RAW_CALL_SESSION_INPUT');
 const target=currentOpenCodeRuntimeTarget();if(!target?.directory)return rawReadFail('RAW_READ_SCOPED_TARGET_REQUIRED');
 const captured=Object.freeze({...target}),controller=new AbortController();let base:URL;
 try{base=new URL(captured.baseUrl);}catch{return rawReadFail('RAW_READ_TARGET');}
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')return rawReadFail('RAW_READ_TARGET');
 const abort=()=>controller.abort();input.signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,Math.max(1,input.deadlineAt-Date.now()));timer.unref();
 try{
  input.signal.throwIfAborted();
  const headers:Record<string,string>={Accept:'application/json','Accept-Encoding':'identity','x-opencode-directory':encodeURIComponent(captured.directory!)};
  const auth=captured.authHeader??(captured.password?`Basic ${Buffer.from(`opencode:${captured.password}`).toString('base64')}`:null);if(auth)headers.Authorization=auth;
  const url=new URL(`/api/session/${pathSegment(input.sessionId)}`,base).href;
  const response=await originalAssistantFetch(url,{method:'GET',headers,signal:controller.signal,redirect:'manual',cache:'no-store',credentials:'omit'});
  const body=await consumeBoundedRawJson(response,url,RAW_ASSISTANT_LIMITS.sessionBytes,controller.signal);
  input.signal.throwIfAborted();controller.signal.throwIfAborted();
  if(Date.now()>=input.deadlineAt||currentOpenCodeRuntimeTarget()!==target||target.baseUrl!==captured.baseUrl||target.directory!==captured.directory||target.authHeader!==captured.authHeader||target.password!==captured.password)return rawReadFail('RAW_READ_TARGET_CHANGED');
  return {selection:validateRawSessionPayload(body.json,{sessionId:input.sessionId,agentId:input.agentId,directory:captured.directory!}),raw:body.raw,sha256:body.sha256};
 }catch(error:unknown){const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^RAW_[A-Z_]+$/u.test(error.code)?error.code:controller.signal.aborted?'RAW_READ_ABORTED':'RAW_READ_FAILED';return rawReadFail(code);}
 finally{clearTimeout(timer);input.signal.removeEventListener('abort',abort);controller.abort();}
}
