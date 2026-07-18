"use client";

import MarkdownDocument from "../../components/MarkdownDocument";

/**
 * ChatMarkdown — renders markdown content for chat messages.
 *
 * Unlike the generic MarkdownViewer, this component has NO Preview/Source
 * toggle. It's intended for inline message rendering only.
 *
 * Delegates Markdown rendering to the shared MarkdownDocument component
 * which provides full GFM support, safe HTML sanitization, and dark mode.
 */
export default function ChatMarkdown({ content }: { content: string }) {
  return <MarkdownDocument content={content} className="text-sm" />;
}
