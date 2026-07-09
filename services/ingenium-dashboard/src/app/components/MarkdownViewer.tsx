"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import hljs from "highlight.js/lib/common";

type MarkdownViewerProps = {
  content: string;
  isMarkdown?: boolean;
  language?: string;
};

function renderSimpleMarkdown(text: string): string {
  // Escape HTML to prevent XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (fenced with ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const langClass = lang ? `language-${lang.toLowerCase()}` : "";
    return `<pre class="bg-gray-100 border p-3 rounded overflow-x-auto text-sm font-mono"><code class="${langClass}">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 rounded text-sm font-mono">$1</code>');

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
  html = html.replace(/^---$/gm, '<hr class="my-4 border-gray-300" />');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 underline">$1</a>');

  // Line breaks
  html = html.replace(/\n\n/g, '</p><p class="mb-2">');
  html = html.replace(/\n/g, '<br />');

  // Wrap in paragraphs if not already wrapped
  if (!html.startsWith("<")) {
    html = '<p class="mb-2">' + html + "</p>";
  }

  return html;
}

export default function MarkdownViewer({ content, isMarkdown = true, language }: MarkdownViewerProps) {
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLElement>(null);

  const renderedHtml = useMemo(() => {
    if (!isMarkdown) return "";
    return renderSimpleMarkdown(content);
  }, [content, isMarkdown]);

  // Apply syntax highlighting to code blocks in Preview mode
  useEffect(() => {
    if (containerRef.current && isMarkdown && viewMode === "preview") {
      containerRef.current.querySelectorAll("pre code").forEach((block) => {
        try { hljs.highlightElement(block as HTMLElement); } catch {}
      });
    }
  }, [renderedHtml, isMarkdown, viewMode]);

  // Apply syntax highlighting to entire Source view
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
        <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
          <button
            onClick={() => setViewMode("preview")}
            className={`px-3 py-1 text-sm rounded ${
              viewMode === "preview"
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Preview
          </button>
          <button
            onClick={() => setViewMode("source")}
            className={`px-3 py-1 text-sm rounded ${
              viewMode === "source"
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Source
          </button>
        </div>
      )}

      {/* Non-markdown indicator */}
      {!isMarkdown && (
        <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
          <span className="px-3 py-1 text-sm rounded bg-gray-200 text-gray-400 cursor-not-allowed">
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
          className="prose prose-sm max-w-none text-gray-800 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <pre className="bg-gray-50 border p-4 rounded overflow-x-auto text-sm font-mono whitespace-pre-wrap">
          <code ref={sourceRef} className={langClass ? `language-${langClass}` : ""}>
            {content}
          </code>
        </pre>
      )}
    </div>
  );
}
