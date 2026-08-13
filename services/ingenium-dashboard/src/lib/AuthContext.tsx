"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setSessionCsrfToken, type AuthSessionState } from "./api";

type AuthState = AuthSessionState & { refresh: () => Promise<void> };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSessionState | null>(null);

  async function refresh() {
    setSession((await api.auth.session()).data);
  }

  useEffect(() => {
    let cancelled = false;
    void api.auth.session().then(({ data }) => { if (!cancelled) setSession(data); });
    return () => { cancelled = true; };
  }, []);

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
