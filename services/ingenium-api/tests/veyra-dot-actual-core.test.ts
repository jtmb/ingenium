import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { authorization, checkpointAfterWrite, execTransaction, getDb, identity, jobs, organizations, resetDbForTest } from "ingenium-core";
import type { Actor, Authorization, DotAction, DotScope } from "../../../packages/veyra-automation/contracts.js";
import { createCoreDotRuntime, type CoreDotBindingPolicy, type CoreDotExecution, type CoreDotOptions, type CoreDotPorts } from "../lib/dot-v2/core-binding.js";
import { DotError } from "../lib/dot-v2/service.js";

const approvedRoot="/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/coordination/dot";
const requestedDb=process.env.VEYRA_DOT_CORE_TEST_DB;
const centralOwner="01a188fc-d3ed-7dc2-ab95-e0eed8a793ec";
let fixtureDir="",databasePath="",checkpointPrerequisiteVerified=false;
const originalEnvironment={db:process.env.INGENIUM_CORE_DB_PATH,home:process.env.INGENIUM_HOME};
const fixtureJobIds=new Set<string>();

function authorizedFixturePath(value:string):string {
  if(process.platform!=="linux" || process.env.NODE_ENV!=="test")throw Error("Actual-core Dot suite requires the central Linux test runner");
  const path=resolve(value),directory=dirname(path),root=realpathSync(approvedRoot);
  if(path!==value || basename(path)!=="core.sqlite" || dirname(directory)!==root || !basename(directory).startsWith("actual-core-test-"))throw Error("Unowned actual-core fixture path");
  if(realpathSync(directory)!==directory || realpathSync(path)!==path)throw Error("Fixture symlinks are forbidden");
  const stat=lstatSync(path),parent=lstatSync(directory);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.size!==0 || (stat.mode&0o777)!==0o600 || stat.uid!==process.getuid?.() || stat.dev!==parent.dev || parent.dev!==lstatSync(root).dev || (parent.mode&0o077)!==0)throw Error("Central runner must provide an empty exclusive mode-0600 fixture on the approved volume");
  const leasePath=resolve(directory,"lease.json"),leaseStat=lstatSync(leasePath);
  if(!leaseStat.isFile() || leaseStat.isSymbolicLink() || leaseStat.nlink!==1 || leaseStat.uid!==process.getuid?.() || (leaseStat.mode&0o777)!==0o600)throw Error("Unsafe central fixture lease file");
  const lease=JSON.parse(readFileSync(leasePath,"utf8"));
  if(lease.ownerThread!==centralOwner || lease.consumer!=="veyra-dot-actual-core.test.ts" || lease.database!==path || lease.outputRoot!==root || lease.fresh!==true)throw Error("Missing exact central fixture lease");
  return path;
}

function observeWal(db:ReturnType<typeof getDb>) {
  const calls:{inTransaction:boolean}[]=[];
  const original=db.pragma.bind(db);
  const spy=vi.spyOn(db,"pragma").mockImplementation((sql,options)=>{
    if(sql.startsWith("wal_checkpoint"))calls.push({inTransaction:db.inTransaction});
    return options===undefined?original(sql):original(sql,options);
  });
  return {calls,restore:()=>spy.mockRestore()};
}

function resetCheckpointCounter(db:ReturnType<typeof getDb>):void {
  expect(db.inTransaction).toBe(false);
  const wal=observeWal(db);
  try{
    for(let count=0;count<50 && wal.calls.length===0;count++)checkpointAfterWrite();
    expect(wal.calls).toHaveLength(1);
    expect(wal.calls[0]?.inTransaction).toBe(false);
  }finally{wal.restore();}
}

function verifyNestedCheckpointPrerequisite(db:ReturnType<typeof getDb>):void {
  const wal=observeWal(db),marker=randomUUID();
  try{
    execTransaction(()=>{
      db.prepare("INSERT INTO fixture_dot_checkpoint(id) VALUES(?)").run(marker);
      execTransaction(()=>{
        expect(db.inTransaction).toBe(true);
        for(let count=0;count<50;count++)checkpointAfterWrite();
        expect(wal.calls).toHaveLength(0);
      },1);
      expect(wal.calls).toHaveLength(0);
    },1);
    expect(db.inTransaction).toBe(false);
    expect(db.prepare("SELECT id FROM fixture_dot_checkpoint WHERE id=?").get(marker)).toBeDefined();
    checkpointAfterWrite();
    expect(wal.calls.length).toBeGreaterThan(0);
    expect(wal.calls.every(call=>!call.inTransaction)).toBe(true);
  }finally{wal.restore();}
}

