"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { DocVersion } from "@/lib/docs-types";

type HistoryPanelProps = {
  pageId: number;
  /** Called with versionId after a successful restore API call */
  onRestore: (versionId: number) => void;
};

/** Relative timestamp formatting for version list display. */
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/**
 * HistoryPanel — version-by-version history with expand-to-preview and
 * confirm-first restore flow. The `workspace` pattern: current version is tagged,
 * older versions can be expanded to view the full content before restoring.
 */
export default function HistoryPanel({ pageId, onRestore }: HistoryPanelProps) {
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);

  const fetchVersions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.docs.versions.list(pageId);
      setVersions(res?.data ?? []);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const handleRestore = async (versionId: number) => {
    setRestoring(true);
    try {
      await api.docs.versions.restore(pageId, versionId);
      onRestore(versionId);
      setConfirmRestoreId(null);
    } catch {
      // Let the parent handle UI feedback
    } finally {
      setRestoring(false);
    }
  };

  const contentPreview = (content: string, maxLen = 100) => {
    const plain = content.replace(/[#*`\[\]]/g, "").trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="h-3.5 bg-[var(--color-surface-muted)] rounded w-20" />
                <div className="h-3 bg-[var(--color-surface-muted)] rounded w-16" />
              </div>
              <div className="h-3 bg-[var(--color-surface-muted)] rounded w-3/4" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Version History
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <svg className="w-10 h-10 text-[var(--color-text-muted)] mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-[var(--color-text-muted)]">
              No version history yet. Versions are created when you save changes.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border-muted)]">
            {versions.map((v) => {
              const isExpanded = expandedId === v.id;
              const isConfirming = confirmRestoreId === v.id;

              return (
                <div key={v.id} className="p-3">
                  <div
                    className="flex items-start justify-between cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : v.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[var(--color-text-primary)]">
                          v{v.revision}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {timeAgo(v.createdAt)}
                        </span>
                        {v.revision === versions.length && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 truncate">
                        {contentPreview(v.content)}
                      </p>
                    </div>
                    <svg
                      className={`w-4 h-4 text-[var(--color-text-muted)] ml-2 shrink-0 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="mt-3 pl-1">
                      <div className="bg-[var(--color-surface-muted)] rounded p-3 max-h-64 overflow-y-auto">
                        <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap font-mono">
                          {v.content}
                        </pre>
                      </div>

                      {isConfirming ? (
                        <div className="mt-3 p-2 bg-[var(--color-warning-bg)] rounded text-xs">
                          <p className="text-[var(--color-text-secondary)] mb-2">
                            Restore version {v.revision}? Current content will be replaced.
                          </p>
                          <div className="flex gap-2">
                            <button
                              className="px-2.5 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                              disabled={restoring}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRestore(v.id);
                              }}
                            >
                              {restoring ? "Restoring…" : "Confirm"}
                            </button>
                            <button
                              className="px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmRestoreId(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="mt-2.5 px-2.5 py-1 text-xs text-[var(--color-text-link)] hover:bg-[var(--color-surface-selected)] rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmRestoreId(v.id);
                          }}
                        >
                          Restore this version
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
