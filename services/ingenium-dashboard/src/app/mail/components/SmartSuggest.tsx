"use client";

import { useState, useEffect, useRef } from "react";
import { useProject } from "../../../lib/ProjectContext";
import { getApiBase } from "@/lib/api";

/** SVG chevron icon for collapse toggle */
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform duration-200 ${expanded ? "rotate-90" : "rotate-0"}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** SVG copy icon for card copy buttons */
function CopyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

/**
 * CardsVariant — collapsible suggestion cards with 5 distinct states.
 *
 * Extracted to module scope so it mounts fresh when `key` (emailUid) changes,
 * but persists collapsed state across parent re-renders of the same email
 * (during fetch completion, retry timers, and draft changes).
 */
function CardsVariant({
  emailUid,
  loading,
  error,
  source,
  configured,
  suggestions,
  onDraft,
  fetchSuggestionsRef,
}: {
  emailUid?: string;
  loading: boolean;
  error: string | null;
  source: string;
  configured: boolean;
  suggestions: Array<{ tone: string; subject: string; body: string }>;
  onDraft?: (draft: { tone: string; subject: string; body: string }) => void;
  fetchSuggestionsRef: React.MutableRefObject<(() => void) | null>;
}) {
  // Collapsible disclosure — expanded by default
  const [isExpanded, setIsExpanded] = useState(true);
  const suggestionsContainerId = "smart-suggest-cards-container";

  // Reset expansion when email changes (via key prop)
  useEffect(() => {
    setIsExpanded(true);
  }, [emailUid]);

  const handleApplyCard = (draft: { tone: string; subject: string; body: string }) => {
    onDraft?.(draft);
  };

  const handleCardKeyDown = (
    e: React.KeyboardEvent,
    draft: { tone: string; subject: string; body: string },
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onDraft?.(draft);
    }
  };

  return (
    <div className="space-y-2">
      {/* Collapsible heading — always visible */}
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-controls={suggestionsContainerId}
        className="flex items-center justify-between w-full text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wide px-3 pt-3 hover:text-[var(--color-text-secondary)] cursor-pointer"
      >
        <span>Smart Replies</span>
        <ChevronIcon expanded={isExpanded} />
      </button>

      {/* Controlled content region — all 5 states rendered inside */}
      <div id={suggestionsContainerId} role="region" aria-labelledby={undefined}>
        {isExpanded && (
          <>
            {/* State 1: Loading — 3 skeleton cards */}
            {loading && (
              <div className="space-y-2 px-3 pb-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border border-[var(--color-border)] rounded p-3 animate-pulse space-y-2">
                    <div className="h-3 w-16 bg-[var(--color-surface-muted)] rounded" />
                    <div className="h-3 w-3/4 bg-[var(--color-surface-muted)] rounded" />
                    <div className="h-3 w-1/2 bg-[var(--color-surface-muted)] rounded" />
                  </div>
                ))}
              </div>
            )}

            {/* State 2: Error — retry card */}
            {!loading && error && (
              <div className="border border-[var(--color-error-border)] rounded p-3 mx-3 mb-3 bg-[var(--color-error-bg)]">
                <p className="text-xs text-[var(--color-error-text)]">Could not generate suggestions</p>
                <button
                  onClick={() => fetchSuggestionsRef.current?.()}
                  className="text-xs text-[var(--color-text-link)] mt-1 hover:underline"
                >
                  Retry
                </button>
              </div>
            )}

            {/* State 3: Noreply/disabled — informational card */}
            {!loading && !error && (source === "noreply" || source === "disabled") && (
              <div className="border border-[var(--color-border)] rounded p-3 mx-3 mb-3">
                <p className="text-xs text-[var(--color-text-muted)]">Smart replies are not available for this message.</p>
              </div>
            )}

            {/* State 4: Unconfigured — config link card */}
            {!loading && !error && source !== "noreply" && source !== "disabled" && !configured && (
              <div className="border border-[var(--color-border)] rounded p-3 mx-3 mb-3">
                <p className="text-xs text-[var(--color-text-muted)]">
                  Configure a{" "}
                  <a href="/?settings=general" className="text-[var(--color-text-link)] hover:underline">
                    Synthesis LLM
                  </a>{" "}
                  to enable Smart Replies.
                </p>
              </div>
            )}

            {/* State 5: Success — 3 clickable cards */}
            {!loading && !error && source !== "noreply" && source !== "disabled" && configured && suggestions.length > 0 && (
              <div className="space-y-2 px-3 pb-3">
                {suggestions.map((draft, i) => (
                  <div
                    key={i}
                    role="button"
                    tabIndex={0}
                    aria-label={`Apply "${draft.tone}" draft`}
                    onClick={() => handleApplyCard(draft)}
                    onKeyDown={(e) => handleCardKeyDown(e, draft)}
                    className="border border-[var(--color-border)] rounded p-3 hover:shadow-md transition-shadow bg-[var(--color-surface)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                        {draft.tone}
                      </span>
                      {/* Copy icon-only button — stopPropagation prevents card apply */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
                        }}
                        className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-link)] p-1 rounded hover:bg-[var(--color-surface-hover)] cursor-pointer"
                        aria-label="Copy draft to clipboard"
                        title="Copy to clipboard"
                      >
                        <CopyIcon />
                      </button>
                    </div>
                    <p className="text-xs font-medium text-[var(--color-text-primary)] line-clamp-1 mb-1">
                      {draft.subject}
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)] line-clamp-3">
                      {draft.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * SmartSuggest — fetches 3 AI-drafted reply options from the /emails/suggest endpoint
 * and displays them as collapsible suggestion cards.
 *
 * API response shape:
 *   { data: { suggestions: Array<{ tone: string; subject: string; body: string }>,
 *             configured: boolean,
 *             source: "generated" | "cache" | "heuristic" | "noreply" | "disabled" } }
 */
export default function SmartSuggest({
  emailUid,
  accountId,
  folder,
  mode,
  onDraft,
}: {
  emailUid?: string;
  accountId?: string;
  folder?: string;
  mode?: "auto" | "manual";
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

    // Reset before fetching so suggestions from the previous email never flash.
    setSuggestions([]);
    setConfigured(true);
    setSource("");
    setError(null);
    const doFetch = () => {
      if (!emailUid) return;
      setLoading(true);
      setError(null);

      const base = getApiBase();
      fetch(`${base}/emails/suggest/${emailUid}?project=${project}&account=${accountId}&folder=${encodeURIComponent(folder ?? "")}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch suggestion");
          return res.json();
        })
        .then((data) => {
          if (cancelledRef.current) return;
          const d = data.data || data;

          /**
           * Retry polling: If the backend is still caching the email body,
           * it returns `retry: true` or `pending: true`. We poll at 2s intervals
           * up to 2 times (total ~6s max wait). After that, we show whatever
           * we got (empty suggestions with configured: true = nothing to show).
           * NOTE: The retry count is reset per emailUid via the useEffect cleanup.
           */
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
  }, [emailUid, accountId, folder, project, mode]);

  if (!emailUid) return null;

  // Manual mode shows the generate button until the first request starts.
  if (mode === "manual" && !loading && !error && suggestions.length === 0 && configured) {
    return (
      <div className="space-y-2">
        <div className="px-3 pt-3">
          <button
            onClick={() => fetchSuggestionsRef.current?.()}
            className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
          >
            Generate Suggestions
          </button>
        </div>
      </div>
    );
  }

  return (
    <CardsVariant
      key={emailUid}
      emailUid={emailUid}
      loading={loading}
      error={error}
      source={source}
      configured={configured}
      suggestions={suggestions}
      onDraft={onDraft}
      fetchSuggestionsRef={fetchSuggestionsRef}
    />
  );
}
