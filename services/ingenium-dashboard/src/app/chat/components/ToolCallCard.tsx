"use client";

import { useState, useCallback, useEffect } from "react";

export type ToolState = "pending" | "running" | "completed" | "failed" | "retry";

interface ToolCallCardProps {
  toolName: string;
  state: ToolState;
  callID?: string;
  input?: Record<string, any>;
  output?: string;
  error?: string;
  duration?: number; // milliseconds
}

/* ------------------------------------------------------------------ */
/*  Tool identity & iconography                                       */
/* ------------------------------------------------------------------ */

/** Map a raw tool name to a human-friendly label and SVG icon. */
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

/* ------------------------------------------------------------------ */
/*  Input summary extraction                                          */
/* ------------------------------------------------------------------ */

/** Extract a short human-readable summary from the tool input. */
function getInputSummary(toolName: string, input?: Record<string, any>): string {
  if (!input) return "";
  switch (toolName.toLowerCase()) {
    case "bash":
      return (input.command || input.cmd || "").slice(0, 80);
    case "read":
      return input.path || input.filePath || input.file || "";
    case "edit":
    case "write":
      return input.path || input.filePath || input.file || "";
    case "grep":
    case "glob":
      return input.pattern || "";
    case "websearch":
      return input.query || "";
    case "webfetch":
      return input.url || "";
    case "task":
      return (
        input.description || input.prompt || input.subagent_type || ""
      );
    default:
      return "";
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Format duration from ms into a human-readable string. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/* ------------------------------------------------------------------ */
/*  Status icon helpers                                                */
/* ------------------------------------------------------------------ */

const statusIcons: Record<string, React.ReactNode> = {
  pending: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="text-[var(--color-text-muted)]"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path strokeLinecap="round" d="M6 3v3l2.5 1.5" />
    </svg>
  ),
  running: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="text-amber-400 animate-spin"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4.5" strokeOpacity="0.25" />
      <path strokeLinecap="round" d="M6 1.5A4.5 4.5 0 0110.5 6" />
    </svg>
  ),
  completed: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="text-emerald-400"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.5 6.5l2 2 5-5"
      />
    </svg>
  ),
  failed: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="text-red-400"
      aria-hidden="true"
    >
      <path strokeLinecap="round" d="M3.5 3.5l5 5M8.5 3.5l-5 5" />
    </svg>
  ),
  retry: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="text-amber-400 animate-spin"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4.5" strokeOpacity="0.25" />
      <path strokeLinecap="round" d="M6 1.5A4.5 4.5 0 0110.5 6" />
    </svg>
  ),
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  retry: "Retrying",
};

/* ------------------------------------------------------------------ */
/*  ToolCallCard                                                      */
/* ------------------------------------------------------------------ */

/**
 * ToolCallCard — renders an expandable card showing a tool call execution.
 *
 * Features:
 * - State-aware header with tool identity, input summary, status icon, timer
 * - Structured expandable sections (Error / Input / Output / Metadata)
 * - CSS-token based colours (no hardcoded Tailwind colour classes)
 * - Truncated output with "Show more" toggle
 * - Full test-id coverage for integration testing
 */
