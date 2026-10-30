import { basename, isAbsolute, join, relative } from "node:path";
import { mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs";
import type { Request, Response } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authentication, getDb, identity, mcpCredentials, organizations, projects, resetDbForTest, runtimes, securityTokens } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { revalidateRequestIdentity } from "../lib/request-identity.js";

let directory = "", fixtureRoot = "", sequence = 0;
let owner: ReturnType<typeof identity.createUser>;
const changes = () => (getDb().prepare("SELECT total_changes() AS n").get() as {n:number}).n;
function request(headers: Record<string,string> = {}): Request {
  return { method:"GET", path:"/api/v1/context/memory-v2/policy", headers,
    get(name:string) { return headers[name.toLowerCase()]; } } as unknown as Request;
}
function admitted(headers: Record<string,string>): Request {
  const req = request(headers); let accepted = false;
  authMiddleware(req, {} as Response, () => { accepted = true; });
  expect(accepted).toBe(true); return req;
}
function token(user = owner) {
  return securityTokens.createScopedApiToken({userId:user.id},["memory:read","memory:write"],new Date(Date.now()+600_000));
}
function sessionHeaders() {
  const value = authentication.createSession(owner.id);
  return { value, headers:{cookie:`${authentication.SESSION_COOKIE_NAME}=${value.token}`} };
}

beforeAll(() => {
  const configured = process.env.VEYRA_REQUEST_IDENTITY_TEST_ROOT;
  if (!configured || !isAbsolute(configured)) throw Error("Explicit existing task-owned test root required");
  fixtureRoot = realpathSync(configured); if (!statSync(fixtureRoot).isDirectory()) throw Error("Fixture root unavailable");
  directory = mkdtempSync(join(fixtureRoot,"request-identity-"));
  if (relative(fixtureRoot,realpathSync(directory)).startsWith("..")) throw Error("Fixture escaped root");
  const key = join(directory,"fixture-auth-key"); writeFileSync(key,Buffer.alloc(32,27).toString("base64url"),{mode:0o600,flag:"wx"});
  vi.stubEnv("INGENIUM_HOME",directory); vi.stubEnv("INGENIUM_CORE_DB_PATH",join(directory,"data.db"));
  vi.stubEnv("INGENIUM_GLOBAL_CONFIG_PATH",join(directory,"opencode-global"));
  vi.stubEnv("INGENIUM_AUTH_ENCRYPTION_KEY_FILE",key); vi.stubEnv("INGENIUM_API_TOKEN","fixture-installation-key-".repeat(3));
  resetDbForTest(); getDb();
});
beforeEach(() => { owner = identity.createUser(`request-owner-${++sequence}@example.test`,"Fixture owner"); });
afterAll(() => {
  resetDbForTest(); vi.unstubAllEnvs();
  if (directory) writeFileSync(join(fixtureRoot,`${basename(directory)}-fixture.json`),JSON.stringify({owner:"01a188fc-d3ed-7dc2-ab95-e0eed8a793ec",directory,databaseClosed:true,containsRealUserData:false,regeneration:"Run request-identity.test.ts with same explicit task-owned root",consumer:"Review test result then exact containment/source/handle/mount cleanup"},null,2),{flag:"wx"});
});

