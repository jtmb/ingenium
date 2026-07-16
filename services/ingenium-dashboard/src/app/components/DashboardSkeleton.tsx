/**
 * Loading skeleton for the homepage dashboard.
 * Renders four placeholder cards in a 2×2 grid matching the operational layout
 * (Learning, Tasks, Jobs, Mail).
 */
export default function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6"
          data-testid="dashboard-skeleton-card"
        >
          <div className="animate-pulse space-y-3">
            <div className="h-5 bg-[var(--color-surface-muted)] rounded w-1/3" />
            <div className="h-4 bg-[var(--color-surface-muted)] rounded w-2/3" />
            <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
