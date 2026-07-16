"use client";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useProject, persistProject } from "@/lib/ProjectContext";
import { api } from "@/lib/api";

/**
 * Project switcher dropdown in the top navigation bar.
 *
 * Disabled on `/mail` and `/opencode` pages because those views operate on the
 * global project context and switching projects mid-session would break the UX.
 */
export default function ProjectDropdown() {
  const pathname = usePathname();
  const disabled = pathname?.startsWith("/mail") || pathname?.startsWith("/opencode");
  const activeProject = useProject();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Lazy-load project list only when the dropdown opens
  useEffect(() => {
    if (open) api.projects.list().then((r) => setProjects(r.data ?? [])).catch(() => {});
  }, [open]);

  // Close the dropdown when clicking outside (mousedown fires before click, avoids race with toggle)
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  /** Switch the active project and reload the current page to pick up the new context. */
  function selectProject(name: string) {
    persistProject(name);
    setOpen(false);
    // Full page reload to re-initialise all data-fetching hooks with the new project
    window.location.href = window.location.pathname;
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? "Project switching disabled on this page" : `Active project: ${activeProject}`}
        className={`p-1.5 rounded flex items-center gap-1 ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"}`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && !disabled && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
            Active: {activeProject}
          </div>
          {projects.filter((p) => !p.archived_at).map((p) => (
            <button
              key={p.name}
              onClick={() => selectProject(p.name)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] flex items-center justify-between ${p.name === activeProject ? "font-semibold text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}
            >
              {p.name}
              {p.name === activeProject && <span>✓</span>}
            </button>
          ))}
          <a href="/projects" className="block px-3 py-2 text-xs text-[var(--color-text-link)] hover:underline border-t border-[var(--color-border)]">Manage projects →</a>
        </div>
      )}
    </div>
  );
}
