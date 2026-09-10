import type { UsageMetricValue } from "@/lib/api";
import { formatCost, formatNumber, formatUsageMetric, usageAvailabilityLabel } from "./usage-presentation";

interface UsageMetricCardProps {
  title: string;
  metric?: UsageMetricValue;
  value?: number | null;
  detail: string;
  cost?: boolean;
  testId: string;
}

export default function UsageMetricCard({
  title,
  metric,
  value,
  detail,
  cost = false,
  testId,
}: UsageMetricCardProps) {
  const displayedValue = metric
    ? (cost && metric.value !== null ? formatCost(metric.value) : formatUsageMetric(metric))
    : value === null || value === undefined ? "Unavailable" : formatNumber(value);
  const availability = metric ? usageAvailabilityLabel(metric) : value === null || value === undefined ? "Unavailable" : "Reported";

  return (
    <section
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--color-text-secondary)]">{title}</h2>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">{displayedValue}</p>
        </div>
        <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
          {availability}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">{detail}</p>
    </section>
  );
}
