import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import "./globals.css";
import "highlight.js/styles/github.css";
import "./hljs-dark.css";
import MainContainer from "./components/MainContainer";
import { SettingsLauncher, SettingsOverlay } from "./components/settings";
import ThemeProvider from "./components/ThemeProvider";
import ProjectDropdown from "./components/ProjectDropdown";
import Navigation, { NavigationProvider, NavigationTrigger } from "./components/Navigation";

/** Global metadata for the Ingenium Dashboard app. */
export const metadata: Metadata = {
  title: "Ingenium Dashboard",
  description: "Manage your AI agent skill system",
};

/**
 * Root layout — top bar with sidebar navigation and main content area.
 *
 * The inline `<script>` in `<head>` applies the correct `dark` class BEFORE
 * React hydrates, preventing a flash of unstyled content (FOUC) on page load.
 * It reads from both cookies (SSR-first) and localStorage (user preference)
 * with system-color-scheme fallback.
 *
 * Suspense boundaries around ProjectDropdown, SettingsLauncher, and
 * SettingsOverlay prevent blocking the main content during these async
 * component renders.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const htmlClass = themeCookie === "dark" ? "dark" : "";

  return (
    <html lang="en" className={htmlClass} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)theme=([^;]*)/);var c=m?m[1]:null;if(c==='dark')document.documentElement.classList.add('dark');else if(!c){var t=localStorage.getItem('theme')||'system';if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}document.documentElement.style.colorScheme=document.documentElement.classList.contains('dark')?'dark':'light'}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen bg-[var(--color-surface-muted)] text-[var(--color-text-primary)] overflow-x-hidden flex flex-col">
        <ThemeProvider>
        <NavigationProvider>
          <nav className="shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-6 py-3 flex items-center gap-4">
            <NavigationTrigger />
            <a href="/" className="font-bold text-lg text-[var(--color-text-primary)]">Ingenium</a>
            <div className="ml-auto flex items-center gap-3">
              <Suspense fallback={null}><ProjectDropdown /></Suspense>
              <Suspense fallback={null}><SettingsLauncher /></Suspense>
            </div>
          </nav>

          <div className="flex flex-1 min-h-0">
            <Navigation />
            <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-auto">
              <div className="flex-1 min-h-0 grid grid-rows-[1fr]">
                <MainContainer>
                  <Suspense>{children}</Suspense>
                </MainContainer>
              </div>
            </div>
          </div>

          <Suspense fallback={null}><SettingsOverlay /></Suspense>
        </NavigationProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
