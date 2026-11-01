"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { AuthProvider } from "@/lib/AuthContext";
import { OrganizationProvider } from "@/lib/OrganizationContext";
import { ProjectProvider } from "@/lib/ProjectContext";
import { RuntimeProvider } from "@/lib/RuntimeContext";
import { NavigationProvider } from "./Navigation";
import ProjectDropdown from "./ProjectDropdown";
import SiteChrome from "./SiteChrome";

const PUBLIC_ROUTES = ["/login", "/bootstrap", "/forgot-password", "/reset-password", "/verify-email", "/invitation", "/mfa", "/auth/oidc/callback"];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (PUBLIC_ROUTES.includes(pathname)) return children;
  const savedHistory = pathname === "/work/history";
  const work = pathname === "/work" || savedHistory;
  const projectlessWork = savedHistory || work && !params.has("project");
  const customize = pathname === "/customize" || pathname.startsWith("/customize/");
  return <AuthProvider><OrganizationProvider><ProjectProvider projectless={projectlessWork}><RuntimeProvider projectless={projectlessWork}><NavigationProvider>
    <SiteChrome projectControl={!work && !customize ? <ProjectDropdown /> : undefined}>{children}</SiteChrome>
  </NavigationProvider></RuntimeProvider></ProjectProvider></OrganizationProvider></AuthProvider>;
}
