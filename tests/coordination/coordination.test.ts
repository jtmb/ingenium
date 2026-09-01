import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { createTestRunContext, readTestRunManifest, readTestRunTelemetry, recordTestRunTelemetryFailure, updateTestRunManifest, type TestRunProcess } from "../test-run-context";
import { inspectProcessIdentity, terminateChildProcessHandle } from "../test-server-lifecycle";
import {
  COORDINATION_MEMORY_PREFIX,
  HARNESS_MANIFEST_SCHEMA,
  EvidenceStore,
  assertNoSecrets,
  assertOperationalMemoryEntry,
  assertOwnershipManifest,
  managedCommandPayload,
  parseCoordinationMemoryBlock,
  parseHarnessOptions,
  readProtectedValue,
  redactEvidence,
  sha256,
  validateProtectedLocator,
  type HarnessOwnershipManifest,
  type OperationalMemoryEntry,
} from "./contracts";
import { CoordinationFaultProxy, faultDisposition } from "./fault-proxy";
import { allowlistedBaseEnvironment, prepareExternalHome, runCanaryAction, startHostOpenCode, stopHostOpenCode, waitForOpenCode } from "./process-lifecycle";
import { CanaryDispatcher, RealCanaryActions, type CanaryPlan, type CanaryRequest } from "./canary-dispatcher";
import { ExecutionLifecycle } from "./execution-lifecycle";
import {
  CROSS_READ_PROMPT,
  buildExternalConfig,
  crossReadPromptContainsExpected,
  establishHarnessAccess,
  finalizeCoordinationTestRun,
  finishCoordinationCleanup,
  parseCrossReadResponse,
} from "./harness";

const roots: string[] = [];
const servers: Server[] = [];

