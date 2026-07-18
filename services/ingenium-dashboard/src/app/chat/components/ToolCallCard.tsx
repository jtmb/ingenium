"use client";

import { useState, useCallback } from "react";

export type ToolState = "pending" | "running" | "completed" | "failed" | "retry";

interface ToolCallCardProps {
  toolName: string;
  state: ToolState;
  input?: Record<string, any>;
  output?: string;
  error?: string;
  duration?: number; // milliseconds
}

/** Map a raw tool name to a human-friendly label and icon. */
function getToolInfo(name: string): { label: string; icon: React.ReactNode } {
  const lower = name.toLowerCase();

  if (lower === "websearch" || lower === "web_search") {
    return {
      label: "Web Search",
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5.25" />
          <path
            strokeLinecap="round"
            d="M2.33 7h9.34M7 1.75c1.45 1.71 1.75 3.83 1.75 5.25S8.45 10.54 7 12.25C5.55 10.54 5.25 8.42 5.25 7S5.55 3.46 7 1.75z"
          />
        </svg>
      ),
    };
  }

  if (lower === "webfetch") {
    return {
      label: "Web Fetch",
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 1.17v2.33M1.17 7h2.33m8.17 0h2.33M7 12.83v-2.33M3.36 3.36L5 5M9 9l1.64 1.64M10.64 3.36L9 5M5 9l-1.64 1.64"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.08 7A2.92 2.92 0 017 4.08 2.92 2.92 0 019.92 7 2.92 2.92 0 017 9.92 2.92 2.92 0 014.08 7z"
          />
        </svg>
      ),
    };
  }

  if (lower === "bash" || lower === "shell") {
    return {
      label: "Shell",
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.33 2.33l2.34 2.34L2.33 7M6.42 8.17h4.66"
          />
          <rect
            x="0.58"
            y="0.58"
            width="12.84"
            height="12.84"
            rx="2.33"
          />
        </svg>
      ),
    };
  }

  if (lower === "read" || lower === "edit" || lower === "write") {
    return {
      label: "File",
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.58 1.17H3.5c-.65 0-1.17.52-1.17 1.17v9.33c0 .65.52 1.16 1.17 1.16h7c.65 0 1.17-.51 1.17-1.16V4.92L7.58 1.17z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.58 1.17v3.75h3.75"
          />
        </svg>
      ),
    };
  }

  if (lower === "grep" || lower === "glob") {
    return {
      label: "Search",
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="6.13" cy="6.13" r="4.38" />
          <path strokeLinecap="round" d="M9.33 9.33l3.5 3.5" />
        </svg>
      ),
    };
  }

  if (lower === "task") {
    return {
      label: "Subagent",
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect
            x="3.5"
            y="2.33"
            width="7"
            height="5.83"
            rx="0.88"
          />
          <path
            strokeLinecap="round"
            d="M5.83 8.17v1.75c0 .64.52 1.16 1.17 1.16s1.17-.52 1.17-1.16V8.17"
          />
          <circle cx="6.13" cy="5.83" r="0.58" />
          <circle cx="7.88" cy="5.83" r="0.58" />
        </svg>
      ),
    };
  }

  return {
    label: name,
    icon: null,
  };
}

/** Format duration from ms into a human-readable string. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * ToolCallCard — renders an expandable card showing a tool call execution.
 *
 * States:
 * - pending: gray pulsing "Executing tool_name..."
 * - running: amber border-left, collapsible progress content
 * - completed: green border-left with checkmark and duration
 * - failed: red border-left with error message
 * - retry: amber "Retrying..."
 */
export default function ToolCallCard({
  toolName,
  state,
  input,
  output,
  error,
  duration,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(
    state === "failed" || state === "completed",
  );
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const { label, icon } = getToolInfo(toolName);

  // Derive status color for the left border accent
  const statusAccent: string = (() => {
    switch (state) {
      case "pending":
        return "border-l-[var(--color-text-muted)]";
      case "running":
      case "retry":
        return "border-l-amber-500";
      case "completed":
        return "border-l-green-500";
      case "failed":
        return "border-l-red-500";
    }
  })();

  // Status dot / indicator next to header
  const statusIndicator = (() => {
    switch (state) {
      case "pending":
        return <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">Executing…</span>;
      case "running":
        return <span className="flex items-center gap-1 text-xs text-amber-400">Running…</span>;
      case "completed":
        return (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.92 7.58l2.33 2.34 5.83-5.84" />
            </svg>
            Completed
            {duration != null ? ` · ${formatDuration(duration)}` : ""}
          </span>
        );
      case "failed":
        return <span className="flex items-center gap-1 text-xs text-red-400">Failed</span>;
      case "retry":
        return <span className="flex items-center gap-1 text-xs text-amber-400">Retrying…</span>;
    }
  })();

  const chevronIcon = (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 5.25L7 8.75l3.5-3.5" />
    </svg>
  );

  return (
    <div
      className={`my-2 border rounded-lg bg-[var(--color-surface)] overflow-hidden border-[var(--color-border)] ${statusAccent} border-l-[3px]`}
    >
      {/* Header — clickable */}
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface-hover)] transition-colors"
        aria-expanded={expanded}
      >
        {/* Icon */}
        {icon && (
          <span className="shrink-0 text-[var(--color-text-secondary)]">
            {icon}
          </span>
        )}

        {/* Tool label */}
        <span className="font-medium text-[var(--color-text-primary)] truncate flex-1 min-w-0">
          {label}
        </span>

        {/* Status / duration */}
        <span className="shrink-0">{statusIndicator}</span>

        {/* Expand chevron */}
        <span className="shrink-0 text-[var(--color-text-muted)] ml-0.5">
          {chevronIcon}
        </span>
      </button>

      {/* Expandable body */}
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-3 py-2 space-y-2">
          {/* Error message */}
          {state === "failed" && error && (
            <div className="rounded-md bg-[var(--color-error-bg)] border border-red-500/30 px-3 py-2 text-xs text-red-400">
              <p className="font-medium mb-1">Error</p>
              <pre className="whitespace-pre-wrap break-all font-mono leading-relaxed">
                {error}
              </pre>
            </div>
          )}

          {/* Input parameters */}
          {input && Object.keys(input).length > 0 && (
            <div>
              <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Input
              </p>
              <pre className="text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-code-bg)] rounded-md p-2 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-all">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {output && (
            <div>
              <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Output
              </p>
              <pre className="text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-code-bg)] rounded-md p-2 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-all">
                {output}
              </pre>
            </div>
          )}

          {/* Empty state when expanded with no content */}
          {state === "running" && !input && !output && (
            <p className="text-xs text-[var(--color-text-muted)] italic">
              Waiting for output…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
