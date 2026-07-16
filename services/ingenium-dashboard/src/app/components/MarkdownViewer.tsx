"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";

/**
 * DOMPurify configuration for rendered markdown.
 *
 * - `ALLOW_DATA_ATTR: false` — strips `data-*` attributes to prevent XSS via
 *   dataset-based event handlers or custom element exploits
 * - Uses `satisfies` for compile-time type checking of the DOMPurify config shape
 *
 * The tag/attribute allowlist is deliberately restrictive: only safe inline
 * elements and structural tags are permitted. No `style`, `on*`, or `form` tags.
 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "strong", "em", "u", "s",
    "a",
    "ul", "ol", "li",
    "code", "pre",
    "blockquote",
    "table", "thead", "tbody", "tr", "th", "td",
    "img",
    "span",
  ],
  ALLOWED_ATTR: [
    "href", "target", "rel",
    "src", "alt",
    "class",
  ],
  ALLOW_DATA_ATTR: false,
} satisfies DOMPurify.Config;

type MarkdownViewerProps = {
  content: string;
  isMarkdown?: boolean;
  language?: string;
};

/**
 * Render a restricted subset of Markdown to HTML.
 *
 * This is NOT a full CommonMark parser — it handles the subset needed for
 * skills and observations: headings, bold/italic, code blocks, inline code,
 * unordered lists, links, and horizontal rules. Built-in markdown libraries
 * (marked, remark) were avoided to keep the bundle size small and to avoid
 * the overhead of a full parser pipeline for this constrained use case.
 *
 * ⚠️ Order of regex operations matters:
 *   1. HTML-escape first (prevent XSS from raw HTML in input)
 *   2. Code blocks (fenced ```) — must be processed before inline code
 *   3. Inline code — must be processed before bold/italic (to avoid matching `*` inside backticks)
 *   4. Headings — processed before bold/italic (##bold is not a heading)
 *   5. Bold/italic
 *   6. Lists, HR, links, line breaks
 */
function renderSimpleMarkdown(text: string): string {
  // Escape HTML first to neutralise any raw tags — this is the primary XSS defence
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (fenced with ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const langClass = lang ? `language-${lang.toLowerCase()}` : "";
    return `<pre class="bg-[var(--color-surface-muted)] border p-3 rounded overflow-x-auto text-sm font-mono"><code class="${langClass}">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-[var(--color-surface-muted)] px-1 rounded text-sm font-mono">$1</code>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-6 mb-3">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-3">$1</h1>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="my-4 border-[var(--color-border)]" />');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-[var(--color-text-link)] underline">$1</a>');

  // Line breaks
  html = html.replace(/\n\n/g, '</p><p class="mb-2">');
  html = html.replace(/\n/g, '<br />');

  // Wrap in paragraphs if not already wrapped
  if (!html.startsWith("<")) {
    html = '<p class="mb-2">' + html + "</p>";
  }

  return html;
}

/**
 * Markdown content viewer with Preview/Source toggle and syntax highlighting.
 *
 * Preview mode renders a restricted subset of Markdown to HTML via
 * `renderSimpleMarkdown`, sanitises it through DOMPurify, and applies
 * highlight.js for code block syntax highlighting. Source mode shows
 * the raw content in a monospace pre/code block with single-element
 * highlighting.
 *
 * When `isMarkdown` is false, the toggle bar shows Preview as disabled
 * and defaults to Source mode (useful for plain text or code files).
 */
export default function MarkdownViewer({ content, isMarkdown = true, language }: MarkdownViewerProps) {
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLElement>(null);

  const renderedHtml = useMemo(() => {
    if (!isMarkdown) return "";
    const rawHtml = renderSimpleMarkdown(content);
    // Sanitize HTML via DOMPurify — strips javascript: URLs, event handlers, etc.
    const clean = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
    // Belt-and-suspenders: DOMPurify removes most javascript: URLs, but we
    // post-process all <a> tags to add rel="noopener noreferrer" and convert
    // any remaining javascript: hrefs to "#" (defence in depth).
    return clean.replace(
      /<a\s+[^>]*href="([^"]*)"([^>]*)>/gi,
      (_m, href, rest) => {
        const safe = /^javascript:/i.test(href) ? "#" : href;
        return `<a href="${safe}"${rest} rel="noopener noreferrer">`;
      },
    );
  }, [content, isMarkdown]);

  // Syntax highlight code blocks in Preview mode after content is rendered
  useEffect(() => {
    if (containerRef.current && isMarkdown && viewMode === "preview") {
      containerRef.current.querySelectorAll("pre code").forEach((block) => {
        try { hljs.highlightElement(block as HTMLElement); } catch {}
      });
    }
  }, [renderedHtml, isMarkdown, viewMode]);

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
        <div
          ref={containerRef}
          className="prose prose-sm max-w-none text-[var(--color-text-primary)] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
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
