"use client";

import { useState } from "react";
import { normalizeWorkChanges, parseWorkPatch, splitWorkRows, type WorkDiffRow, type WorkFileChange } from "./work-diff";

const tones = { add: "bg-emerald-950/40 text-emerald-200", remove: "bg-red-950/40 text-red-200", header: "bg-blue-950/30 text-blue-200", context: "text-neutral-300", meta: "text-neutral-400" };

function PatchLine({ row, wrap = false }: { row: WorkDiffRow; wrap?: boolean }) {
  return <div className={`flex ${wrap ? "min-w-0" : "min-w-max"} ${tones[row.kind]}`}>
    <span aria-hidden="true" className="w-12 shrink-0 select-none px-2 text-right text-neutral-500">{row.oldLine}</span>
    <span aria-hidden="true" className="w-12 shrink-0 select-none px-2 text-right text-neutral-500">{row.newLine}</span>
    <code className={`${wrap ? "min-w-0 whitespace-pre-wrap break-all" : "whitespace-pre"} px-2`}>{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}{row.text || " "}</code>
  </div>;
}

export default function WorkChanges({ value }: { value: unknown }) {
  const [mode, setMode] = useState<"unified" | "split" | "source">("unified");
  let changes: WorkFileChange[];
  try { changes = normalizeWorkChanges(value); }
  catch (error: unknown) { return <div role="alert" className="text-sm"><p>{error instanceof Error ? error.message : "Changes could not be displayed."}</p>
    <details className="mt-3"><summary className="cursor-pointer">Original response</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre></details></div>; }
  if (!changes.length) return <p className="py-4 text-sm text-neutral-400">No file changes in this conversation.</p>;
  return <div>
    <div role="group" aria-label="Change presentation" className="my-3 flex gap-2 text-xs">
      {(["unified", "split", "source"] as const).map((view) => <button key={view} type="button" aria-pressed={mode === view}
        onClick={() => setMode(view)} className={`rounded border border-white/10 px-3 py-1 capitalize focus-visible:outline-blue-400 ${view === mode ? "bg-white/10" : ""}`}>{view}</button>)}
    </div>
    <div className="space-y-3">{changes.map((change, index) => {
      const rows = change.patch === undefined ? null : parseWorkPatch(change.patch);
      return <details key={`${index}:${change.path}`} open className="overflow-hidden rounded-lg border border-white/10">
        <summary className="cursor-pointer break-all bg-white/5 px-3 py-2 text-xs">{change.path} <span className="text-emerald-300">+{change.additions}</span> <span className="text-red-300">−{change.deletions}</span></summary>
        {mode === "source" ? <pre className="max-h-96 overflow-auto p-3 text-xs">{change.patch ?? JSON.stringify({ before: change.before, after: change.after }, null, 2)}</pre>
          : change.patch !== undefined && rows ? mode === "unified" ? <div role="region" aria-label={`Unified changes for ${change.path}`} tabIndex={0} className="max-h-96 overflow-auto py-2 font-mono text-xs focus-visible:outline-blue-400">
            {rows.map((row, rowIndex) => <PatchLine key={rowIndex} row={row} />)}
          </div> : <div role="region" aria-label={`Split changes for ${change.path}`} tabIndex={0} className="max-h-96 overflow-auto py-2 font-mono text-xs">
            <div className="grid grid-cols-2 text-neutral-400"><h3 className="px-3 pb-2">Before</h3><h3 className="px-3 pb-2">After</h3></div>
            {splitWorkRows(rows).map((pair, rowIndex) => <div key={rowIndex} className="grid grid-cols-2 divide-x divide-white/10">
              <div className="min-w-0">{pair.before ? <PatchLine row={pair.before} wrap /> : <div aria-hidden="true">&nbsp;</div>}</div>
              <div className="min-w-0">{pair.after ? <PatchLine row={pair.after} wrap /> : <div aria-hidden="true">&nbsp;</div>}</div>
            </div>)}
          </div>
          : change.before !== undefined && change.after !== undefined ? <div className="grid gap-0 divide-y divide-white/10 text-xs md:grid-cols-2 md:divide-x md:divide-y-0">
            <section><h3 className="p-2 text-neutral-400">Before</h3><pre tabIndex={0} className="max-h-96 overflow-auto p-3">{change.before || "(empty file)"}</pre></section>
            <section><h3 className="p-2 text-neutral-400">After</h3><pre tabIndex={0} className="max-h-96 overflow-auto p-3">{change.after || "(empty file)"}</pre></section>
          </div> : <div className="p-3"><p className="mb-2 text-xs text-neutral-400">This patch cannot be represented as verified text hunks. Original patch:</p><pre tabIndex={0} className="max-h-96 overflow-auto text-xs">{change.patch}</pre></div>}
      </details>;
    })}</div>
  </div>;
}
