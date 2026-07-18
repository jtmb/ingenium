"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import DocsShell from "./components/DocsShell";
import PageTree, { collectDescendantIds } from "./components/PageTree";
import DocsEditor from "./components/DocsEditor";
import SearchDialog from "./components/SearchDialog";
import TemplatePicker from "./components/TemplatePicker";
import ImportExportDialog from "./components/ImportExportDialog";
import TagsManager from "./components/TagsManager";
import BacklinksPanel from "./components/BacklinksPanel";
import CommentsPanel from "./components/CommentsPanel";
import HistoryPanel from "./components/HistoryPanel";
import TrashPanel from "./components/TrashPanel";
import { api, type DocSpace, type DocPage } from "@/lib/api";
import type { DocProjectLink, DocAttachment, DocPageTree } from "@/lib/docs-types";

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function IconFile() {
  return (
    <svg className="w-16 h-16 mx-auto text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function IconCloseSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5v3.5M8 11v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Right sidebar tabs
// ---------------------------------------------------------------------------

type SidebarTab = "metadata" | "tags" | "backlinks" | "comments" | "history" | "projects" | "attachments" | "trash" | "ask";

const SIDEBAR_TABS: { key: SidebarTab; label: string; pageScoped: boolean }[] = [
  { key: "metadata", label: "Info", pageScoped: true },
  { key: "tags", label: "Tags", pageScoped: true },
  { key: "projects", label: "Linked", pageScoped: true },
  { key: "attachments", label: "Files", pageScoped: true },
  { key: "backlinks", label: "Backlinks", pageScoped: true },
  { key: "comments", label: "Comments", pageScoped: true },
  { key: "history", label: "History", pageScoped: true },
  { key: "ask", label: "Ask Docs", pageScoped: false },
  { key: "trash", label: "Trash", pageScoped: false },
];

function RightSidebar({
  page,
  selectedTab,
  onSelectTab,
  selectedSpaceId,
  onPageMutated,
}: {
  page: DocPage | null;
  selectedTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  selectedSpaceId: number | null;
  onPageMutated: () => void;
}) {
  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-[var(--color-border)] shrink-0 overflow-x-auto" role="tablist" aria-label="Page details">
        {SIDEBAR_TABS.map((tab) => {
          // Skip page-scoped tabs when no page is selected (except trash, which is space-level)
          const disabled = tab.pageScoped && !page;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => !disabled && onSelectTab(tab.key)}
              disabled={disabled}
              role="tab"
              aria-selected={selectedTab === tab.key}
              className={`
                flex-1 py-2 text-xs font-medium transition-colors whitespace-nowrap px-2
                ${selectedTab === tab.key
                  ? "text-[var(--color-text-link)] border-b-2 border-[var(--color-text-link)]"
                  : disabled
                    ? "text-[var(--color-text-muted)] opacity-40 cursor-not-allowed border-b-2 border-transparent"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border-b-2 border-transparent"
                }
              `}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {selectedTab === "metadata" && <MetadataTab page={page} />}
        {selectedTab === "tags" && page && <TagsManager pageId={page.id} />}
        {selectedTab === "backlinks" && page && <BacklinksPanel pageId={page.id} />}
        {selectedTab === "comments" && page && <CommentsPanel pageId={page.id} pageContent={page.content} />}
        {selectedTab === "history" && page && <HistoryPanel pageId={page.id} onRestore={() => onPageMutated()} />}
        {selectedTab === "projects" && page && <ProjectLinksTab pageId={page.id} />}
        {selectedTab === "attachments" && page && <AttachmentsTab pageId={page.id} />}
        {selectedTab === "ask" && <AskDocsPanel />}
        {selectedTab === "trash" && selectedSpaceId && <TrashPanel spaceId={selectedSpaceId} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab content components
// ---------------------------------------------------------------------------

function MetadataTab({ page }: { page: DocPage | null }) {
  if (!page) {
    return (
      <div className="flex items-center justify-center h-full py-8">
        <p className="text-sm text-[var(--color-text-muted)]">Select a page to view details</p>
      </div>
    );
  }
  return (
    <div className="p-3 space-y-4">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Title
        </label>
        <p className="text-sm text-[var(--color-text-primary)]">{page.title}</p>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Slug
        </label>
        <p className="text-sm text-[var(--color-text-secondary)] font-mono break-all">{page.slug}</p>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Status
        </label>
        <span
          className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
            page.status === "published"
              ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300"
              : page.status === "archived"
                ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
          }`}
        >
          {page.status}
        </span>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Revision
        </label>
        <p className="text-sm text-[var(--color-text-secondary)]">{page.revision}</p>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Parent
        </label>
        <p className="text-sm text-[var(--color-text-secondary)]">{page.parentPageId ? `Page #${page.parentPageId}` : "None (root)"}</p>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Sort Order
        </label>
        <p className="text-sm text-[var(--color-text-secondary)]">{page.sortOrder}</p>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Created
        </label>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {new Date(page.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Updated
        </label>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {new Date(page.updatedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
    </div>
  );
}

function ProjectLinksTab({ pageId }: { pageId: number }) {
  const [links, setLinks] = useState<DocProjectLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [linking, setLinking] = useState(false);

  const fetchLinks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.docs.projectLinks.list(pageId);
      setLinks(res?.data ?? []);
    } catch {
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const handleLink = async () => {
    const projectId = linkInput.trim();
    if (!projectId) return;
    setLinking(true);
    setError("");
    try {
      const res = await api.docs.projectLinks.link(pageId, projectId);
      if (res?.data) {
        setLinks((prev) => [...prev, res.data]);
        setLinkInput("");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to link project");
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async (linkedProjectId: string) => {
    try {
      await api.docs.projectLinks.unlink(pageId, linkedProjectId);
      setLinks((prev) => prev.filter((l) => l.projectId !== linkedProjectId));
    } catch (e: any) {
      setError(e?.message ?? "Failed to unlink project");
    }
  };

  if (loading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="animate-pulse h-8 bg-[var(--color-surface-hover)] rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {/* Add link */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          placeholder="Project ID…"
          className="flex-1 border border-[var(--color-border)] rounded text-xs bg-[var(--color-surface)] text-[var(--color-text-primary)] px-2 py-1.5 placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          onKeyDown={(e) => { if (e.key === "Enter") handleLink(); }}
        />
        <button
          type="button"
          onClick={handleLink}
          disabled={linking || !linkInput.trim()}
          className="px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 shrink-0"
        >
          {linking ? "…" : "Link"}
        </button>
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Links list */}
      {links.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] text-center py-4">No linked projects</p>
      ) : (
        <div className="space-y-1">
          {links.map((link) => (
            <div key={link.projectId} className="flex items-center justify-between px-2 py-1.5 bg-[var(--color-surface-muted)] rounded text-xs">
              <span className="text-[var(--color-text-primary)] font-mono">{link.projectId}</span>
              {link.projectName && (
                <span className="text-[var(--color-text-muted)] ml-1 truncate">({link.projectName})</span>
              )}
              <button
                type="button"
                onClick={() => handleUnlink(link.projectId)}
                className="ml-auto text-[var(--color-text-muted)] hover:text-red-600 p-0.5"
                title="Unlink project"
                aria-label={`Unlink project ${link.projectId}`}
              >
                <IconCloseSmall />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentsTab({ pageId }: { pageId: number }) {
  const [attachments, setAttachments] = useState<DocAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAttachments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.docs.attachments.list(pageId);
      setAttachments(res?.data ?? []);
    } catch {
      setAttachments([]);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.docs.attachments.upload(pageId, fd);
      if (res?.data) {
        setAttachments((prev) => [...prev, res.data]);
      }
    } catch {
      // silently fail
    } finally {
      setUploading(false);
      // Reset input so the same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (attId: number) => {
    try {
      await api.docs.attachments.delete(pageId, attId);
      setAttachments((prev) => prev.filter((a) => a.id !== attId));
    } catch {
      // silently fail
    }
  };

  if (loading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="animate-pulse h-8 bg-[var(--color-surface-hover)] rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {/* Upload */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleUpload}
        className="hidden"
        aria-label="Upload attachment"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="w-full px-3 py-2 text-xs border border-dashed border-[var(--color-border)] rounded hover:border-[var(--color-accent)] text-[var(--color-text-muted)] hover:text-[var(--color-text-link)] transition-colors disabled:opacity-50"
      >
        {uploading ? "Uploading…" : "+ Upload file"}
      </button>

      {/* List */}
      {attachments.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] text-center py-4">No attachments</p>
      ) : (
        <div className="space-y-1">
          {attachments.map((att) => (
            <div key={att.id} className="flex items-center justify-between px-2 py-1.5 bg-[var(--color-surface-muted)] rounded text-xs">
              <span className="text-[var(--color-text-primary)] truncate flex-1">{att.originalName}</span>
              <span className="text-[var(--color-text-muted)] ml-1 shrink-0">{formatBytes(att.sizeBytes)}</span>
              <a
                href={api.docs.attachments.downloadUrl(pageId, att.id)}
                className="ml-2 text-[var(--color-text-link)] hover:underline shrink-0"
                title="Download"
              >
                ↓
              </a>
              <button
                type="button"
                onClick={() => handleDelete(att.id)}
                className="ml-1 text-[var(--color-text-muted)] hover:text-red-600 p-0.5 shrink-0"
                title="Delete attachment"
                aria-label={`Delete ${att.originalName}`}
              >
                <IconCloseSmall />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ask Docs panel (RAG)
// ---------------------------------------------------------------------------

interface RagCitation {
  id: string;
  title: string;
  score: number;
}

interface RagAnswer {
  answer: string;
  citations: RagCitation[];
}

function AskDocsPanel() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<RagAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      await api.rag.ingest();
      const res = await api.rag.ask(q);
      setResult(res?.data ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to get answer");
    } finally {
      setLoading(false);
    }
  }, [question]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleAsk();
      }
    },
    [handleAsk],
  );

  // Render answer with citation markers
  const renderAnswer = useCallback((text: string) => {
    // Replace [N] citation markers with superscript links
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const cap = match[1]!;
        const idx = parseInt(cap, 10);
        const citation = result?.citations?.[idx - 1];
        return (
          <sup key={i} className="text-xs text-blue-600 dark:text-blue-400 font-semibold">
            <span title={citation?.title}>{`[${idx}]`}</span>
          </sup>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }, [result]);

  return (
    <div className="p-3 space-y-3">
      {/* Input area */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your documentation…"
          className="flex-1 border border-[var(--color-border)] rounded text-xs bg-[var(--color-surface)] text-[var(--color-text-primary)] px-2 py-1.5 placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          disabled={loading}
        />
        <button
          type="button"
          onClick={handleAsk}
          disabled={loading || !question.trim()}
          className="px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 shrink-0"
        >
          {loading ? (
            <span className="flex items-center gap-1">
              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Asking…
            </span>
          ) : (
            "Ask"
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-2 text-xs text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-400 rounded">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M7 4.5v3M7 10v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !result && (
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[var(--color-text-muted)]">
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-sm text-[var(--color-text-muted)]">
            Ask a question about your documentation
          </p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-[var(--color-surface-hover)] rounded w-full" />
          <div className="h-3 bg-[var(--color-surface-hover)] rounded w-5/6" />
          <div className="h-3 bg-[var(--color-surface-hover)] rounded w-4/6" />
          <div className="h-3 bg-[var(--color-surface-hover)] rounded w-3/4" />
        </div>
      )}

      {/* Answer */}
      {result && (
        <div className="space-y-3">
          <div className="text-xs text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap break-words">
            {renderAnswer(result.answer)}
          </div>

          {/* Sources list */}
          {result.citations.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
                Sources ({result.citations.length})
              </p>
              <div className="space-y-1">
                {result.citations.map((cite, idx) => (
                  <div
                    key={cite.id}
                    className="block px-2 py-1.5 bg-[var(--color-surface-muted)] rounded text-xs text-[var(--color-text-secondary)] truncate"
                  >
                    <span className="font-semibold text-[var(--color-text-muted)] mr-1">[{idx + 1}]</span>
                    {cite.title}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// Welcome / error / loading screens
// ---------------------------------------------------------------------------

function WelcomeScreen() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-4 max-w-sm">
        <IconFile />
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
          Welcome to Docs
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Select a page from the tree or create a new one to get started.
        </p>
      </div>
    </div>
  );
}

function PageLoadingSkeleton() {
  return (
    <div className="p-8 space-y-4 animate-pulse">
      <div className="h-8 bg-[var(--color-surface-hover)] rounded w-2/3" />
      <div className="space-y-2">
        <div className="h-4 bg-[var(--color-surface-hover)] rounded w-full" />
        <div className="h-4 bg-[var(--color-surface-hover)] rounded w-5/6" />
        <div className="h-4 bg-[var(--color-surface-hover)] rounded w-4/6" />
        <div className="h-4 bg-[var(--color-surface-hover)] rounded w-3/4" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create page dialog
// ---------------------------------------------------------------------------

function CreatePageDialog({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (title: string, parentPageId?: number) => void;
}) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (trimmed) {
      onCreate(trimmed);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
        <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-lg shadow-2xl border border-[var(--color-border)] mx-4 p-5" role="dialog" aria-modal="true" aria-label="Create new page">
          <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">Create New Page</h3>
          <label htmlFor="new-page-title" className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
            Page title
          </label>
          <input
            id="new-page-title"
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") onClose();
            }}
            className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] px-3 py-2 placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-text-link)]"
            placeholder="e.g. Getting Started"
          />
          <div className="flex gap-2 mt-4 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded hover:bg-[var(--color-surface-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!title.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Move page dialog
// ---------------------------------------------------------------------------

function MovePageDialog({
  isOpen,
  onClose,
  pages,
  disabledIds,
  onMove,
  currentTitle,
}: {
  isOpen: boolean;
  onClose: () => void;
  pages: DocPageTree[];
  disabledIds: Set<number>;
  onMove: (newParentId: number | undefined) => void;
  currentTitle: string;
}) {
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);

  const flattened = useMemo(() => {
    const result: { id: number; title: string; depth: number; disabled: boolean }[] = [];
    function walk(nodes: DocPageTree[], depth: number) {
      for (const n of nodes) {
        result.push({ id: n.id, title: n.title, depth, disabled: disabledIds.has(n.id) });
        if (n.children) walk(n.children, depth + 1);
      }
    }
    walk(pages, 0);
    return result;
  }, [pages, disabledIds]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
        <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-lg shadow-2xl border border-[var(--color-border)] mx-4 p-5" role="dialog" aria-modal="true" aria-label="Move page">
          <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
            Move &ldquo;{currentTitle}&rdquo;
          </h3>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">Select a new parent (or root):</p>
          <div className="max-h-64 overflow-y-auto border border-[var(--color-border)] rounded mb-3">
            {/* Root option */}
            <button
              type="button"
              onClick={() => setSelectedId(undefined)}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                selectedId === undefined
                  ? "bg-[var(--color-surface-selected)] text-[var(--color-text-link)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              }`}
            >
              (root — no parent)
            </button>
            {flattened.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { if (!item.disabled) setSelectedId(item.id); }}
                disabled={item.disabled}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                  item.disabled
                    ? "opacity-30 cursor-not-allowed text-[var(--color-text-muted)] italic"
                    : selectedId === item.id
                      ? "bg-[var(--color-surface-selected)] text-[var(--color-text-link)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                }`}
                style={{ paddingLeft: `${item.depth * 16 + 12}px` }}
              >
                {item.title}
                {item.disabled && " (self/child)"}
              </button>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded hover:bg-[var(--color-surface-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { onMove(selectedId); onClose(); }}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Move
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// DocsContent — main orchestrator
// ---------------------------------------------------------------------------

function DocsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const spaceIdParam = searchParams.get("space");
  const pageIdParam = searchParams.get("page");

  const selectedSpaceId = spaceIdParam ? Number(spaceIdParam) : null;
  const selectedPageId = pageIdParam ? Number(pageIdParam) : null;

  // ---- Data state ----
  const [spaces, setSpaces] = useState<DocSpace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [spacesError, setSpacesError] = useState<string | null>(null);

  const [page, setPage] = useState<DocPage | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // ---- UI state ----
  const [mode, setMode] = useState<"view" | "edit" | "source" | "split">("view");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("metadata");
  const [sidebarVisible, setSidebarVisible] = useState(true);

  /** Incremented to force PageTree re-fetch after mutations. */
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);

  // ---- Dialog state ----
  const [searchOpen, setSearchOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTargetPageId, setMoveTargetPageId] = useState<number | null>(null);

  // ---- Inline action state ----
  const [actionToast, setActionToast] = useState<string | null>(null);
  /** Currently being renamed: {pageId, currentTitle} */
  const [renameState, setRenameState] = useState<{ pageId: number; title: string } | null>(null);

  // ---- Tree data ref (for move dialog) ----
  const treePagesRef = useRef<DocPageTree[]>([]);

  const showToast = useCallback((msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 3000);
  }, []);

  // ---- Fetch spaces ----
  useEffect(() => {
    let cancelled = false;
    api.docs.spaces
      .list()
      .then(({ data }) => {
        if (cancelled) return;
        setSpaces(data ?? []);
        if (data && data.length > 0 && data[0] && !selectedSpaceId) {
          const params = new URLSearchParams(searchParams.toString());
          params.set("space", String(data[0].id));
          router.replace(`/docs?${params.toString()}`, { scroll: false });
        }
      })
      .catch((err) => {
        if (!cancelled) setSpacesError(err.message ?? "Failed to load spaces");
      })
      .finally(() => {
        if (!cancelled) setSpacesLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Fetch page when pageId changes ----
  useEffect(() => {
    if (!selectedPageId) {
      setPage(null);
      setPageError(null);
      return;
    }
    let cancelled = false;
    setPageLoading(true);
    setPageError(null);
    api.docs.pages
      .get(selectedPageId)
      .then(({ data }) => {
        if (cancelled) return;
        setPage(data ?? null);
        setPageError(data ? null : "Page not found");
      })
      .catch((err) => {
        if (!cancelled) setPageError(err.message ?? "Failed to load page");
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedPageId]);

  // ---- Navigation helpers ----
  const navigate = useCallback(
    (spaceId: number | null, pageId: number | null) => {
      const params = new URLSearchParams();
      if (spaceId) params.set("space", String(spaceId));
      if (pageId) params.set("page", String(pageId));
      router.push(`/docs?${params.toString()}`, { scroll: false });
    },
    [router],
  );

  const handleSelectSpace = useCallback(
    (spaceId: number) => {
      // Switch sidebar to trash if on trash tab (space-level)
      if (sidebarTab === "trash") {
        navigate(spaceId, null);
      } else {
        navigate(spaceId, null);
      }
    },
    [navigate, sidebarTab],
  );

  const handleSelectPage = useCallback(
    (pageId: number) => {
      navigate(selectedSpaceId, pageId);
    },
    [navigate, selectedSpaceId],
  );

  // ---- Tree mutation signal ----
  const refreshTree = useCallback(() => {
    setTreeRefreshKey((k) => k + 1);
  }, []);

  // ---- Track tree pages ref for move dialog ----
  const handleTreePagesLoaded = useCallback((pages: DocPageTree[]) => {
    treePagesRef.current = pages;
  }, []);

  // ---- Actions ----

  /** Create a new page (called from CreatePageDialog onSubmit). */
  const handleCreatePage = useCallback(async (title: string, parentPageId?: number) => {
    if (!selectedSpaceId) return;
    try {
      const slug = title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now().toString(36);
      const { data } = await api.docs.pages.create(selectedSpaceId, {
        title,
        slug,
        content: "",
        status: "draft",
        parentPageId,
      });
      refreshTree();
      navigate(selectedSpaceId, data.id);
      showToast(`Page "${title}" created`);
    } catch {
      showToast("Failed to create page");
    }
  }, [selectedSpaceId, navigate, refreshTree, showToast]);

  const handleNewPageClick = useCallback(() => {
    setCreateDialogOpen(true);
  }, []);

  /** Publish the current page. */
  const handlePublish = useCallback(async () => {
    if (!page) return;
    try {
      const { data } = await api.docs.pages.publish(page.id, page.revision);
      setPage(data);
      refreshTree();
      showToast("Page published");
    } catch (e: any) {
      showToast(e?.message ?? "Failed to publish");
    }
  }, [page, refreshTree, showToast]);

  /** Archive (soft-delete) a page. */
  const handleArchive = useCallback(async (pageId: number) => {
    try {
      await api.docs.pages.delete(pageId);
      refreshTree();
      // If the archived page was selected, clear selection
      if (selectedPageId === pageId) {
        navigate(selectedSpaceId, null);
      }
      showToast("Page archived (moved to trash)");
    } catch {
      showToast("Failed to archive page");
    }
  }, [selectedSpaceId, selectedPageId, navigate, refreshTree, showToast]);

  /** Move a page to a new parent. */
  const handleMove = useCallback(async (newParentId: number | undefined) => {
    if (!moveTargetPageId) return;
    try {
      await api.docs.pages.move(moveTargetPageId, newParentId);
      setMoveTargetPageId(null);
      refreshTree();
      showToast("Page moved");
    } catch {
      showToast("Failed to move page");
    }
  }, [moveTargetPageId, refreshTree, showToast]);

  const handleMoveClick = useCallback((pageId: number) => {
    setMoveTargetPageId(pageId);
    setMoveDialogOpen(true);
  }, []);

  /** Rename a page (inline via tree context). */
  const handleRename = useCallback(async (pageId: number, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      const { data } = await api.docs.pages.update(pageId, { title: newTitle.trim() });
      if (selectedPageId === pageId) setPage(data);
      setRenameState(null);
      refreshTree();
      showToast(`Renamed to "${data.title}"`);
    } catch {
      showToast("Failed to rename");
    }
  }, [selectedPageId, refreshTree, showToast]);

  const handleRenameClick = useCallback((pageId: number, currentTitle: string) => {
    setRenameState({ pageId, title: currentTitle });
  }, []);

  /** Save page content with optimistic revision bump and robust error handling. */
  const handleSave = useCallback(
    async (content: string) => {
      if (!page) return;
      // Optimistic revision for snappy UX — the API will provide the authoritative revision
      const prevRevision = page.revision;
      setPage((prev) => prev ? { ...prev, revision: prev.revision + 1 } : prev);
      try {
        const { data } = await api.docs.pages.update(page.id, { content }, prevRevision);
        setPage(data);
      } catch (e: any) {
        // Rollback to the pre-save revision on failure
        setPage((prev) => prev ? { ...prev, revision: prevRevision } : prev);
        // Only show a toast if this wasn't a revision-conflict (which the editor handles separately)
        if (e?.message && !/revision/i.test(e.message)) {
          showToast(`Save failed: ${e.message}`);
        } else {
          showToast("Failed to save page");
        }
      }
    },
    [page, showToast],
  );

  /** Handle search result selection. */
  const handleSearchSelect = useCallback(
    (pageId: number, spaceId: number) => {
      navigate(spaceId, pageId);
    },
    [navigate],
  );

  /** Handle template selection. */
  const handleTemplateSelect = useCallback(
    (template: { name: string; content: string }) => {
      setTemplateOpen(false);
      if (selectedSpaceId) {
        handleCreatePage(
          template.name,
        );
      }
    },
    [selectedSpaceId, handleCreatePage],
  );

  // ---- Self+descendant IDs for move exclusion ----
  const moveDisabledIds = useMemo(() => {
    if (!moveTargetPageId) return new Set<number>();
    // Find the node in tree and collect its descendants
    function findAndCollect(nodes: DocPageTree[]): Set<number> | null {
      for (const n of nodes) {
        if (n.id === moveTargetPageId) return collectDescendantIds(n);
        if (n.children) {
          const found = findAndCollect(n.children);
          if (found) return found;
        }
      }
      return null;
    }
    return findAndCollect(treePagesRef.current) ?? new Set<number>([moveTargetPageId]);
  }, [moveTargetPageId]);

  // ---- Full-page error state for spaces ----
  if (spacesError && !spacesLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--color-surface)]">
        <div className="text-center space-y-3">
          <IconAlert />
          <p className="text-sm text-red-600 dark:text-red-400">{spacesError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ---- Build top-bar actions ----
  const topBarActions = (
    <>
      {page && (
        <>
          {/* Publish button */}
          {page.status !== "published" && (
            <button
              type="button"
              onClick={handlePublish}
              className="px-2.5 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              title="Publish this page"
              aria-label="Publish page"
            >
              Publish
            </button>
          )}
          {/* Archive button */}
          <button
            type="button"
            onClick={() => handleArchive(page.id)}
            className="px-2.5 py-1 text-xs font-medium text-red-600 border border-red-300 rounded hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            title="Archive (soft-delete) this page"
            aria-label="Archive page"
          >
            Archive
          </button>
        </>
      )}
    </>
  );

  return (
    <>
      <DocsShell
        spaces={spaces}
        selectedSpaceId={selectedSpaceId}
        onSelectSpace={handleSelectSpace}
        onSearch={() => setSearchOpen(true)}
        onNewPage={handleNewPageClick}
        onTemplate={() => setTemplateOpen(true)}
        onImportExport={() => setImportExportOpen(true)}
        spacesLoading={spacesLoading}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        topBarActions={topBarActions}
        tree={
          <PageTree
            selectedPageId={selectedPageId}
            selectedSpaceId={selectedSpaceId}
            onSelectSpace={handleSelectSpace}
            onSelectPage={handleSelectPage}
            onNewPage={handleNewPageClick}
            refreshKey={treeRefreshKey}
            onRenamePage={handleRenameClick}
            onArchivePage={handleArchive}
            onMovePage={handleMoveClick}
            disabledMoveTargets={moveTargetPageId ? moveDisabledIds : undefined}
            key={treeRefreshKey}
          />
        }
        main={
          <div className="h-full flex flex-col">
            {/* Rename inline bar */}
            {renameState && (
              <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface-hover)] border-b border-[var(--color-border)] shrink-0">
                <input
                  type="text"
                  value={renameState.title}
                  onChange={(e) => setRenameState({ ...renameState, title: e.target.value })}
                  className="flex-1 border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--color-text-link)]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(renameState.pageId, renameState.title);
                    if (e.key === "Escape") setRenameState(null);
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => handleRename(renameState.pageId, renameState.title)}
                  disabled={!renameState.title.trim()}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => setRenameState(null)}
                  className="px-3 py-1 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] rounded hover:bg-[var(--color-surface-hover)]"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Main content */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {pageLoading ? (
                <PageLoadingSkeleton />
              ) : pageError ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-3">
                    <IconAlert />
                    <p className="text-sm text-[var(--color-text-muted)]">{pageError}</p>
                  </div>
                </div>
              ) : page ? (
                <DocsEditor page={page} mode={mode} onSave={handleSave} onModeChange={setMode} />
              ) : (
                <WelcomeScreen />
              )}
            </div>
          </div>
        }
        sidebar={
          <RightSidebar
            page={page}
            selectedTab={sidebarTab}
            onSelectTab={setSidebarTab}
            selectedSpaceId={selectedSpaceId}
            onPageMutated={refreshTree}
          />
        }
      />

      {/* Toast notification */}
      {actionToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-lg text-sm text-[var(--color-text-primary)] animate-pulse" role="status" aria-live="polite">
          {actionToast}
        </div>
      )}

      {/* Dialogs */}
      <SearchDialog
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectPage={handleSearchSelect}
      />

      <TemplatePicker
        isOpen={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onSelect={handleTemplateSelect}
      />

      <ImportExportDialog
        isOpen={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        spaceId={selectedSpaceId ?? 0}
      />

      <CreatePageDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreate={handleCreatePage}
      />

      <MovePageDialog
        isOpen={moveDialogOpen}
        onClose={() => { setMoveDialogOpen(false); setMoveTargetPageId(null); }}
        pages={treePagesRef.current}
        disabledIds={moveDisabledIds}
        onMove={handleMove}
        currentTitle={page?.title ?? ""}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Exported page component (with Suspense boundary)
// ---------------------------------------------------------------------------

export default function DocsPage() {
  return (
    <div className="h-[calc(100dvh-56px)]">
      <Suspense
        fallback={
          <div className="h-full flex items-center justify-center bg-[var(--color-surface)]">
            <div className="flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
              <svg className="animate-spin w-6 h-6" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">Loading Docs…</span>
            </div>
          </div>
        }
      >
        <DocsContent />
      </Suspense>
    </div>
  );
}
