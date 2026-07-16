"use client";

import { badgeTones, BADGE_BASE } from '@/lib/badgeTones';

// ── Types ────────────────────────────────────────────────────────────────────

interface FolderProgress {
  folder: string;
  cachedCount: number;
  bodyCount: number;
  syncing: boolean;
  headersTotal: number;
  headersSynced: number;
  bodiesCached: number;
  bodiesWindow: number;
  state: string; // engine state: idle, syncing-headers, backfilling-bodies, complete, error
}

interface SyncProgressProps {
  folders: FolderProgress[];
  syncingFolders: number;
  totalCached: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ProgressBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: "blue" | "green" | "amber";
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const colorClass =
    color === "blue"
      ? "bg-blue-500"
      : color === "green"
      ? "bg-emerald-500"
      : "bg-amber-500";

  return (
    <div className="w-full h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ease-out ${colorClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  if (state === "complete") {
    return (
      <span className={`${BADGE_BASE} ${badgeTones('emerald')}`}>
        Complete
      </span>
    );
  }
  if (state === "syncing-headers") {
    return (
      <span className={`${BADGE_BASE} ${badgeTones('blue')}`}>
        Syncing headers
      </span>
    );
  }
  if (state === "backfilling-bodies") {
    return (
      <span className={`${BADGE_BASE} ${badgeTones('amber')}`}>
        Caching bodies
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className={`${BADGE_BASE} ${badgeTones('red')}`}>
        Error
      </span>
    );
  }
  return (
    <span className={`${BADGE_BASE} ${badgeTones('gray')}`}>
      Queued
    </span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * SyncProgress — full-page mailbox sync status display.
 * Shows per-folder progress (headers → bodies), overall completion percentage,
 * and error states. Rendered during initial mailbox setup before the user
 * can interact with their email.
 *
 * This screen is replaced by the normal mail UI when all folders have
 * initial cached data (cachedCount > 0).
 */
export default function SyncProgress({
  folders,
  syncingFolders,
  totalCached,
}: SyncProgressProps) {
  const activeFolders = folders.filter((f) => f.state !== "error");
  const complete = activeFolders.filter((f) => f.cachedCount > 0).length;
  const total = activeFolders.length;
  const pct = total > 0 ? Math.round((complete / total) * 100) : 100;
  const errorFolders = folders.filter((f) => f.state === "error");

  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="text-center mb-10">
        <div className="text-5xl mb-4">📧</div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
          Setting up your mailbox
        </h1>
        <p className="text-[var(--color-text-muted)] text-sm">
          Downloading your emails in the background. This only happens once —
          future loads will be instant.
        </p>
      </div>

      {/* ── Overall progress bar ────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex justify-between text-sm mb-1.5">
          <span className="text-[var(--color-text-primary)] font-medium">
            {complete} of {total} folders ready
          </span>
          <span className="text-[var(--color-text-muted)]">
            {pct}%
          </span>
        </div>
        <ProgressBar value={complete} max={total} color="blue" />
        <p className="text-xs text-[var(--color-text-secondary)] mt-2">
          {totalCached > 0
            ? `${totalCached.toLocaleString()} messages cached so far`
            : "Connecting to your mail server…"}
        </p>
      </div>

      {/* ── Per-folder cards ────────────────────────────────────────── */}
      <div className="space-y-3">
        {folders.map((f) => {
          const ready = f.cachedCount > 0;

          return (
            <div
              key={f.folder}
              className={`rounded-xl border p-4 transition-colors ${
                ready
                  ? "border-[var(--color-border)] bg-[var(--color-surface)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface-muted)]"
              }`}
            >
              {/* Folder header row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  {ready ? (
                    <span className="text-emerald-500 shrink-0">✓</span>
                  ) : f.syncing ? (
                    <svg
                      className="animate-spin w-4 h-4 text-blue-500 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  ) : (
                    <span className="w-4 h-4 shrink-0" />
                  )}
                  <span className="font-medium text-sm text-[var(--color-text-primary)] truncate">
                    {f.folder.replace(/^\[Gmail\]\//, "")}
                  </span>
                </div>
                <StateBadge state={f.state} />
              </div>

              {/* Header progress */}
              {f.headersSynced > 0 || f.syncing ? (
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs text-[var(--color-text-muted)] mb-1">
                      <span>Headers</span>
                      <span>
                        {f.headersSynced.toLocaleString()}
                        {f.headersTotal > 0
                          ? ` / ${f.headersTotal.toLocaleString()}`
                          : ""}
                      </span>
                    </div>
                    <ProgressBar
                      value={f.headersSynced}
                      max={f.headersTotal || f.headersSynced}
                      color="blue"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-[var(--color-text-muted)] mb-1">
                      <span>Bodies</span>
                      <span>
                        {f.bodiesCached.toLocaleString()}
                        {f.bodiesWindow > 0
                          ? ` / ${f.bodiesWindow.toLocaleString()}`
                          : ""}
                      </span>
                    </div>
                    <ProgressBar
                      value={f.bodiesCached}
                      max={f.bodiesWindow || f.bodiesCached}
                      color={
                        f.bodiesCached >= (f.bodiesWindow || 1)
                          ? "green"
                          : "amber"
                      }
                    />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">
                  {f.syncing ? "Starting…" : "Waiting in queue"}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <p className="text-xs text-[var(--color-text-muted)] text-center mt-8">
        {syncingFolders > 0
          ? `Syncing ${syncingFolders} folder${syncingFolders > 1 ? "s" : ""}. Emails will appear as each folder completes.`
          : "All folders have initial data — loading your mailbox…"}
      </p>
    </div>
  );
}
