"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import type { DocSearchResult } from "@/lib/docs-types";
import { Listbox, ListboxOption, useListboxNavigation } from "@/app/components/Combobox";
import { useDismissableLayer } from "@/app/components/Dropdown";

type SearchDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelectPage: (pageId: number, spaceId: number) => void;
};

/**
 * highlightMatch — splits text on query (case-insensitive) and wraps matches
 * in <mark> elements. Uses regex escaping to avoid injection from user input.
 */
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

/**
 * SearchDialog — FTS5-backed full-text search with keyboard navigation.
 * Debounces at 300ms to avoid hammering the API on every keystroke.
 * Arrow keys navigate results; Enter selects the active result; Escape closes.
 * Uses createPortal for proper z-index stacking above the editor.
 */
export default function SearchDialog({ isOpen, onClose, onSelectPage }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setMounted(true), []);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      setError(null);
      // Small delay to let the portal render
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    onClose();
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }, [onClose]);

  const listNavigation = useListboxNavigation({
    id: "docs-search",
    items: results,
    activeIndex,
    onActiveIndexChange: setActiveIndex,
    onSelect: (index) => {
      const result = results[index];
      if (result) {
        onSelectPage(result.id, result.spaceId);
        handleClose();
      }
    },
    onClose: handleClose,
  });

  useDismissableLayer({
    open: isOpen,
    onClose: handleClose,
    containerRef: dialogRef,
    restoreFocusRef: previousFocusRef,
  });

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.docs.search(query.trim());
        setResults(res?.data ?? []);
        setActiveIndex(0);
        setError(null);
      } catch {
        setResults([]);
        setError("Unable to search pages");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelect = (r: DocSearchResult) => {
    onSelectPage(r.id, r.spaceId);
    handleClose();
  };

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Dialog */}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search pages" className="relative mx-4 w-full max-w-xl rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
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
            {...listNavigation.inputProps}
            role="combobox"
            aria-controls={listNavigation.listboxId}
            aria-expanded={isOpen}
            aria-activedescendant={listNavigation.activeDescendant}
            aria-label="Search pages"
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <Listbox id={listNavigation.listboxId} aria-label="Page search results" className="max-h-80 rounded-none border-0 p-0 shadow-none">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <svg className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            error ? (
              <div role="alert" className="px-4 py-4 text-center text-sm text-[var(--color-error-text)]">{error}</div>
            ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <svg className="w-8 h-8 text-[var(--color-text-muted)] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-[var(--color-text-muted)]">No results found</p>
            </div>
            )
          )}

          {!loading &&
            results.map((r, idx) => (
              <ListboxOption
                key={r.id}
                {...listNavigation.getOptionProps(idx)}
                active={idx === activeIndex}
                className="rounded-none border-b border-[var(--color-border-muted)] px-4 py-3 last:border-b-0"
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {r.title}
                  </span>
                  <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                    {`Space ${r.spaceId}`}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">
                  {highlightMatch(r.content.slice(0, 150) + (r.content.length > 150 ? "…" : ""), query.trim())}
                </p>
              </ListboxOption>
            ))}
        </Listbox>

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
