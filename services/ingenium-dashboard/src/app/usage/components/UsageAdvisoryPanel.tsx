"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  type UsageAdvisoryEvaluation,
  type UsageAdvisoryMetric,
  type UsageAdvisoryThresholds,
  type UsageAttentionItem,
  type UsageAttentionPage,
  type UsageQuery,
} from "@/lib/api";
import {
  advisoryObservedLabel,
  advisoryStateLabel,
  attentionFreshnessLabel,
  attentionMetricLabel,
  attentionSeverityTone,
  formatNumber,
  formatUtcTimestamp,
  thresholdsToDraft,
  USAGE_THRESHOLD_FIELDS,
  type UsageThresholdDraft,
  validateUsageThresholdDraft,
} from "./usage-presentation";

interface UsageAdvisoryPanelProps {
  project: string;
  selectedRange: Pick<UsageQuery, "from" | "to">;
}

const EMPTY_DRAFT: UsageThresholdDraft = {
  requestCount: "",
  totalTokens: "",
  reportedCostAmount: "",
  cacheReadTokens: "",
  cacheWriteTokens: "",
};

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.status > 0 ? error.message : fallback;
}

function attentionMetric(item: UsageAttentionItem): UsageAdvisoryMetric {
  return {
    observed: item.observed,
    threshold: item.threshold,
    availability: item.availability,
    state: item.evaluationState,
  };
}

function severityClass(item: UsageAttentionItem): string {
  switch (attentionSeverityTone(item.severity)) {
    case "critical": return "border-[var(--color-error-border)] bg-[var(--color-error-bg)] text-[var(--color-error-text)]";
    case "warning": return "border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]";
    default: return "border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]";
  }
}

function evaluationMetric(evaluation: UsageAdvisoryEvaluation, key: keyof UsageAdvisoryEvaluation["metrics"]): UsageAdvisoryMetric {
  return evaluation.metrics[key];
}

