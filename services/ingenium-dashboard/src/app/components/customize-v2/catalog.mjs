export function projectCatalog(project, plugins, skills) {
  if (typeof project !== "string" || !project.trim()) throw new Error("Select an authorized project.");
  return [
    ...plugins.map((row) => ({
      id: row.id, name: row.name, description: row.description ?? "",
      kind: "plugin", scope: project, apiProject: project, scopeKind: "project", category: "Local plugins", installed: true,
      enabled: row.enabled === true || row.enabled === 1, archived: false,
    })),
    ...skills.map((row) => ({
      id: row.id, name: row.name, description: row.description ?? "",
      kind: "skill", scope: project, apiProject: project, scopeKind: "project", category: row.category || "Project skills",
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

/** Uses the server's explicit legacy installation mapping; never guesses by name. */
export function resolveInstallationScope(projects) {
  const matches = projects.filter((row) => (row.is_global === true || row.is_global === 1) && !row.archived_at);
  if (matches.length > 1) throw new Error("Installation resource mapping is ambiguous.");
  if (matches.length === 0) return null;
  const row = matches[0];
  if (typeof row.id !== "string" || !row.id || typeof row.name !== "string" || !row.name.trim()) {
    throw new Error("Installation resource mapping is invalid.");
  }
  return { id: row.id, kind: "installation", label: "System", apiProject: row.name };
}

export async function readCatalogScope(client, binding, kind) {
  if (!binding || !["project", "installation"].includes(binding.kind) ||
      typeof binding.id !== "string" || !binding.id ||
      typeof binding.apiProject !== "string" || !binding.apiProject.trim() ||
      !["plugin", "skill"].includes(kind)) {
    throw new Error("An explicit authorized resource scope is required.");
  }
  const response = kind === "plugin"
    ? await client.plugins.list(binding.apiProject)
    : await client.skills.list(binding.apiProject);
  if (!Array.isArray(response.data) || response.data.some((row) =>
    row.project_id !== undefined && row.project_id !== binding.id)) {
    throw new Error("Catalog response does not match the requested resource scope.");
  }
  return projectCatalog(binding.apiProject,
    kind === "plugin" ? response.data : [],
    kind === "skill" ? response.data : []).map((row) => ({
      ...row, scope: binding.label, apiProject: binding.apiProject,
      scopeKind: binding.kind, scopeId: binding.id,
    }));
}
export function groupCatalogEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const category = entry.category || "Other";
    const group = groups.get(category);
    if (group) group.push(entry);
    else groups.set(category, [entry]);
  }
  return [...groups].map(([category, entries]) => ({ category, entries }));
}
export function customizeViewIdentity(project, kind, sources = []) {
  if (project !== null && (typeof project !== "string" || !project.trim())) {
    throw new Error("Projectless Customize requires explicit null.");
  }
  if (!["plugin", "skill"].includes(kind)) throw new Error("Invalid resource kind.");
  return JSON.stringify([project, kind, sources.map((source) => [source.id, source.scopeIdentity])]);
}
