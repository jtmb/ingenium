"use client";

type ObservationSourceCardProps = {
  id: number;
  type?: string;
  contentPreview?: string;
  importance?: number;
  source?: string;
  project: string;
};

/** Emoji icons for observation types (full set matching the extraction engine categories). */
const OBS_TYPE_ICONS: Record<string, string> = {
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

/** Importance → colour mapping for the importance badge. */
function importanceColor(importance?: number): string {
  const imp = importance ?? 5;
  if (imp >= 8) return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300";
  if (imp >= 5) return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300";
}

/**
 * Clickable card/badge linking to `/observations/{id}?project={project}`.
 *
 * Displays:
 * - Observation type icon + label
 * - Content preview (first 100 chars) with hover full-preview via `title`
 * - Importance indicator
 * - Source badge
 */
export default function ObservationSourceCard({
  id,
  type,
  contentPreview,
  importance,
  source,
  project,
}: ObservationSourceCardProps) {
  const icon = type ? OBS_TYPE_ICONS[type] ?? "📌" : "📌";
  const truncated = contentPreview
    ? contentPreview.length > 100
      ? contentPreview.slice(0, 100) + "..."
      : contentPreview
    : "No preview";

  return (
    <a
      href={`/observations/${id}?project=${encodeURIComponent(project)}`}
      className="block border border-[var(--color-border)] rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors p-3 cursor-pointer"
      title={contentPreview ?? `Observation #${id}`}
      data-testid={`obs-card-${id}`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm" aria-hidden="true">{icon}</span>
        <span className="text-xs font-medium text-[var(--color-text-primary)] capitalize">
          {type ?? "Observation"}
        </span>
        <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
          #{id}
        </span>
        {importance !== undefined && (
          <span className={`ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${importanceColor(importance)}`}>
            {importance}/10
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2 leading-relaxed mb-1.5">
        {truncated}
      </p>

      <div className="flex items-center gap-2">
        {source && (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] font-mono truncate max-w-[150px]">
            {source}
          </span>
        )}
        <span className="ml-auto text-[10px] text-[var(--color-text-link)]">
          View →
        </span>
      </div>
    </a>
  );
}
