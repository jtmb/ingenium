"use client";
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {request} from '../../../lib/api';
import {createCatalogConnection,type CatalogConnection as Connection,type CatalogConnectionResult} from './catalog-connection.mjs';
import {scopedHref,type CustomizeEntry} from './catalog.mjs';
export default function CatalogConnection({entry}:{entry:CustomizeEntry}){
 const [connection,setConnection]=useState<Connection|null>(null),[name,setName]=useState(''),[pending,setPending]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<CatalogConnectionResult|null>(null);
 const alive=useRef(false),running=useRef(false);
 useEffect(()=>{
  alive.current=true;
  try{const owner=createCatalogConnection({entry,request,storage:window.sessionStorage,randomUUID:()=>crypto.randomUUID()}),held=owner.pending();setConnection(owner);setPending(held!==null);if(held)setName(held.targetName)}catch{setError('Connection recovery is unavailable. No command will be sent.')}
  return()=>{alive.current=false};
 },[entry]);
 async function run(check:boolean){
  if(!connection||running.current)return;running.current=true;setBusy(true);setError('');
  try{const next=check?await connection.inspect():await connection.connect(name);if(alive.current)setResult(next)}
  catch{if(alive.current)setError('The outcome is not confirmed. Check the saved operation; it will not be sent again.')}
  finally{running.current=false;if(alive.current){setBusy(false);try{setPending(connection.pending()!==null)}catch{setPending(true)}}}
 }
 const canConnect=entry.actions?.includes('connect')&&!entry.installed;
 const manage=entry.catalog&&scopedHref('/customize/'+(entry.kind==='plugin'?'plugins':'skills')+'/manage',entry.catalog.apiProject);
 return <section aria-label="Catalog connection" className="space-y-3 border-t border-[var(--color-border)] pt-4">
  {canConnect&&!pending&&<form onSubmit={event=>{event.preventDefault();void run(false)}} className="space-y-3">
   <label className="block text-sm">Name in this project<input className="mt-1 block w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2" value={name} onChange={e=>setName(e.target.value)} required pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" maxLength={64} disabled={busy||!connection}/></label>
   <p className="text-xs text-[var(--color-text-muted)]">{entry.kind==='plugin'?'The plugin will be added disabled. Review its configuration and credentials before enabling.':'The skill will be submitted as a draft proposal for review.'}</p>
   <button type="submit" disabled={busy||!connection} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">{busy?'Connecting…':'Connect to project'}</button>
  </form>}
  {pending&&<><p className="text-sm">A connection operation is saved for this source. Check its receipt to recover the outcome.</p><button type="button" disabled={busy||!connection} onClick={()=>void run(true)} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50">{busy?'Checking…':'Check connection status'}</button></>}
  {result&&<div role="status" className="space-y-2 text-sm">
   <p>{result.outcome==='succeeded'?(entry.kind==='skill'?'Draft proposal created. Review and approve it to install the skill.':'Plugin added disabled. Review its configuration before enabling.') :result.outcome==='refused'?'The original connection was refused. Review it before attempting a new operation.':'The connection is not settled. Check its receipt again.'}</p>
   {result.sourceChanged&&<p>The catalog source has changed since this operation started. This receipt belongs to the saved version.</p>}
   <p className="break-all text-xs text-[var(--color-text-muted)]">Operation: {result.operationId}</p>
  </div>}
  {error&&<p role="alert" className="text-sm">{error}</p>}
  {manage&&<Link className="inline-block text-sm underline" href={manage}>{entry.kind==='skill'?'Open proposals and lifecycle controls':'Open plugin configuration'}</Link>}
 </section>;
}
