// APPEND to actual opencode-client.ts. The private call owner alone consumes
// this genuine live HTTP body. No cursor/replay or completed-turn claim.
export async function openOriginalCallEventBody(signal:AbortSignal):Promise<ReadableStream<Uint8Array>> {
 if(!(signal instanceof AbortSignal))return rawReadFail('RAW_FEED_SIGNAL');signal.throwIfAborted();
 const target=currentOpenCodeRuntimeTarget();if(!target?.directory)return rawReadFail('RAW_READ_SCOPED_TARGET_REQUIRED');
 const captured=Object.freeze({...target});let base:URL,response:Response|undefined;
 try{
  base=new URL(captured.baseUrl);if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')return rawReadFail('RAW_READ_TARGET');
  const url=new URL('/api/event',base).href,headers:Record<string,string>={Accept:'text/event-stream','Accept-Encoding':'identity','x-opencode-directory':encodeURIComponent(captured.directory!)};
  const auth=captured.authHeader??(captured.password?`Basic ${Buffer.from(`opencode:${captured.password}`).toString('base64')}`:null);if(auth)headers.Authorization=auth;
  response=await originalAssistantFetch(url,{method:'GET',headers,signal,redirect:'manual',cache:'no-store',credentials:'omit'});
  const encoding=response.headers.get('content-encoding');
  if(response.status!==200||response.redirected||response.url!==url||!response.body
   ||!/^text\/event-stream(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/iu.test(response.headers.get('content-type')??'')
   ||encoding!==null&&encoding.toLowerCase()!=='identity')return rawReadFail('RAW_FEED_RESPONSE');
  signal.throwIfAborted();
  if(currentOpenCodeRuntimeTarget()!==target||target.baseUrl!==captured.baseUrl||target.directory!==captured.directory||target.authHeader!==captured.authHeader||target.password!==captured.password)return rawReadFail('RAW_READ_TARGET_CHANGED');
  return response.body;
 }catch(error:unknown){
  try{await response?.body?.cancel();}catch{return rawReadFail('RAW_FEED_CLEANUP_UNKNOWN');}
  const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^RAW_[A-Z_]+$/u.test(error.code)?error.code:signal.aborted?'RAW_READ_ABORTED':'RAW_READ_FAILED';return rawReadFail(code);
 }
}
