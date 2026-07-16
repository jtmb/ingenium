"use client";
import Link from "next/link";

export interface DashboardCardProps {
  title: string;
  icon?: React.ReactNode;
  cta?: { label: string; href: string };
  loading?: boolean;
  unavailable?: boolean;
  degraded?: boolean;
  children: React.ReactNode;
}

/**
 * Reusable operational dashboard card.
 *
 * States:
 * - **normal**: White surface card with hover shadow
 * - **loading**: Shows an animate-pulse skeleton placeholder
 * - **degraded/unavailable**: Orange left-border with "Unavailable" badge
 * - **empty**: Contextual empty message with CTA (handled by children)
 */
export default function DashboardCard({
  title,
  icon,
  cta,
  loading = false,
  unavailable = false,
  degraded = false,
  children,
}: DashboardCardProps) {
  if (loading) {
    return (
      <div
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6"
        data-testid="dashboard-card-loading"
      >
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-[var(--color-surface-muted)] rounded w-1/3" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-2/3" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/2" />
        </div>
      </div>
    );
  }

  const isDegraded = unavailable || degraded;

  return (
    <div
      className={`bg-[var(--color-surface)] border rounded-xl p-6 hover:shadow-md transition-shadow ${
        isDegraded
          ? "border-l-4 border-l-orange-400 border-[var(--color-border)]"
          : "border-[var(--color-border)]"
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          {icon && <span className="text-[var(--color-text-muted)]">{icon}</span>}
          {title}
        </h2>
        {isDegraded && (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300 whitespace-nowrap">
            Unavailable
          </span>
        )}
      </div>

      {/* Content */}
      <div className="text-sm text-[var(--color-text-secondary)] space-y-2">
        {children}
      </div>

      {/* CTA link */}
      {cta && (
        <div className="mt-4 pt-3 border-t border-[var(--color-border-muted)]">
          <Link
            href={cta.href}
            className="text-sm text-[var(--color-text-link)] hover:underline font-medium"
          >
            {cta.label}
          </Link>
        </div>
      )}
    </div>
  );
}
