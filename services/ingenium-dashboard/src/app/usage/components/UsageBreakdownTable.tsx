import type { UsageBreakdownRow } from "@/lib/api";
import { formatCostWithAvailability, formatUsageMetric, rawIdentifier } from "./usage-presentation";

interface UsageBreakdownTableProps {
  rows: UsageBreakdownRow[];
}

export default function UsageBreakdownTable({ rows }: UsageBreakdownTableProps) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow" aria-labelledby="usage-breakdown-heading">
      <div>
        <h2 id="usage-breakdown-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">Provider and model breakdown</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Raw provider, model, and reported agent identifiers are intentionally not renamed or grouped.</p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[1120px] w-full text-left text-sm" data-testid="usage-breakdown-table">
          <caption className="sr-only">Usage breakdown by raw provider, model, and reported agent identifier</caption>
          <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Requests</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Input</th>
              <th className="px-3 py-2 font-medium">Output</th>
              <th className="px-3 py-2 font-medium">Reasoning</th>
              <th className="px-3 py-2 font-medium">Cache read</th>
              <th className="px-3 py-2 font-medium">Cache write</th>
              <th className="px-3 py-2 font-medium">Reported cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-muted)] text-[var(--color-text-secondary)]">
            {rows.map((row, index) => (
              <tr key={`${row.providerId ?? "null"}-${row.modelId ?? "null"}-${row.agentId ?? "null"}-${index}`} className="hover:bg-[var(--color-surface-hover)]">
                <td className="max-w-56 truncate px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]" title={rawIdentifier(row.providerId)}>{rawIdentifier(row.providerId)}</td>
                <td className="max-w-56 truncate px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]" title={rawIdentifier(row.modelId)}>{rawIdentifier(row.modelId)}</td>
                <td className="max-w-56 truncate px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]" title={rawIdentifier(row.agentId)}>{rawIdentifier(row.agentId)}</td>
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
