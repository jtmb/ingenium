export default function UsagePageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true" data-testid="usage-loading-state">
      <span className="sr-only">Loading usage analytics</span>
      <div className="h-44 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]" />)}
      </div>
      <div className="h-72 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]" />
    </div>
  );
}
