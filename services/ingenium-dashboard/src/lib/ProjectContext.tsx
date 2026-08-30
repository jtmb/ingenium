"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "./api";

const STORAGE_KEY = "ingenium_active_project";
const GLOBAL_CACHE_KEY = "ingenium_global_project";

/** Resolve project preference without allowing a global fallback to override it. */
export function resolveInitialProject(
  urlProject: string | null,
  storedProject: string | null,
  cachedGlobalProject: string | null,
): string | null {
  return urlProject ?? storedProject ?? cachedGlobalProject;
}

function readStoredProject(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function clearRevokedProjectSelection(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(GLOBAL_CACHE_KEY); } catch { /* storage is optional */ }
}

/**
 * Module-level cache for the global project name.
 *
 * Two-tier caching:
 * 1. `resolvedGlobalProject` — in-memory cache, survives React re-renders
 * 2. `fetchPromise` — deduplicates concurrent calls so multiple components
 *    hydrating at the same time share a single in-flight fetch
 *
 * Without this, every `useProject()` call in a tree of components would fire
 * its own API request on first render.
 */
let resolvedGlobalProject: string | null = null;
export type ProjectSummary = { name: string; is_global?: boolean | number; archived_at?: string };
let fetchPromise: Promise<ProjectSummary[]> | null = null;

async function fetchProjects(): Promise<ProjectSummary[]> {
  if (fetchPromise) return fetchPromise;

  fetchPromise = api.projects.list()
    .then((response) => Array.isArray(response.data) ? response.data : [])
    .catch((error: unknown) => {
      // Do not permanently cache a transient dashboard/API failure. A later
      // mount should be able to retry resolution instead of reusing a rejected
      // promise forever.
      fetchPromise = null;
      throw error;
    });

  return fetchPromise;
}

/**
 * Resolve the active, canonical global project from the API project list.
 *
 * Settings owned by the server instance must not assume that a historical
 * global name is still globally designated. An ambiguous global
 * result is treated as an integrity failure rather than choosing arbitrarily.
 */
export function resolveGlobalProjectName(projects: ProjectSummary[]): string | null {
  const globals = projects.filter((project) => Boolean(project.is_global) && !project.archived_at);
  if (globals.length > 1) {
    throw new Error("Multiple active global projects are configured");
  }
  return globals[0]?.name ?? null;
}

export interface GlobalProjectState {
  project: string | null;
  loading: boolean;
  error: Error | null;
}

export interface ProjectResolutionState {
  project: string | null;
  loading: boolean;
  error: Error | null;
  canClearSelection: boolean;
  availableProjects?: ProjectSummary[];
}

type ProjectResolutionResult = Pick<ProjectResolutionState, "project" | "error">;

/**
 * Validate an explicit project selection, otherwise resolve the sole active
 * global project. A missing or ambiguous global is an unresolved state: it is
 * never replaced with an arbitrary available project or historical name.
 */
export function resolveProjectSelection(
  projects: ProjectSummary[],
  requestedProject: string | null,
): ProjectResolutionResult {
  const available = projects.filter((project) => !project.archived_at);
  if (requestedProject !== null) {
    const selected = available.find((project) => project.name === requestedProject);
    if (selected) return { project: selected.name, error: null };
    return {
      project: null,
      error: new Error("The requested project is unavailable."),
    };
  }

  try {
    const globalProject = resolveGlobalProjectName(available);
    if (globalProject) return { project: globalProject, error: null };
    return {
      project: null,
      error: new Error("No active global project is configured"),
    };
  } catch (error: unknown) {
    return {
      project: null,
      error: error instanceof Error ? error : new Error("Unable to resolve the active project"),
    };
  }
}

/** Resolve the server-designated global project for instance-wide settings. */
export function useGlobalProject(): GlobalProjectState {
  const [state, setState] = useState<GlobalProjectState>({
    project: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetchProjects()
      .then((projects) => {
        if (cancelled) return;
        const project = resolveGlobalProjectName(projects);
        setState({ project, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          project: null,
          loading: false,
          error: error instanceof Error ? error : new Error("Unable to resolve the global project"),
        });
      });

    return () => { cancelled = true; };
  }, []);

  return state;
}

/**
 * Resolve and validate the active project for dashboard routes.
 *
 * Priority (highest first):
 *  1. `?project=` URL parameter — explicit override (persisted to localStorage)
 *  2. localStorage `ingenium_active_project` — last user selection via ProjectSelector
 *  3. API fetch — find the project with `is_global=1` (cached in localStorage)
 *
 * The result remains unresolved until the API validates it. This avoids an
 * unverified URL/storage value or a failed canonical-global lookup causing a
 * project-scoped route to fetch another project's data.
 */
