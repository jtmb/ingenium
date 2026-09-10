"use client";

import type { ContextConversationSummary } from "@/lib/api";

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function parseTags(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

interface ContextConversationListProps {
  conversations: ContextConversationSummary[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}

/** Project-scoped conversation index with accessible loading, error, and empty states. */
export default function ContextConversationList({
  conversations,
  selectedId,
  loading,
  error,
  hasMore,
  onSelect,
  onRetry,
  onLoadMore,
}: ContextConversationListProps) {
  return (
    <section
      className="min-w-0 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] lg:border-b-0 lg:border-r"
      aria-labelledby="conversation-index-title"
    >
      <div className="border-b border-[var(--color-border)] p-4">
        <h2 id="conversation-index-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
          Conversation index
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Immutable memory for the active project.</p>
      </div>

      <div className="p-3">
        {loading && conversations.length === 0 && (
          <div className="space-y-2" role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">Loading conversations</span>
            {[0, 1, 2].map((index) => (
              <div key={index} className="animate-pulse rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <div className="h-4 w-3/4 rounded bg-[var(--color-surface-hover)]" />
                <div className="mt-2 h-3 w-1/2 rounded bg-[var(--color-surface-hover)]" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-3 text-sm text-[var(--color-error-text)]" role="alert">
            <p>{error}</p>
            <button type="button" onClick={onRetry} className="mt-2 font-medium underline hover:no-underline">
              Retry
            </button>
          </div>
        )}

        {!loading && !error && conversations.length === 0 && (
          <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center" data-testid="context-empty">
            <p className="font-medium text-[var(--color-text-primary)]">No conversations yet</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Conversations appear here after context is captured for this project.
            </p>
          </div>
        )}

        {conversations.length > 0 && (
          <ul className="space-y-2" aria-label="Context conversations">
            {conversations.map((conversation) => {
              const isSelected = conversation.id === selectedId;
              const tags = parseTags(conversation.tags);
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    aria-current={isSelected ? "page" : undefined}
                    className={`w-full rounded border p-3 text-left transition-shadow hover:shadow-md ${
                      isSelected
                        ? "border-[var(--color-text-link)] bg-[var(--color-surface-selected)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]"
                    }`}
                  >
                    <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{conversation.title}</span>
                    <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                      {conversation.message_count} message{conversation.message_count === 1 ? "" : "s"} · {conversation.checkpoint_count} checkpoint{conversation.checkpoint_count === 1 ? "" : "s"}
                    </span>
                    {tags.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1" aria-label="Conversation tags">
                        {tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="mt-2 block text-[11px] text-[var(--color-text-muted)]">{formatDate(conversation.created_at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="mt-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Loading conversations…" : "Load more conversations"}
          </button>
        )}
      </div>
    </section>
  );
}
