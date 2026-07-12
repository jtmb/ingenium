"use client";

import { useState, useEffect } from "react";

/**
 * SmartSuggest — fetches a response suggestion from the /emails/suggest endpoint
 * and displays it. Designed to be simple; extended API client logic is deferred.
 */
export default function SmartSuggest({
  emailUid,
  accountId,
  apiUrl,
}: {
  emailUid?: number;
  accountId?: string;
  apiUrl?: string;
}) {
  const [suggestion, setSuggestion] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!emailUid) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const base = apiUrl || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
    fetch(`${base}/emails/suggest/${emailUid}?project=gh-llm-bootstrap&account=${accountId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch suggestion");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setSuggestion(data.data);
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
  if (loading) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4 animate-pulse">
        <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/3 mb-2" />
        <div className="h-3 bg-[var(--color-surface-muted)] rounded w-2/3" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4">
        <p className="text-sm text-[var(--color-text-muted)]">Suggestion unavailable</p>
      </div>
    );
  }
  if (!suggestion) return null;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Smart Reply</h4>
        <span className="text-xs text-[var(--color-text-muted)]">
          {(suggestion.confidence * 100).toFixed(0)}% match
        </span>
      </div>
      <p className="text-sm text-[var(--color-text-primary)] line-clamp-3">
        {suggestion.body}
      </p>
      {suggestion.matchedSkill && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Matched skill: {suggestion.matchedSkill}
        </p>
      )}
    </div>
  );
}
