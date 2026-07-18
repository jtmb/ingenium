"use client";

interface PermissionPromptProps {
  requestId: string;
  /** Describes the tool being invoked (e.g. "bash") */
  action: string;
  /** The full command or tool invocation pattern the agent wants to run */
  pattern: string;
  /** Called when the user clicks a reply button */
  onReply: (requestId: string, reply: "once" | "always" | "reject") => void;
  /** When false, all buttons are disabled (already replied) */
  isActive: boolean;
}

/**
 * PermissionPrompt — inline permission approval card shown within the
 * message stream when the agent requests user confirmation.
 *
 * Displays an amber-bordered warning card with the tool action and
 * the exact command pattern, plus Allow Once / Always Allow / Deny buttons.
 */
export default function PermissionPrompt({
  requestId,
  action,
  pattern,
  onReply,
  isActive,
}: PermissionPromptProps) {
  const handleReply = (reply: "once" | "always" | "reject") => {
    if (!isActive) return;
    onReply(requestId, reply);
  };

  const sharedBtnClass =
    "rounded px-3 py-1.5 text-sm font-medium transition-colors";

  return (
    <div
      className={`my-3 border rounded-lg bg-[var(--color-warning-bg)] border-amber-500/30 overflow-hidden ${
        !isActive ? "opacity-50 pointer-events-none" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
        {/* Warning triangle icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-amber-400 shrink-0"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 1.33l6.67 12.67H1.33L8 1.33z"
          />
          <path strokeLinecap="round" d="M8 6v2.67" />
          <circle cx="8" cy="11.33" r="0.67" fill="currentColor" />
        </svg>
        <span className="text-sm font-medium text-amber-400">
          Agent wants to run:{" "}
          <code className="px-1 py-0.5 rounded bg-black/20 text-amber-300 font-mono text-xs">
            {action}
          </code>
        </span>
      </div>

      {/* Pattern preview */}
      <div className="px-3 py-2.5">
        <pre className="text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-code-bg)] rounded-md p-2.5 leading-relaxed whitespace-pre-wrap break-all overflow-x-auto max-h-[120px] overflow-y-auto">
          {pattern}
        </pre>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-amber-500/20">
        {/* Allow Once */}
        <button
          type="button"
          onClick={() => handleReply("once")}
          disabled={!isActive}
          className={`${sharedBtnClass} bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50`}
        >
          Allow Once
        </button>

        {/* Always Allow */}
        <button
          type="button"
          onClick={() => handleReply("always")}
          disabled={!isActive}
          className={`${sharedBtnClass} bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50`}
        >
          Always Allow
        </button>

        {/* Deny */}
        <button
          type="button"
          onClick={() => handleReply("reject")}
          disabled={!isActive}
          className={`${sharedBtnClass} bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 ml-auto`}
        >
          Deny
        </button>
      </div>

      {/* Inactive overlay label */}
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg pointer-events-none">
          <span className="text-xs font-medium text-[var(--color-text-muted)] bg-[var(--color-surface)] px-3 py-1 rounded-full">
            Already replied
          </span>
        </div>
      )}
    </div>
  );
}
