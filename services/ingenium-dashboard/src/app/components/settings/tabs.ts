export interface SettingsTab {
  id: string;
  label: string;
  icon: "settings" | "folder" | "sparkle" | "check" | "clock" | "puzzle" | "mail" | "bot" | "server" | "file" | "eye" | "user" | "activity" | "terminal";
}

export const ALL_TABS: SettingsTab[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "projects", label: "Projects", icon: "folder" },
  { id: "skills", label: "Skills", icon: "sparkle" },
  { id: "tasks", label: "Tasks", icon: "check" },
  { id: "jobs", label: "Jobs", icon: "clock" },
  { id: "plugins", label: "Plugins", icon: "puzzle" },
  { id: "mail", label: "Mail", icon: "mail" },
  { id: "agents", label: "Agents", icon: "bot" },
  { id: "mcp-servers", label: "MCP", icon: "server" },
  { id: "config", label: "Config", icon: "file" },
  { id: "observations", label: "Observations", icon: "eye" },
  { id: "personality", label: "Personality", icon: "user" },
  { id: "pipeline", label: "Pipeline", icon: "activity" },
  { id: "logs", label: "Logs", icon: "terminal" },
];

export function tabForPathname(pathname: string): string {
  const segment = pathname.split("/")[1] || "";
  const MAP: Record<string, string> = {
    "": "general",
    projects: "projects",
    skills: "skills",
    tasks: "tasks",
    jobs: "jobs",
    plugins: "plugins",
    mail: "mail",
    agents: "agents",
    "mcp-servers": "mcp-servers",
    config: "config",
    observations: "observations",
    personality: "personality",
    pipeline: "pipeline",
    logs: "logs",
    status: "general",
    settings: "general",
    opencode: "general",
  };
  return MAP[segment] ?? "general";
}
