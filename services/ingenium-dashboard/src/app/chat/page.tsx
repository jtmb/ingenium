"use client";

import ChatShell from "./components/ChatShell";
import RuntimeWorkspacePicker from "../components/RuntimeWorkspacePicker";
import { useRuntime } from "@/lib/RuntimeContext";

/**
 * Ingenium Chat — standalone chat interface.
 *
 * Provides a native AI chat experience with session management,
 * provider/model/agent selection, file attachments, and MCP server
 * monitoring. Separated from the /opencode Web/CLI iframe page.
 */
export default function ChatPage() {
  const runtime = useRuntime();
  if (!runtime.client) return <RuntimeWorkspacePicker controller={runtime.workspace} product="Ingenium Chat" />;
  return <ChatShell />;
}
