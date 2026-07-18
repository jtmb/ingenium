"use client";

import { useState } from "react";

type ReviewAction = "approve" | "reject" | "rollback";

type ReviewActionFormProps = {
  action: ReviewAction;
  onSubmit: (reviewer: string, reason: string) => void;
  loading: boolean;
  error?: string | null;
  requireReason?: boolean; // default false for approve/reject, true for rollback
};

const ACTION_CONFIG: Record<
  ReviewAction,
  {
    label: string;
    btnClass: string;
    btnLabel: (loading: boolean) => string;
    bgClass: string;
    borderClass: string;
    textClass: string;
  }
> = {
  approve: {
    label: "Approve Proposal",
    btnClass: "bg-green-600 hover:bg-green-700",
    btnLabel: (loading) => (loading ? "Approving..." : "Confirm Approval"),
    bgClass: "bg-[var(--color-success-bg)]",
    borderClass: "border-[var(--color-success-border)]",
    textClass: "text-[var(--color-success-text)]",
  },
  reject: {
    label: "Reject Proposal",
    btnClass: "bg-red-600 hover:bg-red-700",
    btnLabel: (loading) => (loading ? "Rejecting..." : "Confirm Rejection"),
    bgClass: "bg-[var(--color-error-bg)]",
    borderClass: "border-[var(--color-error-border)]",
    textClass: "text-[var(--color-error-text)]",
  },
  rollback: {
    label: "Rollback Proposal",
    btnClass: "bg-amber-600 hover:bg-amber-700",
    btnLabel: (loading) => (loading ? "Rolling back..." : "Confirm Rollback"),
    bgClass: "bg-[var(--color-warning-bg)]",
    borderClass: "border-[var(--color-warning-border)]",
    textClass: "text-[var(--color-warning-text)]",
  },
};

/**
 * Unified reviewer action form for approve/reject/rollback.
 *
 * Features:
 * - Reviewer name input (always required)
 * - Reason input (required for rollback, optional for approve/reject)
 * - Confirmation dialog before mutation
 * - Loading spinner while action is in progress
 * - Error message display
 * - `aria-live` for form validation announcements
 */
export default function ReviewActionForm({
  action,
  onSubmit,
  loading,
  error,
  requireReason = false,
}: ReviewActionFormProps) {
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");

  const cfg = ACTION_CONFIG[action];

  const canSubmit = reviewer.trim().length > 0 && (!requireReason || reason.trim().length > 0);

  const handleSubmitClick = () => {
    if (!reviewer.trim()) {
      setValidationMessage("Reviewer name is required.");
      return;
    }
    if (requireReason && !reason.trim()) {
      setValidationMessage("Reason is required for rollback.");
      return;
    }
    setValidationMessage("");
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    setShowConfirm(false);
    onSubmit(reviewer.trim(), reason.trim());
  };

  const handleCancelConfirm = () => {
    setShowConfirm(false);
  };

  return (
    <div
      className={`space-y-2 p-3 rounded border ${cfg.bgClass} ${cfg.borderClass}`}
      data-testid={`proposal-${action}-section`}
    >
      <p className={`text-sm font-medium ${cfg.textClass}`}>{cfg.label}</p>

      {/* Announcer for validation / errors */}
      <div className="sr-only" role="status" aria-live="polite">
        {validationMessage || error || ""}
      </div>

      {/* Reviewer name */}
      <input
        placeholder="Your name (required)"
        value={reviewer}
        onChange={(e) => setReviewer(e.target.value)}
        className="w-full border border-[var(--color-border)] rounded p-2 text-sm text-[var(--color-text-primary)] bg-[var(--color-surface)] placeholder:text-[var(--color-text-muted)]"
        data-testid={`proposal-${action}-reviewer`}
        disabled={loading}
        aria-label="Reviewer name"
        aria-required="true"
      />

      {/* Reason */}
      <input
        placeholder={`Reason${requireReason ? " (required)" : " (optional)"}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full border border-[var(--color-border)] rounded p-2 text-sm text-[var(--color-text-primary)] bg-[var(--color-surface)] placeholder:text-[var(--color-text-muted)]"
        data-testid={`proposal-${action}-reason`}
        disabled={loading}
        aria-label={`Review reason${requireReason ? " (required)" : ""}`}
        aria-required={requireReason}
      />

      {/* Error display */}
      {error && (
        <div className="text-xs text-[var(--color-error-text)] p-2 rounded bg-[var(--color-error-bg)] border border-[var(--color-error-border)]" role="alert">
          {error}
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmitClick}
        disabled={loading}
        className={`px-4 py-1.5 ${cfg.btnClass} text-white text-sm rounded disabled:opacity-50 inline-flex items-center gap-2 transition-colors`}
        data-testid={`proposal-${action}-btn`}
      >
        {loading && (
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {cfg.btnLabel(loading)}
      </button>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div className="absolute inset-0 bg-black/50" onClick={handleCancelConfirm} />
          <div className="relative bg-[var(--color-surface)] rounded-lg shadow-2xl p-6 max-w-sm w-full border border-[var(--color-border)]">
            <h3 id="confirm-dialog-title" className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
              Confirm {action === "rollback" ? "Rollback" : action === "approve" ? "Approval" : "Rejection"}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              {action === "approve"
                ? "This will apply the proposal and update the skill. Are you sure?"
                : action === "reject"
                  ? "This will reject the proposal and it cannot be reapplied. Are you sure?"
                  : "This will roll back the applied changes. This cannot be undone. Are you sure?"}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelConfirm}
                className="px-4 py-1.5 text-sm rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className={`px-4 py-1.5 text-sm rounded text-white ${cfg.btnClass} disabled:opacity-50 transition-colors`}
              >
                {loading ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
