import { createHash } from "node:crypto";
import { basename, isAbsolute, join, parse, relative } from "node:path";
import { mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authentication, authorization, contextConversations, execTransaction,
  explicitMemory, getDb, identity, mcpCredentials, organizations, projects, resetDbForTest, runtimes,
} from "ingenium-core";
import { createCoreMemorySession, positionalCoreConnection } from "../lib/memory-v2/core-session.js";
import { createApiMemorySession, explicitMemoryForChat, type MemoryActor, type MemoryApiPorts } from "../lib/memory-v2/adapters.mjs";
import { memoryResponse } from "../lib/memory-v2/http.mjs";

interface TestRequest {
  kind: "browser" | "service";
  token: string;
  csrfToken?: string;
  attestation?: { credentialId: string; workspaceId: string; storageMappingHash: string };
  internalFixtureJob?: boolean;
  untrustedBody?: Record<string, unknown>;
}
let root = "";
let directory = "";
let databasePath = "";
let sequence = 0;
let fixture: ReturnType<typeof createFixture>;
const digest = (value: unknown) => {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") throw new Error("Fixture digest input is not serializable");
  return createHash("sha256").update(serialized, "utf8").digest("hex");
};

function authenticateFixture(request: TestRequest) {
  if (request.kind === "browser") {
    const session = authentication.resolveSession(request.token);
    if (!session) return null;
    const principal: MemoryActor = { type: "user", id: session.user_id, scopes: ["user:*"] };
    const authority: authorization.AuthorizationPrincipal = { type: "browser-user", id: session.user_id, scopes: principal.scopes };
    return { principal, authority, session };
  }
  const credential = mcpCredentials.resolveMcpCredential(request.token, "mcp");
  if (!credential || !credential.servicePrincipalId || !credential.workspaceId || !credential.storageMappingHash) return null;
  const principal: MemoryActor = { type: "service", id: credential.servicePrincipalId, tokenId: credential.id,
    scopes: credential.scopes, workspaceId: credential.workspaceId, storageMappingHash: credential.storageMappingHash };
  const authority: authorization.AuthorizationPrincipal = { type: "service-principal", id: credential.servicePrincipalId,
    scopes: credential.scopes, organizationId: credential.organizationId, projectId: credential.projectId, projectIds: credential.projectIds };
  return { principal, authority, attestation: request.attestation };
}

beforeAll(() => {
  const configured = process.env.VEYRA_MEMORY_CORE_TEST_ROOT;
  if (!configured || !isAbsolute(configured)) throw new Error("Central runner must supply an existing task-owned VEYRA_MEMORY_CORE_TEST_ROOT; no temp/profile fallback is permitted");
  root = realpathSync(configured);
  if (!statSync(root).isDirectory() || root === parse(root).root) throw new Error("Invalid task-owned fixture root");
  directory = mkdtempSync(join(root, "veyra-memory-core-"));
  if (relative(root, realpathSync(directory)).startsWith("..")) throw new Error("Fixture escaped the supplied root");
  databasePath = join(directory, "data.db");
  const keyPath = join(directory, "fixture-auth-key");
  writeFileSync(keyPath, Buffer.alloc(32, 19).toString("base64url"), { mode: 0o600, flag: "wx" });
  vi.stubEnv("INGENIUM_HOME", directory);
  vi.stubEnv("INGENIUM_GLOBAL_CONFIG_PATH", join(directory, "opencode-global"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", databasePath);
  vi.stubEnv("INGENIUM_AUTH_ENCRYPTION_KEY_FILE", keyPath);
  resetDbForTest();
  const db = getDb();
  // Require the real coordinator migration; never install the proposal schema to turn a missing migration green.
  const columns = db.pragma("table_xinfo(veyra_memory_policy)") as Array<{ name: string; hidden: number }>;
  expect(columns).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "scope_organization_id", hidden: 2 }),
    expect.objectContaining({ name: "scope_owner_user_id", hidden: 2 }),
  ]));
  expect(db.pragma("foreign_key_check")).toEqual([]);
});

