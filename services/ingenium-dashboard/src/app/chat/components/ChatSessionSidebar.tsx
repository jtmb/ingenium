"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface ChatSessionSidebarProps {
  sessions: { id: string; title: string; updatedAt: number }[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onRename?: (id: string, title: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  isDrawer?: boolean;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  isLoading?: boolean;
  sessionsError?: string | null;
}

/**
 * Collapsible session history sidebar adapted from Aurora's design.
 *
 * - Collapsed: icon-stack (expand, new chat)
 * - Expanded: full session list with search, hover-reveal/touch-visible delete,
 *   active highlight, double-click rename, and new chat button
 * - Empty state: centered "No conversations yet" message
 */
export default function ChatSessionSidebar({
  sessions,
  activeId,
  onSelect,
  onDelete,
  onNew,
  onRename,
  collapsed,
  onToggle,
  isDrawer = false,
  searchQuery = "",
  onSearchChange,
  isLoading = false,
  sessionsError = null,
}: ChatSessionSidebarProps) {
  // Track which session is being renamed inline
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleRenameSubmit = useCallback(
    (id: string) => {
      const trimmed = renameDraft.trim();
      if (trimmed && onRename) {
        onRename(id, trimmed);
      }
      setRenamingId(null);
      setRenameDraft("");
    },
    [renameDraft, onRename],
  );

  const startRename = useCallback(
    (id: string, currentTitle: string) => {
      if (!onRename) return;
      setRenamingId(id);
      setRenameDraft(currentTitle);
    },
    [onRename],
  );

  // Filter sessions by search query (case-insensitive)
  const filteredSessions = searchQuery.trim()
    ? sessions.filter((s) =>
        s.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sessions;

  // Collapsed state — vertical icon bar
  if (collapsed && !isDrawer) {
    return (
      <aside
        className="flex flex-col items-center gap-2 pt-3 pb-3 w-[52px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-nav-bg)]"
        aria-label="Chat sidebar collapsed"
        data-testid="session-sidebar"
      >
        {/* Expand */}
        <button
          type="button"
          onClick={onToggle}
          className="p-2 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label="Expand sidebar"
          title="Expand sidebar"
          data-testid="session-sidebar-toggle"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 3L11 8L6 13"
            />
          </svg>
        </button>

        {/* New chat */}
        <button
          type="button"
          onClick={onNew}
          className="p-2 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label="New conversation"
          title="New conversation"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 3.33v9.34M3.33 8h9.34"
            />
          </svg>
        </button>

      </aside>
    );
  }

  // Expanded state — full sidebar
  return (
    <aside
      className="flex flex-col w-[260px] shrink-0 h-full border-r border-[var(--color-border)] bg-[var(--color-nav-bg)]"
      aria-label="Chat sessions"
      data-testid="session-sidebar"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--color-border)]">
        <button
          type="button"
          onClick={onToggle}
          className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          data-testid="session-sidebar-toggle"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 3L5 8L10 13"
            />
          </svg>
        </button>

        <button
          type="button"
          onClick={onNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] transition-colors"
          aria-label="New conversation"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 3.33v9.34M3.33 8h9.34"
            />
          </svg>
          <span>New Chat</span>
        </button>
      </div>

      {/* Search */}
      {onSearchChange && (
        <div className="px-3 py-2">
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] px-3 py-1.5 outline-none focus:border-blue-500"
            aria-label="Search sessions"
            data-testid="session-search"
          />
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-2">
        {isLoading ? (
          /* Loading skeleton */
          <div className="px-2 space-y-1.5">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-2 rounded-lg animate-pulse"
                aria-hidden="true"
              >
                <div className="w-4 h-4 rounded bg-[var(--color-border)] shrink-0" />
                <div
                  className="flex-1 h-3 rounded bg-[var(--color-border)]"
                  style={{ width: `${60 + Math.random() * 30}%` }}
                />
              </div>
            ))}
          </div>
        ) : sessionsError ? (
          /* Error state */
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-[var(--color-error-text)] shrink-0"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="8" />
              <path strokeLinecap="round" d="M10 6.67v3.33M10 13.33v.02" />
            </svg>
            <p className="text-sm text-[var(--color-error-text)]">
              {sessionsError}
            </p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)] px-4 text-center">
            {searchQuery.trim() ? "No matching conversations" : "No conversations yet"}
          </div>
        ) : (
          <ul className="space-y-0.5 px-2">
            {filteredSessions.map((session) => {
              const isActive = session.id === activeId;
              const isRenaming = renamingId === session.id;

              return (
                <li key={session.id}>
                  {isRenaming ? (
                    /* Inline rename input */
                    <div className="px-3 py-1">
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => handleRenameSubmit(session.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameSubmit(session.id);
                          if (e.key === "Escape") {
                            setRenamingId(null);
                            setRenameDraft("");
                          }
                        }}
                        className="w-full bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] outline-none focus:border-blue-500"
                        aria-label="Rename session"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(session.id)}
                      onDoubleClick={() =>
                        startRename(session.id, session.title)
                      }
                      className={[
                        "group flex items-center w-full gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                        isActive
                          ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
                      ].join(" ")}
                    >
                      {/* Conversation icon */}
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        aria-hidden="true"
                        className="shrink-0"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.67 3.33h10.66c.74 0 1.34.6 1.34 1.34v6.66c0 .74-.6 1.34-1.34 1.34H5.5l-2.83 2.83V4.67c0-.74.6-1.34 1.34-1.34z"
                        />
                      </svg>

                      {/* Title */}
                      <span className="flex-1 truncate">
                        {session.title}
                      </span>

                      {/* Delete button — always visible on touch, hover-reveal on desktop */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(session.id);
                        }}
                        className={[
                          "p-1 rounded shrink-0 transition-opacity",
                          "text-[var(--color-text-muted)] hover:text-red-400 hover:bg-[var(--color-surface-hover)]",
                          "opacity-100 md:opacity-0 md:group-hover:opacity-100",
                        ].join(" ")}
                        aria-label={`Delete ${session.title}`}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.33 4.08h9.34M5.25 4.08V3.2c0-.37.3-.67.67-.67h2.16c.37 0 .67.3.67.67v.88M5.83 6.42v3.5M8.17 6.42v3.5M3.5 4.08l.7 7.01c.04.38.36.66.74.66h4.12c.38 0 .7-.28.74-.66l.7-7.01"
                          />
                        </svg>
                      </button>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </aside>
  );
}
