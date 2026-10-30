// SOURCE proposal. Fixed private manager route; verified JSON remains DATA.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {loadManagerToken} from '../runtime-manager-auth.js';
import {withPersistedOriginalCandidateOperation} from './dot-original-context.js';
import {parseStrictJobJson} from './job-bootstrap-frame.mjs';
import {hash} from '../../../../packages/veyra-operations/core126-image-contract.mjs';
const prefix='/api/v1/internal/original-candidate-job-runs',bodies=new WeakMap();
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),integer=v=>Number.isSafeInteger(v)&&v>=0;
const fail=(code,status=422)=>{throw Object.assign(Error(code),{code,status});};
const need=(v,code='CANDIDATE_MANAGER_INPUT_INVALID',status=422)=>{if(!v)fail(code,status);};
function exact(v,names){need(v&&typeof v==='object'&&!Array.isArray(v));const keys=Reflect.ownKeys(v);need(keys.every(k=>typeof k==='string')&&keys.sort().join('|')===[...names].sort().join('|')&&Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>Object.hasOwn(d,'value')&&d.enumerable));}
/** express.json verify hook only; bounded original bytes, never auth/authority. */
export function captureOriginalCandidateManagerBody(request,bytes){if(request.path!==prefix&&!request.path?.startsWith(prefix+'/'))return;need(Buffer.isBuffer(bytes)&&bytes.length<=65536);bodies.set(request,Buffer.from(bytes));}
export function readOriginalCandidateManagerBody(request){const value=bodies.get(request);return value?Buffer.from(value):undefined;}
function authenticate(request){
 const h=request.headers??{};need(!['cookie','origin','x-ingenium-internal-service','x-ingenium-audience','x-ingenium-job-attempt','transfer-encoding','content-encoding'].some(k=>h[k]!==undefined),'CANDIDATE_MANAGER_AUTH_REQUIRED',401);
 let token;try{token=loadManagerToken();}catch{fail('CANDIDATE_MANAGER_TOKEN_OWNER_UNAVAILABLE',503);}const header=h.authorization;need(typeof token==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(token)&&typeof header==='string'&&header.startsWith('Bearer '),'CANDIDATE_MANAGER_AUTH_REQUIRED',401);
 const left=Buffer.from(header.slice(7)),right=Buffer.from(token);need(left.length===right.length&&timingSafeEqual(left,right),'CANDIDATE_MANAGER_AUTH_REQUIRED',401);return token;
}
function originalBody(request){need(request.headers?.['content-type']==='application/json');need(Buffer.isBuffer(request.originalCandidateBody),'CANDIDATE_MANAGER_ORIGINAL_BODY_UNAVAILABLE',503);need(request.originalCandidateBody.length<=65536);try{return parseStrictJobJson(request.originalCandidateBody,65536);}catch{fail('CANDIDATE_MANAGER_JSON_INVALID');}}
const readyKeys=['schemaVersion','kind','runId','attemptId','candidateIntentHash','specHash','containerId','childBirthHash','childStartHash','daemonId','imageId','catalogSha256','artifactClosureSha256','selectionSha256','attachIdentityHash','trapAddress','proxyAddress','pid','networkMode','tty','observedAt','expiresAt'];
function envelope(body,token,operation,state,now){
 exact(body,['custodyId','observation','signature']);const o=body.observation,b=state.binding;
 exact(o,['schemaVersion','domain','kind','custodyId','runId','attemptId','candidateIntentHash','specHash','selectionSha256','containerId','daemonId','childBirthHash','childStartHash','attachIdentityHash','deadlineAt','expectedRevision','observedAt','expiresAt','facts']);
 need(hex(body.custodyId)&&body.custodyId===o.custodyId&&hex(body.signature),'CANDIDATE_MANAGER_CUSTODY_MISMATCH',403);
 need(o.schemaVersion===1&&o.domain==='candidate-observation-v1'&&o.kind==='original-candidate-'+operation+'-v1');
 const key=createHmac('sha256',token).update('candidate-observation-v1/key\0').digest(),mac=createHmac('sha256',key).update('candidate-observation-v1/payload\0').update(hash(o)).digest();need(timingSafeEqual(mac,Buffer.from(body.signature,'hex')),'CANDIDATE_MANAGER_MAC_INVALID',403);
 need(['runId','attemptId','candidateIntentHash','specHash','selectionSha256','daemonId','deadlineAt'].every(k=>o[k]===b[k]),'CANDIDATE_MANAGER_ORIGINAL_CHANGED',409);
 need(integer(o.expectedRevision)&&o.expectedRevision===state.revision,'CANDIDATE_MANAGER_REVISION_CHANGED',409);
 need(integer(o.observedAt)&&integer(o.expiresAt)&&o.observedAt<=now&&now<o.expiresAt&&o.expiresAt-o.observedAt<=5000&&o.expiresAt>o.observedAt&&o.expiresAt<=b.deadlineMs&&now<b.deadlineMs,'CANDIDATE_MANAGER_OBSERVATION_EXPIRED',409);
 const phase={'create-intent':'prepared',created:'create_intent','start-intent':'created',waiting:'start_intent',ready:'waiting'}[operation];need(state.phase===phase&&!state.cancelRequested&&!state.unknown,'CANDIDATE_MANAGER_PHASE_CHANGED',409);
 for(const key of ['containerId','childBirthHash','childStartHash','attachIdentityHash']){const newlyObserved=operation==='created'&&['containerId','childBirthHash'].includes(key)||operation==='start-intent'&&key==='attachIdentityHash'||operation==='waiting'&&key==='childStartHash';if(newlyObserved)need(b[key]===null&&hex(o[key]));else need(o[key]===b[key],'CANDIDATE_MANAGER_CHILD_CHANGED',409);}
 const f=o.facts;
 if(operation==='create-intent'){exact(f,['createEffectHash']);need(hex(f.createEffectHash));}
 if(operation==='created'){exact(f,['containerId','childBirthHash','createdAtMs']);need(f.containerId===o.containerId&&f.childBirthHash===o.childBirthHash&&integer(f.createdAtMs)&&f.createdAtMs<=now&&f.createdAtMs>=Date.parse(state.intent.issuedAt));}
 if(operation==='start-intent'){exact(f,['startEffectHash','attachIdentityHash']);need(hex(f.startEffectHash)&&f.attachIdentityHash===o.attachIdentityHash);}
 if(operation==='waiting'){exact(f,['childStartHash','startedAtMs']);need(f.childStartHash===o.childStartHash&&integer(f.startedAtMs)&&f.startedAtMs<=now&&f.startedAtMs>=state.childCreatedMs);}
 if(operation==='ready'){exact(f,readyKeys);need(f.schemaVersion===1&&f.kind==='original-candidate-ready-v1'&&['runId','attemptId','candidateIntentHash','specHash','containerId','childBirthHash','childStartHash','daemonId','selectionSha256','attachIdentityHash'].every(k=>f[k]===o[k])&&f.imageId===b.imageId&&f.catalogSha256===b.catalogSha256&&f.artifactClosureSha256===b.artifactClosureSha256&&f.trapAddress==='127.0.0.1:39261'&&f.proxyAddress==='127.0.0.1:39262'&&f.networkMode==='none'&&f.tty===false&&integer(f.pid)&&f.pid>0&&integer(f.observedAt)&&integer(f.expiresAt)&&f.observedAt<=o.observedAt&&f.expiresAt>now&&f.expiresAt>f.observedAt&&f.expiresAt-f.observedAt<=5000&&f.expiresAt<=b.deadlineMs);}
 return o; // DATA only. This is intentionally NOT an opaque lifecycle handle.
}
/** Only actual factory's SAME Core owner enters here; no token/clock/context or
 * positive physical-constructor injection ports. All positive transitions CLOSED. */
