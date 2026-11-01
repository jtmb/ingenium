/** Manager-side original I/O observation. Metadata is never an execution grant.
 * No caller-selected socket, process, source file, callback or Docker operation. */
import {constants,openSync,closeSync,fstatSync,lstatSync,readFileSync,readSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {request as httpRequest,ClientRequest,IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {parseStrictJobJson} from './job-bootstrap-frame.mjs';
const originals=new WeakMap(),executableDigests=new Map(),SOCKET='/var/run/docker.sock';
const fail=code=>{throw Object.assign(Error(code),{code,status:503})};
const stable=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs','uid','mode','nlink'].every(k=>a[k]===b[k]);
function file(file,maximum,{cache=false}={}){
 if(realpathSync(file)!==file)fail('MANAGER_PROCESS_SOURCE_ALIAS');
 const named=lstatSync(file),fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=fstatSync(fd);
  if(!stable(named,before)||!before.isFile()||before.nlink!==1||(before.mode&0o022)!==0||![0,process.getuid()].includes(before.uid)||before.size<1||before.size>maximum)fail('MANAGER_PROCESS_SOURCE_UNSAFE');
  const key=JSON.stringify([file,before.dev,before.ino,before.size,before.mtimeMs,before.ctimeMs]);let sha256=cache?executableDigests.get(key):null;
  if(!sha256){const digest=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let bytes=0,n;while((n=readSync(fd,buffer,0,buffer.length,null))!==0){bytes+=n;digest.update(buffer.subarray(0,n))}if(bytes!==before.size)fail('MANAGER_PROCESS_SOURCE_CHANGED');sha256=digest.digest('hex')}
  const after=fstatSync(fd),current=lstatSync(file);if(!stable(before,after)||!stable(before,current)||realpathSync(file)!==file)fail('MANAGER_PROCESS_SOURCE_CHANGED');
  if(cache){executableDigests.clear();executableDigests.set(key,sha256)}
  return {path:file,stat:before,sha256};
 }finally{closeSync(fd)}
}
function kernel(){
 if(process.platform!=='linux'||typeof process.getuid!=='function')fail('MANAGER_PROCESS_PLATFORM_UNAVAILABLE');
 const base='/proc/'+process.pid,stat=readFileSync(base+'/stat','utf8'),tail=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/),start=tail[19];
 if(!/^[0-9]+$/.test(start??''))fail('MANAGER_PROCESS_START_UNAVAILABLE');
 const argv=readFileSync(base+'/cmdline').toString('utf8').split('\0').filter(Boolean);let at=1;
 while(argv[at]==='--enable-source-maps')at++;
 if(argv.length!==at+1||!argv[at]?.endsWith('/services/ingenium-api/dist/scripts/runtime-manager.js'))fail('MANAGER_PROCESS_ENTRY_UNAVAILABLE');
 const executable=realpathSync(base+'/exe'),entry=realpathSync(argv[at]);
 if(realpathSync(argv[0])!==executable||entry!==argv[at])fail('MANAGER_PROCESS_ENTRY_CHANGED');
 return {pid:process.pid,uid:process.getuid(),start,executable,entry};
}
function socketIdentity(){const named=lstatSync(SOCKET),target=realpathSync(SOCKET),actual=lstatSync(target);if(!actual.isSocket())fail('MANAGER_BACKEND_SOCKET_UNAVAILABLE');return {named,target,actual};}
function sameSocket(before){const now=socketIdentity();if(now.target!==before.target||!stable(now.named,before.named)||!stable(now.actual,before.actual))fail('MANAGER_BACKEND_SOCKET_CHANGED');}
async function originalBackend(){
 const named=socketIdentity();
 return await new Promise((resolve,reject)=>{
  let request,response,socket,timer,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){response?.destroy();request?.destroy();reject(error)}else resolve(value)};
  timer=setTimeout(()=>finish(Object.assign(Error('MANAGER_BACKEND_OBSERVATION_DEADLINE'),{code:'MANAGER_BACKEND_OBSERVATION_DEADLINE'})),5000);
  request=httpRequest({socketPath:SOCKET,path:'/v1.45/info',method:'GET',headers:{Accept:'application/json','Accept-Encoding':'identity',Connection:'close'}},res=>{
   response=res;const chunks=[];let bytes=0;
   if(!(request instanceof ClientRequest)||!(res instanceof IncomingMessage)||!(socket instanceof Socket)||res.socket!==socket||res.statusCode!==200||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){finish(Error('MANAGER_BACKEND_ORIGINAL_UNAVAILABLE'));return}
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024){finish(Error('MANAGER_BACKEND_OBSERVATION_TOO_LARGE'));return}chunks.push(chunk)});
   res.once('error',error=>finish(error));res.once('aborted',()=>finish(Error('MANAGER_BACKEND_OBSERVATION_ABORTED')));
   res.once('end',()=>{try{
    if(!res.complete||res.aborted)fail('MANAGER_BACKEND_OBSERVATION_INCOMPLETE');sameSocket(named);
    const body=parseStrictJobJson(Buffer.concat(chunks),1024*1024),daemonId=body?.ID;
    if(typeof daemonId!=='string'||daemonId.length<1||daemonId.length>256||/[\u0000-\u001f\u007f]/.test(daemonId))fail('MANAGER_BACKEND_IDENTITY_UNAVAILABLE');
    finish(null,{daemonId,request,response:res,socket,named});
   }catch(error){finish(error)}});
  });
  request.once('socket',value=>{socket=value});request.once('error',error=>finish(error));request.end();
 });
}
function validate(s){
 const now=kernel();if(now.pid!==s.kernel.pid||now.uid!==s.kernel.uid||now.start!==s.kernel.start||now.entry!==s.kernel.entry||now.executable!==s.kernel.executable||Date.now()>s.expiresAt)fail('MANAGER_PROCESS_ORIGINAL_EXPIRED');
 const entry=file(now.entry,4*1024*1024),exe=file(now.executable,256*1024*1024,{cache:true});
 if(!stable(entry.stat,s.entry.stat)||!stable(exe.stat,s.exe.stat)||entry.sha256!==s.entry.sha256||exe.sha256!==s.exe.sha256)fail('MANAGER_PROCESS_ORIGINAL_CHANGED');
 sameSocket(s.backend.named);
 if(!(s.backend.request instanceof ClientRequest)||!(s.backend.response instanceof IncomingMessage)||!(s.backend.socket instanceof Socket)||!s.backend.response.complete||s.backend.response.aborted)fail('MANAGER_BACKEND_ORIGINAL_UNAVAILABLE');
}
/** Only the genuine installed manager entrypoint can capture this source. */
export async function captureOriginalManagerProcessSource(){
 if(arguments.length!==0)fail('MANAGER_PROCESS_CALLER_INPUT_REFUSED');
 const observedAt=Date.now(),current=kernel(),entry=file(current.entry,4*1024*1024),exe=file(current.executable,256*1024*1024,{cache:true});
 const backend=await originalBackend(),handle=Object.freeze({}),state={kernel:current,entry,exe,backend,observedAt,expiresAt:observedAt+5000};validate(state);originals.set(handle,state);return handle;
}
/** The returned fields describe original I/O. Consumers must separately verify
 * source/image approval, private channel custody and the canonical operation. */
export function readOriginalManagerProcessSource(handle){
 const state=originals.get(handle);if(!state)fail('MANAGER_PROCESS_ORIGINAL_REQUIRED');validate(state);
 return Object.freeze({schemaVersion:1,kind:'original-manager-process-source',pid:state.kernel.pid,uid:state.kernel.uid,startIdentity:state.kernel.start,
  entrySha256:state.entry.sha256,executableSha256:state.exe.sha256,nodeVersion:process.versions.node,daemonId:state.backend.daemonId,observedAt:state.observedAt,expiresAt:state.expiresAt});
}