test.afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (!server.listening) return;
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function protectedFile(root: string, name: string, value: string): string {
  const path = join(root, name);
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

test("finalizes resolved telemetry before deleting the run manifest", async () => {
  const context = createTestRunContext({
    repoRoot: process.cwd(),
    tempRoot: tempRoot("ingenium-coordination-run-"),
    ports: { api: 45181, dashboard: 45182, fixture: 45183 },
  });
  roots.push(join(process.cwd(), "tests", "artifacts", "test-runs", context.runId));

  await finalizeCoordinationTestRun(context);

  assert.equal(existsSync(context.manifestPath), false);
  assert.equal(readTestRunTelemetry(context.telemetryPath!).resolution?.status, "resolved");
});

test("refuses recovery while a recorded sentinel process and port remain active", async () => {
  const ports = { api: await unusedPort(), dashboard: await unusedPort(), fixture: await unusedPort() };
  const context = createTestRunContext({
    repoRoot: process.cwd(),
    tempRoot: tempRoot("ingenium-coordination-active-run-"),
    ports,
  });
  roots.push(join(process.cwd(), "tests", "artifacts", "test-runs", context.runId));
  const { child, record } = await startSentinelProcess(ports.dashboard, context.runNonce);
  updateTestRunManifest(context.manifestPath, { status: "running", processes: [record] });

  try {
    await assert.rejects(finalizeCoordinationTestRun(context), /still active/);
    assert.deepEqual(readTestRunManifest(context.manifestPath).processes, [record]);
    assert.deepEqual(readTestRunTelemetry(context.telemetryPath!).activeProcesses, [record]);
  } finally {
    await terminateChildProcessHandle(child, 5_000, context.runNonce);
  }
  await finalizeCoordinationTestRun(context);
});

test("telemetry-only live sentinel blocks recovery and remains recorded", async () => {
  const ports = { api: await unusedPort(), dashboard: await unusedPort(), fixture: await unusedPort() };
  const context = createTestRunContext({
    repoRoot: process.cwd(),
    tempRoot: tempRoot("ingenium-coordination-telemetry-active-"),
    ports,
  });
  roots.push(join(process.cwd(), "tests", "artifacts", "test-runs", context.runId));
  const { child, record } = await startSentinelProcess(ports.dashboard, context.runNonce);
  recordTestRunTelemetryFailure(context.manifestPath, "telemetry-only sentinel", record);
  assert.deepEqual(readTestRunManifest(context.manifestPath).processes, []);

  try {
    await assert.rejects(finalizeCoordinationTestRun(context), /still active/);
    assert.deepEqual(readTestRunManifest(context.manifestPath).processes, []);
    const telemetry = readTestRunTelemetry(context.telemetryPath!);
    assert.deepEqual(telemetry.activeProcesses, [record]);
    assert.equal(telemetry.processes.find((entry) => entry.record.pid === record.pid)?.state, "retained");
  } finally {
    await terminateChildProcessHandle(child, 5_000, context.runNonce);
  }
  await finalizeCoordinationTestRun(context);
});

test("resolved telemetry-only process union permits cleanup", async () => {
  const ports = { api: await unusedPort(), dashboard: await unusedPort(), fixture: await unusedPort() };
  const context = createTestRunContext({
    repoRoot: process.cwd(),
    tempRoot: tempRoot("ingenium-coordination-telemetry-resolved-"),
    ports,
  });
  roots.push(join(process.cwd(), "tests", "artifacts", "test-runs", context.runId));
  const { child, record } = await startSentinelProcess(ports.dashboard, context.runNonce);
  await terminateChildProcessHandle(child, 5_000, context.runNonce);
  recordTestRunTelemetryFailure(context.manifestPath, "resolved telemetry-only sentinel", record);

  await finalizeCoordinationTestRun(context);

  assert.equal(existsSync(context.manifestPath), false);
  const telemetry = readTestRunTelemetry(context.telemetryPath!);
  assert.equal(telemetry.resolution?.status, "resolved");
  assert.equal(telemetry.processes.find((entry) => entry.record.pid === record.pid)?.state, "cleared");
});

test("retains the primary error when cleanup also fails", async () => {
  const primary = new Error("primary run failure");
  const cleanup = new Error("cleanup proof failure");
  const retention = new Error("cleanup retention failure");

  await assert.rejects(async () => {
    try {
      throw primary;
    } catch (error) {
      await finishCoordinationCleanup(error, true, async () => { throw cleanup; }, () => { throw retention; });
      throw error;
    }
  }, (error) => error === primary && (error as Error).message === "primary run failure");

  assert.equal((primary as Error & { cleanupError?: unknown }).cleanupError, cleanup);
  assert.equal((primary as Error & { cleanupRetentionError?: unknown }).cleanupRetentionError, retention);
  await assert.rejects(
    finishCoordinationCleanup(undefined, false, async () => { throw cleanup; }, () => { throw retention; }),
    (error) => error instanceof AggregateError && error.errors.includes(cleanup) && error.errors.includes(retention),
  );
});

function fixtureRepository(): {
  root: string;
  coordination: string;
  repository: string;
  operator: string;
  auth: string;
  openCode: string;
} {
  const root = tempRoot("ingenium-coordination-contract-");
  const credentials = join(root, ".credentials");
  mkdirSync(credentials, { mode: 0o700 });
  const coordination = protectedFile(credentials, ".ingenium-mcp-credential", "c".repeat(32));
  const repository = protectedFile(credentials, ".ingenium-repository-sync-credential", "r".repeat(32));
  const operator = protectedFile(credentials, "operator", "operator-secret");
  const auth = protectedFile(credentials, "auth", JSON.stringify({ openai: { type: "api", key: "provider-secret" } }));
  const openCode = join(root, "opencode-fixture.mjs");
  writeFileSync(openCode, `#!/usr/bin/env node
import { createServer } from "node:http";
if (process.argv[2] === "--version") {
  process.stdout.write("1.18.25\\n");
} else {
  const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
  createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ healthy: true, version: "1.18.25" }));
  }).listen(port, "127.0.0.1");
}
`, { mode: 0o700 });
  chmodSync(openCode, 0o700);
  writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { "@opencode-ai/plugin": "1.18.9" } }));
  writeFileSync(join(root, "opencode.json"), JSON.stringify({
    agent: { "ingenium-software-engineer-premium": { model: "openai/gpt-5.6-sol", variant: "high" } },
    mcp: {
      ingenium: {
        type: "local",
        enabled: true,
        command: ["node", "extension.js"],
        environment: {
          INGENIUM_API_URL: "http://127.0.0.1:4097/api/v1",
          INGENIUM_PROJECT: "project-one",
          INGENIUM_WORKSPACE_ID: "workspace-one",
          INGENIUM_MCP_CREDENTIAL_FILE: coordination,
          INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE: repository,
        },
      },
    },
  }));
  return { root, coordination, repository, operator, auth, openCode };
}

function validArguments(fixture: ReturnType<typeof fixtureRepository>): string[] {
  return [
    "--worktree", fixture.root,
    "--project", "project-one",
    "--project-id", "11111111-1111-4111-8111-111111111111",
    "--workspace", "workspace-one",
    "--storage-mapping-hash", "b".repeat(64),
    "--runtime-id", "22222222-2222-4222-8222-222222222222",
    "--expected-revision", "a".repeat(40),
    "--coordination-credential-file", fixture.coordination,
    "--repository-credential-file", fixture.repository,
    "--operator-token-file", fixture.operator,
    "--opencode-auth-file", fixture.auth,
    "--opencode-binary", fixture.openCode,
  ];
}

function memoryEntry(path = "tests/coordination/evidence.txt"): OperationalMemoryEntry {
  const pathSegments = path.split("/").map((segment) => Buffer.from(segment).toString("base64url"));
  return {
    entryId: "11111111-1111-4111-8111-111111111111",
    actorId: `actor-${"a".repeat(64)}`,
    sourceRevision: 1,
    publishedAt: "2026-08-31T00:00:00.000Z",
    status: "completed",
    actionKinds: ["write"],
    checkResults: [{ kind: "typecheck", result: "passed" }],
    todoState: "complete",
    todoCounts: { total: 1, pending: 0, inProgress: 0, completed: 1, cancelled: 0 },
    currentTaskId: null,
    contextRevision: 1,
    nextWork: { kind: "none", referenceHash: null },
    changedPathSegments: [pathSegments],
  };
}

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return address.port;
}

