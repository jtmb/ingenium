import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {inventoryLegacyReferences,legacyDigest,importLegacyCatalog,migrationInventoryHash} from "../lib/projects-v2/migration.mjs";

test("authoritative migration schema copy: additive catalog leaves all existing tables unchanged", () => {
  const db=new DatabaseSync(":memory:");
  db.function("sha256",{deterministic:true},value=>createHash("sha256").update(String(value)).digest("hex"));
  try {
    const directory=process.env.VEYRA_PROJECTS_MIGRATIONS_DIR ?
      pathToFileURL(resolve(process.env.VEYRA_PROJECTS_MIGRATIONS_DIR)+"/") :
      new URL("../../../packages/ingenium-core/data/migrations/",import.meta.url);
    // db.ts:5088-5114 selects these only for older schema shapes; fresh base SQL is current.
    const alternateUpgrades=new Set(["094_authentication_auth101_upgrade.sql",
      "095_authorization_auth101_upgrade.sql","095_authorization_auth103_upgrade.sql",
      "104_security_audit_project_history_collision_upgrade.sql"]);
    const migrations=readdirSync(directory).filter(name=>name.endsWith(".sql") && !alternateUpgrades.has(name)).sort();
    const sources=migrations.map(name=>({name,sql:readFileSync(new URL(name,directory),"utf8")}));
    const baseline=sources.filter(source=>Number(source.name.slice(0,3))<=121);
    const allocated=sources.filter(source=>Number(source.name.slice(0,3))>121);
    assert.equal(baseline.length,121,"Preservation baseline remains the canonical 001–121 schema");
    function apply(source) {
      try {db.exec(source.sql);}
      catch(error) {throw new Error("Authoritative schema fixture failed at "+source.name+": "+error.message,{cause:error});}
    }
    for (const source of baseline) apply(source);
    db.exec("PRAGMA foreign_keys=ON");
    const beforeTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(row=>row.name);
    const before=legacyDigest(db,beforeTables);
    const referencesBefore=inventoryLegacyReferences(db);
    assert.ok(referencesBefore.length>30);
    for (const source of allocated) apply(source);
    const catalogAllocated=Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='veyra_workspace_projects'").get());
    if(!catalogAllocated) db.exec(readFileSync(new URL("../lib/projects-v2/schema.sql",import.meta.url),"utf8"));
    assert.deepEqual(legacyDigest(db,beforeTables),before);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    const transaction=fn=>{db.exec("BEGIN IMMEDIATE");try{fn();db.exec("COMMIT");}catch(e){db.exec("ROLLBACK");throw e;}};
    const projects=db.prepare("SELECT id,is_global,archived_at FROM projects ORDER BY id").all();
    importLegacyCatalog({db,transaction,checkpointAfterWrite:()=>{},instanceId:"fixture-instance",
      approvedInventoryHash:migrationInventoryHash(db),decisions:projects.map(p=>({legacyId:p.id,
        classification:p.is_global===1 && p.archived_at===null ? "installation" : "imported_unassigned",
        evidenceRef:"schema-fixture-no-user-provenance"}))});
    assert.deepEqual(legacyDigest(db,beforeTables),before);
    console.log(JSON.stringify({evidenceClass:"authoritative-schema-fixture",migrationFiles:baseline.length,allocatedMigrations:allocated.map(source=>({name:source.name,
        sha256:createHash("sha256").update(source.sql).digest("hex")})),catalogAllocated,
      preservedTables:beforeTables.length,legacyReferenceColumns:referencesBefore.length,
      foreignKeyViolations:0,privateRuntimeRead:false}));
  } finally {db.close();}
});