export default function ToolCallCard({
  toolName,
  state,
  callID,
  input,
  output,
  error,
  duration,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(
    state === "failed" || state === "completed",
  );
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  // Output truncation: show at most 4000 chars, with a "Show more" toggle
  const [outputExpanded, setOutputExpanded] = useState(false);
  const outputTruncated =
    output && output.length > 4000 && !outputExpanded;
  const displayOutput = outputTruncated
    ? output!.slice(0, 4000) + "\n... (truncated)"
    : output;

  // Running timer for pending / running states
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state !== "running" && state !== "pending") return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, [state]);

  const { label, icon } = getToolInfo(toolName);
  const summary = getInputSummary(toolName, input);

  // Derive status colour for the left border accent (CSS tokens)
  const statusAccent: string = (() => {
    switch (state) {
      case "pending":
        return "border-l-[var(--color-border)]";
      case "running":
      case "retry":
        return "border-l-[var(--color-warning-border)]";
      case "completed":
        return "border-l-[var(--color-success-border)]";
      case "failed":
        return "border-l-[var(--color-error-border)]";
    }
  })();

  // Display name fallback chain: humanized label → raw toolName → truncated callID
  const displayName = label !== toolName ? label : callID
    ? callID.length > 12
      ? callID.slice(0, 12) + "…"
      : callID
    : toolName || "Tool call";

  // Chevron icon
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
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 5.25L7 8.75l3.5-3.5"
      />
    </svg>
  );

  return (
    <div
      className={`my-2 border rounded-lg bg-[var(--color-surface)] overflow-hidden border-[var(--color-border)] ${statusAccent} border-l-[3px]`}
      data-testid="chat-tool-call"
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

        {/* Tool label + input summary */}
        <span
          className="font-medium text-[var(--color-text-primary)] truncate flex-1 min-w-0"
          data-testid="chat-tool-name"
        >
          {displayName}
          {summary && (
            <span
              className="ml-1.5 font-normal text-[var(--color-text-muted)]"
              data-testid="chat-tool-summary"
            >
              · {summary}
            </span>
          )}
        </span>

        {/* Status indicator + timer */}
        <span
          className="shrink-0 flex items-center gap-1 text-xs"
          data-testid="chat-tool-status"
        >
          {statusIcons[state] ?? statusIcons["pending"]}
          <span
            className={
              state === "failed"
                ? "text-red-400"
                : state === "completed"
                  ? "text-emerald-400"
                  : state === "running" || state === "retry"
                    ? "text-amber-400"
                    : "text-[var(--color-text-muted)]"
            }
          >
            {statusLabels[state] ?? statusLabels["pending"]}
          </span>
          {(state === "running" || state === "pending") && elapsed > 0 && (
            <span className="text-[var(--color-text-muted)] tabular-nums">
              {formatDuration(duration ?? elapsed)}
            </span>
          )}
          {state === "completed" && duration != null && (
            <span className="text-[var(--color-text-muted)] tabular-nums">
              {formatDuration(duration)}
            </span>
          )}
        </span>

        {/* Expand chevron */}
        <span className="shrink-0 text-[var(--color-text-muted)] ml-0.5">
          {chevronIcon}
        </span>
      </button>

      {/* Expandable body */}
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-3 py-2 space-y-2.5">
          {/* Error section */}
          {state === "failed" && error && (
            <div className="rounded-md bg-[var(--color-error-bg)] border border-[var(--color-error-border)] px-3 py-2">
              <p className="text-xs font-semibold text-red-400 mb-1">
                Error
              </p>
              <pre className="text-xs font-mono text-[var(--color-error-text)] whitespace-pre-wrap break-all leading-relaxed">
                {error}
              </pre>
            </div>
          )}

          {/* Input section */}
          {input && Object.keys(input).length > 0 && (
            <div data-testid="chat-tool-input">
              <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Input
              </p>
              <pre className="text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-code-bg)] rounded-md p-2 max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {/* Output section */}
          {output && (
            <div data-testid="chat-tool-output">
              <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Output
              </p>
              <pre className="text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-code-bg)] rounded-md p-2 max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
                {displayOutput}
              </pre>
              {output.length > 4000 && (
                <button
                  type="button"
                  onClick={() => setOutputExpanded((prev) => !prev)}
                  className="mt-1 text-xs text-[var(--color-text-link)] hover:underline cursor-pointer"
                >
                  {outputExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}

          {/* Empty state when expanded with no content */}
          {state === "running" && !input && !output && !error && (
            <p className="text-xs text-[var(--color-text-muted)] italic">
              Waiting for output…
            </p>
          )}

          {/* Metadata section */}
          <div className="pt-1 border-t border-[var(--color-border)]">
            <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
              <span className="font-medium">Tool:</span> {toolName}
              {callID && (
                <>
                  {" · "}
                  <span className="font-medium">Call ID:</span>{" "}
                  <code className="font-mono">{callID}</code>
                </>
              )}
              {(state === "completed" || state === "failed") && (
                <>
                  {" · "}
                  <span className="font-medium">Duration:</span>{" "}
                  {duration != null
                    ? formatDuration(duration)
                    : elapsed > 0
                      ? formatDuration(elapsed)
                      : "—"}
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
