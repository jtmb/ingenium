"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import DocsShell from "./components/DocsShell";
import PageTree from "./components/PageTree";
import DocsEditor from "./components/DocsEditor";
import { api, type DocSpace, type DocPage } from "@/lib/api";

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function IconFile() {
  return (
    <svg className="w-16 h-16 mx-auto text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2 10.5V12h1.5l7.37-7.37-1.5-1.5L2 10.5zm9.96-6.96a.5.5 0 000-.71l-.79-.79a.5.5 0 00-.71 0l-.73.73 1.5 1.5.73-.73z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M1 7s2-4.5 6-4.5S13 7 13 7s-2 4.5-6 4.5S1 7 1 7z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7" r="1.75" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Right sidebar tabs
// ---------------------------------------------------------------------------

type SidebarTab = "metadata" | "comments" | "history";

function RightSidebar({
  page,
  selectedTab,
  onSelectTab,
}: {
  page: DocPage;
  selectedTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
}) {
  const tabs: { key: SidebarTab; label: string }[] = [
    { key: "metadata", label: "Metadata" },
    { key: "comments", label: "Comments" },
    { key: "history", label: "History" },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-[var(--color-border)] shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSelectTab(tab.key)}
            className={`
              flex-1 py-2 text-xs font-medium transition-colors
              ${selectedTab === tab.key
                ? "text-[var(--color-text-link)] border-b-2 border-[var(--color-text-link)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border-b-2 border-transparent"
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {selectedTab === "metadata" && <MetadataTab page={page} />}
        {selectedTab === "comments" && <CommentsTab />}
        {selectedTab === "history" && <HistoryTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab content components
// ---------------------------------------------------------------------------

function MetadataTab({ page }: { page: DocPage }) {
  return (
    <div className="space-y-4">
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
        <p className="text-sm text-[var(--color-text-secondary)] font-mono">{page.slug}</p>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Status
        </label>
        <span
          className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
            page.status === "published"
              ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300"
              : page.status === "draft"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                : "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300"
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
          Created
        </label>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {new Date(page.created_at).toLocaleDateString(undefined, {
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
          {new Date(page.updated_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
    </div>
  );
}

function CommentsTab() {
  return (
    <div className="flex items-center justify-center h-full py-8">
      <p className="text-sm text-[var(--color-text-muted)]">Comments coming soon</p>
    </div>
  );
}

function HistoryTab() {
  return (
    <div className="flex items-center justify-center h-full py-8">
      <p className="text-sm text-[var(--color-text-muted)]">Version history coming soon</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome screen
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

// ---------------------------------------------------------------------------
// Page loading skeleton
// ---------------------------------------------------------------------------

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
// Docs editor fallback (while DocsEditor is built by another agent)
// ---------------------------------------------------------------------------

interface DocsEditorProps {
  page: DocPage;
  mode: "view" | "edit" | "source" | "split";
  onSave: (content: string) => Promise<void>;
  draftContent?: string;
}

/**
 * Temporary fallback editor until DocsEditor component is implemented by another agent.
 * Renders page content as simple Markdown text (View) or a textarea (Edit).
 *
 * Once DocsEditor is available, replace this component with:
 *   import { DocsEditor } from "./components/DocsEditor";
 */
function DocsEditorFallback({ page, mode, onSave }: DocsEditorProps) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(page.content ?? "");

  if (mode === "view" || mode === "source" || mode === "split") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-4">{page.title}</h1>
        <div className="prose prose-sm max-w-none text-[var(--color-text-secondary)] whitespace-pre-wrap">
          {page.content || <span className="text-[var(--color-text-muted)] italic">This page is empty. Switch to Edit mode to add content.</span>}
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="p-6 flex flex-col h-full">
      <input
        type="text"
        value={page.title}
        readOnly
        className="text-2xl font-bold text-[var(--color-text-primary)] mb-4 bg-transparent border-none outline-none w-full"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="flex-1 min-h-[300px] w-full bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded p-4 text-sm text-[var(--color-text-primary)] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-text-link)] focus:border-transparent"
        placeholder="Start writing…"
      />
      <div className="flex justify-end mt-3">
        <button
          type="button"
          onClick={async () => {
            setEditing(true);
            try {
              await onSave(content);
            } finally {
              setEditing(false);
            }
          }}
          disabled={editing}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {editing ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner content component (reads search params)
// ---------------------------------------------------------------------------

function DocsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const spaceIdParam = searchParams.get("space");
  const pageIdParam = searchParams.get("page");

  const selectedSpaceId = spaceIdParam ? Number(spaceIdParam) : null;
  const selectedPageId = pageIdParam ? Number(pageIdParam) : null;

  const [spaces, setSpaces] = useState<DocSpace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [spacesError, setSpacesError] = useState<string | null>(null);

  const [page, setPage] = useState<DocPage | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const [mode, setMode] = useState<"view" | "edit" | "source" | "split">("view");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("metadata");

  // Fetch spaces for the shell
  useEffect(() => {
    let cancelled = false;
    api.docs.spaces
      .list()
      .then(({ data }) => {
        if (cancelled) return;
        setSpaces(data ?? []);
        // Auto-select first space if none in URL
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

  // Fetch page when pageId changes
  useEffect(() => {
    if (!selectedPageId) {
      setPage(null);
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

  // Navigation handlers
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
      navigate(spaceId, null);
    },
    [navigate],
  );

  const handleSelectPage = useCallback(
    (pageId: number) => {
      navigate(selectedSpaceId, pageId);
    },
    [navigate, selectedSpaceId],
  );

  const handleNewPage = useCallback(async () => {
    if (!selectedSpaceId) return;
    try {
      const { data } = await api.docs.pages.create(selectedSpaceId, {
        title: "Untitled",
        slug: `untitled-${Date.now()}`,
        content: "",
        status: "draft",
      });
      navigate(selectedSpaceId, data.id);
    } catch {
      // Silently fail — user can retry
    }
  }, [selectedSpaceId, navigate]);

  const handleSearch = useCallback(() => {
    // Placeholder — search modal will be implemented in a future phase
  }, []);

  const handleSave = useCallback(
    async (content: string) => {
      if (!page) return;
      const { data } = await api.docs.pages.update(page.id, { content }, page.revision);
      setPage(data);
    },
    [page],
  );

  // Error state for spaces (full-page error)
  if (spacesError && !spacesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
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

  return (
    <DocsShell
      spaces={spaces}
      selectedSpaceId={selectedSpaceId}
      onSelectSpace={handleSelectSpace}
      onSearch={handleSearch}
      onNewPage={handleNewPage}
      tree={
        <PageTree
          selectedPageId={selectedPageId}
          selectedSpaceId={selectedSpaceId}
          onSelectSpace={handleSelectSpace}
          onSelectPage={handleSelectPage}
          onNewPage={handleNewPage}
        />
      }
      main={
        <div className="h-full flex flex-col">
          {/* Main content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {pageLoading ? (
              <PageLoadingSkeleton />
            ) : pageError ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-3">
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
        page ? (
          <RightSidebar page={page} selectedTab={sidebarTab} onSelectTab={setSidebarTab} />
        ) : undefined
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Exported page component (with Suspense boundary)
// ---------------------------------------------------------------------------

export default function DocsPage() {
  return (
    <div className="-m-6 h-[calc(100dvh-56px)]">
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
