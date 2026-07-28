"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProject } from "@/lib/ProjectContext";
import {
  api,
  dashboardFetch,
  type UsageBreakdownRow,
  type UsageEventsPage,
  type UsageQuery,
  type UsageSummary,
} from "@/lib/api";
import UsageBreakdownTable from "./components/UsageBreakdownTable";
import UsageEventsTable from "./components/UsageEventsTable";
import UsageFilters from "./components/UsageFilters";
import UsageMetricCard from "./components/UsageMetricCard";
import UsagePageSkeleton from "./components/UsagePageSkeleton";
import UsageTrend from "./components/UsageTrend";
import {
  defaultUsageFilterDraft,
  formatUtcTimestamp,
  freshnessState,
  type UsageFilterDraft,
  validateUsageFilters,
} from "./components/usage-presentation";

interface UsageDashboardData {
  summary: UsageSummary;
  breakdown: UsageBreakdownRow[];
  events: UsageEventsPage;
}

interface UsageFilterState {
  draft: UsageFilterDraft;
  appliedQuery: UsageQuery;
}

function initialUsageFilterState(): UsageFilterState {
  const draft = defaultUsageFilterDraft();
  const result = validateUsageFilters(draft);
  if (!result.ok) throw new Error(result.message);
  return { draft, appliedQuery: result.query };
}

function uniqueRawIdentifiers(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => value !== null)))
    .sort((left, right) => left.localeCompare(right));
}

function filterOptions(data: UsageDashboardData | null) {
  if (!data) return { providers: [], models: [], agents: [] };
  return {
    providers: uniqueRawIdentifiers([
      ...data.breakdown.map((row) => row.providerId),
      ...data.events.data.map((event) => event.providerId),
    ]),
    models: uniqueRawIdentifiers([
      ...data.breakdown.map((row) => row.modelId),
      ...data.events.data.map((event) => event.modelId),
    ]),
    agents: uniqueRawIdentifiers([
      ...data.breakdown.map((row) => row.agentId),
      ...data.events.data.map((event) => event.agentId),
    ]),
  };
}

function currentRangeLabel(query: UsageQuery): string {
  return `${formatUtcTimestamp(query.from)} (inclusive) — ${formatUtcTimestamp(query.to)} (exclusive)`;
}

