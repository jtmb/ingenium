import {requireOriginalCandidateControlContext} from './candidate-control-context.mjs';
/** Fixed original manager transport/process identity. Metadata alone never
 * creates this handle or grants a Core/image operation. */
import {ClientRequest,IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {openOriginalManagerConnection,readOriginalManagerConnection,closeOriginalManagerConnection,createOriginalManagerCandidateRequest,readOriginalManagerCandidateRequest,refreshOriginalManagerCandidateRequest} from './manager-connection-source.mjs';
import {assertCandidateObservationFacts} from './candidate-manager-http.mjs';
const originals=new WeakMap();
const fail=code=>{throw Object.assign(Error(code),{code,status:503})};
const need=(v,code='ORIGINAL_MANAGER_SOURCE_PROCESS_BACKEND_UNAVAILABLE')=>{if(!v)fail(code)};
function original(identity){const s=originals.get(identity);need(s&&!s.closed);return s}
export async function requireOriginalCandidateManagerRpcIdentity(){
 need(arguments.length===0,'ORIGINAL_MANAGER_CALLER_INPUT_REFUSED');const connection=await openOriginalManagerConnection();
 try{readOriginalManagerConnection(connection);const handle=Object.freeze({});originals.set(handle,{connection,origin:new URL(process.env.INGENIUM_RUNTIME_MANAGER_URL.trim()).origin,request:null,response:null,socket:null,promise:null,closed:false});return handle}catch(error){closeOriginalManagerConnection(connection);throw error}
}
export function createOriginalCandidateManagerRpcRequest(identity,runId,input){
 const s=original(identity);need(!s.request);const request=createOriginalManagerCandidateRequest(s.connection,runId,input);s.request=request;
 request.once('socket',socket=>s.socket=socket);request.once('response',response=>s.response=response);return request;
}
export function assertOriginalCandidateManagerRpcIdentity(identity,channel){
 const s=original(identity);need(channel&&channel.origin===s.origin&&channel.request===s.request&&channel.request instanceof ClientRequest&&channel.socket===s.socket&&s.socket instanceof Socket&&channel.request.socket===s.socket&&channel.response===s.response&&(!s.response||s.response instanceof IncomingMessage)&&channel.pending instanceof Promise);
 if(s.promise===null)s.promise=channel.pending;need(s.promise===channel.pending);readOriginalManagerCandidateRequest(s.connection,s.request);
}
export function refreshOriginalCandidateManagerRpcIdentity(identity,encoded){const s=original(identity);return refreshOriginalManagerCandidateRequest(s.connection,s.request,encoded)}
export function closeOriginalCandidateManagerRpcIdentity(identity){const s=originals.get(identity);need(s);if(!s.closed){s.closed=true;closeOriginalManagerConnection(s.connection)}}
/** Strict DATA verifier; no caller callback can qualify arbitrary facts. */
export function requireOriginalCandidateRpcFacts(observation,operation,snapshot){assertCandidateObservationFacts(observation,operation,snapshot,Date.now())}
/** Negative cancellation only. The caller additionally binds this to its SAME
 * retained opaque Core preparation; this never grants new execution or proof. */
export function requireOriginalCandidateRpcWithdrawalControl(control,binding){return requireOriginalCandidateControlContext(control,binding)}