export function useProjectResolution(): ProjectResolutionState {
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("project");

  const preference = useMemo(() => {
    const storedProject = readStoredProject(STORAGE_KEY);
    const explicitProject = fromUrl ?? storedProject;
    const hasExplicitPreference = fromUrl !== null || storedProject !== null;
    return {
      explicitProject,
      hasExplicitPreference,
      requestKey: resolveInitialProject(
        fromUrl,
        storedProject,
        hasExplicitPreference ? null : resolvedGlobalProject ?? readStoredProject(GLOBAL_CACHE_KEY),
      ),
    };
  }, [fromUrl]);

  const [state, setState] = useState<ProjectResolutionState & { requestKey: string | null }>({
    project: null,
    loading: true,
    error: null,
    canClearSelection: false,
    requestKey: null,
  });

  useEffect(() => {
    let cancelled = false;

    fetchProjects()
      .then((projects) => {
        if (cancelled) return;

        const resolution = resolveProjectSelection(projects, preference.explicitProject);
        if (resolution.project && !preference.hasExplicitPreference) {
          resolvedGlobalProject = resolution.project;
        }
        if (!resolution.project && !preference.hasExplicitPreference) {
          resolvedGlobalProject = null;
        }

        setState({
          ...resolution,
          loading: false,
            canClearSelection: preference.hasExplicitPreference && !resolution.project,
            availableProjects: projects.filter((project) => !project.archived_at),
          requestKey: preference.requestKey,
        });

        if (!resolution.project) {
          try {
            localStorage.removeItem(GLOBAL_CACHE_KEY);
            if (preference.hasExplicitPreference) localStorage.removeItem(STORAGE_KEY);
          } catch {
            // Storage is an optimization only.
          }
          return;
        }

        try {
          if (preference.hasExplicitPreference) {
            localStorage.setItem(STORAGE_KEY, resolution.project);
          } else {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.setItem(GLOBAL_CACHE_KEY, resolution.project);
          }
        } catch {
          // Storage is an optimization only.
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          project: null,
          loading: false,
          error: error instanceof Error ? error : new Error("Unable to resolve the active project"),
           canClearSelection: false,
           availableProjects: [],
          requestKey: preference.requestKey,
        });
      });

    return () => { cancelled = true; };
  }, [preference]);

  // A route change must wait for the matching preference to be validated rather
  // than briefly rendering under the previous route's project.
  if (state.requestKey !== preference.requestKey) {
    return { project: null, loading: true, error: null, canClearSelection: false, availableProjects: [] };
  }

  return state;
}

const ActiveProjectContext = createContext<string | null>(null);

/** Render children only after the dashboard has a validated active project. */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const state = useProjectResolution();

  if (state.loading) {
    return <ProjectResolutionStatus state={state} />;
  }

  if (!state.project) {
    return <ProjectResolutionStatus state={state} />;
  }

  return <ActiveProjectContext.Provider value={state.project}>{children}</ActiveProjectContext.Provider>;
}

/** User-visible state for unresolved project context; no scoped content is mounted. */
export function ProjectResolutionStatus({ state }: { state: ProjectResolutionState }) {
  if (state.loading) {
    return (
      <main className="flex flex-1 items-center justify-center p-6" aria-busy="true">
        <p className="text-sm text-[var(--color-text-muted)]">Resolving project context…</p>
      </main>
    );
  }

  const clearSelection = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(GLOBAL_CACHE_KEY);
    } catch {
      // Storage is an optimization only; URL recovery must still proceed.
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    window.location.assign(url.toString());
  };

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-lg rounded-lg border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-6 text-center" role="alert" data-testid="project-resolution-error">
        <h1 className="text-lg font-semibold text-[var(--color-error-text)]">Project context unavailable</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          {state.error?.message ?? "The active project could not be resolved."}
        </p>
        {state.canClearSelection && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">{state.availableProjects?.map((project) => <button key={project.name} type="button" onClick={() => { persistProject(project.name); const url = new URL(window.location.href); url.searchParams.set("project", project.name); window.location.assign(url.toString()); }} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white">Use {project.name}</button>)}<button type="button" onClick={clearSelection} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]">Choose an authorized project</button></div>
        )}
      </div>
    </main>
  );
}

/** Return the validated project made available by ProjectProvider. */
export function useProject(): string {
  const project = useContext(ActiveProjectContext);
  if (!project) {
    throw new Error("useProject must be used within a resolved ProjectProvider");
  }
  return project;
}

export function persistProject(name: string) {
  if (typeof window !== "undefined") {
    try { localStorage.setItem(STORAGE_KEY, name); } catch { /* ignore */ }
  }
}
