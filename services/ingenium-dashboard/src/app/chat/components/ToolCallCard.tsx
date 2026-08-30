"use client";

import Link from "next/link";
import { getMcpServersHref } from "./mcp-status";

export type ToolState = "pending" | "running" | "completed" | "failed" | "retry";

const TOOL_DISABLED_MESSAGE = "This tool is disabled for the project.";
const TOOL_STATE_UNAVAILABLE_MESSAGE = "The tool state could not be verified.";
const PROJECT_IDENTITY_REQUIRED_MESSAGE = "This tool requires a valid project identity.";
const TOOL_UNKNOWN_FAILURE_MESSAGE = "Tool execution failed.";

const MCP_TOOL_ERROR_CODES = [
  "TOOL_DISABLED",
  "TOOL_STATE_UNAVAILABLE",
  "PROJECT_IDENTITY_REQUIRED",
] as const;

type McpToolErrorCode = (typeof MCP_TOOL_ERROR_CODES)[number];

interface ToolCallCardProps {
  toolName: string;
  state: ToolState;
  callID?: string;
  input?: Record<string, unknown>;
  /** Opaque provider output. Only Web Search inspects it for safe URLs. */
  output?: unknown;
  error?: string;
  duration?: number; // milliseconds
  /** Open the activity drawer for a Web Search tool. */
  onWebSearchOpen?: () => void;
  /** Whether this tool is the activity drawer's current selection. */
  isActivityOpen?: boolean;
  /** Validated global project used to build MCP management guidance. */
  mcpProject?: string | null;
}

export type WebSearchSiteLabel = "Visited" | "Results" | "Sites";

export interface WebSearchSite {
  url: string;
  label: WebSearchSiteLabel;
}

/** Map a raw tool name to the label used in the chat trace. */
export function getToolLabel(name: string): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMcpToolErrorCode(value: unknown): value is McpToolErrorCode {
  return typeof value === "string"
    && (MCP_TOOL_ERROR_CODES as readonly string[]).includes(value);
}

/** Read only the exact, fixed MCP error envelope emitted by the tool gateway. */
function readMcpErrorEnvelope(value: unknown): McpToolErrorCode | undefined {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some((key) => key !== "error")) return undefined;
  const error = value.error;
  if (!isRecord(error)) return undefined;
  if (Object.keys(error).some((key) => key !== "code" && key !== "message")) return undefined;
  if ("message" in error && typeof error.message !== "string") return undefined;
  return isMcpToolErrorCode(error.code) ? error.code : undefined;
}

function readJsonErrorText(value: unknown): McpToolErrorCode | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192) return undefined;
  try {
    return readMcpErrorEnvelope(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/**
 * Accept either the direct gateway envelope or its bounded MCP text result.
 * Arbitrary provider objects and text are deliberately ignored.
 */
function readMcpOutputError(value: unknown): McpToolErrorCode | undefined {
  const direct = readMcpErrorEnvelope(value) ?? readJsonErrorText(value);
  if (direct) return direct;
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype || value.isError !== true || !Array.isArray(value.content) || value.content.length !== 1 || Object.keys(value).some((key) => key !== "isError" && key !== "content")) {
    return undefined;
  }
  const content = value.content[0];
  if (!isRecord(content) || content.type !== "text" || Object.keys(content).some((key) => key !== "type" && key !== "text")) {
    return undefined;
  }
  return readJsonErrorText(content.text);
}

/** Return only exact state codes or a tightly validated MCP output code. */
export function getSafeToolErrorCode(error?: unknown, output?: unknown): McpToolErrorCode | undefined {
  if (isMcpToolErrorCode(error)) return error;
  return readMcpOutputError(output);
}

/** Map execution failures to fixed browser-safe messages; never render provider details. */
export function getSafeToolErrorMessage(error?: unknown, output?: unknown): string {
  switch (getSafeToolErrorCode(error, output)) {
    case "TOOL_DISABLED":
      return TOOL_DISABLED_MESSAGE;
    case "TOOL_STATE_UNAVAILABLE":
      return TOOL_STATE_UNAVAILABLE_MESSAGE;
    case "PROJECT_IDENTITY_REQUIRED":
      return PROJECT_IDENTITY_REQUIRED_MESSAGE;
  }
  return TOOL_UNKNOWN_FAILURE_MESSAGE;
}

/** Convert an input value to text without exposing the full tool payload. */
function inputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return String(value);
}

export function isWebSearchTool(toolName: string): boolean {
  const normalizedName = toolName.toLowerCase();
  return normalizedName === "websearch" || normalizedName === "web_search";
}

