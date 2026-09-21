"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type OrganizationSummary } from "./api";

const OrganizationContext = createContext<{ organizations: OrganizationSummary[]; active: OrganizationSummary | null } | null>(null);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try {
      setOrganizations((await api.organizations.list()).data);
    } catch (failure) {
      setError(true);
      throw failure;
    }
  }, []);
  useEffect(() => { void load().catch(() => undefined); }, [load]);
  if (error) return <main className="flex min-h-dvh items-center justify-center p-6"><div role="alert" className="max-w-md rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-5 text-center"><p>Unable to load your organizations. Check the service and try again.</p><button type="button" onClick={() => { void load().catch(() => undefined); }} className="mt-4 rounded bg-blue-600 px-4 py-2 text-white">Retry</button></div></main>;
  return <OrganizationContext.Provider value={{ organizations, active: organizations[0] ?? null }}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const value = useContext(OrganizationContext);
  if (!value) throw new Error("useOrganization must be used inside OrganizationProvider");
  return value;
}
