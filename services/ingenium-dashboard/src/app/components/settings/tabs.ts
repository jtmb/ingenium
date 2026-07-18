/** A settings sidebar tab definition. Icon names map to SVG paths in SettingsSidebar. */
export interface SettingsTab {
  id: string;
  label: string;
  icon: "settings" | "folder" | "sparkle" | "check" | "clock" | "puzzle" | "mail" | "bot" | "server" | "file" | "eye" | "user" | "activity" | "terminal";
}

/** Ordered list of all settings tabs — drives both the sidebar and the overlay's tab-panel routing. */
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
  { id: "providers", label: "Providers", icon: "sparkle" },
  { id: "logs", label: "Logs", icon: "terminal" },
];

/**
 * Derive the settings tab to auto-select when the overlay opens, based on the
 * current page the user is on. Pages like `/status`, `/settings`, and `/opencode`
 * don't have their own settings tab so they fall back to "general".
 *
 * This enables deep-linking: clicking the gear icon on any page opens Settings
 * with the most relevant tab pre-selected.
 */
export function tabForPathname(pathname: string): string {
  const segment = pathname.split("/")[1] || "";
  const MAP: Record<string, string> = {
    "": "general",
    projects: "general",
    skills: "general",
    tasks: "general",
    jobs: "general",
    plugins: "general",
    mail: "mail",
    agents: "general",
    "mcp-servers": "general",
    config: "config",
    observations: "general",
    personality: "general",
    pipeline: "providers",
    providers: "providers",
    logs: "general",
    status: "general",
    settings: "general",
    opencode: "general",
  };
  return MAP[segment] ?? "general";
}
