"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, Task } from "../../../lib/api";
import { badgeTones } from "../../../lib/badgeTones";
import { Listbox, ListboxOption, useListboxNavigation } from "../../components/Combobox";
import { useDismissableLayer } from "../../components/Dropdown";

type SpotlightSearchProps = {
  project: string;
  onTaskSelect: (task: Task) => void;
};

/**
 * Highlight matching query text in a string using a case-insensitive regex.
 * Escapes special regex characters from the user's query to avoid injection.
 */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className="bg-yellow-200 text-black rounded">{part}</mark> : part
  );
}

/**
 * Spotlight-style task search (Cmd+K / Ctrl+K).
 *
 * Features:
 * - Debounced API search (200ms) to avoid flooding the server on every keystroke
 * - Keyboard navigation: ArrowUp/ArrowDown to move through results, Enter to select
 * - Esc to close, Cmd+K to toggle
 * - Regex-escaped text highlighting in results
 */
export default function SpotlightSearch({ project, onTaskSelect }: SpotlightSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const openSpotlight = useCallback(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIsOpen(true);
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
    setError(null);
    // Use rAF to ensure the DOM has rendered before focusing the input.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closeSpotlight = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setResults([]);
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }, []);

  const listNavigation = useListboxNavigation({
    id: "spotlight-tasks",
    items: results,
    activeIndex: selectedIndex,
    onActiveIndexChange: setSelectedIndex,
    onSelect: (index) => {
      const task = results[index];
      if (task) {
        onTaskSelect(task);
        closeSpotlight();
      }
    },
    onClose: closeSpotlight,
  });

  useDismissableLayer({
    open: isOpen,
    onClose: closeSpotlight,
    containerRef: searchRef,
    restoreFocusRef: previousFocusRef,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) closeSpotlight();
        else openSpotlight();
      }
      if (e.key === "Escape" && isOpen) {
        closeSpotlight();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, openSpotlight, closeSpotlight]);

  // Debounced search: 200ms delay prevents a request per keystroke while
  // keeping the search responsive. Clears on unmount/query change.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSelectedIndex(0);
      setError(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.tasks.search(query, project);
        setResults(r.data ?? []);
        setSelectedIndex(0);
        setError(null);
      } catch {
        setResults([]);
        setError("Unable to search tasks");
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, project]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={closeSpotlight} />
      {/* Search pane */}
      <div ref={searchRef} role="dialog" aria-modal="true" aria-label="Search tasks" className="relative mx-4 w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-2xl sm:max-w-xl">
        <div className="flex items-center px-4 py-3 border-b border-[var(--color-border)]">
          <svg className="w-5 h-5 text-[var(--color-text-muted)] mr-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            {...listNavigation.inputProps}
            aria-expanded={isOpen}
            role="combobox"
            aria-controls={listNavigation.listboxId}
            aria-activedescendant={listNavigation.activeDescendant}
            aria-label="Search tasks"
            placeholder="Search tasks..."
            className="flex-1 text-lg outline-none text-[var(--color-text-primary)] placeholder-gray-400" />
          <kbd className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-muted)] rounded px-1.5 py-0.5 ml-2">Esc</kbd>
        </div>
        <Listbox id={listNavigation.listboxId} aria-label="Task search results" className="max-h-[300px] rounded-none border-0 p-0 shadow-none">
          {loading && (
            <div className="px-4 py-3 text-sm text-[var(--color-text-muted)]">Searching...</div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            error ? (
              <div role="alert" className="px-4 py-3 text-sm text-[var(--color-error-text)]">{error}</div>
            ) : (
              <div className="px-4 py-3 text-sm text-[var(--color-text-muted)]">No tasks found.</div>
            )
          )}
          {!loading && results.map((t, i) => (
            <ListboxOption key={t.id}
              {...listNavigation.getOptionProps(i)}
              active={i === selectedIndex}
              onClick={() => { onTaskSelect(t); closeSpotlight(); }}
              className="rounded-none border-b border-[var(--color-border-muted)] px-4 py-2.5 text-sm">
              <span className="font-medium text-[var(--color-text-primary)] truncate flex-1">
                {highlightMatch(t.title, query)}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                t.column_id === "done" ? badgeTones("green") :
                t.column_id === "in_progress" ? badgeTones("blue") :
                t.column_id === "review" ? badgeTones("amber") :
                badgeTones("slate")
              }`}>
                {t.column_id}
              </span>
              {t.assigned_to && (
                <span className="text-xs text-[var(--color-text-muted)] shrink-0">{t.assigned_to}</span>
              )}
            </ListboxOption>
          ))}
          {!loading && !query.trim() && (
            <div className="px-4 py-3 text-sm text-[var(--color-text-muted)]">Start typing to search tasks...</div>
          )}
        </Listbox>
      </div>
    </div>
  );
}
