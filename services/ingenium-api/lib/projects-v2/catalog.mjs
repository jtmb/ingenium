import {randomUUID} from "node:crypto";
import {ProjectError,requireValue, scopeKey, text} from "../../../../packages/veyra-projects/domain.mjs";

export {ProjectError,requireValue};
const key = scope => [scope.instanceId, scope.organizationId, scope.ownerUserId];
export class ProjectCatalog {
  // db is supplied by the existing API writer. This class never opens a database.
  constructor({db, transaction, checkpointAfterWrite, authorize}) {
    this.db = db; this.transaction = transaction;
    this.checkpoint = checkpointAfterWrite; this.authorize = authorize;
  }
  access(scope, action, projectId) {
    scopeKey(scope);
    requireValue(this.authorize(scope, action, projectId) === true, "FORBIDDEN", 403);
  }
  row(scope, id) {
    return this.db.prepare(`SELECT * FROM veyra_workspace_projects
      WHERE instance_id=? AND organization_id=? AND owner_user_id=? AND id=?`).get(...key(scope), id);
  }
  decode(scope, row) {
    const roots = this.db.prepare(`SELECT * FROM veyra_workspace_roots
      WHERE instance_id=? AND organization_id=? AND owner_user_id=? AND project_id=? ORDER BY id`)
      .all(...key(scope), row.id).map(root => ({
        id: root.id, canonicalRootId: root.canonical_root_id, hostId: root.host_id,
        environmentId: root.environment_id, displayPath: root.display_path,
        isPrimary: Boolean(root.is_primary), repositoryIdentity: root.repository_identity,
      }));
    return {version: 1, id: row.id, scope: {...scope}, label: row.label, revision: row.revision,
      archivedAt: row.archived_at, archived: row.archived_at !== null, pinned: Boolean(row.pinned), roots,
      source:{system:"ingenium",instanceId:scope.instanceId,revision:row.revision}};
  }
  get(scope, id) {
    this.access(scope, "projects:read", id);
    const row = this.row(scope, id); requireValue(row, "NOT_FOUND", 404);
    return this.decode(scope, row);
  }
  list(scope, {after = "", limit = 50, archived = false} = {}) {
    this.access(scope, "projects:list", null);
    requireValue(typeof after === "string" && Number.isInteger(limit) && limit > 0 && limit <= 100);
    const statement = this.db.prepare(`SELECT * FROM veyra_workspace_projects
      WHERE instance_id=? AND organization_id=? AND owner_user_id=? AND id>?
      AND (archived_at IS NOT NULL)=? ORDER BY id`);
    const visible = [];
    for (const row of statement.iterate(...key(scope), after, Number(archived))) {
      if (this.authorize(scope, "projects:read", row.id) !== true) continue;
      visible.push(row);
      if (visible.length > limit) break;
    }
    const page = visible.slice(0, limit);
    return {data: page.map(row => this.decode(scope, row)),
      pagination: {hasMore: visible.length > limit, cursor: page.at(-1)?.id ?? after}};
  }
  create(scope, {label, roots}, id = randomUUID()) {
    this.access(scope, "projects:create", null);
    requireValue(text(id) && text(label) && label.length <= 200 && Array.isArray(roots) &&
      roots.length >= 1 && roots.length <= 32 && roots.every(r => r && typeof r === "object") &&
      roots.filter(r => r.isPrimary === true).length === 1);
    const rootIds = new Set();
    const identities = new Set();
    for (const root of roots) {
      requireValue(text(root.id) && !rootIds.has(root.id) && text(root.canonicalRootId) &&
        text(root.hostId) && text(root.environmentId) && text(root.displayPath, 32760) &&
        typeof root.isPrimary === "boolean");
      rootIds.add(root.id);
      const identity = JSON.stringify([root.hostId, root.environmentId, root.canonicalRootId]);
      requireValue(!identities.has(identity));
      identities.add(identity);
      // The trusted resolver must attest host-native canonical identity before catalog writes.
      requireValue(this.authorize(scope, "roots:attach", root) === true, "FORBIDDEN", 403);
    }
    this.transaction(() => {
      requireValue(!this.row(scope, id), "CONFLICT", 409);
      // A new project cannot duplicate an existing folder in this owner scope.
      // Archived originals keep their roots and must be restored instead. This
      // typed refusal is before every insert in this same original transaction.
      for (const root of roots) requireValue(!this.db.prepare(`SELECT 1 FROM veyra_workspace_roots
        WHERE instance_id=? AND organization_id=? AND owner_user_id=?
          AND host_id=? AND environment_id=? AND canonical_root_id=? LIMIT 1`)
        .get(...key(scope),root.hostId,root.environmentId,root.canonicalRootId), "PROJECT_ROOT_ALREADY_ATTACHED", 409);
      this.db.prepare(`INSERT INTO veyra_workspace_projects
        (instance_id,organization_id,owner_user_id,id,label) VALUES(?,?,?,?,?)`).run(...key(scope), id, label);
      const insert = this.db.prepare(`INSERT INTO veyra_workspace_roots
        (instance_id,organization_id,owner_user_id,project_id,id,host_id,environment_id,
        canonical_root_id,display_path,is_primary,repository_identity) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      for (const r of roots) insert.run(...key(scope), id, r.id, r.hostId, r.environmentId,
        r.canonicalRootId, r.displayPath, Number(r.isPrimary), r.repositoryIdentity ?? null);
    });
    this.checkpoint();
    return this.get(scope, id);
  }
  bindImportedRoots(scope, id, expectedRevision, roots) {
    this.access(scope, "projects:write", id);
    requireValue(Number.isSafeInteger(expectedRevision) && expectedRevision > 0 &&
      Array.isArray(roots) && roots.length >= 1 && roots.length <= 32 &&
      roots.every(r => r && typeof r === "object") && roots.filter(r => r.isPrimary === true).length === 1);
    const identities = new Set(); const ids = new Set();
    for (const root of roots) {
      requireValue(text(root.id) && !ids.has(root.id) && text(root.canonicalRootId) &&
        text(root.hostId) && text(root.environmentId) && text(root.displayPath, 32760) &&
        typeof root.isPrimary === "boolean");
      ids.add(root.id);
      const identity = JSON.stringify([root.hostId, root.environmentId, root.canonicalRootId]);
      requireValue(!identities.has(identity)); identities.add(identity);
      requireValue(this.authorize(scope, "roots:attach", root) === true, "FORBIDDEN", 403);
    }
    this.transaction(() => {
      const row = this.row(scope, id); requireValue(row, "NOT_FOUND", 404);
      requireValue(row.legacy_project_id !== null && row.revision === expectedRevision &&
        row.archived_at === null, "ROOT_BINDING_CONFLICT", 409);
      const count = this.db.prepare(`SELECT count(*) AS n FROM veyra_workspace_roots
        WHERE instance_id=? AND organization_id=? AND owner_user_id=? AND project_id=?`).get(...key(scope), id);
      requireValue(count.n === 0, "ROOT_BINDING_CONFLICT", 409);
      const insert = this.db.prepare(`INSERT INTO veyra_workspace_roots
        (instance_id,organization_id,owner_user_id,project_id,id,host_id,environment_id,
        canonical_root_id,display_path,is_primary,repository_identity) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      for (const r of roots) insert.run(...key(scope), id, r.id, r.hostId, r.environmentId,
        r.canonicalRootId, r.displayPath, Number(r.isPrimary), r.repositoryIdentity ?? null);
      this.db.prepare(`UPDATE veyra_workspace_projects SET revision=revision+1
        WHERE instance_id=? AND organization_id=? AND owner_user_id=? AND id=?`).run(...key(scope), id);
    });
    this.checkpoint();
    return this.get(scope, id);
  }
  update(scope, id, expectedRevision, patch) {
    this.access(scope, "projects:write", id);
    requireValue(Number.isSafeInteger(expectedRevision) && expectedRevision > 0 &&
      patch && Object.keys(patch).length > 0 &&
      Object.keys(patch).every(k => ["label", "pinned", "archived"].includes(k)));
    requireValue(patch.label === undefined || (text(patch.label) && patch.label.length <= 200));
    requireValue(patch.pinned === undefined || typeof patch.pinned === "boolean");
    requireValue(patch.archived === undefined || typeof patch.archived === "boolean");
    this.transaction(() => {
      const old = this.row(scope, id); requireValue(old, "NOT_FOUND", 404);
      requireValue(old.revision === expectedRevision, "CONFLICT", 409);
      const result = this.db.prepare(`UPDATE veyra_workspace_projects SET label=?,pinned=?,
        archived_at=?,revision=revision+1 WHERE instance_id=? AND organization_id=? AND
        owner_user_id=? AND id=? AND revision=?`).run(patch.label ?? old.label,
          patch.pinned === undefined ? old.pinned : Number(patch.pinned),
          patch.archived === undefined ? old.archived_at : patch.archived ?
            (old.archived_at ?? new Date().toISOString()) : null,
          ...key(scope), id, expectedRevision);
      requireValue(result.changes === 1, "CONFLICT", 409);
    });
    this.checkpoint();
    return this.get(scope, id);
  }
}
