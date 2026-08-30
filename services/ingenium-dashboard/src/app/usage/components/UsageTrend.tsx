import type { UsageDailyRow } from "@/lib/api";
import { formatCostWithAvailability, formatUsageMetric } from "./usage-presentation";

interface UsageTrendProps {
  daily: UsageDailyRow[];
}

function trendPoints(daily: UsageDailyRow[]): string {
  if (daily.length === 0) return "";
  const width = 720;
  const height = 190;
  const padding = { top: 18, right: 18, bottom: 30, left: 38 };
  const maximum = Math.max(1, ...daily.map((row) => row.requests));
  const usableWidth = width - padding.left - padding.right;
  const usableHeight = height - padding.top - padding.bottom;
  return daily.map((row, index) => {
    const x = daily.length === 1
      ? padding.left + usableWidth / 2
      : padding.left + (usableWidth * index) / (daily.length - 1);
    const y = padding.top + usableHeight - (row.requests / maximum) * usableHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function dayLabel(day: string): string {
  const timestamp = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(timestamp))
    : day;
}

export default function UsageTrend({ daily }: UsageTrendProps) {
  const points = trendPoints(daily);
  const maximum = Math.max(0, ...daily.map((row) => row.requests));
  const firstLabel = daily[0] ? dayLabel(daily[0].day) : "Start";
  const lastDay = daily.at(-1);
  const lastLabel = lastDay ? dayLabel(lastDay.day) : "End";

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow" aria-labelledby="usage-trend-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="usage-trend-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">Daily request trend</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Requests grouped by UTC day. Token values remain unavailable when not reported.</p>
        </div>
        <span className="text-sm text-[var(--color-text-muted)]">Peak: {maximum} request{maximum === 1 ? "" : "s"}</span>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-2">
        <svg
          className="h-auto w-full"
          viewBox="0 0 720 190"
          role="img"
          aria-labelledby="usage-trend-title usage-trend-description"
          data-testid="usage-request-trend"
        >
          <title id="usage-trend-title">Requests by UTC day</title>
          <desc id="usage-trend-description">
            {daily.length === 0
              ? "No UTC days are available for this range."
              : `${daily.length} UTC day${daily.length === 1 ? "" : "s"}; peak daily request count is ${maximum}.`}
          </desc>
          <line x1="38" y1="18" x2="38" y2="160" stroke="var(--color-border)" strokeWidth="1" />
          <line x1="38" y1="160" x2="702" y2="160" stroke="var(--color-border)" strokeWidth="1" />
          <line x1="38" y1="89" x2="702" y2="89" stroke="var(--color-border-muted)" strokeWidth="1" strokeDasharray="4 4" />
          <text x="8" y="24" fill="var(--color-text-muted)" fontSize="11">{maximum}</text>
          <text x="20" y="164" fill="var(--color-text-muted)" fontSize="11">0</text>
          <text x="38" y="183" fill="var(--color-text-muted)" fontSize="11">{firstLabel}</text>
          <text x="702" y="183" textAnchor="end" fill="var(--color-text-muted)" fontSize="11">{lastLabel}</text>
          {points && <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
          {daily.map((row, index) => {
            const point = points.split(" ")[index];
            if (!point) return null;
            const [cx, cy] = point.split(",");
            return <circle key={row.day} cx={cx} cy={cy} r="3.5" fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth="2" />;
          })}
        </svg>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[980px] w-full text-left text-sm" data-testid="usage-daily-table">
          <caption className="sr-only">Usage metrics by UTC day</caption>
          <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">UTC day</th>
              <th className="px-3 py-2 font-medium">Requests</th>
              <th className="px-3 py-2 font-medium">Total tokens</th>
              <th className="px-3 py-2 font-medium">Input</th>
              <th className="px-3 py-2 font-medium">Output</th>
              <th className="px-3 py-2 font-medium">Reasoning</th>
              <th className="px-3 py-2 font-medium">Cache read</th>
              <th className="px-3 py-2 font-medium">Cache write</th>
              <th className="px-3 py-2 font-medium">Reported cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-muted)] text-[var(--color-text-secondary)]">
            {daily.map((row) => (
              <tr key={row.day} className="hover:bg-[var(--color-surface-hover)]">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--color-text-primary)]">{row.day}</td>
                <td className="whitespace-nowrap px-3 py-2">{row.requests}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatUsageMetric(row.tokens.total)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatUsageMetric(row.tokens.input)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatUsageMetric(row.tokens.output)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatUsageMetric(row.tokens.reasoning)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatUsageMetric(row.cache.read)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatUsageMetric(row.cache.write)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatCostWithAvailability(row.cost.value, row.cost.availability)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
