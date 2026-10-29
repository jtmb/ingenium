export function projectCatalog(project, plugins, skills) {
  if (typeof project !== "string" || !project.trim()) throw new Error("Select an authorized project.");
  return [
    ...plugins.map((row) => ({
      id: row.id, name: row.name, description: row.description ?? "",
      kind: "plugin", scope: project, category: "Local plugins", installed: true,
      enabled: row.enabled === true || row.enabled === 1, archived: false,
    })),
    ...skills.map((row) => ({
      id: row.id, name: row.name, description: row.description ?? "",
      kind: "skill", scope: project, category: row.category || "Project skills",
      installed: true, enabled: row.enabled === true || row.enabled === 1,
      archived: Boolean(row.archived_at),
    })),
  ];
}

export function visibleEntries(entries, kind, query = "") {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => entry.kind === kind &&
    (!needle || [entry.name, entry.description, entry.scope].some((text) => text.toLocaleLowerCase().includes(needle))))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function installationLabel(entry) {
  if (!entry.installed) return "Available";
  if (entry.archived) return "Archived";
  return entry.enabled ? "Installed" : "Installed · disabled";
}

export function scopedHref(path, project) {
  if (!project?.trim()) throw new Error("Select an authorized project.");
  const url = new URL(path, "https://veyra.invalid");
  if (url.origin !== "https://veyra.invalid" || !url.pathname.startsWith("/")) throw new Error("Use an internal route.");
  url.searchParams.set("project", project);
  return url.pathname + url.search;
}
