"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  startTransition,
} from "react";
import { opencode, type OpenCodeSession } from "./opencode";
import { request } from "./api";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ACTIVE_SESSION_KEY = "opencode-chat-active-session";

/* ------------------------------------------------------------------ */
/*  Public interface                                                   */
/* ------------------------------------------------------------------ */

export interface UseOpenCodeSessionsReturn {
  /** All active sessions filtered by searchQuery, sorted by updatedAt desc. */
  sessions: OpenCodeSession[];
  /** Archived sessions (empty array when archive not supported by API). */
  archivedSessions: OpenCodeSession[];
  /** Currently selected session ID. */
  activeId: string | null;
  /** True while initial fetch or refresh is in-flight. */
  isLoading: boolean;
  /** Last captured error message, or null. */
  error: string | null;
  /** Client-side search filter — applied to session titles (case-insensitive). */
  searchQuery: string;
  /** Set the search filter (wrapped in startTransition). */
  setSearchQuery: (q: string) => void;

  /* Actions */

  /** Create a new session and auto-select it. Returns the new session ID or null on error. */
  create: (title: string) => Promise<string | null>;
  /** Rename a session with optimistic local update. */
  rename: (id: string, title: string) => Promise<void>;
  /** Delete a session. If it was active, selects the next available. */
  remove: (id: string) => Promise<void>;
  /** Set the active session ID and persist to localStorage. */
  select: (id: string) => void;
  /** Fork a session (optionally at a specific message). Returns the forked session ID. */
  fork: (id: string, messageId?: string) => Promise<string | null>;
  /** Share a session and return the share URL. */
  share: (id: string) => Promise<string | null>;
  /** Remove the share link from a session. */
  unshare: (id: string) => Promise<void>;
  /** Re-fetch the session list from the server. */
  refresh: () => Promise<void>;
  /** Archive a session (falls back to delete when API lacks archive support). */
  archive: (id: string) => Promise<void>;
  /** Un-archive a session (no-op when API lacks archive support). */
  unarchive: (id: string) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function persistActive(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }
}

function readPersistedActive(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_SESSION_KEY);
}

