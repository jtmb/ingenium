"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, Task } from "../../../lib/api";

type SpotlightSearchProps = {
  project: string;
  onTaskSelect: (task: Task) => void;
};

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className="bg-yellow-200 text-black rounded">{part}</mark> : part
  );
}

export default function SpotlightSearch({ project, onTaskSelect }: SpotlightSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const openSpotlight = useCallback(() => {
    setIsOpen(true);
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closeSpotlight = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setResults([]);
  }, []);

  // Ctrl+K / Cmd+K listener
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

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.tasks.search(query, project);
        setResults(r.data ?? []);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, project]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      const task = results[selectedIndex]!;
      onTaskSelect(task);
      closeSpotlight();
    } else if (e.key === "Escape") {
      closeSpotlight();
    }
  }, [results, selectedIndex, onTaskSelect, closeSpotlight]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={closeSpotlight} />
      {/* Search pane */}
      <div className="relative w-full max-w-xl bg-[var(--color-surface)] rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center px-4 py-3 border-b border-[var(--color-border)]">
          <svg className="w-5 h-5 text-[var(--color-text-muted)] mr-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks..."
            className="flex-1 text-lg outline-none text-[var(--color-text-primary)] placeholder-gray-400" />
          <kbd className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-muted)] rounded px-1.5 py-0.5 ml-2">Esc</kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {loading && (
            <div className="px-4 py-3 text-sm text-[var(--color-text-muted)]">Searching...</div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-[var(--color-text-muted)]">No tasks found.</div>
          )}
          {!loading && results.map((t, i) => (
            <button key={t.id}
              onClick={() => { onTaskSelect(t); closeSpotlight(); }}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 border-b border-[var(--color-border-muted)] text-sm ${i === selectedIndex ? "bg-[var(--color-surface-selected)]" : "hover:bg-[var(--color-surface-hover)]"}`}>
              <span className="font-medium text-[var(--color-text-primary)] truncate flex-1">
                {highlightMatch(t.title, query)}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                t.column_id === "done" ? "bg-green-100 text-green-700" :
                t.column_id === "in_progress" ? "bg-blue-100 text-blue-700" :
                t.column_id === "review" ? "bg-amber-100 text-amber-700" :
                "bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"
              }`}>
                {t.column_id}
              </span>
              {t.assigned_to && (
                <span className="text-xs text-[var(--color-text-muted)] shrink-0">{t.assigned_to}</span>
              )}
            </button>
          ))}
          {!loading && !query.trim() && (
            <div className="px-4 py-3 text-sm text-[var(--color-text-muted)]">Start typing to search tasks...</div>
          )}
        </div>
      </div>
    </div>
  );
}