async function unusedPort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  probe.close();
  await once(probe, "close");
  return port;
}

async function startSentinelProcess(port: number, runNonce: string): Promise<{ child: ChildProcess; record: TestRunProcess }> {
  const child = spawn(process.execPath, ["-e", `require("node:http").createServer((_q,s)=>s.end("ok")).listen(${port},"127.0.0.1");setInterval(()=>{},1000)`], {
    detached: process.platform !== "win32",
    stdio: "ignore",
    env: { PATH: process.env.PATH ?? "", INGENIUM_TEST_RUN_NONCE: runNonce },
  });
  assert(child.pid);
  let identity: ReturnType<typeof inspectProcessIdentity>;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    identity = inspectProcessIdentity(child.pid);
    if (identity?.runNonce === runNonce) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(identity?.runNonce === runNonce);
  return {
    child,
    record: {
      name: "dashboard",
      pid: child.pid,
      port,
      startedAt: new Date().toISOString(),
      runNonce,
      pidStartTime: identity.pidStartTime,
      pgid: identity.pgid,
      executable: identity.executable,
      groupIdentity: identity.groupIdentity,
      identityState: "bound",
    },
  };
}

test("parses exact CLI/config bindings without accepting secret values", () => {
  const fixture = fixtureRepository();
  const parsed = parseHarnessOptions(validArguments(fixture), {});
  assert.deepEqual({
    worktree: parsed.worktree,
    project: parsed.project,
    workspaceId: parsed.workspaceId,
    apiUrl: parsed.apiUrl,
    projectId: parsed.projectId,
    providerId: parsed.providerId,
    modelId: parsed.modelId,
    variant: parsed.variant,
    expectedOpenCodeVersion: parsed.expectedOpenCodeVersion,
  }, {
    worktree: fixture.root,
    project: "project-one",
    workspaceId: "workspace-one",
    apiUrl: "http://127.0.0.1:4097/api/v1",
    projectId: "11111111-1111-4111-8111-111111111111",
    providerId: "openai",
    modelId: "gpt-5.6-sol",
    variant: "high",
    expectedOpenCodeVersion: "1.18.25",
  });
  assert.equal(parsed.coordinationCredential.path, fixture.coordination);
  assert.equal(parsed.repositoryCredential.path, fixture.repository);
  assert.throws(() => parseHarnessOptions([...validArguments(fixture), "--unknown", "value"], {}), /Unsupported/);
  assert.throws(() => parseHarnessOptions([...validArguments(fixture), "--project", "project-one"], {}), /repeated/);
  const unsafeBinary = validArguments(fixture);
  unsafeBinary[unsafeBinary.indexOf("--opencode-binary") + 1] = "../unsafe";
  assert.throws(() => parseHarnessOptions(unsafeBinary, {}), /openCodeBinary/);
  assert.throws(() => parseHarnessOptions([...validArguments(fixture), "--runtime-revision", "7"], {}), /Unsupported/);
  const withoutRuntime = validArguments(fixture);
  withoutRuntime.splice(withoutRuntime.indexOf("--runtime-id"), 2);
  assert.throws(() => parseHarnessOptions(withoutRuntime, {}), /runtimeId is required/);
  const malformedRuntime = validArguments(fixture);
  malformedRuntime[malformedRuntime.indexOf("--runtime-id") + 1] = "not-a-runtime-uuid";
  assert.throws(() => parseHarnessOptions(malformedRuntime, {}), /runtimeId must be a UUID/);
  chmodSync(fixture.operator, 0o644);
  assert.throws(() => parseHarnessOptions(validArguments(fixture), {}), /owner-only/);
});

test("uses the launched OpenCode binary version for readiness", async () => {
  const fixture = fixtureRepository();
  const options = parseHarnessOptions(validArguments(fixture), {});
  const health = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ healthy: true, version: "1.18.25" }));
  });
  servers.push(health);
  const port = await listen(health);

  await waitForOpenCode(`http://127.0.0.1:${port}`, options.expectedOpenCodeVersion, new AbortController().signal, 1_000);

  assert.equal(options.expectedOpenCodeVersion, "1.18.25");
});

