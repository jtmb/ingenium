import {validateWav} from '../../../../../../packages/veyra-voice/audio.mjs';
const fail=(code,status=0)=>{throw Object.assign(Error(code),{code,status});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const encode=new TextEncoder();
/** Renderer data transport only. The real mount passes dashboardFetch, preserving
 * the existing cookie/CSRF owner. No response field supplies domain authority. */
export class CurrentCallTransport {
 constructor({request,basePath='/api/v1/voice/current-calls'}){
  if(typeof request!=='function'||typeof basePath!=='string'||!/^\/(?:[A-Za-z0-9_-]+\/)*voice\/current-calls$/.test(basePath))fail('CALL_BROWSER_CONFIG');
  this.request=request;this.basePath=basePath;
 }
 async response(path,body,signal,pcm=false){
  if(!(signal instanceof AbortSignal))fail('CALL_BROWSER_SIGNAL');signal.throwIfAborted();
  const response=await this.request(this.basePath+path,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,headers:{'Content-Type':pcm?'application/octet-stream':'application/json'},body:pcm?body:JSON.stringify(body)});
  if(!response.ok){let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedResponse(response,8192,signal)));}catch{fail('CALL_BROWSER_HTTP',response.status)}const code=typeof value?.error?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(value.error.code)?value.error.code:'CALL_BROWSER_HTTP';fail(code,response.status);}
  return response;
 }
 async json(path,body,signal){const response=await this.response(path,body,signal);if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??''))fail('CALL_BROWSER_RESPONSE_TYPE');let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedResponse(response,20000,signal)));}catch(error){if(error?.code)throw error;fail('CALL_BROWSER_RESPONSE_INVALID')}if(!value||typeof value!=='object'||Array.isArray(value))fail('CALL_BROWSER_RESPONSE_INVALID');return value;}
 selection(input,signal){return this.json('/selection',input,signal);}
 begin(selection,signal){return this.json('/begin',selection,signal);}
 operation(id,action,input,signal){if(!uuid(id)||!['inspect','message','plan','prepare','barge','end'].includes(action))fail('CALL_BROWSER_SELECTOR');return this.json('/'+id+'/'+action,input,signal);}
 async transcribe(id,requestId,pcm,signal){if(!uuid(id)||!uuid(requestId)||!(pcm instanceof Uint8Array)||pcm.length<8000||pcm.length>480000||pcm.length%2)fail('CALL_BROWSER_PCM_INVALID');const response=await this.response('/'+id+'/transcribe/'+requestId,pcm,signal,true);if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??''))fail('CALL_BROWSER_RESPONSE_TYPE');const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedResponse(response,20000,signal)));if(value?.requestId!==requestId||typeof value.text!=='string'||[...value.text].length>2000||value.agentSettlementProof!==false||value.executionCompleted!==false)fail('CALL_BROWSER_TRANSCRIPTION_INVALID');return value;}
 async execute(id,preparedId,signal){if(!uuid(id)||!uuid(preparedId))fail('CALL_BROWSER_SELECTOR');const response=await this.response('/'+id+'/execute',{preparedId},signal);if(response.headers.get('content-type')?.split(';')[0]!=='audio/wav')fail('CALL_BROWSER_RESPONSE_TYPE');const wav=await boundedResponse(response,1440044,signal);validateWav(wav);return wav;}
 async events(id,signal,onEvent){
  if(!uuid(id)||typeof onEvent!=='function')fail('CALL_BROWSER_SELECTOR');const response=await this.response('/'+id+'/events',{},signal);
  if(response.headers.get('content-type')?.split(';')[0]!=='text/event-stream'||!response.body)fail('CALL_BROWSER_RESPONSE_TYPE');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',done=false,cancellation,failure;
  const cancel=()=>{cancellation??=reader.cancel().catch(error=>{failure=error;});};signal.addEventListener('abort',cancel,{once:true});
  try{
   for(;;){signal.throwIfAborted();const item=await reader.read();signal.throwIfAborted();if(item.done){done=true;buffer+=decoder.decode();if(buffer)fail('CALL_BROWSER_EVENT_TRUNCATED');return;}
    if(!(item.value instanceof Uint8Array)||item.value.length>262144)fail('CALL_BROWSER_EVENT_BOUND');buffer=(buffer+decoder.decode(item.value,{stream:true})).replace(/\r\n/g,'\n');let boundary;
    while((boundary=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);if(encode.encode(block).length>16384)fail('CALL_BROWSER_EVENT_BOUND');if(!block)continue;const lines=block.split('\n');if(lines.some(line=>line&&!line.startsWith('event: ')&&!line.startsWith('data: ')))fail('CALL_BROWSER_EVENT_INVALID');const names=lines.filter(x=>x.startsWith('event: ')),data=lines.filter(x=>x.startsWith('data: '));if(names.length!==1||data.length!==1)fail('CALL_BROWSER_EVENT_INVALID');const type=names[0].slice(7),value=JSON.parse(data[0].slice(6));if(!['selected','gap'].includes(type)||!value||typeof value!=='object'||Array.isArray(value)||type==='gap'&&(value.futureOnly!==true||value.resyncRequired!==true)||type==='selected'&&(value.agentSettlementProof!==false||typeof value.eventId!=='string'||value.eventId.length>512||typeof value.type!=='string'||typeof value.sessionId!=='string'))fail('CALL_BROWSER_EVENT_INVALID');onEvent({type,data:value});}
    if(encode.encode(buffer).length>16384)fail('CALL_BROWSER_EVENT_BOUND');
   }
  }finally{signal.removeEventListener('abort',cancel);try{if(!done)cancel();if(cancellation)await cancellation;if(failure)fail('CALL_BROWSER_BODY_JOIN_UNKNOWN');}finally{reader.releaseLock();}}
 }
}
/** Serial body read/cancel with original cancellation join; no unbounded text(). */
export async function boundedResponse(response,limit,signal){
 if(!response.body)fail('CALL_BROWSER_RESPONSE_EMPTY');const reader=response.body.getReader(),chunks=[];let size=0,done=false,cancellation,failure;
 const cancel=()=>{cancellation??=reader.cancel().catch(error=>{failure=error;});};signal.addEventListener('abort',cancel,{once:true});
 try{for(;;){signal.throwIfAborted();const item=await reader.read();signal.throwIfAborted();if(item.done){done=true;break;}if(!(item.value instanceof Uint8Array)||item.value.length>limit||(size+=item.value.length)>limit)fail('CALL_BROWSER_RESPONSE_BOUND');chunks.push(item.value);}const result=new Uint8Array(size);let offset=0;for(const b of chunks){result.set(b,offset);offset+=b.length;}return result;}
 finally{signal.removeEventListener('abort',cancel);try{if(!done)cancel();if(cancellation)await cancellation;if(failure)fail('CALL_BROWSER_BODY_JOIN_UNKNOWN');}finally{reader.releaseLock();}}
}