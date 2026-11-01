"use client";
import {useEffect,useId,useRef,useState} from "react";
import type {RuntimeWorkspaceRegistration} from "@/lib/use-runtime-launch";

/** Shared picker action. Selection comes from the server's account assignments;
 * the browser never supplies a path, claim, host or execution authority. */
export default function WorkspaceRegistration({registration}:{registration:RuntimeWorkspaceRegistration}){
 const id=useId(),generation=useRef(0);
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
 const [options,setOptions]=useState<Array<{workspaceId:string;label:string;kind:'cluster'}>>([]),[selected,setSelected]=useState(''),[error,setError]=useState<string|null>(null);
 useEffect(()=>{generation.current++;setOpen(false);setLoading(false);setSaving(false);setOptions([]);setSelected('');setError(null);return()=>{generation.current++};},[registration]);
 const button="rounded border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50";
 async function load(){
  const g=++generation.current;setOpen(true);setLoading(true);setError(null);
  try{const rows=await registration.available();if(g!==generation.current)return;setOptions(rows);setSelected(rows[0]?.workspaceId??'');}
  catch(cause){if(g===generation.current)setError((cause as {status?:number})?.status===403?'Your organization permissions do not allow adding workspaces.':cause instanceof Error?cause.message:'Assigned workspaces could not be loaded.');}
  finally{if(g===generation.current)setLoading(false);}
 }
 async function prepare(){
  if(!selected||saving)return;const g=generation.current;setSaving(true);setError(null);
  try{await registration.prepare(selected);if(g===generation.current){setOpen(false);setOptions([]);setSelected('');}}
  catch(cause){if(g===generation.current)setError(cause instanceof Error?cause.message:'The workspace could not be added.');}
  finally{if(g===generation.current)setSaving(false);}
 }
 return <section className="mt-4 border-t border-[var(--color-border)] pt-4 text-left" aria-label="Add assigned workspace">
  {!open?<button type="button" onClick={()=>{void load()}} className={button}>Add workspace</button>:<>
   <p className="text-sm text-[var(--color-text-secondary)]">Choose a workspace assigned to this account. You can open it after adding it.</p>
   {loading?<p role="status" className="mt-3 text-sm">Loading assigned workspaces…</p>:options.length>0?<label htmlFor={id} className="mt-3 block text-sm text-[var(--color-text-primary)]">
    Assigned workspace
    <select id={id} value={selected} onChange={event=>setSelected(event.target.value)} disabled={saving} className="mt-1 block w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
     {options.map(option=><option key={option.workspaceId} value={option.workspaceId}>{option.label} · Cluster</option>)}
    </select>
   </label>:!error&&<p role="status" className="mt-3 text-sm text-[var(--color-text-secondary)]">No additional workspaces are assigned to this account.</p>}
   {error&&<p role="alert" className="mt-3 text-sm text-[var(--color-error-text)]">{error}</p>}
   <div className="mt-3 flex flex-wrap gap-2">
    <button type="button" disabled={loading||saving} onClick={()=>{void load()}} className={button}>Refresh</button>
    <button type="button" disabled={loading||saving} onClick={()=>{generation.current++;setOpen(false)}} className={button}>Cancel</button>
    {options.length>0&&<button type="button" onClick={()=>{void prepare()}} disabled={!selected||loading||saving} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{saving?'Adding workspace…':'Add workspace'}</button>}
   </div>
  </>}
 </section>;
}
