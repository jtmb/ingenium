"use client";

import { useState, type ReactNode } from "react";
import WorkspaceControl from "../../components/WorkspaceControl";
import type { DocSpace } from "@/lib/api";

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

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
  /** Left pane — page tree */
  tree: ReactNode;
  /** Center pane — editor/reader */
  main: ReactNode;
  /** Right pane — metadata (optional, collapsible) */
  sidebar?: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DocsShell({
  spaces,
  selectedSpaceId,
  onSelectSpace,
  onSearch,
  onNewPage,
  tree,
  main,
  sidebar,
}: DocsShellProps) {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [treeDrawerOpen, setTreeDrawerOpen] = useState(false);

  const selectedSpace = spaces.find((s) => s.id === selectedSpaceId);

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-surface)]">
        {/* Mobile: hamburger to open tree drawer */}
        <button
          type="button"
          onClick={() => setTreeDrawerOpen(true)}
          className="md:hidden p-1.5 -ml-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
          aria-label="Open page tree"
        >
          <IconHamburger />
        </button>

        {/* Space selector dropdown */}
        <div className="relative">
          <select
            value={selectedSpaceId ?? ""}
            onChange={(e) => onSelectSpace(Number(e.target.value))}
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

        {/* Search button */}
        <button
          type="button"
          onClick={onSearch}
          className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors"
          title="Search pages"
          aria-label="Search pages"
        >
          <IconSearch />
        </button>

        {/* New Page button */}
        <button
          type="button"
          onClick={onNewPage}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          <IconPlus />
          <span className="hidden sm:inline">New Page</span>
        </button>

        {/* Right side controls */}
        <div className="ml-auto flex items-center gap-1">
          {/* Sidebar toggle */}
          {sidebar && (
            <button
              type="button"
              onClick={() => setSidebarVisible((v) => !v)}
              className={`p-1.5 rounded hover:bg-[var(--color-surface-hover)] transition-colors ${
                sidebarVisible ? "text-[var(--color-text-link)]" : "text-[var(--color-text-muted)]"
              }`}
              title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
              aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
              aria-pressed={sidebarVisible}
            >
              <IconSidebar />
            </button>
          )}
          <WorkspaceControl pageId="docs" />
        </div>
      </div>

      {/* ── Three-pane body ── */}
      <div className="flex flex-1 min-h-0">
        {/* Left pane: page tree (hidden on mobile, shown in drawer) */}
        <aside className="hidden md:block w-[260px] shrink-0 border-r border-[var(--color-border)] overflow-y-auto bg-[var(--color-surface-muted)]">
          {tree}
        </aside>

        {/* Center pane */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[900px] mx-auto h-full">{main}</div>
        </main>

        {/* Right pane: metadata sidebar (collapsible) */}
        {sidebar && sidebarVisible && (
          <aside className="hidden xl:block w-[280px] shrink-0 border-l border-[var(--color-border)] overflow-y-auto bg-[var(--color-surface)]">
            {sidebar}
          </aside>
        )}
      </div>

      {/* ── Mobile tree drawer overlay ── */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity duration-200 ${
          treeDrawerOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!treeDrawerOpen}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setTreeDrawerOpen(false)}
        />

        {/* Slide-out panel */}
        <div
          className={`
            absolute top-0 left-0 bottom-0
            w-64 max-w-[85vw]
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
          <div onClick={() => setTreeDrawerOpen(false)}>{tree}</div>
        </div>
      </div>
    </div>
  );
}