test("keeps the canonical OpenCode spawn target after PATH changes", async () => {
  const fixture = fixtureRepository();
  const args = validArguments(fixture);
  args[args.indexOf("--opencode-binary") + 1] = basename(fixture.openCode);
  const nodeDirectory = dirname(process.execPath);
  const options = parseHarnessOptions(args, { PATH: `${dirname(fixture.openCode)}:${nodeDirectory}` });
  assert.equal(options.openCodeBinary, realpathSync(fixture.openCode));

  const decoyDirectory = tempRoot("ingenium-coordination-decoy-");
  const decoy = join(decoyDirectory, basename(fixture.openCode));
  writeFileSync(decoy, "#!/usr/bin/env node\nprocess.exit(91);\n", { mode: 0o700 });
  chmodSync(decoy, 0o700);
  const port = await unusedPort();
  const prepared = prepareExternalHome(fixture.root, "external-b", options, "{}\n");
  const previousPath = process.env.PATH;
  process.env.PATH = `${decoyDirectory}:${nodeDirectory}`;
  const runNonce = "77777777-7777-4777-8777-777777777777";
  const processRecord = await startHostOpenCode(
    "external-b",
    port,
    prepared,
    options,
    "http://127.0.0.1:4097/api/v1",
    "{}\n",
    { projectId: options.projectId, storageMappingHash: options.storageMappingHash },
    "{}",
    runNonce,
    new AbortController().signal,
  );
  try {
    await waitForOpenCode(`http://127.0.0.1:${port}`, options.expectedOpenCodeVersion, new AbortController().signal, 2_000);
    assert.equal(processRecord.child.spawnfile, realpathSync(fixture.openCode));
    assert.equal(processRecord.child.exitCode, null);
  } finally {
    await stopHostOpenCode(processRecord, runNonce);
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});

test("rejects malformed or missing OpenCode targets before protected reads", () => {
  const fixture = fixtureRepository();
  let protectedReads = 0;
  const parseThenRead = (binary: string, path: string): void => {
    const args = validArguments(fixture);
    args[args.indexOf("--opencode-binary") + 1] = binary;
    const options = parseHarnessOptions(args, { PATH: path });
    readProtectedValue(options.coordinationCredential, () => { protectedReads += 1; });
  };

  assert.throws(() => parseThenRead("../opencode", dirname(process.execPath)), /absolute or a bare executable name/);
  assert.throws(() => parseThenRead(join(fixture.root, "missing-opencode"), dirname(process.execPath)), /does not exist/);
  assert.throws(() => parseThenRead(basename(fixture.openCode), `relative:${dirname(process.execPath)}`), /unsafe executable search entry/);
  assert.equal(protectedReads, 0);
});

test("redacts nested credentials and rejects retained secret patterns", () => {
  const secret = "configured-private-value";
  const redacted = redactEvidence({
    authorization: `Bearer ${secret}`,
    nested: [{ value: secret }, { tokenFile: "/private/path" }, "ing_forbidden-value"],
  }, [secret]);
  assert.deepEqual(redacted, {
    authorization: "<redacted>",
    nested: [{ value: "<redacted>" }, { tokenFile: "<redacted>" }, "<redacted>"],
  });
  assert.deepEqual(redactEvidence({ tokenBytesRetained: false }), { tokenBytesRetained: false });
  assert.doesNotThrow(() => assertNoSecrets(redacted, [secret]));
  assert.throws(() => assertNoSecrets({ value: `Bearer ${secret}` }, [secret]), /secret/);
});

test("attests one exact runtime preflight before opening control credentials and fails closed on identity drift", async () => {
  const fixture = fixtureRepository();
  const runtimeId = "22222222-2222-4222-8222-222222222222";
  const accessOrder: string[] = [];
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${"c".repeat(32)}`);
    accessOrder.push(`query:${url.pathname}${url.search}`);
    assert.equal(url.toString(), `http://127.0.0.1:4097/api/v1/auth/preflight?runtime_id=${runtimeId}`);
    return Response.json({ data: {
      authenticated: true,
      scopes: ["projects:read", "coordination:read"],
      organizationId: "organization-id",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectIds: ["11111111-1111-4111-8111-111111111111"],
      audience: "mcp",
      workspaceId: "workspace-one",
      launcherWorktree: fixture.root,
      storageMappingHash: "b".repeat(64),
      restartRequiredOnCredentialChange: true,
      credentialChangeMode: "live-mcp-reload",
      runtime: { id: runtimeId, imageRevision: "a".repeat(40), state: "READY" },
    } });
  };
  const options = parseHarnessOptions(validArguments(fixture), {});
  const configuredCredential = join(fixture.root, ".opencode", ".ingenium-mcp-credential");
  mkdirSync(join(fixture.root, ".opencode"));
  writeFileSync(configuredCredential, `${"x".repeat(32)}\n`, { mode: 0o660 });
  chmodSync(configuredCredential, 0o660);
  const configPath = join(fixture.root, "opencode.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    mcp: { ingenium: { environment: Record<string, string> } };
  };
  config.mcp.ingenium.environment.INGENIUM_MCP_CREDENTIAL_FILE = ".opencode/.ingenium-mcp-credential";
  writeFileSync(configPath, JSON.stringify(config));
  const signal = new AbortController().signal;
  const access = await establishHarnessAccess(options, signal, {
    read(name) {
      accessOrder.push(`open:${name}`);
      return `${name}-value`;
    },
    request: request as typeof fetch,
  });
  assert.equal(access.runtime.id, runtimeId);
  assert.deepEqual(accessOrder, [
    "open:coordination-api",
    `query:/api/v1/auth/preflight?runtime_id=${runtimeId}`,
    "open:operator-api",
    "open:repository-sync",
    "open:opencode-auth",
  ]);
  assert.equal(accessOrder.some((entry) => entry.includes("/runtimes")), false);
  const failureReads: string[] = [];
  const queryOffset = accessOrder.length;
  await assert.rejects(establishHarnessAccess({
    ...options,
    projectId: "77777777-7777-4777-8777-777777777777",
  }, signal, {
    read(name) {
      failureReads.push(name);
      return `${name}-value`;
    },
    request: request as typeof fetch,
  }), /project\/workspace\/storage/);
  assert.deepEqual(failureReads, ["coordination-api"]);
  assert.deepEqual(accessOrder.slice(queryOffset), [`query:/api/v1/auth/preflight?runtime_id=${runtimeId}`]);
  const revisionFailureReads: string[] = [];
  const revisionQueryOffset = accessOrder.length;
  await assert.rejects(establishHarnessAccess({
    ...options,
    expectedRevision: "c".repeat(40),
  }, signal, {
    read(name) {
      revisionFailureReads.push(name);
      return `${name}-value`;
    },
    request: request as typeof fetch,
  }), /runtime UUID or image revision/);
  assert.deepEqual(revisionFailureReads, ["coordination-api"]);
  assert.deepEqual(accessOrder.slice(revisionQueryOffset), [`query:/api/v1/auth/preflight?runtime_id=${runtimeId}`]);
  assert.equal(accessOrder.some((entry) => entry.includes("/runtimes")), false);
});

