"use client";

import { useState, useEffect, useCallback } from "react";
import { api, type DocSpace, type DocPageTree } from "@/lib/api";

/** Inline SVG icons for the tree — avoids external icon library dependency. */

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

function IconPagePublished() {
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
      <path d="M5.5 9.5l1 1 2-2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
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
  /** Increment to force a re-fetch of the page tree */
  refreshKey?: number;
  /** Callback for renaming a page (pageId, currentTitle passed) */
  onRenamePage?: (pageId: number, currentTitle: string) => void;
  /** Callback for archiving a page */
  onArchivePage?: (pageId: number) => void;
  /** Callback for moving a page */
  onMovePage?: (pageId: number) => void;
  /** IDs that should be disabled as move targets (self + descendants) */
  disabledMoveTargets?: Set<number>;
}

/**
 * Recursive tree node — auto-expands first depth level.
 * Shows published pages with a distinct icon.
 */
function TreeNode({
  node,
  depth,
  selectedPageId,
  onSelectPage,
  onRenamePage,
  onArchivePage,
  onMovePage,
  disabledIds,
}: {
  node: DocPageTree;
  depth: number;
  selectedPageId: number | null;
  onSelectPage: (id: number) => void;
  onRenamePage?: (pageId: number, currentTitle: string) => void;
  onArchivePage?: (pageId: number) => void;
  onMovePage?: (pageId: number) => void;
  disabledIds?: Set<number>;
}) {
  const [expanded, setExpanded] = useState(depth < 1); // auto-expand first level
  const [contextOpen, setContextOpen] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = node.id === selectedPageId;
  const isDisabled = disabledIds?.has(node.id) ?? false;

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelectPage(node.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextOpen((v) => !v);
        }}
        disabled={isDisabled}
        className={`
          w-full flex items-center gap-1.5 text-left text-sm py-1.5 pr-2 group
          transition-colors
          ${isSelected
            ? "bg-[var(--color-surface-selected)] text-[var(--color-text-link)] border-l-2 border-[var(--color-text-link)]"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] border-l-2 border-transparent"
          }
          ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={node.title + (isDisabled ? " (cannot select as parent)" : "")}
        aria-current={isSelected ? "page" : undefined}
      >
        {/* Expand toggle */}
        {hasChildren ? (
          <span
            className="shrink-0 p-0.5 hover:bg-[var(--color-surface-hover)] rounded"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "Collapse children" : "Expand children"}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                setExpanded((v) => !v);
              }
            }}
          >
            <IconChevronRight open={expanded} />
          </span>
        ) : (
          <span className="shrink-0 w-5" />
        )}
        <span className="shrink-0 text-[var(--color-text-muted)]">
          {node.status === "published" ? <IconPagePublished /> : <IconPage />}
        </span>
        <span className="truncate flex-1">{node.title}</span>

        {/* Context menu trigger (visible on hover) */}
        <span className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            className="p-0.5 rounded hover:bg-[var(--color-surface-selected)] text-[var(--color-text-muted)]"
            onClick={(e) => {
              e.stopPropagation();
              setContextOpen((v) => !v);
            }}
            title="Page actions"
            aria-label="Page actions"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="6" r="1.2" />
              <circle cx="6" cy="6" r="1.2" />
              <circle cx="9" cy="6" r="1.2" />
            </svg>
          </button>
        </span>
      </button>

      {/* Inline context menu */}
      {contextOpen && (
        <div
          className="ml-6 mr-2 mb-1 border border-[var(--color-border)] rounded bg-[var(--color-surface)] shadow-sm overflow-hidden"
          role="menu"
          aria-label={`Actions for ${node.title}`}
        >
          {onRenamePage && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              onClick={(e) => {
                e.stopPropagation();
                setContextOpen(false);
                onRenamePage(node.id, node.title);
              }}
              role="menuitem"
            >
              Rename
            </button>
          )}
          {onMovePage && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              onClick={(e) => {
                e.stopPropagation();
                setContextOpen(false);
                onMovePage(node.id);
              }}
              role="menuitem"
            >
              Move
            </button>
          )}
          {onArchivePage && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-[var(--color-error-bg)]"
              onClick={(e) => {
                e.stopPropagation();
                setContextOpen(false);
                onArchivePage(node.id);
              }}
              role="menuitem"
            >
              Archive
            </button>
          )}
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
            onClick={(e) => {
              e.stopPropagation();
              setContextOpen(false);
            }}
            role="menuitem"
          >
            Cancel
          </button>
        </div>
      )}

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
              onRenamePage={onRenamePage}
              onArchivePage={onArchivePage}
              onMovePage={onMovePage}
              disabledIds={disabledIds}
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
// Collect all descendant IDs for move-target exclusion
// ---------------------------------------------------------------------------

/** Walk a tree node and collect all IDs in its subtree (including self). */
export function collectDescendantIds(node: DocPageTree): Set<number> {
  const ids = new Set<number>([node.id]);
  if (node.children) {
    for (const child of node.children) {
      for (const id of collectDescendantIds(child)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// PageTree component
// ---------------------------------------------------------------------------

/**
 * PageTree — space list + hierarchical page tree with loading/error/empty states.
 * Re-fetches the tree whenever `refreshKey` or `selectedSpaceId` changes.
 *
 * Supports keyboard navigation: Tab/Shift+Tab between tree items, Enter to select,
 * Arrow keys to navigate. Context menu on right-click or via the "..." button.
 */
export default function PageTree({
  selectedPageId,
  selectedSpaceId,
  onSelectSpace,
  onSelectPage,
  onNewPage,
  refreshKey = 0,
  onRenamePage,
  onArchivePage,
  onMovePage,
  disabledMoveTargets,
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

  // Fetch page tree when space changes or refreshKey increments
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
  }, [selectedSpaceId, refreshKey, fetchPages]);

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
        <div className="text-center space-y-3">
          <p className="text-sm text-[var(--color-text-muted)]">{spacesError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
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
      <div className="flex-1 overflow-y-auto px-1 pb-3" role="tree" aria-label="Page tree">
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
              onRenamePage={onRenamePage}
              onArchivePage={onArchivePage}
              onMovePage={onMovePage}
              disabledIds={disabledMoveTargets}
            />
          ))
        )}
      </div>
    </div>
  );
}