/** Advisory-only thresholds and all-history attention intentionally load independently from telemetry. */
export default function UsageAdvisoryPanel({ project, selectedRange }: UsageAdvisoryPanelProps) {
  const [thresholds, setThresholds] = useState<UsageAdvisoryThresholds | null>(null);
  const [draft, setDraft] = useState<UsageThresholdDraft>(EMPTY_DRAFT);
  const [thresholdLoading, setThresholdLoading] = useState(true);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [thresholdMessage, setThresholdMessage] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<UsageAdvisoryEvaluation | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(true);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [attention, setAttention] = useState<UsageAttentionPage | null>(null);
  const [attentionLoading, setAttentionLoading] = useState(true);
  const [attentionMoreLoading, setAttentionMoreLoading] = useState(false);
  const [attentionError, setAttentionError] = useState<string | null>(null);
  const [attentionMoreError, setAttentionMoreError] = useState<string | null>(null);
  const [attentionActionId, setAttentionActionId] = useState<string | null>(null);
  const [attentionMessage, setAttentionMessage] = useState<string | null>(null);
  const thresholdRequest = useRef(0);
  const evaluationRequest = useRef(0);
  const attentionRequest = useRef(0);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const focusStatus = () => {
    window.requestAnimationFrame(() => statusRef.current?.focus());
  };

  const loadThresholds = useCallback(async (replaceDraft: boolean) => {
    const request = ++thresholdRequest.current;
    setThresholdLoading(true);
    try {
      const response = await api.usage.thresholds.get(project);
      if (request !== thresholdRequest.current) return;
      setThresholds(response.data);
      setThresholdError(null);
      if (replaceDraft) setDraft(thresholdsToDraft(response.data));
    } catch (error: unknown) {
      if (request === thresholdRequest.current) setThresholdError(failureMessage(error, "Advisory thresholds could not be loaded."));
    } finally {
      if (request === thresholdRequest.current) setThresholdLoading(false);
    }
  }, [project]);

  const loadEvaluation = useCallback(async () => {
    const request = ++evaluationRequest.current;
    setEvaluationLoading(true);
    try {
      const response = await api.usage.thresholds.evaluate(selectedRange, project);
      if (request === evaluationRequest.current) {
        setEvaluation(response.data);
        setEvaluationError(null);
      }
    } catch (error: unknown) {
      if (request === evaluationRequest.current) setEvaluationError(failureMessage(error, "Selected-range advisory evaluation could not be loaded."));
    } finally {
      if (request === evaluationRequest.current) setEvaluationLoading(false);
    }
  }, [project, selectedRange]);

  const loadAttention = useCallback(async (cursor?: string, append = false) => {
    const request = ++attentionRequest.current;
    if (append) {
      setAttentionMoreLoading(true);
    } else {
      setAttentionLoading(true);
    }
    try {
      const page = await api.usage.attention.list({ includeResolved, limit: 50, ...(cursor ? { cursor } : {}) }, project);
      if (request !== attentionRequest.current) return;
      setAttention((current) => {
        if (!append || !current) return page;
        const seen = new Set(current.data.map((item) => item.id));
        return { ...page, data: [...current.data, ...page.data.filter((item) => !seen.has(item.id))] };
      });
      if (append) setAttentionMoreError(null);
      else {
        setAttentionError(null);
        setAttentionMoreError(null);
      }
    } catch (error: unknown) {
      if (request !== attentionRequest.current) return;
      const message = failureMessage(error, "Usage attention could not be loaded.");
      if (append) setAttentionMoreError(message);
      else setAttentionError(message);
    } finally {
      if (request === attentionRequest.current) {
        if (append) setAttentionMoreLoading(false);
        else setAttentionLoading(false);
      }
    }
  }, [includeResolved, project]);

  useEffect(() => { void Promise.resolve().then(() => loadThresholds(true)); }, [loadThresholds]);
  useEffect(() => { void Promise.resolve().then(loadEvaluation); }, [loadEvaluation]);
  useEffect(() => { void Promise.resolve().then(() => loadAttention()); }, [loadAttention]);

  const saveThresholds = async () => {
    if (!thresholds) return;
    const validation = validateUsageThresholdDraft(draft, thresholds.revision);
    if (!validation.ok) {
      setThresholdError(validation.message);
      return;
    }
    setThresholdSaving(true);
    setThresholdError(null);
    setThresholdMessage(null);
    try {
      const response = await api.usage.thresholds.replace(validation.replacement, project);
      setThresholds(response.data);
      setDraft(thresholdsToDraft(response.data));
      setThresholdMessage("Advisory thresholds saved. Selected range re-evaluated.");
      await loadEvaluation();
      focusStatus();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        await loadThresholds(false);
        setThresholdMessage("Thresholds changed elsewhere. Current values were reloaded; review your retained draft before saving.");
        focusStatus();
      } else {
        setThresholdError(failureMessage(error, "Advisory thresholds could not be saved."));
      }
    } finally {
      setThresholdSaving(false);
    }
  };

  const discardThresholdDraft = () => {
    if (thresholds) setDraft(thresholdsToDraft(thresholds));
    setThresholdError(null);
    setThresholdMessage("Draft discarded. Saved thresholds are shown.");
    focusStatus();
  };

  const evaluateAttention = async () => {
    setAttentionActionId("evaluate");
    setAttentionMessage(null);
    try {
      await api.usage.attention.evaluate(project);
      await loadAttention();
      setAttentionMessage("All-history attention evaluated.");
      focusStatus();
    } catch (error: unknown) {
      setAttentionError(failureMessage(error, "Usage attention could not be evaluated."));
    } finally {
      setAttentionActionId(null);
    }
  };

  const acknowledgeAttention = async (item: UsageAttentionItem) => {
    setAttentionActionId(item.id);
    setAttentionMessage(null);
    try {
      const response = await api.usage.attention.acknowledge(item.id, item.revision, project);
      setAttention((current) => current
        ? { ...current, data: current.data.map((entry) => entry.id === item.id ? response.data : entry) }
        : current);
      setAttentionMessage(`${attentionMetricLabel(item.metric)} acknowledged.`);
      focusStatus();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        await loadAttention();
        setAttentionMessage("Attention changed elsewhere. The current list was reloaded.");
        focusStatus();
      } else {
        setAttentionError(failureMessage(error, "Usage attention could not be acknowledged."));
      }
    } finally {
      setAttentionActionId(null);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow" aria-labelledby="usage-advisory-heading" data-testid="usage-advisory-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="usage-advisory-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">Usage advisories</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Advisory only; no enforcement. Selected evaluation uses the current half-open UTC range: From inclusive, To exclusive.</p>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">Attention is fixed to All history.</p>
      </div>

      {(thresholdMessage || attentionMessage) && <p ref={statusRef} tabIndex={-1} className="sr-only" role="status" aria-live="polite">{thresholdMessage ?? attentionMessage}</p>}

      <div className="mt-5 border-t border-[var(--color-border-muted)] pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="font-semibold text-[var(--color-text-primary)]">Thresholds</h3>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Leave a field blank for Disabled. Reported cost amount has no currency or conversion.</p>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Revision {thresholds?.revision ?? "—"} · Updated {formatUtcTimestamp(thresholds?.updatedAt ?? null)}</p>
        </div>
        {thresholdError && <p className="mt-3 text-sm text-[var(--color-error-text)]" role="alert">{thresholdError}</p>}
        {thresholdMessage && <p className="mt-3 text-sm text-[var(--color-info-text)]">{thresholdMessage}</p>}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-busy={thresholdLoading}>
          {USAGE_THRESHOLD_FIELDS.map((field) => (
            <label key={field.key} className="min-w-0 text-xs font-medium text-[var(--color-text-secondary)]">
              {field.label}
              <input
                aria-label={field.label}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                inputMode={field.integer ? "numeric" : "decimal"}
                placeholder="Disabled"
                value={draft[field.key]}
                disabled={thresholdLoading || thresholdSaving || !thresholds}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={discardThresholdDraft} disabled={thresholdLoading || thresholdSaving || !thresholds} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">Discard</button>
          <button type="button" onClick={() => { void loadThresholds(true); }} disabled={thresholdLoading || thresholdSaving} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">Reload</button>
          <button type="button" onClick={() => { void saveThresholds(); }} disabled={thresholdLoading || thresholdSaving || !thresholds} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">{thresholdSaving ? "Saving…" : "Save thresholds"}</button>
        </div>
      </div>

      <div className="mt-5 border-t border-[var(--color-border-muted)] pt-5" aria-busy={evaluationLoading}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="font-semibold text-[var(--color-text-primary)]">Selected range evaluation</h3>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">From {formatUtcTimestamp(selectedRange.from)} inclusive to {formatUtcTimestamp(selectedRange.to)} exclusive.</p>
          </div>
          <button type="button" onClick={() => { void loadEvaluation(); }} disabled={evaluationLoading} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">Re-evaluate range</button>
        </div>
        {evaluationError && <p className="mt-3 text-sm text-[var(--color-error-text)]" role="alert">{evaluationError}</p>}
        {evaluationLoading && !evaluation && <p className="mt-3 text-sm text-[var(--color-text-muted)]" role="status">Loading selected-range evaluation…</p>}
        {evaluation && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {USAGE_THRESHOLD_FIELDS.map((field) => {
              const metric = evaluationMetric(evaluation, field.key);
              return (
                <article key={field.key} className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 hover:shadow-md transition-shadow">
                  <h4 className="text-xs font-medium text-[var(--color-text-secondary)]">{field.label}</h4>
                  <p className="mt-2 break-words text-lg font-semibold text-[var(--color-text-primary)]">{advisoryObservedLabel(metric)}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Threshold: {metric.threshold === null ? "Disabled" : formatNumber(metric.threshold)}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{advisoryStateLabel(metric)}</p>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-[var(--color-border-muted)] pt-5" aria-busy={attentionLoading}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold text-[var(--color-text-primary)]">All-history attention</h3>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Lifecycle notices are advisory only; no enforcement.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} /> Active + resolved</label>
            <button type="button" onClick={() => { void evaluateAttention(); }} disabled={attentionActionId === "evaluate"} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">{attentionActionId === "evaluate" ? "Evaluating…" : "Evaluate attention now"}</button>
          </div>
        </div>
        {attentionMessage && <p className="mt-3 text-sm text-[var(--color-info-text)]">{attentionMessage}</p>}
        {attentionError && <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[var(--color-error-text)]" role="alert"><span>{attentionError}</span><button type="button" onClick={() => { void loadAttention(); }} className="underline">Reload attention</button></div>}
        {attentionLoading && !attention && <p className="mt-3 text-sm text-[var(--color-text-muted)]" role="status">Loading all-history attention…</p>}
        {attention && attention.data.length === 0 && !attentionLoading && <p className="mt-3 text-sm text-[var(--color-text-muted)]">No {includeResolved ? "attention items" : "active attention items"}.</p>}
        {attention && attention.data.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {attention.data.map((item) => {
              const metric = attentionMetric(item);
              return (
                <article key={item.id} className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><h4 className="font-semibold text-[var(--color-text-primary)]">{attentionMetricLabel(item.metric)}</h4><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{advisoryStateLabel(metric)}</p></div>
                    <div className="flex gap-2"><span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">{item.status}</span><span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${severityClass(item)}`}>{item.severity}</span></div>
                  </div>
                  <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)] sm:grid-cols-2">
                    <div><dt className="inline font-medium">Observed: </dt><dd className="inline">{advisoryObservedLabel(metric)}</dd></div>
                    <div><dt className="inline font-medium">Threshold: </dt><dd className="inline">{item.threshold === null ? "Disabled" : formatNumber(item.threshold)}</dd></div>
                    <div><dt className="inline font-medium">Availability: </dt><dd className="inline">{item.availability}</dd></div>
                    <div><dt className="inline font-medium">Freshness: </dt><dd className="inline">{attentionFreshnessLabel(item.freshness)}</dd></div>
                    <div><dt className="inline font-medium">Observed lifecycle: </dt><dd className="inline">Opened {formatUtcTimestamp(item.openedAt)}</dd></div>
                    <div><dt className="inline font-medium">Last evaluated: </dt><dd className="inline">{formatUtcTimestamp(item.lastEvaluatedAt)}</dd></div>
                    <div><dt className="inline font-medium">Acknowledged: </dt><dd className="inline">{formatUtcTimestamp(item.acknowledgedAt)}</dd></div>
                    <div><dt className="inline font-medium">Resolved: </dt><dd className="inline">{formatUtcTimestamp(item.resolvedAt)}</dd></div>
                    <div><dt className="inline font-medium">Reopened: </dt><dd className="inline">{formatUtcTimestamp(item.reopenedAt)} · {item.reopenCount}</dd></div>
                    <div><dt className="inline font-medium">Revision: </dt><dd className="inline">{item.revision} (threshold {item.thresholdRevision})</dd></div>
                  </dl>
                  {item.acknowledgedAt === null && <button type="button" onClick={() => { void acknowledgeAttention(item); }} disabled={attentionActionId === item.id} className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">{attentionActionId === item.id ? "Acknowledging…" : "Acknowledge"}</button>}
                </article>
              );
            })}
          </div>
        )}
        {attentionMoreError && <p className="mt-3 text-sm text-[var(--color-error-text)]" role="alert">Could not load more attention: {attentionMoreError}</p>}
        {attention?.pagination.hasMore && attention.pagination.nextCursor && <div className="mt-4"><button type="button" onClick={() => { const cursor = attention.pagination.nextCursor; if (cursor) void loadAttention(cursor, true); }} disabled={attentionMoreLoading} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">{attentionMoreLoading ? "Loading…" : "Load more attention"}</button></div>}
      </div>
    </section>
  );
}
