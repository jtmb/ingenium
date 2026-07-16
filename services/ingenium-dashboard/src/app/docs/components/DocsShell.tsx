"use client";

import { useState, type ReactNode } from "react";
import WorkspaceControl from "../../components/WorkspaceControl";
import type { DocSpace } from "@/lib/api";

/** Inline SVG icon components — kept local to avoid external icon library dependency. */

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconSidebar() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 2v12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconHamburger() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 7.5v4M8 5v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconFileText() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2h6l4 4v7a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.5 10.5a3 3 0 01-.66-5.93A3.75 3.75 0 0111.93 4H12a3 3 0 01.75 5.94M8 7.5v5M5.5 10l2.5-2.5L10.5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface DocsShellProps {
  /** List of doc spaces for the space selector dropdown */
  spaces: DocSpace[];
  /** Currently selected space ID */
  selectedSpaceId: number | null;
  /** Callback when user selects a space */
  onSelectSpace: (spaceId: number) => void;
  /** Callback when search button is clicked */
  onSearch: () => void;
  /** Callback when New Page button is clicked */
  onNewPage: () => void;
  /** Callback for template picker */
  onTemplate?: () => void;
  /** Callback for import/export */
  onImportExport?: () => void;
  /** Left pane — page tree */
  tree: ReactNode;
  /** Center pane — editor/reader */
  main: ReactNode;
  /** Right pane — metadata/sidebar content (optional, collapsible) */
  sidebar?: ReactNode;
  /** Whether the right sidebar is visible (desktop, controlled externally) */
  sidebarVisible?: boolean;
  /** Toggle right sidebar visibility */
  onToggleSidebar?: () => void;
  /** Extra controls rendered in the top bar between standard buttons and right-side controls */
  topBarActions?: ReactNode;
  /** Whether spaces are loading */
  spacesLoading?: boolean;
}

/**
 * DocsShell — responsive three-pane docs workspace layout (tree | editor | sidebar).
 *
 * Responsive behaviour:
 * - Left tree pane: 260px on lg+, slide-out drawer overlay on smaller screens
 * - Center editor: flex-1, constrained max-width on very wide screens
 * - Right sidebar: 280px on lg+, slide-out drawer overlay on smaller screens
 *
 * The left pane uses md as its breakpoint (standard sidebar), while the right pane
 * uses lg (overlay on tablets, inline on desktop). This keeps the editor usable
 * on tablets while still providing access to the info panel.
 */