beforeEach(() => { fixture = createFixture(); });
afterAll(() => {
  resetDbForTest();
  vi.unstubAllEnvs();
  if (!directory) return;
  // Central ownership/handle checks reconcile this single fixture after the result is reviewed.
  writeFileSync(join(root, `${basename(directory)}-fixture.json`), JSON.stringify({ directory, databasePath,
    generatedBy: "veyra-memory-core-adapters.test.ts", containsRealUserData: false,
    consumer: "coordinator reviews central test result and any first failure before safety-checked removal",
    regeneration: "Run the scoped Vitest command with the same explicit owned root", databaseClosed: true }, null, 2) + "\n", { flag: "wx" });
});

function createFixture() {
  const index = ++sequence;
  const project = projects.createProject(`veyra-memory-core-${index}`);
  const owner = identity.createUser(`veyra-memory-core-owner-${index}@example.test`, "Memory fixture owner");
  const other = identity.createUser(`veyra-memory-core-other-${index}@example.test`, "Memory fixture other");
  organizations.addOrganizationMember(project.organization_id, owner.id, "admin");
  organizations.addOrganizationMember(project.organization_id, other.id, "admin");
  const workspace = runtimes.authorizeWorkspace({ id: `core-memory-workspace-${index}`, organizationId: project.organization_id,
    projectId: project.id, ownerUserId: owner.id, storagePath: join(directory, `workspace-${index}`) });
  let runtime = runtimes.createRuntimeInstance(workspace.id, {
    cpuMillis: 1_000, memoryBytes: 536_870_912, pidsLimit: 128, diskBytes: 536_870_912, processLimit: 64,
  });
  const runtimeCredential = mcpCredentials.createMcpCredential({ kind: "runtime", audience: "runtime", name: `Fixture runtime binding ${index}`, servicePrincipalName: `Memory runtime principal ${index}`,
    scopes: ["child-mcp:runtime", "projects:read"], organizationId: project.organization_id, projectId: project.id,
    workspaceId: workspace.id, launcherWorktree: workspace.storagePath, expiresAt: new Date(Date.now() + 600_000), createdByUserId: owner.id });
  runtimes.bindRuntimeCapability(runtime.id, runtimeCredential.id);
  for (const state of ["PROVISIONING", "STARTING", "READY", "IDLE"] as const) {
    // These are fixture DB transitions only: no provisioner, backend, container, model or scheduler is invoked.
    runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: state,
      actorType: "system", actorId: "memory-core-vitest", idleExpiresAt: new Date(Date.now() + 300_000), absoluteExpiresAt: new Date(Date.now() + 600_000) });
  }
  const chatId = `source-chat-${index}`, freshChatId = `fresh-chat-${index}`;
  const conversations = new Map<string, ReturnType<typeof contextConversations.createContextConversation>>([chatId, freshChatId].map((sessionId) => [sessionId, contextConversations.createContextConversation(project.id, {
    title: "Fixture private Chat", organizationId: project.organization_id, ownerUserId: owner.id, visibility: "private",
    metadata: { source: "opencode-chat", sourceRuntimeId: runtime.id, sourceSessionId: sessionId }, idempotencyKey: `fixture-${sessionId}`,
  })] as const));
  const conversation = conversations.get(chatId)!;
  const appended = contextConversations.appendContextMessage(project.id, conversation.id, {
    role: "user", content: "Please prefer concise explanations.", expectedRevision: 0, idempotencyKey: "fixture-message",
  });
  const ownerSession = authentication.createSession(owner.id, new Date(), "Memory fixture", true);
  const otherSession = authentication.createSession(other.id, new Date(), "Other fixture", true);
  const request: TestRequest = { kind: "browser", token: ownerSession.token, csrfToken: ownerSession.csrfToken,
    untrustedBody: { ownerUserId: other.id, organizationId: "forged", bindingHash: "forged" } };
  const credential = mcpCredentials.createMcpCredential({ kind: "service", audience: "mcp", name: `Fixture memory delegation ${index}`, servicePrincipalName: `Memory delegation principal ${index}`,
    scopes: ["memory:read", "memory:write", "projects:read"], organizationId: project.organization_id, projectId: project.id,
    workspaceId: workspace.id, launcherWorktree: workspace.storagePath, expiresAt: new Date(Date.now() + 600_000), createdByUserId: owner.id });
  const ports: Omit<MemoryApiPorts<TestRequest>, "core" | "resolveExistingScope"> = {
    request, selected: { projectId: project.id, workspaceId: workspace.id, runtimeId: runtime.id }, authenticate: authenticateFixture,
    resolveExecution: ({ ownership, runtimeId }) => {
      const actual = runtimes.getRuntimeInstance(runtimeId);
      if (!actual || !["READY", "IDLE"].includes(actual.state) || actual.workspaceId !== ownership.workspaceId
        || actual.ownerUserId !== ownership.ownerUserId || actual.securityEpoch !== ownership.bindingEpoch) return null;
      return { ...ownership, runtimeId, hostId: "fixture-host", environmentId: "fixture-environment", mode: "runtime", available: true };
    },
    resolveChatBinding: ({ scope, execution, chatId: selectedChat }) => {
      const saved = conversations.get(selectedChat);
      const actual = saved && contextConversations.getContextConversation(project.id, saved.id);
      if (!actual || actual.owner_user_id !== scope.ownerUserId || actual.organization_id !== scope.organizationId || actual.visibility !== "private") return null;
      const metadata = typeof actual.metadata === "string" ? JSON.parse(actual.metadata) : actual.metadata;
      if (metadata.sourceRuntimeId !== execution.runtimeId || metadata.sourceSessionId !== selectedChat) return null;
      return { ...scope, runtimeId: execution.runtimeId, chatId: selectedChat, available: true };
    },
    authorizeOperation: ({ request: currentRequest, principal, scope, permission }) => {
      const current = authenticateFixture(currentRequest);
      if (!current || current.principal.id !== principal.id || scope.projectId === null) return false;
      const read = permission === "read" || permission === "read-source";
      if (!read && "session" in current && current.session
        && (!currentRequest.csrfToken || !authentication.verifySessionCsrf(current.session, currentRequest.csrfToken))) return false;
      if (permission === "generate" && currentRequest.internalFixtureJob !== true) return false;
      return authorization.requireProjectPermission(current.authority, scope.projectId, "memory",
        read ? "read" : permission === "generate" ? "execute" : permission === "backup" || permission === "restore" ? "admin" : "write").allowed;
    },
    resolveSourceState: ({ execution, messageId, conversationId, contentHash }) => {
      const actual = contextConversations.getContextMessage(project.id, conversationId, messageId);
      const actualRuntime = runtimes.getRuntimeInstance(execution.runtimeId);
      if (!actual || !actualRuntime || actual.content_hash !== contentHash) return null;
      return { active: actualRuntime.activeGenerations > 0, excluded: false, uncertain: false,
        idleEligible: actualRuntime.state === "IDLE" && actualRuntime.activeGenerations === 0 };
    },
  };
  const make = () => createCoreMemorySession(ports);
  const session = make();
  const legacyScope = explicitMemory.resolveExplicitMemoryScope({ projectId: project.id, workspaceId: workspace.id,
    principal: { type: "user", userId: owner.id } });
  explicitMemory.saveExplicitMemory(legacyScope, { operationId: "existing-explicit", content: "An explicit saved preference.", tags: ["fixture"] });
  const originalDigest = () => digest([
    getDb().prepare("SELECT * FROM explicit_memories WHERE project_id=? ORDER BY id").all(project.id),
    getDb().prepare("SELECT * FROM explicit_memory_operation_receipts WHERE project_id=? ORDER BY id").all(project.id),
    getDb().prepare("SELECT * FROM context_conversations WHERE project_id=? ORDER BY id").all(project.id),
    getDb().prepare("SELECT * FROM context_messages WHERE project_id=? ORDER BY id").all(project.id),
  ]);
  const response = () => memoryResponse(session.memory, (_request, permission) => session.resolveScope(permission, chatId),
    { method: "GET", action: "policy", chatId });
  return { project, owner, other, workspace, runtime, chatId, freshChatId, message: appended.message, credential,
    request, ownerSession, otherSession, ports, session, make, originalDigest, response };
}

