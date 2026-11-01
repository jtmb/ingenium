import {createHash} from "node:crypto";
import {parseStrictJobJson} from "./job-bootstrap-frame.mjs";
import {candidateBinding,candidateDenied,exact} from "./candidate-carrier.mjs";
import {AGENT_CANARY,freeze,originalJsonHash} from "../../../../packages/veyra-operations/core126-image-contract.mjs";
export const CANDIDATE_NATIVE_TOOL="ingenium_ingenium_project_detail";
export const CANDIDATE_TOOL_AGENT_PROJECTION=freeze({...AGENT_CANARY,permissions:[...AGENT_CANARY.permissions,{action:CANDIDATE_NATIVE_TOOL,resource:"*",effect:"allow"}]});
export const CANDIDATE_TOOL_AGENT_HASH=originalJsonHash(CANDIDATE_TOOL_AGENT_PROJECTION);
export const CANDIDATE_BASE_AGENT_HASH=originalJsonHash(AGENT_CANARY);
export const PROGRAM_REQUEST_BYTES=256*1024,PROGRAM_TOTAL_REQUEST_BYTES=512*1024,PROGRAM_RESPONSE_BYTES=8192,PROGRAM_MESSAGE_LIMIT=32,PROGRAM_TOOL_LIMIT=64,PROGRAM_CORE_TEXT_BYTES=128*1024;
const hex=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha=value=>createHash("sha256").update(value).digest("hex"),canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const digest=value=>sha(JSON.stringify(canonical(value))),same=(a,b)=>digest(a)===digest(b);
const record=value=>value&&typeof value==="object"&&!Array.isArray(value);
const shape=(value,required,optional=[])=>{if(!record(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))candidateDenied();};
const projectSchema=Object.freeze({type:"object",properties:{name:{type:"string"}},required:["name"],additionalProperties:false});
/** Data-only selection from authenticated original candidate bootstrap assignment.
 * Root must derive it from the persisted original case/intent after readiness CAS.
 * It grants no Core permission/readiness/model completion or production profile. */
