import {createHash} from 'node:crypto';
import {hash as canonicalHash} from '../../packages/veyra-operations/core126-image-contract.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const id=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const failure=code=>Object.assign(new Error(code),{code});
const MAX=8*1024*1024,INPUT=512*1024;
export const originalContainerProfileSha256=c=>canonicalHash({User:c.Config?.User,WorkingDir:c.Config?.WorkingDir,Entrypoint:c.Config?.Entrypoint,Cmd:c.Config?.Cmd,HostConfig:c.HostConfig,Mounts:c.Mounts,AppArmorProfile:c.AppArmorProfile});
function limits(options={}){const maxBytes=options.maxBytes??1024*1024,timeoutMs=options.timeoutMs??10000;if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw failure('CORE126_DOCKER_BOUNDS');return{maxBytes,timeoutMs,signal:options.signal};}
function pathOf(path){if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||/[\u0000-\u0020\u007f\\]/u.test(path)||path.includes('..')||path.length>1024)throw failure('CORE126_DOCKER_PATH');return path;}
/** Additive transport ONLY. makeOriginalRequest is bound inside the EXISTING
 * runtime-manager to its existing socket/version, never a URL/token/socket input. */
export function createOriginalDockerBinaryIo({makeOriginalRequest}){
 if(typeof makeOriginalRequest!=='function')throw failure('CORE126_ORIGINAL_DOCKER_OWNER_REQUIRED');
 async function exchange(method,path,body,options,hijack,input){
  const{maxBytes,timeoutMs,signal}=limits(options);pathOf(path);if(!['GET','POST','PUT','DELETE'].includes(method))throw failure('CORE126_DOCKER_METHOD');
  const payload=body===undefined?Buffer.alloc(0):Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  if(payload.length>INPUT||!Buffer.isBuffer(input)||input.length>INPUT)throw failure('CORE126_DOCKER_INPUT_LIMIT');signal?.throwIfAborted();
  return await new Promise((resolve,reject)=>{
   let req,res,socket,settled=false,ended=false,written=false,count=0;const chunks=[];
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);};
   const finish=(error,value)=>{if(settled)return;settled=true;cleanup();if(error){req?.destroy();res?.destroy();socket?.destroy();reject(error);}else{socket?.destroy();resolve(value);}};
   const fail=code=>finish(failure(code));
   const aborted=()=>fail('CORE126_DOCKER_ABORTED');
   const timer=setTimeout(()=>fail('CORE126_DOCKER_TIMEOUT'),timeoutMs);
   const add=chunk=>{if(settled)return;const bytes=Buffer.from(chunk);count+=bytes.length;if(count>maxBytes)return fail('CORE126_DOCKER_RESPONSE_LIMIT');chunks.push(bytes);};
   try{
    req=makeOriginalRequest({method,path,headers:{...(payload.length?{'Content-Type':'application/json','Content-Length':String(payload.length)}:{}),...(hijack?{Connection:'Upgrade',Upgrade:'tcp'}:{})},timeout:timeoutMs},response=>{
     if(hijack){response.resume();return fail('CORE126_DOCKER_UPGRADE_REQUIRED');}
     res=response;const rawLength=res.headers?.['content-length'];let expected;
     if(rawLength!==undefined){if(typeof rawLength!=='string'||!/^\d+$/.test(rawLength)||!Number.isSafeInteger(Number(rawLength))||Number(rawLength)>maxBytes)return fail('CORE126_DOCKER_CONTENT_LENGTH');expected=Number(rawLength);}
     res.on('data',add);res.once('error',()=>fail('CORE126_DOCKER_RESPONSE_ERROR'));res.once('aborted',()=>fail('CORE126_DOCKER_TRUNCATED'));
     res.once('end',()=>{ended=true;if(expected!==undefined&&expected!==count)return fail('CORE126_DOCKER_TRUNCATED');if(!Number.isInteger(res.statusCode))return fail('CORE126_DOCKER_HTTP_STATUS');finish(null,{status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks,count)});});
     res.once('close',()=>{if(!ended)fail('CORE126_DOCKER_TRUNCATED');});
    });
    req.once('error',()=>fail('CORE126_DOCKER_REQUEST_ERROR'));req.once('timeout',()=>fail('CORE126_DOCKER_TIMEOUT'));
    if(hijack)req.once('upgrade',(response,stream,head)=>{
     if(response.statusCode!==101){stream.destroy();return fail('CORE126_DOCKER_UPGRADE_REQUIRED');}socket=stream;
     socket.on('data',add);socket.once('error',()=>fail('CORE126_DOCKER_STREAM_ERROR'));socket.once('finish',()=>{written=true;});
     socket.once('end',()=>{ended=true;if(!written&&socket.writableFinished!==true)return fail('CORE126_DOCKER_INPUT_UNCONFIRMED');finish(null,{status:101,headers:response.headers,bytes:Buffer.concat(chunks,count)});});
     socket.once('close',()=>{if(!ended)fail('CORE126_DOCKER_STREAM_TRUNCATED');});
     if(head?.length)add(head);if(!settled)socket.end(input);
    });
    signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)return aborted();req.end(payload);
   }catch{fail('CORE126_DOCKER_OWNER_REQUEST_FAILED');}
  });
 }
 return Object.freeze({
  request:(method,path,body,options)=>exchange(method,path,body,options,false,Buffer.alloc(0)),
  hijack:(path,body,input,options)=>exchange('POST',path,body,options,true,input),
 });
}
export function decodeDockerMultiplex(raw,maxBytes=1024*1024){
 if(!Buffer.isBuffer(raw)||raw.length>MAX||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX)throw failure('CORE126_DOCKER_FRAME_BOUNDS');
 const output=[],errors=[];let cursor=0,total=0;
 while(cursor<raw.length){if(raw.length-cursor<8)throw failure('CORE126_DOCKER_FRAME_TRUNCATED');const type=raw[cursor],size=raw.readUInt32BE(cursor+4);if(![1,2].includes(type)||raw[cursor+1]||raw[cursor+2]||raw[cursor+3])throw failure('CORE126_DOCKER_FRAME_HEADER');cursor+=8;total+=size;if(total>maxBytes)throw failure('CORE126_DOCKER_FRAME_LIMIT');if(size>raw.length-cursor)throw failure('CORE126_DOCKER_FRAME_TRUNCATED');(type===1?output:errors).push(raw.subarray(cursor,cursor+size));cursor+=size;}
 return{stdout:Buffer.concat(output),stderr:Buffer.concat(errors)};
}
function json(response,status){if(response.status!==status)throw failure('CORE126_DOCKER_STATUS');try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.bytes));}catch{throw failure('CORE126_DOCKER_JSON');}}
/** Actual exec/read/inspect producer. No caller command, detached mode or TTY.
 * probeSource is the reviewed frozen harness source, not task/user prompt text. */
