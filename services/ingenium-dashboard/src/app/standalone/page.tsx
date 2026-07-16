"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import WorkspaceControl from "../components/WorkspaceControl";
import type { WorkspaceControlProps } from "../components/WorkspaceControl";
import { api, type DocSpace } from "@/lib/api";

/**
 * StandalonePage — Renders page content WITHOUT the full layout chrome
 * (no sidebar nav, ProjectDropdown, or Settings gear).
 *
 * URL format:
 *   /standalone?page=opencode
 *   /standalone?page=mail&account=gmail&folder=INBOX
 *   /standalone?page=docs
 *
 * Used by external embedding contexts (e.g., tiling window managers,
 * Electron BrowserView) where only the content pane is desired.
 * The sub-components replicate their /app/ equivalents but skip the
 * MainContainer + Navigation wrappers.
 */
export default function StandalonePage() {
  return (
    <Suspense fallback={<StandaloneSkeleton />}>
      <StandaloneContent />
    </Suspense>
  );
}

function StandaloneSkeleton() {
  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-surface)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
        <svg className="animate-spin w-6 h-6" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}

/** Inner component that reads search params inside a Suspense boundary. */
function StandaloneContent() {
  const searchParams = useSearchParams();
  const page = searchParams.get("page") as WorkspaceControlProps["pageId"] | null;

  // Extract state params (any param except "page" and "standalone")
  const stateParams: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (key !== "page" && key !== "standalone") {
      stateParams[key] = value;
    }
  });

  // ── Invalid or missing page ──────────────────────────────────────────
  if (!page || !["opencode", "mail", "docs"].includes(page)) {
    return (
      <div className="fixed inset-0 z-50 bg-[var(--color-surface)] flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Invalid Page</h1>
          <p className="text-[var(--color-text-muted)]">
            {page ? `"${page}" is not a supported standalone page.` : "No page specified."}
          </p>
          <a
            href="/"
            className="inline-block px-4 py-2 bg-[var(--color-accent)] text-white rounded text-sm hover:opacity-90 transition-opacity"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  // ── Page title ───────────────────────────────────────────────────────
  const pageTitle =
    page === "opencode" ? "OpenCode" : page === "mail" ? "Mail" : "Docs";

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-surface)] flex flex-col">
      {/* Minimal top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-surface)]">
        <div className="flex items-center gap-3">
          <a href="/" className="font-bold text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
            Ingenium
          </a>
          <span className="text-[var(--color-text-muted)] text-xs">/</span>
          <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">{pageTitle}</h1>
        </div>
        <WorkspaceControl
          pageId={page}
          stateParams={Object.keys(stateParams).length > 0 ? stateParams : undefined}
        />
      </header>

      {/* Page content */}
      <div className="flex-1 min-h-0">
        {page === "opencode" && <StandaloneOpenCode />}
        {page === "mail" && <StandaloneMail />}
        {page === "docs" && <StandaloneDocs />}
      </div>
    </div>
  );
}

// ── Standalone sub-components ────────────────────────────────────────────

/**
 * Standalone OpenCode view — two iframes (Web/CLI) with mode toggle.
 * Replicates the OpenCodeFrame logic without the pathname guard.
 */
function StandaloneOpenCode() {
  const [mode, setMode] = useState<"web" | "cli">("web");
  const [cliMounted, setCliMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("opencode-mode");
      if (saved === "cli" || saved === "web") setMode(saved);
    } catch { /* ignore */ }
  }, []);

  const handleModeChange = (newMode: "web" | "cli") => {
    setMode(newMode);
    try { localStorage.setItem("opencode-mode", newMode); } catch { /* ignore */ }
    if (newMode === "cli" && !cliMounted) setCliMounted(true);
  };

  return (
    <div className="relative w-full h-full">
      {/* Web iframe */}
      <iframe
        src="/opencode-proxy/"
        className="absolute inset-0 w-full h-full border-0"
        style={{
          opacity: mode === "web" ? 1 : 0,
          visibility: mode === "web" ? "visible" : "hidden",
          pointerEvents: mode === "web" ? "auto" : "none",
        }}
        aria-hidden={mode !== "web"}
        tabIndex={mode === "web" ? 0 : -1}
        title="OpenCode Web"
        allow="clipboard-write"
        sandbox="allow-scripts allow-same-origin"
      />

      {/* CLI iframe — lazy-mounted */}
      {cliMounted && (
        <iframe
          src="http://localhost:4099/"
          className="absolute inset-0 w-full h-full border-0"
          style={{
            opacity: mode === "cli" ? 1 : 0,
            visibility: mode === "cli" ? "visible" : "hidden",
            pointerEvents: mode === "cli" ? "auto" : "none",
          }}
          aria-hidden={mode !== "cli"}
          tabIndex={mode === "cli" ? 0 : -1}
        title="OpenCode Terminal"
        allow="clipboard-write"
        sandbox="allow-scripts allow-same-origin"
      />
      )}

      {/* Mode toggle — simplified standalone version */}
      <div
        className="fixed right-0 top-1/2 -translate-y-1/2 z-10 bg-[var(--color-surface)]/90 backdrop-blur-sm border border-[var(--color-border)] rounded-l-lg p-1 flex flex-col gap-0.5 shadow-lg"
        style={{ transition: "transform 0.15s ease" }}
      >
        <button
          onClick={() => handleModeChange("web")}
          className={`p-1.5 rounded text-xs transition-colors ${
            mode === "web"
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          }`}
          title="Web mode"
          aria-label="Web mode"
          aria-pressed={mode === "web"}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        </button>
        <button
          onClick={() => handleModeChange("cli")}
          className={`p-1.5 rounded text-xs transition-colors ${
            mode === "cli"
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          }`}
          title="CLI mode"
          aria-label="CLI mode"
          aria-pressed={mode === "cli"}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Standalone Mail view — lazy-imports the full MailPage component.
 * The MailPage is self-contained and works without parent layout chrome.
 */
function StandaloneMail() {
  const [MailPage, setMailPage] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    import("../mail/page")
      .then((mod) => setMailPage(() => mod.default))
      .catch(() => setError("Failed to load Mail page"));
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
        <p>{error}</p>
      </div>
    );
  }

  if (!MailPage) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
          <svg className="animate-spin w-6 h-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading Mail…</span>
        </div>
      </div>
    );
  }

  return <MailPage />;
}

