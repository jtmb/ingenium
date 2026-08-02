"use client";

import VSCodeFrame from "../components/VSCodeFrame";
import WorkspaceControl from "../components/WorkspaceControl";
import { VSCODE_GATEWAY_URL } from "@/lib/runtime-urls";

/** Local-only code-server workspace. */
export default function VSCodePage() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--color-surface-muted)]">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">VS Code</h1>
          <p className="truncate text-xs text-[var(--color-text-muted)]">Local-only administrator workspace</p>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <a
            href={VSCODE_GATEWAY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded px-2 py-1.5 text-xs font-medium text-[var(--color-text-link)] underline underline-offset-2 hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
          >
            Open directly
          </a>
          <WorkspaceControl pageId="vscode" />
        </div>
      </header>
      <div className="relative flex-1 min-h-0 min-w-0">
        <VSCodeFrame />
      </div>
    </div>
  );
}
