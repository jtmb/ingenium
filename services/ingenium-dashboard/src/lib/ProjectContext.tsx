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
let fetchPromise: Promise<string> | null = null;

async function resolveGlobalProject(): Promise<string> {
  if (resolvedGlobalProject) return resolvedGlobalProject;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    // 1. Check localStorage cache (survives page reloads)
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem(GLOBAL_CACHE_KEY);
      if (cached) {
        resolvedGlobalProject = cached;
        return cached;
      }
    }

    // 2. Fetch from API and find the project with is_global=1
    try {
      const res = await fetch(`${API_URL}/projects`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const global = data.data?.find((p: { is_global?: boolean; name: string }) => p.is_global);
      const name = global?.name || "global-default";
      resolvedGlobalProject = name;
      if (typeof window !== "undefined") {
        try { localStorage.setItem(GLOBAL_CACHE_KEY, name); } catch { /* quota exceeded */ }
      }
      return name;
    } catch {
      // 3. Fallback — API unreachable, use the hardcoded default
      resolvedGlobalProject = "global-default";
      return "global-default";
    } finally {
      // Clear the dedup promise so a future call can retry
      fetchPromise = null;
    }
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
  const [resolvedGlobal, setResolvedGlobal] = useState<string>(() => {
    if (resolvedGlobalProject) return resolvedGlobalProject;
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem(GLOBAL_CACHE_KEY);
      if (cached) return cached;
    }
    return "global-default";
  });

  useEffect(() => {
    // Only fetch the global project if there's NO explicit override —
    // the URL param or a saved localStorage choice takes precedence.
    const hasExplicitProject =
      fromUrl ||
      (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY));
    if (!hasExplicitProject) {
      resolveGlobalProject().then(setResolvedGlobal);
    }
  }, [fromUrl]);

  // 1. URL param always wins
  if (fromUrl) {
    if (typeof window !== "undefined") {
      try { localStorage.setItem(STORAGE_KEY, fromUrl); } catch { /* ignore */ }
    }
    return fromUrl;
  }

  // 2. User-selected project (persisted by ProjectSelector or prior URL param)
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  }

  // 3. Dynamically resolved global project (or its cached fallback)
  return resolvedGlobal;
}

export function persistProject(name: string) {
  if (typeof window !== "undefined") {
    try { localStorage.setItem(STORAGE_KEY, name); } catch { /* ignore */ }
  }
}
