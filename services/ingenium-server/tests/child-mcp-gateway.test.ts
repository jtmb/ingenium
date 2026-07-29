import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChildMcpGateway,
  resolveChildMcpProjectIdentity,
  type ChildMcpDiscoveryReport,
  type ChildMcpGatewayApi,
  type ChildMcpRuntimeDefinitionResponse,
  type ChildMcpToolHost,
} from "../lib/child-mcp-gateway.js";
import { CHILD_MCP_REQUEST_TIMEOUT_MS, ChildMcpRuntimeManager } from "../lib/proxy.js";
import { readThreadUploadArtifact } from "../../../scripts/thread-bridge-guard.mjs";

const fixture = new URL("./fixtures/child-mcp-server.mjs", import.meta.url).pathname;
const threadFixture = new URL("./fixtures/threadbridge-mcp-server.mjs", import.meta.url).pathname;
const threadGuardFixture = new URL("./fixtures/threadbridge-guard.mjs", import.meta.url).pathname;
const threadGuardServiceFixture = new URL("./fixtures/threadguard-service.mjs", import.meta.url).pathname;
const repositoryRoot = new URL("../../../", import.meta.url).pathname;
const gateways: ChildMcpGateway[] = [];
const temporaryDirectories: string[] = [];
const guardServices: ChildProcess[] = [];

interface RegisteredTool {
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  remove: ReturnType<typeof vi.fn>;
}

function runtimeDefinition(): ChildMcpRuntimeDefinitionResponse {
  return {
    name: "fixture",
    executable: process.execPath,
    args: [fixture],
    environment: {},
    scope: "project",
    owned: true,
    revision: "2026-07-27T00:00:00.000Z",
  };
}

