/** API-side fixed manager connection observation. This handle is transport
 * custody only; it grants no Core operation, image approval or execution. */
import {Agent,ClientRequest,IncomingMessage,request as httpRequest} from 'node:http';
import {Socket} from 'node:net';
import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readSync} from 'node:fs';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadManagerToken} from '../runtime-manager-auth.js';
import {parseStrictJobJson} from './job-bootstrap-frame.mjs';
import {MANAGER_ORIGINAL_CONNECTION_PATH} from './manager-peer-source.mjs';
const originals=new WeakMap(),digests=new Map();
const fail=code=>{throw Object.assign(Error(code),{code,status:503})};
const need=(value,code='MANAGER_CONNECTION_ORIGINAL_REQUIRED')=>{if(!value)fail(code)};
const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
const stable=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs','uid','mode','nlink'].every(k=>a[k]===b[k]);
function endpoint(){const raw=process.env.INGENIUM_RUNTIME_MANAGER_URL?.trim();need(raw,'MANAGER_CONNECTION_NOT_CONFIGURED');const url=new URL(raw);need(url.protocol==='http:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash&&/^[a-z0-9][a-z0-9.-]*$/i.test(url.hostname),'MANAGER_CONNECTION_URL_INVALID');return url}
function token(){const path=process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE?.trim();need(path,'MANAGER_CONNECTION_NOT_CONFIGURED');const before=lstatSync(path),value=loadManagerToken(),after=lstatSync(path);need(stable(before,after)&&realpathSync(path)===path,'MANAGER_CONNECTION_TOKEN_CHANGED');return {path,stat:after,value}}
function file(path,maximum){
 need(realpathSync(path)===path,'MANAGER_CONNECTION_FILE_ALIAS');const named=lstatSync(path),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=fstatSync(fd);need(stable(named,before)&&before.isFile()&&before.nlink===1&&(before.mode&0o022)===0&&[0,process.getuid()].includes(before.uid)&&before.size>0&&before.size<=maximum,'MANAGER_CONNECTION_FILE_UNSAFE');
 const key=JSON.stringify([path,before.dev,before.ino,before.size,before.mtimeMs,before.ctimeMs]);let hash=digests.get(key);if(!hash){const digest=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let n,total=0;while((n=readSync(fd,buffer,0,buffer.length,null))!==0){total+=n;digest.update(buffer.subarray(0,n))}need(total===before.size);hash=digest.digest('hex');if(digests.size>4)digests.clear();digests.set(key,hash)}need(stable(before,fstatSync(fd))&&stable(before,lstatSync(path))&&realpathSync(path)===path,'MANAGER_CONNECTION_FILE_CHANGED');return {path,stat:before,hash};}finally{closeSync(fd)}
}
function sourceFiles(){need(process.platform==='linux'&&typeof process.getuid==='function','MANAGER_CONNECTION_PLATFORM_UNAVAILABLE');return {entry:file(fileURLToPath(new URL('../../scripts/runtime-manager.js',import.meta.url)),4*1024*1024),executable:file(realpathSync('/proc/self/exe'),256*1024*1024)}}
function invalidate(s){if(s.closed)return;s.closed=true;clearTimeout(s.timer);s.challenge?.fill(0);s.agent.destroy();s.token=null}
function current(handle,fresh=true){const s=originals.get(handle);need(s&&!s.closed&&s.socket instanceof Socket&&!s.socket.destroyed&&(!s.candidate||Date.now()<s.candidate.deadline)&&(!fresh||Date.now()<s.source.expiresAt),'MANAGER_CONNECTION_ORIGINAL_EXPIRED');
 try{const auth=token(),files=sourceFiles();need(endpoint().href===s.origin&&auth.path===s.token.path&&stable(auth.stat,s.token.stat)&&same(auth.value,s.token.value)&&files.entry.hash===s.files.entry.hash&&stable(files.entry.stat,s.files.entry.stat)&&files.executable.hash===s.files.executable.hash&&stable(files.executable.stat,s.files.executable.stat),'MANAGER_CONNECTION_ORIGINAL_CHANGED');return s}catch(error){invalidate(s);throw error}}
/** No arguments and no caller-selected endpoint, credential or positive source. */
export async function openOriginalManagerConnection(){
 need(arguments.length===0,'MANAGER_CONNECTION_CALLER_INPUT_REFUSED');const base=endpoint(),auth=token(),files=sourceFiles(),challenge=randomBytes(32),agent=new Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1}),s={origin:base.href,token:auth,files,challenge,agent,closed:false};
 try{return await new Promise((resolve,reject)=>{let settled=false,response,socket,request;const chunks=[];let bytes=0;
 const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(s.timer);if(error){invalidate(s);response?.destroy();request?.destroy();reject(error)}else resolve(value)};
 s.timer=setTimeout(()=>finish(Error('MANAGER_CONNECTION_OBSERVATION_DEADLINE')),5000);s.timer.unref?.();
 request=httpRequest(new URL(MANAGER_ORIGINAL_CONNECTION_PATH,base),{method:'POST',agent,headers:{Authorization:'Bearer '+auth.value,Accept:'application/json','Content-Type':'application/json','Accept-Encoding':'identity'}},res=>{
 response=res;if(!(request instanceof ClientRequest)||!(res instanceof IncomingMessage)||!(socket instanceof Socket)||res.socket!==socket||res.statusCode!==200||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){finish(Error('MANAGER_CONNECTION_RESPONSE_INVALID'));return}
 res.on('data',b=>{bytes+=b.length;if(bytes>16384){finish(Error('MANAGER_CONNECTION_RESPONSE_LIMIT'));return}chunks.push(b)});res.once('error',error=>finish(error));res.once('aborted',()=>finish(Error('MANAGER_CONNECTION_RESPONSE_ABORTED')));
 res.once('end',()=>{try{
 need(res.complete&&!res.aborted);const envelope=parseStrictJobJson(Buffer.concat(chunks),16384);need(envelope&&Object.keys(envelope).join(',')==='data');const packet=envelope.data;need(packet&&Object.keys(packet).sort().join('|')==='challenge|connectionId|kind|mac|schemaVersion|source'&&packet.schemaVersion===1&&packet.kind==='original-manager-connection'&&packet.challenge===challenge.toString('hex')&&/^[a-f0-9]{64}$/.test(packet.connectionId)&&/^[a-f0-9]{64}$/.test(packet.mac));
 const {mac,...covered}=packet,expected=createHmac('sha256',auth.value).update('veyra-manager-original-connection-v1\0').update(JSON.stringify(covered)).digest('hex');need(same(mac,expected),'MANAGER_CONNECTION_AUTHENTICATION_FAILED');
 const source=packet.source;need(source&&Object.keys(source).sort().join('|')==='daemonId|entrySha256|executableSha256|expiresAt|kind|nodeVersion|observedAt|pid|schemaVersion|startIdentity|uid'&&source.schemaVersion===1&&source.kind==='original-manager-process-source'&&Number.isSafeInteger(source.pid)&&source.pid>0&&Number.isSafeInteger(source.uid)&&source.uid>0&&/^[0-9]+$/.test(source.startIdentity)&&source.nodeVersion===process.versions.node&&source.entrySha256===files.entry.hash&&source.executableSha256===files.executable.hash&&typeof source.daemonId==='string'&&source.daemonId.length>0&&source.daemonId.length<=256&&!/[\u0000-\u001f\u007f]/.test(source.daemonId),'MANAGER_CONNECTION_SOURCE_MISMATCH');
 need(Number.isSafeInteger(source.observedAt)&&Number.isSafeInteger(source.expiresAt)&&source.observedAt<=Date.now()&&source.expiresAt>Date.now()&&source.expiresAt-source.observedAt===5000,'MANAGER_CONNECTION_SOURCE_EXPIRED');
 Object.assign(s,{request,response:res,socket,source:Object.freeze({...source}),connectionId:packet.connectionId});const handle=Object.freeze({});originals.set(handle,s);current(handle);socket.once('close',()=>invalidate(s));finish(null,handle);s.timer=setTimeout(()=>invalidate(s),Math.max(1,source.expiresAt-Date.now()));s.timer.unref?.();
 }catch(error){finish(error)}});
 });request.once('socket',value=>socket=value);request.once('error',error=>finish(error));request.end(JSON.stringify({challenge:challenge.toString('hex')}));
 })}catch(error){invalidate(s);throw error}
}
export function readOriginalManagerConnection(handle){const s=current(handle);return Object.freeze({...s.source,connectionId:s.connectionId})}
export function closeOriginalManagerConnection(handle){const s=originals.get(handle);need(s);invalidate(s)}

