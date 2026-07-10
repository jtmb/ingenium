import type { Metadata } from "next";
import "./globals.css";
import "highlight.js/styles/github.css";
import "./hljs-dark.css";
import OpenCodeFrame from "./components/OpenCodeFrame";

/** Global metadata for the Ingenium Dashboard app. */
export const metadata: Metadata = {
  title: "Ingenium Dashboard",
  description: "Manage your AI agent skill system",
};

/** Root layout — includes the top navigation bar and wraps all page content. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
          <a href="/" className="font-bold text-lg">Ingenium</a>
          <a href="/projects" className="text-sm text-gray-600 hover:text-gray-900">Projects</a>
          <a href="/archive" className="text-sm text-gray-600 hover:text-gray-900">Archive</a>
          <a href="/skills" className="text-sm text-gray-600 hover:text-gray-900">Skills</a>
          <a href="/learnings" className="text-sm text-gray-600 hover:text-gray-900">Learnings</a>
          <a href="/tasks" className="text-sm text-gray-600 hover:text-gray-900">Tasks</a>
          <a href="/plugins" className="text-sm text-gray-600 hover:text-gray-900">Plugins</a>
          <a href="/agents" className="text-sm text-gray-600 hover:text-gray-900">Agents</a>
          <a href="/servers" className="text-sm text-gray-600 hover:text-gray-900">Servers</a>
          <a href="/settings" className="text-sm text-gray-600 hover:text-gray-900">Settings</a>
          <a href="/opencode" className="text-sm text-gray-600 hover:text-gray-900">OpenCode</a>
        </nav>
        <main className="p-6 max-w-6xl mx-auto">{children}</main>
        <OpenCodeFrame />
      </body>
    </html>
  );
}
