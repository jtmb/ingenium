"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

type Stat = { label: string; value: string };
type PageCard = { name: string; href: string; desc: string; icon: string };

function Section({ title, pages }: { title: string; pages: PageCard[] }) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 dark:text-gray-100">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {pages.map(p => (
          <Link
            key={p.href}
            href={p.href}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow"
          >
            <h3 className="font-semibold text-blue-600 dark:text-blue-400">{p.icon} {p.name}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{p.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Landing page — dashboard-style hybrid with live stats, hero, and grouped feature cards.
 * Fetches counts from the API on mount.
 */
export default function Home() {
  const [stats, setStats] = useState<Stat[]>([
    { label: "Projects", value: "..." },
    { label: "Skills", value: "..." },
    { label: "Tasks", value: "..." },
    { label: "Observations", value: "..." },
    { label: "Pipeline Events", value: "..." },
    { label: "Agents", value: "..." },
  ]);

  useEffect(() => {
    const BASE = "http://localhost:4097/api/v1";
    const P = "gh-llm-bootstrap";

    (async () => {
      const s: Stat[] = [];
      for (const [url, label, fn] of [
        [`${BASE}/projects`, "Projects", (d: any) => String(d.data?.length ?? "—")] as const,
        [`${BASE}/skills?project=${P}`, "Skills", (d: any) => String(d.data?.length ?? "—")] as const,
        [`${BASE}/tasks?project=${P}`, "Tasks", (d: any) => String(d.data?.length ?? "—")] as const,
        [`${BASE}/observations/stats?project=${P}`, "Observations", (d: any) => String(d.data?.total ?? "—")] as const,
        [`${BASE}/pipeline/events?project=${P}&limit=1`, "Pipeline Events", (d: any) => String(d.total ?? "—")] as const,
        [`${BASE}/agents?project=${P}`, "Agents", (d: any) => String(d.data?.length ?? "—")] as const,
      ]) {
        try {
          const r = await fetch(url);
          const d = await r.json();
          s.push({ label, value: fn(d) });
        } catch {
          s.push({ label, value: "—" });
        }
      }
      setStats(s);
    })();
  }, []);

  const buildPages: PageCard[] = [
    { name: "OpenCode", href: "/opencode", desc: "Embedded AI workspace", icon: "🖥️" },
    { name: "Projects", href: "/projects", desc: "Multi-project config", icon: "📁" },
    { name: "Tasks", href: "/tasks", desc: "Kanban board", icon: "📋" },
    { name: "Jobs", href: "/jobs", desc: "Agent job scheduler", icon: "⚡" },
  ];

  const learnPages: PageCard[] = [
    { name: "Skills", href: "/skills", desc: "Convention engine", icon: "📚" },
    { name: "Observations", href: "/observations", desc: "Behavior log", icon: "👁️" },
    { name: "Personality", href: "/personality", desc: "Learned profile", icon: "🧬" },
    { name: "Pipeline", href: "/pipeline", desc: "Event timeline", icon: "🕐" },
  ];

  const connectPages: PageCard[] = [
    { name: "Mail", href: "/mail", desc: "Email client", icon: "📧" },
    { name: "Agents", href: "/agents", desc: "Agent profiles", icon: "👤" },
    { name: "MCP", href: "/mcp-servers", desc: "Server+Tool mgr", icon: "🖥️" },
    { name: "Plugins", href: "/plugins", desc: "Extensions", icon: "🔌" },
  ];

  const operatePages: PageCard[] = [
    { name: "Logs", href: "/logs", desc: "Live log stream", icon: "📜" },
    { name: "Config", href: "/config", desc: "JSONC editor", icon: "🔧" },
    { name: "Settings", href: "/settings", desc: "System prefs", icon: "⚙️" },
  ];

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center py-8">
        <h1 className="text-4xl font-bold dark:text-gray-100">Ingenium</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-xl mx-auto">
          Complete AI agent development workspace. Skills, self-learning, kanban, email, MCP tools — all local, all pluggable.
        </p>
      </div>

      {/* Live stats band */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map(s => (
          <div
            key={s.label}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-center hover:shadow-md transition-shadow"
          >
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{s.value}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Feature cards */}
      <Section title="Build" pages={buildPages} />
      <Section title="Learn" pages={learnPages} />
      <Section title="Connect" pages={connectPages} />
      <Section title="Operate" pages={operatePages} />
    </div>
  );
}