export function assertCandidateResponseProgram(value,original,now=Date.now()){
 exact(value,["schemaVersion","program","caseId","runId","attemptId","candidateIntentHash","expiresAt","projectId","projectName","agentHash"]);
 const binding=candidateBinding(original.binding,now);if(value.schemaVersion!==1||value.runId!==binding.runId||value.attemptId!==binding.attemptId||value.candidateIntentHash!==binding.intentHash||value.expiresAt!==binding.expiresAt||!uuid.test(value.projectId??"")||value.projectId!==original.projectId||typeof value.projectName!=="string"||!value.projectName||value.projectName.length>256||value.projectName!==value.projectName.trim()||/[\u0000-\u001f\u007f]/u.test(value.projectName)||!hex.test(value.agentHash??"")||value.agentHash!==original.agentHash)candidateDenied();
 if(value.program==="native-project-detail-then-stop-v1"){if(value.caseId!=="job-broker-route"||value.agentHash!==CANDIDATE_TOOL_AGENT_HASH)candidateDenied();}
 else if(value.program==="native-text-stop-v1"){if(value.caseId!=="original-result-route"||value.agentHash!==CANDIDATE_BASE_AGENT_HASH)candidateDenied();}
 else candidateDenied();return Object.freeze({...value});
}
const textContent=value=>{if(typeof value==="string")return value;if(!Array.isArray(value)||!value.length||value.length>16)candidateDenied();return value.map(part=>{shape(part,["type","text"],["cache_control"]);if(part.type!=="text"||typeof part.text!=="string")candidateDenied();return part.text;}).join("");};
function requestBody(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>PROGRAM_REQUEST_BYTES)candidateDenied();const body=parseStrictJobJson(bytes,PROGRAM_REQUEST_BYTES);
 shape(body,["model","messages","stream"],["tools","tool_choice","stream_options","max_tokens","max_completion_tokens","temperature","top_p","presence_penalty","frequency_penalty","seed","stop","parallel_tool_calls","store","prompt_cache_key"]);
 if(body.model!=="qualification-canary"||body.stream!==true||!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>PROGRAM_MESSAGE_LIMIT)candidateDenied();
 if(body.stream_options!==undefined){exact(body.stream_options,["include_usage"]);if(body.stream_options.include_usage!==true)candidateDenied();}
 for(const key of ["max_tokens","max_completion_tokens"])if(body[key]!==undefined&&(!Number.isInteger(body[key])||body[key]<1||body[key]>4096))candidateDenied();
 for(const key of ["temperature","top_p","presence_penalty","frequency_penalty"])if(body[key]!==undefined&&(typeof body[key]!=="number"||!Number.isFinite(body[key])||body[key]<-2||body[key]>2))candidateDenied();
 if(body.seed!==undefined&&!Number.isSafeInteger(body.seed)||body.parallel_tool_calls!==undefined&&typeof body.parallel_tool_calls!=="boolean"||body.store!==undefined&&body.store!==false||body.prompt_cache_key!==undefined&&(typeof body.prompt_cache_key!=="string"||body.prompt_cache_key.length>256)||body.stop!==undefined)candidateDenied();
 if(body.tools!==undefined){if(!Array.isArray(body.tools)||body.tools.length>PROGRAM_TOOL_LIMIT)candidateDenied();const names=new Set();for(const tool of body.tools){shape(tool,["type","function"],["cache_control"]);shape(tool.function,["name","description","parameters"],["strict"]);if(tool.type!=="function"||typeof tool.function.name!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(tool.function.name)||names.has(tool.function.name)||typeof tool.function.description!=="string"||tool.function.description.length>16384||!record(tool.function.parameters)||tool.function.strict!==undefined&&typeof tool.function.strict!=="boolean")candidateDenied();names.add(tool.function.name);}}
 return body;
}
function initialMessages(messages){for(let i=0;i<messages.length;i++){const m=messages[i];shape(m,["role","content"],["cache_control"]);const text=textContent(m.content);if(i===messages.length-1){if(m.role!=="user"||text!=="qualification-canary")candidateDenied();}else if(m.role!=="system"||text.length>128*1024)candidateDenied();}}
function toolChoice(choice){if(choice===undefined||choice==="auto"||choice==="required")return;exact(choice,["type","function"]);exact(choice.function,["name"]);if(choice.type!=="function"||choice.function.name!==CANDIDATE_NATIVE_TOOL)candidateDenied();}
function sse(binding,sequence,delta,reason,now){
 const id="chatcmpl-candidate-"+binding.attemptId.replaceAll("-","")+"-"+sequence,base={id,object:"chat.completion.chunk",created:Math.floor(now/1000),model:"qualification-canary"};
 const chunks=[{...base,choices:[{index:0,delta:{role:"assistant"},finish_reason:null}]},{...base,choices:[{index:0,delta,finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:reason}]}];
 // Usage is deliberately omitted: no model tokens or billing were measured.
 const bytes=Buffer.from(chunks.map(value=>"data: "+JSON.stringify(value)+"\n\n").join("")+"data: [DONE]\n\n");if(bytes.length>PROGRAM_RESPONSE_BYTES)candidateDenied();return Object.freeze({kind:"inert-provider-response",status:200,contentType:"text/event-stream",body:bytes});
}
/** Finite SAME-child provider program. Only the real proxy calls observeCoreResult
 * after awaiting its retained original Core RPC. No response/tool data is invented.
 * A terminal provider response is NOT verified native completion or Core success. */