test("validates typed operational memory and rejects duplicates or malformed paths", () => {
  const entry = memoryEntry();
  assert.doesNotThrow(() => assertOperationalMemoryEntry(entry));
  const block = `${COORDINATION_MEMORY_PREFIX}trusted operational state\n${JSON.stringify({
    schemaVersion: 2,
    pathEncoding: "base64url-utf8-segments",
    memoryEntries: [entry],
  })}`;
  const capture = { schemaVersion: 1, memory: block, activity: null };
  assert.deepEqual(parseCoordinationMemoryBlock(capture.memory), [entry]);
  assert.throws(() => parseCoordinationMemoryBlock(block.replace("memoryEntries\":[", "memoryEntries\":[" + JSON.stringify(entry) + ",")), /duplicate/);
  const malformedPath = memoryEntry();
  malformedPath.changedPathSegments[0] = ["Li4"];
  assert.throws(() => assertOperationalMemoryEntry(malformedPath), /path/);
  assert.throws(() => assertOperationalMemoryEntry({ ...memoryEntry(), unexpected: true }), /shape/);
  assert.throws(() => parseCoordinationMemoryBlock(block.replace('"schemaVersion":2', '"schemaVersion":2,"unexpected":true')), /payload/);
});

test("cross-read input omits peer values while the exact reduced model response reports them", () => {
  const entry = {
    ...memoryEntry("tests/coordination/private-cross-read-nonce.txt"),
    entryId: "98765432-1234-4234-9234-123456789abc",
    actorId: `actor-${"c".repeat(64)}`,
    sourceRevision: 29,
    contextRevision: 41,
  } satisfies OperationalMemoryEntry;
  assert.equal(crossReadPromptContainsExpected(entry), false);
  assert.equal(CROSS_READ_PROMPT.includes(entry.entryId), false);
  assert.equal(CROSS_READ_PROMPT.includes(entry.actorId), false);
  assert.equal(entry.changedPathSegments.flat().some((value) => CROSS_READ_PROMPT.includes(value)), false);
  assert.deepEqual(parseCrossReadResponse(JSON.stringify(entry)), entry);
  assert.throws(() => parseCrossReadResponse(JSON.stringify({ ...entry, actionKinds: ["bash"] })), /actions/);
});

test("writes only redacted, owner-only evidence inside the run artifact boundary", () => {
  const fixture = fixtureRepository();
  const artifact = join(fixture.root, "tests", "artifacts", "test-runs", "11111111-1111-4111-8111-111111111111");
  const store = new EvidenceStore(fixture.root, artifact, ["configured-private-value"]);
  store.write("result.json", { token: "configured-private-value", value: "safe" });
  const path = join(artifact, "result.json");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).token, "<redacted>");
  assert.throws(() => new EvidenceStore(fixture.root, join(fixture.root, "outside"), []), /escaped/);
});

