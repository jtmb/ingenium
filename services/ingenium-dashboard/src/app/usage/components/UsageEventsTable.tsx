import type { UsageEventsPage } from "@/lib/api";
import { formatCostWithAvailability, formatNullableNumber, formatUtcTimestamp, rawIdentifier } from "./usage-presentation";

interface UsageEventsTableProps {
  page: UsageEventsPage;
}

export default function UsageEventsTable({ page }: UsageEventsTableProps) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow" aria-labelledby="usage-events-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="usage-events-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">Recent usage events</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Metadata-only events; prompts, reasoning text, tool payloads, and credentials are not displayed.</p>
        </div>
        <span className="text-sm text-[var(--color-text-muted)]">Showing {page.data.length} of {page.pagination.total}</span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[1180px] w-full text-left text-sm" data-testid="usage-events-table">
          <caption className="sr-only">Recent metadata-only usage events</caption>
          <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Occurred (UTC)</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Status</th>
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
            {page.data.map((event) => (
              <tr key={event.id} className="hover:bg-[var(--color-surface-hover)]">
                <td className="whitespace-nowrap px-3 py-2 text-xs">{formatUtcTimestamp(event.occurredAt)}</td>
                <td className="max-w-48 truncate px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]" title={rawIdentifier(event.providerId)}>{rawIdentifier(event.providerId)}</td>
                <td className="max-w-48 truncate px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]" title={rawIdentifier(event.modelId)}>{rawIdentifier(event.modelId)}</td>
                <td className="max-w-48 truncate px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]" title={rawIdentifier(event.agentId)}>{rawIdentifier(event.agentId)}</td>
                <td className="px-3 py-2"><span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs">{event.status}</span></td>
                <td className="whitespace-nowrap px-3 py-2">{formatNullableNumber(event.tokens.total)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatNullableNumber(event.tokens.input)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatNullableNumber(event.tokens.output)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatNullableNumber(event.tokens.reasoning)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatNullableNumber(event.cache.read)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatNullableNumber(event.cache.write)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatCostWithAvailability(event.cost.amount, event.cost.availability)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