/** Extract the query used by Web Search, including common provider aliases. */
export function getWebSearchQuery(input?: Record<string, unknown>): string {
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
      return getWebSearchQuery(input);
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
const MAX_WEB_SEARCH_TEXT_LENGTH = 32_000;
const MAX_WEB_SEARCH_TEXT_CANDIDATES = 200;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const URL_FIELD = /(?:^|[_-])(?:url|uri|href|link)(?:$|[_-])/i;
const STRUCTURED_RESULT = /(?:result|hit|source|document|page)/i;
const STRUCTURED_SITE = /(?:site|urls?|links?)/i;
const VISITED_COLLECTION = /^(?:visited|crawled)(?:[_-]?(?:urls?|links?|sites?|results?))?$/i;
const VISITATION_FLAG = /^(?:is[_-]?)?(?:visited|crawled)$/i;
const TEXT_OUTPUT_FIELD = /^(?:answer|body|content|data|markdown|message|output|response|text)$/i;

interface TextUrlCandidate {
  value: string;
  start: number;
  end: number;
}

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
  return URL_FIELD.test(key) || /(?:url|uri|href|link)$/i.test(compact);
}

function isVisitedCollectionKey(key: string): boolean {
  return VISITED_COLLECTION.test(key);
}

function hasPositiveVisitationFlag(record: Record<string, unknown>): boolean {
  return Object.entries(record).some(
    ([key, value]) => VISITATION_FLAG.test(key) && value === true,
  );
}

function trimBareUrlPunctuation(value: string): string {
  let trimmed = value;
  let changed = true;

  while (changed && trimmed.length > 0) {
    changed = false;
    if (/[.,!?;:]$/.test(trimmed)) {
      trimmed = trimmed.slice(0, -1);
      changed = true;
      continue;
    }

    const last = trimmed.at(-1);
    const matchingOpen =
      last === ")" ? "(" : last === "]" ? "[" : last === "}" ? "{" : undefined;
    if (matchingOpen) {
      const closingCount = [...trimmed].filter((character) => character === last).length;
      const openingCount = [...trimmed].filter((character) => character === matchingOpen).length;
      if (closingCount > openingCount) {
        trimmed = trimmed.slice(0, -1);
        changed = true;
      }
    }
  }

  return trimmed;
}

function isInsideSpan(start: number, end: number, spans: Array<[number, number]>): boolean {
  return spans.some(([spanStart, spanEnd]) => start >= spanStart && end <= spanEnd);
}

/**
 * Extract URL-shaped values from provider text without parsing arbitrary prose
 * as metadata. The patterns are deliberately bounded and only recognize HTTP
 * URLs; safeHttpUrl remains the final scheme, credential, and control check.
 */