/** One fixed outgoing candidate transport on the SAME originally challenged
 * connection. Input is DATA only; original Core prepare/image/context and phase
 * constructors remain separate required authorities. Never retries or redirects. */
export function createOriginalManagerCandidateRequest(handle,runId,input){
 const s=current(handle),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,hex=/^[a-f0-9]{64}$/;
 need(!s.candidate&&typeof runId==='string'&&uuid.test(runId),'MANAGER_CANDIDATE_CONNECTION_ALREADY_USED');
 need(input&&typeof input==='object'&&!Array.isArray(input)&&[Object.prototype,null].includes(Object.getPrototypeOf(input))&&Reflect.ownKeys(input).every(k=>typeof k==='string')&&Object.keys(input).sort().join('|')==='attemptId|challenge|deadlineAt|intentHash|runId|selectionSha256|specHash'&&Object.values(Object.getOwnPropertyDescriptors(input)).every(d=>Object.hasOwn(d,'value')&&d.enumerable),'MANAGER_CANDIDATE_REQUEST_SHAPE');
 need(input.runId===runId&&typeof input.attemptId==='string'&&uuid.test(input.attemptId)&&['challenge','intentHash','specHash','selectionSha256'].every(k=>typeof input[k]==='string'&&hex.test(input[k])),'MANAGER_CANDIDATE_REQUEST_BINDING');
 need(typeof input.deadlineAt==='string','MANAGER_CANDIDATE_REQUEST_DEADLINE');const deadline=Date.parse(input.deadlineAt);need(Number.isSafeInteger(deadline)&&new Date(deadline).toISOString()===input.deadlineAt&&deadline>Date.now()&&deadline-Date.now()<=120000,'MANAGER_CANDIDATE_REQUEST_DEADLINE');
 const payload=Buffer.from(JSON.stringify(input)),url=new URL('/v1/candidate-job-runs/'+runId+'/launch',s.origin);need(payload.length<=65536);
 const request=httpRequest(url,{method:'POST',agent:s.agent,headers:{Authorization:'Bearer '+s.token.value,Accept:'application/json','Accept-Encoding':'identity','Content-Type':'application/json','Content-Length':payload.length}});
 s.candidate={request,response:null,runId,path:url.pathname,host:url.host,deadline,payloadBytes:payload.length,bodySha256:createHash('sha256').update(payload).digest('hex'),sent:false};
 request.once('socket',socket=>{try{current(handle);need(socket===s.socket&&request.agent===s.agent&&!socket.destroyed,'MANAGER_CANDIDATE_ORIGINAL_SOCKET_CHANGED');need(request.method==='POST'&&request.path===s.candidate.path&&String(request.getHeader('host'))===s.candidate.host&&same(String(request.getHeader('authorization')),'Bearer '+s.token.value)&&String(request.getHeader('content-length'))===String(payload.length)&&request.getHeader('cookie')===undefined&&request.getHeader('origin')===undefined&&request.getHeader('transfer-encoding')===undefined,'MANAGER_CANDIDATE_ORIGINAL_HEADERS_CHANGED');s.candidate.sent=true;request.end(payload)}catch(error){request.destroy(error);invalidate(s)}});
 request.once('response',response=>{s.candidate.response=response;if(!(response instanceof IncomingMessage)||response.socket!==s.socket){response.destroy();invalidate(s);return}response.once('end',()=>invalidate(s));response.once('aborted',()=>invalidate(s));response.once('error',()=>invalidate(s));response.once('close',()=>{if(!response.complete)invalidate(s)})});
 // The immutable original request deadline owns transport lifetime. Fresh source
 // observations retain their separate five-second validity; no packet renews
 // this timer or revives a closed socket/session.
 clearTimeout(s.timer);s.timer=setTimeout(()=>{invalidate(s);request.destroy(Error('MANAGER_CANDIDATE_ORIGINAL_DEADLINE'))},Math.max(1,deadline-Date.now()));s.timer.unref?.();
 request.once('error',()=>invalidate(s));request.setTimeout(Math.max(1,deadline-Date.now()),()=>request.destroy(Error('MANAGER_CANDIDATE_ORIGINAL_TIMEOUT')));return request;
}
function candidatePending(handle,request,fresh=true){
 const s=current(handle,fresh),c=s.candidate;need(c&&c.request===request&&request instanceof ClientRequest&&request.agent===s.agent&&request.socket===s.socket&&c.sent&&!request.destroyed&&!s.socket.destroyed&&Date.now()<c.deadline&&!c.response?.complete&&!c.response?.aborted&&(!c.response||c.response.statusCode===200),'MANAGER_CANDIDATE_ORIGINAL_NOT_PENDING');
 return s;
}
/** Only a still-pending original request can receive a fresh, independently
 * signed observation from its same originally challenged manager connection.
 * This proves transport/process custody; Core/image permission stays separate. */
