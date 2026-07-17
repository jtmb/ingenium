"use client";
import Link from "next/link";
import { useState } from "react";
import type { ActivityItem } from "../../lib/api";

interface ActivityTimelineProps {
  items: ActivityItem[] | null;
  loading?: boolean;
}

/**
 * Activity Timeline — shows recent pipeline events in a vertical timeline.
 */
export default function ActivityTimeline({ items, loading }: ActivityTimelineProps) {
  const [showAll, setShowAll] = useState(false);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 hover:shadow-md transition-shadow">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          Activity Timeline
        </h2>
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-8 h-8 bg-[var(--color-surface-muted)] rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 bg-[var(--color-surface-muted)] rounded w-3/4" />
                <div className="h-3 bg-[var(--color-surface-muted)] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!items || items.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 hover:shadow-md transition-shadow">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
          Activity Timeline
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Activity will appear here as you use Ingenium
        </p>
      </div>
    );
  }

  // Show first 10 by default; "Show all" reveals the full list
  const displayItems = showAll ? items : items.slice(0, 10);

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 hover:shadow-md transition-shadow">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
        Activity Timeline
      </h2>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-[var(--color-border)]" />

        <div className="space-y-1">
          {displayItems.map((item) => (
            <div key={item.id} className="relative flex items-start gap-3 pl-10 py-2">
              {/* Timeline dot */}
              <div
                className={`absolute left-2.5 w-3 h-3 rounded-full border-2 border-[var(--color-surface)]
                  ${dotColor(item.type)}`}
              />

              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--color-text-primary)]">
                  {typeIcon(item.type)}{" "}
                  {item.route ? (
                    <Link
                      href={item.route}
                      className="font-medium text-[var(--color-text-link)] hover:underline"
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{item.title}</span>
                  )}
                </p>
                {item.description && (
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 truncate">
                    {item.description}
                  </p>
                )}
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {relativeTime(item.timestamp)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Show more / less */}
      {items.length > 10 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="mt-3 text-sm text-[var(--color-text-link)] hover:underline font-medium"
        >
          {showAll ? "Show less" : `Show all (${items.length} events)`}
        </button>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const typeIconMap: Record<string, string> = {
  skill_created: "\uD83E\uDDE0",
  skill_updated: "\uD83E\uDDE0",
  observation_processed: "\uD83D\uDC41\uFE0F",
  job_completed: "\u2705",
  task_completed: "\u2705",
  synthesis_completed: "\uD83D\uDD04",
  email_received: "\uD83D\uDCE7",
  email_sent: "\uD83D\uDCE4",
  config_changed: "\u2699\uFE0F",
  // Pipeline event fallbacks (from pipeline_events table)
  session_created: "\u{1F4BB}",
  synthesis_started: "\uD83D\uDD04",
  synthesis_failed: "\u26A0\uFE0F",
  trait_created: "\uD83C\uDF1F",
  trait_updated: "\uD83D\uDCC8",
  observation_created: "\uD83D\uDC41\uFE0F",
  observation_imported: "\uD83D\uDCE5",
  extraction_completed: "\uD83E\uDD16",
  extraction_failed: "\u26A0\uFE0F",
  plugin_initialized: "\uD83D\uDD0C",
  plugin_error: "\u26A0\uFE0F",
  skill_consolidated: "\uD83E\uDDE0",
};

/** Look up the emoji icon for a given event type, falling back to a neutral blue circle. */
function typeIcon(type: string): string {
  return typeIconMap[type] ?? "\uD83D\uDD35";
}

/**
 * Timeline dot color derived from the event type via substring matching.
 *
 * Order matters — "failed" must be checked before "started" / "created"
 * since long names like "extraction_failed" contain "started" / "created".
 */
function dotColor(type: string): string {
  if (type.includes("failed") || type.includes("error")) return "bg-red-500";
  if (type.includes("completed")) return "bg-green-500";
  if (type.includes("started") || type.includes("triggered")) return "bg-[var(--color-accent)]";
  if (type.includes("created") || type.includes("imported") || type.includes("received")) return "bg-purple-500";
  if (type.includes("updated") || type.includes("processed")) return "bg-amber-500";
  return "bg-gray-400";
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