function extractTextUrlCandidates(text: string): TextUrlCandidate[] {
  const boundedText = text.slice(0, MAX_WEB_SEARCH_TEXT_LENGTH);
  const candidates: TextUrlCandidate[] = [];
  const markdownSpans: Array<[number, number]> = [];

  const addCandidate = (value: string, start: number, end: number) => {
    if (candidates.length >= MAX_WEB_SEARCH_TEXT_CANDIDATES) return;
    candidates.push({ value, start, end });
  };

  const markdownPattern =
    /\[[^\]\r\n]{0,512}\]\(\s*(?:<((?:https?):\/\/[^<>\r\n]{1,2048})>|((?:https?):\/\/[^()\s<>"'`\[\]]{1,2048}))\s*\)/gi;
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownPattern.exec(boundedText)) !== null) {
    const value = markdownMatch[1] ?? markdownMatch[2];
    if (!value) continue;
    const start = markdownMatch.index + markdownMatch[0].lastIndexOf(value);
    markdownSpans.push([markdownMatch.index, markdownMatch.index + markdownMatch[0].length]);
    addCandidate(value, start, start + value.length);
  }

  const autolinkPattern = /<((?:https?):\/\/[^<>\s]{1,2048})>/gi;
  let autolinkMatch: RegExpExecArray | null;
  while ((autolinkMatch = autolinkPattern.exec(boundedText)) !== null) {
    const value = autolinkMatch[1];
    if (!value) continue;
    const start = autolinkMatch.index + autolinkMatch[0].indexOf(value);
    if (!isInsideSpan(start, start + value.length, markdownSpans)) {
      addCandidate(value, start, start + value.length);
    }
  }

  const bareUrlPattern =
    /(^|[\s"'([{])((?:https?):\/\/[^\s<>"'`()\[\]{}]{1,2048})/gim;
  let bareUrlMatch: RegExpExecArray | null;
  while ((bareUrlMatch = bareUrlPattern.exec(boundedText)) !== null) {
    const value = bareUrlMatch[2];
    if (!value) continue;
    const start = bareUrlMatch.index + bareUrlMatch[0].lastIndexOf(value);
    const end = start + value.length;
    if (!isInsideSpan(start, end, markdownSpans)) {
      addCandidate(trimBareUrlPunctuation(value), start, end);
    }
  }

  candidates.sort((left, right) => left.start - right.start);
  return candidates;
}

/**
 * Read only concrete URLs returned by a Web Search tool. The output shape is
 * provider-defined, so this deliberately traverses known result/site and
 * visited/crawled structures, explicit URL-bearing fields, and bounded text
 * output. It never uses the search query to manufacture a destination or title.
 */
export function extractWebSearchSites(
  output: unknown,
  query?: string,
): WebSearchSite[] {
  const sites: WebSearchSite[] = [];
  const siteIndexes = new Map<string, number>();
  const seenObjects = new WeakSet<object>();
  const queryUrl = query ? safeHttpUrl(query.trim()) : undefined;
  let nodesVisited = 0;

  const add = (candidate: string, label: WebSearchSiteLabel) => {
    const url = safeHttpUrl(candidate);
    if (!url || url === queryUrl) return;

    const existingIndex = siteIndexes.get(url);
    if (existingIndex !== undefined) {
      if (label === "Visited" && sites[existingIndex]?.label !== "Visited") {
        // A raw visited/crawled field is more specific than a search result.
        sites[existingIndex] = { url, label };
      }
      return;
    }

    if (sites.length >= MAX_WEB_SEARCH_SITES) return;
    siteIndexes.set(url, sites.length);
    sites.push({ url, label });
  };

  const addText = (text: string, label: WebSearchSiteLabel) => {
    for (const candidate of extractTextUrlCandidates(text)) {
      add(candidate.value, label);
    }
  };

  const visit = (
    value: unknown,
    label: WebSearchSiteLabel,
    allowRawUrl: boolean,
    allowText: boolean,
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
      if (allowText) {
        addText(value, label);
      } else if (allowRawUrl) {
        add(value, label);
      }
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);

    if (Array.isArray(value)) {
      for (const item of value) visit(item, label, allowRawUrl, allowText, depth + 1);
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
      const isTextOutput = TEXT_OUTPUT_FIELD.test(key);
      const nextLabel =
        objectIsVisited || label === "Visited" || isVisitedCollection
        ? "Visited"
        : keyLabel === "Results"
          ? "Results"
          : label;
      const nextAllowsRawUrl =
        allowRawUrl || isVisitedCollection || keyLabel !== undefined || isUrlField(key);
      const nextAllowsText =
        allowText || isVisitedCollection || keyLabel !== undefined || isTextOutput;

      if (typeof item === "string" && isUrlField(key)) {
        add(item, nextLabel);
        continue;
      }

      visit(item, nextLabel, nextAllowsRawUrl, nextAllowsText, depth + 1);
    }
  };

  // A provider may return plain text, markdown, a bare URL, or an array of
  // result values. Object properties must be structured or explicitly textual
  // output fields to qualify; arbitrary metadata is not searched.
  const rootAllowsText = typeof output === "string" || Array.isArray(output);
  visit(output, "Sites", rootAllowsText, rootAllowsText, 0);
  return sites;
}

/**
 * ToolCallCard — a compact OpenCode-style tool trace. Web Search is the sole
 * interactive trace and delegates its provider details to the Activity drawer.
 *
 * The execution props remain part of the component contract so ChatMessages
 * can pass the complete OpenCode tool state unchanged. Only the tool identity
 * and a short argument summary are rendered in the conversation; Web Search
 * delegates its details to the shared Activity drawer.
 */
export default function ToolCallCard({
  toolName,
  state,
  input,
  output,
  error,
  onWebSearchOpen,
  isActivityOpen = false,
  mcpProject,
}: ToolCallCardProps) {
  const displayName = getToolLabel(toolName);
  const summary = getInputSummary(toolName, input);
  const webSearch = isWebSearchTool(toolName);
  const safeErrorCode = getSafeToolErrorCode(error, output);
  const safeError = state === "failed" || state === "retry" || error !== undefined || safeErrorCode
    ? getSafeToolErrorMessage(error, output)
    : null;
  const mcpServersHref = safeErrorCode ? getMcpServersHref(mcpProject) : null;

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
          className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 text-left text-xs text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-secondary)]"
          aria-expanded={isActivityOpen}
          aria-haspopup="dialog"
          aria-label="Open Web Search activity"
          onClick={onWebSearchOpen}
          data-testid="chat-tool-trigger"
        >
          {trace}
        </button>
      ) : (
        trace
      )}

      {safeError && (
        <>
          <span
            className="min-w-0 truncate text-[var(--color-error-text)]"
            data-testid="chat-tool-error"
            role="status"
          >
            {safeError}
          </span>
          {mcpServersHref && (
            <Link
              href={mcpServersHref}
              className="shrink-0 text-[var(--color-text-link)] underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
            >
              MCP Servers
            </Link>
          )}
        </>
      )}

    </div>
  );
}
