/** A read-only consumer of the host-mounted authenticated catalog boundary. */
export function createCatalogPageReader(request, binding) {
  if (!binding || !binding.projectId || !binding.apiProject ||
      !["project", "public", "personal", "system"].includes(binding.visibility) ||
      !binding.scopeIdentity || !binding.label) {
    throw new Error("An explicit catalog scope and project identity are required.");
  }
  if (binding.selectorId !== undefined && binding.selectorId !== binding.visibility &&
      !(binding.selectorId === "system" && binding.visibility === "project")) {
    throw new Error("Catalog selector does not match its authoritative scope.");
  }
  const scope = { ...binding };
  return async function read(kind) {
    if (!["plugin", "skill"].includes(kind)) throw new Error("Invalid resource kind.");
    const rows = [];
    const seen = new Set();
    let offset = 0;
    let total = null;
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({
        project: scope.apiProject, kind, visibility: scope.visibility, offset: String(offset), limit: "100",
      });
      const result = await request("/customize?" + params);
      if (result?.scope?.kind !== "project" || result.scope.projectId !== scope.projectId ||
          !Array.isArray(result.scopes) || !result.scopes.includes(scope.visibility)) {
        throw new Error("Catalog response does not match the authorized scope.");
      }
      const pagination = result.pagination;
      if (!Array.isArray(result.data) || !pagination || pagination.offset !== offset ||
          !Number.isInteger(pagination.limit) || pagination.limit < 1 || pagination.limit > 100 ||
          !Number.isInteger(pagination.total) || pagination.total < 0 ||
          typeof pagination.hasMore !== "boolean" || result.data.length > pagination.limit) {
        throw new Error("Invalid catalog pagination.");
      }
      if (total !== null && total !== pagination.total) throw new Error("Catalog changed during the read. Refresh before using its state.");
      total = pagination.total;
      for (const row of result.data) {
        if (!row || typeof row.id !== "string" || !row.id || typeof row.name !== "string" ||
            typeof row.description !== "string" || typeof row.category !== "string" ||
            row.kind !== kind || row.visibility !== scope.visibility ||
            typeof row.installed !== "boolean" || typeof row.enabled !== "boolean" ||
            typeof row.archived !== "boolean" || (!row.installed && (row.enabled || row.archived)) ||
            (row.revision !== null && (!Number.isInteger(row.revision) || row.revision < 0)) ||
            !Array.isArray(row.actions) || row.actions.some((action) => typeof action !== "string") ||
            seen.has(row.id)) {
          throw new Error("Invalid or duplicated scoped catalog record.");
        }
        seen.add(row.id);
        rows.push({
          id: row.id, name: row.name, description: row.description, category: row.category, kind,
          scope: scope.label, scopeId: scope.scopeIdentity, scopeKind: scope.visibility,
          installed: row.installed, enabled: row.enabled, archived: row.archived,
          revision: row.revision, actions: row.actions,
          apiProject: row.installed ? scope.apiProject : undefined,
        });
      }
      offset += pagination.limit;
      if (!pagination.hasMore) {
        if (rows.length !== total) throw new Error("Catalog page count does not match its total.");
        return rows;
      }
      if (result.data.length === 0 || rows.length >= total) throw new Error("Catalog pagination did not advance.");
    }
    throw new Error("Catalog exceeds the bounded read limit.");
  };
}
