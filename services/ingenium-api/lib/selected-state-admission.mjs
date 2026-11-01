import { AsyncLocalStorage } from 'node:async_hooks';
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const valid=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value);
/** Cooperating API-process admission exclusion, NOT an engine execution queue,
 * distributed lock, authentication grant or agent settlement proof. Unknown
 * write slots retain their original; no timer/reset/GET-based release exists.
 */
export function createSelectedStateAdmission({maxSlots=1024}={}){
 if(!Number.isSafeInteger(maxSlots)||maxSlots<1||maxSlots>65536)fail('SELECTION_FENCE_CAPACITY_INVALID');
 const slots=new Map(),context=new AsyncLocalStorage();
 const key=(engineId,sessionId)=>{if(!valid(engineId)||!valid(sessionId))fail('SELECTION_FENCE_OWNER_REQUIRED');return JSON.stringify([engineId,sessionId]);};
 function enrolled(slot,work){
  const token={slot,active:true};
  const original=Promise.resolve().then(()=>context.run(token,()=>work()));
  slot.originals.add(original);
  original.then(()=>{token.active=false;slot.originals.delete(original);},()=>{token.active=false;slot.originals.delete(original);if(slot.writeAttempted)slot.unknown=true;});
  return original;
 }
 async function run(engineId,sessionId,work){
  if(typeof work!=='function')fail('SELECTION_FENCE_WORK_REQUIRED');const identity=key(engineId,sessionId),parent=context.getStore();
  if(parent){
   if(!parent.active||!parent.slot.active||slots.get(parent.slot.identity)!==parent.slot)fail('SELECTION_FENCE_STALE_CONTEXT');
   if(parent.slot.identity!==identity)fail('SELECTION_FENCE_CROSS_OWNER_NESTING');
   if(parent.slot.unknown)fail('SELECTION_FENCE_UNKNOWN');
   return enrolled(parent.slot,work);
  }
  if(slots.has(identity))fail(slots.get(identity).unknown?'SELECTION_FENCE_UNKNOWN':'SELECTION_FENCE_BUSY');
  if(slots.size>=maxSlots)fail('SELECTION_FENCE_CAPACITY');
  const slot={identity,active:true,writeAttempted:false,unknown:false,originals:new Set()};slots.set(identity,slot);
  let value,error;try{value=await enrolled(slot,work);}catch(failure){error=failure;}
  // Nested originals can continue enrolling their own children. An async task
  // inheriting an already returned token cannot start another effect.
  while(slot.originals.size)await Promise.allSettled([...slot.originals]);
  if(error&&slot.writeAttempted)slot.unknown=true;
  slot.active=false;if(!slot.unknown)slots.delete(identity);
  if(error)throw error;
  if(slot.unknown&&!(value&&typeof value==='object'&&'error'in value))fail('SELECTION_FENCE_UNKNOWN');
  return value;
 }
 return Object.freeze({
  run,
  write:(engineId,sessionId,work)=>run(engineId,sessionId,async()=>{
   const token=context.getStore();if(!token?.active||token.slot.unknown)fail('SELECTION_FENCE_STALE_CONTEXT');
   token.slot.writeAttempted=true;
   try{const result=await work();if(result&&typeof result==='object'&&'error'in result)token.slot.unknown=true;return result;}
   catch(error){token.slot.unknown=true;throw error;}
  }),
 });
}
/** Decode to one canonical session key, so percent-encoded aliases cannot split
 * the same admission. Global registry/config/engine writes are separate coverage
 * requirements, not silently treated as protected per-session operations.
 */
export function selectedSessionMutation(path,method='GET'){
 if(['GET','HEAD','OPTIONS'].includes(method.toUpperCase()))return null;
 let url;try{url=new URL(path,'http://selection.invalid');}catch{fail('SELECTION_FENCE_PATH_INVALID');}
 if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||url.origin!=='http://selection.invalid'||url.hash)fail('SELECTION_FENCE_PATH_INVALID');
 const prefix=/^\/api\/(?:experimental\/)?session(?:\/|$)/,rawScoped=prefix.test(path),scoped=prefix.test(url.pathname);
 if(!rawScoped&&!scoped)return null;
 // Match the URL parser used by fetch; dot traversal cannot lock one session
 // while the actual request reaches another. Never rewrite the original path.
 if(!scoped)fail('SELECTION_FENCE_PATH_INVALID');
 const match=/^\/api\/(?:experimental\/)?session\/([^/]+)(?:\/.*)?$/.exec(url.pathname);
 if(!match){if(path==='/api/session')return null;fail('SELECTION_FENCE_PATH_INVALID');}
 let sessionId;try{sessionId=decodeURIComponent(match[1]);}catch{fail('SELECTION_FENCE_PATH_INVALID');}
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sessionId))fail('SELECTION_FENCE_PATH_INVALID');return sessionId;
}
export const selectedStateAdmission=createSelectedStateAdmission();
