"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { badgeTones, BADGE_BASE } from "@/lib/badgeTones";
import type { DocTag } from "@/lib/docs-types";

type TagsManagerProps = {
  pageId: number;
};

/** Cycle through badge hues for visual variety. */
const TAG_HUES = [
  "purple", "blue", "green", "amber", "red", "teal",
  "indigo", "pink", "orange", "cyan",
];

function tagHue(idx: number): string {
  return TAG_HUES[idx % TAG_HUES.length]!;
}

export default function TagsManager({ pageId }: TagsManagerProps) {
  const [tags, setTags] = useState<DocTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchTags = useCallback(async () => {
    try {
      setLoading(true);
      const [tagsRes, allRes] = await Promise.all([
        api.docs.tags.list(pageId),
        api.docs.tags.allUnique(),
      ]);
      setTags(tagsRes?.data ?? []);
      setAllTags(allRes?.data ?? []);
    } catch {
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Filter suggestions
  useEffect(() => {
    if (!inputValue.trim()) {
      setSuggestions([]);
      setActiveSuggestion(0);
      return;
    }
    const existing = new Set(tags.map((t) => t.name.toLowerCase()));
    const filtered = allTags.filter(
      (t) =>
        t.toLowerCase().includes(inputValue.toLowerCase()) &&
        !existing.has(t.toLowerCase()),
    );
    setSuggestions(filtered.slice(0, 5));
    setActiveSuggestion(0);
  }, [inputValue, allTags, tags]);

  const handleAddTag = async (tagName: string) => {
    const name = tagName.trim();
    if (!name) return;
    // Prevent duplicates
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      setInputValue("");
      return;
    }
    try {
      const res = await api.docs.tags.add(pageId, name);
      if (res?.data) {
        setTags((prev) => [...prev, res.data]);
      }
      setInputValue("");
      setSuggestions([]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to add tag");
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    try {
      await api.docs.tags.remove(pageId, tagId);
      setTags((prev) => prev.filter((t) => t.id !== tagId));
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove tag");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length > 0 && activeSuggestion >= 0) {
        handleAddTag(suggestions[activeSuggestion]!);
      } else {
        handleAddTag(inputValue);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setSuggestions([]);
      inputRef.current?.blur();
    }
  };

  // Loading
  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="animate-pulse flex gap-1.5 flex-wrap">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 w-16 bg-[var(--color-surface-muted)] rounded-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tags.length === 0 && !loading && (
          <p className="text-sm text-[var(--color-text-muted)]">
            No tags. Add tags to organize your pages.
          </p>
        )}
        {tags.map((tag, idx) => (
          <span
            key={tag.id}
            className={`${BADGE_BASE} ${badgeTones(tagHue(idx))} inline-flex items-center gap-1`}
          >
            {tag.name}
            <button
              className="hover:opacity-70 leading-none"
              onClick={() => handleRemoveTag(tag.id)}
              aria-label={`Remove tag ${tag.name}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* Add tag input with autocomplete */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] px-2.5 py-1.5 placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Add tag..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-lg z-10 max-h-36 overflow-y-auto">
            {suggestions.map((s, idx) => (
              <button
                key={s}
                className={`w-full text-left px-3 py-1.5 text-sm ${
                  idx === activeSuggestion
                    ? "bg-[var(--color-surface-selected)] text-[var(--color-text-link)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                }`}
                onMouseEnter={() => setActiveSuggestion(idx)}
                onClick={() => handleAddTag(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