test("validates ownership manifests and managed argv encoding", () => {
  const fixture = fixtureRepository();
  const artifactRoot = join(fixture.root, "tests", "artifacts", "test-runs", "11111111-1111-4111-8111-111111111111");
  const manifest: HarnessOwnershipManifest = {
    schema: HARNESS_MANIFEST_SCHEMA,
    runId: "11111111-1111-4111-8111-111111111111",
    runNonce: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-08-31T00:00:00.000Z",
    repoRoot: fixture.root,
    artifactRoot,
    tempRoot: join(tmpdir(), "ingenium-owned-run"),
    revision: "a".repeat(40),
    project: "project-one",
    workspaceId: "workspace-one",
    ports: { proxy: 45001, externalA: 45002, externalB: 45003, internalC: 4098 },
    processes: [{
      role: "internal-c",
      pid: null,
      externalId: "44444444-4444-4444-8444-444444444444",
      port: null,
      startedAt: "2026-08-31T00:00:00.000Z",
      stoppedAt: null,
      commandSha256: "b".repeat(64),
    }],
    boundaries: { liveRun: true, applicationSourceMutation: false, tokenBytesRetained: false, runtimeCreated: false },
  };
  assert.doesNotThrow(() => assertOwnershipManifest(manifest));
  assert.throws(() => assertOwnershipManifest({ ...manifest, artifactRoot: join(tmpdir(), "escape") }), /paths/);
  const argv = ["git", "commit", "-m", "bounded message", "--", "tests/coordination/evidence.txt"];
  assert.deepEqual(JSON.parse(Buffer.from(managedCommandPayload(argv), "base64url").toString("utf8")), argv);
});

test("selectively faults coordination registration and delivered responses while forwarding resource sync", async () => {
  const upstreamRequests: Array<{ method: string; path: string; body: string }> = [];
  const upstream = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    upstreamRequests.push({ method: request.method ?? "GET", path: request.url ?? "/", body });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: { accepted: true } }));
  });
  servers.push(upstream);
  const upstreamPort = await listen(upstream);
  const proxy = new CoordinationFaultProxy({ upstream: `http://127.0.0.1:${upstreamPort}/api/v1`, port: await unusedPort() });
  const controller = new AbortController();
  await proxy.start(controller.signal);
  try {
    proxy.setPhase("fail_registration");
    const registration = await fetch(`${proxy.url}/api/v1/coordination/register`, { method: "POST", body: "{}" });
    assert.equal(registration.status, 503);
    assert.equal(upstreamRequests.length, 0);
    const sync = await fetch(`${proxy.url}/api/v1/repository/sync`, { method: "POST", body: "fixture-sync" });
    assert.equal(sync.status, 200);
    assert.equal(upstreamRequests.at(-1)?.path, "/api/v1/repository/sync");

    proxy.setPhase("lose_completion_response");
    await assert.rejects(fetch(`${proxy.url}/api/v1/coordination/claims/complete`, { method: "POST", body: "stable-completion" }));
    proxy.setPhase("pass");
    const replay = await fetch(`${proxy.url}/api/v1/coordination/claims/complete`, { method: "POST", body: "stable-completion" });
    assert.equal(replay.status, 200);
    const events = proxy.snapshot();
    assert.deepEqual(events.map((event) => event.disposition), ["blocked", "forwarded", "response_lost", "forwarded"]);
    assert.equal(events[1]?.requestSha256, sha256("fixture-sync"));
    assert.equal(events[2]?.upstreamStatus, 200);
    assert.equal(events[2]?.requestSha256, events[3]?.requestSha256);
    assert.equal(events[2]?.upstreamResponseSha256, events[3]?.upstreamResponseSha256);
    assert.equal(events.some((event) => event.pathname.endsWith("/coordination/claims/quarantine")), false);
    assert.equal(faultDisposition("pass", "POST", "/api/v1/coordination/register"), "forwarded");
  } finally {
    await proxy.close();
  }
});

test("uses an allowlisted child environment and safely stops an owned detached process", async () => {
  assert.deepEqual(allowlistedBaseEnvironment({ PATH: "/bin", LANG: "C", INGENIUM_API_TOKEN: "forbidden", RANDOM_VALUE: "no" }), {
    LANG: "C",
    PATH: "/bin",
  });
  const nonce = "33333333-3333-4333-8333-333333333333";
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
    env: { PATH: process.env.PATH ?? "", INGENIUM_TEST_RUN_NONCE: nonce },
  });
  assert(child.pid);
  await terminateChildProcessHandle(child, 5_000, nonce);
  assert(child.exitCode !== null || child.signalCode !== null);
});