describe.sequential("Veyra memory adapter against actual core persistence and authorization", () => {
  it("keeps positional null bindings and transaction state on the same actual SQLite handle", () => {
    const native = getDb();
    const connection = positionalCoreConnection(native);
    expect(positionalCoreConnection(native)).toBe(connection);
    expect(connection.inTransaction).toBe(false);
    connection.exec("CREATE TEMP TABLE memory_positional_fixture (nullable_value TEXT, text_value TEXT, number_value INTEGER)");
    try {
      const insert = connection.prepare("INSERT INTO memory_positional_fixture VALUES (?,?,?)");
      execTransaction(() => {
        expect(connection.inTransaction).toBe(true);
        insert.run(null, "bound text", 17);
      }, 1);
      expect(connection.inTransaction).toBe(false);
      const rows = connection.prepare("SELECT nullable_value,text_value,number_value FROM memory_positional_fixture WHERE nullable_value IS ?");
      expect(rows.get(null)).toEqual({ nullable_value: null, text_value: "bound text", number_value: 17 });
      expect(rows.all(null)).toEqual([{ nullable_value: null, text_value: "bound text", number_value: 17 }]);
      expect(() => execTransaction(() => { insert.run(null, "rolled back", 18); throw new Error("fixture rollback"); }, 1)).toThrowError("fixture rollback");
      expect(rows.all(null)).toHaveLength(1);
    } finally {
      connection.exec("DROP TABLE memory_positional_fixture");
    }
  });
  it("denies the wrong authenticated actor and a revoked real browser session", () => {
    expect(fixture.response().status).toBe(200);
    expect(fixture.session.resolveScope("read", fixture.chatId).ownerUserId).toBe(fixture.owner.id);
    fixture.request.token = fixture.otherSession.token;
    expect(fixture.response().status).toBe(403);
    fixture.request.token = fixture.ownerSession.token;
    authentication.revokeSession(fixture.owner.id, fixture.ownerSession.session.id);
    expect(fixture.response().status).toBe(403);
  });
  it("requires actual service credential resolution and exact attestation", () => {
    fixture.request.kind = "service";
    fixture.request.token = fixture.credential.token;
    fixture.request.attestation = { credentialId: fixture.credential.id, workspaceId: fixture.workspace.id, storageMappingHash: fixture.workspace.storageMappingHash };
    expect(fixture.response().status).toBe(200);
    fixture.request.attestation.storageMappingHash = "f".repeat(64);
    expect(fixture.response().status).toBe(403);
    fixture.request.attestation.storageMappingHash = fixture.workspace.storageMappingHash;
    mcpCredentials.revokeMcpCredential(fixture.credential.id, fixture.owner.id);
    expect(fixture.response().status).toBe(403);
  });
  it("rejects a formerly valid scope after actual workspace epoch revocation", () => {
    const scope = fixture.session.resolveScope("read", fixture.chatId);
    runtimes.transitionRuntime({ id: fixture.runtime.id, expectedRevision: fixture.runtime.revision, toState: "REVOKED", actorType: "system", actorId: "memory-core-vitest" });
    const revoked = runtimes.revokeAuthorizedWorkspace(fixture.workspace.id)!;
    expect(revoked.securityEpoch).toBe(scope.bindingEpoch + 1);
    expect(fixture.response().status).toBe(403);
    expect(() => fixture.session.memory.recall(scope, fixture.freshChatId)).toThrow();
  });
  it("persists same-scope fresh-chat recall and receipts across reopen, then suppresses forget without changing original rows", () => {
    fixture.request.internalFixtureJob = true;
    let session = fixture.session;
    const scope = session.resolveScope("generate", fixture.chatId);
    const original = fixture.originalDigest();
    session.memory.setPolicy(scope, { operationId: "enable", expectedRevision: 0, enabled: true, generate: true, useMemory: true, externalContext: false });
    session.memory.setChatPolicy(scope, fixture.chatId, { operationId: "contribute", expectedRevision: 0, useMemory: true, contribute: true });
    const admission = session.memory.admit(scope, fixture.chatId, [{ id: fixture.message.id, contentHash: fixture.message.content_hash }]);
    const saved = session.memory.commitRecall(scope, { operationId: "saved", admission, content: "Concise explanations preferred.", model: "fixture-no-inference" });
    resetDbForTest();
    session = fixture.make();
    const freshScope = session.resolveScope("read", fixture.freshChatId);
    expect(session.memory.recall(freshScope, fixture.freshChatId).items.map((item) => item.id)).toEqual([saved.receipt.memoryId]);
    expect(session.memory.operation(freshScope, "saved")).toEqual(saved.receipt);
    session.memory.forget(freshScope, { operationId: "forgotten", memoryId: saved.receipt.memoryId!, expectedVersion: 1 });
    resetDbForTest();
    session = fixture.make();
    const reopened = session.resolveScope("read", fixture.freshChatId);
    expect(session.memory.recall(reopened, fixture.freshChatId).items).toEqual([]);
    expect(session.memory.operation(reopened, "forgotten")?.status).toBe("committed");
    expect(() => session.memory.admit(reopened, fixture.chatId, [{ id: fixture.message.id, contentHash: fixture.message.content_hash }])).toThrowError("SOURCE_FORGOTTEN");
    expect(fixture.originalDigest()).toBe(original);
    expect(getDb().pragma("foreign_key_check")).toEqual([]);
  });
  it("preserves the original committed receipt after a controlled post-commit failure and reopening", () => {
    const fault = createApiMemorySession({ ...fixture.ports,
      core: { getDb: () => positionalCoreConnection(getDb()), execTransaction, checkpointAfterWrite: () => { throw new Error("fixture post-commit checkpoint fault"); } },
      resolveExistingScope: explicitMemory.resolveExplicitMemoryScope });
    const scope = fault.resolveScope("write-policy", fixture.chatId);
    const input = { operationId: "original-request", expectedRevision: 0, useMemory: false, contribute: false };
    expect(() => fault.memory.setChatPolicy(scope, fixture.chatId, input)).toThrowError("fixture post-commit checkpoint fault");
    const original = fault.memory.operation(scope, input.operationId);
    expect(original?.status).toBe("committed");
    resetDbForTest();
    const reopened = fixture.make();
    const currentScope = reopened.resolveScope("write-policy", fixture.chatId);
    expect(reopened.memory.operation(currentScope, input.operationId)).toEqual(original);
    const replay = reopened.memory.setChatPolicy(currentScope, fixture.chatId, input);
    expect(replay.idempotent).toBe(true);
    expect(replay.receipt).toEqual(original);
    expect(reopened.memory.policy(currentScope, fixture.chatId).chat.revision).toBe(1);
  });
  it("uses the same read control for actual explicit saved memory without changing its mutation authority", async () => {
    const scope = fixture.session.resolveScope("read", fixture.chatId);
    let calls = 0;
    const loadExplicit = (legacy: explicitMemory.ExplicitMemoryScope) => { calls++; return explicitMemory.listExplicitMemories(legacy, "private", { maxItems: 16, maxTokens: 2048 }); };
    expect((await explicitMemoryForChat({ memory: fixture.session.memory, scope, chatId: fixture.chatId, loadExplicit })).page?.items).toHaveLength(1);
    fixture.session.memory.setChatPolicy(scope, fixture.chatId, { operationId: "exclude-explicit", expectedRevision: 0, useMemory: false, contribute: false });
    expect((await explicitMemoryForChat({ memory: fixture.session.memory, scope, chatId: fixture.chatId, loadExplicit })).excluded).toBe(true);
    expect(calls).toBe(1);
  });
});
