"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { DocTrashItem } from "@/lib/docs-types";

type TrashPanelProps = {
  spaceId: number;
};

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

export default function TrashPanel({ spaceId }: TrashPanelProps) {
  const [items, setItems] = useState<DocTrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const fetchTrash = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.docs.trash.list(spaceId);
      setItems(res?.data ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  const handleRestore = async (pageId: number) => {
    setRestoringId(pageId);
    try {
      await api.docs.trash.restore(pageId);
      setItems((prev) => prev.filter((i) => i.page_id !== pageId));
    } catch (e: any) {
      setError(e?.message ?? "Failed to restore");
    } finally {
      setRestoringId(null);
    }
  };

  const handleEmpty = async () => {
    setEmptying(true);
    setError("");
    try {
      await api.docs.trash.empty(spaceId);
      setItems([]);
      setConfirmEmpty(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to empty trash");
    } finally {
      setEmptying(false);
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1 flex-1">
                <div className="h-3.5 bg-[var(--color-surface-muted)] rounded w-2/3" />
                <div className="h-3 bg-[var(--color-surface-muted)] rounded w-1/3" />
              </div>
              <div className="h-7 w-16 bg-[var(--color-surface-muted)] rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Trash</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <svg
              className="w-10 h-10 text-[var(--color-text-muted)] mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            <p className="text-sm text-[var(--color-text-muted)]">
              Trash is empty. Archived pages appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border-muted)]">
            {items.map((item) => (
              <div
                key={item.page_id}
                className="flex items-center justify-between p-3 hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {item.title}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Deleted {timeAgo(item.deleted_at)}
                  </p>
                </div>
                <button
                  className="ml-3 px-2.5 py-1 text-xs text-[var(--color-text-link)] hover:bg-[var(--color-surface-selected)] rounded shrink-0 disabled:opacity-50"
                  disabled={restoringId === item.page_id}
                  onClick={() => handleRestore(item.page_id)}
                >
                  {restoringId === item.page_id ? "Restoring…" : "Restore"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 text-xs text-red-600 bg-[var(--color-error-bg)]">
          {error}
        </div>
      )}

      {/* Empty trash */}
      {items.length > 0 && (
        <div className="px-4 py-3 border-t border-[var(--color-border)]">
          {confirmEmpty ? (
            <div className="p-2 bg-[var(--color-warning-bg)] rounded text-xs space-y-2">
              <p className="text-[var(--color-text-secondary)]">
                Permanently delete {items.length} item{items.length !== 1 ? "s" : ""}? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  className="px-2.5 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
                  disabled={emptying}
                  onClick={handleEmpty}
                >
                  {emptying ? "Deleting…" : "Delete Forever"}
                </button>
                <button
                  className="px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded"
                  onClick={() => setConfirmEmpty(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="w-full px-3 py-2 text-xs text-red-600 hover:bg-[var(--color-error-bg)] rounded transition-colors"
              onClick={() => setConfirmEmpty(true)}
            >
              Empty trash ({items.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