/** Provider-neutral, project-scoped usage analytics. */
export default function UsagePage() {
  const project = useProject();
  const [filters, setFilters] = useState<UsageFilterState>(initialUsageFilterState);
  const [data, setData] = useState<UsageDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportContinuation, setExportContinuation] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const { draft, appliedQuery } = filters;

  const loadUsage = useCallback(async (query: UsageQuery) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const [summary, breakdown, events] = await Promise.all([
        api.usage.summary(query, project),
        api.usage.breakdown(query, project),
        api.usage.events(query, project, { limit: 100 }),
      ]);
      if (version === requestVersion.current) {
        setData({ summary: summary.data, breakdown: breakdown.data, events });
      }
    } catch (fetchError: unknown) {
      if (version === requestVersion.current) {
        setError(fetchError instanceof Error ? fetchError.message : "Usage analytics could not be loaded.");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void Promise.resolve().then(() => loadUsage(appliedQuery));
  }, [appliedQuery, loadUsage]);

  const options = useMemo(() => filterOptions(data), [data]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateUsageFilters(draft);
    if (!result.ok) {
      setValidationMessage(result.message);
      return;
    }
    setValidationMessage(null);
    setExportMessage(null);
    setExportContinuation(null);
    setFilters((current) => ({ ...current, appliedQuery: result.query }));
  };

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    setFilters((current) => ({
      ...current,
      draft: {
        from: start.toISOString().slice(0, 16),
        to: end.toISOString().slice(0, 16),
        providerId: "",
        modelId: "",
        agentId: "",
        status: "",
      },
    }));
    setValidationMessage(null);
  };

  const exportCsv = async (cursor?: string) => {
    setExporting(true);
    setExportMessage(null);
    try {
      const response = await dashboardFetch(api.usage.exportUrl(
        appliedQuery,
        project,
        cursor ? { cursor } : undefined,
      ));
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(body.error?.message ?? response.statusText);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "ingenium-usage.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      const truncated = response.headers.get("X-Export-Truncated") === "true";
      const nextCursor = response.headers.get("X-Export-Next-Cursor");
      setExportContinuation(truncated ? nextCursor : null);
      setExportMessage(truncated
        ? nextCursor
          ? "CSV page downloaded. More rows are available; download the next page to continue."
          : "CSV downloaded, but the API truncated the result without a continuation cursor. Narrow the UTC range for a complete file."
        : "CSV downloaded.");
    } catch (exportError: unknown) {
      setExportMessage(exportError instanceof Error ? `CSV export failed: ${exportError.message}` : "CSV export failed.");
    } finally {
      setExporting(false);
    }
  };

  const freshness = data ? freshnessState(data.summary.freshness.lastSuccessfulSyncAt) : "unknown";
  const empty = data?.summary.totals.requests === 0;

  return (
    <div className="space-y-5" data-testid="usage-page">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--color-text-link)]">Observability</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">Usage analytics</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">
            Provider-neutral request telemetry for <span className="font-medium text-[var(--color-text-primary)]">{project}</span>. All time boundaries and freshness timestamps are UTC; the selected To boundary is exclusive.
          </p>
        </div>
        <p className="text-sm text-[var(--color-text-muted)]" data-testid="usage-range-label">{currentRangeLabel(appliedQuery)}</p>
      </header>

      <UsageFilters
        draft={draft}
        providerOptions={options.providers}
        modelOptions={options.models}
        agentOptions={options.agents}
        loading={loading}
        exporting={exporting}
        validationMessage={validationMessage}
        onChange={(next) => setFilters((current) => ({ ...current, draft: next }))}
        onSubmit={applyFilters}
        onPreset={setPreset}
        onExport={() => { void exportCsv(); }}
      />

      {exportMessage && (
        <p className="rounded-lg border border-[var(--color-info-border)] bg-[var(--color-info-bg)] px-4 py-3 text-sm text-[var(--color-info-text)]" role="status" aria-live="polite">
          {exportMessage}
        </p>
      )}
      {exportContinuation && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => { void exportCsv(exportContinuation); }}
            disabled={loading || exporting}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          >
            {exporting ? "Preparing CSV…" : "Download next CSV page"}
          </button>
        </div>
      )}

      {loading && <UsagePageSkeleton />}

      {!loading && error && !data && (
        <section className="rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-6 text-center hover:shadow-md transition-shadow" role="alert" data-testid="usage-error-state">
          <h2 className="text-lg font-semibold text-[var(--color-error-text)]">Unable to load usage analytics</h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{error}</p>
          <button
            type="button"
            onClick={() => { void loadUsage(appliedQuery); }}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          >
            Retry
          </button>
        </section>
      )}

      {!loading && data && (
        <>
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow" aria-label="Usage data freshness">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Telemetry freshness</h2>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Latest event: {formatUtcTimestamp(data.summary.freshness.latestEventAt)}</p>
                <p className="text-sm text-[var(--color-text-secondary)]">Last successful sync: {formatUtcTimestamp(data.summary.freshness.lastSuccessfulSyncAt)}</p>
              </div>
              <span className={`w-fit rounded-full border px-3 py-1 text-xs font-medium ${
                freshness === "fresh"
                  ? "border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success-text)]"
                  : freshness === "stale"
                    ? "border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"
              }`} data-testid="usage-freshness-state">
                {freshness === "fresh" ? "Fresh" : freshness === "stale" ? "Stale telemetry" : "Sync status unavailable"}
              </span>
            </div>
            {freshness === "stale" && <p className="mt-3 text-sm text-[var(--color-warning-text)]" role="alert">Telemetry may be stale. Check the usage collector before relying on this range.</p>}
          </section>

          {empty ? (
            <section className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center hover:shadow-md transition-shadow" data-testid="usage-empty-state">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">No usage events in this UTC range</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--color-text-secondary)]">
                There is no telemetry to aggregate yet. Adjust the UTC range or confirm that an OpenCode project mapping and usage sync have completed.
              </p>
            </section>
          ) : (
            <>
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Usage totals">
                <UsageMetricCard title="Requests" value={data.summary.totals.requests} detail="Step-finish events in the selected UTC range." testId="usage-metric-requests" />
                <UsageMetricCard title="Reported cost" metric={data.summary.totals.cost} cost detail="Only provider-reported cost; no currency conversion or billing estimate." testId="usage-metric-cost" />
                <UsageMetricCard title="Total tokens" metric={data.summary.totals.tokens.total} detail="Reported total token counter." testId="usage-metric-total" />
                <UsageMetricCard title="Input tokens" metric={data.summary.totals.tokens.input} detail="Reported input token counter." testId="usage-metric-input" />
                <UsageMetricCard title="Output tokens" metric={data.summary.totals.tokens.output} detail="Reported output token counter." testId="usage-metric-output" />
                <UsageMetricCard title="Reasoning tokens" metric={data.summary.totals.tokens.reasoning} detail="Reported numeric reasoning-token counter only; reasoning content is never collected." testId="usage-metric-reasoning" />
                <UsageMetricCard title="Cache read" metric={data.summary.totals.cache.read} detail="Reported cache-read tokens only." testId="usage-metric-cache-read" />
                <UsageMetricCard title="Cache write" metric={data.summary.totals.cache.write} detail="Reported cache-write tokens only." testId="usage-metric-cache-write" />
              </section>

              <p className="text-sm text-[var(--color-text-muted)]">A cache hit rate is not calculated because cache read/write counters can be omitted by providers.</p>
              <UsageTrend daily={data.summary.daily} />
              <UsageBreakdownTable rows={data.breakdown} />
              <UsageEventsTable page={data.events} />
            </>
          )}
        </>
      )}
    </div>
  );
}
