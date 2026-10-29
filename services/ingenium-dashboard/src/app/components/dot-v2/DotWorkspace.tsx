"use client";

import { useState } from "react";
import type { DotScope, DotSnapshot, Suggestion } from "../../../../../../packages/veyra-automation/contracts.js";
import { approvalSchedule, operationLabel, scheduleLabel, type DotUICommand, type DotActionResult } from "./view-model";

export interface DotWorkspaceProps {
  scope: DotScope;
  initialSnapshot: DotSnapshot;
  jobChoices: {id:string;title:string;suggestionId:string}[];
  loadMoreAction: (section: keyof DotSnapshot["nextCursors"], cursor:string) => Promise<DotSnapshot>;
  commandAction: (command: DotUICommand) => Promise<DotActionResult>;
  refreshAction: () => Promise<DotSnapshot>;
}
const control = "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50";

export default function DotWorkspace(props: DotWorkspaceProps) {
 const key=JSON.stringify(props.scope);
 return <DotWorkspaceSession key={key} {...props}/>;
}

function DotWorkspaceSession({scope,initialSnapshot,jobChoices,commandAction,refreshAction,loadMoreAction}: DotWorkspaceProps) {
 const [snapshot,setSnapshot]=useState(initialSnapshot),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null),[uncertain,setUncertain]=useState(false),[selected,setSelected]=useState<Suggestion|null>(null);
 async function send(command: DotUICommand) {
  if(pending || uncertain)return;
  setPending(true);setError(null);
  try {
   const result=await commandAction(command);
   if(result.ok){setSnapshot(result.snapshot);setSelected(null);}
   else{setError(result.message);setUncertain(result.outcome==="unknown");}
  }catch{setError("The request outcome is unknown. Refresh operation history before taking another action.");setUncertain(true);}
  finally{setPending(false);}
 }
 async function refresh() {
  setPending(true);
  try{setSnapshot(await refreshAction());setUncertain(false);setError(null);setSelected(null);}
  catch{setError("Dot could not refresh. Your previous request may still be pending.");}
  finally{setPending(false);}
 }
 const disabled=pending||uncertain;
 return <main className="mx-auto w-full max-w-5xl space-y-8 p-4 text-[var(--color-text-primary)] sm:p-8" aria-busy={pending}>
  <header className="flex flex-wrap items-start justify-between gap-4">
   <div><h1 className="text-2xl font-semibold">Your dot</h1><p className="mt-2 text-sm text-[var(--color-text-muted)]">Suggestions and follow-ups for this conversation.</p><p className="mt-1 break-all text-xs text-[var(--color-text-muted)]">{scope.projectId??"Projectless"} · {scope.executionBindingId} · {scope.conversationId??"No conversation"}</p></div>
   <button className={control} disabled={pending} onClick={()=>void refresh()}>Refresh status</button>
  </header>
  {error&&<p role="alert" className="rounded-lg border border-amber-500 p-3 text-sm">{error}</p>}
  <section aria-labelledby="dot-suggestions"><h2 id="dot-suggestions" className="mb-3 text-lg font-medium">Suggestions</h2>
   {!snapshot.suggestions.some(s=>s.state==="proposed")&&<p className="text-sm text-[var(--color-text-muted)]">No suggestions for this scope. Dot will surface relevant follow-ups here.</p>}
   <div className="grid gap-3 sm:grid-cols-2">{snapshot.suggestions.filter(s=>s.state==="proposed").map(s=><article key={s.id} className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
    <h3 className="font-medium">{s.title}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--color-text-secondary)]">{s.prompt}</p><p className="mt-3 break-all text-xs text-[var(--color-text-muted)]">Source: {s.source.kind} · {s.source.reference}</p>
    <p className="mt-2 text-xs text-[var(--color-text-muted)]">Capabilities: {s.capabilities.join(", ")||"None"}</p>
    <div className="mt-4 flex flex-wrap gap-2"><button className={control} disabled={disabled} onClick={()=>setSelected(s)}>Review follow-up</button><button className={control} disabled={disabled} onClick={()=>void send({type:"dismiss",id:s.id,revision:s.revision})}>Dismiss</button></div>
   </article>)}</div>
  </section>
  {selected&&<section className="rounded-xl border border-blue-500 p-4" aria-labelledby="dot-review">
   <h2 id="dot-review" className="font-medium">Schedule: {selected.title}</h2><p className="mt-2 text-sm text-[var(--color-text-muted)]">Review the task, target and time. Tool and external-message permissions still apply at execution.</p>
   <form className="mt-4 grid gap-3 sm:grid-cols-2" action={async data=>{
    try{
     const value=(key:string)=>String(data.get(key)??"");
     const schedule=approvalSchedule({kind:value("kind"),at:value("at"),timeZone:value("timeZone"),hour:value("hour"),minute:value("minute"),fold:value("fold")});
     const jobId=value("jobId").trim();if(!jobId)throw Error("Choose an authorized task matching this suggestion and target.");
     await send({type:"approve",id:selected.id,revision:selected.revision,input:{jobId,schedule,missedPolicy:value("missedPolicy") as "skip"|"latest"|"all",notificationPolicy:value("notificationPolicy") as "meaningful"|"failures"|"silent"}});
    }catch(e){setError(e instanceof Error?e.message:"Check the schedule fields.");}
   }}>
    <label className="grid gap-1 text-sm">Task template<select className={control} name="jobId" required><option value="">Choose a matching task</option>{jobChoices.filter(j=>j.suggestionId===selected.id).map(j=><option key={j.id} value={j.id}>{j.title}</option>)}</select></label>
    <label className="grid gap-1 text-sm">Schedule<select name="kind" className={control}><option value="calendar">Daily local time</option><option value="once">Once at UTC time</option></select></label>
    <label className="grid gap-1 text-sm">Timezone<input className={control} name="timeZone" placeholder="America/Toronto"/></label>
    <div className="flex gap-2"><label className="grid flex-1 gap-1 text-sm">Hour<input className={control} name="hour" type="number" min="0" max="23" defaultValue="9"/></label><label className="grid flex-1 gap-1 text-sm">Minute<input className={control} name="minute" type="number" min="0" max="59" defaultValue="0"/></label></div>
    <label className="grid gap-1 text-sm">Once (UTC)<input className={control} name="at" placeholder="2026-11-01T14:00:00Z"/></label>
    <label className="grid gap-1 text-sm">Repeated DST time<select name="fold" className={control}><option value="earlier">First occurrence</option><option value="later">Second occurrence</option><option value="both">Both occurrences</option></select></label>
    <label className="grid gap-1 text-sm">Missed runs<select name="missedPolicy" className={control}><option value="skip">Skip</option><option value="latest">Run latest once</option><option value="all">Catch up (bounded)</option></select></label>
    <label className="grid gap-1 text-sm">Notifications<select name="notificationPolicy" className={control}><option value="meaningful">Meaningful changes</option><option value="failures">Failures or required attention</option><option value="silent">Silent</option></select></label>
    <div className="flex gap-2"><button className={control} type="submit" disabled={disabled}>Authorize follow-up</button><button className={control} type="button" disabled={pending} onClick={()=>setSelected(null)}>Close review</button></div>
   </form>
  </section>}
  <section aria-labelledby="dot-followups"><h2 id="dot-followups" className="mb-3 text-lg font-medium">Follow-ups</h2>
   {!snapshot.followups.length&&<p className="text-sm text-[var(--color-text-muted)]">No authorized follow-ups.</p>}
   <ul className="space-y-3">{snapshot.followups.map(f=><li key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] p-4"><div className="min-w-0"><p className="break-words text-sm">{scheduleLabel(f.schedule)}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{f.state} · Missed: {f.missedPolicy} · Notifications: {f.notificationPolicy}</p></div>{f.state!=="cancelled"&&<details className="w-full text-sm"><summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-400">Missed-run recovery</summary><p className="my-2 text-[var(--color-text-muted)]">Skip pending occurrences after {f.cursor} through the current server time. Existing runs keep their current state. Paused follow-ups stay paused.</p><button className={control} disabled={disabled} onClick={()=>void send({type:"skip-missed",id:f.id,revision:f.revision})}>Skip missed runs</button></details>}{f.state!=="cancelled"&&<div className="flex gap-2"><button className={control} disabled={disabled} onClick={()=>void send({type:"pause",id:f.id,revision:f.revision,paused:f.state!=="paused"})}>{f.state==="paused"?"Resume":"Pause"}</button><button className={control} disabled={disabled} onClick={()=>void send({type:"cancel",id:f.id,revision:f.revision})}>Cancel</button></div>}</li>)}</ul>
  </section>
  <section aria-labelledby="dot-history"><h2 id="dot-history" className="mb-3 text-lg font-medium">Operation history</h2>{!snapshot.operations.length&&<p className="text-sm text-[var(--color-text-muted)]">No operations yet.</p>}<ol className="space-y-2">{snapshot.operations.map(op=><li key={op.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm"><p>{operationLabel(op.state)}</p><p className="mt-1 break-all text-xs text-[var(--color-text-muted)]">{op.scheduledFor} · {op.runId??"No run started"}{op.code?` · ${op.code}`:""}</p></li>)}</ol></section>
  <section aria-labelledby="dot-queue"><h2 id="dot-queue" className="mb-3 text-lg font-medium">Event queue</h2><p className="mb-2 text-xs text-[var(--color-text-muted)]">From the existing job event queue.</p>{!snapshot.queue.length&&<p className="text-sm text-[var(--color-text-muted)]">No queued events in this scope.</p>}<ul>{snapshot.queue.map(e=><li key={e.id} className="break-all py-2 text-sm">{e.state} · {e.id}</li>)}</ul></section>
  <section aria-labelledby="dot-notifications"><h2 id="dot-notifications" className="mb-3 text-lg font-medium">Notifications</h2>{!snapshot.notifications.length&&<p className="text-sm text-[var(--color-text-muted)]">No updates need your attention.</p>}<ul className="space-y-2">{snapshot.notifications.map(n=><li key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] p-3"><span className="text-sm">{n.title}</span>{!n.read&&<button className={control} disabled={disabled} onClick={()=>void send({type:"read",id:n.id,revision:n.revision})}>Mark read</button>}</li>)}</ul></section>
  <nav aria-label="More Dot records" className="flex flex-wrap gap-2">{Object.entries(snapshot.nextCursors).filter(([,cursor])=>cursor).map(([section,cursor])=><button key={section} className={control} disabled={pending} onClick={()=>void (async()=>{setPending(true);try{setSnapshot(await loadMoreAction(section as keyof DotSnapshot["nextCursors"],cursor!));}catch{setError("Could not load more records.");}finally{setPending(false);}})()}>More {section}</button>)}</nav>
 </main>;
}
