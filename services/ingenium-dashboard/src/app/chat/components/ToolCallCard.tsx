"use client";

import { useId, useState } from "react";

export type ToolState = "pending" | "running" | "completed" | "failed" | "retry";

interface ToolCallCardProps {
  toolName: string;
  state: ToolState;
  callID?: string;
  input?: Record<string, unknown>;
  /** Opaque provider output. Only Web Search inspects it for safe URLs. */
  output?: unknown;
  error?: string;
  duration?: number; // milliseconds
}

export type WebSearchSiteLabel = "Visited" | "Results" | "Sites";

export interface WebSearchSite {
  url: string;
  label: WebSearchSiteLabel;
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
function getSearchQuery(input?: Record<string, unknown>): string {
  if (!input) return "";
  const query = input.query ?? input.searchTerm ?? input.q ?? input.search;
  return typeof query === "string" ? query : "";
}

/** Extract a short human-readable summary from the tool input. */
function getInputSummary(toolName: string, input?: Record<string, unknown>): string {
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

const MAX_WEB_SEARCH_NODES = 2_000;
const MAX_WEB_SEARCH_DEPTH = 12;
const MAX_WEB_SEARCH_SITES = 50;
const MAX_WEB_SEARCH_URL_LENGTH = 2_048;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const URL_FIELD = /(?:^|[_-])(?:url|uri|href|link)(?:$|[_-])/i;
const STRUCTURED_RESULT = /(?:result|hit|source|document|page)/i;
const STRUCTURED_SITE = /(?:site|urls?|links?)/i;
const VISITED_COLLECTION = /^(?:visited|crawled)(?:[_-]?(?:urls?|links?|sites?|results?))?$/i;
const VISITATION_FLAG = /^(?:is[_-]?)?(?:visited|crawled)$/i;

function safeHttpUrl(value: string): string | undefined {
  if (
    value.length === 0 ||
    value.length > MAX_WEB_SEARCH_URL_LENGTH ||
    value.trim() !== value ||
    CONTROL_CHARACTER.test(value)
  ) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}

function labelForStructureKey(key: string): WebSearchSiteLabel | undefined {
  if (STRUCTURED_RESULT.test(key)) return "Results";
  if (STRUCTURED_SITE.test(key)) return "Sites";
  return undefined;
}

function isUrlField(key: string): boolean {
  const compact = key.replace(/[_-]/g, "");
  return URL_FIELD.test(key) || /(?:url|uri|href|link)$/.test(compact);
}

function isVisitedCollectionKey(key: string): boolean {
  return VISITED_COLLECTION.test(key);
}

function hasPositiveVisitationFlag(record: Record<string, unknown>): boolean {
  return Object.entries(record).some(
    ([key, value]) => VISITATION_FLAG.test(key) && value === true,
  );
}

/**
 * Read only concrete URLs returned by a Web Search tool. The output shape is
 * provider-defined, so this deliberately traverses only known result/site and
 * visited/crawled structures plus explicit URL-bearing fields. It never uses
 * the search query to manufacture a destination or title.
 */
export function extractWebSearchSites(output: unknown): WebSearchSite[] {
  const sites: WebSearchSite[] = [];
  const siteIndexes = new Map<string, number>();
  const seenObjects = new WeakSet<object>();
  let nodesVisited = 0;

  const add = (candidate: string, label: WebSearchSiteLabel) => {
    if (sites.length >= MAX_WEB_SEARCH_SITES) return;
    const url = safeHttpUrl(candidate);
    if (!url) return;

    const existingIndex = siteIndexes.get(url);
    if (existingIndex === undefined) {
      siteIndexes.set(url, sites.length);
      sites.push({ url, label });
    } else if (label === "Visited" && sites[existingIndex]?.label !== "Visited") {
      // A raw visited/crawled field is more specific than a search result.
      sites[existingIndex] = { url, label };
    }
  };

  const visit = (
    value: unknown,
    label: WebSearchSiteLabel,
    allowRawUrl: boolean,
    depth: number,
  ): void => {
    if (
      depth > MAX_WEB_SEARCH_DEPTH ||
      nodesVisited >= MAX_WEB_SEARCH_NODES ||
      sites.length >= MAX_WEB_SEARCH_SITES
    ) {
      return;
    }
    nodesVisited += 1;

    if (typeof value === "string") {
      if (allowRawUrl) add(value, label);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);

    if (Array.isArray(value)) {
      for (const item of value) visit(item, label, allowRawUrl, depth + 1);
      return;
    }

    const record = value as Record<string, unknown>;
    // A positive flag applies only to the object that declares it. Nested
    // visited/crawled collections label their own values and never siblings.
    const objectIsVisited = hasPositiveVisitationFlag(record);

    for (const [key, item] of Object.entries(record)) {
      // A query is input echo, not a returned search site. This also ensures
      // query-only output cannot become a fabricated disclosure entry.
      if (/query|searchterm|keyword/i.test(key)) continue;

      const isVisitedCollection = isVisitedCollectionKey(key);
      const keyLabel = labelForStructureKey(key);
      const nextLabel =
        objectIsVisited || label === "Visited" || isVisitedCollection
        ? "Visited"
        : keyLabel === "Results"
          ? "Results"
          : label;
      const nextAllowsRawUrl =
        allowRawUrl || isVisitedCollection || keyLabel !== undefined || isUrlField(key);

      if (typeof item === "string" && isUrlField(key)) {
        add(item, nextLabel);
        continue;
      }

      visit(item, nextLabel, nextAllowsRawUrl, depth + 1);
    }
  };

  // A provider may return a bare URL/array; it is still actual output. Object
  // properties must be structured or explicitly URL-bearing to qualify.
  visit(output, "Sites", typeof output === "string" || Array.isArray(output), 0);
  return sites;
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
  output,
}: ToolCallCardProps) {
  const displayName = getToolLabel(toolName);
  const summary = getInputSummary(toolName, input);
  const webSearch = isWebSearch(toolName);
  const searchQuery = webSearch ? getSearchQuery(input) : "";
  const webSearchSites = webSearch ? extractWebSearchSites(output) : [];
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
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 p-0 text-left text-xs text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-secondary)]"
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
          className="basis-full min-w-0 pl-[18px] text-xs text-[var(--color-text-muted)]"
          data-testid="chat-tool-details"
        >
          <span className="mr-1.5 text-[var(--color-text-secondary)]">
            Search query:
          </span>
          <span className="break-words">
            {searchQuery || "No query provided"}
          </span>
          {webSearchSites.length > 0 && (
            <div className="mt-2 space-y-2" data-testid="chat-web-search-sites">
              {(["Visited", "Results", "Sites"] as const).map((label) => {
                const sites = webSearchSites.filter((site) => site.label === label);
                if (sites.length === 0) return null;
                return (
                  <div key={label} data-testid="chat-web-search-group" data-label={label}>
                    <p className="font-medium text-[var(--color-text-secondary)]">
                      {label}
                    </p>
                    <ul className="mt-0.5 space-y-0.5">
                      {sites.map((site) => (
                        <li key={site.url} className="min-w-0">
                          <a
                            href={site.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="break-all text-[var(--color-text-secondary)] underline underline-offset-2 hover:text-[var(--color-text-primary)]"
                            data-testid="chat-web-search-link"
                          >
                            {site.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
