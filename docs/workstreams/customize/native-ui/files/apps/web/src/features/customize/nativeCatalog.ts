/** Read-only projections of the existing native owners; no resource registry. */
export type NativeKind = "plugin" | "skill";
export type NativeScope = Readonly<{ serviceInstanceId: string; projectId: string; projectRevision: number }>;
export type NativeEntry = Readonly<{
  key: string; id: string; kind: NativeKind; name: string; description: string;
  present: boolean; enabled: boolean | null; state: string; activation: string;
  version?: string; path?: string; reason?: string;
}>;
export type NativeCatalog = Readonly<{ entries: readonly NativeEntry[]; revision: string; supported: boolean; reason: string | null }>;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function owner(v: unknown, scope: NativeScope): asserts v is Record<string, unknown> {
  if (!record(v) || !nonempty(scope.serviceInstanceId) || !nonempty(scope.projectId) || !integer(scope.projectRevision)
    || v.service_instance_id !== scope.serviceInstanceId || v.project_id !== scope.projectId || v.project_revision !== scope.projectRevision) {
    throw new Error("The catalog does not match the current service and saved project revision.");
  }
}
export function nativeCatalogPath(kind: NativeKind, scope: NativeScope): string {
  if (!["plugin", "skill"].includes(kind) || !nonempty(scope.serviceInstanceId) || !nonempty(scope.projectId) || !integer(scope.projectRevision)) throw new Error("An exact native resource owner is required.");
  const query = new URLSearchParams({project_id: scope.projectId, project_revision: String(scope.projectRevision)});
  return (kind === "plugin" ? "/v1/plugin-packages/" : "/v1/extension-config/skill-workspace") + "?" + query;
}
export function decodeNativeCatalog(kind: NativeKind, value: unknown, scope: NativeScope): NativeCatalog {
  owner(value, scope);
  const seen = new Set<string>();
  const unique = (key: string) => { if (seen.has(key)) throw new Error("The service returned duplicate catalog identities."); seen.add(key); };
  if (kind === "plugin") {
    if (!integer(value.revision) || typeof value.engine_stopped !== "boolean" || typeof value.restart_required !== "boolean"
      || !Array.isArray(value.packages) || value.packages.length > 4096) throw new Error("The native plugin registry is incomplete.");
    const entries = value.packages.map((row): NativeEntry => {
      if (!record(row) || !nonempty(row.id) || !nonempty(row.selected_sha256) || typeof row.enabled !== "boolean"
        || typeof row.removed !== "boolean" || !Array.isArray(row.versions) || !nonempty(row.activation)) throw new Error("Invalid plugin registration.");
      const selected = row.versions.filter(v => record(v) && v.sha256 === row.selected_sha256);
      if (selected.length !== 1 || !record(selected[0]) || !record(selected[0].manifest)) throw new Error("The selected plugin version is unavailable.");
      const manifest = selected[0].manifest;
      if (manifest.id !== row.id || !nonempty(manifest.version) || !nonempty(manifest.license)) throw new Error("The selected plugin manifest is inconsistent.");
      unique(row.id);
      return {key: "plugin:" + row.id, id: row.id, kind, name: row.id, version: manifest.version,
        description: "Version " + manifest.version + " · " + manifest.license,
        present: !row.removed, enabled: row.removed ? false : row.enabled,
        state: row.removed ? "Unregistered · versions retained" : row.enabled ? "Registered" : "Registered · disabled",
        activation: row.activation};
    });
    return {entries, revision: String(value.revision), supported: true, reason: null};
  }
  if (kind !== "skill" || typeof value.revision !== "string" || typeof value.supported !== "boolean"
    || !(value.reason === undefined || value.reason === null || typeof value.reason === "string")
    || !Array.isArray(value.skills) || value.skills.length > 256) throw new Error("The project skill source snapshot is incomplete.");
  const entries = value.skills.map((row): NativeEntry => {
    if (!record(row) || !nonempty(row.id) || typeof row.name !== "string" || typeof row.description !== "string"
      || typeof row.path !== "string" || typeof row.content !== "string" || new TextEncoder().encode(row.content).length > 64 * 1024 || typeof row.editable !== "boolean"
      || !(row.reason === undefined || row.reason === null || typeof row.reason === "string")
      || ![".agents/skills/" + row.id + "/SKILL.md", ".opencode/skills/" + row.id + "/SKILL.md"].includes(row.path)) throw new Error("Invalid project skill source.");
    unique(row.path);
    return {key: "skill:" + row.path, id: row.id, kind, name: row.name || row.id, description: row.description,
      present: true, enabled: null, path: row.path, reason: row.reason ?? undefined,
      state: row.editable ? "Project source" : "Project source · read-only",
      activation: "Engine activation is not reported by this source catalog."};
  });
  return {entries, revision: value.revision, supported: value.supported, reason: typeof value.reason === "string" ? value.reason : null};
}
export function filterNativeEntries(entries: readonly NativeEntry[], query: string): NativeEntry[] {
  const term = query.trim().toLocaleLowerCase();
  return entries.filter(row => !term || [row.name, row.id, row.description, row.state].some(v => v.toLocaleLowerCase().includes(term)));
}
export function nativeOwnerKey(scope: NativeScope, environment: unknown): string {
  return JSON.stringify([scope.serviceInstanceId, scope.projectId, scope.projectRevision, environment]);
}

export type HostedGovernanceBinding = Readonly<{
  serviceInstanceId: string; projectId: string | null; projectRevision: number | null;
  actorId: string; installationId: string; hostedProjectId: string | null;
}>;
export function hostedGovernanceMatches(binding: HostedGovernanceBinding | undefined, service: string,
  project: Readonly<{id: string; revision: number; archived: boolean}> | null, connected: boolean): boolean {
  return !!(connected && nonempty(service) && binding && binding.serviceInstanceId === service
    && nonempty(binding.actorId) && nonempty(binding.installationId)
    && (binding.hostedProjectId === null || nonempty(binding.hostedProjectId))
    && (project ? !project.archived && binding.projectId === project.id && binding.projectRevision === project.revision
      : binding.projectId === null && binding.projectRevision === null));
}
