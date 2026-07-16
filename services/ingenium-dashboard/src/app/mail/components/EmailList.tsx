"use client";

/**
 * EmailList — search bar + scrollable email rows with pagination.
 * Shows sender, subject, snippet, and date. Distinguishes read/unread.
 * When source is "pending", displays a syncing indicator instead of an empty void.
 */
export default function EmailList({
  emails,
  selectedUid,
  onSelect,
  onPageChange,
  total,
  page,
  loading,
  onSearch,
  error,
  onRefresh,
  source,
  width,
}: {
  emails: any[];
  selectedUid?: string;
  onSelect: (uid: string) => void;
  onPageChange: (p: number) => void;
  total: number;
  page: number;
  loading: boolean;
  onSearch: (q: string) => void;
  error?: string | null;
  onRefresh?: () => void;
  source?: string;
  width?: number;
}) {
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="flex-shrink-0 flex flex-col border-r border-[var(--color-border)]" style={{ width: width ?? 350 }}>
      {/* Search bar */}
      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
        <input
          type="text"
          placeholder="Search emails..."
          className="flex-1 border border-[var(--color-border)] rounded px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-200"
          onChange={(e) => onSearch(e.target.value)}
        />
        {onRefresh && (
          <button
            onClick={onRefresh}
            title="Refresh"
            className="px-2 py-1.5 border border-[var(--color-border)] rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] flex-shrink-0"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-3 mx-4 mt-2 bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded text-sm text-[var(--color-error-text)]">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex-1 divide-y divide-[var(--color-border)]">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="px-4 py-3 flex gap-3 animate-pulse">
              <div className="w-40 h-4 bg-[var(--color-surface-muted)] rounded" />
              <div className="flex-1 h-4 bg-[var(--color-surface-muted)] rounded" />
              <div className="w-20 h-4 bg-[var(--color-surface-muted)] rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Email rows */}
      {!loading && emails.length > 0 && (
        <div className="flex-1 divide-y divide-[var(--color-border)] overflow-y-auto">
          {emails.map((email: any) => {
            const isUnread = !email.flags?.includes("\\Seen");
            const isSelected = selectedUid === email.uid;

            return (
              <div
                key={email.uid}
                onClick={() => onSelect(email.uid)}
                className={`px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] cursor-pointer ${
                  isSelected ? "bg-[var(--color-surface-selected)]" : ""
                }`}
              >
                {/* Row 1: Sender (truncate) + Timestamp */}
                <div className="flex items-baseline gap-2 min-w-0">
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      isUnread ? "font-semibold text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {email.from?.[0]?.name || email.from?.[0]?.address || "Unknown"}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-text-muted)] text-right">
                    {formatDate(email.date)}
                  </span>
                </div>
                {/* Row 2: Subject (truncate) */}
                <span
                  className={`block truncate w-full text-sm mt-0.5 ${
                    isUnread ? "font-medium text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {email.subject || "(No subject)"}
                </span>
                {/* Row 3: Body snippet */}
                <p className="text-sm text-[var(--color-text-muted)] truncate mt-0.5">
                  {email.body?.text?.substring(0, 120) || ""}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending / syncing indicator — visible when source is "pending" and not loading */}
      {!loading && emails.length === 0 && source === "pending" && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
          <svg className="w-8 h-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              Syncing this folder...
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              Emails will appear automatically as the cache populates.
              You can also click Refresh to force a live fetch.
            </p>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="mt-2 px-3 py-1.5 border border-[var(--color-border)] rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            >
              Refresh now
            </button>
          )}
        </div>
      )}

      {/* Empty state — no emails and not pending */}
      {!loading && emails.length === 0 && source !== "pending" && !error && (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-text-muted)]">
          No messages in this folder
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--color-border)] text-sm text-[var(--color-text-secondary)]">
          <span>
            {total} message{total !== 1 ? "s" : ""}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="px-2 py-1 border border-[var(--color-border)] rounded text-xs hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="px-2 py-1 text-xs">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="px-2 py-1 border border-[var(--color-border)] rounded text-xs hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
