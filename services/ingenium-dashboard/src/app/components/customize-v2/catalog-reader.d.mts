import type { CustomizeEntry } from "./catalog.mjs";
export interface CatalogReadBinding {
  projectId: string; apiProject: string; visibility: "project" | "public" | "personal" | "system";
  selectorId?: "project" | "public" | "personal" | "system";
  scopeIdentity: string; label: string;
}
export function createCatalogPageReader(
  request: <T>(path: string, options?: RequestInit) => Promise<T>,
  binding: CatalogReadBinding,
): (kind: "plugin" | "skill") => Promise<CustomizeEntry[]>;

export function resolveHostedCatalogBindings(projects: {id: string; name: string; is_global?: boolean | number; archived_at?: string | null}[], project: string): CatalogReadBinding[];