export function refreshOriginalManagerCandidateRequest(handle,request,encoded){
 const s=candidatePending(handle,request,false),c=s.candidate;
 try{
 need(typeof encoded==='string'&&encoded.length>0&&encoded.length<=16384&&/^[A-Za-z0-9_-]+$/.test(encoded),'MANAGER_CANDIDATE_CONTINUATION_ENCODING');
 const bytes=Buffer.from(encoded,'base64url');need(bytes.toString('base64url')===encoded,'MANAGER_CANDIDATE_CONTINUATION_ENCODING');
 const packet=parseStrictJobJson(bytes,12288);need(packet&&Object.keys(packet).sort().join('|')==='challenge|connectionId|kind|mac|request|schemaVersion|source'&&packet.schemaVersion===1&&packet.kind==='original-manager-pending-source'&&packet.challenge===s.challenge.toString('hex')&&packet.connectionId===s.connectionId&&typeof packet.mac==='string'&&/^[a-f0-9]{64}$/.test(packet.mac),'MANAGER_CANDIDATE_CONTINUATION_BINDING');
 const {mac,...covered}=packet,expected=createHmac('sha256',s.token.value).update('veyra-manager-original-pending-source-v1\0').update(JSON.stringify(covered)).digest('hex');need(same(mac,expected),'MANAGER_CANDIDATE_CONTINUATION_AUTHENTICATION');
 const r=packet.request;need(r&&Object.keys(r).sort().join('|')==='bodySha256|method|path'&&r.method==='POST'&&r.path===c.path&&r.bodySha256===c.bodySha256,'MANAGER_CANDIDATE_CONTINUATION_REQUEST');
 const source=packet.source;need(source&&Object.keys(source).sort().join('|')==='daemonId|entrySha256|executableSha256|expiresAt|kind|nodeVersion|observedAt|pid|schemaVersion|startIdentity|uid'&&source.schemaVersion===1&&source.kind==='original-manager-process-source'&&['pid','uid','startIdentity','entrySha256','executableSha256','nodeVersion','daemonId'].every(k=>source[k]===s.source[k]),'MANAGER_CANDIDATE_CONTINUATION_SOURCE');
 const now=Date.now();need(Number.isSafeInteger(source.observedAt)&&Number.isSafeInteger(source.expiresAt)&&source.observedAt>=s.source.observedAt&&source.observedAt<=now&&now<source.expiresAt&&source.expiresAt-source.observedAt===5000&&mac!==s.continuationMac,'MANAGER_CANDIDATE_CONTINUATION_EXPIRED');
 candidatePending(handle,request,false);s.source=Object.freeze({...source});s.continuationMac=mac;return readOriginalManagerCandidateRequest(handle,request);
 }catch(error){invalidate(s);throw error}
}
/** Fresh source plus original pending Node request; copied metadata is DATA. */
export function readOriginalManagerCandidateRequest(handle,request){
 const s=candidatePending(handle,request),c=s.candidate;
 return Object.freeze({...s.source,connectionId:s.connectionId,runId:c.runId,requestBodySha256:c.bodySha256,deadlineAt:new Date(c.deadline).toISOString()});
}