export default function DocsShell({
  spaces,
  selectedSpaceId,
  onSelectSpace,
  onSearch,
  onNewPage,
  onTemplate,
  onImportExport,
  tree,
  main,
  sidebar,
  sidebarVisible = true,
  onToggleSidebar,
  topBarActions,
  spacesLoading,
}: DocsShellProps) {
  /** treeDrawerOpen: mobile-only overlay drawer for the left page tree */
  const [treeDrawerOpen, setTreeDrawerOpen] = useState(false);
  /** rightPanelOpen: mobile/tablet overlay for the right info panel */
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  const selectedSpace = spaces.find((s) => s.id === selectedSpaceId);

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-surface)] h-11" role="toolbar" aria-label="Docs workspace toolbar">
        {/* Mobile: hamburger to open tree drawer */}
        <button
          type="button"
          onClick={() => setTreeDrawerOpen(true)}
          className="lg:hidden p-1.5 -ml-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
          aria-label="Open page tree"
          title="Open page tree"
        >
          <IconHamburger />
        </button>

        {/* Space selector dropdown */}
        {spacesLoading ? (
          <div className="h-7 w-28 bg-[var(--color-surface-hover)] animate-pulse rounded shrink-0" />
        ) : spaces.length === 0 ? (
          <span className="text-sm text-[var(--color-text-muted)] px-2 shrink-0">No spaces</span>
        ) : (
          <div className="relative shrink-0">
            <select
              value={selectedSpaceId ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                if (!Number.isNaN(id)) onSelectSpace(id);
              }}
              className="appearance-none border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer px-3 py-1.5 pr-7 text-[var(--color-text-primary)]"
              aria-label="Select space"
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {/* Chevron */}
            <svg
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--color-text-muted)]"
              fill="none"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}

        {/* Search button */}
        <button
          type="button"
          onClick={onSearch}
          className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors shrink-0"
          title="Search pages"
          aria-label="Search pages"
        >
          <IconSearch />
        </button>

        {/* New Page button */}
        <button
          type="button"
          onClick={onNewPage}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shrink-0"
          title="Create a new page"
          aria-label="Create new page"
        >
          <IconPlus />
          <span className="hidden sm:inline">New Page</span>
        </button>

        {/* Template button */}
        {onTemplate && (
          <button
            type="button"
            onClick={onTemplate}
            className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors shrink-0 hidden sm:block"
            title="New from template"
            aria-label="Create page from template"
          >
            <IconFileText />
          </button>
        )}

        {/* Import/Export button */}
        {onImportExport && (
          <button
            type="button"
            onClick={onImportExport}
            className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] transition-colors shrink-0 hidden sm:block"
            title="Import or export pages"
            aria-label="Import or export pages"
          >
            <IconUpload />
          </button>
        )}

        {/* Extra top bar actions slot (e.g., publish/archive control, breadcrumb indicator) */}
        {topBarActions && (
          <div className="flex items-center gap-1.5 shrink-0">{topBarActions}</div>
        )}

        {/* Right side controls */}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {/* Mobile/tablet: right panel overlay toggle */}
          {sidebar && (
            <>
              <button
                type="button"
                onClick={() => setRightPanelOpen(true)}
                className="lg:hidden p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors"
                title="Open details panel"
                aria-label="Open details panel"
              >
                <IconInfo />
              </button>
              <button
                type="button"
                onClick={onToggleSidebar}
                className={`hidden lg:block p-1.5 rounded hover:bg-[var(--color-surface-hover)] transition-colors ${
                  sidebarVisible ? "text-[var(--color-text-link)]" : "text-[var(--color-text-muted)]"
                }`}
                title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
                aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
                aria-pressed={sidebarVisible}
              >
                <IconSidebar />
              </button>
            </>
          )}
          <WorkspaceControl pageId="docs" />
        </div>
      </div>

      {/* ── Three-pane body ── */}
      <div className="flex flex-1 min-h-0">
        {/* Left pane: page tree (lg+ inline, mobile drawer) */}
        <aside className="hidden lg:block w-[260px] shrink-0 border-r border-[var(--color-border)] overflow-y-auto bg-[var(--color-surface-muted)]">
          {tree}
        </aside>

        {/* Center pane */}
        <main className="flex-1 min-w-0 overflow-hidden">
          {main}
        </main>

        {/* Right pane: metadata sidebar (lg+ inline, collapsible) */}
        {sidebar && sidebarVisible && (
          <aside className="hidden lg:block w-[280px] shrink-0 border-l border-[var(--color-border)] overflow-y-auto bg-[var(--color-surface)]">
            {sidebar}
          </aside>
        )}
      </div>

      {/* ── Mobile tree drawer overlay ── */}
      <div
        className={`lg:hidden fixed inset-0 z-40 transition-opacity duration-200 ${
          treeDrawerOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!treeDrawerOpen}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setTreeDrawerOpen(false)}
          aria-hidden="true"
        />

        {/* Slide-out panel */}
        <div
          className={`
            absolute top-0 left-0 bottom-0
            w-72 max-w-[85vw]
            bg-[var(--color-surface)]
            border-r border-[var(--color-border)]
            overflow-y-auto
            transition-transform duration-200 ease-in-out
            ${treeDrawerOpen ? "translate-x-0" : "-translate-x-full"}
          `}
          role="dialog"
          aria-modal="true"
          aria-label="Page tree"
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {selectedSpace?.name ?? "Pages"}
            </span>
            <button
              onClick={() => setTreeDrawerOpen(false)}
              className="p-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
              aria-label="Close tree"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M5 5l8 8M13 5L5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {/* Clicking a tree item closes the drawer */}
          <div onClick={() => setTreeDrawerOpen(false)}>{tree}</div>
        </div>
      </div>

      {/* ── Mobile/tablet right panel overlay ── */}
      {sidebar && (
        <div
          className={`lg:hidden fixed inset-0 z-40 transition-opacity duration-200 ${
            rightPanelOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          }`}
          aria-hidden={!rightPanelOpen}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setRightPanelOpen(false)}
            aria-hidden="true"
          />

          {/* Slide-out panel */}
          <div
            className={`
              absolute top-0 right-0 bottom-0
              w-80 max-w-[85vw]
              bg-[var(--color-surface)]
              border-l border-[var(--color-border)]
              overflow-y-auto
              transition-transform duration-200 ease-in-out
              ${rightPanelOpen ? "translate-x-0" : "translate-x-full"}
            `}
            role="dialog"
            aria-modal="true"
            aria-label="Page details"
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                Details
              </span>
              <button
                onClick={() => setRightPanelOpen(false)}
                className="p-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
                aria-label="Close panel"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M5 5l8 8M13 5L5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {sidebar}
          </div>
        </div>
      )}
    </div>
  );
}
