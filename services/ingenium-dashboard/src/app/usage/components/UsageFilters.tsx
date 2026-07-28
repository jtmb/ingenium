import type { FormEvent } from "react";
import type { UsageStatus } from "@/lib/api";
import type { UsageFilterDraft } from "./usage-presentation";

interface UsageFiltersProps {
  draft: UsageFilterDraft;
  providerOptions: string[];
  modelOptions: string[];
  agentOptions: string[];
  loading: boolean;
  exporting: boolean;
  validationMessage: string | null;
  onChange: (next: UsageFilterDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPreset: (days: number) => void;
  onExport: () => void;
}

const selectClassName = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";
const inputClassName = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";

export default function UsageFilters({
  draft,
  providerOptions,
  modelOptions,
  agentOptions,
  loading,
  exporting,
  validationMessage,
  onChange,
  onSubmit,
  onPreset,
  onExport,
}: UsageFiltersProps) {
  const agentAttributionAvailable = agentOptions.length > 0;

  return (
    <form
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow"
      onSubmit={onSubmit}
      aria-label="Usage filters"
      data-testid="usage-filters"
    >
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">UTC filters</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Filter telemetry where its timestamp is on or after From and before To. Provider, model, and agent identifiers are shown exactly as received.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Quick UTC ranges">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => onPreset(days)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            >
              Last {days} days
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
          From (UTC, inclusive)
          <input
            aria-label="From (UTC, inclusive)"
            className={inputClassName}
            type="datetime-local"
            value={draft.from}
            onChange={(event) => onChange({ ...draft, from: event.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
          To (UTC, exclusive)
          <input
            aria-label="To (UTC, exclusive)"
            className={inputClassName}
            type="datetime-local"
            value={draft.to}
            onChange={(event) => onChange({ ...draft, to: event.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
          Provider
          <select
            aria-label="Provider"
            className={selectClassName}
            value={draft.providerId}
            onChange={(event) => onChange({ ...draft, providerId: event.target.value })}
          >
            <option value="">All providers</option>
            {providerOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
          Model
          <select
            aria-label="Model"
            className={selectClassName}
            value={draft.modelId}
            onChange={(event) => onChange({ ...draft, modelId: event.target.value })}
          >
            <option value="">All models</option>
            {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
          Agent
          <select
            aria-label="Agent"
            className={selectClassName}
            disabled={!agentAttributionAvailable}
            value={draft.agentId}
            onChange={(event) => onChange({ ...draft, agentId: event.target.value })}
          >
            <option value="">{agentAttributionAvailable ? "All attributed agents" : "Agent attribution unavailable"}</option>
            {agentOptions.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
          Status
          <select
            aria-label="Status"
            className={selectClassName}
            value={draft.status}
            onChange={(event) => onChange({ ...draft, status: event.target.value as UsageStatus | "" })}
          >
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="partial">Partial</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
      </div>

      <p className="mt-3 text-xs text-[var(--color-text-muted)]">
        {agentAttributionAvailable
          ? "Agent attribution is reported only when the source supplied it; absent attribution is never inferred."
          : "Agent attribution was not reported for this result, so requests are not assigned to an inferred agent."}
      </p>
      {validationMessage && <p className="mt-3 text-sm text-[var(--color-error-text)]" role="alert">{validationMessage}</p>}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onExport}
          disabled={loading || exporting}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        >
          {exporting ? "Preparing CSV…" : "Export CSV"}
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        >
          {loading ? "Loading…" : "Apply filters"}
        </button>
      </div>
    </form>
  );
}