interface ThreadSandbox {
  exportDirectory: string;
  validPath: string;
  receiptPath: string;
  secretPath: string;
  configPath: string;
  traversalPath: string;
  symlinkPath: string;
  hardlinkPath: string;
  mismatchedReceiptPath: string;
  mismatchedFingerprintPath: string;
  wrongModePath: string;
  nonRegularPath: string;
  dotAliasPath: string;
  controlPath: string;
  auditPath: string;
  guardTempDirectory: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeExportArtifact(
  path: string,
  sourceSessionSha256: string,
  receiptSha256?: string,
  receiptSourceSessionSha256 = sourceSessionSha256,
): string {
  const contents = `${JSON.stringify({
    role: "user",
    content: "fixture context",
    metadata: {
      source: "opencode-export",
      schemaVersion: 1,
      sourceSessionSha256,
      sourceMessageSha256: sha256("fixture-message"),
      sourceMessageIndex: 0,
      visiblePartCount: 1,
    },
  })}\n`;
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
  const receiptPath = `${path}.receipt.json`;
  writeFileSync(receiptPath, JSON.stringify({
    schemaVersion: 1,
    exportFile: path.split("/").at(-1),
    sourceSessionSha256: receiptSourceSessionSha256,
    byteLength: Buffer.byteLength(contents),
    sha256: receiptSha256 ?? sha256(contents),
  }), { mode: 0o600 });
  chmodSync(receiptPath, 0o600);
  return receiptPath;
}

function createThreadSandbox(): ThreadSandbox {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-threadbridge-guard-"));
  temporaryDirectories.push(directory);
  const worktree = join(directory, "workspace", "ingenium");
  const privateDirectory = join(worktree, ".ingenium");
  const exportDirectory = join(privateDirectory, "thread-exports");
  mkdirSync(exportDirectory, { recursive: true, mode: 0o700 });
  chmodSync(privateDirectory, 0o700);
  chmodSync(exportDirectory, 0o700);
  const sourceSessionSha256 = sha256("source-session-123");
  const validPath = join(exportDirectory, "thread-export-00000000-0000-4000-8000-000000000001.jsonl");
  const receiptPath = writeExportArtifact(validPath, sourceSessionSha256);
  const secretDirectory = join(directory, ".opencode");
  mkdirSync(secretDirectory, { mode: 0o700 });
  const secretPath = join(secretDirectory, ".ingenium-api-token");
  const configPath = join(directory, "opencode.json");
  writeFileSync(secretPath, "do-not-read", { mode: 0o600 });
  writeFileSync(configPath, "do-not-read", { mode: 0o600 });
  const symlinkPath = join(exportDirectory, "thread-export-00000000-0000-4000-8000-000000000002.jsonl");
  symlinkSync(secretPath, symlinkPath);
  const hardlinkSource = join(exportDirectory, "thread-export-00000000-0000-4000-8000-000000000003.jsonl");
  writeExportArtifact(hardlinkSource, sourceSessionSha256);
  const hardlinkPath = join(exportDirectory, "thread-export-00000000-0000-4000-8000-000000000004.jsonl");
  linkSync(hardlinkSource, hardlinkPath);
  const mismatchedReceiptPath = join(exportDirectory, "thread-export-00000000-0000-4000-8000-000000000005.jsonl");
  writeExportArtifact(mismatchedReceiptPath, sourceSessionSha256, "0".repeat(64));
  const mismatchedFingerprintPath = join(exportDirectory, "thread-export-00000000-0000-4000-8000-000000000006.jsonl");
  writeExportArtifact(mismatchedFingerprintPath, sourceSessionSha256, undefined, sha256("different-source-session"));
  const wrongModePath = join(exportDirectory, "thread-export-00000000-0000-4000-8000-000000000007.jsonl");
  writeExportArtifact(wrongModePath, sourceSessionSha256);
  chmodSync(wrongModePath, 0o640);
  const nonRegularPath = join(exportDirectory, "thread-export-00000000-0000-4000-8000-000000000008.jsonl");
  mkdirSync(nonRegularPath, { mode: 0o700 });
  const auditPath = join(directory, "upstream-audit.jsonl");
  writeFileSync(auditPath, "", { mode: 0o600 });
  return {
    exportDirectory,
    validPath,
    receiptPath,
    secretPath,
    configPath,
    traversalPath: `${exportDirectory}/../.ingenium-api-token`,
    symlinkPath,
    hardlinkPath,
    mismatchedReceiptPath,
    mismatchedFingerprintPath,
    wrongModePath,
    nonRegularPath,
    dotAliasPath: `${exportDirectory}/./${validPath.split("/").at(-1)}`,
    controlPath: `${validPath}\u0000`,
    auditPath,
    guardTempDirectory: join(directory, "thread-guard-run"),
  };
}

function readAudit(path: string): Array<{ name: string; session: string; filePath?: string; byteLength?: number; sha256?: string }> {
  const contents = readFileSync(path, "utf8").trim();
  return contents ? contents.split("\n").map((line) => JSON.parse(line) as { name: string; session: string; filePath?: string; byteLength?: number; sha256?: string }) : [];
}

function threadRuntimeDefinition(sandbox: ThreadSandbox, guardUrl: string): ChildMcpRuntimeDefinitionResponse {
  return {
    name: "threadbridge",
    executable: process.execPath,
    args: [threadGuardFixture],
    environment: {
      THREAD_BRIDGE_EXPORT_DIRECTORY: sandbox.exportDirectory,
      THREAD_GUARD_URL: guardUrl,
    },
    scope: "project",
    owned: true,
    revision: "2026-07-28T00:00:00.000Z",
  };
}

async function availableLoopbackPort(): Promise<number> {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPort(new Error("Could not allocate test port")));
        return;
      }
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

async function startThreadGuardService(sandbox: ThreadSandbox): Promise<string> {
  const port = await availableLoopbackPort();
  const child = spawn(process.execPath, [threadGuardServiceFixture], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      THREAD_BRIDGE_UPSTREAM_FIXTURE: threadFixture,
      THREAD_BRIDGE_AUDIT_FILE: sandbox.auditPath,
      THREAD_GUARD_TEMP_DIRECTORY: sandbox.guardTempDirectory,
      THREAD_GUARD_PORT: String(port),
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  guardServices.push(child);
  const url = `http://127.0.0.1:${port}`;
  const started = Date.now();
  while (Date.now() - started < 2_000) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return url;
    } catch {
      // The guard may still be spawning its official fixture bridge.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error("Thread guard service did not become healthy");
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveStop) => {
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The guard has already exited.
      }
    }, 2_000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timeout);
      resolveStop();
    }
  });
}

