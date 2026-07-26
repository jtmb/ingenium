"use client";

import { useId, useState } from "react";

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

/** Map a raw tool name to the label used in the chat trace. */
function getToolLabel(name: string): string {
  switch (name.toLowerCase()) {
    case "websearch":
    case "web_search":
      return "Web Search";
    case "webfetch":
      return "Web Fetch";
    case "bash":
    case "shell":
      return "Shell";
    case "read":
    case "edit":
    case "write":
      return "File";
    case "grep":
    case "glob":
      return "Search";
    case "task":
      return "Subagent";
    default:
      return name || "Tool call";
  }
}

/** Convert an input value to text without exposing the full tool payload. */
function inputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return String(value);
}

function isWebSearch(toolName: string): boolean {
  const normalizedName = toolName.toLowerCase();
  return normalizedName === "websearch" || normalizedName === "web_search";
}

/** Extract the query used by Web Search, including common provider aliases. */
function getSearchQuery(input?: Record<string, any>): string {
  if (!input) return "";
  return inputText(input.query ?? input.searchTerm ?? input.q ?? input.search);
}

/** Extract a short human-readable summary from the tool input. */
function getInputSummary(toolName: string, input?: Record<string, any>): string {
  if (!input) return "";

  switch (toolName.toLowerCase()) {
    case "bash":
      return inputText(input.command ?? input.cmd).slice(0, 80);
    case "read":
    case "edit":
    case "write":
      return inputText(input.path ?? input.filePath ?? input.file);
    case "grep":
    case "glob":
      return inputText(input.pattern);
    case "websearch":
    case "web_search":
      return getSearchQuery(input);
    case "webfetch":
      return inputText(input.url);
    case "task":
      return inputText(input.description ?? input.prompt ?? input.subagent_type);
    default:
      return "";
  }
}

/**
 * ToolCallCard — a compact OpenCode-style tool trace. Web Search is the sole
 * exception: its muted row can disclose the query without opening a card.
 *
 * The execution props remain part of the component contract so ChatMessages
 * can pass the complete OpenCode tool state unchanged. Only the tool identity
 * and a short argument summary are rendered in the conversation.
 */
export default function ToolCallCard({
  toolName,
  input,
}: ToolCallCardProps) {
  const displayName = getToolLabel(toolName);
  const summary = getInputSummary(toolName, input);
  const webSearch = isWebSearch(toolName);
  const searchQuery = webSearch ? getSearchQuery(input) : "";
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  const trace = (
    <>
      <span
        className="flex shrink-0 items-center text-[var(--color-text-muted)]"
        data-testid="chat-tool-icon"
        aria-hidden="true"
      >
        {webSearch ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            data-testid="chat-tool-globe-icon"
          >
            <circle cx="6" cy="6" r="4.75" />
            <path
              strokeLinecap="round"
              d="M1.25 6h9.5M6 1.25c1.2 1.35 1.5 3.15 1.5 4.75S7.2 9.4 6 10.75C4.8 9.4 4.5 7.6 4.5 6S4.8 2.6 6 1.25Z"
            />
          </svg>
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 1.25 10.75 6 6 10.75 1.25 6 6 1.25Z"
            />
          </svg>
        )}
      </span>

      <span
        className="shrink-0 font-medium text-[var(--color-text-secondary)]"
        data-testid="chat-tool-name"
      >
        {displayName}
      </span>

      {summary && (
        <>
          <span
            className="shrink-0 text-[var(--color-text-muted)]"
            aria-hidden="true"
          >
            ·
          </span>
          <span
            className="min-w-0 truncate text-[var(--color-text-muted)]"
            data-testid="chat-tool-summary"
            title={summary}
          >
            {summary}
          </span>
        </>
      )}
    </>
  );

  return (
    <div
      className="my-1 flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]"
      data-testid="chat-tool-call"
    >
      {webSearch ? (
        <button
          type="button"
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 border-0 bg-transparent p-0 text-left text-xs text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-secondary)]"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={searchQuery ? `Web Search: ${searchQuery}` : "Web Search"}
          onClick={() => setExpanded((previous) => !previous)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setExpanded((previous) => !previous);
            }
          }}
          data-testid="chat-tool-trigger"
        >
          {trace}
        </button>
      ) : (
        trace
      )}

      {webSearch && expanded && (
        <div
          id={detailsId}
          className="min-w-0 text-xs text-[var(--color-text-muted)]"
          data-testid="chat-tool-details"
        >
          <span className="mr-1.5 text-[var(--color-text-secondary)]">
            Search query:
          </span>
          <span className="break-words">
            {searchQuery || "No query provided"}
          </span>
        </div>
      )}
    </div>
  );
}
