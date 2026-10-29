import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {inventoryLegacyReferences,legacyDigest,importLegacyCatalog,migrationInventoryHash} from "../lib/projects-v2/migration.mjs";

test("authoritative migration schema copy: additive catalog leaves all existing tables unchanged", () => {
  const db=new DatabaseSync(":memory:");
  db.function("sha256",{deterministic:true},value=>createHash("sha256").update(String(value)).digest("hex"));
  try {
    const directory=new URL("../../../packages/ingenium-core/data/migrations/",import.meta.url);
    // db.ts:5088-5114 selects these only for older schema shapes; fresh base SQL is current.
    const alternateUpgrades=new Set(["094_authentication_auth101_upgrade.sql",
      "095_authorization_auth101_upgrade.sql","095_authorization_auth103_upgrade.sql",
      "104_security_audit_project_history_collision_upgrade.sql"]);
    const migrations=readdirSync(directory).filter(name=>name.endsWith(".sql") && !alternateUpgrades.has(name)).sort();
    for (const name of migrations) {
      try {db.exec(readFileSync(new URL(name,directory),"utf8"));}
      catch(error) {throw new Error("Authoritative schema fixture failed at "+name+": "+error.message,{cause:error});}
    }
    db.exec("PRAGMA foreign_keys=ON");
    const beforeTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(row=>row.name);
    const before=legacyDigest(db,beforeTables);
    const referencesBefore=inventoryLegacyReferences(db);
    assert.ok(referencesBefore.length>30);
    db.exec(readFileSync(new URL("../lib/projects-v2/schema.sql",import.meta.url),"utf8"));
    assert.deepEqual(legacyDigest(db,beforeTables),before);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    const transaction=fn=>{db.exec("BEGIN IMMEDIATE");try{fn();db.exec("COMMIT");}catch(e){db.exec("ROLLBACK");throw e;}};
    const projects=db.prepare("SELECT id,is_global FROM projects ORDER BY id").all();
    importLegacyCatalog({db,transaction,checkpointAfterWrite:()=>{},instanceId:"fixture-instance",
      approvedInventoryHash:migrationInventoryHash(db),decisions:projects.map(p=>({legacyId:p.id,
        classification:p.is_global ? "installation" : "imported_unassigned",
        evidenceRef:"schema-fixture-no-user-provenance"}))});
    assert.deepEqual(legacyDigest(db,beforeTables),before);
    console.log(JSON.stringify({evidenceClass:"authoritative-schema-fixture",migrationFiles:migrations.length,
      preservedTables:beforeTables.length,legacyReferenceColumns:referencesBefore.length,
      foreignKeyViolations:0,privateRuntimeRead:false}));
  } finally {db.close();}
});