function fixture(sourceKind:"user"|"memory"="user") {
  const db=getDb();
  // beforeAll proves the real core prerequisite once; a failed prerequisite stops this suite.
  expect(checkpointPrerequisiteVerified).toBe(true);
  const tag=randomUUID(),organizationId=organizations.createOrganization("Dot actual core "+tag,"dot-"+tag);
  const owner=identity.createUser(`dot-${tag}@example.test`,"Dot fixture owner");
  organizations.addOrganizationMember(organizationId,owner.id,"member");
  const projectId=randomUUID(),now=new Date().toISOString();
  db.prepare("INSERT INTO projects(id,name,path,is_global,created_at,updated_at,organization_id) VALUES(?,?,?,0,?,?,?)").run(projectId,"dot-core-"+tag,resolve(fixtureDir,"never-executed-workspace",tag),now,now,organizationId);
  organizations.addProjectMember(projectId,owner.id,"editor");
  const job=jobs.createJob(projectId,"Dot scoped job",undefined,"fixture-agent","Inspect existing task progress",undefined,undefined,1,undefined,{organizationId,ownerUserId:owner.id,visibility:"private",actorType:"user",actorId:owner.id});
  fixtureJobIds.add(job.id);
  const scope:DotScope={organizationId,ownerUserId:owner.id,projectId,executionBindingId:"fixture-native",executionBindingFingerprint:"fixture-host/workspace/epoch-1/revision-1",conversationId:randomUUID()};
  const actor:Actor={id:owner.id,organizationId};
  let clock="2030-01-01T00:00:00.000Z",afterCommit:()=>void=()=>{},sourceEligible=true,memoryRead=true,bindingCurrent=true,active=true;
  const principal=(a:Actor)=>({type:"browser-user" as const,id:a.id,organizationId:a.organizationId,projectId,scopes:["jobs:read","jobs:write","jobs:execute"]});
  const requirePermission=(a:Actor,s:DotScope,permission:"read"|"write"|"execute")=>{
    const decision=authorization.requireProjectPermission(principal(a),s.projectId??"","jobs",permission);
    if(!decision.allowed || decision.organizationId!==s.organizationId)throw new DotError("DOT_FORBIDDEN");
  };
  const auth:Authorization={
    require(a,s,action:DotAction,capabilities){requirePermission(a,s,action==="dispatch"?"execute":action==="read"||action==="notify"?"read":"write");if(capabilities.some(capability=>capability!=="read"))throw new DotError("DOT_FORBIDDEN");},
    requireSource(_a,_s,source){if(!sourceEligible || source.reference!=="fixture-message/revision-1")throw new DotError("DOT_SOURCE_REVOKED");},
    canReadMemory(){return memoryRead;},
  };
  const binding:CoreDotBindingPolicy={
    authorizeJob(a,s,current,action){requirePermission(a,s,action==="dispatch"?"execute":"read");if(current.owner_user_id!==a.id)throw new DotError("DOT_FORBIDDEN");return {scope:bindingCurrent?s:{...s,executionBindingFingerprint:"revoked-epoch"},capabilities:["read"]};},
    authorizeRun(a,s,run,action){requirePermission(a,s,action==="cancel"?"write":"read");if(run.job_id!==job.id || run.organization_id!==s.organizationId)throw new DotError("DOT_FORBIDDEN");},
  };
  const launch=vi.fn(async(runId:string,current:Parameters<CoreDotExecution["executeJobRun"]>[1],prompt:string)=>{
    const connection=getDb();expect(connection.inTransaction).toBe(false);expect(connection.name).toBe(databasePath);
    const run=jobs.getJobRun(projectId,runId);expect(run?.job_id).toBe(current.id);expect(run?.trigger).toBe("cron");expect(jobs.isJobRunAuthorizationCurrent(projectId,runId)).toBe(true);expect(prompt).toBe(current.prompt_template);
    expect(connection.prepare("SELECT id FROM veyra_dot_records WHERE kind='operation' AND json_extract(body,'$.runId')=?").get(runId)).toBeDefined();
  });
  const execution:CoreDotExecution={
    executeJobRun:launch,
    requestCancellation(s,run){jobs.cancelJobRun(s.projectId!,run.id);},
    inspectOwnedRun(_s,run){if(run.status==="running"||run.status==="queued")return "unknown";if(run.status==="timeout")return "failed";return run.status;},
  };
  const diagnostics:Parameters<CoreDotOptions["onDiagnostic"]>[0][]=[];
  const core:CoreDotPorts={getDb,execTransaction,checkpointAfterWrite(){checkpointAfterWrite();const hook=afterCommit;afterCommit=()=>{};hook();},jobs};
  const options:CoreDotOptions={nestedCheckpointPolicy:"deferred-by-core-v1",now:()=>clock,id:randomUUID,onDiagnostic:event=>diagnostics.push(event)};
  const createRuntime=()=>createCoreDotRuntime(core,auth,binding,execution,options),runtime=createRuntime();
  const suggestion=runtime.service.propose(actor,scope,{title:"Inspect task progress",prompt:job.prompt_template,source:{kind:sourceKind,reference:"fixture-message/revision-1"},capabilities:["read"],expiresAt:"2031-01-01T00:00:00.000Z"});
  const followup=runtime.service.approve(actor,scope,suggestion.id,0,{jobId:job.id,schedule:{kind:"interval",anchor:clock,minutes:60},missedPolicy:"latest",notificationPolicy:"meaningful"});
  const revokeGrant=()=>execTransaction(()=>{db.prepare("UPDATE automation_principal_grants SET status='revoked',revision=revision+1 WHERE project_id=? AND service_principal_id=? AND permission='execute'").run(projectId,job.service_principal_id);},1);
  return {db,job,scope,actor,runtime,createRuntime,followup,launch,diagnostics,principal,sourceKind,revokeGrant,isActive:()=>active,tick(){clock="2030-01-01T01:00:00.000Z";},afterCommit(hook:()=>void){afterCommit=hook;},revokeSource(){sourceEligible=false;},revokeMemory(){memoryRead=false;},revokeBinding(){bindingCurrent=false;},stop(){active=false;}};
}

