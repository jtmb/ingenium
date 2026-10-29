"use client";

import { useEffect, useState } from "react";
import { useRuntime } from "@/lib/RuntimeContext";
import { useRuntimeLaunch } from "@/lib/use-runtime-launch";
import { workWebSessionUrl } from "./work-web";

export default function WorkWebFrame({ sessionId }: { sessionId: string | null }) {
  const { workspace } = useRuntime();
  const launch = useRuntimeLaunch("web", workspace, sessionId !== null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  let url: string | null = null;
  let protocolError: string | null = null;
  if (sessionId && launch.status === "ready" && launch.url) {
    try { url = workWebSessionUrl(launch.url, sessionId); }
    catch (error: unknown) { protocolError = error instanceof Error ? error.message : "Web session link is unavailable."; }
  }

  useEffect(() => {
    if (!url || loadedUrl === url || failedUrl === url) return;
    const timer = setTimeout(() => setFailedUrl(url), 15_000);
    return () => clearTimeout(timer);
  }, [failedUrl, loadedUrl, url]);

  if (workspace.status !== "ready") return <p role="alert" className="p-6 text-sm">The selected runtime is unavailable. Reconnect its authorized workspace before opening Web.</p>;
  if (!sessionId) return <p role="status" className="p-6 text-sm text-neutral-400">Select a conversation in Work before opening its Web view.</p>;
  if (protocolError || launch.status === "expired" || launch.status === "unavailable" || failedUrl === url && url !== null) {
    return <div role="alert" className="p-6 text-sm"><p>{protocolError ?? launch.error ?? "The Web session did not load in time."}</p>
      <p className="mt-2 text-neutral-400">The Work conversation and draft are retained. No replacement conversation was created.</p>
      <button type="button" className="mt-3 rounded border border-white/20 px-3 py-2" onClick={() => {
        setFailedUrl(null); setLoadedUrl(null); launch.retry();
      }}>Retry Web connection</button></div>;
  }
  return <div className="relative min-h-0 flex-1">
    {url === null || loadedUrl !== url ? <p role="status" className="p-4 text-xs text-neutral-400">Opening this conversation in upstream OpenCode Web…</p> : null}
    {url !== null && <iframe key={url} src={url} title="OpenCode Web — selected conversation" className="absolute inset-0 h-full w-full border-0"
      allow="clipboard-write" onLoad={() => setLoadedUrl(url)} onError={() => setFailedUrl(url)} />}
  </div>;
}
