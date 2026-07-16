"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import type { DocSearchResult } from "@/lib/docs-types";

type SearchDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelectPage: (pageId: number, spaceId: number) => void;
};

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-500/30 text-inherit rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export default function SearchDialog({ isOpen, onClose, onSelectPage }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      // Small delay to let the portal render
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.docs.search(query.trim());
        setResults(res?.data ?? []);
        setActiveIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[activeIndex]) {
        const r = results[activeIndex]!;
        onSelectPage(r.page_id, r.space_id);
        onClose();
      }
    },
    [results, activeIndex, onClose, onSelectPage],
  );

  const handleSelect = (r: DocSearchResult) => {
    onSelectPage(r.page_id, r.space_id);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-xl bg-[var(--color-surface)] rounded-lg shadow-2xl border border-[var(--color-border)] mx-4">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <svg className="w-5 h-5 text-[var(--color-text-muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
            placeholder="Search pages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <svg className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <svg className="w-8 h-8 text-[var(--color-text-muted)] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-[var(--color-text-muted)]">No results found</p>
            </div>
          )}

          {!loading &&
            results.map((r, idx) => (
              <button
                key={r.page_id}
                className={`w-full text-left px-4 py-3 border-b border-[var(--color-border-muted)] last:border-b-0 transition-colors ${
                  idx === activeIndex
                    ? "bg-[var(--color-surface-selected)]"
                    : "hover:bg-[var(--color-surface-hover)]"
                }`}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {r.title}
                  </span>
                  <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                    {r.space_name}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">
                  {highlightMatch(r.snippet, query.trim())}
                </p>
              </button>
            ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[var(--color-border)] flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded font-mono">↑↓</kbd> Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded font-mono">↵</kbd> Select
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
