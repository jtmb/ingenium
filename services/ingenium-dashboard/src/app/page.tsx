import Link from "next/link";

/**
 * Landing page — displays a grid of navigation cards linking to each management section.
 * Each card shows the section name and a brief description.
 */
export default function Home() {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Ingenium Dashboard</h1>
      <p className="text-gray-600">Manage your AI agent skill system, learnings, tasks, and MCP servers.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/projects" className="p-6 bg-white rounded-lg border hover:shadow-md transition-shadow">
          <h2 className="font-semibold text-lg">Projects</h2>
          <p className="text-sm text-gray-500">Manage projects and their configurations</p>
        </Link>
        <Link href="/skills" className="p-6 bg-white rounded-lg border hover:shadow-md transition-shadow">
          <h2 className="font-semibold text-lg">Skills</h2>
          <p className="text-sm text-gray-500">Browse, search, and edit skills</p>
        </Link>
        <Link href="/learnings" className="p-6 bg-white rounded-lg border hover:shadow-md transition-shadow">
          <h2 className="font-semibold text-lg">Learnings</h2>
          <p className="text-sm text-gray-500">View and search learning entries</p>
        </Link>
        <Link href="/tasks" className="p-6 bg-white rounded-lg border hover:shadow-md transition-shadow">
          <h2 className="font-semibold text-lg">Tasks</h2>
          <p className="text-sm text-gray-500">Track and manage tasks</p>
        </Link>
        <Link href="/plugins" className="p-6 bg-white rounded-lg border hover:shadow-md transition-shadow">
          <h2 className="font-semibold text-lg">Plugins</h2>
          <p className="text-sm text-gray-500">Enable and disable plugins</p>
        </Link>
        <Link href="/agents" className="p-6 bg-white rounded-lg border hover:shadow-md transition-shadow">
          <h2 className="font-semibold text-lg">Agents</h2>
          <p className="text-sm text-gray-500">Manage AI agents — create, edit, enable, or delete agent definitions synced to OpenCode</p>
        </Link>
        <Link href="/servers" className="p-6 bg-white rounded-lg border hover:shadow-md transition-shadow">
          <h2 className="font-semibold text-lg">Servers</h2>
          <p className="text-sm text-gray-500">Manage MCP server configurations</p>
        </Link>
      </div>
    </div>
  );
}
