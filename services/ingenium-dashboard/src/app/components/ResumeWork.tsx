"use client";
import Link from "next/link";
import type { ResumeData } from "../../lib/api";

interface ResumeWorkProps {
  data: ResumeData | null;
  loading?: boolean;
}

/**
 * Resume Work section — shows where the user left off.
 * Displays last visited pages and active session with resume links.
 */
export default function ResumeWork({ data, loading }: ResumeWorkProps) {
  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 hover:shadow-md transition-shadow">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          Resume Work
        </h2>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/2" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-2/3" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/3" />
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 hover:shadow-md transition-shadow">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
          Resume Work
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Start something new — your recent activity will appear here
        </p>
      </div>
    );
  }

  const { lastVisitedPages, activeSession } = data;
  const hasPages = lastVisitedPages.length > 0;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 hover:shadow-md transition-shadow">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
        Resume Work
      </h2>

      {/* Active session */}
      {activeSession && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--color-info-bg)] border border-[var(--color-info-border)]">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            Continue where you left off
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {activeSession.label}
            {activeSession.detail && <> &mdash; {activeSession.detail}</>}
          </p>
          <Link
            href="/opencode"
            className="inline-block mt-2 text-xs px-3 py-1 rounded bg-blue-600 text-white
              hover:bg-blue-700 transition-colors"
          >
            Resume Session
          </Link>
        </div>
      )}

      {/* Last visited pages */}
      {hasPages && (
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            Recent pages
          </p>
          <div className="flex flex-wrap gap-1.5">
            {lastVisitedPages.map((page, i) => (
              <Link
                key={i}
                href={page.route}
                className="inline-block text-sm px-3 py-1.5 rounded-lg
                  bg-[var(--color-surface-muted)] border border-[var(--color-border-muted)]
                  text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]
                  hover:border-[var(--color-border)] transition-colors"
              >
                {page.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Completely empty */}
      {!activeSession && !hasPages && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Start something new — your recent activity will appear here
        </p>
      )}
    </div>
  );
}
