"use client";

import {useId, useState, type FormEvent} from "react";
import type {TerminalView} from "../../../../../../packages/veyra-projects/contracts";

export function TerminalPanel({bindingKey, available, terminals, activeId, pending, error, onSelect, onOpen, onInput, onResize, onClose}: {
  bindingKey: string;
  available: boolean;
  terminals: TerminalView[];
  activeId: string | null;
  pending: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onOpen: () => void;
  onInput: (id: string, data: string) => Promise<"succeeded" | "failed" | "unknown">;
  onResize: (id: string, columns: number, rows: number) => void;
  onClose: (id: string) => void;
}) {
  const id=useId();
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [sending,setSending]=useState(false);
  const [unknown,setUnknown]=useState<Record<string,number>>({});
  const active=terminals.find(t=>t.id===activeId);
  const draftKey=JSON.stringify([bindingKey,active?.id]);
  const blocked=active !== undefined && (active.inputState==="unknown" || unknown[draftKey]===active.revision);
  const writable=Boolean(active?.state==="running" && active.inputState==="idle" && available && !pending && !sending && !blocked);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !writable) return;
    const sent=drafts[draftKey] ?? "";
    setSending(true);
    try {
      const result=await onInput(active.id,sent+"\r");
      if (result==="succeeded") setDrafts(current=>
        current[draftKey]===sent ? {...current,[draftKey]:""} : current);
      if (result==="unknown") setUnknown(current=>({...current,[draftKey]:active.revision}));
    } catch {
      setUnknown(current=>({...current,[draftKey]:active.revision}));
    } finally { setSending(false); }
  }
  return <section className="flex min-h-48 min-w-0 flex-col gap-2" aria-label="Terminals" data-testid="project-terminal-panel">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Terminal sessions">
      {terminals.map(terminal=><button key={terminal.id} type="button" aria-pressed={activeId===terminal.id}
        className="rounded border border-current px-3 py-1 focus-visible:outline-2" onClick={()=>onSelect(terminal.id)}>
        {terminal.title} · {terminal.state}
      </button>)}
      <button type="button" disabled={pending || !available} onClick={onOpen} className="rounded border border-current px-3 py-1">
        New terminal
      </button>
    </div>
    {active ? <>
      {blocked && <p role="alert" className="text-sm">Input outcome unknown. Reconcile the original operation before sending again.</p>}
      {active.gap && <p role="status" className="text-sm">Earlier output is no longer retained by the terminal owner.</p>}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-current p-3 font-mono text-sm"
        tabIndex={0} aria-label={active.title+" output"}>{active.output || "Waiting for terminal output…"}</pre>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={id+"-input"}>Terminal input</label>
        <input id={id+"-input"} value={drafts[draftKey] ?? ""} disabled={!writable} autoComplete="off"
          className="min-w-0 flex-1 rounded border border-current bg-transparent p-2 font-mono"
          onChange={event=>setDrafts(current=>({...current,[draftKey]:event.target.value}))}/>
        <button disabled={!writable} className="rounded border border-current px-3">Send</button>
        <button type="button" disabled={!writable} onClick={()=>onResize(active.id,120,30)}
          className="rounded border border-current px-3">Resize to 120 × 30</button>
        <button type="button" disabled={pending || active.state==="closed"} onClick={()=>onClose(active.id)}
          className="rounded border border-current px-3">Close</button>
      </form>
    </> : <p className="text-sm">Open a terminal on the selected execution target.</p>}
    {error && <p role="alert" className="text-sm">{error}</p>}
  </section>;
}
