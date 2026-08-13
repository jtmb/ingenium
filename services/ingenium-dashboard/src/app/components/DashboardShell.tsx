"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AuthProvider } from "@/lib/AuthContext";
import { OrganizationProvider } from "@/lib/OrganizationContext";
import { ProjectProvider } from "@/lib/ProjectContext";
import MainContainer from "./MainContainer";
import Navigation, { NavigationProvider, NavigationTrigger } from "./Navigation";
import ProjectDropdown from "./ProjectDropdown";
import { SettingsLauncher, SettingsOverlay } from "./settings";
import UserMenu from "./UserMenu";

const PUBLIC_ROUTES = ["/login", "/bootstrap", "/forgot-password", "/reset-password", "/verify-email", "/invitation", "/mfa", "/auth/oidc/callback"];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (PUBLIC_ROUTES.includes(pathname)) return children;
  return <AuthProvider><OrganizationProvider><ProjectProvider><NavigationProvider>
    <nav data-nav-background="topbar" className="shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 py-3 sm:px-6 flex items-center gap-3">
      <NavigationTrigger /><Link href="/" className="font-bold text-lg text-[var(--color-text-primary)]">Ingenium</Link>
      <div className="ml-auto flex min-w-0 items-center gap-2"><ProjectDropdown /><SettingsLauncher /><UserMenu /></div>
    </nav>
    <div className="flex flex-1 min-h-0 min-w-0"><Navigation /><div data-nav-background="content" className="flex flex-col flex-1 min-w-0 min-h-0 overflow-auto"><div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)]"><MainContainer><Suspense>{children}</Suspense></MainContainer></div></div></div>
    <SettingsOverlay />
  </NavigationProvider></ProjectProvider></OrganizationProvider></AuthProvider>;
}
