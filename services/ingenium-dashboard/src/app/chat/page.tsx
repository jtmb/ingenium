"use client";

import ChatShell from "./components/ChatShell";
import RuntimeWorkspacePicker from "../components/RuntimeWorkspacePicker";
import { useRuntime } from "@/lib/RuntimeContext";
import { useSearchParams } from "next/navigation";

/**
 * Ingenium Chat — standalone chat interface.
 *
 * Provides a native AI chat experience with session management,
 * provider/model/agent selection, file attachments, and MCP server
 * monitoring. Separated from the /opencode Web/CLI iframe page.
 */
export default function ChatPage() {
  const runtime = useRuntime();
  const params = useSearchParams();
  const requestedRuntime = params.get("runtime");
  const sessionId = params.get("session");
  if (!runtime.client) return <RuntimeWorkspacePicker controller={runtime.workspace} product="Veyra Chat" />;
  if (requestedRuntime !== null && requestedRuntime !== (runtime.runtimeId ?? "compatibility")) return <>
    <p role="alert">This conversation belongs to a different runtime. Select its workspace before opening it.</p>
    <RuntimeWorkspacePicker controller={runtime.workspace} product="Veyra Chat" />
  </>;
  return <ChatShell key={JSON.stringify([runtime.projectName, runtime.runtimeId, sessionId])} initialSessionId={sessionId} />;
}