function createHost() {
  const tools = new Map<string, RegisteredTool>();
  const host: ChildMcpToolHost = {
    registerTool(name, _configuration, handler) {
      const remove = vi.fn(() => tools.delete(name));
      tools.set(name, { handler, remove });
      return { remove };
    },
    sendToolListChanged: vi.fn(async () => undefined),
  };
  return { host, tools };
}

function createApi(definitions: ChildMcpRuntimeDefinitionResponse[]) {
  let toolState: "enabled" | "disabled" | "unavailable" = "enabled";
  const reports: ChildMcpDiscoveryReport[] = [];
  const checkedTools: string[] = [];
  const api: ChildMcpGatewayApi = {
    async listRuntimeDefinitions() {
      return { definitions, unavailableCount: 0 };
    },
    async recordDiscovery(_project, _server, report) {
      reports.push(report);
      return true;
    },
    async toolEnabled(_project, toolName) {
      checkedTools.push(toolName);
      return toolState;
    },
  };
  return {
    api,
    reports,
    checkedTools,
    setToolState: (next: typeof toolState) => { toolState = next; },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error("Timed out waiting for gateway reconciliation");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.shutdown()));
  await Promise.all(guardServices.splice(0).map((service) => stopProcess(service)));
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("ChildMcpGateway", () => {
  it("discovers, persists, dynamically registers, forwards, and removes canonical child tools", async () => {
    const definitions = [runtimeDefinition()];
    const { host, tools } = createHost();
    const api = createApi(definitions);
    const manager = new ChildMcpRuntimeManager({ startupMs: 750, requestMs: 250, shutdownMs: 750 });
    const gateway = new ChildMcpGateway(host, "child-gateway-project", api.api, manager);
    gateways.push(gateway);

    await gateway.start();

    // OpenCode prepends the configured `ingenium` server key to this local
    // registration, exposing exactly `ingenium_fixture_echo` to callers.
    const transportName = "fixture_echo";
    expect(tools.has(transportName)).toBe(true);
    expect(api.reports).toHaveLength(1);
    expect(api.reports[0]).toMatchObject({ status: "ready" });
    expect(api.reports[0]!.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "echo" }),
    ]));
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(1);

    const forwarded = await tools.get(transportName)!.handler({
      project: "child-gateway-project",
      arguments: { value: "forwarded" },
    });
    expect(forwarded).toMatchObject({ content: [{ type: "text", text: "forwarded" }] });

    const disabledGenerationHandler = tools.get(transportName)!.handler;
    api.setToolState("disabled");
    const disabled = await tools.get(transportName)!.handler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward" },
    });
    expect(disabled).toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: { code: "TOOL_DISABLED", message: "This child MCP tool is disabled for the project." } }) }],
    });

    await gateway.refresh();
    expect(tools.has(transportName)).toBe(false);

    api.setToolState("enabled");
    await gateway.refresh();
    expect(tools.has(transportName)).toBe(true);
    await expect(tools.get(transportName)!.handler({
      project: "child-gateway-project",
      arguments: { value: "restored" },
    })).resolves.toMatchObject({ content: [{ type: "text", text: "restored" }] });
    await expect(disabledGenerationHandler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward-from-old-generation" },
    })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: { code: "CHILD_MCP_UNAVAILABLE", message: "The child MCP server is unavailable." } }) }],
    });

    const wrongProject = await tools.get(transportName)!.handler({
      project: "other-project",
      arguments: { value: "must-not-forward" },
    });
    expect(wrongProject).toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: { code: "PROJECT_IDENTITY_REQUIRED", message: "A valid explicit project identity is required for this child MCP tool." } }) }],
    });

    const staleHandler = tools.get(transportName)!.handler;
    definitions.splice(0);
    await gateway.refresh();
    expect(tools.has(transportName)).toBe(false);
    await expect(staleHandler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward-after-remove" },
    })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: { code: "CHILD_MCP_UNAVAILABLE", message: "The child MCP server is unavailable." } }) }],
    });
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(4);
  });

  it("fails closed for an unavailable toggle state and rejects invalid session identity", async () => {
    const { host, tools } = createHost();
    const api = createApi([runtimeDefinition()]);
    const manager = new ChildMcpRuntimeManager({ startupMs: 750, requestMs: 250, shutdownMs: 750 });
    const gateway = new ChildMcpGateway(host, "child-gateway-project", api.api, manager);
    gateways.push(gateway);

    api.setToolState("enabled");
    await gateway.refresh();
    expect(tools.has("fixture_echo")).toBe(true);
    api.setToolState("unavailable");
    const unavailable = await tools.get("fixture_echo")!.handler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward" },
    });
    expect(unavailable).toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: { code: "TOOL_STATE_UNAVAILABLE", message: "The child MCP tool state could not be verified." } }) }],
    });
    await gateway.refresh();
    expect(tools.has("fixture_echo")).toBe(false);

    expect(resolveChildMcpProjectIdentity(undefined)).toBeNull();
    expect(resolveChildMcpProjectIdentity("../unsafe")).toBeNull();
    expect(resolveChildMcpProjectIdentity("child-gateway-project")).toBe("child-gateway-project");
  });

  it("reconciles definitions added and removed after the parent transport starts without a restart", async () => {
    const definitions: ChildMcpRuntimeDefinitionResponse[] = [];
    const { host, tools } = createHost();
    const api = createApi(definitions);
    const manager = new ChildMcpRuntimeManager({ startupMs: 750, requestMs: 250, shutdownMs: 750 });
    const gateway = new ChildMcpGateway(host, "child-gateway-project", api.api, manager, 50);
    gateways.push(gateway);

    await gateway.start();
    definitions.push(runtimeDefinition());
    await waitFor(() => tools.has("fixture_echo"));

    definitions.splice(0);
    await waitFor(() => !tools.has("fixture_echo"));
    await waitFor(() => host.sendToolListChanged!.mock.calls.length === 2);
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(2);
  });

  it("keeps Thread's raw backend unreachable from Ingenium and validates the Compose guard topology", () => {
    const validation = spawnSync("sh", [join(repositoryRoot, "scripts", "validate-deployment-config.sh"), repositoryRoot], {
      encoding: "utf8",
    });
    expect(validation.status, validation.stderr).toBe(0);
    const compose = readFileSync(join(repositoryRoot, "docker-compose.yml"), "utf8");
    const launcher = readFileSync(join(repositoryRoot, "scripts", "run-thread-bridge.mjs"), "utf8");
    expect(compose).toContain("- thread-frontend");
    expect(compose).toContain("- thread-backend");
    expect(launcher).toContain("http://thread-guard:8081/v1/call");
    expect(launcher).not.toContain("thread:5000");
  });

  it("reads a receipt-verified upload from the opened descriptor after its pathname is replaced", () => {
    const sandbox = createThreadSandbox();
    const original = readFileSync(sandbox.validPath);
    const movedOriginal = `${sandbox.validPath}.opened`;
    const replacement = Buffer.from("attacker replacement", "utf8");
    const artifact = readThreadUploadArtifact({
      filePath: sandbox.validPath,
      receiptPath: sandbox.receiptPath,
      exportDirectory: sandbox.exportDirectory,
      onFileOpened: () => {
        renameSync(sandbox.validPath, movedOriginal);
        writeFileSync(sandbox.validPath, replacement, { mode: 0o600 });
      },
    });
    expect(artifact.bytes).toEqual(original);
    expect(artifact.bytes).not.toEqual(replacement);
    expect(artifact.filename).toBe(sandbox.validPath.split("/").at(-1));
  });

  it("guards Thread uploads and session access through the real official bridge fixture, then reaps local children", async () => {
    const sandbox = createThreadSandbox();
    const guardUrl = await startThreadGuardService(sandbox);
    const directStatsResponse = await fetch(`${guardUrl}/v1/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "stats", arguments: {} }),
    });
    const directStats = await directStatsResponse.json();
    expect(directStatsResponse.status).toBe(200);
    expect(directStats).toMatchObject({ ok: true, result: { content: [{ text: JSON.stringify({ accepted: true, session: "ingenium" }) }] } });
    const directUploadArtifact = readThreadUploadArtifact({
      filePath: sandbox.validPath,
      receiptPath: sandbox.receiptPath,
      exportDirectory: sandbox.exportDirectory,
    });
    const directUploadResponse = await fetch(`${guardUrl}/v1/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "upload",
        arguments: {
          filename: directUploadArtifact.filename,
          contentBase64: directUploadArtifact.bytes.toString("base64"),
        },
      }),
    });
    expect(directUploadResponse.status).toBe(200);
    expect(await directUploadResponse.json()).toEqual({ ok: true, result: { isError: false } });
    const definitions = [threadRuntimeDefinition(sandbox, `${guardUrl}/v1/call`)];
    const { host, tools } = createHost();
    const api = createApi(definitions);
    const manager = new ChildMcpRuntimeManager({ startupMs: 750, requestMs: CHILD_MCP_REQUEST_TIMEOUT_MS, shutdownMs: 750 });
    const gateway = new ChildMcpGateway(host, "threadbridge-project", api.api, manager);
    gateways.push(gateway);

    // A single multipart upload gets a bounded 30-second child request budget.
    expect(CHILD_MCP_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    await gateway.start();

    const transportName = "threadbridge_thread_upload_file";
    const handler = tools.get(transportName)?.handler;
    expect(handler).toBeTypeOf("function");
    expect(tools.has("threadbridge_thread_search")).toBe(true);
    expect(tools.has("threadbridge_thread_read_entries")).toBe(true);
    expect(tools.has("threadbridge_thread_read_entries_batch")).toBe(true);
    expect(tools.has("threadbridge_thread_get_tags")).toBe(true);
    expect(tools.has("threadbridge_thread_get_stats")).toBe(true);
    expect(tools.has("threadbridge_thread_list_sessions")).toBe(false);
    expect(tools.has("threadbridge_thread_write")).toBe(false);
    expect(tools.has("threadbridge_thread_delete")).toBe(false);
    expect(tools.has("threadbridge_thread_admin_dump")).toBe(false);
    expect(api.reports[0]).toMatchObject({
      status: "ready",
      tools: [
        expect.objectContaining({ name: "thread_upload_file" }),
        expect.objectContaining({ name: "thread_search" }),
        expect.objectContaining({ name: "thread_read_entries" }),
        expect.objectContaining({ name: "thread_read_entries_batch" }),
        expect.objectContaining({ name: "thread_get_tags" }),
        expect.objectContaining({ name: "thread_get_stats" }),
      ],
    });
    const uploadedSchema = api.reports[0]!.tools!.find((tool) => tool.name === "thread_upload_file")!.input_schema;
    expect((uploadedSchema.properties as Record<string, unknown>).session).toBeUndefined();

    const forwarded = await handler!({
      project: "threadbridge-project",
      arguments: { session: "attacker-session", file_path: sandbox.validPath, receipt_path: sandbox.receiptPath },
    });
    expect(forwarded).toMatchObject({
      content: [{ type: "text", text: JSON.stringify({ accepted: true }) }],
    });
    expect(JSON.stringify(forwarded)).not.toContain(sandbox.validPath);
    await expect(tools.get("threadbridge_thread_search")!.handler({
      project: "threadbridge-project",
      arguments: { session: "other-session", query: "fixture" },
    })).resolves.toMatchObject({ content: [{ type: "text", text: JSON.stringify({ accepted: true, session: "ingenium" }) }] });
    await expect(tools.get("threadbridge_thread_read_entries")!.handler({
      project: "threadbridge-project",
      arguments: { session: "admin-session", limit: 1 },
    })).resolves.toMatchObject({ content: [{ type: "text", text: JSON.stringify({ accepted: true, session: "ingenium" }) }] });
    await expect(tools.get("threadbridge_thread_read_entries_batch")!.handler({
      project: "threadbridge-project",
      arguments: { session: "admin-session", ids: [1] },
    })).resolves.toMatchObject({ content: [{ type: "text", text: JSON.stringify({ accepted: true, session: "ingenium" }) }] });
    await expect(tools.get("threadbridge_thread_get_tags")!.handler({
      project: "threadbridge-project",
      arguments: { session: "admin-session" },
    })).resolves.toMatchObject({ content: [{ type: "text", text: JSON.stringify({ accepted: true, session: "ingenium" }) }] });
    await expect(tools.get("threadbridge_thread_get_stats")!.handler({
      project: "threadbridge-project",
      arguments: { session: "admin-session" },
    })).resolves.toMatchObject({ content: [{ type: "text", text: JSON.stringify({ accepted: true, session: "ingenium" }) }] });
    expect(api.checkedTools).toContain("ingenium_threadbridge_thread_upload_file");

    for (const filePath of [
      sandbox.secretPath,
      sandbox.configPath,
      sandbox.traversalPath,
      sandbox.symlinkPath,
      sandbox.hardlinkPath,
      sandbox.mismatchedReceiptPath,
      sandbox.mismatchedFingerprintPath,
      sandbox.wrongModePath,
      sandbox.nonRegularPath,
      sandbox.dotAliasPath,
      sandbox.controlPath,
    ]) {
      const rejected = await handler!({
        project: "threadbridge-project",
        arguments: { session: "attacker-session", file_path: filePath },
      });
      expect(JSON.stringify(rejected)).not.toContain(filePath);
      expect(JSON.stringify(rejected)).not.toContain("attacker-session");
    }
    await expect(manager.callTool("threadbridge", "thread_admin_dump", { session: "attacker-session" })).rejects.toMatchObject({
      code: "CHILD_MCP_UNKNOWN_TOOL",
    });
    const audit = readAudit(sandbox.auditPath);
    expect(audit).toMatchObject([
      { name: "thread_get_stats", session: "ingenium" },
      { name: "thread_upload_file", session: "ingenium", byteLength: directUploadArtifact.bytes.length, sha256: sha256(directUploadArtifact.bytes) },
      { name: "thread_upload_file", session: "ingenium", byteLength: readFileSync(sandbox.validPath).length, sha256: sha256(readFileSync(sandbox.validPath).toString("utf8")) },
      { name: "thread_search", session: "ingenium" },
      { name: "thread_read_entries", session: "ingenium" },
      { name: "thread_read_entries_batch", session: "ingenium" },
      { name: "thread_get_tags", session: "ingenium" },
      { name: "thread_get_stats", session: "ingenium" },
    ]);
    const uploads = audit.filter((record) => record.name === "thread_upload_file");
    expect(uploads).toHaveLength(2);
    for (const upload of uploads) {
      expect(upload.filePath).not.toBe(sandbox.validPath);
      expect(existsSync(upload.filePath!)).toBe(false);
    }
    expect(existsSync(sandbox.guardTempDirectory) ? readdirSync(sandbox.guardTempDirectory) : []).toEqual([]);

    api.setToolState("disabled");
    await expect(handler!({
      project: "threadbridge-project",
      arguments: { session: "session_123", file_path: sandbox.validPath },
    })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: { code: "TOOL_DISABLED", message: "This child MCP tool is disabled for the project." } }) }],
    });
    await expect(handler!({
      project: "other-project",
      arguments: { session: "session_123", file_path: sandbox.validPath },
    })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: { code: "PROJECT_IDENTITY_REQUIRED", message: "A valid explicit project identity is required for this child MCP tool." } }) }],
    });
    expect(readAudit(sandbox.auditPath)).toHaveLength(8);

    await gateway.shutdown();
    expect(tools.has(transportName)).toBe(false);
    expect(manager.getStatus("threadbridge")).toMatchObject({ state: "stopped", pid: null });
  });
});
