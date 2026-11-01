"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {WorkConversation} from '../veyra-work/WorkShell';
import {createWorkspaceExecutionClient,type ConfirmedWorkspaceExecution} from './workspace-execution-client.mjs';
import {confirmWorkspaceProjectExecution,workspaceProjectMatchesExecution} from './workspace-project-execution.mjs';
import {useAuth} from '../../../lib/AuthContext';
import {useOrganization} from '../../../lib/OrganizationContext';
import {request} from '../../../lib/api';
import Overlay from '../Overlay';
import CreateWorkspaceProject from './CreateWorkspaceProject';
import {createWorkspaceProjectClient} from './workspace-project-catalog.mjs';
import type {ProjectRef} from '../../../../../../packages/veyra-projects/contracts';
const control="rounded px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-blue-400 disabled:opacity-40";
type ProjectConversations={execution?:ConfirmedWorkspaceExecution|null;conversations?:WorkConversation[];activeId?:string|null;onSelect?:(id:string)=>void;search?:string;onMatchingProject?:(value:{executionKey:string;label:string|null})=>void};
export default function HostedWorkspaceProjects(props:ProjectConversations){
 const {user}=useAuth(),{active}=useOrganization();
 if(!active)return <p role="status" className="px-3 text-xs text-neutral-400">Choose an organization to view projects.</p>;
 return <ActorProjects key={JSON.stringify([user.id,active.id])} ownerUserId={user.id} organizationId={active.id} canCreate={active.role==='owner'||active.role==='admin'} {...props}/>;
}
function ActorProjects({ownerUserId,organizationId,execution=null,conversations=[],activeId=null,onSelect,search='',onMatchingProject,canCreate}:{ownerUserId:string;organizationId:string;canCreate:boolean}&ProjectConversations){
 const router=useRouter();
 const [collapsed,setCollapsed]=useState<string[]>([]);
 const executionClient=useMemo(()=>createWorkspaceExecutionClient(request,{ownerUserId,organizationId}),[ownerUserId,organizationId]);
 const client=useMemo(()=>createWorkspaceProjectClient(request,{ownerUserId,organizationId}),[ownerUserId,organizationId]);
 const [rows,setRows]=useState<ProjectRef[]>([]),[archived,setArchived]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState<ProjectRef|null>(null),[name,setName]=useState(''),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[refresh,setRefresh]=useState(0);
 const alive=useRef(false),busy=useRef(false),generation=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++}},[]);
 useEffect(()=>{
  const current=++generation.current;setLoading(true);setError('');setRows([]);
  void client.list(archived).then(data=>{if(alive.current&&generation.current===current)setRows(data)}).catch(()=>{if(alive.current&&generation.current===current)setError('Projects could not be loaded. Refresh to recheck access.')}).finally(()=>{if(alive.current&&generation.current===current)setLoading(false)});
 },[client,archived,refresh]);
 useEffect(()=>{
  if(archived||loading)return;
  const matching=rows.filter(row=>workspaceProjectMatchesExecution(row,execution));
  onMatchingProject?.({executionKey:JSON.stringify(execution),label:matching.length===1?matching[0]!.label:null});
 },[rows,loading,archived,execution,onMatchingProject]);
 async function open(project:ProjectRef){
  if(busy.current)return;busy.current=true;setPending(true);setError('');
  try{const actual=await confirmWorkspaceProjectExecution(executionClient,project);if(alive.current)router.push('/work?'+new URLSearchParams({runtime:actual.runtimeId}).toString())}
  catch(error){if(alive.current)setError(error instanceof Error?error.message:'The project execution target could not be checked.')}
  finally{busy.current=false;if(alive.current)setPending(false)}
 }
 async function change(patch:{label?:string;pinned?:boolean;archived?:boolean}){
  if(!selected||busy.current||uncertain)return;busy.current=true;setPending(true);setError('');const original=selected;
  try{const actual=await client.update(original,patch);if(alive.current){setSelected(current=>current?.id===original.id?actual:current);setName(actual.label);setRefresh(n=>n+1)}}
  catch{if(alive.current){setUncertain(true);setError('This change is not confirmed. Refresh the selected project before making another change.')}}
  finally{busy.current=false;if(alive.current)setPending(false)}
 }
 async function check(){
  if(!selected||busy.current)return;busy.current=true;setPending(true);
  try{const actual=await client.get(selected.id);if(alive.current){setSelected(actual);setName(actual.label);setUncertain(false);setError('');setRefresh(n=>n+1)}}
  catch{if(alive.current)setError('The selected project could not be checked. Its current scope may no longer be available.')}
  finally{busy.current=false;if(alive.current)setPending(false)}
 }
 return <div className="space-y-1" aria-label="Workspace project catalog">
  <CreateWorkspaceProject client={client} ownerUserId={ownerUserId} organizationId={organizationId} execution={execution} canCreate={canCreate} catalogReady={!loading&&!archived&&!error} alreadyAdded={rows.some(row=>workspaceProjectMatchesExecution(row,execution))} onCreated={()=>{setArchived(false);setRefresh(n=>n+1)}}/>
  <div className="flex flex-wrap gap-1 px-2"><button type="button" className={control} onClick={()=>{setSelected(null);setArchived(v=>!v)}} disabled={pending}>{archived?'Active projects':'Archived projects'}</button><button type="button" className={control} onClick={()=>setRefresh(n=>n+1)} disabled={loading||pending} aria-label="Refresh projects">↻</button></div>
  {loading?<p role="status" className="px-3 py-1 text-xs text-neutral-400">Loading projects…</p>:<ul>{[...rows].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||a.label.localeCompare(b.label)).map(row=><li key={row.id}><div className="flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-xs hover:bg-white/5">
    {workspaceProjectMatchesExecution(row,execution)&&onSelect&&<button type="button" aria-label={"Toggle chats for "+row.label} aria-expanded={!collapsed.includes(row.id)} aria-controls={"workspace-project-chats-"+row.id} className={control} onClick={()=>setCollapsed(current=>current.includes(row.id)?current.filter(id=>id!==row.id):[...current,row.id])}>{collapsed.includes(row.id)?"▸":"▾"}</button>}
    <button type="button" disabled={pending||row.archived} onClick={event=>{event.preventDefault();void open(row)}} aria-current={workspaceProjectMatchesExecution(row,execution)?'page':undefined} className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left focus-visible:outline-blue-400 disabled:opacity-40"><span aria-hidden="true">▱</span><span className="truncate">{row.label}</span>{row.pinned&&<span className="ml-auto text-neutral-400" aria-label="Pinned project">●</span>}</button>
    <button type="button" aria-label={'Project settings for '+row.label} disabled={pending} onClick={event=>{event.preventDefault();setSelected(row);setName(row.label);setUncertain(false);setError('')}} className={control}>•••</button>
   </div>
   {workspaceProjectMatchesExecution(row,execution)&&onSelect&&<ul id={"workspace-project-chats-"+row.id} hidden={collapsed.includes(row.id)} className="pl-5">{conversations.filter(chat=>chat.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(chat=><li key={chat.id}><button type="button" onClick={()=>onSelect(chat.id)} aria-current={activeId===chat.id?'page':undefined} className="flex w-full min-w-0 items-center gap-2 rounded px-3 py-2 text-left text-xs hover:bg-white/5 focus-visible:outline-blue-400"><span className="truncate">{chat.title}</span>{chat.busy&&<span className="ml-auto" aria-label="Running">◌</span>}</button></li>)}</ul>}
  </li>)}</ul>}
  {!loading&&!error&&rows.length===0&&<p className="px-3 py-1 text-xs text-neutral-400">{archived?'No archived projects.':'No workspace projects yet.'}</p>}
  {error&&!selected&&<p role="alert" className="px-3 py-1 text-xs">{error}</p>}
  <Overlay isOpen={selected!==null} onClose={()=>setSelected(null)} title={selected?.label??'Project'} subtitle="Workspace project">
   {selected&&<div className="space-y-4">
    <form onSubmit={event=>{event.preventDefault();void change({label:name})}} className="space-y-2"><label className="block text-sm">Project name<input value={name} onChange={event=>setName(event.target.value)} required maxLength={200} disabled={pending||uncertain} className="mt-1 block w-full rounded border border-[var(--color-border)] bg-transparent p-2"/></label><button type="submit" className={control} disabled={pending||uncertain||name.trim()!==name||name===selected.label}>Rename project</button></form>
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={pending||uncertain} onClick={()=>void change({pinned:!selected.pinned})}>{selected.pinned?'Unpin project':'Pin project'}</button><button type="button" className={control} disabled={pending||uncertain} onClick={()=>void change({archived:!selected.archived})}>{selected.archived?'Restore project':'Archive project'}</button><button type="button" className={control} disabled={pending} onClick={()=>void check()}>Refresh selected project</button></div>
    <h3 className="text-sm font-medium">Folders</h3>{selected.roots.length?<ul className="space-y-2">{selected.roots.map(root=><li key={root.id} className="break-all text-sm">{root.displayPath}{root.isPrimary?' · Primary':''}</li>)}</ul>:<p className="text-sm text-[var(--color-text-muted)]">No folder attached.</p>}
    <p className="text-xs text-[var(--color-text-muted)]">Archiving keeps this project and its folders available for restore.</p>
    {pending&&<p role="status" className="text-sm">Checking project…</p>}{error&&<p role="alert" className="text-sm">{error}</p>}
   </div>}
  </Overlay>
 </div>;
}
