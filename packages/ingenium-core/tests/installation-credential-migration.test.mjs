import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const Database=createRequire(import.meta.url)('better-sqlite3');
const legacy=readFileSync(new URL('../data/migrations/096_resource_ownership.sql',import.meta.url),'utf8');
const evolution=readFileSync(new URL('../data/migrations/139_installation_credential_owner.sql',import.meta.url),'utf8');
// Exercise the real migration/guards in memory. Full original Core startup and
// typed-row preservation are separately qualified by the release coordinator.
function originalTrigger(name){const start=legacy.indexOf('CREATE TRIGGER '+name+' ');assert.ok(start>=0);const end=legacy.indexOf('END;',start);assert.ok(end>start);return legacy.slice(start,end+4);}
function fixture(run){
 const db=new Database(':memory:');
 try{
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY);CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE projects(id TEXT PRIMARY KEY,is_global INTEGER);
    CREATE TABLE organization_memberships(organization_id TEXT,user_id TEXT,status TEXT);
    CREATE TABLE vault_items(id TEXT PRIMARY KEY,project_id TEXT,organization_id TEXT,owner_kind TEXT,owner_user_id TEXT,access_policy TEXT,encrypted BLOB,wrapped_kek BLOB);
    CREATE TABLE veyra_installation_identity(instance_id TEXT PRIMARY KEY,singleton INTEGER);
    CREATE TABLE veyra_installation_legacy_refs(instance_id TEXT PRIMARY KEY,legacy_project_id TEXT);
    INSERT INTO organizations VALUES('org-a'),('org-b');INSERT INTO users VALUES('user-a'),('user-b');
    INSERT INTO organization_memberships VALUES('org-a','user-a','active'),('org-a','user-b','active');
    INSERT INTO projects VALUES('installation',1),('unrelated',1);
    INSERT INTO veyra_installation_identity VALUES('instance',1);
    INSERT INTO veyra_installation_legacy_refs VALUES('instance','installation');
    INSERT INTO vault_items VALUES('installed','installation','org-a','organization',NULL,'{}',x'0001ff',x'0304');
    INSERT INTO vault_items VALUES('unrelated','unrelated','org-a','organization',NULL,'{}',x'0506',x'0708');
    INSERT INTO vault_items VALUES('foreign-org','unrelated','org-b','organization',NULL,'{}',x'090a',x'0b0c');
    INSERT INTO vault_items VALUES('private-a','installation','org-a','user','user-a','{}',x'0d0e',x'0f10');
    INSERT INTO vault_items VALUES('private-b','installation','org-a','user','user-b','{}',x'1112',x'1314');`);
  const start=legacy.indexOf('CREATE TABLE provider_connections (');assert.ok(start>=0);db.exec(legacy.slice(start,legacy.indexOf(');',start)+2));
  for(const name of ['provider_connections_owner_valid_insert','provider_connections_credential_valid_update','provider_connections_owner_immutable','provider_connections_config_secret_free_insert','provider_connections_config_secret_free_update'])db.exec(originalTrigger(name));
  const insert=({id,kind='installation',organization=null,user=null,item='installed',config='{}'})=>db.prepare(`INSERT INTO provider_connections(id,provider_key,owner_kind,organization_id,owner_user_id,credential_item_id,display_name,provider_type,config_json,enabled,created_by_actor_type,created_at,updated_at) VALUES(?,? ,?,?,?,?,?,'managed',?,1,'system','2026-10-31','2026-10-31')`).run(id,id,kind,organization,user,item,id,config);
  insert({id:'existing'});
  const snapshot=()=>({vault:db.prepare('SELECT rowid,* FROM vault_items ORDER BY rowid').all(),provider:db.prepare('SELECT rowid,* FROM provider_connections ORDER BY rowid').all(),mapping:db.prepare('SELECT rowid,* FROM veyra_installation_legacy_refs').all()});
  const before=snapshot();db.transaction(()=>db.exec(evolution))();assert.deepEqual(snapshot(),before);
  db.prepare("UPDATE projects SET is_global=0 WHERE id='installation'").run();
  return run(db,insert);
 }finally{db.close();}
}
test('139 preserves original typed rows, encrypted blobs and references; mapped installation works without global flag',()=>fixture((db,insert)=>{insert({id:'mapped'});assert.equal(db.prepare("SELECT credential_item_id FROM provider_connections WHERE id='mapped'").get().credential_item_id,'installed');assert.equal(db.prepare("SELECT is_global FROM projects WHERE id='installation'").get().is_global,0);}));
test('unrelated global workspace cannot provide installation credentials on insert or update',()=>fixture((db,insert)=>{assert.throws(()=>insert({id:'bad',item:'unrelated'}),/invalid provider owner or credential/);assert.throws(()=>db.prepare("UPDATE provider_connections SET credential_item_id='unrelated' WHERE id='existing'").run(),/invalid provider credential/);assert.equal(db.prepare("SELECT credential_item_id FROM provider_connections WHERE id='existing'").get().credential_item_id,'installed');}));
test('organization credentials retain organization isolation',()=>fixture((db,insert)=>{insert({id:'org',kind:'organization',organization:'org-a',item:'unrelated'});assert.throws(()=>insert({id:'bad-org',kind:'organization',organization:'org-a',item:'foreign-org'}),/invalid provider owner or credential/);}));
test('private credentials retain user identity and active membership checks',()=>fixture((db,insert)=>{insert({id:'private',kind:'user',organization:'org-a',user:'user-a',item:'private-a'});assert.throws(()=>insert({id:'other-user',kind:'user',organization:'org-a',user:'user-a',item:'private-b'}),/invalid provider owner or credential/);db.prepare("UPDATE organization_memberships SET status='revoked' WHERE user_id='user-a'").run();assert.throws(()=>insert({id:'inactive',kind:'user',organization:'org-a',user:'user-a',item:'private-a'}),/invalid provider owner or credential/);}));
test('private and deleted credentials cannot become installation credentials',()=>fixture((db,insert)=>{assert.throws(()=>insert({id:'private-install',item:'private-a'}),/invalid provider owner or credential/);db.prepare(`UPDATE vault_items SET access_policy='{"mode":"deleted"}' WHERE id='installed'`).run();assert.throws(()=>insert({id:'deleted'}),/invalid provider owner or credential/);}));
test('provider ownership cannot be reassigned during credential migration',()=>fixture(db=>{assert.throws(()=>db.prepare("UPDATE provider_connections SET owner_kind='user',organization_id='org-a',owner_user_id='user-a' WHERE id='existing'").run(),/ownership transfer/);}));
test('schema marker cannot be updated, deleted or replaced',()=>fixture(db=>{for(const sql of ['UPDATE installation_credential_owner_schema SET schema_version=1','DELETE FROM installation_credential_owner_schema','INSERT OR REPLACE INTO installation_credential_owner_schema VALUES(1,1)'])assert.throws(()=>db.exec(sql),/immutable/);}));
