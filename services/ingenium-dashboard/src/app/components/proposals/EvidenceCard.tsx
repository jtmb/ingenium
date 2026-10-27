"use client";

type ObservationSource = {
  id: number;
  type?: string;
  contentPreview?: string;
  observation_type?: string;
  content_preview?: string;
  content?: string;
  importance?: number;
  source?: string;
};

type EvidenceEntry = {
  trigger?: string;
  trigger_type?: string;
  trigger_label?: string;
  model?: string;
  source_type?: string;
  source_label?: string;
  observation_summaries?: string[];
  observation_ids?: number[];
  [key: string]: unknown;
};

type EvidenceCardProps = {
  evidence: EvidenceEntry;
  observations: ObservationSource[];
  project: string;
};

/**
 * Styled card for a single evidence entry, showing:
 * - Trigger label + model badge
 * - Contributing observation summaries
 * - Clickable observation source links
 *
 * Enriched observations provide source previews and link tooltips. Missing
 * enrichment still retains each source link without inventing content.
 */
export default function EvidenceCard({ evidence, observations, project }: EvidenceCardProps) {
  const triggerLabel = evidence.trigger_label ?? evidence.trigger_type ?? evidence.trigger ?? evidence.source_label ?? evidence.source_type ?? "Unknown";
  const model = evidence.model;

  const observationIds = evidence.observation_ids ?? [];
  const matchedObs = observationIds.map((id) => ({
    id,
    observation: observations.find((observation) => observation.id === id),
  }));
  const content = (observation: ObservationSource): string | undefined =>
    observation.contentPreview ?? observation.content_preview ?? observation.content;
  const preview = (observation: ObservationSource): string => {
    const text = content(observation);
    return text ? (text.length > 100 ? text.slice(0, 100) + "..." : text) : "No preview available";
  };
  const summaries = evidence.observation_summaries ?? [];
  const sourcePreviews = matchedObs.flatMap(({ observation }) =>
    observation && content(observation) ? [preview(observation)] : []
  );
  const supportingText = summaries.length > 0 ? summaries : sourcePreviews;

  return (
    <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-surface-muted)] border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-[var(--color-text-primary)] truncate" title={triggerLabel}>
            {triggerLabel}
          </span>
        </div>
        {model && (
          <span className="shrink-0 ml-2 px-2 py-0.5 text-[10px] font-mono font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
            {model}
          </span>
        )}
      </div>

      {/* Observation summaries */}
      <div className="px-4 py-3 space-y-2">
        {supportingText.length > 0 ? (
          <div>
            {summaries.length === 0 && (
              <p className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide mb-1">
                Source previews
              </p>
            )}
            <ul className="list-disc list-inside text-xs text-[var(--color-text-secondary)] space-y-1">
              {supportingText.map((text, index) => <li key={index}>{text}</li>)}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)] italic">
            No supporting summaries available.
          </p>
        )}

        {/* Observation links */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {matchedObs.length > 0 ? (
            matchedObs.map(({ id, observation }) => {
              const type = observation?.type ?? observation?.observation_type;
              return (
                <a
                  key={id}
                  href={`/observations/${id}?project=${encodeURIComponent(project)}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-[var(--color-surface-hover)] hover:bg-[var(--color-selection-bg)] text-[var(--color-text-link)] transition-colors cursor-pointer"
                  title={observation
                    ? `${type ?? "Observation"} #${id}: ${preview(observation)}`
                    : `Observation #${id} — Source chat unavailable (not enriched)`}
                >
                  <ObsTypeIcon type={type} />
                  <span>#{id}</span>
                </a>
              );
            })
          ) : (
            <span className="text-[11px] text-[var(--color-text-muted)] italic">
              Source chat unavailable
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tiny icon representing an observation type. */
function ObsTypeIcon({ type }: { type?: string }) {
  const iconMap: Record<string, string> = {
    correction: "✏️",
    preference: "⭐",
    pattern: "🔍",
    insight: "💡",
    feedback: "💬",
    behavior: "👤",
    terminology: "📝",
    workflow: "⚙️",
    error: "❌",
    goal: "🎯",
  };
  return (
    <span className="text-[10px]" aria-hidden="true">
      {iconMap[type ?? ""] ?? "📌"}
    </span>
  );
}
