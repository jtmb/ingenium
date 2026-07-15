"use client";

import { useState, useEffect, useRef } from "react";
import { useProject } from "../../../lib/ProjectContext";

/**
 * SmartSuggest — fetches 3 AI-drafted reply options from the /emails/suggest endpoint
 * and displays them as stacked suggestion cards.
 *
 * API response shape:
 *   { data: { suggestions: Array<{ tone: string; subject: string; body: string }>,
 *             configured: boolean,
 *             source: "generated" | "cache" | "heuristic" } }
 */
export default function SmartSuggest({
  emailUid,
  accountId,
  folder,
  mode,
  apiUrl,
  onDraft,
  compact,
}: {
  emailUid?: string;
  accountId?: string;
  folder?: string;
  mode?: "auto" | "manual";
  apiUrl?: string;
  onDraft?: (draft: { tone: string; subject: string; body: string }) => void;
  compact?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Array<{ tone: string; subject: string; body: string }>>([]);
  const [configured, setConfigured] = useState<boolean>(true);
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = useProject();
  const cancelledRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSuggestionsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cancelledRef.current = false;
    retryCountRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const doFetch = () => {
      if (!emailUid) return;
      setLoading(true);
      setError(null);

      const base = apiUrl || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
      fetch(`${base}/emails/suggest/${emailUid}?project=${project}&account=${accountId}&folder=${encodeURIComponent(folder ?? "")}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch suggestion");
          return res.json();
        })
        .then((data) => {
          if (cancelledRef.current) return;
          const d = data.data || data;

          // Retry if the backend needs more time to cache the email body
          const hasSuggestions = d.suggestions && d.suggestions.length > 0;
          if (!hasSuggestions && (d.retry === true || d.pending === true) && retryCountRef.current < 2) {
            retryCountRef.current++;
            retryTimerRef.current = setTimeout(doFetch, 2000);
            return;
          }

          retryCountRef.current = 0;
          setSuggestions(d.suggestions || []);
          setConfigured(d.configured !== false);
          setSource(d.source || "");
          setLoading(false);
        })
        .catch((err) => {
          if (cancelledRef.current) return;
          setError(err.message);
          setLoading(false);
        });
    };

    fetchSuggestionsRef.current = doFetch;

    if (!mode || mode === "auto") {
      doFetch();
    }

    return () => {
      cancelledRef.current = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [emailUid, accountId, folder, apiUrl, project, mode]);

  if (!emailUid) return null;

  // Noreply/disabled sources — never show any UI
  // "not-new" removed per FIX 6 — backend no longer returns it
  const nullSources = new Set(["disabled", "noreply"]);
  if (nullSources.has(source)) return null;

  // Manual mode — show generate button when idle
  if (mode === "manual" && !loading && !error && suggestions.length === 0 && configured) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4">
        <button
          onClick={() => fetchSuggestionsRef.current?.()}
          className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
        >
          Generate Suggestions
        </button>
      </div>
    );
  }

  // Loading state
  if (loading) {
    if (compact) {
      return (
        <p className="text-xs text-[var(--color-text-muted)] animate-pulse py-0.5">
          Generating suggestions…
        </p>
      );
    }
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4 animate-pulse">
        <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/4 mb-3" />
        <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/3 mb-2" />
        <div className="h-3 bg-[var(--color-surface-muted)] rounded w-2/3" />
      </div>
    );
  }

  // Error state — hide in compact mode to avoid cluttering the composer
  if (error) {
    if (compact) return null;
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4">
        <p className="text-sm text-[var(--color-text-muted)]">Suggestion unavailable</p>
      </div>
    );
  }

  // No suggestions but LLM is configured — nothing to show
  if (suggestions.length === 0 && configured) {
    return null;
  }

  // LLM not configured — hide in compact mode to avoid cluttering the composer
  if (!configured) {
    if (compact) return null;
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4">
        <p className="text-sm text-[var(--color-text-muted)]">
          Configure a <a href="/?settings=general" className="text-[var(--color-text-link)] hover:underline">Synthesis LLM</a> in Settings to enable AI-drafted replies.
        </p>
      </div>
    );
  }

  // Compact mode — render inline chips (no heading, single-line cards)
  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5 items-center py-0.5">
        {suggestions.map((draft, i) => (
          <button
            key={i}
            onClick={() => onDraft?.(draft)}
            className="flex items-center gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full px-2.5 py-1 hover:bg-[var(--color-surface-hover)] cursor-pointer text-left"
            title={draft.body.substring(0, 200)}
          >
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300 shrink-0">
              {draft.tone}
            </span>
            <span className="text-xs text-[var(--color-text-muted)] truncate max-w-[180px]">
              {draft.body.substring(0, 60)}{draft.body.length > 60 ? "…" : ""}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
              }}
              className="text-xs text-[var(--color-text-link)] hover:text-blue-600 ml-1 shrink-0 p-0.5"
              title="Copy to clipboard"
              role="button"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </span>
          </button>
        ))}
      </div>
    );
  }

  // Full-card mode — render suggestion cards with heading
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Smart Replies</h4>
      {suggestions.map((draft, i) => (
        <div key={i} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium">
              {draft.tone}
            </span>
            <button
              onClick={() => navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`)}
              className="text-xs text-[var(--color-text-link)] hover:underline"
            >Copy</button>
            <button
              onClick={() => onDraft?.(draft)}
              className="text-xs text-[var(--color-text-link)] hover:underline"
            >Draft</button>
          </div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{draft.subject}</p>
          <p className="text-sm text-[var(--color-text-secondary)] line-clamp-4">{draft.body}</p>
        </div>
      ))}
    </div>
  );
}
