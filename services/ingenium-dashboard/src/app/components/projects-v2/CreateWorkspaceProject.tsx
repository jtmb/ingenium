"use client";
import {useEffect,useRef,useState}from'react';
import type {ProjectRef}from'../../../../../../packages/veyra-projects/contracts.js';
import type {ConfirmedWorkspaceExecution}from'./workspace-execution-client.mjs';
import type {WorkspaceProjectClient}from'./workspace-project-catalog.mjs';
import {createWorkspaceProjectCreationController,createWorkspaceProjectCreationJournal,sameProjectCreationExecution,type WorkspaceProjectCreationIntent}from'./workspace-project-creation.mjs';
import Overlay from'../Overlay';
const control='rounded px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-blue-400 disabled:opacity-40';
export default function CreateWorkspaceProject({client,ownerUserId,organizationId,execution,canCreate,catalogReady,alreadyAdded,onCreated}:{client:WorkspaceProjectClient;ownerUserId:string;organizationId:string;execution:ConfirmedWorkspaceExecution|null;canCreate:boolean;catalogReady:boolean;alreadyAdded:boolean;onCreated:(project:ProjectRef)=>void}){
 const controller=useRef<ReturnType<typeof createWorkspaceProjectCreationController>|null>(null),alive=useRef(false),busy=useRef(false);
 const [ready,setReady]=useState(false),[intent,setIntent]=useState<WorkspaceProjectCreationIntent|null>(null),[adding,setAdding]=useState(false),[name,setName]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[canRetry,setCanRetry]=useState(false);
 useEffect(()=>{
  alive.current=true;
  try{const journal=createWorkspaceProjectCreationJournal(window.sessionStorage,{ownerUserId,organizationId});const actual=createWorkspaceProjectCreationController(client,journal);controller.current=actual;setIntent(actual.pending());setReady(true)}
  catch{setReady(false);setError('Project creation cannot be tracked here. Restore browser storage before adding a project.')}
  return()=>{alive.current=false;controller.current=null};
 },[client,ownerUserId,organizationId]);
 async function submit(){
  const actual=controller.current;if(!actual||!execution||!canCreate||busy.current||!catalogReady||alreadyAdded)return;
  busy.current=true;setPending(true);setError('');setNotice('');setCanRetry(false);
  try{const created=await actual.submit(name,execution);if(alive.current){setAdding(false);setName('');setNotice('Project added: '+created.label);onCreated(created)}}
  catch(failure){if(alive.current)setError(failure&&typeof failure==='object'&&'code'in failure&&failure.code==='PROJECT_ROOT_ALREADY_ATTACHED'?'This folder already has a project. Check active or archived projects to open or restore it.':'Project creation is not confirmed. Check its saved status before adding another.')}
  finally{busy.current=false;if(alive.current){setPending(false);try{setIntent(actual.pending())}catch{setReady(false);setError('The saved project creation needs review before another can start.')}}}
 }
 async function recover(){
  const actual=controller.current;if(!actual||busy.current)return;busy.current=true;setPending(true);setError('');setNotice('');setCanRetry(false);
  try{const created=await actual.recover();if(alive.current){setAdding(false);setName('');setNotice('Saved project found: '+created.label+(created.archived?' (archived)':''));onCreated(created)}}
  catch(failure){if(alive.current){setCanRetry(Boolean(failure&&typeof failure==='object'&&'status'in failure&&failure.status===404));setError('The saved project creation is still unconfirmed. Check again or retry the same saved creation in its original workspace.')}}
  finally{busy.current=false;if(alive.current){setPending(false);try{setIntent(actual.pending())}catch{setReady(false);setError('The saved project creation needs review before another can start.')}}}
 }
 async function retry(){
  const actual=controller.current;if(!actual||!execution||!canCreate||!catalogReady||!canRetry||!sameProjectCreationExecution(intent,execution)||busy.current)return;
  busy.current=true;setPending(true);setError('');setNotice('');setCanRetry(false);
  try{const created=await actual.resume(execution);if(alive.current){setAdding(false);setName('');setNotice('Project added: '+created.label);onCreated(created)}}
  catch(failure){if(alive.current)setError(failure&&typeof failure==='object'&&'code'in failure&&failure.code==='PROJECT_ROOT_ALREADY_ATTACHED'?'This folder already has a project. Check active or archived projects to open or restore it.':'The saved creation remains unconfirmed. Reconnect its original workspace and check its status.')}
  finally{busy.current=false;if(alive.current){setPending(false);try{setIntent(actual.pending())}catch{setReady(false);setError('The saved project creation needs review before another can start.')}}}
 }
 return <div className="space-y-1 px-2">
  {canCreate&&<button type="button" className={control} disabled={!ready||!execution||!catalogReady||alreadyAdded||Boolean(intent)||pending} title={alreadyAdded?'This workspace already has a project.':!execution?'Connect a workspace before adding a project.':undefined} onClick={()=>{setAdding(true);setError('');setNotice('')}}>＋ Add project</button>}
  {pending&&!intent&&<p role="status" className="text-xs">Adding project…</p>}
  {intent&&<div className="space-y-1 text-xs"><p role="status">{pending?'Checking project creation…':'A saved project creation needs a check.'}</p><button type="button" className={control} disabled={pending||!ready} onClick={()=>void recover()}>Check project creation</button>{canRetry&&canCreate&&<button type="button" className={control} disabled={pending||!ready||!catalogReady||!sameProjectCreationExecution(intent,execution)} title={!sameProjectCreationExecution(intent,execution)?'Reconnect the original workspace to retry.':undefined} onClick={()=>void retry()}>Retry saved creation</button>}</div>}
  {notice&&<p role="status" className="text-xs text-neutral-400">{notice}</p>}{error&&!adding&&<p role="alert" className="text-xs">{error}</p>}
  <Overlay isOpen={adding} onClose={()=>setAdding(false)} title="Add project" subtitle="Use the currently confirmed workspace folder.">
   <form className="space-y-3" onSubmit={event=>{event.preventDefault();void submit()}}>
    <label className="block text-sm">New project name<input value={name} onChange={event=>setName(event.target.value)} disabled={pending||Boolean(intent)} required maxLength={200} autoFocus className="mt-1 block w-full rounded border border-[var(--color-border)] bg-transparent p-2"/></label>
    <button type="submit" className={control} disabled={pending||Boolean(intent)||!execution||!canCreate||!catalogReady||alreadyAdded||!ready||!name.trim()||name!==name.trim()}>Add project</button>
    {pending&&<p role="status" className="text-sm">{intent?'Checking project creation…':'Adding project…'}</p>}
    {intent&&<button type="button" className={control} disabled={pending||!ready} onClick={()=>void recover()}>Check project creation</button>}
    {intent&&canRetry&&canCreate&&<button type="button" className={control} disabled={pending||!ready||!catalogReady||!sameProjectCreationExecution(intent,execution)} title={!sameProjectCreationExecution(intent,execution)?'Reconnect the original workspace to retry.':undefined} onClick={()=>void retry()}>Retry saved creation</button>}
    {error&&<p role="alert" className="text-sm">{error}</p>}
   </form>
  </Overlay>
 </div>;
}
