"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { dashboardFetch, getApiBase } from '@/lib/api';
import { MemoryControls } from './MemoryControls';
import { createMemoryController } from './controller.mjs';
import { controllerBinding, definitiveRejection, hostedSelection, type HostedBinding, type HostedSelection,
  type InspectionPage, type ManagementRecord } from './hosted-contract.mjs';
import { createHostedMemoryHttp } from './hosted-http.mjs';
import { createHostedJournal } from './hosted-journal.mjs';
import type { ResetPreview } from './LearnedMemoryList';

type Http = ReturnType<typeof createHostedMemoryHttp>;

/** Root supplies actual workspace/runtime/created engine session and expected
 * actor/org. Server derives Project ID; an optional known UUID only narrows it.
 * A project display name is never sent. This selector is never a grant. */
export function HostedWorkMemory({ selected }: { selected: HostedSelection | null }) {
  let selection: HostedSelection | null = null;
  try { if (selected) selection = hostedSelection(selected); } catch { /* fail closed for drafts/malformed selectors */ }
  const key = selection ? JSON.stringify(selection) : null;
  return key && selection ? <AcquireMemory key={key} selected={selection} />
    : <p role="status">Memory controls need a confirmed workspace, runtime and existing chat.</p>;
}

function AcquireMemory({ selected }: { selected: HostedSelection }) {
  const [originalSelection]=useState(selected); // parent is keyed by the full selector
  const [http] = useState(() => createHostedMemoryHttp({ dashboardFetch, base:getApiBase() }));
  const [binding,setBinding] = useState<HostedBinding|null>(null);
  const [error,setError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    let active=true; const cancellation=new AbortController();
    setBinding(null);setError(false);
    void http.loadBinding(originalSelection,cancellation.signal).then(value => {if(active)setBinding(value);},() => {if(active)setError(true);});
    return () => {active=false;cancellation.abort();};
  },[http,originalSelection,attempt]);
  if(binding)return <PrepareMemory key={JSON.stringify(controllerBinding(binding))} http={http} binding={binding}/>;
  return <section aria-label="Memory"><p role="status">{error?'Memory binding is unavailable for this selection.':'Checking memory binding…'}</p>
    {error&&<button type="button" onClick={()=>setAttempt(value=>value+1)}>Check memory binding</button>}</section>;
}

type Session={key:number;api:ReturnType<Http['forBinding']>;journal:ReturnType<typeof createHostedJournal>;controller:ReturnType<typeof createMemoryController>};
function PrepareMemory({http,binding}:{http:Http;binding:HostedBinding}) {
  const [session,setSession]=useState<Session|null>(null),[error,setError]=useState(false);
  const counter=useRef(0);
  // Construct disposable controllers inside the effect so Strict Mode's second
  // setup receives a fresh owner rather than reusing a disposed controller.
  useEffect(()=>{
    const cancellation=new AbortController();let controller:Session['controller']|null=null;
    try{
      const journal=createHostedJournal(window.localStorage,binding),api=http.forBinding(binding,{signal:cancellation.signal});
      controller=createMemoryController({api:api.controller,journal:journal.policy});
      setSession({key:++counter.current,api,journal,controller});setError(false);
      void controller.activate(controllerBinding(binding));
    }catch{setSession(null);setError(true);}
    return ()=>{cancellation.abort();controller?.dispose();};
  },[http,binding]);
  return session?<BoundMemory key={session.key} binding={binding} session={session}/>
    :<p role="status">{error?'The original operation journal is unavailable. No memory changes can be sent.':'Opening memory controls…'}</p>;
}

