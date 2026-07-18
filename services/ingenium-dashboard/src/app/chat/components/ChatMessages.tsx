"use client";

import { useEffect, useRef, useState } from "react";
import ChatMarkdown from "./ChatMarkdown";
import ToolCallCard from "./ToolCallCard";
import PermissionPrompt from "./PermissionPrompt";
import QuestionPrompt from "./QuestionPrompt";
import type { ToolState } from "./ToolCallCard";
import type { OpenCodePart, ToolPart, FilePart } from "../../../lib/opencode";
import type { PermissionRequest } from "../../../lib/use-opencode-chat";
import type { QuestionItem as ChatQuestionItem } from "./QuestionPrompt";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;  // text only — no reasoning mixed in
  reasoning?: string;  // separate reasoning content
  parts?: OpenCodePart[];
  model?: { providerID: string; modelID: string };  // from message.updated info
  timestamp: number;
  isStreaming?: boolean;
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRevert?: (messageId: string, partId?: string) => void;
  /** Pending permission requests to display inline. */
  permissions?: PermissionRequest[];
  /** Callback to reply to a permission request. */
  replyPermission?: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
  /** Called to dismiss the error banner (clears error state). */
  onDismissError?: () => void;
  /** Active questions from the agent. */
  questions?: ChatQuestionItem[];
  /** Send a reply to the agent's question as a regular prompt. */
  onSendReply?: (text: string) => void;
}

/** Map OpenCode ToolPart status to ToolCallCard state. */
function mapToolState(status?: string): ToolState {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "error":
      return "failed";
    default:
      return "pending";
  }
}