export function createCandidateResponseProgram(value,original,{now=Date.now}={}){
 const selected=assertCandidateResponseProgram(value,original,now()),binding=Object.freeze({...original.binding}),callId="call_candidate_"+binding.attemptId.replaceAll("-","");
 let phase="initial",requests=0,bytes=0,prefixHash=null,toolsHash=null,core=null,reason=null,providerTerminalSent=false;
 const close=code=>{phase="closed";reason=code;};
 const live=()=>{if(now()>=selected.expiresAt||phase==="closed")candidateDenied();};
 return Object.freeze({
 respond(request){try{
  live();requests++;bytes+=request.body?.length??0;const max=selected.program==="native-text-stop-v1"?1:2;
  if(requests>max||bytes>PROGRAM_TOTAL_REQUEST_BYTES||request.stage!=="executing"||request.method!=="POST"||request.path!=="/v1/chat/completions")candidateDenied();
  const body=requestBody(request.body);if(selected.program==="native-project-detail-then-stop-v1")toolChoice(body.tool_choice);else if(body.tool_choice!==undefined&&body.tool_choice!=="auto"&&body.tool_choice!=="none")candidateDenied();
  if(phase==="initial"){
   initialMessages(body.messages);prefixHash=digest(body.messages);toolsHash=digest(body.tools??null);
   if(selected.program==="native-text-stop-v1"){phase="terminal-sent";providerTerminalSent=true;return sse(binding,requests,{content:"qualification-canary-complete"},"stop",now());}
   if(body.messages.length>PROGRAM_MESSAGE_LIMIT-2)candidateDenied();toolChoice(body.tool_choice);const tools=(body.tools??[]).filter(t=>t.function.name===CANDIDATE_NATIVE_TOOL);if(tools.length!==1||!same(tools[0].function.parameters,projectSchema))candidateDenied();
   phase="tool-issued";return sse(binding,requests,{tool_calls:[{index:0,id:callId,type:"function",function:{name:CANDIDATE_NATIVE_TOOL,arguments:JSON.stringify({name:selected.projectName})}}]},"tool_calls",now());
  }
  if(phase!=="tool-observed"||!core||body.messages.length<3||digest(body.messages.slice(0,-2))!==prefixHash||digest(body.tools??null)!==toolsHash)candidateDenied();
  const assistant=body.messages.at(-2),tool=body.messages.at(-1);shape(assistant,["role","content","tool_calls"],["cache_control"]);if(assistant.role!=="assistant"||assistant.content!==null&&assistant.content!==""||!Array.isArray(assistant.tool_calls)||assistant.tool_calls.length!==1)candidateDenied();
  const called=assistant.tool_calls[0];exact(called,["id","type","function"]);exact(called.function,["name","arguments"]);if(called.id!==callId||called.type!=="function"||called.function.name!==CANDIDATE_NATIVE_TOOL||typeof called.function.arguments!=="string"||!same(parseStrictJobJson(Buffer.from(called.function.arguments),1024),{name:selected.projectName}))candidateDenied();
  shape(tool,["role","tool_call_id","content"],["cache_control"]);if(tool.role!=="tool"||tool.tool_call_id!==callId||typeof tool.content!=="string"||sha(tool.content)!==core.textSha256)candidateDenied();
  phase="terminal-sent";providerTerminalSent=true;return sse(binding,requests,{content:"qualification-canary-complete"},"stop",now());
 }catch{close("CANDIDATE_PROVIDER_PROGRAM_REFUSED");return null;}},
 observeCoreResult(request,result){
  // Other original control/catalog/result traffic is not a tool witness.
  const path=`/api/v1/runtime/job-runs/${binding.runId}/mcp/ingenium_project_detail`;
  if(request.path!==path)return;
  try{live();if(phase!=="tool-issued"||request.method!=="POST"||!Buffer.isBuffer(request.body)||request.body.length>1024||!same(parseStrictJobJson(request.body,1024),{name:selected.projectName})||result.status!==200||!Buffer.isBuffer(result.body)||result.body.length>PROGRAM_CORE_TEXT_BYTES)candidateDenied();
   const response=parseStrictJobJson(result.body,PROGRAM_CORE_TEXT_BYTES);exact(response,["data"]);shape(response.data,["content"],["isError"]);if(response.data.isError!==undefined&&response.data.isError!==false||!Array.isArray(response.data.content)||response.data.content.length!==1)candidateDenied();const item=response.data.content[0];exact(item,["type","text"]);if(item.type!=="text"||typeof item.text!=="string"||!item.text||Buffer.byteLength(item.text)>PROGRAM_CORE_TEXT_BYTES)candidateDenied();
   core=Object.freeze({status:result.status,responseSha256:sha(result.body),textSha256:sha(item.text),argumentsSha256:sha(request.body)});phase="tool-observed";
  }catch{close("CANDIDATE_ORIGINAL_TOOL_WITNESS_REFUSED");}
 },
 reject(){close("CANDIDATE_PROVIDER_PROGRAM_REFUSED");},
 close(){close("CANDIDATE_PROVIDER_PROGRAM_CLOSED");},
 snapshot(){return Object.freeze({program:selected.program,caseId:selected.caseId,phase,requests,requestBytes:bytes,core:core?{...core}:null,providerTerminalSent,reason});},
 });
}
