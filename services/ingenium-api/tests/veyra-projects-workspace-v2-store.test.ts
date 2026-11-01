import{randomUUID}from"node:crypto";
import {readFileSync,realpathSync,statSync,readdirSync,writeFileSync}from"node:fs";
import{join,isAbsolute,relative}from"node:path";
import{beforeAll,afterAll,expect,it,vi}from"vitest";
import{getDb,resetDbForTest,identity,organizations,projects,runtimes,workspaceContext}from"ingenium-core";
let directory="",root="";
beforeAll(()=>{
 const configured=process.env.VEYRA_MEMORY_HTTP_TEST_ROOT;if(!configured||!isAbsolute(configured))throw Error("Explicit original synthetic fixture required");
 root=realpathSync(configured);const owner=JSON.parse(readFileSync(join(root,".task-owner.json"),"utf8"));if(owner.owner!=="01a188fc-d3ed-7dc2-ab95-e0eed8a793ec"||owner.containsRealData!==false)throw Error("Original synthetic owner required");
 const receipts=readdirSync(root).filter(name=>/^memory-http-.*-fixture\.json$/.test(name));if(receipts.length!==1)throw Error("Exactly original closed fixture required");
 const original=JSON.parse(readFileSync(join(root,receipts[0]!),"utf8"));directory=realpathSync(original.directory);
 if(relative(root,directory).startsWith("..")||!original.databaseClosed||!original.httpServerClosed||original.containsRealUserData!==false||!statSync(join(directory,"data.db")).isFile())throw Error("Original closed synthetic database required");
 vi.stubEnv("INGENIUM_HOME",directory);vi.stubEnv("INGENIUM_CORE_DB_PATH",join(directory,"data.db"));vi.stubEnv("INGENIUM_GLOBAL_CONFIG_PATH",join(directory,"opencode-global"));
 vi.stubEnv("INGENIUM_AUTH_ENCRYPTION_KEY_FILE",join(directory,"fixture-auth-key"));vi.stubEnv("INGENIUM_DEPLOYMENT_MODE","control-plane");resetDbForTest();getDb();
});
afterAll(()=>{resetDbForTest();vi.unstubAllEnvs();if(root)writeFileSync(join(root,"workspace-v2-store-consumed.json"),JSON.stringify({owner:"01a188fc-d3ed-7dc2-ab95-e0eed8a793ec",databaseClosed:true,containsRealUserData:false,consumer:"Review actual single-writer v2 tests then retire original synthetic fixture"}),{flag:"w"});});
it("reopens the actual populated schema with verified Context/workspace migrations and valid FKs",()=>{
 const db=getDb();expect(db.prepare("SELECT version FROM veyra_evolution_136").get()).toEqual({version:136});expect(db.prepare("SELECT version FROM veyra_evolution_137").get()).toEqual({version:137});
 expect(db.pragma("foreign_key_check")).toEqual([]);expect(db.pragma("quick_check",{simple:true})).toBe("ok");
});
it("creates real null-Project workspaces in the existing writer, preserves v1 isolation, and refuses fabricated Context execution",()=>{
 const attempt=randomUUID(),user=identity.createUser(`v2-${attempt}@example.test`,"Workspace fixture"),org=organizations.createOrganization("V2 source fixture",`v2-${attempt}`);
 organizations.addOrganizationMember(org,user.id,"admin");const db=getDb(),beforeProjects=db.prepare("SELECT count(*) AS n FROM projects").get();
 const workspace=runtimes.authorizeWorkspaceV2({schemaVersion:2,scopeKind:"workspace",projectId:null,id:`v2-${attempt}`,organizationId:org,ownerUserId:user.id,storagePath:join(directory,`v2-${attempt}`)});
 expect(workspace.projectId).toBeNull();expect(workspace.schemaVersion).toBe(2);expect(runtimes.getAuthorizedWorkspace(workspace.id)).toBeUndefined();
 expect(runtimes.getAuthorizedWorkspaceV2(workspace.id)).toEqual(workspace);expect(db.prepare("SELECT count(*) AS n FROM projects").get()).toEqual(beforeProjects);
 const runtime=runtimes.createWorkspaceRuntimeV2(workspace.id,{cpuMillis:1000,memoryBytes:536870912,pidsLimit:128,diskBytes:536870912,processLimit:64});
 expect(runtime.projectId).toBeNull();expect(runtime.state).toBe("ABSENT");expect(runtimes.getRuntimeInstance(runtime.id)).toBeUndefined();
 const provisioning=runtimes.transitionWorkspaceRuntimeV2({id:runtime.id,expectedRevision:runtime.revision,toState:"PROVISIONING",actorType:"user",actorId:user.id,maxActiveRuntimes:1});
 const beforeContext=db.prepare("SELECT count(*) AS n FROM context_conversations").get();
 expect(()=>db.transaction(()=>workspaceContext.createInTransaction(db as never,{projectId:null,organizationId:org,ownerUserId:user.id,workspaceId:workspace.id,runtimeId:runtime.id,bindingHash:workspace.storageMappingHash,bindingEpoch:workspace.securityEpoch,executionGeneration:"f".repeat(64)},{title:"Never created"})).immediate()).toThrow();
 expect(db.prepare("SELECT count(*) AS n FROM context_conversations").get()).toEqual(beforeContext);
 expect(()=>runtimes.transitionWorkspaceRuntimeV2({id:runtime.id,expectedRevision:provisioning.revision,toState:"STARTING",actorType:"manager",actorId:"fixture-no-original"})).toThrow();
 expect(runtimes.getWorkspaceRuntimeV2(runtime.id)?.state).toBe("PROVISIONING");
 resetDbForTest();expect(getDb().pragma("foreign_key_check")).toEqual([]);expect(runtimes.getWorkspaceRuntimeV2(runtime.id)?.projectId).toBeNull();
});
it("revokes an unused v2 workspace through the same owner without a synthetic Project",()=>{
 const user=identity.createUser("v2-revoke-fixture@example.test","Revocation fixture"),org=organizations.createOrganization("V2 revoke fixture","v2-revoke-fixture");organizations.addOrganizationMember(org,user.id,"admin");
 const workspace=runtimes.authorizeWorkspaceV2({schemaVersion:2,scopeKind:"workspace",projectId:null,id:"v2-revoke-workspace",organizationId:org,ownerUserId:user.id,storagePath:join(directory,"v2-revoke")});
 const revoked=runtimes.revokeAuthorizedWorkspaceV2(workspace.id);expect(revoked?.status).toBe("revoked");expect(revoked?.securityEpoch).toBe(workspace.securityEpoch+1);expect(revoked?.projectId).toBeNull();
 expect(runtimes.getAuthorizedWorkspace(workspace.id)).toBeUndefined();expect(projects.getProjectById("v2-revoke-workspace")).toBeUndefined();
});
