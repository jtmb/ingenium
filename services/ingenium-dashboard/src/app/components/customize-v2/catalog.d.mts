export interface CustomizeEntry {
  id: string; name: string; description: string; kind: "plugin" | "skill";
  scope: string; category: string; installed: boolean; enabled: boolean; archived: boolean;
}
export function projectCatalog(project: string, plugins: {id: string; name: string; description?: string; enabled: boolean | number}[], skills: {id: string; name: string; description?: string; enabled: boolean | number; category?: string | null; archived_at?: string | null}[]): CustomizeEntry[];
export function visibleEntries(entries: CustomizeEntry[], kind: "plugin" | "skill", query?: string): CustomizeEntry[];
export function installationLabel(entry: CustomizeEntry): string;
export function scopedHref(path: string, project: string): string;
