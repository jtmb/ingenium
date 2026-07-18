"use client";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: false });

/**
 * Render Markdown to safe HTML with custom handling:
 * - [[page-slug]] → internal link placeholder
 * - > **Note:** ... → callout block with colored left border
 *
 * Extracted from DocsEditor to be the canonical Markdown renderer
 * shared across the dashboard.
 */
export function renderMarkdown(content: string): string {
  if (!content) return "";

  // Pre-process: convert [[page-slug]] to internal links
  let processed = content.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, slug) =>
      `<a href="/docs/${slug}" class="internal-link" data-internal="true">${slug}</a>`,
  );

  // Pre-process: convert callout blocks (only when they start a line)
  // Pattern: > **Note:** or > **Warning:** etc.
  processed = processed.replace(
    /^>\s*\*\*(Note|Warning|Info|Tip|Danger|Success):\*\*(.*?)(?:\n> (.*?))*(?=\n\n|\n(?!>)|$)/gm,
    (_match, type: string, ..._rest: string[]) => {
      const fullMatch = _match;
      const contentWithoutCallout = fullMatch
        .replace(/^>\s*\*\*(Note|Warning|Info|Tip|Danger|Success):\*\*/m, "")
        .replace(/^>\s?/gm, "")
        .trim();
      const typeLower = type.toLowerCase();
      return `<div class="callout callout-${typeLower}">
<strong>${type}:</strong> ${contentWithoutCallout}
</div>`;
    },
  );

  const html = marked.parse(processed, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "hr",
      "pre",
      "code",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "strong",
      "em",
      "del",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "img",
      "div",
      "span",
    ],
    ALLOWED_ATTR: ["href", "target", "data-internal", "class", "src", "alt"],
  });
}

interface MarkdownDocumentProps {
  content: string;
  className?: string;
}

/**
 * Renders sanitized Markdown with full GFM support.
 * Uses prose + dark:prose-invert for typography.
 */
export default function MarkdownDocument({
  content,
  className = "",
}: MarkdownDocumentProps) {
  return (
    <div
      className={`prose prose-sm max-w-none dark:prose-invert text-[var(--color-text-primary)] leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}
