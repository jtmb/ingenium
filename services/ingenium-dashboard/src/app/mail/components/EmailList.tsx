"use client";

/**
 * EmailList — search bar + scrollable email rows with pagination.
 * Shows sender, subject, snippet, and date. Distinguishes read/unread.
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
}: {
  emails: any[];
  selectedUid?: number;
  onSelect: (uid: number) => void;
  onPageChange: (p: number) => void;
  total: number;
  page: number;
  loading: boolean;
  onSearch: (q: string) => void;
  error?: string | null;
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
    <div className="flex-1 flex flex-col min-w-0 border-r border-[var(--color-border)]">
      {/* Search bar */}
      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
        <input
          type="text"
          placeholder="Search emails..."
          className="flex-1 border border-[var(--color-border)] rounded px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-200"
          onChange={(e) => onSearch(e.target.value)}
        />
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
      {!loading && (
        <div className="flex-1 divide-y divide-[var(--color-border)] overflow-y-auto">
          {emails.map((email: any) => {
            const isUnread = !email.flags?.includes("\\Seen");
            const isSelected = selectedUid === email.uid;

            return (
              <div
                key={email.uid}
                onClick={() => onSelect(email.uid)}
                className={`px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] cursor-pointer flex items-start gap-2 ${
                  isSelected ? "bg-[var(--color-surface-selected)]" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`w-40 truncate text-sm ${
                        isUnread ? "font-semibold text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
                      }`}
                    >
                      {email.from?.[0]?.name || email.from?.[0]?.address || "Unknown"}
                    </span>
                    <span
                      className={`flex-1 truncate text-sm ${
                        isUnread ? "font-medium text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
                      }`}
                    >
                      {email.subject || "(No subject)"}
                    </span>
                    <span className="w-20 text-xs text-[var(--color-text-muted)] text-right shrink-0">
                      {formatDate(email.date)}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-text-muted)] truncate mt-0.5">
                    {email.body?.text?.substring(0, 120) || ""}
                  </p>
                </div>
              </div>
            );
          })}
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
