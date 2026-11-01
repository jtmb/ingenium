import{randomUUID}from"node:crypto";
import{readFileSync,writeFileSync,readdirSync,realpathSync}from"node:fs";
import{join,isAbsolute,relative}from"node:path";
import{beforeAll,afterAll,it,expect,vi}from"vitest";
import{getDb,resetDbForTest,identity,organizations,runtimes,mcpCredentials,workspaceRuntimeCredentialsV2 as credentials}from"ingenium-core";
let directory="",root="";
beforeAll(()=>{
 const configured=process.env.VEYRA_MEMORY_HTTP_TEST_ROOT;if(!configured||!isAbsolute(configured))throw Error("Original explicit synthetic fixture required");root=realpathSync(configured);
 const owner=JSON.parse(readFileSync(join(root,".task-owner.json"),"utf8"));if(owner.owner!=="01a188fc-d3ed-7dc2-ab95-e0eed8a793ec"||owner.containsRealData!==false)throw Error("Synthetic owner required");
 const receipts=readdirSync(root).filter(n=>/^memory-http-.*-fixture\.json$/.test(n));if(receipts.length!==1)throw Error("Exactly original closed fixture required");
 const original=JSON.parse(readFileSync(join(root,receipts[0]!),"utf8"));directory=realpathSync(original.directory);
 if(relative(root,directory).startsWith("..")||!original.databaseClosed||!original.httpServerClosed||original.containsRealUserData!==false)throw Error("Closed synthetic data only");
 vi.stubEnv("INGENIUM_HOME",directory);vi.stubEnv("INGENIUM_CORE_DB_PATH",join(directory,"data.db"));vi.stubEnv("INGENIUM_GLOBAL_CONFIG_PATH",join(directory,"opencode-global"));vi.stubEnv("INGENIUM_AUTH_ENCRYPTION_KEY_FILE",join(directory,"fixture-auth-key"));resetDbForTest();getDb();
});
afterAll(()=>{resetDbForTest();vi.unstubAllEnvs();if(root)writeFileSync(join(root,"workspace-v2-credentials-consumed.json"),JSON.stringify({owner:"01a188fc-d3ed-7dc2-ab95-e0eed8a793ec",databaseClosed:true,containsRealUserData:false,consumer:"Review credential/epoch results then retire shared synthetic fixture"}),{flag:"wx"});});
function setup(){const id=randomUUID(),user=identity.createUser(`credential-${id}@example.test`,"Credential fixture"),org=organizations.createOrganization("Workspace credential fixture",`cred-${id}`);organizations.addOrganizationMember(org,user.id,"admin");
 const w=runtimes.authorizeWorkspaceV2({schemaVersion:2,scopeKind:"workspace",projectId:null,id:`cred-${id}`,organizationId:org,ownerUserId:user.id,storagePath:join(directory,`cred-${id}`)});
 const r=runtimes.createWorkspaceRuntimeV2(w.id,{cpuMillis:1000,memoryBytes:536870912,pidsLimit:128,diskBytes:536870912,processLimit:64});return{user,org,w,r};}
const counts=()=>Object.fromEntries(['service_principals','mcp_credentials','mcp_credential_receipts'].map(name=>[name,(getDb().prepare(`SELECT count(*) AS n FROM ${name}`).get()as{n:number}).n]));
function issue(){const s=setup(),end=new Date(Date.now()+300000),c=credentials.issueWorkspaceRuntimeCredentialV2(s.r.id,end);runtimes.bindWorkspaceRuntimeCapabilityV2(s.r.id,c.id);
 runtimes.transitionWorkspaceRuntimeV2({id:s.r.id,expectedRevision:s.r.revision,toState:"PROVISIONING",actorType:"manager",actorId:"source-credential-test",idleExpiresAt:end,absoluteExpiresAt:end});return{...s,c};}
it("uses actual encrypted credential custody, retains null scope and cannot enter v1 credential authority",()=>{
 const s=issue(),read=credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token);expect(read).toMatchObject({schemaVersion:2,projectId:null,projectIds:[],runtimeId:s.r.id,workspaceId:s.w.id,credentialId:s.c.id});
 expect(mcpCredentials.inspectMcpCredential(s.c.token,"runtime")).toBeUndefined();expect(credentials.inspectActiveWorkspaceRuntimeCredentialV2(s.c.token)).toBeUndefined();
 const receipt=getDb().prepare("SELECT encrypted_token FROM mcp_credential_receipts WHERE credential_id=?").get(s.c.id)as{encrypted_token:string};expect(receipt.encrypted_token).not.toContain(s.c.token);expect(counts().mcp_credentials).toBeGreaterThan(0);
 credentials.revokeWorkspaceRuntimeCredentialV2(s.r.id,s.c.id);expect(credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token)).toBeUndefined();
});
it("denies a disabled owner independently of an unchanged user security epoch",()=>{
 const s=issue(),db=getDb(),before=db.prepare("SELECT security_epoch FROM users WHERE id=?").get(s.user.id);expect(credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token)).toBeTruthy();
 db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(s.user.id);expect(db.prepare("SELECT security_epoch FROM users WHERE id=?").get(s.user.id)).toEqual(before);
 expect(credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token)).toBeUndefined();expect(credentials.inspectWorkspaceMcpCredentialV2(s.c.token)).toBeUndefined();
 db.prepare("UPDATE users SET status='active' WHERE id=?").run(s.user.id);expect(credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token)).toBeTruthy();
 db.prepare("UPDATE users SET security_epoch=security_epoch+1 WHERE id=?").run(s.user.id);expect(credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token)).toBeUndefined();
});
it("denies disabled-user issuance before principal, credential or encrypted receipt writes",()=>{
 const s=setup(),db=getDb();db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(s.user.id);const before=counts();expect(()=>credentials.issueWorkspaceRuntimeCredentialV2(s.r.id,new Date(Date.now()+300000))).toThrow();expect(counts()).toEqual(before);
});
it("rechecks active organization, membership and workspace binding on each original credential inspection",()=>{
 const s=issue(),db=getDb();db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(s.org);expect(credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token)).toBeUndefined();
 db.prepare("UPDATE organizations SET status='active' WHERE id=?").run(s.org);expect(credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token)).toBeTruthy();
 db.prepare("UPDATE organization_memberships SET status='suspended' WHERE organization_id=? AND user_id=?").run(s.org,s.user.id);expect(credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token)).toBeUndefined();
 db.prepare("UPDATE organization_memberships SET status='active' WHERE organization_id=? AND user_id=?").run(s.org,s.user.id);expect(credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token)).toBeTruthy();
 db.prepare("UPDATE authorized_workspaces SET security_epoch=security_epoch+1 WHERE id=?").run(s.w.id);expect(credentials.inspectWorkspaceBootstrapCredentialV2(s.c.token)).toBeUndefined();
});
