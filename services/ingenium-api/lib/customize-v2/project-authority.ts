import { plugins, skills } from "ingenium-core";
import { CustomizeError, type CustomizeAuthority } from "./catalog-service.js";

/**
 * Only already-authorized project UUIDs enter this adapter. Existing lifecycle
 * routes retain their write, projection, maintenance-lock and governance logic.
 */
export function createProjectCatalogAuthority(
  canRead: CustomizeAuthority["authorize"],
): CustomizeAuthority {
  return {
    authorize: (context, action, kind) => action === "read" && canRead(context, action, kind),
    scopes: () => ["project"],
    installed(context, kind) {
      if (kind === "plugin") {
        return plugins.listPlugins(context.projectId).map((row) => ({
          id: row.id, kind: "plugin" as const, name: row.name,
          description: row.description ?? "", enabled: row.enabled,
          category: "Local plugins", actions: [],
        }));
      }
      return skills.listSkills(context.projectId).map((row) => ({
        id: row.id, kind: "skill" as const, name: row.name,
        description: row.description ?? "", enabled: row.enabled,
        archived: Boolean(row.archived_at), revision: row.revision,
        category: row.category ?? "Project skills", actions: [],
      }));
    },
    discover: () => [],
    resource: () => null,
    async mutate() {
      throw new CustomizeError("ACTION_UNAVAILABLE", "Use the existing authorized lifecycle routes.", 409);
    },
  };
}
