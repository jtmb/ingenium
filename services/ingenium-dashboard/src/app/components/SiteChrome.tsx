"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import MainContainer from "./MainContainer";
import Navigation, { NavigationTrigger } from "./Navigation";
import { SettingsLauncher, SettingsOverlay } from "./settings";
import UserMenu from "./UserMenu";
import VeyraBrand from "./VeyraBrand";
import WorkspaceModeSwitch from "./WorkspaceModeSwitch";

/** The same outer header and navigation for every authenticated Veyra page.
 * Route components own only their content and contextual panels. */
export default function SiteChrome({ children, projectControl }: { children: ReactNode; projectControl?: ReactNode }) {
  return <>
    <header data-nav-background="topbar" className="veyra-topbar relative shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 py-2 sm:px-4 flex items-center gap-3">
      <NavigationTrigger /><Link href="/" aria-label="Veyra home"><VeyraBrand /></Link>
      <WorkspaceModeSwitch />
      <div className="ml-auto flex min-w-0 items-center gap-2">{projectControl}<SettingsLauncher /><UserMenu /></div>
    </header>
    <div className="flex flex-1 min-h-0 min-w-0">
      <Navigation />
      <div data-nav-background="content" className="flex flex-col flex-1 min-w-0 min-h-0 overflow-auto">
        <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)]">
          <MainContainer><Suspense>{children}</Suspense></MainContainer>
        </div>
      </div>
    </div>
    <SettingsOverlay />
  </>;
}
