import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {InstallationPreferencesBridge} from "../lib/projects-v2/installation.mjs";
test("installation bridge retains separate Chat defaults and Docs selection without exposing secrets",()=>{
  const db=new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE veyra_installation_legacy_refs(instance_id TEXT,legacy_project_id TEXT);
      INSERT INTO veyra_installation_legacy_refs VALUES('instance','original-global-id');`);
    const stored={chat_defaults:'{"provider":"openai","model":"saved-default","variant":"high"}',
      chat_selection:'{"provider":"opencode","model":"docs-compat"}'};
    const scope={instanceId:"instance",organizationId:"org",ownerUserId:"alice"};
    const bridge=new InstallationPreferencesBridge({db,authorize:s=>s.ownerUserId==="alice",
      readPreference:(id,key)=>{assert.equal(id,"original-global-id");return stored[key];}});
    assert.equal(bridge.get(scope,"chat_defaults"),stored.chat_defaults);
    assert.equal(bridge.get(scope,"chat_selection"),stored.chat_selection);
    assert.throws(()=>bridge.get(scope,"oauth_gmail_client_secret"),e=>e.code==="PREFERENCE_NOT_EXPOSED");
    assert.throws(()=>bridge.get({...scope,ownerUserId:"bob"},"chat_defaults"),e=>e.code==="FORBIDDEN");
    assert.throws(()=>bridge.set(scope,"chat_defaults",{operationId:"op",expectedRevision:0}),
      e=>e.code==="PREFERENCE_WRITE_UNAVAILABLE");
  } finally {db.close();}
});