describe("same request identity revalidation through real core authority",() => {
  it("rechecks a session inside an outer transaction without activity writes, and leaves admitted request unchanged",() => {
    const {headers}=sessionHeaders(),req=admitted(headers),original=req.principal;
    const count=changes(),before=getDb().prepare("SELECT * FROM auth_sessions WHERE user_id=?").get(owner.id);
    getDb().transaction(() => {
      const current=revalidateRequestIdentity(req); expect(current?.principal.id).toBe(owner.id);
      expect(Object.isFrozen(current)).toBe(true); expect(Object.isFrozen(current?.principal)).toBe(true);
      expect(current?.principal).not.toBe(original); expect(req.principal).toBe(original);
    })();
    expect(changes()).toBe(count); expect(getDb().prepare("SELECT * FROM auth_sessions WHERE user_id=?").get(owner.id)).toEqual(before);
  });
  it("denies a session revoked after middleware admission",() => {
    const {headers,value}=sessionHeaders(),req=admitted(headers); authentication.revokeSession(owner.id,value.session.id);
    const count=changes(); expect(revalidateRequestIdentity(req)).toBeNull(); expect(changes()).toBe(count);
  });
  it("keeps invalid-cookie precedence over a valid bearer instead of falling back",() => {
    const {headers}=sessionHeaders(),bearer=token(),req=admitted({...headers,authorization:`Bearer ${bearer.token}`});
    req.headers.cookie=`${authentication.SESSION_COOKIE_NAME}=invalid-cookie`;
    const count=changes(); expect(revalidateRequestIdentity(req)).toBeNull(); expect(changes()).toBe(count);
  });
  it("denies switching a valid credential to another actor after admission",() => {
    const original=token(),req=admitted({authorization:`Bearer ${original.token}`});
    const other=identity.createUser(`request-other-${sequence}@example.test`,"Other fixture owner"),replacement=token(other);
    req.headers.authorization=`Bearer ${replacement.token}`;
    const count=changes(); expect(revalidateRequestIdentity(req)).toBeNull(); expect(changes()).toBe(count);
  });
  it("inspects scoped credentials without writes and preserves normal admission activity",() => {
    const value=token(); expect(value.lastUsedAt).toBeNull();
    const req=admitted({authorization:`Bearer ${value.token}`});
    const before=getDb().prepare("SELECT last_used_at FROM scoped_api_tokens WHERE id=?").get(value.id) as {last_used_at:string|null};
    expect(before.last_used_at).not.toBeNull(); const count=changes();
    getDb().transaction(() => { expect(revalidateRequestIdentity(req)?.principal.id).toBe(owner.id);
      expect(securityTokens.inspectScopedApiToken(value.token,new Date(Date.now()+10_000))?.id).toBe(value.id); })();
    expect(changes()).toBe(count); expect(getDb().prepare("SELECT last_used_at FROM scoped_api_tokens WHERE id=?").get(value.id)).toEqual(before);
  });
  it("denies expired and revoked scoped credentials without updating activity",() => {
    const value=token(),req=admitted({authorization:`Bearer ${value.token}`});
    securityTokens.revokeScopedApiToken(value.id,owner.id); const count=changes();
    expect(revalidateRequestIdentity(req)).toBeNull(); expect(changes()).toBe(count);
    const expired=token(),expiredReq=admitted({authorization:`Bearer ${expired.token}`});
    const after=changes(); vi.useFakeTimers({toFake:["Date"]});
    try { vi.setSystemTime(new Date(expired.expiresAt)); expect(revalidateRequestIdentity(expiredReq)).toBeNull(); expect(changes()).toBe(after); }
    finally { vi.useRealTimers(); }
  });
  it("denies changed grants and inactive service principals",() => {
    const service=securityTokens.createServicePrincipal(null,`Request identity service ${sequence}`);
    const value=securityTokens.createScopedApiToken({servicePrincipalId:service},["memory:read"],new Date(Date.now()+600_000));
    const req=admitted({authorization:`Bearer ${value.token}`});
    const original=req.principal;
    if (original?.type!=="service") throw Error("Expected real service principal");
    req.principal={...original,scopes:["memory:write"]}; expect(revalidateRequestIdentity(req)).toBeNull(); req.principal=original;
    getDb().prepare("UPDATE service_principals SET status='revoked' WHERE id=?").run(service);
    const count=changes(); expect(securityTokens.inspectScopedApiToken(value.token)).toBeUndefined(); expect(changes()).toBe(count);
  });
  it("revalidates the actual MCP attestation without writes and rejects tampering/revocation",() => {
    const project=projects.createProject(`request-identity-project-${sequence}`); organizations.addOrganizationMember(project.organization_id,owner.id,"admin");
    const workspace=runtimes.authorizeWorkspace({id:`request-workspace-${sequence}`,organizationId:project.organization_id,projectId:project.id,ownerUserId:owner.id,storagePath:join(directory,`workspace-${sequence}`)});
    const credential=mcpCredentials.createMcpCredential({kind:"service",audience:"mcp",name:`Request delegate ${sequence}`,servicePrincipalName:`Request delegate principal ${sequence}`,scopes:["memory:read","memory:write","projects:read"],organizationId:project.organization_id,projectId:project.id,workspaceId:workspace.id,launcherWorktree:workspace.storagePath,expiresAt:new Date(Date.now()+600_000),createdByUserId:owner.id});
    const req=admitted({authorization:`Bearer ${credential.token}`,"x-ingenium-audience":"mcp","x-ingenium-workspace":workspace.id,"x-ingenium-launcher-worktree":workspace.storagePath});
    const count=changes(),before=getDb().prepare("SELECT last_used_at FROM mcp_credentials WHERE id=?").get(credential.id);
    getDb().transaction(() => { const current=revalidateRequestIdentity(req); expect(current?.attestation).toEqual(req.attestedCoordinationIdentity);
      expect(mcpCredentials.inspectMcpCredential(credential.token,"mcp",new Date(Date.now()+10_000))?.id).toBe(credential.id); })();
    expect(changes()).toBe(count); expect(getDb().prepare("SELECT last_used_at FROM mcp_credentials WHERE id=?").get(credential.id)).toEqual(before);
    const actual=req.attestedCoordinationIdentity!; req.attestedCoordinationIdentity={...actual,storageMappingHash:"f".repeat(64)};
    expect(revalidateRequestIdentity(req)).toBeNull(); req.attestedCoordinationIdentity=actual;
    mcpCredentials.revokeMcpCredential(credential.id,owner.id); expect(revalidateRequestIdentity(req)).toBeNull();
  });
  it("does not authenticate an unadmitted request or accept compatibility/runtime-gateway identities",() => {
    const value=token(); expect(revalidateRequestIdentity(request({authorization:`Bearer ${value.token}`}))).toBeNull();
    const req=request(); req.principal={type:"compatibility",id:"legacy-server-bearer",scopes:["legacy:*"]}; expect(revalidateRequestIdentity(req)).toBeNull();
    req.principal={type:"runtime-service",id:"runtime-gateway",scopes:["runtime-gateway:exchange"],audience:"runtime-gateway",network:"runtime-gateway"}; expect(revalidateRequestIdentity(req)).toBeNull();
  });
});