test("prepares isolated homes without copying credential-bearing files", () => {
  const fixture = fixtureRepository();
  const options = parseHarnessOptions(validArguments(fixture), {});
  const root = tempRoot("ingenium-coordination-home-");
  const prepared = prepareExternalHome(root, "external-a", options, "{}\n");
  const files = readdirSync(prepared.home, { recursive: true }).map(String);
  assert.equal(files.some((path) => /credential|repository-secret|coordination-secret/i.test(path)), false);
  assert.equal(readFileSync(prepared.configFile, "utf8"), "{}\n");
  assert.equal(existsSync(prepared.pluginFile), true);
  assert.equal(existsSync(prepared.planFile), true);
  const plugin = readFileSync(prepared.pluginFile, "utf8");
  assert.match(plugin, /runCanaryAction/);
  assert.match(plugin, /CanaryDispatcher/);
  assert.match(plugin, /\[CANARY_TOOL\]: tool/);
  assert.doesNotMatch(plugin, /coordination-secret|repository-secret|provider-secret/);
  assert.equal(statSync(prepared.home).mode & 0o777, 0o700);
  assert.equal(statSync(prepared.pluginFile).mode & 0o777, 0o600);
});

test("generates one fixed default-deny model profile without serializing credential locators", () => {
  const fixture = fixtureRepository();
  const options = parseHarnessOptions(validArguments(fixture), {});
  const serialized = buildExternalConfig(options, "http://127.0.0.1:45000/api/v1", {
    projectId: options.projectId,
    workspaceId: options.workspaceId,
    storageMappingHash: options.storageMappingHash,
  });
  assert.equal(serialized.includes(fixture.coordination), false);
  assert.equal(serialized.includes(fixture.repository), false);
  const config = JSON.parse(serialized);
  assert.deepEqual(Object.keys(config.agent), ["coordination-harness-canary"]);
  assert.deepEqual(config.tools, { "*": false, coordination_canary: true });
  assert.deepEqual(config.permission, { "*": "deny" });
  assert.deepEqual(config.agent["coordination-harness-canary"].tools, { "*": false, coordination_canary: true });
  assert.deepEqual(config.agent["coordination-harness-canary"].permission, { "*": "deny" });
  assert.equal(config.agent["coordination-harness-canary"].maxSteps, 2);
  assert.equal(config.plugin.at(-1), "file://{env:INGENIUM_COORDINATION_CANARY_PLUGIN}");
  assert.equal(config.mcp.ingenium.environment.INGENIUM_MCP_CREDENTIAL_FILE, "{env:INGENIUM_MCP_CREDENTIAL_FILE}");
  assert.equal(config.mcp.ingenium.environment.INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE, "{env:INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE}");
  const transformOnly = JSON.parse(buildExternalConfig(options, "http://127.0.0.1:45000/api/v1", {
    projectId: options.projectId,
    workspaceId: options.workspaceId,
    storageMappingHash: options.storageMappingHash,
  }, "B"));
  assert.deepEqual(transformOnly.tools, { "*": false });
  assert.deepEqual(transformOnly.agent["coordination-harness-canary"].tools, { "*": false });
  assert.equal(transformOnly.plugin?.includes("file://{env:INGENIUM_COORDINATION_CANARY_PLUGIN}") ?? false, false);
});

test("rejects every nonallowlisted canary request before side effects and accepts the exact operation", async () => {
  const fixture = fixtureRepository();
  mkdirSync(join(fixture.root, "tests", "coordination"), { recursive: true });
  const plan: CanaryPlan = {
    version: 1,
    role: "A",
    nonce: "33333333-3333-4333-8333-333333333333",
    worktree: fixture.root,
    project: "project-one",
    check: "typecheck",
    steps: [{ operation: "mutate_only", slot: "a", path: "tests/coordination/canary.txt", marker: "fixed-marker" }],
  };
  let sideEffects = 0;
  const context = { sessionId: "session-a", messageId: "message-a", abort: new AbortController().signal };
  const exact = new CanaryDispatcher(plan, { execute: async () => { sideEffects += 1; return "fixed-marker"; } })
    .requestForCurrentStep(plan.nonce, "mutate_only");
  const attacks: CanaryRequest[] = [
    { ...exact, operation: "observe" },
    { ...exact, path: fixture.coordination },
    { ...exact, path: "tests/coordination/undeclared.txt" },
    { ...exact, command: "rm -rf -- tests/coordination" },
    { ...exact, nonce: "44444444-4444-4444-8444-444444444444" },
    { ...exact, mcpTool: "ingenium_secret_get" },
  ];
  for (const attack of attacks) {
    const dispatcher = new CanaryDispatcher(plan, { execute: async () => { sideEffects += 1; return "unexpected"; } });
    await assert.rejects(dispatcher.dispatch(attack, context), /operation|path|command|nonce|MCP/);
    assert.equal(sideEffects, 0);
  }
  const dispatcher = new CanaryDispatcher(plan, { execute: async () => { sideEffects += 1; return "fixed-marker"; } });
  assert.equal(await dispatcher.dispatch(exact, context), "fixed-marker");
  assert.equal(sideEffects, 1);
});

