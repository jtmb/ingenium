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
 * PermissionPrompt — inline permission approval shown within the message
 * stream when the agent requests user confirmation.
 *
 * Displays the requested tool action, exact command pattern, and choices as
 * plain flow so agent output does not create a second card hierarchy.
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
    "py-1 text-xs font-medium underline underline-offset-2 transition-colors disabled:opacity-50";

  return (
    <div
      className={`relative my-3 text-sm ${
        !isActive ? "opacity-50 pointer-events-none" : ""
      }`}
      data-testid="chat-permission-prompt"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        {/* Warning triangle icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[var(--color-text-muted)] shrink-0"
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
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">
          Agent wants to run:{" "}
          <code className="font-mono text-xs">
            {action}
          </code>
        </span>
      </div>

      {/* Pattern preview */}
      <div className="mt-1">
        <pre className="text-xs font-mono text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap break-all overflow-x-auto max-h-[120px] overflow-y-auto">
          {pattern}
        </pre>
      </div>

      {/* Action buttons */}
      <div className="mt-1 flex items-center gap-3">
        {/* Allow Once */}
        <button
          type="button"
          onClick={() => handleReply("once")}
          disabled={!isActive}
          className={`${sharedBtnClass} text-[var(--color-text-primary)] hover:text-[var(--color-text-secondary)]`}
        >
          Allow Once
        </button>

        {/* Always Allow */}
        <button
          type="button"
          onClick={() => handleReply("always")}
          disabled={!isActive}
          className={`${sharedBtnClass} text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]`}
        >
          Always Allow
        </button>

        {/* Deny */}
        <button
          type="button"
          onClick={() => handleReply("reject")}
          disabled={!isActive}
          className={`${sharedBtnClass} ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]`}
        >
          Deny
        </button>
      </div>

      {/* Inactive overlay label */}
      {!isActive && (
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          Already replied
        </span>
      )}
    </div>
  );
}
