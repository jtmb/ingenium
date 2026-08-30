"use client";

import type { ContextMessage } from "@/lib/api";

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function roleLabel(role: ContextMessage["role"]): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function roleClass(role: ContextMessage["role"]): string {
  const classes: Record<ContextMessage["role"], string> = {
    system: "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]",
    user: "bg-[var(--color-surface-selected)] text-[var(--color-selection-text)]",
    assistant: "bg-[var(--color-success-bg)] text-[var(--color-success-text)]",
    tool: "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]",
  };
  return classes[role];
}

interface ContextMessageTimelineProps {
  messages: ContextMessage[];
  loading: boolean;
  searching: boolean;
  isSearchResult: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

/** Ordered immutable message stream with explicit content already retrieved by the parent. */
export default function ContextMessageTimeline({
  messages,
  loading,
  searching,
  isSearchResult,
  hasMore,
  onLoadMore,
}: ContextMessageTimelineProps) {
  return (
    <section aria-labelledby="message-timeline-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="message-timeline-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
          {isSearchResult ? "Search results" : "Message timeline"}
        </h2>
        {!isSearchResult && <span className="text-xs text-[var(--color-text-muted)]">Content is retrieved explicitly.</span>}
      </div>

      {(loading || searching) && messages.length === 0 && (
        <div className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm text-[var(--color-text-muted)]" role="status" aria-live="polite" aria-busy="true">
          {searching ? "Searching immutable messages…" : "Loading immutable messages…"}
        </div>
      )}

      {!loading && !searching && messages.length === 0 && (
        <div className="mt-3 rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-6 text-center">
          <p className="font-medium text-[var(--color-text-primary)]">{isSearchResult ? "No matching messages" : "No messages yet"}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {isSearchResult ? "Try a different search phrase." : "Messages will appear when this conversation is captured."}
          </p>
        </div>
      )}

      {messages.length > 0 && (
        <ol className="relative mt-4 space-y-3 border-l-2 border-[var(--color-border)] pl-5" aria-label="Immutable message timeline">
          {messages.map((message) => (
            <li key={message.id} className="relative">
              <span className="absolute -left-[1.7rem] top-4 h-3 w-3 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-text-link)]" aria-hidden="true" />
              <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow">
                <header className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${roleClass(message.role)}`}>{roleLabel(message.role)}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">Message {message.sequence + 1}</span>
                  <time className="ml-auto text-xs text-[var(--color-text-muted)]" dateTime={message.created_at}>{formatDate(message.created_at)}</time>
                </header>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-text-primary)]">{message.content}</p>
              </article>
            </li>
          ))}
        </ol>
      )}

      {hasMore && !isSearchResult && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="mt-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Loading messages…" : "Load earlier messages"}
        </button>
      )}
    </section>
  );
}
