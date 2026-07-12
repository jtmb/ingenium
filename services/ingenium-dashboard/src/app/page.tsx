"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

type Stat = { label: string; value: string };
type PageCard = { name: string; href: string; desc: string; icon: string };
type ColorSet = {
  bg: string;
  dmBg: string;
  accent: string;
  dmAccent: string;
  border: string;
  dmBorder: string;
};

const colorMap: Record<string, ColorSet> = {
  blue: {
    bg: "bg-blue-50",
    dmBg: "dark:bg-blue-900/30",
    accent: "bg-blue-400",
    dmAccent: "dark:bg-blue-600",
    border: "hover:border-blue-300",
    dmBorder: "dark:hover:border-blue-700",
  },
  purple: {
    bg: "bg-purple-50",
    dmBg: "dark:bg-purple-900/30",
    accent: "bg-purple-400",
    dmAccent: "dark:bg-purple-600",
    border: "hover:border-purple-300",
    dmBorder: "dark:hover:border-purple-700",
  },
  emerald: {
    bg: "bg-emerald-50",
    dmBg: "dark:bg-emerald-900/30",
    accent: "bg-emerald-400",
    dmAccent: "dark:bg-emerald-600",
    border: "hover:border-emerald-300",
    dmBorder: "dark:hover:border-emerald-700",
  },
  amber: {
    bg: "bg-amber-50",
    dmBg: "dark:bg-amber-900/30",
    accent: "bg-amber-400",
    dmAccent: "dark:bg-amber-600",
    border: "hover:border-amber-300",
    dmBorder: "dark:hover:border-amber-700",
  },
};

function Section({
  title,
  pages,
  color,
}: {
  title: string;
  pages: PageCard[];
  color: ColorSet;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1 text-gray-700 dark:text-gray-300">
        {title}
      </h2>
      <div
        className={`w-12 h-0.5 ${color.accent} ${color.dmAccent} mb-3 rounded-full`}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {pages.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className={`group bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6 hover:shadow-xl ${color.border} ${color.dmBorder} hover:-translate-y-0.5 transition-all duration-200`}
          >
            <div
              className={`w-10 h-10 ${color.bg} ${color.dmBg} rounded-lg flex items-center justify-center text-xl mb-3 group-hover:scale-110 transition-transform`}
            >
              {p.icon}
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              {p.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {p.desc}
            </p>
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
    <div className="space-y-10">
      {/* Hero */}
      <div className="text-center py-8">
        <h1 className="text-4xl font-bold dark:text-gray-100">Ingenium</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-xl mx-auto">
          Complete AI agent development workspace. Skills, self-learning,
          kanban, email, MCP tools — all local, all pluggable.
        </p>
      </div>

      {/* Live stats band */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center hover:shadow-lg transition-shadow"
          >
            <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
              {s.value}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Feature cards */}
      <Section title="Build" pages={buildPages} color={colorMap.blue!} />
      <Section title="Learn" pages={learnPages} color={colorMap.purple!} />
      <Section title="Connect" pages={connectPages} color={colorMap.emerald!} />
      <Section title="Operate" pages={operatePages} color={colorMap.amber!} />
    </div>
  );
}
