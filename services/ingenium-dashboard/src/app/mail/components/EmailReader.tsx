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
        <p className="text-gray-400 text-sm">Select an email to read</p>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex flex-col animate-pulse">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 space-y-2">
          <div className="h-6 bg-gray-100 rounded w-2/3" />
          <div className="h-4 bg-gray-100 rounded w-1/3" />
          <div className="h-4 bg-gray-100 rounded w-1/4" />
        </div>
        <div className="px-4 py-3 space-y-2">
          <div className="h-4 bg-gray-100 rounded w-full" />
          <div className="h-4 bg-gray-100 rounded w-full" />
          <div className="h-4 bg-gray-100 rounded w-3/4" />
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
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 space-y-1">
        <h2 className="text-lg font-semibold text-gray-900">
          {email.subject || "(No subject)"}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">
            {fromAddress?.name || fromAddress?.address || "Unknown"}
          </span>
          {fromAddress?.address && fromAddress?.name && (
            <span className="text-sm text-gray-600">
              &lt;{fromAddress.address}&gt;
            </span>
          )}
        </div>
        {toList && (
          <p className="text-sm text-gray-600">
            <span className="font-medium">To:</span> {toList}
          </p>
        )}
        {ccList && (
          <p className="text-sm text-gray-600">
            <span className="font-medium">CC:</span> {ccList}
          </p>
        )}
        <p className="text-xs text-gray-500">
          {email.date ? new Date(email.date).toLocaleString() : ""}
        </p>
      </div>

      {/* Action bar */}
      <div className="flex gap-1 px-4 py-2 border-b border-gray-200">
        <button
          onClick={onReply}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded text-gray-600 hover:bg-gray-100"
        >
          Reply
        </button>
        <button
          onClick={onForward}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded text-gray-600 hover:bg-gray-100"
        >
          Forward
        </button>
        <button
          onClick={onArchive}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded text-gray-600 hover:bg-gray-100"
        >
          Archive
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded text-red-600 hover:bg-red-50 ml-auto"
        >
          Delete
        </button>
      </div>

      {/* Smart suggestion */}
      {accountId && email?.uid && (
        <div className="px-4 py-2 border-b border-gray-200">
          <SmartSuggest emailUid={email.uid} accountId={accountId} />
        </div>
      )}

      {/* Email body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {email.body?.html ? (
          <div
            className="text-sm text-gray-900 prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: email.body.html }}
          />
        ) : email.body?.text ? (
          <pre className="text-sm text-gray-900 whitespace-pre-wrap font-sans">
            {email.body.text}
          </pre>
        ) : (
          <p className="text-gray-500 text-sm italic">No content</p>
        )}
      </div>

      {/* Attachments */}
      {email.attachments && email.attachments.length > 0 && (
        <div className="border-t border-gray-200 px-4 py-3">
          <p className="text-xs font-semibold text-gray-900 mb-2 uppercase tracking-wide">
            Attachments ({email.attachments.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {email.attachments.map((att: any, idx: number) => (
              <div
                key={att.partId || idx}
                className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-600"
              >
                <span className="text-gray-900 truncate max-w-[200px]">
                  {att.filename}
                </span>
                <span className="text-xs text-gray-500">
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
