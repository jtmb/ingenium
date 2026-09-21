"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import EdgeDrawer from "../../components/EdgeDrawer";
import {
  getMcpServersHref,
  getMcpStatusLabel,
  type McpServerView,
} from "./mcp-status";

interface MCPDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  servers: McpServerView[];
  error?: string | null;
  isRefreshing?: boolean;
  lastRefreshedAt?: number | null;
  project?: string | null;
  pendingServerName?: string | null;
  onRefresh: () => Promise<boolean> | void;
  onConnect: (name: string) => Promise<void> | void;
  onDisconnect: (name: string) => Promise<void> | void;
}

function statusDotClass(status: McpServerView["status"]): string {
  switch (status) {
    case "connected": return "bg-green-500";
    case "failed": return "bg-red-500";
    case "needs_auth":
    case "needs_client_registration": return "bg-amber-500";
    case "disabled": return "bg-slate-400";
    default: return "bg-slate-500";
  }
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function freshnessLabel(timestamp: number | null | undefined): string {
  if (timestamp == null) return "Not refreshed yet";
  const ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (ageSeconds < 60) return "Just now";
  if (ageSeconds < 3_600) return `${Math.floor(ageSeconds / 60)}m ago`;
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
  error,
  isRefreshing = false,
  lastRefreshedAt = null,
  project,
  pendingServerName,
  onRefresh,
  onConnect,
  onDisconnect,
}: MCPDrawerProps) {
  const dialogId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (isOpen) void onRefreshRef.current();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      const trigger = previouslyFocusedElementRef.current;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [isOpen]);

  const mcpServersHref = getMcpServersHref(project);

  return (
    <EdgeDrawer
      open={isOpen}
      side="right"
      className="fixed inset-0 z-40"
      panelRef={dialogRef}
      panelClassName="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[360px] sm:w-[360px] bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl flex flex-col"
      panelProps={{
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": dialogId,
      }}
      backdropProps={{ "data-testid": "mcp-drawer-backdrop" }}
      onBackdropClick={onClose}
    >
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
            <h2 id={dialogId} className="text-base font-semibold text-[var(--color-text-primary)]">
              MCP Servers
            </h2>
            {isRefreshing && (
              <span className="text-xs text-[var(--color-text-muted)]" aria-live="polite">
                Refreshing…
              </span>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
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

        {error && (
          <div className="mx-3 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" role="alert">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1">{error}</span>
              <div className="flex shrink-0 items-center gap-2">
                {mcpServersHref && (
                  <Link
                    href={mcpServersHref}
                    className="min-h-11 inline-flex items-center rounded px-2 font-medium underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                  >
                    MCP Servers
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => { void onRefresh(); }}
                  disabled={isRefreshing}
                  className="shrink-0 min-h-11 rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

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
                    className={`block w-2.5 h-2.5 rounded-full ${statusDotClass(server.status)}`}
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
                      {getMcpStatusLabel(server.status)}
                    </span>
                    {server.connected && server.toolCount != null && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--color-surface-selected)] text-[var(--color-text-secondary)] font-mono">
                        {server.toolCount} {server.toolCount === 1 ? "tool" : "tools"}
                      </span>
                    )}
                  </div>
                  {server.error && (
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {server.error}
                    </p>
                  )}
                </div>

                {/* Connect/Disconnect toggle */}
                <button
                  type="button"
                  onClick={() => {
                    if (server.connected) void onDisconnect(server.name);
                    else void onConnect(server.name);
                  }}
                  disabled={pendingServerName === server.name || isRefreshing}
                  className={[
                    "shrink-0 min-h-11 rounded-md px-3 py-2 text-xs font-medium transition-colors border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]",
                    server.connected
                      ? "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                      : "border-[var(--color-border)] bg-blue-600 text-white hover:bg-blue-500 border-blue-600",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  ].join(" ")}
                >
                  {pendingServerName === server.name
                    ? "Working…"
                    : server.connected ? "Disconnect" : "Connect"}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer summary */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-[var(--color-border)] shrink-0">
          <p className="min-w-0 text-xs text-[var(--color-text-muted)]">
            {servers.length}{" "}
            {servers.length === 1 ? "server" : "servers"} configured
            {servers.length > 0
              ? ` — ${servers.filter((s) => s.connected).length} connected`
              : ""}
            <span
              className="block truncate"
              data-testid="mcp-last-refresh"
              title={lastRefreshedAt == null ? undefined : new Date(lastRefreshedAt).toLocaleString()}
            >
              Last refreshed: {freshnessLabel(lastRefreshedAt)}
            </span>
          </p>
          <button
            type="button"
            onClick={() => { void onRefresh(); }}
            disabled={isRefreshing}
            className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
    </EdgeDrawer>
  );
}
