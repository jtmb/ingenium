import {parseStrictJobJson} from "./job-bootstrap-frame.mjs";
export const CANDIDATE_FRAME_LIMIT=600*1024,CANDIDATE_BODY_LIMIT=384*1024,CANDIDATE_TOTAL_LIMIT=8*1024*1024,CANDIDATE_FRAME_COUNT=256;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,hex=/^[a-f0-9]{64}$/;
export const candidateDenied=()=>{throw Object.assign(Error("Original candidate carrier unavailable"),{code:"ORIGINAL_CANDIDATE_CARRIER_UNAVAILABLE"});};
export function exact(value,keys){if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join("|")!==[...keys].sort().join("|"))candidateDenied();return value;}
export function candidateBinding(value,now=Date.now()){
 exact(value,["runId","attemptId","intentHash","childId","childBirthHash","catalogSha256","expiresAt"]);
 if(!uuid.test(value.runId??"")||!uuid.test(value.attemptId??"")||!["intentHash","childId","childBirthHash","catalogSha256"].every(k=>typeof value[k]==="string"&&hex.test(value[k]))||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt-now>120000)candidateDenied();return Object.freeze({...value});
}
export function candidateSelection(value,now=Date.now()){
 exact(value,["runId","attemptId","intentHash","catalogSha256","expiresAt"]);
 if(!uuid.test(value.runId??"")||!uuid.test(value.attemptId??"")||!["intentHash","catalogSha256"].every(k=>typeof value[k]==="string"&&hex.test(value[k]))||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt-now>120000)candidateDenied();return Object.freeze({...value});
}
export function operationRoute(method,path,runId){
 const root=`/api/v1/runtime/job-runs/${runId}/`;
 if(typeof path!=="string"||!path.startsWith(root))candidateDenied();const operation=path.slice(root.length);
 if(method==="GET"&&["assignment","bootstrap-assignment","mcp-tools"].includes(operation)||method==="POST"&&(["result","withdraw"].includes(operation)||/^mcp\/ingenium_[A-Za-z0-9_]{1,128}$/.test(operation)))return operation;
 candidateDenied();
}
export function decodedBody(value,limit=CANDIDATE_BODY_LIMIT){if(typeof value!=="string"||value.length>Math.ceil(limit/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))candidateDenied();const bytes=Buffer.from(value,"base64");if(bytes.length>limit||bytes.toString("base64")!==value)candidateDenied();return bytes;}
export async function* candidateFrames(input){let pending=Buffer.alloc(0),total=0,count=0;for await(const chunk of input){const bytes=Buffer.from(chunk);total+=bytes.length;if(total>CANDIDATE_TOTAL_LIMIT)candidateDenied();let start=0;for(let end=bytes.indexOf(10);end!==-1;end=bytes.indexOf(10,start)){const part=bytes.subarray(start,end);if(pending.length+part.length>CANDIDATE_FRAME_LIMIT||++count>CANDIDATE_FRAME_COUNT)candidateDenied();yield parseStrictJobJson(Buffer.concat([pending,part]),CANDIDATE_FRAME_LIMIT);pending=Buffer.alloc(0);start=end+1;}pending=Buffer.concat([pending,bytes.subarray(start)]);if(pending.length>CANDIDATE_FRAME_LIMIT)candidateDenied();}if(pending.length)candidateDenied();}
export function candidateWriter(output,{deadline=Infinity,now=Date.now}={}){let bytes=0,count=0,tail=Promise.resolve(),failed=false;return frame=>{let line;try{line=Buffer.from(JSON.stringify(frame)+"\n");if(failed||line.length>CANDIDATE_FRAME_LIMIT||bytes+line.length>CANDIDATE_TOTAL_LIMIT||++count>CANDIDATE_FRAME_COUNT)candidateDenied();bytes+=line.length;}catch(error){failed=true;return Promise.reject(error);}const work=tail.then(()=>new Promise((resolve,reject)=>{let done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve();};const timer=setTimeout(()=>finish(Error("Original candidate write outcome unknown")),Math.max(1,Math.min(15000,deadline-now())));timer.unref?.();try{output.write(line,finish);}catch(error){finish(error);}}));tail=work.catch(()=>{failed=true;});return work;};}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});void promise.catch(()=>{});return{promise,resolve,reject};};
/** Transport only: READY observations and DTOs never grant Core authority. EOF/error
 * latches unknown and rejects every waiter; this carrier never retries or retires. */
