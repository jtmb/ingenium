import {test, expect} from "vitest";
import Database from "better-sqlite3";
import {randomUUID} from "node:crypto";
import {copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync} from "node:fs";
import {isAbsolute, join, relative} from "node:path";
import {getDb, resetDbForTest} from "../lib/db.js";
import * as backups from "../lib/tools/backups.js";
import * as identity from "../lib/tools/identity.js";
import * as organizations from "../lib/tools/organizations.js";
import {createProject} from "../lib/tools/projects.js";
import {MemoryLifecycle, scopeKey} from "../../../services/ingenium-api/lib/memory-v2/lifecycle.mjs";
import {createAttachmentDeliveryOwner} from "../../../services/ingenium-api/lib/voice-v2/attachment-delivery-owner.mjs";

test("actual Core capsule recovery preserves a newer learned forget across an older signed snapshot", async () => {
  const output = process.env.INGENIUM_TEST_LEARNED_RESTORE_OUTPUT;
  if (!output || !isAbsolute(output) || realpathSync(output) !== output) throw Error("Explicit owned restore fixture root required");
  const fixture = mkdtempSync(join(output, "capsule-"));
  const rel = relative(output, fixture);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw Error("Fixture escaped output root");
  const dbPath = join(fixture,"core.db"), snapshots = join(fixture,"backups"), engine = join(fixture,"opencode.db");
  const key = join(fixture,"synthetic-signing-key"), home = join(fixture,"synthetic-installation");
  mkdirSync(home,{mode:0o700});
  writeFileSync(key,Buffer.alloc(32,7),{mode:0o600,flag:"wx"});
  writeFileSync(join(fixture,"fixture-owner.json"),JSON.stringify({owner:"01a188fc-d3ed-7dc2-ab95-e0eed8a793ec",scope:"isolated actual Core backup/capsule test",synthetic:true,regeneration:"vitest run tests/learned-memory-capsule.test.ts",outputs:[dbPath,snapshots,engine,key,home],cleanup:"Coordinator after DB/process/manifest checks; preserve failure evidence"}),{mode:0o600,flag:"wx"});
  const names = ["INGENIUM_CORE_DB_PATH","INGENIUM_BACKUPS_DIR","OPENCODE_DB_PATH","INGENIUM_BACKUP_SIGNING_KEY_FILE","INGENIUM_HOME","INGENIUM_TRUSTED_ARTIFACT_UID","INGENIUM_TRUSTED_ARTIFACT_GID"] as const;
  const previous = Object.fromEntries(names.map(name=>[name,process.env[name]]));
  Object.assign(process.env,{INGENIUM_CORE_DB_PATH:dbPath,INGENIUM_BACKUPS_DIR:snapshots,OPENCODE_DB_PATH:engine,INGENIUM_BACKUP_SIGNING_KEY_FILE:key,INGENIUM_HOME:home,INGENIUM_TRUSTED_ARTIFACT_UID:String(process.getuid!()),INGENIUM_TRUSTED_ARTIFACT_GID:String(process.getgid!())});
  let finished = false;
  try {
    const db = getDb(dbPath), opencode = new Database(engine);
    opencode.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY)");opencode.close();
    const project = createProject("learned-restore-global",true);
    const actor = identity.createUser(`learned-${randomUUID()}@example.test`,"Synthetic restore owner");
    organizations.addOrganizationMember(project.organization_id,actor.id,"admin");
    const scope = {organizationId:project.organization_id,ownerUserId:actor.id,projectId:project.id,workspaceId:"synthetic-workspace",hostId:"fixture-host",environmentId:"fixture-env",bindingHash:"a".repeat(64),bindingEpoch:1,visibility:"private"};
    // Authorization/source callbacks isolate this restore test; actual public authorization is qualified separately.
    const lifecycle = new MemoryLifecycle({db,authorize:()=>true,sources:()=>({contentHash:"b".repeat(64),active:false,excluded:false,uncertain:false,idleEligible:true,kind:"transcript"}),checkpoint:()=>{}});
    lifecycle.setPolicy(scope,{operationId:"policy",expectedRevision:0,enabled:true,generate:true,useMemory:true,externalContext:false});
    lifecycle.setChatPolicy(scope,"source-chat",{operationId:"chat",expectedRevision:0,useMemory:true,contribute:true});
    const content = "Synthetic learned content must not return after restore";
    const saved = lifecycle.commitRecall(scope,{operationId:"save",admission:lifecycle.admit(scope,"source-chat",[{id:"source",contentHash:"b".repeat(64)}]),content,model:"fixture"});
    // Synthetic context isolates persistence; this is not a hosted authorization proof.
    const callScope = {actorId:actor.id,accountId:actor.id,organizationId:project.organization_id,projectId:project.id,conversationId:"ses_restore_original",runtimeId:"fixture-runtime",executionBindingId:"fixture-binding",executionRevision:"fixture-revision",agentId:"fixture-agent"};
    const callInputs = [0,1,2].map(n=>({scope:callScope,requestId:`restore-request-${n}`,kind:"message" as const,inputHash:String(n+1).repeat(64),originalMessageId:`msg_restore_${n}`}));
    const deliveries = createAttachmentDeliveryOwner({db:()=>getDb(dbPath),assertContext:()=>{}});
    expect(deliveries.reserve({},callInputs[0]).fresh).toBe(true);
    const old = await backups.createSnapshot(project.id,"manual",dbPath,engine);
    const acknowledged = deliveries.reserve({},callInputs[1]);
    if(!acknowledged.fresh)throw Error("Fresh fixture original required");
    deliveries.claim(acknowledged.handle);
    deliveries.acknowledge(acknowledged.handle,{originalMessageId:callInputs[1].originalMessageId,sessionId:callScope.conversationId,state:"delivered"});
    const unknown = deliveries.reserve({},callInputs[2]);
    if(!unknown.fresh)throw Error("Fresh fixture original required");
    deliveries.unknown(unknown.handle);
    const forgotten = lifecycle.forget(scope,{operationId:"forget",memoryId:saved.receipt.memoryId,expectedVersion:1});
    const plan = backups.previewRestore(project.id,{backupId:old.backupId,dryRun:true,idempotencyKey:randomUUID()});
    const confirmation = backups.authorizeRestore(project.id,plan.id,plan.revision);
    const ready = backups.confirmRestore(project.id,plan.id,{confirmationToken:confirmation.confirmationToken,expectedRevision:confirmation.plan.revision,idempotencyKey:randomUUID()});
    const execution = backups.authorizeRestoreExecution(project.id,ready.id,ready.revision);
    backups.executeRestore(project.id,ready.id,{executionToken:execution.executionToken,expectedRevision:execution.plan.revision,idempotencyKey:randomUUID()});
    const owner = "m".repeat(43), fence = "n".repeat(43);
    const claimed = backups.claimPendingRestoreExecution(project.id,owner,fence)!;
    const quiescing = backups.transitionRestoreExecution(project.id,claimed.id,owner,fence,claimed.revision,"quiescing");
    const capsule = backups.captureRestoreExecutionCapsule(project.id,quiescing.id);
    expect(capsule.learnedMemorySuppressions!.entries.length).toBeGreaterThan(0);
    expect((capsule as unknown as {voiceAttachmentDeliveries?:{count:number}}).voiceAttachmentDeliveries?.count).toBe(3);
    expect(JSON.stringify(capsule.learnedMemorySuppressions)).not.toContain(content);
    resetDbForTest();
    // Closed local fixture only: no supervisor, production swap, service or external workload.
    copyFileSync(join(snapshots,old.backupId,"ingenium.db"),dbPath);
    expect(backups.recoverRestoreExecutionCapsule(capsule,"rolled_back","SWAP_FAILED").state).toBe("rolled_back");
    const restored = getDb(dbPath);
    const restoredDeliveries=createAttachmentDeliveryOwner({db:()=>getDb(dbPath),assertContext:()=>{}});
    for(const [n,input] of callInputs.entries()){
      const original=restoredDeliveries.reserve({},input);
      expect(original.fresh).toBe(false);
      expect(original).not.toHaveProperty("handle");
      expect(original.receipt.state).toBe(n===1?"delivered":"unknown");
      expect(original.receipt.dispatchPending).toBe(false);
      expect(original.receipt.agentSettlementProof).toBe(false);
    }
    expect(restored.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name='veyra_voice_attachment_deliveries'").get()).toEqual({n:5});
    expect(restored.prepare("SELECT state,content,provenance_json,version FROM veyra_memory_recall WHERE scope_key=? AND id=?").get(scopeKey(scope),saved.receipt.memoryId)).toEqual({state:"forgotten",content:"",provenance_json:"[]",version:2});
    expect(JSON.parse((restored.prepare("SELECT receipt_json FROM veyra_memory_receipt WHERE scope_key=? AND operation_id='forget'").get(scopeKey(scope)) as {receipt_json:string}).receipt_json)).toEqual(forgotten.receipt);
    expect(restored.prepare("PRAGMA integrity_check").all()).toEqual([{integrity_check:"ok"}]);
    expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    finished = true;
  } finally {
    resetDbForTest();
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
    writeFileSync(join(fixture,"fixture-result.json"),JSON.stringify({passed:finished,closed:true,scope:"actual Core signed snapshot and capsule recovery; authorization/source fixtures; no privileged executor or deployed restore"}),{mode:0o600,flag:"wx"});
  }
},30_000);