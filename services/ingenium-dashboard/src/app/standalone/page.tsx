"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import WorkspaceControl from "../components/WorkspaceControl";
import type { WorkspaceControlProps } from "../components/WorkspaceControl";

/**
 * Standalone page — renders page content WITHOUT the full layout chrome
 * (no sidebar nav, ProjectDropdown, or Settings gear).
 *
 * URL format:
 *   /standalone?page=opencode
 *   /standalone?page=mail&account=gmail&folder=INBOX
 *   /standalone?page=docs
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
        src="http://localhost:4098/"
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
 * Standalone Docs view — placeholder with WorkspaceControl.
 */
function StandaloneDocs() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-3">
        <svg className="w-12 h-12 mx-auto text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-[var(--color-text-muted)]">Docs coming soon</p>
      </div>
    </div>
  );
}
