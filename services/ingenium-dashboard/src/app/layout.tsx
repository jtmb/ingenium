import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import "highlight.js/styles/github.css";
import "./hljs-dark.css";
import MainContainer from "./components/MainContainer";
import OpenCodeFrame from "./components/OpenCodeFrame";
import ProjectSelector from "./components/ProjectSelector";
import ThemeProvider from "./components/ThemeProvider";
import ThemeToggle from "./components/ThemeToggle";

/** Global metadata for the Ingenium Dashboard app. */
export const metadata: Metadata = {
  title: "Ingenium Dashboard",
  description: "Manage your AI agent skill system",
};

/** Root layout — includes the top navigation bar and wraps all page content. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'system';if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen bg-[var(--color-surface-muted)] text-[var(--color-text-primary)] overflow-x-hidden">
        <ThemeProvider>
        <nav className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href="/" className="font-bold text-lg">Ingenium</a>
          <a href="/opencode" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">OpenCode</a>
          <span className="text-gray-300">|</span>
          <a href="/projects" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Projects</a>
          <a href="/skills" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Skills</a>
          <a href="/tasks" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Tasks</a>
          <a href="/jobs" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Jobs</a>
          <a href="/plugins" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Plugins</a>
          <a href="/mail" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Mail</a>
          <a href="/agents" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Agents</a>
          <a href="/mcp-servers" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">MCP</a>
          <a href="/config" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Config</a>
          <a href="/observations" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Observations</a>
          <a href="/personality" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Personality</a>
          <a href="/pipeline" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Pipeline</a>
          <a href="/logs" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Logs</a>
          <a href="/settings" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">Settings</a>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <Suspense><ProjectSelector /></Suspense>
          </div>
        </nav>
        <MainContainer>
          <Suspense>{children}</Suspense>
        </MainContainer>
        <OpenCodeFrame />
        </ThemeProvider>
      </body>
    </html>
  );
}
