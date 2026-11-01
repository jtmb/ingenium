/** Original manager's fixed private Docker socket only. No injectable I/O/clock/grant ports. */
import {request as httpRequest} from 'node:http';
import {parseStrictJobJson} from '../dot-v2/job-bootstrap-frame.mjs';
const socketPath='/var/run/docker.sock',active=new Map();
const failure=code=>Object.assign(Error(code),{code,status:503});
export function workspaceDocker(method,path,body,limit=1024*1024){
 const payload=body===undefined?null:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
 if(payload&&payload.length>64*1024)throw failure('WORKSPACE_V2_REQUEST_BOUND');
 return new Promise((resolve,reject)=>{
  let request,response,settled=false,ended=false,bytes=0;const chunks=[];
  const fail=code=>{if(settled)return;settled=true;reject(failure(code));request?.destroy();response?.destroy();};
  request=httpRequest({socketPath,path:'/v1.45'+path,method,timeout:10000,headers:payload?{'Content-Type':'application/json','Content-Length':payload.length}:undefined},r=>{
   response=r;r.on('data',b=>{bytes+=b.length;if(bytes>limit)return fail('WORKSPACE_V2_DOCKER_RESPONSE_BOUND');chunks.push(Buffer.from(b));});
   r.once('aborted',()=>fail('WORKSPACE_V2_DOCKER_RESPONSE_TRUNCATED'));r.once('error',()=>fail('WORKSPACE_V2_DOCKER_RESPONSE_UNKNOWN'));
   r.once('end',()=>{ended=true;if(settled)return;if(r.complete!==true)return fail('WORKSPACE_V2_DOCKER_RESPONSE_TRUNCATED');settled=true;resolve({status:r.statusCode,bytes:Buffer.concat(chunks),request,response:r});});
   r.once('close',()=>{if(!ended)fail('WORKSPACE_V2_DOCKER_RESPONSE_TRUNCATED');});
  });request.once('timeout',()=>fail('WORKSPACE_V2_DOCKER_REQUEST_TIMEOUT'));request.once('error',()=>fail('WORKSPACE_V2_DOCKER_REQUEST_UNKNOWN'));request.end(payload??undefined);
 });
}
export async function workspaceDockerJson(method,path,body,status=200){
 const r=await workspaceDocker(method,path,body);if(r.status!==status)throw failure('WORKSPACE_V2_DOCKER_STATUS_'+r.status);
 return {...r,value:r.bytes.length?parseStrictJobJson(r.bytes,1024*1024):null};
}
/** Original retained raw101 upgrade + exact stdout frame ACK. Socket finish, delay,
 * current labels or a subsequent probe cannot supply this witness. */
