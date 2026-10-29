"use client";

import { useState } from "react";
import Image from "next/image";
import DOMPurify from "dompurify";
import { renderMarkdown } from "../MarkdownDocument";
import { previewWorkArtifact, workSourceDownload, type WorkArtifact } from "./work-artifacts";

function ArtifactView({ artifact }: { artifact: WorkArtifact }) {
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const view = previewWorkArtifact(artifact);
  if (view.kind === "unavailable") return <p role="status" className="p-4 text-sm text-neutral-400">{view.reason}</p>;
  if (view.kind === "image" && failedUrl === view.url) return <p role="alert" className="p-4 text-sm text-neutral-400">The image could not be decoded. The original reference remains on the conversation.</p>;
  if (view.kind === "image") return <div className="p-3"><Image src={view.url} alt={artifact.name} unoptimized width={1200} height={800}
    onError={() => setFailedUrl(view.url)} className="mx-auto h-auto max-h-96 w-auto max-w-full object-contain p-3" />
    <a href={view.url} download={artifact.name} className="text-xs text-blue-300 underline">Download original image</a></div>;
  if (view.kind === "pdf") return <div className="space-y-2 p-3">
    <iframe sandbox="" referrerPolicy="no-referrer" src={view.url} title={`PDF preview: ${artifact.name}`} className="h-96 w-full rounded border border-white/10" />
    <p className="text-xs text-neutral-400">PDF preview uses the browser viewer with scripts and same-origin access disabled. If unavailable, download the original to use your PDF reader.</p>
    <a href={view.url} download={artifact.name} className="text-xs text-blue-300 underline">Download original PDF</a>
  </div>;
  let formatted = view.text;
  let jsonError: string | null = null;
  if (view.json && mode === "preview") {
    try { formatted = JSON.stringify(JSON.parse(view.text), null, 2); }
    catch { jsonError = "This file is not valid JSON. Its exact source is shown."; }
  }
  const markdown = mode === "preview" && view.markdown
    ? DOMPurify.sanitize(renderMarkdown(view.text), { FORBID_TAGS: ["img", "iframe", "object", "video", "audio", "source"], FORBID_ATTR: ["src", "srcset"] })
    : null;
  const download = workSourceDownload(view.text);
  return <div>
    <div className="p-2 text-xs">{download ? <a href={download} download={artifact.name}
      className="text-blue-300 underline">Download displayed UTF-8 source</a> : <p role="status">The source contains unsupported Unicode. Export is unavailable; its exact displayed source is retained.</p>}</div>
    {(view.markdown || view.json) && <div role="group" aria-label="Artifact presentation" className="flex gap-2 border-b border-white/10 p-2 text-xs">
      <button type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")} className="rounded border border-white/10 px-3 py-1">Source</button>
      <button type="button" aria-pressed={mode === "preview"} onClick={() => setMode("preview")} className="rounded border border-white/10 px-3 py-1">{view.markdown ? "Markdown preview" : "Format JSON"}</button>
    </div>}
    {jsonError && <p role="status" className="px-3 pt-3 text-xs text-amber-300">{jsonError}</p>}
    {markdown !== null ? <div className="prose prose-sm max-h-96 max-w-none overflow-auto p-4 text-neutral-200" dangerouslySetInnerHTML={{ __html: markdown }} />
      : <pre tabIndex={0} aria-label={`Source: ${artifact.name}`} className="max-h-96 overflow-auto whitespace-pre p-4 text-xs focus-visible:outline-blue-400">{formatted}</pre>}
  </div>;
}

export default function WorkArtifacts({ artifacts }: { artifacts: WorkArtifact[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const active = artifacts.find((artifact) => artifact.id === selected) ?? artifacts[0];
  if (!active) return <p className="py-4 text-sm text-neutral-400">No file attachments in this conversation.</p>;
  return <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
    <nav aria-label="Conversation files" className="flex flex-wrap gap-1 border-b border-white/10 p-2">
      {artifacts.map((artifact) => <button key={artifact.id} type="button" aria-pressed={active.id === artifact.id}
        onClick={() => setSelected(artifact.id)} className={`max-w-full truncate rounded px-3 py-2 text-xs focus-visible:outline-blue-400 ${active.id === artifact.id ? "bg-white/10" : "hover:bg-white/5"}`}>{artifact.name}</button>)}
    </nav>
    <div className="flex flex-wrap justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs text-neutral-400"><span>{active.mime}</span>
      <span>{active.size === undefined ? "Size not supplied by runtime" : `${active.size} bytes`}</span></div>
    <ArtifactView key={active.id} artifact={active} />
  </div>;
}
