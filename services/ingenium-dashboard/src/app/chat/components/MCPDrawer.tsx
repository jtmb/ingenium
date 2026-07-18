"use client";

import { useEffect, useCallback } from "react";

interface MCPServer {
  name: string;
  connected: boolean;
  toolCount?: number;
}

interface MCPDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  servers: MCPServer[];
  onConnect: (name: string) => void;
  onDisconnect: (name: string) => void;
}

/**
 * MCPDrawer — slide-out panel from the right showing MCP server status.
 *
 * Features:
 * - Right-side overlay with backdrop
 * - Server connection status (green dot = connected, red dot = disconnected)
 * - Tool count badge for connected servers
 * - Connect/Disconnect toggle per server
 * - Empty state when no servers are configured
 * - Closes on backdrop click or Escape key
 */
export default function MCPDrawer({
  isOpen,
  onClose,
  servers,
  onConnect,
  onDisconnect,
}: MCPDrawerProps) {
  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    },
    [isOpen, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[360px] bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2.5">
            {/* MCP icon */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-[var(--color-text-secondary)]"
              aria-hidden="true"
            >
              <rect
                x="2.25"
                y="4.5"
                width="4.5"
                height="9"
                rx="1.12"
              />
              <rect
                x="6.75"
                y="2.25"
                width="4.5"
                height="13.5"
                rx="1.12"
              />
              <rect
                x="11.25"
                y="5.62"
                width="4.5"
                height="6.75"
                rx="1.12"
              />
            </svg>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              MCP Servers
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Close MCP drawer"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 4.5l9 9M13.5 4.5l-9 9"
              />
            </svg>
          </button>
        </div>

        {/* Server list */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
          {servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              {/* Empty state icon */}
              <div className="w-12 h-12 rounded-full bg-[var(--color-surface-muted)] flex items-center justify-center">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-[var(--color-text-muted)]"
                  aria-hidden="true"
                >
                  <rect
                    x="2.5"
                    y="5"
                    width="15"
                    height="10"
                    rx="2.5"
                  />
                  <path
                    strokeLinecap="round"
                    d="M6 13.33h8"
                  />
                  <circle cx="10" cy="8.33" r="1.67" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                  No MCP servers configured
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Add MCP server definitions in your Ingenium configuration
                  to connect external tools.
                </p>
              </div>
            </div>
          ) : (
            servers.map((server) => (
              <div
                key={server.name}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)]"
              >
                {/* Connection dot */}
                <span className="relative flex shrink-0">
                  <span
                    className={`block w-2.5 h-2.5 rounded-full ${
                      server.connected ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  {server.connected && (
                    <span className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-500 animate-ping opacity-40" />
                  )}
                </span>

                {/* Server info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {server.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {server.connected ? "Connected" : "Disconnected"}
                    </span>
                    {server.connected && server.toolCount != null && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--color-surface-selected)] text-[var(--color-text-secondary)] font-mono">
                        {server.toolCount} {server.toolCount === 1 ? "tool" : "tools"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Connect/Disconnect toggle */}
                <button
                  type="button"
                  onClick={() =>
                    server.connected
                      ? onDisconnect(server.name)
                      : onConnect(server.name)
                  }
                  className={[
                    "shrink-0 rounded-md px-3 py-1 text-xs font-medium transition-colors border",
                    server.connected
                      ? "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                      : "border-[var(--color-border)] bg-blue-600 text-white hover:bg-blue-500 border-blue-600",
                  ].join(" ")}
                >
                  {server.connected ? "Disconnect" : "Connect"}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer summary */}
        <div className="px-4 py-2.5 border-t border-[var(--color-border)] shrink-0">
          <p className="text-xs text-[var(--color-text-muted)]">
            {servers.length}{" "}
            {servers.length === 1 ? "server" : "servers"} configured
            {servers.length > 0
              ? ` — ${servers.filter((s) => s.connected).length} connected`
              : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