export function joinWorkspaceAttach(containerId,capability,expected){
 if(!/^[a-f0-9]{64}$/.test(containerId)||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(capability)||active.has(containerId))throw failure('WORKSPACE_V2_ATTACH_INPUT');
 const state={request:null,response:null,socket:null,ack:null,unknown:null,joined:false,closed:false};active.set(containerId,state);
 const frame=Buffer.from(JSON.stringify({schemaVersion:2,protocol:'workspace-runtime-v2',nonce:expected.nonce,capability,startIdentity:expected.startIdentity,requestId:expected.requestId})+'\n');
 return new Promise((resolve,reject)=>{
  let pending=Buffer.alloc(0),ackBytes=Buffer.alloc(0),total=0,settled=false;
  const fail=code=>{state.unknown??=code;if(!settled){settled=true;clearTimeout(timer);frame.fill(0);reject(failure(code));}state.socket?.destroy();};
  const timer=setTimeout(()=>fail('WORKSPACE_V2_ATTACH_ACK_TIMEOUT'),10000);timer.unref?.();
  const request=httpRequest({socketPath,path:'/v1.45/containers/'+containerId+'/attach?stream=1&stdin=1&stdout=1&stderr=1',method:'POST',headers:{Connection:'Upgrade',Upgrade:'tcp','Content-Length':0}});state.request=request;
  request.once('upgrade',(response,socket,head)=>{
   state.response=response;state.socket=socket;if(response.statusCode!==101||head.length)return fail('WORKSPACE_V2_ATTACH_UPGRADE_UNKNOWN');
   socket.on('data',b=>{
    if(state.joined)return;total+=b.length;if(total>128*1024)return fail('WORKSPACE_V2_ATTACH_ACK_BOUND');pending=Buffer.concat([pending,b]);
    while(pending.length>=8){
     if(pending[0]!==1||pending[1]||pending[2]||pending[3])return fail('WORKSPACE_V2_ATTACH_ACK_STREAM');
     const n=pending.readUInt32BE(4);if(n<1||n>64*1024)return fail('WORKSPACE_V2_ATTACH_ACK_BOUND');if(pending.length<8+n)return;
     const payload=pending.subarray(8,8+n),line=payload.indexOf(10),prefix=line<0?payload:payload.subarray(0,line);
     ackBytes=Buffer.concat([ackBytes,prefix]);if(ackBytes.length>4096)return fail('WORKSPACE_V2_ATTACH_ACK_BOUND');
     pending=pending.subarray(8+n);if(line<0)continue;
     let ack;try{ack=parseStrictJobJson(ackBytes,4096);}catch{return fail('WORKSPACE_V2_ATTACH_ACK_INVALID');}
    const wanted={schemaVersion:2,protocol:'workspace-runtime-v2',nonce:expected.nonce,runtimeId:expected.runtimeId,workspaceId:expected.workspaceId,credentialId:expected.credentialId,bindingHash:expected.bindingHash,bindingEpoch:expected.bindingEpoch,startIdentity:expected.startIdentity,mcpProtocol:2};
    if(!ack||JSON.stringify(Object.keys(ack).sort())!==JSON.stringify(Object.keys(wanted).sort())||Object.entries(wanted).some(([k,v])=>ack[k]!==v))return fail('WORKSPACE_V2_ATTACH_ACK_BINDING');
    state.ack=Object.freeze(ack);state.joined=true;settled=true;clearTimeout(timer);pending.fill(0);pending=Buffer.alloc(0);ackBytes.fill(0);resolve(state.ack);return;
    }
   });socket.once('error',()=>fail('WORKSPACE_V2_ATTACH_SOCKET_ERROR'));socket.once('end',()=>fail('WORKSPACE_V2_ATTACH_SOCKET_ENDED'));socket.once('close',()=>{state.closed=true;fail('WORKSPACE_V2_ATTACH_SOCKET_CLOSED')});
   socket.write(frame,()=>frame.fill(0)); // retain the original socket; no socket.end/grace-delay fabrication
  });request.once('response',r=>{state.response=r;r.resume();fail('WORKSPACE_V2_ATTACH_NO_UPGRADE');});request.once('error',()=>fail('WORKSPACE_V2_ATTACH_REQUEST_UNKNOWN'));request.end();
 });
}
export function requireRetainedWorkspaceAttach(containerId){
 const s=active.get(containerId);if(!s?.joined||s.unknown||s.socket?.destroyed||!s.ack)throw failure('WORKSPACE_V2_ORIGINAL_ATTACH_UNAVAILABLE');return s.ack;
}

/** Stop confirmation never synthesizes an active attachment after a manager restart. */
export async function joinStoppedWorkspaceAttach(containerId,runtimeId){
 const state=active.get(containerId);if(!state)return {currentManagerAttachment:false,closed:true};
 if(!state.joined||state.ack?.runtimeId!==runtimeId)throw failure('WORKSPACE_V2_RETIREMENT_ATTACH_BINDING');
 const deadline=Date.now()+3000;
 while(!state.closed){if(Date.now()>=deadline)throw failure('WORKSPACE_V2_RETIREMENT_ATTACH_UNCONFIRMED');await new Promise(resolve=>setTimeout(resolve,25));}
 if(!state.socket?.destroyed)throw failure('WORKSPACE_V2_RETIREMENT_ATTACH_UNCONFIRMED');
 active.delete(containerId);return {currentManagerAttachment:true,closed:true};
}