function BoundMemory({binding,session}:{binding:HostedBinding;session:Session}) {
  const {api,journal,controller}=session;
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  const [page,setPage]=useState<InspectionPage|null>(null),[preview,setPreview]=useState<ResetPreview|null>(null);
  const [unknown,setUnknown]=useState<ManagementRecord|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null);
  const mounted=useRef(false),operationBusy=useRef(false),readEpoch=useRef(0);
  const identity=useMemo(()=>controllerBinding(binding),[binding]);
  useEffect(()=>{
    mounted.current=true;
    try{setUnknown(journal.management.get());}catch{setNotice('The original operation journal could not be read. No changes will be sent.');}
    return ()=>{mounted.current=false;readEpoch.current++;};
  },[journal]);
  const blocked=busy||state.pending||state.loading||!!state.unknownOperationId||!!unknown||!state.available;
  const currentWriteBlocked=()=>{
    const current=controller.getSnapshot();
    return operationBusy.current||current.pending||current.loading||!!current.unknownOperationId||!current.available||!!unknown;
  };
  async function inspect(offset=0) {
    const epoch=++readEpoch.current;
    try{const result=await api.inspect(offset,25);if(mounted.current&&readEpoch.current===epoch){setPage(result);setNotice(null);}}
    catch{if(mounted.current&&readEpoch.current===epoch){setPage(null);setNotice('Stored recall could not be qualified. No global total is available.');}}
  }
  async function previewReset() {
    if(currentWriteBlocked()||!binding.canForget)return;
    operationBusy.current=true;setBusy(true);
    try{const result=await api.previewReset();if(mounted.current)setPreview(result);}
    catch{if(mounted.current){setPreview(null);setNotice('Reset preview is unavailable.');}}
    finally{operationBusy.current=false;if(mounted.current)setBusy(false);}
  }
  async function manage(input: Omit<ManagementRecord,'operationId'|'scopeHash'|'origin'>) {
    if(currentWriteBlocked()||!binding.canForget)return;
    const record={...input,operationId:`memory-${crypto.randomUUID()}`,scopeHash:binding.scopeHash,origin:identity} as ManagementRecord;
    operationBusy.current=true;setBusy(true);setPreview(null);readEpoch.current++;setPage(null);
    // Persist BEFORE the one write. Every error after this stays uncertain unless
    // a matching receipt or definitive pre-commit rejection is obtained.
    let stored=false;
    try{
      journal.management.set(record);stored=true;
      if(mounted.current)setUnknown(record);
      await api.manage(record);
      journal.management.remove(record.operationId);
      if(mounted.current){setUnknown(journal.management.get());setNotice('The original memory change has a committed receipt.');await controller.activate(identity);}
    }catch(error){
      if(stored&&definitiveRejection(error)){
        try{journal.management.remove(record.operationId);if(mounted.current){setUnknown(journal.management.get());await controller.activate(identity);}}
        catch{if(mounted.current)setUnknown(record);}
      }
      if(mounted.current){
        if(!stored)try{setUnknown(journal.management.get());}catch{/* retain every original on storage error */}
        setNotice(stored?'Check the original operation receipt before another change.':'The operation could not be journaled. No write was sent.');
      }
    }finally{operationBusy.current=false;if(mounted.current)setBusy(false);}
  }
  async function reconcile() {
    if(!unknown||operationBusy.current)return;operationBusy.current=true;setBusy(true);
    try{
      await api.managementOperation(unknown);journal.management.remove(unknown.operationId);
      if(mounted.current){setUnknown(journal.management.get());setNotice('The original operation receipt is committed.');await controller.activate(identity);}
    }catch{if(mounted.current)setNotice('No matching committed receipt is available. The original metadata remains; no write was resent.');}
    finally{operationBusy.current=false;if(mounted.current)setBusy(false);}
  }
  return <section aria-label="Hosted chat memory" className="space-y-4 p-3">
    <MemoryControls state={{...state,pending:state.pending||busy||!!unknown}}
      onChange={(scope,chat,change)=>{if(!operationBusy.current&&!unknown)void controller.change(scope,chat,change);}}
      onReconcile={id=>{void controller.reconcile(id).then(()=>{if(mounted.current)void controller.activate(identity);});}}/>
    <button type="button" disabled={busy||state.pending} onClick={()=>{
      try{setUnknown(journal.management.get());void controller.activate(identity);}catch{setNotice('Original metadata is unavailable. No change will be sent.');}
    }}>Refresh policy and original journal</button>
    {notice&&<p role="status">{notice}</p>}
    {unknown&&<div role="status"><p>A memory management operation has an unknown outcome.</p>
      <button type="button" disabled={busy} onClick={()=>{void reconcile();}}>Check original operation receipt</button></div>}
    <p>Stored recall inspection is separate from turn context. No prompt-consumption receipt is available here.</p>
    <button type="button" disabled={busy} onClick={()=>{void inspect();}}>Inspect stored recall</button>
    {page&&<section aria-label="Qualified recall page">
      <p>{page.items.length} qualified memories returned on this page. The total in this scope is unknown.</p>
      <p>{page.sourceWindow.unavailableMemoryCount} candidates unavailable; {page.sourceWindow.deferredForSourceBudget} deferred for source qualification.</p>
      {page.items.length===0&&<p>No qualified recall returned in this bounded page.</p>}
      <ul>{page.items.map(row=><li key={row.id} className="rounded border p-2">
        <p className="whitespace-pre-wrap break-words">{row.content}</p>
        <details><summary>Provenance · version {row.version}</summary><p>Generated by {row.provenance.model}</p>
          <ul>{row.provenance.sources.map(source=><li key={source.id} className="break-words">{source.kind}: {source.id} · {source.contentHash}</li>)}</ul></details>
        <button type="button" disabled={blocked||!binding.canForget} onClick={()=>{void manage({action:'forget',memoryId:row.id,expectedVersion:row.version});}}>Forget this recall and its derivatives</button>
      </li>)}</ul>
      {page.sourceWindow.nextCandidateOffset!==null&&<button type="button" disabled={busy} onClick={()=>{void inspect(page.sourceWindow.nextCandidateOffset!);}}>Inspect next candidate page</button>}
    </section>}
    <button type="button" disabled={blocked||!binding.canForget} onClick={()=>{void previewReset();}}>Preview reset of learned recall</button>
    {preview&&<div role="group" aria-label="Confirm scoped memory reset"><p>Forget {preview.count} learned memories in this host and workspace? Transcripts and explicit saved memories are retained.</p>
      <button type="button" disabled={blocked||!binding.canForget} onClick={()=>{void manage({action:'reset',confirmation:preview.confirmation});}}>Confirm scoped reset</button></div>}
  </section>;
}
