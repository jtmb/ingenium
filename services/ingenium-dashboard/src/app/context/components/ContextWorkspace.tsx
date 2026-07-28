"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProject } from "@/lib/ProjectContext";
import {
  api,
  type ContextCheckpoint,
  type ContextConversationSummary,
  type ContextMessage,
  type ContextMessageSummary,
} from "@/lib/api";
import { buildContextUrl } from "../context-navigation";
import ContextCheckpointHistory from "./ContextCheckpointHistory";
import ContextConversationList from "./ContextConversationList";
import ContextMessageTimeline from "./ContextMessageTimeline";

type ContextDetail = {
  conversation: ContextConversationSummary;
  messages: ContextMessage[];
  messageCursor: string | null;
  checkpoints: ContextCheckpoint[];
  checkpointCursor: string | null;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `context-${crypto.randomUUID()}`;
  }
  return `context-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Project-aware browser for immutable context conversations. List and search
 * APIs intentionally return summaries; this component explicitly batch-loads
 * selected message content before rendering it.
 */
export default function ContextWorkspace() {
  const project = useProject();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get("conversation");
  const [conversations, setConversations] = useState<ContextConversationSummary[]>([]);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [locallySelectedId, setSelectedId] = useState<string | null>(selectedFromUrl);
  const selectedId = selectedFromUrl ?? locallySelectedId;
  const [detail, setDetail] = useState<ContextDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ContextMessage[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoringCheckpointId, setRestoringCheckpointId] = useState<string | null>(null);

  const retrieveMessages = useCallback(async (
    conversationId: string,
    summaries: ContextMessageSummary[],
  ): Promise<ContextMessage[]> => {
    if (summaries.length === 0) return [];
    const response = await api.context.messages.batch(
      conversationId,
      summaries.map((message) => message.id),
      project,
    );
    return response.data.messages;
  }, [project]);

  const loadConversationIndex = useCallback(async (cursor?: string, append = false) => {
    setListLoading(true);
    setListError(null);
    try {
      const response = await api.context.conversations.list(project, { limit: 30, cursor });
      const page = response.data;
      setConversations((current) => append ? [...current, ...page.data] : page.data);
      setConversationCursor(page.nextCursor);
      if (!append && !selectedFromUrl && page.data[0]) setSelectedId(page.data[0].id);
    } catch (error: unknown) {
      setListError(errorMessage(error, "Unable to load context conversations."));
    } finally {
      setListLoading(false);
    }
  }, [project, selectedFromUrl]);

  // This asynchronous data load begins after the component commits. The
  // callback owns loading/error state so retry and pagination share one path.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConversationIndex();
  }, [loadConversationIndex]);

  const selectConversation = useCallback((conversationId: string) => {
    setSelectedId(conversationId);
    setActionError(null);
    setActionMessage(null);
    router.replace(buildContextUrl(new URLSearchParams(searchParams.toString()), conversationId), { scroll: false });
  }, [router, searchParams]);

  const loadDetail = useCallback(async (conversationId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setSearchResults(null);
    setSearchTerm("");
    try {
      const [conversationResponse, messageResponse, checkpointResponse] = await Promise.all([
        api.context.conversations.get(conversationId, project),
        api.context.messages.list(conversationId, project, { limit: 50 }),
        api.context.checkpoints.list(conversationId, project, { limit: 20 }),
      ]);
      const messages = await retrieveMessages(conversationId, messageResponse.data.data);
      setDetail({
        conversation: conversationResponse.data,
        messages,
        messageCursor: messageResponse.data.nextCursor,
        checkpoints: checkpointResponse.data.data,
        checkpointCursor: checkpointResponse.data.nextCursor,
      });
    } catch (error: unknown) {
      setDetailError(errorMessage(error, "Unable to load this context conversation."));
    } finally {
      setDetailLoading(false);
    }
  }, [project, retrieveMessages]);

  // Detail retrieval is intentionally separate from index retrieval because
  // this is the explicit boundary where message content becomes available.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedId) void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const loadMoreMessages = async () => {
    if (!detail?.messageCursor || detailLoading) return;
    setDetailLoading(true);
    try {
      const response = await api.context.messages.list(detail.conversation.id, project, {
        limit: 50,
        cursor: detail.messageCursor,
      });
      const messages = await retrieveMessages(detail.conversation.id, response.data.data);
      setDetail((current) => current && current.conversation.id === detail.conversation.id
        ? { ...current, messages: [...current.messages, ...messages], messageCursor: response.data.nextCursor }
        : current);
    } catch (error: unknown) {
      setDetailError(errorMessage(error, "Unable to load more messages."));
    } finally {
      setDetailLoading(false);
    }
  };

  const loadMoreCheckpoints = async () => {
    if (!detail?.checkpointCursor || detailLoading) return;
    setDetailLoading(true);
    try {
      const response = await api.context.checkpoints.list(detail.conversation.id, project, {
        limit: 20,
        cursor: detail.checkpointCursor,
      });
      setDetail((current) => current && current.conversation.id === detail.conversation.id
        ? { ...current, checkpoints: [...current.checkpoints, ...response.data.data], checkpointCursor: response.data.nextCursor }
        : current);
    } catch (error: unknown) {
      setDetailError(errorMessage(error, "Unable to load more checkpoints."));
    } finally {
      setDetailLoading(false);
    }
  };

  const submitSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || !searchTerm.trim()) return;
    setSearchLoading(true);
    setActionError(null);
    try {
      const response = await api.context.messages.search(detail.conversation.id, searchTerm.trim(), project, 50);
      setSearchResults(await retrieveMessages(detail.conversation.id, response.data));
    } catch (error: unknown) {
      setActionError(errorMessage(error, "Unable to search this conversation."));
    } finally {
      setSearchLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchTerm("");
    setSearchResults(null);
  };

  const restoreCheckpoint = async (checkpoint: ContextCheckpoint) => {
    if (!detail) return;
    setRestoringCheckpointId(checkpoint.id);
    setActionError(null);
    setActionMessage(null);
    try {
      const response = await api.context.checkpoints.restore(
        detail.conversation.id,
        checkpoint.id,
        {
          expectedRevision: detail.conversation.revision,
          title: `Restored ${detail.conversation.title}`,
          metadata: { restoredBy: "dashboard" },
          idempotencyKey: newIdempotencyKey(),
        },
        project,
      );
      await loadConversationIndex();
      selectConversation(response.data.conversation.id);
      setActionMessage(`Created “${response.data.conversation.title}” as a new conversation. The source remains unchanged.`);
    } catch (error: unknown) {
      setActionError(errorMessage(error, "Unable to restore this checkpoint as a new conversation."));
    } finally {
      setRestoringCheckpointId(null);
    }
  };

  const currentTimeline = searchResults ?? detail?.messages ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Context</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Browse immutable conversation memory for <span className="font-medium">{project}</span>.
          </p>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">Conversation content is never included in index or search responses.</p>
      </header>

      <div className="grid min-h-[36rem] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
        <ContextConversationList
          conversations={conversations}
          selectedId={selectedId}
          loading={listLoading}
          error={listError}
          hasMore={conversationCursor !== null}
          onSelect={selectConversation}
          onRetry={() => void loadConversationIndex()}
          onLoadMore={() => void loadConversationIndex(conversationCursor ?? undefined, true)}
        />

        <section className="min-w-0 p-4 sm:p-6" aria-labelledby="context-detail-title">
          <span id="context-detail-title" className="sr-only">Context conversation detail</span>

          {!selectedId && !listLoading && !listError && (
            <div className="flex min-h-72 items-center justify-center rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-6 text-center">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Select a conversation</h2>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">Choose a conversation from the index to inspect its immutable message timeline.</p>
              </div>
            </div>
          )}

          {detailLoading && !detail && (
            <div className="flex min-h-72 items-center justify-center" role="status" aria-live="polite" aria-busy="true">
              <p className="text-sm text-[var(--color-text-muted)]">Loading conversation detail…</p>
            </div>
          )}

          {detailError && (
            <div className="rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-4" role="alert">
              <p className="text-sm text-[var(--color-error-text)]">{detailError}</p>
              {selectedId && (
                <button type="button" onClick={() => void loadDetail(selectedId)} className="mt-2 text-sm font-medium text-[var(--color-text-link)] underline hover:no-underline">
                  Retry detail loading
                </button>
              )}
            </div>
          )}

          {detail && (
            <div className="space-y-8">
              <header>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="break-words text-2xl font-bold text-[var(--color-text-primary)]">{detail.conversation.title}</h2>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      Revision {detail.conversation.revision} · {detail.conversation.message_count} immutable message{detail.conversation.message_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-[var(--color-surface-hover)] px-2 py-1 text-xs text-[var(--color-text-secondary)]">Priority {detail.conversation.priority}/10</span>
                </div>
              </header>

              {actionMessage && <p className="rounded border border-[var(--color-success-border)] bg-[var(--color-success-bg)] p-3 text-sm text-[var(--color-success-text)]" role="status">{actionMessage}</p>}
              {actionError && <p className="rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-3 text-sm text-[var(--color-error-text)]" role="alert">{actionError}</p>}

              <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void submitSearch(event)}>
                <label className="sr-only" htmlFor="context-message-search">Search messages in this conversation</label>
                <input
                  id="context-message-search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search messages in this conversation"
                  className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
                />
                <button
                  type="submit"
                  disabled={!searchTerm.trim() || searchLoading}
                  className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {searchLoading ? "Searching…" : "Search"}
                </button>
                {searchResults !== null && (
                  <button type="button" onClick={clearSearch} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)]">
                    Clear search
                  </button>
                )}
              </form>

              <ContextMessageTimeline
                messages={currentTimeline}
                loading={detailLoading}
                searching={searchLoading}
                isSearchResult={searchResults !== null}
                hasMore={detail.messageCursor !== null}
                onLoadMore={() => void loadMoreMessages()}
              />

              <ContextCheckpointHistory
                checkpoints={detail.checkpoints}
                loading={detailLoading}
                restoringCheckpointId={restoringCheckpointId}
                hasMore={detail.checkpointCursor !== null}
                onLoadMore={() => void loadMoreCheckpoints()}
                onRestore={(checkpoint) => void restoreCheckpoint(checkpoint)}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
