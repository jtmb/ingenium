import {createHash} from "node:crypto";
import {requireValue, scopeKey, text} from "../../../../packages/veyra-projects/domain.mjs";

const quote = identifier => '"' + identifier.replaceAll('"', '""') + '"';
export function inventoryLegacyReferences(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const references = [];
  for (const {name} of tables) {
    const columns = db.prepare("PRAGMA table_info(" + quote(name) + ")").all();
    const foreignKeys = db.prepare("PRAGMA foreign_key_list(" + quote(name) + ")").all();
    const candidates = new Set(foreignKeys.filter(fk => fk.table === "projects").map(fk => fk.from));
    for (const column of columns) {
      if (["project_id", "source_project_id", "legacy_project_id"].includes(column.name)) candidates.add(column.name);
    }
    for (const column of Array.from(candidates).sort()) {
      references.push({table: name, column,
        declaredForeignKey: foreignKeys.some(fk => fk.table === "projects" && fk.from === column),
        rows: db.prepare("SELECT count(*) AS n FROM " + quote(name) + " WHERE " + quote(column) + " IS NOT NULL").get().n});
    }
  }
  return references;
}
export function legacyDigest(db, tableNames) {
  return tableNames.map(name => {
    const columns = db.prepare("PRAGMA table_xinfo(" + quote(name) + ")").all().filter(c => c.hidden !== 1);
    // SQL encodes storage types before the driver can round 64-bit integers or truncate text at NUL.
    const expressions = columns.flatMap((column, index) => {
      const field = quote(column.name);
      return ["typeof(" + field + ") AS " + quote("type" + index),
        "CASE typeof(" + field + ") WHEN 'real' THEN printf('%!.26g'," + field + ")" +
        " WHEN 'integer' THEN CAST(" + field + " AS TEXT) ELSE hex(CAST(" + field + " AS BLOB)) END AS " +
        quote("value" + index)];
    });
    const hashes = [];
    for (const row of db.prepare("SELECT " + expressions.join(",") + " FROM " + quote(name)).iterate()) {
      hashes.push(createHash("sha256").update(JSON.stringify(row)).digest("hex"));
    }
    hashes.sort();
    return {table: name, rows: hashes.length,
      sha256: createHash("sha256").update(JSON.stringify(hashes)).digest("hex")};
  });
}
export function migrationInventoryHash(db) {
  const owned = new Set(["veyra_workspace_projects", "veyra_workspace_roots",
    "veyra_installation_legacy_refs", "veyra_project_aliases", "veyra_project_operations"]);
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const sourceTables = schema.filter(row => row.type === "table" && !owned.has(row.name)).map(row => row.name);
  const references = inventoryLegacyReferences(db).filter(row => !owned.has(row.table));
  return createHash("sha256").update(JSON.stringify({schema,references,
    sourceDigest:legacyDigest(db,sourceTables)})).digest("hex");
}
export function importLegacyCatalog({db, transaction, checkpointAfterWrite, instanceId, decisions,
  approvedInventoryHash}) {
  requireValue(text(instanceId) && text(approvedInventoryHash), "MIGRATION_INVENTORY_REQUIRED", 409);
  requireValue(Array.isArray(decisions));
  let rows;
  transaction(() => {
    requireValue(migrationInventoryHash(db) === approvedInventoryHash, "MIGRATION_INVENTORY_CHANGED", 409);
    rows = db.prepare("SELECT id,name,is_global,archived_at FROM projects ORDER BY id").all();
    requireValue(decisions.length === rows.length);
    const byId = new Map(decisions.map(d => [d.legacyId, d]));
    requireValue(byId.size === rows.length);
    for (const row of rows) {
      const decision = byId.get(row.id);
      requireValue(decision && text(decision.evidenceRef) &&
        ["workspace", "installation", "imported_unassigned"].includes(decision.classification));
      requireValue([0,1].includes(row.is_global));
      requireValue((row.is_global === 1 && row.archived_at === null) === (decision.classification === "installation"),
        "MIGRATION_CLASSIFICATION_CONFLICT", 409);
      const existing = db.prepare(`SELECT * FROM veyra_project_aliases
        WHERE instance_id=? AND source_system='ingenium' AND source_id=?`).get(instanceId, row.id);
      if (existing) {
        requireValue(existing.legacy_project_id === row.id &&
          existing.classification === decision.classification &&
          existing.evidence_ref === decision.evidenceRef, "MIGRATION_ALIAS_CONFLICT", 409);
        if (decision.classification === "workspace") {
          scopeKey(decision.scope);
          requireValue(decision.permissionsVerified === true && decision.scope.instanceId === instanceId,
            "MIGRATION_PERMISSION_REQUIRED", 409);
          const workspace = db.prepare(`SELECT * FROM veyra_workspace_projects
            WHERE instance_id=? AND legacy_project_id=?`).get(instanceId, row.id);
          requireValue(workspace && workspace.id === row.id &&
            workspace.organization_id === decision.scope.organizationId &&
            workspace.owner_user_id === decision.scope.ownerUserId, "MIGRATION_ALIAS_CONFLICT", 409);
        }
        continue;
      }
      if (decision.classification === "workspace") {
        scopeKey(decision.scope);
        requireValue(decision.scope.instanceId === instanceId && decision.permissionsVerified === true,
          "MIGRATION_PERMISSION_REQUIRED", 409);
        // Root binding is intentionally absent until independently resolved on its actual host.
        db.prepare(`INSERT INTO veyra_workspace_projects
          (instance_id,organization_id,owner_user_id,id,label,archived_at,legacy_project_id)
          VALUES(?,?,?,?,?,?,?)`).run(instanceId, decision.scope.organizationId,
            decision.scope.ownerUserId, row.id, row.name, row.archived_at, row.id);
      }
      if (decision.classification === "installation") {
        db.prepare("INSERT INTO veyra_installation_legacy_refs(instance_id,legacy_project_id) VALUES(?,?)")
          .run(instanceId, row.id);
      }
      db.prepare(`INSERT INTO veyra_project_aliases
        (instance_id,source_system,source_id,legacy_project_id,classification,evidence_ref)
        VALUES(?,'ingenium',?,?,?,?)`).run(instanceId, row.id, row.id,
          decision.classification, decision.evidenceRef);
    }
  });
  checkpointAfterWrite();
  return {projects: rows.length, installation: rows.filter(r => r.is_global === 1 && r.archived_at === null).length};
}
