"use client";

import { useState, useEffect } from "react";
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
  apiUrl,
}: {
  emailUid?: string;
  accountId?: string;
  isUnread?: boolean;
  apiUrl?: string;
}) {
  const [suggestions, setSuggestions] = useState<Array<{ tone: string; subject: string; body: string }>>([]);
  const [configured, setConfigured] = useState<boolean>(true);
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = useProject();

  useEffect(() => {
    if (!emailUid) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const base = apiUrl || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
    fetch(`${base}/emails/suggest/${emailUid}?project=${project}&account=${accountId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch suggestion");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          const d = data.data || data;
          setSuggestions(d.suggestions || []);
          setConfigured(d.configured !== false);
          setSource(d.source || "");
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [emailUid, accountId, apiUrl]);

  if (!emailUid) return null;

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

  // Server says this email is not new — don't show suggestions
  if (source === "not-new") {
    return null;
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
          </div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{draft.subject}</p>
          <p className="text-sm text-[var(--color-text-secondary)] line-clamp-4">{draft.body}</p>
        </div>
      ))}
    </div>
  );
}
