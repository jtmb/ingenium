/** Private original-connection owner in the actual manager process. No metadata
 * envelope can reconstruct its socket/request/response custody. */
import {Server,IncomingMessage,ServerResponse} from 'node:http';
import {Socket} from 'node:net';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {captureOriginalManagerProcessSource,readOriginalManagerProcessSource} from './manager-process-source.mjs';
export const MANAGER_ORIGINAL_CONNECTION_PATH='/v1/manager-original/connection';
const originalDelegations=new WeakMap();
const fail=code=>{throw Object.assign(Error(code),{code,status:503})};
const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
export function createOriginalManagerPeerOwner(server,token){
 if(arguments.length!==2||!(server instanceof Server)||typeof token!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(token))fail('MANAGER_PEER_OWNER_REQUIRED');
 const bodies=new WeakMap(),challenges=new WeakSet(),connections=new WeakSet(),peers=new WeakMap(),delegations=new WeakMap(),active=new Set();let closed=false;
 const invalidate=s=>{clearTimeout(s.timer);if(s.handle){originalDelegations.delete(s.handle);delegations.delete(s.handle)}s.closed=true;s.connectionId.fill(0);peers.delete(s.socket);active.delete(s)};
 server.on('connection',socket=>{if(socket instanceof Socket)connections.add(socket)});
 server.once('close',()=>{closed=true;for(const s of active)invalidate(s)});
 // Observe original raw Node input before the manager's strict body reader.
 // No body/bytes supplied by a caller can populate this private request map.
 server.prependListener('request',(req,res)=>{
  if(!(req instanceof IncomingMessage)||!(res instanceof ServerResponse)||res.req!==req||!connections.has(req.socket)||req.method!=='POST'||!/^\/v1\/candidate-job-runs\/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/launch$/i.test(req.url??'')||typeof req.headers.authorization!=='string'||!same(req.headers.authorization,'Bearer '+token)||req.headers.cookie!==undefined||req.headers.origin!==undefined)return;
  const observed={digest:createHash('sha256'),bytes:0,ended:false,invalid:false};bodies.set(req,observed);
  req.on('data',chunk=>{if(observed.invalid)return;const b=Buffer.from(chunk);observed.bytes+=b.length;if(observed.bytes>65536){observed.invalid=true;return}observed.digest.update(b)});
  req.once('end',()=>{if(!observed.invalid){observed.hash=observed.digest.digest('hex');observed.ended=true}});req.once('aborted',()=>observed.invalid=true);req.once('error',()=>observed.invalid=true);
 });

 function request(req,res){
  if(closed||!server.listening||!(req instanceof IncomingMessage)||!(res instanceof ServerResponse)||res.req!==req||!(req.socket instanceof Socket)||!connections.has(req.socket)||res.socket!==req.socket||req.socket.destroyed||req.aborted||!req.complete||res.writableEnded||res.destroyed||req.headers.cookie!==undefined||req.headers.origin!==undefined)fail('MANAGER_PEER_ORIGINAL_REQUIRED');
  const header=req.headers.authorization;if(typeof header!=='string'||!same(header,'Bearer '+token))fail('MANAGER_PEER_AUTHENTICATION_REQUIRED');
 }
 function pending(handle){const s=delegations.get(handle);if(!s||s.closed||peers.get(s.socket)!==s||!s.pending)fail('MANAGER_PEER_DELEGATION_REQUIRED');request(s.request,s.response);return s}
 const owner=Object.freeze({
  async challenge(req,res,input){
   request(req,res);if(req.method!=='POST'||req.url!==MANAGER_ORIGINAL_CONNECTION_PATH||peers.has(req.socket)||challenges.has(req.socket)||active.size>=256||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).join(',')!=='challenge'||typeof input.challenge!=='string'||!/^[a-f0-9]{64}$/.test(input.challenge))fail('MANAGER_PEER_CHALLENGE_INVALID');
   challenges.add(req.socket);try{
   const source=await captureOriginalManagerProcessSource(),facts=readOriginalManagerProcessSource(source);request(req,res);
   const state={socket:req.socket,source,facts,connectionId:randomBytes(32),challenge:input.challenge,closed:false,pending:false};
   const packet={schemaVersion:1,kind:'original-manager-connection',challenge:input.challenge,connectionId:state.connectionId.toString('hex'),source:facts};
   const mac=createHmac('sha256',token).update('veyra-manager-original-connection-v1\0').update(JSON.stringify(packet)).digest('hex');
   peers.set(req.socket,state);active.add(state);req.socket.once('close',()=>invalidate(state));
   state.timer=setTimeout(()=>invalidate(state),Math.max(1,facts.expiresAt-Date.now()));state.timer.unref?.();
   return Object.freeze({...packet,mac});
   }finally{challenges.delete(req.socket)}
  },
  begin(req,res){
   request(req,res);const observed=bodies.get(req);if(req.method!=='POST'||!/^\/v1\/candidate-job-runs\/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/launch$/i.test(req.url??'')||req.headers['content-type']!=='application/json'||req.headers['transfer-encoding']!==undefined||req.headers['content-encoding']!==undefined||!observed?.ended||observed.invalid||observed.bytes<1||String(req.headers['content-length'])!==String(observed.bytes))fail('MANAGER_PEER_ORIGINAL_BODY_REQUIRED');const s=peers.get(req.socket);if(!s||s.closed||s.pending||Date.now()>s.facts.expiresAt)fail('MANAGER_PEER_CONNECTION_REQUIRED');
   // The same authenticated physical connection must carry the pending launch.
   readOriginalManagerProcessSource(s.source);clearTimeout(s.timer);s.pending=true;s.request=req;s.response=res;const handle=Object.freeze({});delegations.set(handle,s);s.handle=handle;s.bodySha256=observed.hash;originalDelegations.set(handle,{owner,request:req,response:res});
   res.once('close',()=>invalidate(s));res.once('finish',()=>invalidate(s));return handle;
  },
  assertPending(handle){pending(handle)},
  async refresh(handle){
   const s=pending(handle);try{const source=await captureOriginalManagerProcessSource(),facts=readOriginalManagerProcessSource(source);pending(handle);
   for(const key of ['pid','uid','startIdentity','entrySha256','executableSha256','nodeVersion','daemonId'])if(facts[key]!==s.facts[key]){invalidate(s);fail('MANAGER_PEER_SOURCE_CHANGED')}
   s.source=source;s.facts=facts;return Object.freeze({...facts,connectionId:s.connectionId.toString('hex')});
   }catch(error){invalidate(s);throw error}
  },
  async continuation(handle){
   const s=pending(handle),{connectionId,...source}=await owner.refresh(handle);pending(handle);
   const packet={schemaVersion:1,kind:'original-manager-pending-source',connectionId,challenge:s.challenge,source,request:{method:s.request.method,path:s.request.url,bodySha256:s.bodySha256}};
   const mac=createHmac('sha256',token).update('veyra-manager-original-pending-source-v1\0').update(JSON.stringify(packet)).digest('hex');return Object.freeze({...packet,mac});
  },
  inspect(handle){const s=pending(handle);try{const facts=readOriginalManagerProcessSource(s.source);return Object.freeze({...facts,connectionId:s.connectionId.toString('hex')})}catch(error){invalidate(s);throw error}},
 });
 return owner;
}
/** Fixed original server ownership only; no caller can register a delegation. */
export function assertOriginalManagerDelegation(handle,request,response){const state=originalDelegations.get(handle);if(!state||state.request!==request||state.response!==response)fail('MANAGER_PEER_DELEGATION_REQUIRED');state.owner.assertPending(handle)}
export async function captureOriginalManagerContinuation(handle){const state=originalDelegations.get(handle);if(!state)fail('MANAGER_PEER_DELEGATION_REQUIRED');return await state.owner.continuation(handle)}