/**
 * Standalone Docs view — focused Docs entry/landing experience.
 *
 * Fetches available spaces from the API, allows choosing or creating a
 * documentation space, and navigates to the full /docs workspace when
 * a space is selected. Supports loading, empty, error, and create-flow
 * states. Does NOT duplicate the full rich editor or mock data.
 */
function StandaloneDocs() {
  const router = useRouter();

  const [spaces, setSpaces] = useState<DocSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  /** Generate a URL-safe slug from an arbitrary string. */
  const slugify = useCallback((s: string) => {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "untitled";
  }, []);

  const fetchSpaces = useCallback(() => {
    setLoading(true);
    setError(null);
    api.docs.spaces
      .list()
      .then(({ data }) => {
        setSpaces(data ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load docs spaces");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchSpaces();
  }, [fetchSpaces]);

  // Focus name input when create form opens
  useEffect(() => {
    if (showCreate && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [showCreate]);

  // ── Space selection — navigate to /docs workspace ──────────────────────
  const handleSelect = useCallback(
    (spaceId: number) => {
      router.push(`/docs?space=${spaceId}`);
    },
    [router],
  );

  // ── Create space ───────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;

    setCreating(true);
    setCreateError(null);
    try {
      const { data } = await api.docs.spaces.create(
        name,
        slugify(name),
        newDescription.trim() || undefined,
      );
      router.push(`/docs?space=${data.id}`);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create space");
    } finally {
      setCreating(false);
    }
  }, [newName, newDescription, slugify, router]);

  const handleCancelCreate = useCallback(() => {
    setShowCreate(false);
    setNewName("");
    setNewDescription("");
    setCreateError(null);
  }, []);

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
          <svg className="animate-spin w-6 h-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading spaces…</span>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4 max-w-sm">
          <svg className="w-12 h-12 mx-auto text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
          <button
            type="button"
            onClick={fetchSpaces}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Empty state (no spaces exist) ──────────────────────────────────────
  if (spaces.length === 0 && !showCreate) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4 max-w-sm">
          <svg className="w-16 h-16 mx-auto text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            No docs spaces yet
          </h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Create a documentation space to organise your pages.
          </p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
          >
            Create your first space
          </button>
        </div>
      </div>
    );
  }

  // ── Data state — list + create form ────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* Scrollable space list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Documentation Spaces
            </h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              Select a space to browse and edit its pages.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCreate(true);
              setCreateError(null);
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
            aria-label="Create new space"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            New Space
          </button>
        </div>

        {/* Create-space form */}
        {showCreate && (
          <div
            className="mb-6 p-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface-muted)]"
            role="form"
            aria-label="Create new documentation space"
          >
            <div className="space-y-3">
              <div>
                <label htmlFor="standalone-docs-new-name" className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                  Name
                </label>
                <input
                  ref={nameInputRef}
                  id="standalone-docs-new-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Project Docs"
                  className="w-full px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-text-link)] focus:border-transparent"
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") handleCancelCreate(); }}
                  aria-required="true"
                />
              </div>
              <div>
                <label htmlFor="standalone-docs-new-desc" className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                  Description <span className="font-normal normal-case text-[var(--color-text-muted)]">(optional)</span>
                </label>
                <input
                  id="standalone-docs-new-desc"
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Brief description of this space"
                  className="w-full px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-text-link)] focus:border-transparent"
                />
              </div>
              {createError && (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">{createError}</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !newName.trim()}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                >
                  {creating ? "Creating…" : "Create Space"}
                </button>
                <button
                  type="button"
                  onClick={handleCancelCreate}
                  disabled={creating}
                  className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-transparent rounded hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Space cards grid */}
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          role="list"
          aria-label="Documentation spaces"
        >
          {spaces.map((space) => (
            <button
              key={space.id}
              type="button"
              onClick={() => handleSelect(space.id)}
              className="flex items-start gap-4 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-text-link)] transition-all text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
              role="listitem"
              aria-label={`Open ${space.name}`}
            >
              {/* Space icon */}
              <span
                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-lg bg-[var(--color-surface-muted)] text-lg"
                aria-hidden="true"
              >
                {space.icon || (
                  <svg className="w-5 h-5 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                  </svg>
                )}
              </span>

              {/* Space info */}
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                  {space.name}
                </h3>
                {space.description && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">
                    {space.description}
                  </p>
                )}
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
                  /{space.slug}
                </p>
              </div>

              {/* Chevron indicator */}
              <svg className="shrink-0 w-4 h-4 text-[var(--color-text-muted)] mt-2" fill="none" stroke="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
