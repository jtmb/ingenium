"use client";

import { useRef, type ReactNode } from "react";
import { canSendWork, type WorkDraft, type WorkModel } from "./work-state";
export type { WorkModel } from "./work-state";

export default function WorkComposer({ draft, onChange, onSend, onStop, ready, pending, streaming,
  models, projectControl, environmentControl, permissionControl, memoryControl, voiceControl, onAttach,
}: {
  draft: WorkDraft; onChange: (draft: WorkDraft) => void; onSend: () => void; onStop: () => void;
  ready: boolean; pending: boolean; streaming: boolean; models: WorkModel[];
  projectControl?: ReactNode; environmentControl?: ReactNode; permissionControl?: ReactNode;
  memoryControl?: ReactNode; voiceControl?: ReactNode;
  onAttach?: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const selectedModel = models.find((model) => model.providerId === draft.providerId && model.modelId === draft.modelId);
  const selectionAvailable = Boolean(selectedModel && (!draft.variant || selectedModel.variants?.includes(draft.variant)));
  const sendable = canSendWork({ ready: ready && selectionAvailable, pending: pending || streaming, draft });
  return <div className="mx-auto w-full max-w-[740px] px-3 pb-4">
    <div className="mx-3 flex flex-wrap items-center gap-3 rounded-t-xl bg-[#262424] px-3 py-2 text-xs text-neutral-300">
      {projectControl}{environmentControl}{memoryControl}
    </div>
    <form aria-label="Work composer" onSubmit={(event) => { event.preventDefault(); if (sendable) onSend(); }}
      className="rounded-[22px] border border-white/5 bg-[#333131] p-3 shadow-sm">
      {draft.attachments.length > 0 && <ul aria-label="Attachments" className="flex flex-wrap gap-2 pb-2">
        {draft.attachments.map((attachment) => <li key={attachment.id} className="rounded-lg bg-white/10 px-2 py-1 text-xs">
          {attachment.name} <button type="button" aria-label={`Remove ${attachment.name}`} disabled={pending}
            onClick={() => onChange({ ...draft, attachments: draft.attachments.filter((item) => item.id !== attachment.id) })}>×</button>
        </li>)}
      </ul>}
      <label htmlFor="veyra-work-message" className="sr-only">Message the working agent</label>
      <textarea ref={input} id="veyra-work-message" value={draft.text} rows={2} placeholder="Ask Veyra to build something…"
        disabled={pending} className="max-h-48 min-h-12 w-full resize-y bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-blue-400"
        onChange={(event) => onChange({ ...draft, text: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); if (sendable) onSend();
          }
        }} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300">
        {onAttach && <button type="button" onClick={onAttach} aria-label="Attach files" disabled={pending || streaming}
          className="h-8 w-8 rounded-full text-lg hover:bg-white/10 disabled:opacity-40 focus-visible:outline-blue-400">＋</button>}
        {permissionControl}
        <label className="ml-auto"> <span className="sr-only">Model</span>
          <select aria-label="Work model" value={draft.providerId && draft.modelId ? JSON.stringify([draft.providerId, draft.modelId]) : ""}
            disabled={pending || streaming} className="max-w-52 rounded bg-[#333131] p-1 focus-visible:outline-blue-400"
            onChange={(event) => {
              const model = models.find((item) => JSON.stringify([item.providerId, item.modelId]) === event.target.value);
              if (model) onChange({ ...draft, providerId: model.providerId, modelId: model.modelId, variant: "", selectionOrigin: "explicit" });
            }}>
            <option value="" disabled>Select model</option>
            {!selectedModel && draft.providerId && draft.modelId && <option value={JSON.stringify([draft.providerId, draft.modelId])} disabled>Unavailable: {draft.providerId} / {draft.modelId}</option>}
            {models.map((model) => <option key={JSON.stringify([model.providerId, model.modelId])}
              value={JSON.stringify([model.providerId, model.modelId])}>{model.label}</option>)}
          </select>
        </label>
        {selectedModel?.variants?.length || draft.variant ? <select aria-label="Reasoning effort" value={draft.variant} disabled={pending || streaming}
          className="rounded bg-[#333131] p-1" onChange={(event) => onChange({ ...draft, variant: event.target.value, selectionOrigin: "explicit" })}>
          <option value="">Default reasoning</option>
          {draft.variant && !selectedModel?.variants?.includes(draft.variant) && <option value={draft.variant} disabled>Unavailable effort: {draft.variant}</option>}
          {selectedModel?.variants?.map((variant) => <option key={variant}>{variant}</option>)}
        </select> : null}
        {voiceControl}
        {streaming ? <button type="button" onClick={onStop} aria-label="Stop response" className="h-8 w-8 rounded-full bg-white text-black">■</button>
          : <button type="submit" disabled={!sendable} aria-label="Send message" className="h-8 w-8 rounded-full bg-blue-500 text-lg text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue-300">↑</button>}
      </div>
    </form>
  </div>;
}
