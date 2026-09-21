"use client";
export const dynamic = "force-dynamic";
import McpServerManager from "./components/McpServerManager";

/** MCP-004 dashboard surface for canonical child definitions and tool state. */
export default function MCPServersPage() {
  return <McpServerManager />;
}
