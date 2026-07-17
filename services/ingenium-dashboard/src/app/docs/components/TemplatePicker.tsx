"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { badgeTones, BADGE_BASE } from "@/lib/badgeTones";
import type { DocTemplate } from "@/lib/docs-types";

type TemplatePickerProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Called when user clicks a template card or "Blank Page" */
  onSelect: (template: DocTemplate) => void;
};

/** Category hue map for template badges — keeps badge colors consistent across sessions. */
const CATEGORY_HUES: Record<string, string> = {
  meeting: "blue",
  project: "green",
  engineering: "purple",
  design: "pink",
  planning: "amber",
  documentation: "teal",
  general: "slate",
};

function categoryHue(cat: string): string {
  return CATEGORY_HUES[cat.toLowerCase()] ?? "slate";
}

/**
 * TemplatePicker — category-grouped template grid with a "Blank Page" entry.
 * Fetches templates from the API on open. Groups by category for easier browsing.
 * Uses createPortal for z-index stacking above the editor overlay.
 */
export default function TemplatePicker({ isOpen, onClose, onSelect }: TemplatePickerProps) {
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    api.docs.templates
      .list()
      .then((res) => setTemplates(res?.data ?? []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  // Group by category
  const grouped = templates.reduce<Record<string, DocTemplate[]>>((acc, t) => {
    const cat = t.category || "General";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  const categories = Object.keys(grouped);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-[var(--color-surface)] rounded-lg shadow-2xl border border-[var(--color-border)] mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Choose a Template
          </h2>
          <button
            className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-full"
            onClick={onClose}
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse p-4 border border-[var(--color-border)] rounded-lg space-y-2">
                  <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/2" />
                  <div className="h-3 bg-[var(--color-surface-muted)] rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Blank page option */}
              <button
                className="w-full text-left p-4 border-2 border-dashed border-[var(--color-border)] rounded-lg hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-selected)] transition-colors mb-6"
                onClick={() => {
                  onSelect({
                    id: 0,
                    name: "Blank Page",
                    description: "Start with an empty page",
                    category: "general",
                    content: "",
                    createdAt: new Date().toISOString(),
                  });
                }}
              >
                <span className="text-sm font-medium text-[var(--color-text-primary)]">
                  + Blank Page
                </span>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Start from scratch with an empty page
                </p>
              </button>

              {/* Templates grouped by category */}
              {categories.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-[var(--color-text-muted)]">
                    No templates available. Create templates to speed up your workflow.
                  </p>
                </div>
              ) : (
                categories.map((cat) => (
                  <div key={cat} className="mb-6 last:mb-0">
                    <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                      {cat}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(grouped[cat] ?? []).map((tpl) => (
                        <button
                          key={tpl.id}
                          className="text-left p-3 border border-[var(--color-border)] rounded-lg hover:shadow-md transition-shadow hover:border-[var(--color-accent)]"
                          onClick={() => onSelect(tpl)}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                              {tpl.name}
                            </span>
                            <span className={`${BADGE_BASE} ${badgeTones(categoryHue(cat))} shrink-0`}>
                              {cat}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">
                            {tpl.description}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--color-border)] shrink-0">
          <button
            className="text-xs text-[var(--color-text-link)] hover:underline"
            onClick={() => alert("Template management coming soon.")}
          >
            Manage templates
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
