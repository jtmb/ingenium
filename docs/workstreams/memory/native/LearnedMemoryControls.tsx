import {useEffect,useMemo,useState,useSyncExternalStore} from "react";
import type {Project} from "@veyra/contracts";
import {createNativeMemoryController,type Entry,type Policy,type ChatPolicy} from "./adapter.mjs";
import {nativeMemoryCustody} from "../promptOriginal";

export function LearnedMemoryControls({request,project,sessionId,disabled}:{
 request:(method:"GET"|"POST",path:string,body?:unknown)=>Promise<unknown>;
 project:Project;sessionId:string;disabled:boolean;
}){
 const owner=JSON.stringify(project);
 const controller=useMemo(()=>createNativeMemoryController({request,custody:nativeMemoryCustody,
  subject:{kind:"project",project:JSON.parse(owner)},chatId:sessionId}),[request,owner,sessionId]);
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 const [entries,setEntries]=useState<Entry[]>([]),[error,setError]=useState("");
 useEffect(()=>{let active=true;setEntries([]);setError("");
  void controller.inspect().then(r=>{if(active)setEntries(r.entries)}).catch(()=>{if(active)setError("Current Native memory could not be verified.")});
  return()=>{active=false};
 },[controller]);
 const refresh=async()=>{try{setEntries((await controller.inspect()).entries);setError("")}catch{setError("Memory inspection failed; pending requests remain preserved.")}};
 const blocked=disabled||!state.available||!state.canChange||state.loading||state.pending||!!state.unknownOperationId;
 const change=(target:"host"|"chat",field:string,value:boolean)=>{
  const prior=target==="host"?state.policy:state.chat;
  void controller.change(state.scopeKey,state.chatId,{target,expectedRevision:prior.revision,
   values:{...prior,[field]:value} as Policy|ChatPolicy}).then(()=>refresh());
 };
 return <details className="scoped-context"><summary>Learned memory</summary><div className="scoped-context-body">
  <p>Learn from completed chat snapshots after the idle interval. Generation, use, external context and chat contribution are separate choices. Learned text is reference data and cannot activate skills.</p>
  {(error||state.error)&&<p role="alert">{error||state.error}</p>}
  <fieldset disabled={blocked}><legend>Private execution scope</legend>
   {([["enabled","Enable learned memory"],["generate","Generate memories"],["useMemory","Use learned memories"],["externalContext","Allow external context"]] as const).map(([field,label])=>
    <label key={field}><input type="checkbox" checked={state.policy[field]} onChange={e=>change("host",field,e.target.checked)}/>{label}</label>)}
   <p>This chat</p>
   <label><input type="checkbox" checked={state.chat.useMemory} onChange={e=>change("chat","useMemory",e.target.checked)}/>Use memory in this chat</label>
   <label><input type="checkbox" checked={state.chat.contribute} onChange={e=>change("chat","contribute",e.target.checked)}/>Allow this chat to contribute</label>
  </fieldset>
  <button type="button" disabled={disabled||state.pending} onClick={()=>void refresh()}>Refresh learned memory</button>
  {state.unknownOperationId&&<button type="button" disabled={disabled||state.pending} onClick={()=>void controller.reconcile(state.unknownOperationId!).then(()=>refresh())}>Check original receipt</button>}
  <p>Forget suppresses the entry and its source/content from future learning and recall. Past prompt originals, chat history and exported backups remain separate.</p>
  {entries.map(entry=><article key={entry.id}><p>{entry.content}</p><small>{entry.model} · revision {entry.revision} · {entry.sources.length} source messages</small>
   <button type="button" disabled={blocked} onClick={()=>void controller.forget(entry).then(()=>refresh())}>Forget learned entry</button></article>)}
 </div></details>;
}
