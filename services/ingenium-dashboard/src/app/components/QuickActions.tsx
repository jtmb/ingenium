"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { dashboardFetch, getApiBase, type ChatProviderInfo } from "@/lib/api";

/**
 * Quick action buttons for the operational cockpit.
 * Compact row of icon buttons for common actions.
 */
export default function QuickActions({ project }: { project: string }) {
  const [synthesisLoading, setSynthesisLoading] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [providers, setProviders] = useState<ChatProviderInfo[]>([]);
  const [model, setModel] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const catalogRequestRef = useRef(0);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    catalogRequestRef.current++;
  }, []);

  useEffect(() => {
    catalogRequestRef.current++;
    setShowModels(false);
    setModel("");
    setProviders([]);
    setCatalogLoading(false);
  }, [project]);

  const showToast = (message: string, tone: "success" | "error") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  const chooseModel = async () => {
    if (showModels) {
      setShowModels(false);
      setModel("");
      catalogRequestRef.current++;
      setCatalogLoading(false);
      return;
    }
    setShowModels(true);
    setCatalogLoading(true);
    const requestId = ++catalogRequestRef.current;
    try {
      const response = await dashboardFetch(`${getApiBase()}/synthesis/models?project=${encodeURIComponent(project)}`);
      if (!response.ok) throw new Error("catalog unavailable");
      const catalog: { data: { providers: ChatProviderInfo[] } } = await response.json();
      if (requestId !== catalogRequestRef.current) return;
      setProviders(catalog.data.providers);
    } catch {
      if (requestId === catalogRequestRef.current) {
        setProviders([]);
        showToast("The model catalog is temporarily unavailable.", "error");
      }
    } finally {
      if (requestId === catalogRequestRef.current) setCatalogLoading(false);
    }
  };

  /** Trigger synthesis for the validated project selected by the dashboard. */
  const runSynthesis = async () => {
    setSynthesisLoading(true);
    try {
      const res = await dashboardFetch(`${getApiBase()}/synthesis/run?project=${encodeURIComponent(project)}`, {
        method: "POST",
        ...(model ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: JSON.parse(model) }) } : {}),
      });
      if (res.ok) {
        setModel("");
        setShowModels(false);
        showToast("Synthesis started. Check Pipeline for results.", "success");
      } else {
        const failure = await res.json().catch(() => null);
        showToast(failure?.error?.message ?? "Synthesis failed", "error");
      }
    } catch {
      showToast("Synthesis failed", "error");
    } finally {
      setSynthesisLoading(false);
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
        <button
          type="button"
          onClick={chooseModel}
          disabled={synthesisLoading}
          aria-expanded={showModels}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Choose synthesis model
        </button>
      </div>

      {showModels && (
        <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          Model for this run
          <select
            aria-label="Synthesis model for this run"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={catalogLoading || synthesisLoading}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
          >
            <option value="">Configured synthesis models</option>
            {providers.map((provider) => (
              <optgroup key={provider.providerId} label={provider.label}>
                {provider.models.map((entry) => (
                  <option key={entry.id} value={JSON.stringify({ providerId: provider.providerId, modelId: entry.id })}>
                    {provider.label}: {entry.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="text-[var(--color-text-secondary)]">Applies to this run only. Saved defaults stay unchanged.</span>
        </label>
      )}

      {/* Operation feedback */}
      {toast && (
        <div
          className={`absolute top-full left-0 mt-2 rounded-lg border px-3 py-1.5 text-sm animate-pulse ${
            toast.tone === "success"
              ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-[var(--color-success-border)]"
              : "bg-[var(--color-error-bg)] text-[var(--color-error-text)] border-[var(--color-error-border)]"
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

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
