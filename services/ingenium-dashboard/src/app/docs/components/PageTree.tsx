"use client";

import { useState, useEffect, useCallback } from "react";
import { api, type DocSpace, type DocPageTree } from "@/lib/api";

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function IconChevronRight({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPage() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3 1.5h5l3.5 3.5v7a1 1 0 01-1 1H4a1 1 0 01-1-1V2.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 1.5v3.5H11.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSpace() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2 3.5a1 1 0 011-1h2l1 1.5H11a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1V3.5z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PageTreeProps {
  selectedPageId: number | null;
  selectedSpaceId: number | null;
  onSelectSpace: (spaceId: number) => void;
  onSelectPage: (pageId: number) => void;
  onNewPage: () => void;
}

// ---------------------------------------------------------------------------
// Tree node component
// ---------------------------------------------------------------------------

function TreeNode({
  node,
  depth,
  selectedPageId,
  onSelectPage,
}: {
  node: DocPageTree;
  depth: number;
  selectedPageId: number | null;
  onSelectPage: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1); // auto-expand first level
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = node.id === selectedPageId;

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelectPage(node.id)}
        className={`
          w-full flex items-center gap-1.5 text-left text-sm py-1.5 pr-2
          transition-colors
          ${isSelected
            ? "bg-[var(--color-surface-selected)] text-[var(--color-text-link)] border-l-2 border-[var(--color-text-link)]"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] border-l-2 border-transparent"
          }
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={node.title}
      >
        {/* Expand toggle */}
        {hasChildren ? (
          <span
            className="shrink-0 p-0.5 hover:bg-[var(--color-surface-hover)] rounded"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <IconChevronRight open={expanded} />
          </span>
        ) : (
          <span className="shrink-0 w-5" />
        )}
        <span className="shrink-0 text-[var(--color-text-muted)]">
          <IconPage />
        </span>
        <span className="truncate flex-1">{node.title}</span>
      </button>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedPageId={selectedPageId}
              onSelectPage={onSelectPage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TreeSkeleton() {
  return (
    <div className="px-3 py-3 space-y-2">
      {/* Spaces skeleton */}
      {[1, 2].map((i) => (
        <div key={`space-sk-${i}`} className="flex items-center gap-2 py-1.5">
          <div className="w-3.5 h-3.5 bg-[var(--color-surface-hover)] rounded animate-pulse" />
          <div className="h-3.5 bg-[var(--color-surface-hover)] rounded animate-pulse w-3/4" />
        </div>
      ))}
      <div className="border-t border-[var(--color-border-muted)] my-2" />
      {/* Page skeleton */}
      {[1, 2, 3, 4].map((i) => (
        <div key={`page-sk-${i}`} className="flex items-center gap-2 py-1.5" style={{ paddingLeft: `${(i % 2) * 12 + 8}px` }}>
          <div className="w-3 h-3 bg-[var(--color-surface-hover)] rounded animate-pulse" />
          <div className="h-3 bg-[var(--color-surface-hover)] rounded animate-pulse" style={{ width: `${60 + (i * 10)}%` }} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PageTree({
  selectedPageId,
  selectedSpaceId,
  onSelectSpace,
  onSelectPage,
  onNewPage,
}: PageTreeProps) {
  const [spaces, setSpaces] = useState<DocSpace[]>([]);
  const [pages, setPages] = useState<DocPageTree[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [spacesError, setSpacesError] = useState<string | null>(null);

  // Fetch spaces on mount
  useEffect(() => {
    let cancelled = false;
    api.docs.spaces
      .list()
      .then(({ data }) => {
        if (cancelled) return;
        const s = data ?? [];
        setSpaces(s);
        // Auto-select first space if none selected
        if (s.length > 0 && !selectedSpaceId && s[0]) {
          onSelectSpace(s[0].id);
        }
      })
      .catch((err) => {
        if (!cancelled) setSpacesError(err.message ?? "Failed to load spaces");
      })
      .finally(() => {
        if (!cancelled) setSpacesLoading(false);
      });
    return () => { cancelled = true; };
    // Run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch page tree when space changes
  const fetchPages = useCallback(async (spaceId: number) => {
    setPagesLoading(true);
    try {
      const { data } = await api.docs.pages.tree(spaceId);
      setPages(data ?? []);
    } catch {
      setPages([]);
    } finally {
      setPagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSpaceId) {
      fetchPages(selectedSpaceId);
    } else {
      setPages([]);
    }
  }, [selectedSpaceId, fetchPages]);

  // Loading state
  if (spacesLoading) {
    return (
      <div className="h-full">
        <TreeSkeleton />
      </div>
    );
  }

  // Error state
  if (spacesError) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-sm text-[var(--color-text-muted)] text-center">{spacesError}</p>
      </div>
    );
  }

  // Empty state
  if (spaces.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-sm text-[var(--color-text-muted)] text-center">
          No doc spaces configured yet.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Spaces list */}
      <div className="px-2 pt-3 pb-1">
        {spaces.map((space) => (
          <button
            key={space.id}
            type="button"
            onClick={() => onSelectSpace(space.id)}
            className={`
              w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
              ${space.id === selectedSpaceId
                ? "bg-[var(--color-surface-selected)] text-[var(--color-text-link)] font-medium"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              }
            `}
          >
            <span className="shrink-0">
              <IconSpace />
            </span>
            <span className="truncate flex-1 text-left">{space.name}</span>
          </button>
        ))}
      </div>

      <div className="mx-3 my-1 border-t border-[var(--color-border-muted)]" />

      {/* Pages header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Pages
        </span>
        <button
          type="button"
          onClick={onNewPage}
          className="p-0.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          title="New page"
          aria-label="New page"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Page tree */}
      <div className="flex-1 overflow-y-auto px-1 pb-3">
        {pagesLoading ? (
          <div className="px-2 py-2 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={`sub-sk-${i}`} className="flex items-center gap-2 py-1" style={{ paddingLeft: `${(i % 2) * 12 + 8}px` }}>
                <div className="w-2.5 h-2.5 bg-[var(--color-surface-hover)] rounded animate-pulse" />
                <div className="h-2.5 bg-[var(--color-surface-hover)] rounded animate-pulse" style={{ width: `${50 + (i * 15)}%` }} />
              </div>
            ))}
          </div>
        ) : pages.length === 0 ? (
          <p className="px-3 py-4 text-xs text-[var(--color-text-muted)] text-center">
            No pages yet. Click + to create one.
          </p>
        ) : (
          pages.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedPageId={selectedPageId}
              onSelectPage={onSelectPage}
            />
          ))
        )}
      </div>
    </div>
  );
}
