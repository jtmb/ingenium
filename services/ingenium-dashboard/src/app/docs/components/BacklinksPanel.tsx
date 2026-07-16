"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { DocBacklink } from "@/lib/docs-types";

type BacklinksPanelProps = {
  /** Page ID for which to fetch backlinks */
  pageId: number;
};

/**
 * BacklinksPanel — shows inbound wiki-links from other pages.
 * Uses [[slug]] syntax: pages referencing this page via its slug appear here.
 */
export default function BacklinksPanel({ pageId }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<DocBacklink[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBacklinks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.docs.backlinks.list(pageId);
      setBacklinks(res?.data ?? []);
    } catch {
      setBacklinks([]);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    fetchBacklinks();
  }, [fetchBacklinks]);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="animate-pulse space-y-1.5">
            <div className="h-3.5 bg-[var(--color-surface-muted)] rounded w-3/4" />
            <div className="h-3 bg-[var(--color-surface-muted)] rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Backlinks
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {backlinks.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <svg className="w-10 h-10 text-[var(--color-text-muted)] mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <p className="text-sm text-[var(--color-text-muted)]">
              No backlinks. Link to this page using <code className="px-1 py-0.5 bg-[var(--color-surface-muted)] rounded text-xs">[[page-slug]]</code> in other pages.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border-muted)]">
            {backlinks.map((bl, idx) => (
              <div
                key={`${bl.sourcePageId}-${idx}`}
                className="p-3 hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {bl.sourceTitle}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-5.5">
                  <span className="text-xs text-[var(--color-text-muted)]">
                    via &ldquo;{bl.linkText}&rdquo;
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                    {bl.sourceSlug}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
