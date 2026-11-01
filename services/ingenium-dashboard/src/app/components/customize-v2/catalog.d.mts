export interface CustomizeEntry {
  id: string; name: string; description: string; kind: "plugin" | "skill";
  connectionState?: "available"|"unavailable"|"proposal-review-required"|"archived"|"installed"|"disabled";
  catalog?: {sourceId:string;sourceSha256:string;sourceRevision:number;organizationId:string;projectId:string;apiProject:string;resourceId:string|null;targetName:string|null};
  scope: string; apiProject?: string; scopeKind?: "project" | "installation" | "public" | "personal" | "system"; revision?: number | null; actions?: string[]; scopeId?: string; category: string; installed: boolean; enabled: boolean; archived: boolean;
}
export function projectCatalog(project: string, plugins: {id: string; name: string; description?: string; enabled: boolean | number}[], skills: {id: string; name: string; description?: string; enabled: boolean | number; category?: string | null; archived_at?: string | null}[]): CustomizeEntry[];
export function visibleEntries(entries: CustomizeEntry[], kind: "plugin" | "skill", query?: string): CustomizeEntry[];
export function installationLabel(entry: CustomizeEntry): string;
export function scopedHref(path: string, project: string): string;

export interface CustomizeScopeBinding {
  id: string; kind: "project" | "installation"; label: string; apiProject: string;
}
export function resolveInstallationScope(projects: {id: string; name: string; is_global?: boolean | number; archived_at?: string | null}[]): CustomizeScopeBinding | null;
export function readCatalogScope(client: {
  plugins: {list(project: string): Promise<{data: {id: string; name: string; enabled: boolean | number; description?: string; project_id?: string}[]}>};
  skills: {list(project: string): Promise<{data: {id: string; name: string; enabled: boolean | number; description?: string; project_id?: string; category?: string | null; archived_at?: string | null}[]}>};
}, binding: CustomizeScopeBinding, kind: "plugin" | "skill"): Promise<CustomizeEntry[]>;
export function groupCatalogEntries(entries: CustomizeEntry[]): {category: string; entries: CustomizeEntry[]}[];
export function customizeViewIdentity(project: string | null, kind: "plugin" | "skill", sources?: {id: string; scopeIdentity: string}[]): string;
