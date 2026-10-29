"use client";

import { useCallback, useTransition } from "react";
import ChatShell from "./components/ChatShell";
import RuntimeWorkspacePicker from "../components/RuntimeWorkspacePicker";
import { useRuntime } from "@/lib/RuntimeContext";
import { useProject } from "@/lib/ProjectContext";
import { useRouter, useSearchParams } from "next/navigation";

/** Standalone Chat keeps the selected native session in its scoped URL. */
export default function ChatPage() {
  const runtime = useRuntime();
  const project = useProject();
  const router = useRouter();
  const params = useSearchParams();
  const [navigationPending, startNavigation] = useTransition();
  const requestedRuntime = params.get("runtime");
  const sessionId = params.get("session");
  const onActiveSessionChange = useCallback((id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id === null) next.delete("session");
    else next.set("session", id);
    next.set("runtime", runtime.runtimeId ?? "compatibility");
    next.set("project", runtime.projectName ?? project);
    if (next.toString() === params.toString()) return;
    const href = "/chat?" + next.toString() + window.location.hash;
    // Canonicalization and removing a deleted selection do not add a history
    // entry. Selecting another conversation supports normal Back/Forward.
    startNavigation(() => {
      if (sessionId === null || sessionId === id || id === null) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  }, [params, project, router, runtime.projectName, runtime.runtimeId, sessionId, startNavigation]);

  if (!runtime.client) return <RuntimeWorkspacePicker controller={runtime.workspace} product="Veyra Chat" />;
  if (requestedRuntime !== null && requestedRuntime !== (runtime.runtimeId ?? "compatibility")) return <>
    <p role="alert">This conversation belongs to a different runtime. Select its workspace before opening it.</p>
    <RuntimeWorkspacePicker controller={runtime.workspace} product="Veyra Chat" />
  </>;
  return <ChatShell key={JSON.stringify([runtime.projectName, runtime.runtimeId, sessionId])} initialSessionId={sessionId} onActiveSessionChange={onActiveSessionChange} navigationPending={navigationPending} />;
}
