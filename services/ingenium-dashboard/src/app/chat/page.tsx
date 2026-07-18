"use client";

import ChatShell from "./components/ChatShell";

/**
 * Ingenium Chat — standalone chat interface.
 *
 * Provides a native AI chat experience with session management,
 * provider/model/agent selection, file attachments, and MCP server
 * monitoring. Separated from the /opencode Web/CLI iframe page.
 */
export default function ChatPage() {
  return <ChatShell />;
}
