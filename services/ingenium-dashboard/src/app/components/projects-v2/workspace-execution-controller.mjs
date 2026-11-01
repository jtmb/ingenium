/** Single mounted owner for explicit selection. Async results never cross a scope/selection change. */
const same=(a,b)=>a&&b&&['instanceId','workspaceId','runtimeId','bindingHash','bindingEpoch','ownerUserId','organizationId'].every(k=>a[k]===b[k]);
export function createWorkspaceExecutionController(client,journal,{wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pollMs=1000,maxAttempts=60}={}){
 let state=Object.freeze({status:'loading',options:[],selectedWorkspaceId:null,confirmed:null,error:null}),generation=0,live=true,inFlight=false;
 const listeners=new Set();
 const publish=patch=>{if(!live)return;state=Object.freeze({...state,...patch});for(const f of listeners)f()};
 const valid=g=>live&&generation===g;
 const current=(g,row)=>valid(g)&&state.selectedWorkspaceId===row.workspaceId;
 const message=e=>e instanceof Error?e.message:'The execution target could not be verified.';
 async function load(requestedRuntime=null){
  const g=++generation;publish({status:'loading',options:[],selectedWorkspaceId:null,confirmed:null,error:null});
  try{
   const rows=await client.list();if(!valid(g))return;
   publish({options:rows,status:rows.length?'selecting':'empty'});
   if(requestedRuntime===null)return;
   const matches=rows.filter(r=>r.runtimeId===requestedRuntime);if(matches.length!==1)throw Error('This conversation runtime is not available in your current account and organization.');
   const row=matches[0];publish({selectedWorkspaceId:row.workspaceId});
   // A URL chooses a target; it never authorizes a start.
   if(!['READY','IDLE'].includes(row.claimedState))return;
   const confirmed=await client.confirm(row);if(!current(g,row))return;
   journal.confirmed(row);publish({status:'ready',confirmed});
  }catch(error){if(valid(g))publish({status:'error',confirmed:null,error:message(error)})}
 }
 function select(workspaceId){
  if(!live||!state.options.some(r=>r.workspaceId===workspaceId))return;
  ++generation;publish({selectedWorkspaceId:workspaceId,confirmed:null,status:'selecting',error:null});
 }
 async function start(){
  if(!live||inFlight)return;const row=state.options.find(r=>r.workspaceId===state.selectedWorkspaceId);if(!row)return;
  const g=generation;inFlight=true;publish({status:'starting',confirmed:null,error:null});
  try{
   // Re-read metadata before any effect. A changed runtime or workspace epoch
   // requires another explicit selection instead of redirecting this click.
   const initial=await client.list();if(!current(g,row))return;
   let selected=initial.find(r=>r.workspaceId===row.workspaceId);if(!same(selected,row))throw Error('The target changed. Refresh and explicitly select its current runtime.');
   if(selected.claimedState==='ABSENT'){
    if(journal.has(selected))throw Error('This runtime already has a start intent. Refresh its original status instead of repeating the start.');
    await client.provision(selected,journal);if(!current(g,row))return;
   }else if(!['PROVISIONING','STARTING','READY','IDLE'].includes(selected.claimedState))throw Error('This runtime cannot be resumed yet. Review its current lifecycle status.');
   for(let attempt=0;attempt<maxAttempts;attempt++){
    if(!current(g,row))return;
    if(['READY','IDLE'].includes(selected.claimedState)){
     const confirmed=await client.confirm(selected);if(!current(g,row))return;
     journal.confirmed(selected);publish({status:'ready',options:initial.map(r=>r.workspaceId===selected.workspaceId?selected:r),confirmed,error:null});return;
    }
    if(selected.claimedState==='STARTING'){
     // Refresh only inspects this original manager generation. It cannot
     // provision another process. Read its actual state even after a lost reply.
     try{await client.refresh(selected)}catch{/* status read below remains authoritative */}
     if(!current(g,row))return;
    }
    await wait(pollMs);if(!current(g,row))return;
    const rows=await client.list();if(!current(g,row))return;
    selected=rows.find(r=>r.workspaceId===row.workspaceId);if(!same(selected,row))throw Error('The execution identity changed while starting. Its original intent is retained.');
    if(!['ABSENT','PROVISIONING','STARTING','READY','IDLE'].includes(selected.claimedState))throw Error('The original runtime stopped before readiness. Its start intent is retained for review.');
    publish({options:rows});
   }
   throw Error('Readiness was not confirmed within the bounded check. Refresh status; the original start will not be repeated.');
  }catch(error){if(current(g,row))publish({status:'error',confirmed:null,error:message(error)})}
  finally{inFlight=false}
 }
 async function stop(){
  if(!live||inFlight)return;const row=state.options.find(r=>r.workspaceId===state.selectedWorkspaceId);if(!row)return;
  const g=generation;inFlight=true;publish({status:'stopping',confirmed:null,error:null});
  try{
   const rows=await client.list();if(!current(g,row))return;const selected=rows.find(r=>r.workspaceId===row.workspaceId);
   if(!same(selected,row))throw Error('The execution changed. Refresh before stopping it.');
   await client.stop(selected);if(!current(g,row))return;
   const after=await client.list();if(!current(g,row))return;if(!same(after.find(r=>r.workspaceId===row.workspaceId),row))throw Error('The execution changed after stopping. Select its current workspace.');
   publish({options:after,status:'selecting',confirmed:null,error:null});
  }catch(error){if(current(g,row))publish({status:'error',confirmed:null,error:message(error)})}finally{inFlight=false}
 }
 async function restart(){
  if(!live||inFlight)return;const row=state.options.find(r=>r.workspaceId===state.selectedWorkspaceId);if(!row)return;
  const g=generation;inFlight=true;publish({status:'starting',confirmed:null,error:null});let prepared=false;
  try{
   const rows=await client.list();if(!current(g,row))return;const selected=rows.find(r=>r.workspaceId===row.workspaceId);
   if(!same(selected,row)||!['STOPPED','FAILED'].includes(selected.claimedState))throw Error('The workspace changed. Refresh before reopening it.');
   const successor=await client.successor(selected);if(!current(g,row))return;
   const after=await client.list();if(!current(g,row))return;const next=after.find(r=>r.workspaceId===row.workspaceId);
   if(!same(next,{...row,runtimeId:successor.id})||next.claimedState!=='ABSENT')throw Error('The new execution changed. Select it explicitly before starting.');
   publish({options:after,status:'selecting',confirmed:null,error:null});prepared=true;
  }catch(error){if(current(g,row))publish({status:'error',confirmed:null,error:message(error)})}finally{inFlight=false}
  if(prepared&&current(g,row))await start();
 }
 return {
  getSnapshot:()=>state,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  load,select,start,stop,restart,
  close(){live=false;++generation;listeners.clear()},
 };
}
