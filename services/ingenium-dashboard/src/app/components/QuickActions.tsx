"use client";
import { useState } from "react";
import Link from "next/link";

/**
 * Quick action buttons for the operational cockpit.
 * Compact row of icon buttons for common actions.
 */
export default function QuickActions() {
  const [synthesisLoading, setSynthesisLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  /**
   * Trigger the synthesis pipeline and show a short-lived toast on completion.
   *
   * Uses a raw fetch (not the `api` client) because the URL construction is
   * trivial here and we want simple success/failure feedback without error
   * object parsing. The toast auto-dismisses after 3 seconds.
   */
  const runSynthesis = async () => {
    setSynthesisLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4097/api/v1"}/synthesis/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: "global-default" }),
      });
      if (res.ok) {
        setToast("Synthesis completed");
      } else {
        setToast("Synthesis failed");
      }
    } catch {
      setToast("Synthesis failed");
    } finally {
      setSynthesisLoading(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const actions = [
    { label: "New Doc", href: "/docs", icon: DocIcon },
    { label: "Open CLI", href: "/opencode?mode=cli", icon: CLIIcon },
    { label: "New Task", href: "/tasks", icon: TaskIcon },
    { label: "Compose Mail", href: "/mail?compose=new", icon: MailIcon },
  ];

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
              bg-[var(--color-surface)] border border-[var(--color-border)]
              rounded-lg hover:bg-[var(--color-surface-hover)]
              hover:shadow-md transition-shadow text-[var(--color-text-primary)]"
          >
            <a.icon />
            {a.label}
          </Link>
        ))}

        <button
          onClick={runSynthesis}
          disabled={synthesisLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
            bg-blue-600 text-white border border-blue-600
            rounded-lg hover:bg-blue-700 hover:shadow-md transition-shadow
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {synthesisLoading ? (
            <SpinnerIcon />
          ) : (
            <SynthIcon />
          )}
          {synthesisLoading ? "Running..." : "Run Synthesis"}
        </button>
      </div>

      {/* Success toast */}
      {toast && (
        <div className="absolute top-full left-0 mt-2 px-3 py-1.5 text-sm
          bg-[var(--color-success-bg)] text-[var(--color-success-text)]
          border border-[var(--color-success-border)] rounded-lg
          animate-pulse">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function DocIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5l-4-4z" />
      <path d="M9 1v4h4" />
      <line x1="5" y1="9" x2="11" y2="9" />
      <line x1="5" y1="11" x2="9" y2="11" />
    </svg>
  );
}

function CLIIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="2" width="14" height="12" rx="2" />
      <path d="M4 5l2 2-2 2" />
      <line x1="8" y1="9" x2="10" y2="9" />
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <line x1="2" y1="6" x2="14" y2="6" />
      <line x1="6" y1="6" x2="6" y2="14" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="10" rx="2" />
      <path d="M1 3l7 5 7-5" />
    </svg>
  );
}

function SynthIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v4l3 2" />
      <path d="M2 8h2" />
      <path d="M12 8h2" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" strokeOpacity="0.3" />
      <path d="M8 2a6 6 0 016 6" strokeLinecap="round" />
    </svg>
  );
}
