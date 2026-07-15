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
 *             source: "generated" | "cache" | "heuristic" | "not-new" } }
 */
export default function SmartSuggest({
  emailUid,
  accountId,
  isUnread,
  folder,
  mode,
  apiUrl,
  onDraft,
}: {
  emailUid?: string;
  accountId?: string;
  isUnread?: boolean;
  folder?: string;
  mode?: "auto" | "manual";
  apiUrl?: string;
  onDraft?: (draft: { tone: string; subject: string; body: string }) => void;
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
      fetch(`${base}/emails/suggest/${emailUid}?project=${project}&account=${accountId}&folder=${encodeURIComponent(folder || "INBOX")}`)
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

  // Noreply/disabled/not-new sources — never show any UI
  const nullSources = new Set(["not-new", "disabled", "noreply"]);
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
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4 animate-pulse">
        <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/4 mb-3" />
        <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/3 mb-2" />
        <div className="h-3 bg-[var(--color-surface-muted)] rounded w-2/3" />
      </div>
    );
  }

  // Error state
  if (error) {
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

  // LLM not configured — show setup prompt
  if (!configured) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4">
        <p className="text-sm text-[var(--color-text-muted)]">
          Configure a <a href="/?settings=general" className="text-[var(--color-text-link)] hover:underline">Synthesis LLM</a> in Settings to enable AI-drafted replies.
        </p>
      </div>
    );
  }

  // Render suggestion cards
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
