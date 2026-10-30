import {createHash} from 'node:crypto';
// Pure wire/parser primitives. They return DATA, never an original observation
// capability. Only opencode-client's fixed actual HTTP owner can mint one.
export const RAW_ASSISTANT_LIMITS=Object.freeze({messageBytes:1048576,sessionBytes:131072,parts:256,textScalars:32000,textBytes:128000,depth:32,tokens:65536});
const fail=code=>{throw Object.assign(Error(code),{code});};
export const rawSha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const plain=(v,required,optional=[])=>object(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>[...required,...optional].includes(k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(v);
const agent=v=>typeof v==='string'&&v.length>0&&v.length<=256&&scalar(v)&&!/[\u0000-\u001f\u007f]/u.test(v);
const scalar=s=>{for(const c of s)if(c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff)return false;return true;};
const int=v=>Number.isSafeInteger(v)&&v>=0;
const time=v=>plain(v,['created'],['streamed','completed'])&&Object.values(v).every(int);
const model=v=>plain(v,['id','providerID'],['variant'])&&[v.id,v.providerID,...(v.variant===undefined?[]:[v.variant])].every(x=>typeof x==='string'&&x.length>0&&x.length<=256&&scalar(x)&&!/[\u0000-\u001f\u007f]/u.test(x));
const sameModel=(a,b)=>model(a)&&model(b)&&a.id===b.id&&a.providerID===b.providerID&&a.variant===b.variant;

/** Strict JSON with duplicate keys/depth/token/unpaired surrogate refusal. Raw
 * bytes remain separate; no normalization, duplicate-key last-wins or fallback.
 */
export function parseUniqueRawJson(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>RAW_ASSISTANT_LIMITS.messageBytes)fail('RAW_JSON_BOUND');
 if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)fail('RAW_JSON_BOM');
 let source;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('RAW_JSON_UTF8');}
 let at=0,tokens=0;
 const ws=()=>{while(at<source.length&&/[ \t\r\n]/u.test(source[at]))at++;};
 function string(){const start=at++;for(;at<source.length;at++){
  if(source[at]==='\\'){at++;continue;}
  if(source[at]==='"'){let value;try{value=JSON.parse(source.slice(start,++at));}catch{fail('RAW_JSON_SYNTAX');}if(!scalar(value))fail('RAW_JSON_SCALAR');return value;}
 }fail('RAW_JSON_SYNTAX');}
 function value(depth){if(depth>RAW_ASSISTANT_LIMITS.depth||++tokens>RAW_ASSISTANT_LIMITS.tokens)fail('RAW_JSON_COMPLEXITY');ws();
  const first=source[at];if(first==='"')return string();
  if(first==='{'){
   at++;ws();const out=Object.create(null);if(source[at]==='}'){at++;return out;}
   for(;;){ws();if(source[at]!=='"')fail('RAW_JSON_SYNTAX');const key=string();if(Object.hasOwn(out,key))fail('RAW_JSON_DUPLICATE');ws();if(source[at++]!==':')fail('RAW_JSON_SYNTAX');out[key]=value(depth+1);ws();const end=source[at++];if(end==='}')return out;if(end!==',')fail('RAW_JSON_SYNTAX');}
  }
  if(first==='['){at++;ws();const out=[];if(source[at]===']'){at++;return out;}for(;;){out.push(value(depth+1));ws();const end=source[at++];if(end===']')return out;if(end!==',')fail('RAW_JSON_SYNTAX');}}
  for(const [literal,result]of [['true',true],['false',false],['null',null]])if(source.startsWith(literal,at)){at+=literal.length;return result;}
  const number=source.slice(at).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
  if(number){at+=number.length;const result=Number(number);if(!Number.isFinite(result))fail('RAW_JSON_NUMBER');return result;}fail('RAW_JSON_SYNTAX');
 }
 const result=value(0);ws();if(at!==source.length)fail('RAW_JSON_SYNTAX');return result;
}

/** Consume the exact original Response body through EOF before accepting data.
 * Fixture Response-shaped objects exercise only this pure DATA boundary.
 * Actual Node fetch owner uses redirect=manual, identity encoding and abort.
 */
