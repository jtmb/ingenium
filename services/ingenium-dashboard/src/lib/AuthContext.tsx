"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setSessionCsrfToken, type AuthSessionState } from "./api";

type AuthState = AuthSessionState & { refresh: () => Promise<void> };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setError(false);
    try {
      setSession((await api.auth.session()).data);
    } catch (failure) {
      setError(true);
      throw failure;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.auth.session()
      .then(({ data }) => { if (!cancelled) setSession(data); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <main className="flex min-h-dvh items-center justify-center p-6"><div role="alert" className="max-w-md rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-5 text-center"><p>Unable to load your account. Check the service and try again.</p><button type="button" onClick={() => { void refresh().catch(() => undefined); }} className="mt-4 rounded bg-blue-600 px-4 py-2 text-white">Retry</button></div></main>;
  if (!session) return <main className="flex min-h-dvh items-center justify-center" aria-busy="true"><p>Loading your account…</p></main>;
  return <AuthContext.Provider value={{ ...session, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function useOptionalAuth(): AuthState | null { return useContext(AuthContext); }

export async function logout(): Promise<void> {
  await api.auth.logout();
  setSessionCsrfToken(null);
  window.location.assign("/login");
}
