"use client";

type ObservationSource = {
  id: number;
  observation_type?: string;
  content_preview?: string;
  content?: string;
  importance?: number;
  source?: string;
};

type EvidenceEntry = {
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
 * If observations are enriched from the API, renders `ObservationSourceCard`
 * widgets with content previews. Otherwise shows placeholder text.
 */
export default function EvidenceCard({ evidence, observations, project }: EvidenceCardProps) {
  const triggerLabel = evidence.trigger_label ?? evidence.trigger_type ?? evidence.source_label ?? evidence.source_type ?? "Unknown";
  const model = evidence.model;

  // Match evidence observation_ids to our enriched observations array
  const matchedObs = (evidence.observation_ids ?? []).map((oid) =>
    observations.find((o) => o.id === oid)
  );

  // Compute a content preview from observation content
  const preview = (o: ObservationSource): string => {
    if (o.content_preview) return o.content_preview;
    if (o.content) return o.content.length > 100 ? o.content.slice(0, 100) + "..." : o.content;
    return "No preview available";
  };

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
        {evidence.observation_summaries && evidence.observation_summaries.length > 0 ? (
          <ul className="list-disc list-inside text-xs text-[var(--color-text-secondary)] space-y-1">
            {evidence.observation_summaries.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)] italic">
            No supporting summaries available.
          </p>
        )}

        {/* Observation links */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {matchedObs.length > 0 ? (
            matchedObs.map((obs) => {
              if (!obs) return null;
              return (
                <a
                  key={obs.id}
                  href={`/observations/${obs.id}?project=${encodeURIComponent(project)}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-[var(--color-surface-hover)] hover:bg-[var(--color-selection-bg)] text-[var(--color-text-link)] transition-colors cursor-pointer"
                  title={`${obs.observation_type ?? "Observation"} #${obs.id}: ${preview(obs)}`}
                >
                  <ObsTypeIcon type={obs.observation_type} />
                  <span>#{obs.id}</span>
                </a>
              );
            })
          ) : (evidence.observation_ids ?? []).length > 0 ? (
            (evidence.observation_ids ?? []).map((oid: number) => (
              <a
                key={oid}
                href={`/observations/${oid}?project=${encodeURIComponent(project)}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-[var(--color-surface-hover)] hover:bg-[var(--color-selection-bg)] text-[var(--color-text-link)] transition-colors cursor-pointer"
                title={`Observation #${oid} — Source chat unavailable (not enriched)`}
              >
                <ObsTypeIcon type={undefined} />
                <span>#{oid}</span>
              </a>
            ))
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