/** Safely convert an unknown output value to a display string. */
function outputToString(output: unknown): string | undefined {
  if (output === undefined || output === null) return undefined;
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

/**
 * ReasoningBlock — collapsible reasoning content shown above an assistant message.
 */
function ReasoningBlock({ content }: { content: string }) {
  return (
    <details className="my-2">
      <summary className="text-xs font-medium text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text-secondary)] transition-colors select-none">
        Thinking...
      </summary>
      <div className="mt-2 pl-3 border-l-2 border-[var(--color-border)] text-xs text-[var(--color-text-muted)] leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </details>
  );
}

/**
 * FileImagePart — renders an image file part as an <img> with click-to-expand.
 */
function FileImagePart({ file }: { file: FilePart }) {
  const [expanded, setExpanded] = useState(false);
  const src = file.dataUrl ?? file.url ?? "";

  if (!src) {
    return (
      <div className="my-2 text-xs text-[var(--color-text-muted)]">
        [Image: {file.filename ?? "unknown"} (no preview available)]
      </div>
    );
  }

  return (
    <div className="my-2">
      {expanded ? (
        <div className="relative">
          <img
            src={src}
            alt={file.filename ?? "attached image"}
            className="max-w-full rounded-lg border border-[var(--color-border)]"
            onClick={() => setExpanded(false)}
          />
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white text-xs hover:bg-black/70 transition-colors"
            aria-label="Collapse image"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
            </svg>
          </button>
        </div>
      ) : (
        <img
          src={src}
          alt={file.filename ?? "attached image"}
          className="max-h-48 rounded-lg border border-[var(--color-border)] cursor-pointer hover:opacity-90 transition-opacity"
          onClick={() => setExpanded(true)}
        />
      )}
      {file.filename && (
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
          {file.filename}
        </p>
      )}
    </div>
  );
}

/**
 * FileTextPart — renders a text file part as a code block with filename header.
 */
function FileTextPart({ file }: { file: FilePart }) {
  const content = file.data ?? file.content ?? "";
  const displayContent = content.length > 4000
    ? content.slice(0, 4000) + "\n... (truncated)"
    : content;

  return (
    <div className="my-2 rounded-lg border border-[var(--color-border)] overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-muted)] border-b border-[var(--color-border)]">
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[var(--color-text-muted)] shrink-0"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 1.5H3a1 1 0 00-1 1v7a1 1 0 001 1h6a1 1 0 001-1V4L6.5 1.5z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 1.5v2.5H9" />
        </svg>
        <span className="text-xs font-medium text-[var(--color-text-secondary)] truncate">
          {file.filename ?? "file"}
        </span>
        {file.size && (
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {file.size < 1024
              ? `${file.size} B`
              : file.size < 1024 * 1024
                ? `${(file.size / 1024).toFixed(1)} KB`
                : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
          </span>
        )}
      </div>
      <pre className="p-3 text-xs leading-relaxed whitespace-pre-wrap break-all font-mono text-[var(--color-text-primary)] bg-[var(--color-surface)] max-h-64 overflow-y-auto">
        {displayContent || "[No content]"}
      </pre>
    </div>
  );
}

/**
 * FileOtherPart — renders a generic file part as a download link.
 */
function FileOtherPart({ file }: { file: FilePart }) {
  return (
    <div className="my-2">
      <a
        href={file.url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors no-underline"
        download={file.filename}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[var(--color-text-muted)] shrink-0"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.58 1.75H3.5a1.17 1.17 0 00-1.17 1.17v8.16c0 .65.52 1.17 1.17 1.17h7c.65 0 1.17-.52 1.17-1.17V4.67L7.58 1.75z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.58 1.75v2.92h2.92" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7.58v2.34M5.83 8.75L7 9.92l1.17-1.17" />
        </svg>
        <span className="truncate max-w-[200px]">
          {file.filename ?? "file"}
        </span>
        {file.size && (
          <span className="text-[var(--color-text-muted)]">
            {file.size < 1024
              ? `${file.size} B`
              : file.size < 1024 * 1024
                ? `${(file.size / 1024).toFixed(1)} KB`
                : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
          </span>
        )}
      </a>
    </div>
  );
}

/**
 * Renders a single file part based on its MIME type.
 */
function FilePartDisplay({ file }: { file: FilePart }) {
  if (!file.mime) {
    return <FileOtherPart file={file} />;
  }
  if (file.mime.startsWith("image/")) {
    return <FileImagePart file={file} />;
  }
  if (
    file.mime.startsWith("text/") ||
    file.mime === "application/json" ||
    file.mime === "application/javascript" ||
    file.mime === "application/typescript" ||
    file.mime === "application/xml"
  ) {
    return <FileTextPart file={file} />;
  }
  return <FileOtherPart file={file} />;
}

/**
 * CopyButton — copies the assistant's rendered text content to clipboard.
 * Shows a checkmark for 2 seconds on success, a red X briefly on failure.
 */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "success" | "error">("idle");

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setState("success");
    } catch {
      setState("error");
    } finally {
      setTimeout(() => setState("idle"), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={state !== "idle"}
      className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-60"
      aria-label="Copy message"
      title="Copy"
    >
      {state === "success" ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-emerald-500"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.92 7l2.91 2.92L11.08 4.67"
          />
        </svg>
      ) : state === "error" ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-red-500"
          aria-hidden="true"
        >
          <path strokeLinecap="round" d="M4.08 4.08l5.84 5.84M9.92 4.08L4.08 9.92" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="4.67" y="4.67" width="7" height="7.58" rx="1" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.33 9.33V3.5c0-.64.52-1.17 1.17-1.17h5.83"
          />
        </svg>
      )}
    </button>
  );
}

/**
 * ChatMessages — renders the scrollable message list with:
 * - Empty state (centered icon + "How can I help you today?")
 * - User bubbles (right-aligned, card-wrapped with surface color)
 * - Assistant content (bare, no card wrapper — renders inline)
 * - Reasoning blocks (collapsible)
 * - Tool call cards (standalone ToolCallCard component)
 * - Action row below assistant messages: model attribution + copy + retry
 * - Error banner
 * - Loading indicator (bouncing dots)
 * - Auto-scroll to bottom
 */
export default function ChatMessages({
  messages,
  isLoading,
  isStreaming,
  error,
  onRetry,
  onRevert,
  permissions,
  replyPermission,
  onDismissError,
  questions: activeQuestions,
  onSendReply,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or loading state change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Empty state — show loading spinner, error, or welcome message
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0" data-testid="chat-empty-state">
        {isLoading ? (
          /* Initial loading spinner */
          <div className="flex flex-col items-center gap-3 max-w-sm text-center px-4">
            <div className="w-16 h-16 rounded-full bg-[var(--color-surface-selected)] flex items-center justify-center">
              <svg
                width="28"
                height="28"
                viewBox="0 0 28 28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-[var(--color-text-secondary)] animate-spin"
                aria-hidden="true"
              >
                <circle cx="14" cy="14" r="11" strokeOpacity="0.25" />
                <path strokeLinecap="round" d="M14 3a11 11 0 0111 11" />
              </svg>
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              Loading conversation...
            </p>
          </div>
        ) : error ? (
          /* Error state */
          <div className="flex flex-col items-center gap-3 max-w-sm text-center px-4">
            <div className="w-16 h-16 rounded-full bg-[var(--color-error-bg)] flex items-center justify-center">
              <svg
                width="28"
                height="28"
                viewBox="0 0 28 28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-[var(--color-error-text)]"
                aria-hidden="true"
              >
                <circle cx="14" cy="14" r="11" />
                <path strokeLinecap="round" d="M14 9v5M14 19.5v.5" />
              </svg>
            </div>
            <p className="text-sm text-[var(--color-error-text)]">
              {error}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-1 px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
            )}
          </div>
        ) : (
          /* Welcome state */
          <div className="flex flex-col items-center gap-3 max-w-sm text-center px-4">
            {/* Chat icon */}
            <div className="w-16 h-16 rounded-full bg-[var(--color-surface-selected)] flex items-center justify-center">
              <svg
                width="28"
                height="28"
                viewBox="0 0 28 28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-[var(--color-text-secondary)]"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.67 5.83h18.66c1.29 0 2.34 1.05 2.34 2.34v11.66c0 1.29-1.05 2.34-2.34 2.34H9.63l-4.96 4.96V8.17c0-1.29 1.05-2.34 2.34-2.34z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              How can I help you today?
            </h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Ask me anything — code, research, writing, or analysis.
            </p>
          </div>
        )}
      </div>
    );
  }

  // Determine if we should show the retry button — last assistant message, not streaming
  const lastMsg = messages[messages.length - 1];
  const showRetry =
    onRetry &&
    !isStreaming &&
    !isLoading &&
    lastMsg?.role === "assistant" &&
    messages.length > 0;

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-4 py-4 space-y-6">
      {/* Error banner */}
      {error && (
        <div
          className="bg-[var(--color-error-bg)] border border-red-300 rounded-lg p-3 text-sm text-[var(--color-text-primary)]"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="shrink-0 mt-0.5 text-red-400"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6.5" />
              <path strokeLinecap="round" d="M8 5v3M8 10.5v.5" />
            </svg>
            <span className="flex-1">{error}</span>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="shrink-0 p-0.5 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                aria-label="Dismiss error"
                title="Dismiss"
              >
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
                    d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {messages.map((msg, idx) => {
        const isUser = msg.role === "user";
        const isLastAssistant =
          msg.role === "assistant" && idx === messages.length - 1;

        // Combine reasoning parts into a single block — use msg.reasoning
        const reasoningContent = msg.reasoning;
        // Tool parts from the verified OpenCodePart contract (type === "tool")
        const toolParts =
          msg.parts?.filter(
            (p): p is ToolPart => p.type === "tool",
          ) ?? [];
        // File parts from the OpenCodePart contract (type === "file")
        const fileParts =
          msg.parts?.filter(
            (p): p is FilePart => p.type === "file",
          ) ?? [];

        return (
          <div key={msg.id}>
            {/* Message row: user gets a bubble, assistant renders bare */}
            <div
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              {isUser ? (
                /* User bubble — right-aligned, surface-selected background */
                <div className="max-w-full sm:max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed break-words bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]">
                  <p className="whitespace-pre-wrap break-words">
                    {msg.content}
                  </p>
                </div>
              ) : (
                /* Assistant content — bare, no card wrapper */
                <div className="max-w-full sm:max-w-[85%] text-sm leading-relaxed break-words">
                  {/* Reasoning blocks */}
                  {reasoningContent && (
                    <ReasoningBlock content={reasoningContent} />
                  )}

                  {/* Main content — Markdown rendered */}
                  {msg.content && <ChatMarkdown content={msg.content} />}

                  {/* File parts — rendered inline */}
                  {fileParts.map((fp) => (
                    <FilePartDisplay key={fp.id} file={fp} />
                  ))}

                  {/* Tool call cards using standalone ToolCallCard */}
                  {toolParts.map((tp) => (
                    <div key={tp.id} className="relative">
                      <ToolCallCard
                        toolName={tp.tool ?? "Tool call"}
                        state={mapToolState(tp.state?.status)}
                        input={
                          tp.state?.input as Record<string, unknown> | undefined
                        }
                        output={outputToString(tp.state?.output)}
                        error={tp.state?.error}
                      />
                      {/* Revert button on failed tool parts */}
                      {onRevert && tp.state?.status === "error" && (
                        <button
                          type="button"
                          onClick={() => onRevert(msg.id, tp.id)}
                          className="absolute top-2 right-2 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                          aria-label={`Revert ${tp.tool ?? "tool"} call`}
                          title="Revert this tool call"
                        >
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
                              d="M2.33 7h6.42a2.92 2.92 0 110 5.84H4.08M2.33 7l2.33-2.33M2.33 7l2.33 2.33"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action row for assistant messages — model attribution + copy + retry (outside any bubble) */}
            {!isUser && (
              <div className="flex items-center gap-2 mt-1">
                {msg.model && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {msg.model.providerID}/{msg.model.modelID}
                  </span>
                )}
                <div className="flex items-center gap-0.5">
                  <CopyButton text={msg.content} />
                  {isLastAssistant && showRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                      aria-label="Retry"
                      title="Retry"
                    >
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
                          d="M2.33 7h6.42a2.92 2.92 0 110 5.84H4.08M2.33 7l2.33-2.33M2.33 7l2.33 2.33"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Active questions from the agent */}
      {activeQuestions && activeQuestions.length > 0 && (
        <div className="flex justify-start">
          <div className="max-w-full sm:max-w-[85%]">
            <QuestionPrompt
              requestId={activeQuestions[0]!.id}
              questions={activeQuestions}
              isActive={!isStreaming}
              onReply={(_requestId, answers) => {
                const answerText = Object.entries(answers)
                  .map(([, labels]) =>
                    Array.isArray(labels) ? labels.join(", ") : labels,
                  )
                  .join("\n");
                if (onSendReply) {
                  onSendReply(answerText);
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Permission prompts — rendered inline after messages. */}
      {permissions && permissions.length > 0 && replyPermission && (
        <div className="flex justify-start">
          <div className="max-w-[85%]">
            {permissions.map((p) => (
              <PermissionPrompt
                key={p.id}
                requestId={p.id}
                action={p.action}
                pattern={p.pattern}
                onReply={(requestId, reply) => replyPermission(requestId, reply)}
                isActive={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border)]">
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] animate-bounce"
                style={{ animationDelay: "0ms" }}
                aria-label="Loading"
              />
              <span
                className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] animate-bounce"
                style={{ animationDelay: "150ms" }}
                aria-hidden="true"
              />
              <span
                className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] animate-bounce"
                style={{ animationDelay: "300ms" }}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} />

      {/* prefers-reduced-motion: disable bounce animation */}
      <style jsx>{`
        @media (prefers-reduced-motion: reduce) {
          .animate-bounce {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