/** Check whether the session shape includes a V2 archive field. */
function supportsArchive(session: OpenCodeSession): boolean {
  return "archived" in (session.time as Record<string, unknown>);
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

/**
 * React hook managing OpenCode session CRUD.
 *
 * - Fetches sessions from the OpenCode API on mount
 * - Sorts by `time.updated` descending (epoch millis)
 * - Persists `activeId` to localStorage under `opencode-chat-active-session`
 * - Supports create, rename, remove, select, fork, share, unshare
 * - Client-side search filtering via `searchQuery` (case-insensitive title match)
 * - Archive/unarchive with graceful fallback when API lacks archive support
 */
export function useOpenCodeSessions(): UseOpenCodeSessionsReturn {
  /* ---- state ---- */

  const [allSessions, setAllSessions] = useState<OpenCodeSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() =>
    readPersistedActive(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, _setSearchQuery] = useState("");

  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  /** Snapshot of previous sessions for optimistic rollback in rename. */
  const renameSnapshotRef = useRef<OpenCodeSession[]>([]);

  /* ---- derived: search filter ---- */

  const sessions = useMemo(() => {
    if (!searchQuery.trim()) return allSessions;
    const q = searchQuery.toLowerCase();
    return allSessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [allSessions, searchQuery]);

  /** Archive is not supported in the V1.18.3 API — always empty. */
  const archivedSessions: OpenCodeSession[] = [];

  /* ---- actions ---- */

  const setSearchQuery = useCallback((q: string) => {
    startTransition(() => _setSearchQuery(q));
  }, []);

  const refresh = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setError(null);
      setIsLoading(true);
      const data = await opencode.sessions.list("/workspace");
      if (!mountedRef.current) return;

      // Sort by updatedAt descending (newest first)
      const sorted = [...data].sort(
        (a, b) => b.time.updated - a.time.updated,
      );
      setAllSessions(sorted);

      // Auto-select if no active session and sessions exist
      setActiveId((prev) => {
        if (prev && sorted.some((s) => s.id === prev)) return prev;
        const first = sorted[0];
        return first ? first.id : null;
      });
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message =
        err instanceof Error ? err.message : "Failed to load sessions";
      if (message === "AbortError" || (err as Error)?.name === "AbortError")
        return;
      setError(message);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  /* ---- initial load ---- */

  useEffect(() => {
    mountedRef.current = true;
    refresh();

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [refresh]);

  /* ---- create ---- */

  const create = useCallback(async (title: string): Promise<string | null> => {
    try {
      setError(null);
      const session = await opencode.sessions.create({
        title,
        directory: "/workspace",
      });
      // Refresh to get the full sorted list
      await opencode.sessions
        .list("/workspace")
        .then((data) => {
          if (!mountedRef.current) return;
          const sorted = [...data].sort(
            (a, b) => b.time.updated - a.time.updated,
          );
          setAllSessions(sorted);
        })
        .catch(() => {
          /* refresh failure is non-critical */
        });

      setActiveId(session.id);
      persistActive(session.id);
      return session.id;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create session";
      setError(message);
      return null;
    }
  }, []);

  /* ---- rename (optimistic) ---- */

  const rename = useCallback(async (id: string, title: string) => {
    try {
      setError(null);

      // Optimistic update
      setAllSessions((prev) => {
        renameSnapshotRef.current = prev;
        return prev.map((s) =>
          s.id === id
            ? { ...s, title, time: { ...s.time, updated: Date.now() } }
            : s,
        );
      });

      await opencode.sessions.update(id, { title });
    } catch (err: unknown) {
      // Rollback on error
      if (renameSnapshotRef.current.length > 0) {
        setAllSessions(renameSnapshotRef.current);
      }
      const message =
        err instanceof Error ? err.message : "Failed to rename session";
      setError(message);
    }
  }, []);

  /* ---- remove ---- */

  const remove = useCallback(
    async (id: string) => {
      try {
        setError(null);
        await opencode.sessions.delete(id);

        if (!mountedRef.current) return;

        setAllSessions((prev) => {
          const remaining = prev.filter((s) => s.id !== id);
          // If the removed session was active, select the next available
          if (activeId === id) {
            const first = remaining[0];
            const nextId = first ? first.id : null;
            setActiveId(nextId);
            persistActive(nextId);
          }
          return remaining;
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to delete session";
        setError(message);
      }
    },
    [activeId],
  );

  /* ---- select ---- */

  const select = useCallback((id: string) => {
    setActiveId(id);
    persistActive(id);
  }, []);

  /* ---- fork ---- */

  const fork = useCallback(
    async (id: string, messageId?: string): Promise<string | null> => {
      try {
        setError(null);
        const forked = await opencode.sessions.fork(id, messageId);

        // Refresh the list
        try {
          const data = await opencode.sessions.list("/workspace");
          if (mountedRef.current) {
            const sorted = [...data].sort(
              (a, b) => b.time.updated - a.time.updated,
            );
            setAllSessions(sorted);
          }
        } catch {
          /* non-critical */
        }

        setActiveId(forked.id);
        persistActive(forked.id);
        return forked.id;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to fork session";
        setError(message);
        return null;
      }
    },
    [],
  );

  /* ---- share ---- */

  const share = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        setError(null);
        const result = await opencode.sessions.share(id);
        const url = result.share?.url ?? null;

        // Update local session with share URL
        if (url) {
          setAllSessions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, share: { url } } : s)),
          );
        }

        return url;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to share session";
        setError(message);
        return null;
      }
    },
    [],
  );

  /* ---- unshare ---- */

  const unshare = useCallback(async (id: string) => {
    try {
      setError(null);
      await opencode.sessions.unshare(id);

      setAllSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, share: undefined } : s)),
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to unshare session";
      setError(message);
    }
  }, []);

  /* ---- archive / unarchive ---- */

  const archive = useCallback(
    async (id: string) => {
      const session = allSessions.find((s) => s.id === id);

      if (session && supportsArchive(session)) {
        // V2: archive endpoint would go here — not available in V1.18.3
        // Placeholder for when the API is upgraded
        setError("Archive not supported by current API version");
        return;
      }

      // V1 fallback: treat as delete
      await remove(id);
    },
    [allSessions, remove],
  );

  const unarchive = useCallback(
    async (id: string) => {
      const session = allSessions.find((s) => s.id === id);

      if (session && supportsArchive(session)) {
        // V2: unarchive endpoint would go here
        setError("Unarchive not supported by current API version");
        return;
      }

      // V1 fallback: cannot recover deleted sessions — no-op
      setError("Unarchive not supported by current API version");
    },
    [allSessions],
  );

  /* ---- return ---- */

  return {
    sessions,
    archivedSessions,
    activeId,
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    create,
    rename,
    remove,
    select,
    fork,
    share,
    unshare,
    refresh,
    archive,
    unarchive,
  };
}
