"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type TaskCaptureResult } from "@/lib/api";
import TaskCaptureModal from "../../tasks/components/TaskCaptureModal";

const PAGE_SIZE = 20;

type ContextSource = Awaited<ReturnType<typeof api.context.sources.list>>["data"][number];

type CapturedTask = Pick<TaskCaptureResult["task"], "id" | "title">;

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function mergeSources(current: ContextSource[], incoming: ContextSource[]): ContextSource[] {
  const byId = new Map(current.map((source) => [source.id, source]));
  for (const source of incoming) byId.set(source.id, source);
  return [...byId.values()];
}

interface ContextSourcesSectionProps {
  project: string;
}

/** Compact, metadata-only source index for explicit task capture. */
export default function ContextSourcesSection({ project }: ContextSourcesSectionProps) {
  const [sources, setSources] = useState<ContextSource[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<ContextSource | null>(null);
  const [capturedTask, setCapturedTask] = useState<CapturedTask | null>(null);

  const loadSources = useCallback(async (offset = 0, append = false) => {
    setLoading(true);
    setError(null);
    if (!append) {
      setSources([]);
      setTotal(0);
      setNextOffset(0);
    }

    try {
      const response = await api.context.sources.list(project, { limit: PAGE_SIZE, offset });
      const pageSources = response.data;
      setSources((current) => append ? mergeSources(current, pageSources) : pageSources);
      setTotal(response.total);
      setNextOffset(response.offset + pageSources.length);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Unable to load context sources.");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSources();
  }, [loadSources]);

  const hasMore = nextOffset < total;

  return (
    <>
      <section
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        aria-labelledby="context-sources-title"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="context-sources-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
              Context sources
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Metadata only · {total} source{total === 1 ? "" : "s"} in {project}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSources()}
            disabled={loading}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {loading && sources.length === 0 && (
          <div className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm text-[var(--color-text-muted)]" role="status" aria-live="polite" aria-busy="true">
            Loading context sources…
          </div>
        )}

        {error && (
          <div className="mt-3 rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-3 text-sm text-[var(--color-error-text)]" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void loadSources()} className="mt-2 font-medium underline hover:no-underline">
              Retry
            </button>
          </div>
        )}

        {!loading && !error && sources.length === 0 && (
          <div className="mt-3 rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5 text-center" data-testid="context-sources-empty">
            <p className="font-medium text-[var(--color-text-primary)]">No context sources yet</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Metadata for indexed sources will appear here.</p>
          </div>
        )}

        {sources.length > 0 && (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Context source metadata">
            {sources.map((source) => (
              <li key={source.id} className="flex min-w-0 items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-text-primary)]" title={source.title}>{source.title}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    <span>{source.provenance}</span>
                    <span aria-hidden="true"> · </span>
                    <time dateTime={source.createdAt}>{formatCreatedAt(source.createdAt)}</time>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCapturedTask(null);
                    setSelectedSource(source);
                  }}
                  className="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)]"
                  aria-label={`Create task for ${source.title}`}
                >
                  Create task
                </button>
              </li>
            ))}
          </ul>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={() => void loadSources(nextOffset, true)}
            disabled={loading}
            className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Loading more…" : "Load more sources"}
          </button>
        )}

        {capturedTask && (
          <p className="mt-3 rounded border border-[var(--color-success-border)] bg-[var(--color-success-bg)] p-3 text-sm text-[var(--color-success-text)]" role="status" aria-live="polite" data-testid="context-task-capture-success">
            Task created: <span className="font-medium">{capturedTask.title}</span>{" "}
            <a href="/tasks" className="font-medium underline hover:no-underline">View task board</a>
          </p>
        )}
      </section>

      {selectedSource && (
        <TaskCaptureModal
          isOpen
          project={project}
          source={{ source_type: "context", source_id: selectedSource.id }}
          onClose={() => setSelectedSource(null)}
          onCaptured={(result) => setCapturedTask({ id: result.task.id, title: result.task.title })}
        />
      )}
    </>
  );
}