export function createOriginalCandidateManagerHttp(owner){return async request=>{
 const match=/^\/internal\/original-candidate-job-runs\/([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/(admission|current|control|create-intent|created|start-intent|waiting|ready)$/.exec(request.path);if(!match)return null;
 const token=authenticate(request);need(Object.keys(request.query??{}).length===0);const runId=match[1],operation=match[2];need(request.method===(operation==='admission'?'GET':'POST'),'CANDIDATE_MANAGER_METHOD_INVALID',405);
 const body=operation==='admission'?undefined:originalBody(request);if(operation==='admission')need(request.originalCandidateBody===undefined&&(!request.body||Object.keys(request.body).length===0));
 return withPersistedOriginalCandidateOperation(runId,context=>{
  // Requires original in-memory prepare key in SAME Core/database and genuine
  // candidate context. This method does no write or row-based reconstruction.
  const state=owner.candidateOriginalManagerState(runId,{request},context),b=state.binding,now=Date.now();need(b.runId===runId);
  if(operation==='admission'){need(state.phase==='prepared'&&state.revision===0&&!state.cancelRequested&&!state.unknown&&now<b.deadlineMs,'CANDIDATE_MANAGER_PREPARE_UNAVAILABLE',503);return{data:{intent:state.intent,intentHash:b.candidateIntentHash,specHash:b.specHash,selectionSha256:b.selectionSha256,phase:state.phase,revision:state.revision}};}
  if(operation==='current'||operation==='control'){
   exact(body,['attemptId','intentHash','specHash','selectionSha256','deadlineAt',operation==='current'?'stage':'custodyId']);need(body.attemptId===b.attemptId&&body.intentHash===b.candidateIntentHash&&body.specHash===b.specHash&&body.selectionSha256===b.selectionSha256&&body.deadlineAt===b.deadlineAt,'CANDIDATE_MANAGER_ORIGINAL_CHANGED',409);
   if(operation==='current'){need(['create','attach','start','readiness'].includes(body.stage));const phases={create:['prepared'],attach:['created'],start:['created'],readiness:['waiting','ready']}[body.stage];need(phases?.includes(state.phase)&&!state.unknown&&!state.cancelRequested&&now<b.deadlineMs,'CANDIDATE_MANAGER_CURRENT_UNAVAILABLE',503);}else need(hex(body.custodyId));
   // DATA only. A caller's custodyId is not adopted/bound here. After withdrawal,
   // missing genuine retained control context refuses in the fixed context owner.
   return{data:{intentHash:b.candidateIntentHash,specHash:b.specHash,selectionSha256:b.selectionSha256,deadlineAt:b.deadlineAt,revision:state.revision}};
  }
  envelope(body,token,operation,state,now);
  // MAC authenticates manager-origin DATA, not live private Docker objects. No
  // generic sign/verify callback or JSON-to-handle constructor is permitted.
  // Root must bind custody to original lease + genuine physical constructor and
  // call existing SAME-writer Core CAS in a final refreshed context transaction.
  const missing={'create-intent':'CREATE_INTENT','created':'CHILD_RECEIPT','start-intent':'RETAINED_DUPLEX','waiting':'ORIGINAL_START','ready':'SAME_CHILD_READINESS'}[operation];
  fail('CANDIDATE_MANAGER_GENUINE_'+missing+'_OWNER_UNAVAILABLE',503);
 });
};}
