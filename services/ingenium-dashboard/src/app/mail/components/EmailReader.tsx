"use client";

import SmartSuggest from "./SmartSuggest";

/**
 * EmailReader — full email display with headers, body HTML, attachments, and action buttons.
 */
export default function EmailReader({
  email,
  loading,
  accountId,
  onReply,
  onForward,
  onDelete,
  onArchive,
}: {
  email: any;
  loading: boolean;
  accountId?: string;
  onReply: () => void;
  onForward: () => void;
  onDelete: () => void;
  onArchive: () => void;
}) {
  // No email selected
  if (!email && !loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <span className="text-3xl">✉️</span>
        <p className="text-[var(--color-text-muted)] text-sm">Select an email to read</p>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex flex-col animate-pulse">
        <div className="bg-[var(--color-surface-muted)] border-b border-[var(--color-border)] px-4 py-3 space-y-2">
          <div className="h-6 bg-[var(--color-surface-muted)] rounded w-2/3" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/3" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/4" />
        </div>
        <div className="px-4 py-3 space-y-2">
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-full" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-full" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-3/4" />
        </div>
      </div>
    );
  }

  const isUnread = !email.flags?.includes("\\Seen");
  const fromAddress = email.from?.[0];
  const toList = email.to?.map((t: any) => t.address).join(", ") || "";
  const ccList = email.cc?.map((c: any) => c.address).join(", ") || "";

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header panel */}
      <div className="bg-[var(--color-surface-muted)] border-b border-[var(--color-border)] px-4 py-3 space-y-1">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {email.subject || "(No subject)"}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            {fromAddress?.name || fromAddress?.address || "Unknown"}
          </span>
          {fromAddress?.address && fromAddress?.name && (
            <span className="text-sm text-[var(--color-text-secondary)]">
              &lt;{fromAddress.address}&gt;
            </span>
          )}
        </div>
        {toList && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            <span className="font-medium">To:</span> {toList}
          </p>
        )}
        {ccList && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            <span className="font-medium">CC:</span> {ccList}
          </p>
        )}
        <p className="text-xs text-[var(--color-text-muted)]">
          {email.date ? new Date(email.date).toLocaleString() : ""}
        </p>
      </div>

      {/* Action bar */}
      <div className="flex gap-1 px-4 py-2 border-b border-[var(--color-border)]">
        <button
          onClick={onReply}
          className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          Reply
        </button>
        <button
          onClick={onForward}
          className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          Forward
        </button>
        <button
          onClick={onArchive}
          className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          Archive
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)] ml-auto"
        >
          Delete
        </button>
      </div>

      {/* Smart suggestion */}
      {accountId && email?.uid && (
        <div className="px-4 py-2 border-b border-[var(--color-border)]">
          <SmartSuggest emailUid={email.uid} accountId={accountId} />
        </div>
      )}

      {/* Email body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {email.body?.html ? (
          <div
            className="text-sm text-[var(--color-text-primary)] prose prose-sm max-w-none [&_img]:max-w-full [&_img]:h-auto"
            dangerouslySetInnerHTML={{ __html: email.body.html }}
          />
        ) : email.body?.text ? (
          <pre className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap font-sans">
            {email.body.text}
          </pre>
        ) : (
          <p className="text-[var(--color-text-muted)] text-sm italic">No content</p>
        )}
      </div>

      {/* Attachments */}
      {email.attachments && email.attachments.length > 0 && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <p className="text-xs font-semibold text-[var(--color-text-primary)] mb-2 uppercase tracking-wide">
            Attachments ({email.attachments.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {email.attachments.map((att: any, idx: number) => (
              <div
                key={att.partId || idx}
                className="flex items-center gap-2 px-3 py-1.5 border border-[var(--color-border)] rounded text-sm text-[var(--color-text-secondary)]"
              >
                <span className="text-[var(--color-text-primary)] truncate max-w-[200px]">
                  {att.filename}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  ({att.size ? Math.round(att.size / 1024) : "?"} KB)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
