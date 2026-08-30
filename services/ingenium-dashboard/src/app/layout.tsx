import type { Metadata } from "next";
import { cookies } from "next/headers";
import Script from "next/script";
import "./globals.css";
import "highlight.js/styles/github.css";
import "./hljs-dark.css";
import ThemeProvider from "./components/ThemeProvider";
import DashboardShell from "./components/DashboardShell";

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
 * ProjectProvider resolves and validates the active namespace before mounting
 * dashboard content, while its Suspense boundary handles URL project selection.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const htmlClass = themeCookie === "dark" ? "dark" : "";

  return (
    <html lang="en" className={`${htmlClass} h-full`} data-nav-compact="false" suppressHydrationWarning>
      <head>
        <Script src="/navigation-prepaint.js" strategy="beforeInteractive" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)theme=([^;]*)/);var c=m?m[1]:null;if(c==='dark')document.documentElement.classList.add('dark');else if(!c){var t=localStorage.getItem('theme')||'system';if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}document.documentElement.style.colorScheme=document.documentElement.classList.contains('dark')?'dark':'light'}catch(e){}})()`,
          }}
        />
      </head>
      <body className="h-dvh bg-[var(--color-surface-muted)] text-[var(--color-text-primary)] overflow-x-hidden flex flex-col">
        <ThemeProvider>
          <DashboardShell>{children}</DashboardShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
