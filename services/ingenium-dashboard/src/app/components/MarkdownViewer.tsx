"use client";

import { useState, useEffect, useRef } from "react";
import hljs from "highlight.js/lib/common";
import MarkdownDocument from "./MarkdownDocument";

type MarkdownViewerProps = {
  content: string;
  isMarkdown?: boolean;
  language?: string;
};

/**
 * Markdown content viewer with Preview/Source toggle and syntax highlighting.
 *
 * Preview mode uses `MarkdownDocument` (marked + DOMPurify) for full GFM rendering
 * with dark mode support. Source mode shows the raw content in a monospace
 * pre/code block with highlight.js syntax highlighting.
 *
 * When `isMarkdown` is false, the toggle bar shows Preview as disabled
 * and defaults to Source mode (useful for plain text or code files).
 */
export default function MarkdownViewer({ content, isMarkdown = true, language }: MarkdownViewerProps) {
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLElement>(null);

  // Syntax highlight code blocks in Preview mode after content is rendered
  useEffect(() => {
    if (containerRef.current && isMarkdown && viewMode === "preview") {
      containerRef.current.querySelectorAll("pre code").forEach((block) => {
        try { hljs.highlightElement(block as HTMLElement); } catch {}
      });
    }
  }, [content, isMarkdown, viewMode]);

  // Syntax highlight the entire Source view when switching to Source mode
  useEffect(() => {
    if (sourceRef.current && viewMode === "source") {
      try { hljs.highlightElement(sourceRef.current); } catch {}
    }
  }, [content, isMarkdown, viewMode, language]);

  // Derive language class from extension
  const langClass = language ? language.replace(".", "") : "";

  return (
    <div className="space-y-4">
      {/* Toggle bar */}
      {isMarkdown && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2">
          <button
            onClick={() => setViewMode("preview")}
            className={`px-3 py-1 text-sm rounded ${
              viewMode === "preview"
                ? "bg-blue-600 text-white"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            Preview
          </button>
          <button
            onClick={() => setViewMode("source")}
            className={`px-3 py-1 text-sm rounded ${
              viewMode === "source"
                ? "bg-blue-600 text-white"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            Source
          </button>
        </div>
      )}

      {/* Non-markdown indicator */}
      {!isMarkdown && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2">
          <span className="px-3 py-1 text-sm rounded bg-gray-200 text-[var(--color-text-muted)] cursor-not-allowed">
            Preview
          </span>
          <span className="px-3 py-1 text-sm rounded bg-blue-600 text-white">
            Source
          </span>
        </div>
      )}

      {/* Content */}
      {isMarkdown && viewMode === "preview" ? (
        <div ref={containerRef}>
          <MarkdownDocument content={content} />
        </div>
      ) : (
        <pre className="bg-[var(--color-surface-muted)] border p-4 rounded overflow-x-auto text-sm font-mono whitespace-pre-wrap">
          <code ref={sourceRef} className={langClass ? `language-${langClass}` : ""}>
            {content}
          </code>
        </pre>
      )}
    </div>
  );
}
