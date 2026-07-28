"use client";

import type { ContextCheckpoint } from "@/lib/api";

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

interface ContextCheckpointHistoryProps {
  checkpoints: ContextCheckpoint[];
  loading: boolean;
  restoringCheckpointId: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRestore: (checkpoint: ContextCheckpoint) => void;
}

/** Append-only checkpoint history. Restore actions always branch to a new conversation. */
export default function ContextCheckpointHistory({
  checkpoints,
  loading,
  restoringCheckpointId,
  hasMore,
  onLoadMore,
  onRestore,
}: ContextCheckpointHistoryProps) {
  return (
    <section aria-labelledby="checkpoint-history-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="checkpoint-history-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Checkpoint history</h2>
        <span className="text-xs text-[var(--color-text-muted)]">Restoring preserves this conversation and branches a new one.</span>
      </div>

      {loading && checkpoints.length === 0 && (
        <div className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm text-[var(--color-text-muted)]" role="status" aria-live="polite" aria-busy="true">
          Loading checkpoint history…
        </div>
      )}

      {!loading && checkpoints.length === 0 && (
        <div className="mt-3 rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5 text-center text-sm text-[var(--color-text-muted)]">
          No checkpoints have been recorded for this conversation.
        </div>
      )}

      {checkpoints.length > 0 && (
        <ol className="mt-3 space-y-2" aria-label="Context checkpoints">
          {checkpoints.map((checkpoint) => {
            const restoring = restoringCheckpointId === checkpoint.id;
            return (
              <li key={checkpoint.id} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 hover:shadow-md transition-shadow">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">Checkpoint {checkpoint.sequence + 1}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {checkpoint.message_count} message{checkpoint.message_count === 1 ? "" : "s"} · {formatDate(checkpoint.created_at)}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]" title={checkpoint.state_hash}>
                      {checkpoint.state_hash.slice(0, 16)}…
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestore(checkpoint)}
                    disabled={restoringCheckpointId !== null}
                    className="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {restoring ? "Restoring…" : "Restore as new conversation"}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Loading checkpoints…" : "Load older checkpoints"}
        </button>
      )}
    </section>
  );
}