export function createCore126DockerProbeOwner({io,probeSource,probeSha256}){
 if(!io||typeof io.request!=='function'||typeof io.hijack!=='function'||!Buffer.isBuffer(probeSource)||probeSource.length<1||probeSource.length>96*1024||digest(probeSource)!==probeSha256)throw failure('CORE126_PROBE_SOURCE');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(probeSource),retired=new WeakMap();
 return Object.freeze({
  async exec(containerId,input,options){
   if(!id(containerId))throw failure('CORE126_CONTAINER_ID');const payload=Buffer.from(JSON.stringify(input));if(payload.length>INPUT)throw failure('CORE126_PROBE_INPUT_LIMIT');
   const create=await io.request('POST','/containers/'+containerId+'/exec',{AttachStdin:true,AttachStdout:true,AttachStderr:true,Tty:false,Privileged:false,User:'1000:1000',WorkingDir:'/workspace',Cmd:['/usr/local/bin/node','--input-type=module','-e',text,'--','--core126-probe']},options);
   const exec=json(create,201);if(!id(exec.Id))throw failure('CORE126_EXEC_ID');
   const stream=await io.hijack('/exec/'+exec.Id+'/start',{Detach:false,Tty:false},payload,options),decoded=decodeDockerMultiplex(stream.bytes,options?.maxBytes??1024*1024);
   const inspectRaw=await io.request('GET','/exec/'+exec.Id+'/json',undefined,options),inspect=json(inspectRaw,200);
   if(inspect.ID!==exec.Id&&inspect.Id!==exec.Id||inspect.ContainerID!==containerId||inspect.Running!==false||!Number.isInteger(inspect.ExitCode))throw failure('CORE126_EXEC_RETIREMENT_UNCONFIRMED');
   return{execId:exec.Id,containerId,exitCode:inspect.ExitCode,stdout:decoded.stdout,stderr:decoded.stderr,stdoutSha256:digest(decoded.stdout),stderrSha256:digest(decoded.stderr),rawFrameSha256:digest(stream.bytes),rawInspectSha256:digest(inspectRaw.bytes),probeSha256};
  },
  async waitOriginalContainer(binding,options){
   if(!binding||!id(binding.containerId)||!/^sha256:[a-f0-9]{64}$/.test(binding.imageId)||typeof binding.daemonId!=='string'||!id(binding.publicProfileSha256)||!Number.isFinite(Date.parse(binding.startedAt)))throw failure('CORE126_ORIGINAL_CONTAINER_BINDING');
   const daemon=json(await io.request('GET','/info',undefined,options),200);if(daemon.ID!==binding.daemonId)throw failure('CORE126_DAEMON_CHANGED');
   const waitedRaw=await io.request('POST','/containers/'+binding.containerId+'/wait?condition=not-running',undefined,options),waited=json(waitedRaw,200);
   if(!Number.isInteger(waited.StatusCode)||waited.Error?.Message)throw failure('CORE126_CONTAINER_WAIT_ERROR');
   const inspectRaw=await io.request('GET','/containers/'+binding.containerId+'/json',undefined,options),inspect=json(inspectRaw,200),state=inspect.State;
   const last=json(await io.request('GET','/info',undefined,options),200);
   if(last.ID!==binding.daemonId||inspect.Id!==binding.containerId||inspect.Image!==binding.imageId||state?.Running!==false||state.Pid!==0||state.Status!=='exited'||state.StartedAt!==binding.startedAt||!Number.isFinite(Date.parse(state.FinishedAt))||Date.parse(state.FinishedAt)<Date.parse(state.StartedAt)||state.ExitCode!==waited.StatusCode||!inspect.HostConfig||inspect.HostConfig.PidMode||inspect.HostConfig.Privileged===true||originalContainerProfileSha256(inspect)!==binding.publicProfileSha256)throw failure('CORE126_CONTAINER_RETIREMENT_UNCONFIRMED');
   const receipt=Object.freeze({});retired.set(receipt,{...binding,waitSha256:digest(waitedRaw.bytes),inspectSha256:digest(inspectRaw.bytes),exitCode:waited.StatusCode,finishedAt:state.FinishedAt});return receipt;
  },
  retirementFacts(receipt){const facts=retired.get(receipt);if(!facts)throw failure('CORE126_ORIGINAL_RETIREMENT_RECEIPT');return Object.freeze({...facts});},
  async removeRetired(receipt,options){const facts=retired.get(receipt);if(!facts)throw failure('CORE126_ORIGINAL_RETIREMENT_RECEIPT');const daemon=json(await io.request('GET','/info',undefined,options),200);if(daemon.ID!==facts.daemonId)throw failure('CORE126_DAEMON_CHANGED');const current=json(await io.request('GET','/containers/'+facts.containerId+'/json',undefined,options),200);if(current.Id!==facts.containerId||current.Image!==facts.imageId||current.State?.Running!==false||current.State.Pid!==0||current.State.StartedAt!==facts.startedAt||originalContainerProfileSha256(current)!==facts.publicProfileSha256)throw failure('CORE126_CLEANUP_IDENTITY_CHANGED');const removed=await io.request('DELETE','/containers/'+facts.containerId+'?v=false',undefined,options);if(removed.status!==204)throw failure('CORE126_CLEANUP_REFUSED');retired.delete(receipt);return{containerId:facts.containerId,removed:true};},
 });
}