export function createCandidateChildCarrier({input,output,binding,now=Date.now,onUnknown=()=>{}}){
 const selected=candidateSelection(binding,now()),write=candidateWriter(output,{deadline:selected.expiresAt,now}),material=deferred(),pending=new Map();let expected,initialized=false,observed=false,spent=false,delivered=false,closed=false,next=0;
 const check=()=>{if(closed||now()>=selected.expiresAt)candidateDenied();};
 const stop=error=>{if(closed)return;closed=true;initial.reject(error);material.reject(error);for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();onUnknown({code:"ORIGINAL_CANDIDATE_CHANNEL_UNKNOWN",runId:selected.runId,attemptId:selected.attemptId});};
 const initial=deferred();const timer=setTimeout(()=>stop(Error("Original candidate deadline expired")),Math.max(1,selected.expiresAt-now()));timer.unref?.();
 const pump=(async()=>{try{for await(const frame of candidateFrames(input)){check();if(!initialized){exact(frame,["type","binding"]);if(frame.type!=="init")candidateDenied();const incoming=candidateBinding(frame.binding,now());if(Object.keys(selected).some(key=>selected[key]!==incoming[key]))candidateDenied();expected=incoming;initialized=true;initial.resolve();continue;}
 if(frame.type==="material"){exact(frame,["type","capability","agentMaterial"]);if(!observed||spent||typeof frame.capability!=="string"||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(frame.capability))candidateDenied();spent=true;material.resolve(Object.freeze(frame));continue;}
 exact(frame,["type","id","status","body"]);if(frame.type!=="response"||!Number.isSafeInteger(frame.id)||!pending.has(frame.id)||!Number.isInteger(frame.status)||frame.status<200||frame.status>599)candidateDenied();const item=pending.get(frame.id);pending.delete(frame.id);clearTimeout(item.timer);item.resolve({status:frame.status,body:decodedBody(frame.body)});
 }throw Error("Original candidate attach EOF");}catch(error){initial.reject(error);stop(error);}finally{clearTimeout(timer);}})();void pump.catch(()=>{});
 return Object.freeze({get binding(){if(!initialized)candidateDenied();return expected;},initialized:initial.promise,closed:()=>closed,finished:pump,
 async observe(value){check();if(!initialized||observed)candidateDenied();exact(value,["catalogSha256","trapAddress","proxyAddress","pid"]);if(value.catalogSha256!==expected.catalogSha256||value.trapAddress!=="127.0.0.1:39261"||value.proxyAddress!=="127.0.0.1:39262"||!Number.isSafeInteger(value.pid)||value.pid<=0)candidateDenied();observed=true;await write({type:"observation",binding:expected,...value});},
 async material(){check();if(delivered)candidateDenied();delivered=true;return material.promise;},
 async request(method,path,body){check();if(!spent||pending.size>=8||!Buffer.isBuffer(body)||body.length>CANDIDATE_BODY_LIMIT)candidateDenied();const operation=operationRoute(method,path,expected.runId);if(method==="GET"&&body.length)candidateDenied();const id=++next,item=deferred();item.timer=setTimeout(()=>{stop(Error("Original candidate RPC outcome unknown"));},Math.min(15000,expected.expiresAt-now()));item.timer.unref?.();pending.set(id,item);try{await write({type:"request",id,method,operation,body:body.toString("base64")});}catch(error){stop(error);}return item.promise;},
 stop(){stop(Error("Original candidate carrier closed"));clearTimeout(timer);},
 });
}
/** Same retained original Docker attach owner calls this; forwarding must use its
 * original Core HTTP owner + released candidate credential. No token/URL on wire. */
export function createCandidateManagerCarrier({input,output,binding,forwardOriginalRpc,onObservation,onUnknown,now=Date.now}){
 const expected=candidateBinding(binding,now()),write=candidateWriter(output,{deadline:expected.expiresAt,now});let observed=false,spent=false,closed=false,last=0;const inflight=new Set();
 const stop=()=>{if(closed)return;closed=true;onUnknown({code:"ORIGINAL_CANDIDATE_CHANNEL_UNKNOWN",runId:expected.runId,attemptId:expected.attemptId});};
 const timer=setTimeout(stop,Math.max(1,expected.expiresAt-now()));timer.unref?.();
 const started=write({type:"init",binding:expected});
 const finished=(async()=>{await started;try{for await(const frame of candidateFrames(input)){if(closed||now()>=expected.expiresAt)candidateDenied();if(!observed){exact(frame,["type","binding","catalogSha256","trapAddress","proxyAddress","pid"]);if(frame.type!=="observation"||JSON.stringify(frame.binding)!==JSON.stringify(expected)||frame.catalogSha256!==expected.catalogSha256||frame.trapAddress!=="127.0.0.1:39261"||frame.proxyAddress!=="127.0.0.1:39262"||!Number.isSafeInteger(frame.pid)||frame.pid<=0)candidateDenied();observed=true;await onObservation(Object.freeze(structuredClone(frame)));continue;}
 exact(frame,["type","id","method","operation","body"]);if(frame.type!=="request"||!spent||!Number.isSafeInteger(frame.id)||frame.id!==last+1||inflight.size>=8)candidateDenied();last=frame.id;operationRoute(frame.method,`/api/v1/runtime/job-runs/${expected.runId}/${frame.operation}`,expected.runId);const body=decodedBody(frame.body);if(frame.method==="GET"&&body.length)candidateDenied();
 const task=(async()=>{const response=await forwardOriginalRpc({binding:expected,method:frame.method,operation:frame.operation,body});if(closed)return;if(!response||!Number.isInteger(response.status)||response.status<200||response.status>599||!Buffer.isBuffer(response.body)||response.body.length>CANDIDATE_BODY_LIMIT)candidateDenied();await write({type:"response",id:frame.id,status:response.status,body:response.body.toString("base64")});})();inflight.add(task);void task.catch(stop).finally(()=>inflight.delete(task));
 }stop();}catch{stop();}finally{clearTimeout(timer);}})();void finished.catch(stop);
 return Object.freeze({started,finished,closed:()=>closed,
 // Root must perform its SQL131 fresh-original readiness/material CAS BEFORE this
 // transport write. This method neither issues material nor validates authority.
 async writeOriginalReleasedMaterial(frame){if(closed||!observed||spent||now()>=expected.expiresAt)candidateDenied();exact(frame,["capability","agentMaterial"]);if(typeof frame.capability!=="string"||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(frame.capability))candidateDenied();spent=true;await write({type:"material",...frame});},
 stop(){stop();clearTimeout(timer);},
 });
}