test("turns an injected local action failure into the managed error path without changing the file", async () => {
  const fixture = fixtureRepository();
  mkdirSync(join(fixture.root, "tests", "coordination"), { recursive: true });
  const path = "tests/coordination/local-failure.txt";
  const plan: CanaryPlan = {
    version: 1,
    role: "A",
    nonce: "33333333-3333-4333-8333-333333333333",
    worktree: fixture.root,
    project: "project-one",
    check: "typecheck",
    steps: [{ operation: "fail_local", slot: "ambiguous", path, marker: "never-written" }],
  };
  const calls: string[] = [];
  const hooks = {
    "tool.execute.before": async () => { calls.push("claim"); },
    event: async ({ event }: { event: { type: string; properties: { part: { state: { status: string } } } } }) => {
      assert.equal(event.type, "message.part.updated");
      assert.equal(event.properties.part.state.status, "error");
      calls.push("quarantine");
    },
    "tool.execute.after": async () => { calls.push("complete"); },
  };
  const actions = new RealCanaryActions(plan, hooks as never);
  await assert.rejects(actions.execute(plan.steps[0]!, {
    sessionId: "session-a",
    messageId: "message-a",
    abort: new AbortController().signal,
  }), /Injected local canary failure/);
  assert.deepEqual(calls, ["claim", "quarantine"]);
  assert.equal(existsSync(join(fixture.root, path)), false);
});

test("rejects a protected credential replacement race after descriptor open", () => {
  const root = tempRoot("ingenium-coordination-race-");
  const path = protectedFile(root, "token", "original-secret");
  const locator = validateProtectedLocator(path);
  const displaced = join(root, "token-opened");
  assert.throws(() => readProtectedValue(locator, () => {
    renameSync(path, displaced);
    protectedFile(root, "token", "replacement-secret");
  }), /identity changed during read/);
});

test("aborting during B restart shares cleanup and prevents respawn, open port, or copied credential", async () => {
  const root = tempRoot("ingenium-coordination-abort-");
  const nonce = "55555555-5555-4555-8555-555555555555";
  const port = await unusedPort();
  const child = spawn(process.execPath, ["-e", `require('node:http').createServer((q,s)=>s.end('ok')).listen(${port},'127.0.0.1');setInterval(()=>{},1000)`], {
    detached: process.platform !== "win32",
    stdio: "ignore",
    env: { PATH: process.env.PATH ?? "", INGENIUM_TEST_RUN_NONCE: nonce },
  });
  assert(child.pid);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const lifecycle = new ExecutionLifecycle();
  lifecycle.start();
  let cleanupCalls = 0;
  const cleanup = () => lifecycle.cleanup(async () => {
    cleanupCalls += 1;
    await terminateChildProcessHandle(child, 5_000, nonce);
  });
  lifecycle.abort(new Error("abort during B restart"));
  const first = cleanup();
  const second = cleanup();
  assert.equal(first, second);
  assert.equal(lifecycle.state, "cleaning");
  await first;
  assert.equal(cleanupCalls, 1);
  assert.equal(lifecycle.state, "cleaned");
  let respawned = false;
  assert.throws(() => {
    lifecycle.assertRunning();
    respawned = true;
  }, /cleaned/);
  assert.equal(respawned, false);
  assert(child.exitCode !== null || child.signalCode !== null);
  await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }));
  assert.equal(readdirSync(root, { recursive: true }).some((entry) => /credential|token/i.test(String(entry))), false);
});

test("aborting a hanging action escalates to KILL, reaps the child, closes its port, and leaves no credential temp", async () => {
  const root = tempRoot("ingenium-coordination-action-abort-");
  const port = await unusedPort();
  const nonce = "66666666-6666-4666-8666-666666666666";
  const plan: CanaryPlan = {
    version: 1,
    role: "B",
    nonce,
    worktree: process.cwd(),
    project: "project-one",
    check: "typecheck",
    steps: [{ operation: "noop", slot: "control", path: null, marker: null }],
  };
  const request = new CanaryDispatcher(plan, { execute: async () => "unused" }).requestForCurrentStep(nonce, "noop");
  const controller = new AbortController();
  let child: ChildProcess | undefined;
  const startedAt = Date.now();
  const running = runCanaryAction(
    plan,
    request,
    { sessionId: "hanging-session", messageId: "hanging-message" },
    {
      PATH: process.env.PATH ?? "",
      HOME: root,
      INGENIUM_TEST_RUN_NONCE: nonce,
      INGENIUM_COORDINATION_HANG_ACTION_TEST: "1",
      INGENIUM_COORDINATION_HANG_ACTION_PORT: String(port),
    },
    controller.signal,
    { terminationTimeoutMs: 400, onSpawn: (spawned) => { child = spawned; } },
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(100) });
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(250) })).status, 200);
  controller.abort(new Error("fixture action abort"));
  await assert.rejects(running, /fixture action abort/);
  assert(Date.now() - startedAt < 3_000);
  assert(child);
  assert.equal(child.signalCode, "SIGKILL");
  assert(child.exitCode !== null || child.signalCode !== null);
  await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }));
  assert.equal(readdirSync(root, { recursive: true }).some((entry) => /credential|token/i.test(String(entry))), false);
});