export async function consumeBoundedRawJson(response,expectedUrl,limit,signal){
 if(![RAW_ASSISTANT_LIMITS.messageBytes,RAW_ASSISTANT_LIMITS.sessionBytes].includes(limit))fail('RAW_WIRE_LIMIT');
 let reader,done=false,cancellation,cleanupFailure;
 const cancel=()=>{if(reader&&!cancellation)cancellation=reader.cancel().catch(error=>{cleanupFailure=error;});};
 try{
  signal?.throwIfAborted();
  if(!response||response.url!==expectedUrl||response.redirected||response.status!==200||!response.body)fail('RAW_WIRE_RESPONSE');
  const contentType=response.headers.get('content-type')??'',encoding=response.headers.get('content-encoding');
  if(!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/iu.test(contentType)||encoding!==null&&encoding.toLowerCase()!=='identity')fail('RAW_WIRE_TYPE');
  const declared=response.headers.get('content-length');let length;
  if(declared!==null){if(!/^(?:0|[1-9]\d*)$/u.test(declared))fail('RAW_WIRE_LENGTH');length=Number(declared);if(!int(length)||length<1||length>limit)fail('RAW_WIRE_BOUND');}
  reader=response.body.getReader();signal?.addEventListener('abort',cancel,{once:true});signal?.throwIfAborted();let bytes=0;const chunks=[];
  for(;;){signal?.throwIfAborted();const next=await reader.read();signal?.throwIfAborted();if(next.done){done=true;break;}
   if(!(next.value instanceof Uint8Array)||!next.value.length||next.value.length>limit||bytes+next.value.length>limit)fail('RAW_WIRE_BOUND');
   bytes+=next.value.length;chunks.push(Buffer.from(next.value));
  }
  if(!bytes||length!==undefined&&length!==bytes)fail('RAW_WIRE_LENGTH');
  const raw=Buffer.concat(chunks,bytes),json=parseUniqueRawJson(raw);signal?.throwIfAborted();
  return {raw,sha256:rawSha256(raw),json,http:Object.freeze({status:200,contentType,bytes,bodyEnded:true})};
 }finally{
  signal?.removeEventListener('abort',cancel);
  try{if(!done){if(reader)cancel();else if(response?.body)await response.body.cancel();}if(cancellation)await cancellation;if(cleanupFailure)fail('RAW_WIRE_CLEANUP_UNKNOWN');}
  catch{fail('RAW_WIRE_CLEANUP_UNKNOWN');}
  finally{reader?.releaseLock();}
  // No success/opaque capability is returned after a body/abort/cleanup failure.
 }
}
export function validateRawSessionPayload(json,{sessionId,directory,agentId}){
 if(!plain(json,['data'])||!object(json.data))fail('RAW_SESSION_ENVELOPE');const value=json.data;
 if(!id(sessionId)||!sessionId.startsWith('ses_')||!agent(agentId)||value.id!==sessionId||value.agent!==agentId||!model(value.model)
  ||!plain(value.location,['directory'])||value.location.directory!==directory||typeof directory!=='string'||!directory.startsWith('/')
  ||value.revert!==undefined||value.time?.archived!==undefined)fail('RAW_SESSION_SELECTION');
 return Object.freeze({sessionId,agentId,directory,model:Object.freeze({...value.model})});
}
export function validateRawAssistantPayload(json,selected,messageId){
 if(!plain(json,['data'])||!object(json.data))fail('RAW_ASSISTANT_ENVELOPE');const message=json.data;
 if(!id(messageId)||!messageId.startsWith('msg_')||message.id!==messageId||message.type!=='assistant'||message.agent!==selected.agentId
  ||!sameModel(message.model,selected.model)||!time(message.time)||message.error!==undefined||message.retry!==undefined
  ||!Array.isArray(message.content)||message.content.length>RAW_ASSISTANT_LIMITS.parts)fail('RAW_ASSISTANT_SELECTION');
 // Explicit unexpected nested identity cannot be silently accepted as evidence.
 if(message.sessionID!==undefined||message.sessionId!==undefined)fail('RAW_ASSISTANT_PROTOCOL');
 let scalars=0,totalBytes=0;const parts=[];
 for(let contentIndex=0;contentIndex<message.content.length;contentIndex++){
  const part=message.content[contentIndex];if(!object(part)||!['text','reasoning','tool'].includes(part.type))fail('RAW_ASSISTANT_PART');
  if(part.type!=='text')continue; // Never expose reasoning/tool bytes as speech.
  // Pinned2.0.11 text schema has NO native part id. Unexpected id is drift.
  if(!plain(part,['type','text'],['state'])||typeof part.text!=='string'||!scalar(part.text)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(part.text)
    ||part.state!==undefined&&!object(part.state))fail('RAW_ASSISTANT_TEXT');
  const bytes=Buffer.from(part.text);scalars+=[...part.text].length;totalBytes+=bytes.length;
  if(scalars>RAW_ASSISTANT_LIMITS.textScalars||totalBytes>RAW_ASSISTANT_LIMITS.textBytes)fail('RAW_ASSISTANT_TEXT_BOUND');
  if(bytes.length)parts.push(Object.freeze({contentIndex,nativePartId:null,text:part.text,utf8Start:0,utf8End:bytes.length,textSha256:rawSha256(bytes)}));
 }
 if(!parts.length)fail('RAW_ASSISTANT_NO_TEXT');
 return Object.freeze({sessionId:selected.sessionId,messageId,agentId:selected.agentId,model:selected.model,parts:Object.freeze(parts),agentSettlementProof:false});
}
/** Pure range selection returns DATA. Scalar boundaries checked on original
 * decoded UTF8; no normalization, default offsets or caller authority created.
 */
export function rawAssistantRange(part,start,end){
 if(!part||typeof part.text!=='string'||!int(start)||!int(end)||start>=end)fail('RAW_ASSISTANT_RANGE');
 const bytes=Buffer.from(part.text);if(end>bytes.length||rawSha256(bytes)!==part.textSha256)fail('RAW_ASSISTANT_RANGE');
 let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(start,end));}catch{fail('RAW_ASSISTANT_RANGE');}
 return Object.freeze({text,utf8Start:start,utf8End:end,rangeSha256:rawSha256(bytes.subarray(start,end)),prefixSha256:rawSha256(bytes.subarray(0,end))});
}
