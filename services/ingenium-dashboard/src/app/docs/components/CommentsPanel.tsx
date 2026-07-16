"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { DocComment } from "@/lib/docs-types";

type CommentsPanelProps = {
  pageId: number;
  /** Full page content — used to contextualize selection-anchored comments */
  pageContent: string;
};

/** Relative time formatting for comment timestamps (not exported — internal helper). */
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const AUTHOR_COLORS = [
  "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-orange-500",
  "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-red-500",
];

function authorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length]!;
}

/**
 * CommentsPanel — sidebar thread view with selection-anchored comments.
 * Listens for `docs-selection` CustomEvent dispatched by the editor when
 * text is selected, allowing users to attach comments to a specific snippet.
 * Supports threaded replies and resolve-tracking.
 */
export default function CommentsPanel({ pageId, pageContent }: CommentsPanelProps) {
  const [comments, setComments] = useState<DocComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [selectionText, setSelectionText] = useState("");
  const [selectionOffset, setSelectionOffset] = useState<number | null>(null);
  const [error, setError] = useState("");

  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.docs.comments.list(pageId);
      setComments(res?.data ?? []);
    } catch {
      // API may not be available yet — show empty
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  /**
   * Listen for `docs-selection` CustomEvent dispatched by DocsEditor when
   * the user highlights text. This populates the `selectionText` badge in the
   * comment input, indicating the new comment will be anchored to that range.
   * WARNING: Using window event bus — fragile if multiple editors exist on the same page. */
  useEffect(() => {
    const handler = (e: CustomEvent<{ text: string; offset: number }>) => {
      setSelectionText(e.detail.text);
      setSelectionOffset(e.detail.offset);
    };
    window.addEventListener("docs-selection", handler as EventListener);
    return () => window.removeEventListener("docs-selection", handler as EventListener);
  }, []);

  const handleAddComment = async () => {
    const text = (newComment || "").trim();
    if (!text) return;
    try {
      const res = await api.docs.comments.create(
        pageId,
        text,
        undefined,
        selectionText || undefined,
        selectionOffset ?? undefined,
      );
      if (res?.data) {
        setComments((prev) => [res.data, ...prev]);
      }
      setNewComment("");
      setSelectionText("");
      setSelectionOffset(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to add comment");
    }
  };

  const handleReply = async (parentId: number) => {
    const text = replyText.trim();
    if (!text) return;
    try {
      const res = await api.docs.comments.create(pageId, text, parentId);
      if (res?.data) {
        setComments((prev) => [res.data, ...prev]);
      }
      setReplyText("");
      setReplyTo(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to reply");
    }
  };

  const handleResolve = async (commentId: number) => {
    try {
      const res = await api.docs.comments.resolve(pageId, commentId);
      if (res?.data) {
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, resolved: true } : c)),
        );
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to resolve comment");
    }
  };

  const rootComments = comments.filter((c) => !c.parentCommentId);
  const visibleRoots = showResolved
    ? rootComments
    : rootComments.filter((c) => !c.resolved);
  const resolvedCount = rootComments.filter((c) => c.resolved).length;

  const childComments = (parentId: number) =>
    comments.filter((c) => c.parentCommentId === parentId);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse space-y-2">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--color-surface-muted)] shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-[var(--color-surface-muted)] rounded w-1/4" />
                <div className="h-3 bg-[var(--color-surface-muted)] rounded w-3/4" />
                <div className="h-3 bg-[var(--color-surface-muted)] rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Comments
        </h3>
      </div>

      {/* Comment input */}
      <div className="p-3 border-b border-[var(--color-border)]">
        {selectionText && (
          <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-[var(--color-surface-selected)] rounded text-xs text-[var(--color-text-link)]">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <span className="truncate">&ldquo;{selectionText.slice(0, 80)}{selectionText.length > 80 ? "…" : ""}&rdquo;</span>
            <button
              className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              onClick={() => { setSelectionText(""); setSelectionOffset(null); }}
              aria-label="Clear selection"
            >
              ×
            </button>
          </div>
        )}
        <textarea
          className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] px-3 py-2 resize-none placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-blue-500"
          rows={2}
          placeholder="Add a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleAddComment();
            }
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-[var(--color-text-muted)]">
            {selectionText ? "Commenting on selection" : "Ctrl+Enter to send"}
          </span>
          <button
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!newComment.trim()}
            onClick={handleAddComment}
          >
            Add
          </button>
        </div>
        {error && (
          <p className="mt-1 text-xs text-red-600">{error}</p>
        )}
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto">
        {visibleRoots.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <svg className="w-10 h-10 text-[var(--color-text-muted)] mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm text-[var(--color-text-muted)]">
              No comments yet. Select text and add a comment.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border-muted)]">
            {visibleRoots.map((comment) => {
              const children = childComments(comment.id);
              return (
                <div key={comment.id} className="p-3">
                  {/* Comment header */}
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${authorColor("User")}`}
                    >
                      {"U"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--color-text-primary)]">
                          {"User"}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {timeAgo(comment.createdAt)}
                        </span>
                        {comment.selectionText && (
                          <span className="text-xs text-[var(--color-text-link)]" title="Linked to selection">
                            <svg className="w-3.5 h-3.5 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </span>
                        )}
                      </div>

                      {/* Comment body */}
                      <p
                        className={`text-sm mt-0.5 ${
                          comment.resolved
                            ? "text-[var(--color-text-muted)] line-through"
                            : "text-[var(--color-text-secondary)]"
                        }`}
                      >
                        {comment.content}
                      </p>

                      {/* Comment actions */}
                      <div className="flex items-center gap-3 mt-1.5">
                        <button
                          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-link)]"
                          onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                        >
                          Reply
                        </button>
                        {!comment.resolved && (
                          <button
                            className="text-xs text-[var(--color-text-muted)] hover:text-green-600"
                            onClick={() => handleResolve(comment.id)}
                          >
                            Resolve
                          </button>
                        )}
                      </div>

                      {/* Reply input */}
                      {replyTo === comment.id && (
                        <div className="mt-2">
                          <textarea
                            className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] px-2 py-1.5 resize-none placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                            rows={2}
                            placeholder="Write a reply..."
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                          />
                          <div className="flex gap-2 mt-1.5">
                            <button
                              className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                              disabled={!replyText.trim()}
                              onClick={() => handleReply(comment.id)}
                            >
                              Reply
                            </button>
                            <button
                              className="px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                              onClick={() => { setReplyTo(null); setReplyText(""); }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Child comments (replies) */}
                      {children.length > 0 && (
                        <div className="mt-2 pl-4 border-l-2 border-[var(--color-border-muted)] space-y-2">
                          {children.map((child) => (
                            <div key={child.id} className="flex items-start gap-2">
                              <div
                                className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${authorColor("User")}`}
                              >
                                U
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium text-[var(--color-text-primary)]">
                                    User
                                  </span>
                                  <span className="text-[10px] text-[var(--color-text-muted)]">
                                    {timeAgo(child.createdAt)}
                                  </span>
                                </div>
                                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                                  {child.content}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Resolved toggle — only appears when at least one thread is resolved.
          Hides Show button when already showing resolved (toggles back to hide). */}
      {resolvedCount > 0 && (
        <div className="px-3 py-2 border-t border-[var(--color-border)]">
          <button
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-link)]"
            onClick={() => setShowResolved((s) => !s)}
          >
            {showResolved ? "Hide" : `Show ${resolvedCount}`} resolved comment{resolvedCount !== 1 ? "s" : ""}
          </button>
        </div>
      )}
    </div>
  );
}
