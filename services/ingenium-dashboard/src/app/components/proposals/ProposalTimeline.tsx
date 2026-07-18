"use client";

type ProposalTimelineProps = {
  createdAt: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  appliedAt?: string | null;
  rolledBackAt?: string | null;
  status: string; // draft | pending | approved | rejected | applied | rolledBack | stale
};

/** Ordered stages in the timeline. */
const STAGES = [
  { key: "created", label: "Created", dateKey: "createdAt" as const },
  { key: "submitted", label: "Submitted", dateKey: "submittedAt" as const },
  { key: "reviewed", label: "Reviewed", dateKey: "reviewedAt" as const },
  { key: "applied", label: "Applied", dateKey: "appliedAt" as const },
] as const;

/** Which stage is "active" based on current status. */
function getActiveIndex(status: string): number {
  switch (status) {
    case "draft": return 0;
    case "pending": return 1;
    case "approved":
    case "rejected":
    case "stale": return 2;
    case "applied": return 3;
    case "rolledBack": return -1; // completed with rollback
    default: return 0;
  }
}

/**
 * A horizontal visual timeline showing the proposal lifecycle:
 * Created → Submitted → Reviewed → Applied → (Rolled Back).
 *
 * Connected circles with a line between them. The current stage is filled
 * with a solid colour; future stages are muted. Rolled-back proposals
 * show an additional red "Rolled Back" marker at the end.
 */
export default function ProposalTimeline({ createdAt, submittedAt, reviewedAt, appliedAt, rolledBackAt, status }: ProposalTimelineProps) {
  const activeIndex = getActiveIndex(status);
  const isRolledBack = status === "rolledBack";

  const fmt = (dateStr?: string | null): string => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex items-center gap-0 overflow-x-auto py-2" role="list" aria-label="Proposal timeline">
      {STAGES.map((stage, i) => {
        const dateStr = (() => {
          switch (stage.dateKey) {
            case "createdAt": return createdAt;
            case "submittedAt": return submittedAt ?? null;
            case "reviewedAt": return reviewedAt ?? null;
            case "appliedAt": return appliedAt ?? null;
          }
        })();
        const formatted = fmt(dateStr);
        const isActive = i <= activeIndex;
        const isCurrent = i === activeIndex;

        return (
          <div key={stage.key} className="flex items-center" role="listitem">
            {/* Connector line (before, except first) */}
            {i > 0 && (
              <div
                className={`h-0.5 w-6 sm:w-10 shrink-0 ${
                  i <= activeIndex
                    ? "bg-green-500"
                    : "bg-[var(--color-border)]"
                }`}
                aria-hidden="true"
              />
            )}

            {/* Circle + label */}
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  isActive
                    ? "bg-green-600 border-green-600 text-white"
                    : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)]"
                } ${isCurrent ? "ring-2 ring-green-300 ring-offset-1 ring-offset-[var(--color-surface)]" : ""}`}
                aria-label={`${stage.label}${formatted ? `: ${formatted}` : ""}`}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isActive ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-[10px] mt-1 font-medium whitespace-nowrap ${
                  isActive ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"
                }`}
              >
                {stage.label}
              </span>
              {formatted && (
                <span className="text-[9px] text-[var(--color-text-muted)] whitespace-nowrap">
                  {formatted}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Rollback indicator */}
      {isRolledBack && rolledBackAt && (
        <div className="flex items-center" role="listitem">
          <div className="h-0.5 w-6 sm:w-10 bg-red-500 shrink-0" aria-hidden="true" />
          <div className="flex flex-col items-center shrink-0">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 bg-red-600 border-red-600 text-white ring-2 ring-red-300 ring-offset-1 ring-offset-[var(--color-surface)]"
              aria-label={`Rolled Back: ${fmt(rolledBackAt)}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <span className="text-[10px] mt-1 font-medium text-red-500 whitespace-nowrap">Rolled Back</span>
            <span className="text-[9px] text-[var(--color-text-muted)] whitespace-nowrap">{fmt(rolledBackAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