describe.runIf(Boolean(requestedDb))("Dot actual-core binding (central opt-in file fixture; no process runner)",()=>{
  beforeAll(()=>{
    databasePath=authorizedFixturePath(requestedDb!);fixtureDir=dirname(databasePath);
    process.env.INGENIUM_CORE_DB_PATH=databasePath;process.env.INGENIUM_HOME=resolve(fixtureDir,"home");
    resetDbForTest();const db=getDb();expect(db.name).toBe(databasePath);expect(db.pragma("journal_mode",{simple:true})).toBe("wal");
    db.exec(readFileSync(new URL("../lib/dot-v2/schema.sql",import.meta.url),"utf8"));db.exec("CREATE TABLE fixture_dot_checkpoint(id TEXT PRIMARY KEY)");
    verifyNestedCheckpointPrerequisite(db);checkpointPrerequisiteVerified=true;
  });
  afterEach(()=>{
    vi.restoreAllMocks();
    if(!databasePath)return;
    const db=getDb();
    for(const jobId of fixtureJobIds){const runs=db.prepare("SELECT id,project_id FROM job_runs WHERE job_id=? AND status IN ('running','queued')").all(jobId) as {id:string;project_id:string}[];for(const run of runs)jobs.cancelJobRun(run.project_id,run.id);}
  });
  afterAll(()=>{
    if(!databasePath)return;
    resetDbForTest();
    if(originalEnvironment.db===undefined)delete process.env.INGENIUM_CORE_DB_PATH;else process.env.INGENIUM_CORE_DB_PATH=originalEnvironment.db;
    if(originalEnvironment.home===undefined)delete process.env.INGENIUM_HOME;else process.env.INGENIUM_HOME=originalEnvironment.home;
    // The central lease owner supplied this fixture and owns its safety-checked deletion.
    console.info(JSON.stringify({consumer:"veyra-dot-actual-core.test.ts",consumerDone:true,databaseClosed:true,ownerThread:centralOwner,fixtureDirectory:fixtureDir,files:readdirSync(fixtureDir).map(name=>({path:resolve(fixtureDir,name),bytes:lstatSync(resolve(fixtureDir,name)).size})),cleanupRequired:true}));
  });

  it("checks the actual nested transaction and 50-write WAL boundary before adapter activation",()=>{
    const db=getDb();verifyNestedCheckpointPrerequisite(db);expect(db.inTransaction).toBe(false);
  });
  it("claims on the existing connection with genuine grants and launches only after the outer commit",async()=>{
    const f=fixture();const grant=f.db.prepare("SELECT status,revision FROM automation_principal_grants WHERE project_id=? AND service_principal_id=?").get(f.scope.projectId,f.job.service_principal_id) as {status:string};expect(grant.status).toBe("active");
    f.tick();await f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive);expect(f.launch).toHaveBeenCalledTimes(1);
    const run=jobs.listJobRuns(f.job.project_id,f.job.id)[0]!;expect(run.effective_service_principal_id).toBe(f.job.service_principal_id);expect(run.schedule_revision).toBe(f.job.schedule_revision);expect(getDb()).toBe(f.db);
  });
  it("crosses the real startJobRun checkpoint threshold without checkpointing inside the outer transaction",async()=>{
    const f=fixture();resetCheckpointCounter(f.db);for(let i=0;i<49;i++)checkpointAfterWrite();const wal=observeWal(f.db);
    try{f.tick();await f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive);expect(f.launch).toHaveBeenCalledTimes(1);expect(wal.calls).toHaveLength(1);expect(wal.calls[0]?.inTransaction).toBe(false);}finally{wal.restore();}
  });
  it("rolls back the real core claim, Dot operation and cursor together at the 50-write boundary",async()=>{
    const f=fixture();resetCheckpointCounter(f.db);for(let i=0;i<49;i++)checkpointAfterWrite();const wal=observeWal(f.db);
    f.db.exec("CREATE TRIGGER fixture_dot_operation_failure BEFORE INSERT ON veyra_dot_records WHEN NEW.kind='operation' BEGIN SELECT RAISE(ABORT,'first actual-core operation persistence failure'); END;");
    try{f.tick();await expect(f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive)).rejects.toThrow("first actual-core operation persistence failure");expect(jobs.listJobRuns(f.job.project_id,f.job.id)).toHaveLength(0);expect(f.launch).not.toHaveBeenCalled();expect(f.runtime.service.get(f.actor,f.scope,"followup",f.followup.id)).toMatchObject({cursor:f.followup.cursor});expect(wal.calls).toHaveLength(0);checkpointAfterWrite();expect(wal.calls.every(call=>!call.inTransaction)).toBe(true);}finally{wal.restore();f.db.exec("DROP TRIGGER fixture_dot_operation_failure");}
  });
  it("refuses a real revoked automation grant before claiming or launching",async()=>{
    const f=fixture();f.revokeGrant();f.tick();await f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive);expect(f.launch).not.toHaveBeenCalled();expect(jobs.listJobRuns(f.job.project_id,f.job.id)).toHaveLength(0);expect(f.runtime.service.page(f.actor,f.scope,"operation").data[0]).toMatchObject({state:"blocked"});
  });
  it("rechecks the real grant revision after commit and cancels only the unlaunched run",async()=>{
    const f=fixture();f.afterCommit(f.revokeGrant);f.tick();await f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive);expect(f.launch).not.toHaveBeenCalled();expect(jobs.listJobRuns(f.job.project_id,f.job.id)[0]?.status).toBe("cancelled");expect(f.diagnostics[0]?.code).toBe("DOT_LAUNCH_NOT_STARTED");
  });
  it("rejects a changed real grant revision even while its status remains active",async()=>{
    const f=fixture();f.afterCommit(()=>execTransaction(()=>{f.db.prepare("UPDATE automation_principal_grants SET revision=revision+1 WHERE project_id=? AND service_principal_id=?").run(f.job.project_id,f.job.service_principal_id);},1));
    f.tick();await f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive);const run=jobs.listJobRuns(f.job.project_id,f.job.id)[0]!;const grant=getDb().prepare("SELECT status,revision FROM automation_principal_grants WHERE project_id=? AND service_principal_id=?").get(f.job.project_id,f.job.service_principal_id) as {status:string;revision:number};expect(grant.status).toBe("active");expect(grant.revision).toBeGreaterThan(run.authorization_revision);expect(f.launch).not.toHaveBeenCalled();expect(run.status).toBe("cancelled");
  });
  it("rechecks actual project membership after commit without compatibility-principal fallback",async()=>{
    const f=fixture();expect(authorization.requireProjectPermission(f.principal(f.actor),f.job.project_id,"jobs","execute").allowed).toBe(true);
    f.afterCommit(()=>execTransaction(()=>{f.db.prepare("DELETE FROM project_memberships WHERE project_id=? AND user_id=?").run(f.job.project_id,f.actor.id);},1));
    f.tick();await f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive);expect(f.launch).not.toHaveBeenCalled();expect(jobs.listJobRuns(f.job.project_id,f.job.id)[0]?.status).toBe("cancelled");expect(()=>f.runtime.service.page(f.actor,f.scope,"operation")).toThrow("DOT_FORBIDDEN");
  });
  it.each(["source","memory","binding","generation"] as const)("rechecks %s eligibility after commit before the launcher",async kind=>{
    const f=fixture(kind==="memory"?"memory":"user");f.afterCommit(()=>{if(kind==="source")f.revokeSource();if(kind==="memory")f.revokeMemory();if(kind==="binding")f.revokeBinding();if(kind==="generation")f.stop();});
    f.tick();await f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive);expect(f.launch).not.toHaveBeenCalled();expect(jobs.listJobRuns(f.job.project_id,f.job.id)[0]?.status).toBe("cancelled");
  });
  it("keeps the original durable run after an uncertain launcher result and never replays it",async()=>{
    const f=fixture();f.launch.mockRejectedValueOnce(Error("first launch outcome unknown"));f.tick();await f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive);const original=jobs.listJobRuns(f.job.project_id,f.job.id)[0]!;expect(f.runtime.service.page(f.actor,f.scope,"operation").data[0]).toMatchObject({state:"unknown",runId:original.id});await f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive);expect(f.launch).toHaveBeenCalledTimes(1);expect(jobs.listJobRuns(f.job.project_id,f.job.id)).toHaveLength(1);
  });
  it("closes/reopens the genuine core singleton and recovers the same operation without another launch",async()=>{
    const f=fixture();f.tick();await f.runtime.dispatchJob(f.job.project_id,f.job.id,f.isActive);const original=jobs.listJobRuns(f.job.project_id,f.job.id)[0]!,connection=getDb();resetDbForTest();const reopened=getDb();expect(reopened).not.toBe(connection);expect(reopened.name).toBe(databasePath);expect(()=>f.runtime.ownsJob(f.job.project_id,f.job.id)).toThrow("DOT_DATABASE_REPLACED");
    const recovered=f.createRuntime();expect(recovered.recoverOperations()).toBeGreaterThan(0);expect(recovered.service.page(f.actor,f.scope,"operation").data[0]).toMatchObject({state:"unknown",runId:original.id});await recovered.dispatchJob(f.job.project_id,f.job.id,f.isActive);expect(f.launch).toHaveBeenCalledTimes(1);expect(jobs.listJobRuns(f.job.project_id,f.job.id)).toHaveLength(1);
  });
  it("retains actual owner-only access and does not infer external-message capabilities",()=>{
    const f=fixture(),outsider=identity.createUser(`outsider-${randomUUID()}@example.test`,"Outside fixture scope");expect(authorization.requireProjectPermission(f.principal({id:outsider.id,organizationId:f.actor.organizationId}),f.job.project_id,"jobs","read").allowed).toBe(false);
    expect(()=>f.runtime.service.page({id:outsider.id,organizationId:f.actor.organizationId},{...f.scope,ownerUserId:outsider.id},"suggestion")).toThrow("DOT_FORBIDDEN");expect(()=>f.runtime.service.propose(f.actor,f.scope,{title:"Send",prompt:"Send a message",source:{kind:"user",reference:"fixture-message/revision-1"},capabilities:["external-message"],expiresAt:"2031-01-01T00:00:00.000Z"})).toThrow("DOT_FORBIDDEN");
  });
});
