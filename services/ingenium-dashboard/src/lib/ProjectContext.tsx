"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

const STORAGE_KEY = "ingenium_active_project";
const GLOBAL_CACHE_KEY = "ingenium_global_project";
const API_URL = "http://localhost:4097/api/v1";

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
let fetchPromise: Promise<Array<{ name: string; is_global?: boolean; archived_at?: string }>> | null = null;

async function fetchProjects(): Promise<Array<{ name: string; is_global?: boolean; archived_at?: string }>> {
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    const res = await fetch(`${API_URL}/projects`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.data) ? data.data : [];
  })();

  return fetchPromise;
}

/**
 * Resolve the active project name.
 *
 * Priority (highest first):
 *  1. `?project=` URL parameter — explicit override (persisted to localStorage)
 *  2. localStorage `ingenium_active_project` — last user selection via ProjectSelector
 *  3. API fetch — find the project with `is_global=1` (cached in localStorage)
 *  4. `"global-default"` — fallback if API is unreachable
 */
export function useProject() {
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("project");

  // Lazy-initialized state for the dynamic global project resolution.
  // Only used when there is NO explicit project from URL or localStorage.
  /**
   * Lazy-initialised state for the dynamic global project resolution.
   *
   * Initialised from the module-level cache first (avoids a flash of "global-default"
   * when the cache is already warm), then falls through to localStorage and finally
   * the static default. This ensures the first render shows the correct project name
   * without waiting for an API call.
  */
  const [activeProject, setActiveProject] = useState<string>(() => {
    if (resolvedGlobalProject) return resolvedGlobalProject;
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem(GLOBAL_CACHE_KEY);
      if (cached) return cached;
    }
    return "global-default";
  });

  useEffect(() => {
    let cancelled = false;
    const requested = fromUrl || (typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null);
    fetchProjects().then((projects) => {
      if (cancelled) return;
      const available = projects.filter((project) => !project.archived_at);
      const selected = available.find((project) => project.name === requested);
      const global = available.find((project) => project.is_global) ?? available[0];
      const name = selected?.name ?? global?.name ?? "global-default";
      resolvedGlobalProject = global?.name ?? "global-default";
      setActiveProject(name);
      try {
        localStorage.setItem(STORAGE_KEY, name);
        localStorage.setItem(GLOBAL_CACHE_KEY, resolvedGlobalProject);
      } catch {
        // Storage is an optimization only.
      }
    }).catch(() => {
      if (!cancelled && !requested) setActiveProject("global-default");
    });
    return () => { cancelled = true; };
  }, [fromUrl]);
  return activeProject;
}

export function persistProject(name: string) {
  if (typeof window !== "undefined") {
    try { localStorage.setItem(STORAGE_KEY, name); } catch { /* ignore */ }
  }
}
