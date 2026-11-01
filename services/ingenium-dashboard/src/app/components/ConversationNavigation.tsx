"use client";

import type { ReactNode } from "react";

export const conversationActionClass = "rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-blue-400 disabled:opacity-50";
export function conversationRowClass(active: boolean) {
  return `group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-blue-400 ${active
    ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"}`;
}

export function ConversationSidebar({ children, label, id, testId, toggleTestId, onClose,
  closeLabel = "Collapse sidebar", onNew, newDisabled = false, widthClassName = "w-[260px]", className = "",
}: {
  children: ReactNode; label: string; id?: string; testId?: string; toggleTestId?: string;
  onClose: () => void; closeLabel?: string; onNew: () => void; newDisabled?: boolean;
  widthClassName?: string; className?: string;
}) {
  return <aside id={id} aria-label={label} data-testid={testId}
    className={`flex h-full shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-nav-bg)] ${widthClassName} ${className}`}>
    <header className="flex min-h-12 items-center gap-2 border-b border-[var(--color-border)] px-2 py-2">
      <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} data-testid={toggleTestId}
        className="rounded-md p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-blue-400">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 3L5 8L10 13" />
        </svg>
      </button>
      <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-text-secondary)]">History</h2>
      <button type="button" onClick={onNew} disabled={newDisabled} aria-label="New conversation" className={conversationActionClass}>New Chat</button>
    </header>
    {children}
  </aside>;
}

export function ConversationToolbar({ expanded, onToggle, onNew, newDisabled = false, desktopHistoryOnly = false, controls, children,
}: {
  expanded: boolean; onToggle: () => void; onNew: () => void; newDisabled?: boolean;
  desktopHistoryOnly?: boolean; controls?: string; children?: ReactNode;
}) {
  return <header className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2 text-xs text-[var(--color-text-secondary)]">
    <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={controls}
      className={`${conversationActionClass} ${desktopHistoryOnly ? "hidden md:inline-flex" : ""}`}>History</button>
    <button type="button" onClick={onNew} disabled={newDisabled} className={conversationActionClass}>New conversation</button>
    {children}
  </header>;
}
