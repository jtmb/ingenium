"use client";
import Link from "next/link";
import type { AttentionData } from "../../lib/api";

interface AttentionQueueProps {
  data: AttentionData | null;
  loading?: boolean;
}

/**
 * Attention queue — items that need the user's immediate attention.
 * Renders severity-coded cards with action buttons.
 */
export default function AttentionQueue({ data, loading }: AttentionQueueProps) {
  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 hover:shadow-md transition-shadow">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          Attention Queue
        </h2>
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-[var(--color-surface-muted)] rounded w-3/4" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/2" />
          <div className="h-5 bg-[var(--color-surface-muted)] rounded w-2/3" />
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  const items = data?.items;
  const count = data?.count ?? 0;

  if (!items || items.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 hover:shadow-md transition-shadow">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
          Attention Queue
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Nothing needs your attention
        </p>
      </div>
    );
  }

  // ── Severity helpers ───────────────────────────────────────────────────────
  // Left-border accent colours map severity directly to recognisable visual cues
  const severityStyles: Record<string, string> = {
    critical: "border-l-4 border-l-red-500 bg-[var(--color-error-bg)]",
    warning: "border-l-4 border-l-amber-500 bg-[var(--color-warning-bg)]",
    info: "border-l-4 border-l-blue-500 bg-[var(--color-info-bg)]",
  };

  const severityIcons: Record<string, string> = {
    critical: "\u{1F534}",
    warning: "\u26A0\uFE0F",
    info: "\u2139\uFE0F",
  };

  /** Maps attention item type to a short human-readable label shown before the title. */
  const severityLabels: Record<string, string> = {
    task_blocked: "Blocked",
    task_overdue: "Overdue",
    job_failed: "Failed",
    synthesis_pending: "Pending",
    extraction_pending: "Pending",
    unread_email: "Email",
    error_log: "Error",
  };

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 hover:shadow-md transition-shadow">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
        Attention Queue
        <span className="ml-2 text-sm font-normal text-[var(--color-text-muted)]">
          ({count} item{count !== 1 ? "s" : ""})
        </span>
      </h2>

      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-start gap-3 p-3 rounded-lg ${severityStyles[item.severity] ?? severityStyles.info}`}
          >
            <span className="text-lg shrink-0 mt-0.5">
              {severityIcons[item.severity] ?? severityIcons.info}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                <span className="text-xs font-normal text-[var(--color-text-muted)] mr-1">
                  [{severityLabels[item.type] ?? item.type}]
                </span>
                {item.title}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                {item.description}
              </p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {relativeTime(item.timestamp)}
              </p>
            </div>
            {item.action && (
              <Link
                href={item.action.route}
                className="shrink-0 text-xs px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)]
                  text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {item.action.label}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Format a relative time string from an ISO date. */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
