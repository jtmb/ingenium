import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY, COORDINATION_OUTBOX_OVERFLOW_AUTHORITY_SHA256 } from "./coordination-outbox.js";
import { stableRestartTodos } from "./replacement-first-restart.js";
import { inspectProductionRestartBinding } from "./scripts/production-restart.js";

const shim = await import(/* @vite-ignore */ new URL("./scripts/recovery-bootstrap.js", import.meta.url).href);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const projectId = "11111111-1111-4111-8111-111111111111";
const head = "a".repeat(40);
let root: string;
let binding: any;
let environment: Record<string, string>;
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });

beforeEach(() => {
  root = mkdtempSync("/tmp/opencode/recovery-preadmission-");
  mkdirSync(join(root, ".opencode"), { mode: 0o700 });
  binding = { project: "ingenium", projectId, workspaceId: "ingenium-test", storageMappingHash: hash("storage"), worktree: root };
  environment = { INGENIUM_PROJECT: binding.project, INGENIUM_WORKSPACE_ID: binding.workspaceId,
    INGENIUM_WORKTREE: root, INGENIUM_API_URL: "http://127.0.0.1:4097/api/v1", INGENIUM_MCP_AUDIENCE: "mcp",
    INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential" };
  json(join(root, "opencode.json"), { mcp: { ingenium: { type: "local", environment } },
    agent: { "ingenium-orchestrator": { mode: "primary" } } });
  writeFileSync(join(root, ".opencode/.ingenium-mcp-credential"), "c".repeat(43), { mode: 0o600 });
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

function authorityRequest(change: Record<string, unknown> = {}) {
  return vi.fn(async (url: string, init: RequestInit) => {
    expect(init.method ?? "GET").toBe("GET");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${"c".repeat(43)}`);
    return new Response(JSON.stringify({ data: url.endsWith("/auth/preflight") ? {
      scopes: ["projects:read"], organizationId: projectId, projectId, projectIds: [projectId], audience: "mcp",
      workspaceId: binding.workspaceId, launcherWorktree: root, storageMappingHash: binding.storageMappingHash,
      restartRequiredOnCredentialChange: true, ...change,
    } : { project: { id: projectId, name: "ingenium", ...change } } }), { status: 200 });
  });
}

describe("recovery configured authority", () => {
  it("resolves the existing MCP binding without inherited UUID/storage and corroborates both independently", async () => {
    const configured = shim.recoveryConfiguredEnvironment(root, {});
    const request = authorityRequest();
    expect(await shim.corroborateRecoveryBinding(root, configured, request)).toEqual(binding);
    expect(request).toHaveBeenCalledTimes(2);
    expect(shim.recoveryEnvironmentForBinding(binding, {})).toMatchObject({ INGENIUM_PROJECT_ID: projectId,
      INGENIUM_STORAGE_MAPPING_HASH: binding.storageMappingHash });
    for (const key of Object.keys(environment)) vi.stubEnv(key, environment[key]);
    vi.stubEnv("INGENIUM_MCP_CREDENTIAL_PURPOSE", "general");
    expect(await inspectProductionRestartBinding(root, request as unknown as typeof fetch)).toMatchObject({
      projectId, workspaceId: binding.workspaceId, storageMappingHash: binding.storageMappingHash, launcherWorktree: root,
    });
  });
  it("rejects conflicting configuration, foreign authority, and changed source binding", async () => {
    expect(() => shim.recoveryConfiguredEnvironment(root, { INGENIUM_PROJECT: "foreign" })).toThrow();
    expect(() => shim.recoveryEnvironmentForBinding({ ...binding, workspaceId: "foreign" }, {})).toThrow();
    for (const change of [{ workspaceId: "foreign" }, { launcherWorktree: "/foreign" }, { projectIds: [] },
      { projectId: "not-a-uuid" }, { storageMappingHash: "invalid" }, { name: "foreign" }]) {
      await expect(shim.corroborateRecoveryBinding(root, environment, authorityRequest(change))).rejects.toThrow();
    }
    json(join(root, "opencode.json"), { mcp: { ingenium: { type: "local", environment },
      foreign: { environment: { INGENIUM_MCP_AUDIENCE: "mcp" } } } });
    expect(() => shim.recoveryConfiguredEnvironment(root, {})).toThrow();
  });
  it("accepts inspected OCI health separately and rejects stale, foreign, unhealthy or multiple containers", () => {
    const image = `sha256:${hash("image")}`;
    const container: any = { Id: hash("container"), Image: image, Config: { Labels: {
      "com.docker.compose.project.working_dir": root, "com.docker.compose.service": "ingenium" } },
      State: { Running: true, Health: { Status: "healthy" } } };
    const run = vi.fn((_command: string, args: string[]) => args[2] === "ps" ? container.Id.slice(0, 12)
      : JSON.stringify(args[2] === "image" ? [{ Id: image, Config: { Labels: { "org.opencontainers.image.revision": head } } }] : [container]));
    expect(shim.inspectRecoveryDeployment(root, head, run)).toMatchObject({ status: "attested", provider: "docker-local", image });
    expect(shim.inspectRecoveryDeployment(root, "b".repeat(40), run).status).toBe("unavailable");
    container.State.Health.Status = "unhealthy";
    expect(shim.inspectRecoveryDeployment(root, head, run).status).toBe("unavailable");
    container.State.Health.Status = "healthy";
    container.Config.Labels["com.docker.compose.project.working_dir"] = "/foreign";
    expect(shim.inspectRecoveryDeployment(root, head, run).status).toBe("unavailable");
    expect(shim.inspectRecoveryDeployment(root, head, () => "abc\ndef").status).toBe("unavailable");
  });
});

function legacyFixture() {
  const parent: any = { pid: 100, startTimeTicks: 10, executableSha256: hash("exe"), nonceSha256: "0".repeat(64),
    cwd: root, cmdlineSha256: hash("argv"), port: 4098, sessionId: null,
    environment: { OPENCODE_SERVER_PASSWORD: "p".repeat(43) } };
  const source = { status: "validated", head, sourceMatchesHead: true, dirtyPaths: [] as string[] };
  const todos = [{ id: "TODO-1", content: "private tool arguments and credentials", status: "in_progress", priority: "high" },
    { content: "legacy stable todo", status: "pending", priority: "medium" }];
  const payloads: Record<string, any> = {
    "/session": [{ id: "ses_exact", directory: root }],
    "/session/status": { ses_exact: { type: "busy" } },
    "/global/health": { healthy: true, version: "1.0.0" },
    "/session/ses_exact": { id: "ses_exact", directory: root, currentTaskId: "task" },
    "/session/ses_exact/message": [{ info: { role: "assistant", agent: "ingenium-orchestrator" }, parts: [
      { type: "text", text: "private transcript" }, { type: "reasoning", text: "private reasoning" },
      { type: "tool", tool: "todowrite", state: { status: "completed", input: { todos } } },
    ] }],
  };
  const request = vi.fn(async (url: string) => new Response(JSON.stringify(payloads[new URL(url).pathname]), { status: 200 }));
  const inspect = vi.fn(() => ({ ...parent, commandName: "opencode", ports: [4098], nonce: undefined }));
  return { parent, source, todos, payloads, request, inspect,
    capture: () => shim.captureLegacyRecoveryPreAdmission(parent, binding, source, request, inspect) };
}

describe("legacy pre-admission capture", () => {
  it("corroborates one old process/session/active role and emits only typed operational references", async () => {
    const fixture = legacyFixture();
    const result = await fixture.capture();
    expect(result.snapshot).toMatchObject({ kind: "legacy-pre-admission", nonceProvenance: "absent_process_environment",
      parent: { nonceSha256: "0".repeat(64) }, sessionId: "ses_exact", binding, sourceHead: head,
      operational: { role: "ingenium-orchestrator", status: "working", taskHash: hash("task"),
        todos: stableRestartTodos(fixture.todos).map((todo) => ({ idSha256: hash(todo.id), status: todo.status })) } });
    const serialized = JSON.stringify(result);
    for (const forbidden of ["private transcript", "private reasoning", "private tool arguments", "legacy stable todo", "p".repeat(43), "state.input"])
      expect(serialized).not.toContain(forbidden);
    expect(fixture.inspect).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(root, "opencode.json"), "utf8")).not.toContain("current-parent");
  });
  it.each(["zero sessions", "multiple sessions", "foreign session", "foreign process", "generated nonce", "multiple ports", "role", "dirty source", "extra binding fields"])("fails closed on %s", async (failure) => {
    const f = legacyFixture();
    if (failure === "zero sessions") f.payloads["/session"] = [];
    if (failure === "multiple sessions") {
      f.payloads["/session"].push({ id: "ses_other", directory: root });
      f.payloads["/session/status"].ses_other = { type: "busy" };
    }
    if (failure === "foreign session") f.parent.sessionId = "ses_foreign";
    if (failure === "foreign process") f.inspect.mockImplementation(() => ({ ...f.parent, commandName: "opencode", pid: 101, ports: [4098], nonce: undefined }));
    if (failure === "generated nonce") f.parent.nonceSha256 = hash("in-memory nonce");
    if (failure === "multiple ports") f.inspect.mockImplementation(() => ({ ...f.parent, commandName: "opencode", ports: [4098, 4099], nonce: undefined }));
    if (failure === "role") f.payloads["/session/ses_exact/message"][0].info.agent = "foreign";
    if (failure === "dirty source") f.source.dirtyPaths.push("changed.ts");
    if (failure === "extra binding fields") binding.credentials = "private";
    expect(await f.capture()).toBeNull();
  });
});

describe("immutable schema-v2 outbox disposition", () => {
  it("honors only exact persisted authorization/record evidence and never changes original bytes", () => {
    const index = join(root, ".opencode/protected-runtime-index");
    for (const directory of [index, ...["coordination-outbox", "coordination-outbox-dispositions", "coordination-outbox-authorizations"].map((name) => join(index, name))])
      mkdirSync(directory, { mode: 0o700 });
    const key = COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY;
    const record = { version: 1, key, operationId: hash("operation"), kind: "overflow", sessionHash: "0".repeat(64),
      createdAt: "2026-09-11T00:00:00Z", failure: "unavailable", revision: null, cursor: null, digest: hash("digest"),
      ambiguous: true, count: 4, mutation: null };
    const recordPath = join(index, "coordination-outbox", `${key}.json`);
    json(recordPath, record);
    const original = readFileSync(recordPath);
    const authorization = { schemaVersion: 1, authorizationId: COORDINATION_OUTBOX_OVERFLOW_AUTHORITY_SHA256, recordKey: key,
      mode: "abandon_identityless_overflow", authority: "explicit_user_authorization", scope: "exact_key_same_record_family",
      reason: "nonrecoverable_identityless_overflow", issuedAt: "2026-09-11T00:00:00Z", expiresAt: "2026-09-11T01:00:00Z" };
    const authPath = join(index, "coordination-outbox-authorizations", `${key}.json`);
    json(authPath, authorization);
    const disposition = { schemaVersion: 2, recordKey: key, recordSha256: hash(original), recordCount: 4,
      operationId: record.operationId, authorizationSha256: hash(readFileSync(authPath)), decision: "abandoned",
      authority: authorization.authority, reason: authorization.reason, createdAt: "2026-09-11T00:30:00Z" };
    const dispositionPath = join(index, "coordination-outbox-dispositions", `${key}.${hash(original)}.json`);
    json(dispositionPath, disposition);
    const summary = () => shim.summarizeCoordinationOutboxState(index).outbox.ambiguousCount;
    expect(summary()).toBe(0);
    expect(readFileSync(recordPath)).toEqual(original);
    for (const change of [{ recordCount: 5 }, { operationId: hash("other") }, { authorizationSha256: hash("other") },
      { createdAt: "2026-09-11T02:00:00Z" }]) {
      json(dispositionPath, { ...disposition, ...change });
      expect(summary()).toBe(1);
    }
    json(dispositionPath, disposition);
    json(recordPath, { ...record, count: 5 });
    expect(summary()).toBe(1);
    writeFileSync(recordPath, original);
    json(authPath, { ...authorization, scope: "foreign" });
    expect(summary()).toBe(1);
    rmSync(authPath);
    expect(summary()).toBe(1);
    expect(readFileSync(recordPath)).toEqual(original);
  });
});

describe("independent recovery owner contract", () => {
  it("requires an exact job, process, lease, fence, binding and source; preparation is not authorization", () => {
    const contract = shim.prepareRecoveryOwnerContract(binding, head);
    const run = vi.fn();
    expect(contract).toMatchObject({ authorizesRestart: false, nonceTarget: "successor_or_supervisor_only" });
    expect(shim.inspectRecoveryOwnerStatus(contract, { run }).status).toBe("unavailable");
    expect(run).not.toHaveBeenCalled();
    const directory = join(root, ".opencode/protected-runtime-index/tui-recovery");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const script = join(root, "packages/ingenium-extension/dist/scripts/recovery-owner.js");
    mkdirSync(join(root, "packages/ingenium-extension/dist/scripts"), { recursive: true });
    writeFileSync(script, "fixture", { mode: 0o555 });
    const owner = { pid: 101, startTimeTicks: 42, executableSha256: hash("exe"), nonceSha256: hash("n".repeat(43)) };
    const status = { schemaVersion: 1, job: contract.job, invocationId: "a".repeat(32), binding, sourceHead: head,
      scriptSha256: hash("fixture"), owner, fence: 3, lease: { issuedAt: 1000, expiresAt: 2000 }, health: "ready" };
    json(join(directory, "state.json"), { schemaVersion: 1, owner, fence: 3, generation: 1, phase: "owner_ready",
      activeParent: null, replacement: null, updatedAt: "2026-09-11T00:00:00Z" });
    const path = join(directory, "owner-status.json");
    json(path, status);
    run.mockReturnValue(`MainPID=101\nInvocationID=${status.invocationId}\nActiveState=active\nSubState=running\n`);
    const options = { now: 1500, run, inspect: () => ({ ...owner, cwd: root, commandName: "node", argv: ["node", script, "payload"] }),
      environment: () => ({ INGENIUM_RECOVERY_OWNER_NONCE: "n".repeat(43), INGENIUM_RECOVERY_OWNER_SOURCE_HEAD: head,
        INGENIUM_RECOVERY_OWNER_SCRIPT_SHA256: status.scriptSha256 }) };
    expect(shim.inspectRecoveryOwnerStatus(contract, options)).toMatchObject({ status: "attested", fence: 3, authorizesRestart: false });
    for (const change of [{ fence: 4 }, { binding: { ...binding, project: "foreign" } }, { sourceHead: "b".repeat(40) },
      { lease: { issuedAt: 1, expiresAt: 1000 } }, { health: "unhealthy" }, { job: "docker.service" },
      { owner: { ...owner, nonceSha256: "0".repeat(64) } }]) {
      json(path, { ...status, ...change });
      expect(shim.inspectRecoveryOwnerStatus(contract, options).status).toBe("unavailable");
    }
    json(path, status);
    run.mockReturnValue("MainPID=999\nActiveState=active\nSubState=running");
    expect(shim.inspectRecoveryOwnerStatus(contract, options).status).toBe("unavailable");
  });
});
