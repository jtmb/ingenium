"use client";

import { renderMarkdown } from "../../components/MarkdownDocument";

/**
 * ChatMarkdown — renders markdown content for chat messages.
 *
 * Unlike the generic MarkdownViewer, this component has NO Preview/Source
 * toggle. It's intended for inline message rendering only.
 *
 * Uses the shared Markdown renderer for full GFM support and safe HTML
 * sanitization, while keeping the chat-specific typography classes local.
 */
export default function ChatMarkdown({ content }: { content: string }) {
  return (
    <div
      className="prose prose-sm max-w-none dark:prose-invert text-[var(--color-text-primary)] leading-relaxed chat-markdown text-sm"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}
