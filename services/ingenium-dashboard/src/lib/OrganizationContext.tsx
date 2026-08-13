"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type OrganizationSummary } from "./api";

const OrganizationContext = createContext<{ organizations: OrganizationSummary[]; active: OrganizationSummary | null } | null>(null);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  useEffect(() => { void api.organizations.list().then(({ data }) => setOrganizations(data)); }, []);
  return <OrganizationContext.Provider value={{ organizations, active: organizations[0] ?? null }}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const value = useContext(OrganizationContext);
  if (!value) throw new Error("useOrganization must be used inside OrganizationProvider");
  return value;
}
