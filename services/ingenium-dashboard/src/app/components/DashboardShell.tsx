"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AuthProvider } from "@/lib/AuthContext";
import { OrganizationProvider } from "@/lib/OrganizationContext";
import { ProjectProvider } from "@/lib/ProjectContext";
import { RuntimeProvider } from "@/lib/RuntimeContext";
import MainContainer from "./MainContainer";
import Navigation, { NavigationProvider, NavigationTrigger } from "./Navigation";
import ProjectDropdown from "./ProjectDropdown";
import { SettingsLauncher, SettingsOverlay } from "./settings";
import UserMenu from "./UserMenu";
import VeyraBrand from "./VeyraBrand";
import WorkspaceModeSwitch from "./WorkspaceModeSwitch";

const PUBLIC_ROUTES = ["/login", "/bootstrap", "/forgot-password", "/reset-password", "/verify-email", "/invitation", "/mfa", "/auth/oidc/callback"];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (PUBLIC_ROUTES.includes(pathname)) return children;
  const isChatRoute = pathname === "/chat" || Boolean(pathname?.startsWith("/chat/"));
  return <AuthProvider><OrganizationProvider><ProjectProvider><RuntimeProvider><NavigationProvider>
    <header data-nav-background="topbar" className="veyra-topbar relative shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 py-2 sm:px-4 flex items-center gap-3">
      <NavigationTrigger /><Link href="/" aria-label="Veyra home"><VeyraBrand /></Link>
      <WorkspaceModeSwitch />
      <div className={`ml-auto flex min-w-0 items-center gap-2 ${isChatRoute ? "" : "shrink-0"}`}><ProjectDropdown /><SettingsLauncher /><UserMenu /></div>
    </header>
    <div className="flex flex-1 min-h-0 min-w-0"><Navigation /><div data-nav-background="content" className="flex flex-col flex-1 min-w-0 min-h-0 overflow-auto"><div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)]"><MainContainer><Suspense>{children}</Suspense></MainContainer></div></div></div>
    <SettingsOverlay />
  </NavigationProvider></RuntimeProvider></ProjectProvider></OrganizationProvider></AuthProvider>;
}
