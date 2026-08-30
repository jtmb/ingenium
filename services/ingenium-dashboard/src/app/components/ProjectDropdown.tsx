"use client";
import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { useProject, persistProject } from "@/lib/ProjectContext";
import { api } from "@/lib/api";
import { buildProjectNavigationHref } from "@/lib/project-navigation";
import { Dropdown, DropdownItem, DropdownLabel, DropdownPanel, DropdownSeparator, DropdownTrigger } from "./Dropdown";

/**
 * Project switcher dropdown in the top navigation bar.
 *
 * Disabled on `/backups`, `/mail`, `/opencode`, and `/vscode` pages because those views operate on the
 * global project context. Chat keeps project switching available so its explicit Context project
 * follows the validated active project after a full reload.
 */
export function isProjectSwitchingDisabled(pathname: string | null): boolean {
  const globalOnlyRoutes = ["/backups", "/mail", "/opencode", "/vscode"];
  return pathname ? globalOnlyRoutes.some((route) => pathname.startsWith(route)) : false;
}

export default function ProjectDropdown() {
  const pathname = usePathname();
  const disabled = isProjectSwitchingDisabled(pathname);
  const isChatRoute = pathname === "/chat" || Boolean(pathname?.startsWith("/chat/"));
  const activeProject = useProject();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load project list only when the dropdown opens. Keeping this transition
  // in the event handler avoids an effect-driven render cycle and retries on every reopen.
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setLoading(true);
    setError(null);
    void api.projects.list()
      .then((r) => setProjects(r.data ?? []))
      .catch(() => setError("Unable to load projects"))
      .finally(() => setLoading(false));
  }, []);

  /** Switch the active project and reload the current page to pick up the new context. */
  function selectProject(name: string) {
    persistProject(name);
    setOpen(false);
    // Full page reload re-initialises data hooks while retaining route state and
    // making the selected namespace explicit in the destination URL.
    window.location.assign(buildProjectNavigationHref(
      window.location.pathname,
      name,
      window.location.search,
      window.location.hash,
    ));
  }

  return (
    <Dropdown open={open} onOpenChange={handleOpenChange} className="relative min-w-0">
      <DropdownTrigger
        disabled={disabled}
        aria-label={disabled ? "Project switching disabled on this page" : isChatRoute ? `Context project: ${activeProject}` : `Active project: ${activeProject}`}
        title={disabled ? "Project switching disabled on this page" : isChatRoute ? `Context project: ${activeProject}` : `Active project: ${activeProject}`}
        className={[
          "flex min-w-0 items-center gap-1 rounded p-1.5",
          isChatRoute ? "max-w-[calc(100vw-8rem)] sm:max-w-sm" : "",
          disabled ? "cursor-not-allowed opacity-50" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]",
        ].join(" ")}
      >
        <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span
          className={[
            "min-w-0 items-center gap-1 text-xs font-medium text-[var(--color-text-primary)]",
            isChatRoute ? "flex max-w-full sm:max-w-56" : "hidden max-w-40 sm:flex",
          ].join(" ")}
        >
          {isChatRoute && <span className="hidden shrink-0 sm:inline" data-testid="project-context-prefix">Context project: </span>}
          <span className="min-w-0 truncate font-normal" data-testid="project-name">{activeProject}</span>
        </span>
        <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </DropdownTrigger>
      {open && !disabled && (
        <DropdownPanel aria-label="Project menu" className="right-0 top-full mt-1 w-64 max-h-96">
          <DropdownLabel>Active: {activeProject}</DropdownLabel>
          <DropdownSeparator />
          {loading && <div className="px-2 py-2 text-sm text-[var(--color-text-muted)]" role="status">Loading projects…</div>}
          {error && <div className="px-2 py-2 text-sm text-[var(--color-error-text)]" role="alert">{error}</div>}
          {projects.filter((p) => !p.archived_at).map((p) => (
            <DropdownItem
              key={p.name}
              onClick={() => selectProject(p.name)}
              selected={p.name === activeProject}
              className={p.name === activeProject ? "font-semibold" : undefined}
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.name === activeProject && <span aria-label="Selected">✓</span>}
            </DropdownItem>
          ))}
          <DropdownSeparator />
          <a
            href={buildProjectNavigationHref("/projects", activeProject)}
            role="menuitem"
            className="block rounded px-2 py-1.5 text-xs text-[var(--color-text-link)] outline-none hover:bg-[var(--color-surface-hover)] focus:bg-[var(--color-surface-hover)]"
          >
            Manage projects →
          </a>
        </DropdownPanel>
      )}
    </Dropdown>
  );
}
