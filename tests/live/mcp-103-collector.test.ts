import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  MCP103_CATALOG_SIZE,
  MCP103_EXTENSION_TOOL_NAMES,
  Mcp103CollectorError,
  buildMcp103Report,
  mcp103HealthCheckOutcome,
  mcp103ToolNamesFromList,
  serializeMcp103Report,
} from "../helpers/mcp-103-collector.js";
import {
  collectMcp103Report,
  launchMcp103LocalEntry,
  mcp103ArtifactPath,
  runMcp103Collector,
  writeMcp103Artifact,
} from "../scripts/mcp-103-collector.js";

const REPOSITORY_ROOT = resolve(__dirname, "../..");
const FIXTURE_ROOT = join(REPOSITORY_ROOT, "tests", "fixtures", "mcp-103");
const artifacts: string[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of artifacts.splice(0)) rmSync(path, { recursive: true, force: true });
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), "utf8")) as unknown;
}

function reportFor(transport: Parameters<typeof buildMcp103Report>[0]["transport"]) {
  return buildMcp103Report({
    provenance: "fixture",
    generatedAt: "2026-07-31T12:00:10.000Z",
    observedAt: transport.state === "listed" ? "2026-07-31T12:00:00.000Z" : null,
    freshnessDurationMs: 60_000,
    sourceRegistrations: { status: "unknown" },
    transport,
  });
}

function tool(report: ReturnType<typeof reportFor>, name: string) {
  const entry = report.tools.find((candidate) => candidate.name === name);
  if (!entry) throw new Error("missing expected test tool");
  return entry;
}

function fixedClock(...timestamps: string[]) {
  let index = 0;
  return {
    now: () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]!),
  };
}

function createFixtureRepository(config: unknown): string {
  const repository = mkdtempSync(join(tmpdir(), "ingenium-mcp-103-"));
  temporaryDirectories.push(repository);
  writeFileSync(join(repository, "opencode.json"), JSON.stringify(config), { mode: 0o600 });
  return repository;
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("bounded test wait expired");
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

async function waitForAsync(check: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("bounded test wait expired");
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

function portListening(port: number): Promise<boolean> {
  return new Promise((resolveResult) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolveResult(listening);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

describe("MCP-103 usefulness collector", () => {
  it("maps the complete catalog, extension exception, safe health result, and deterministic bytes", () => {
    const report = reportFor({
      state: "listed",
      transportNames: ["health_check", "skill_list"],
      healthCheck: "success",
    });

    expect(report).toMatchObject({
      catalog: { status: "unknown", issues: [] },
      freshness: { status: "fresh", observedAt: "2026-07-31T12:00:00.000Z", durationMs: 60_000 },
    });
    expect(report.tools).toHaveLength(MCP103_CATALOG_SIZE);
    expect(tool(report, "ingenium_health_check")).toMatchObject({
      boundary: "mcp-stdio",
      visibility: { status: "reachable", reason: null },
      invocation: { status: "success", reason: null },
    });
    expect(tool(report, "ingenium_skill_list").visibility).toEqual({ status: "reachable", reason: null });
    expect(tool(report, "ingenium_skill_create").invocation).toEqual({ status: "not-run", reason: "unsafe-invocation" });
    for (const name of MCP103_EXTENSION_TOOL_NAMES) {
      expect(tool(report, name)).toMatchObject({
        boundary: "opencode-extension",
        visibility: { status: "not-applicable", reason: "not-requested" },
        invocation: { status: "not-run", reason: "not-requested" },
      });
    }
    expect(serializeMcp103Report(report)).toBe(serializeMcp103Report(reportFor({
      state: "listed",
      transportNames: ["skill_list", "health_check"],
      healthCheck: "success",
    })));
  });

  it("builds one compact complete-catalog core report within 64 KiB without repeated catalog or freshness rows", () => {
    const report = reportFor({ state: "listed", transportNames: ["health_check"], healthCheck: "success" });

    expect(report.tools).toHaveLength(MCP103_CATALOG_SIZE);
    expect(Buffer.byteLength(JSON.stringify(report), "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(Object.keys(report)).toEqual(["schemaVersion", "provenance", "generatedAt", "freshness", "catalog", "tools"]);
    expect(report.tools.every((entry) => Object.keys(entry).join(",") === "name,boundary,visibility,invocation")).toBe(true);
    expect(report.tools.some((entry) => "catalog" in entry || "freshness" in entry)).toBe(false);
  });

  it("handles empty, missing, unexpected, and duplicate list fixtures without promoting malformed evidence", () => {
    const empty = mcp103ToolNamesFromList(fixture("empty-tools.json"));
    expect(empty).toEqual([]);
    expect(tool(reportFor({ state: "listed", transportNames: empty!, healthCheck: "not-run" }), "ingenium_health_check")).toMatchObject({
      visibility: { status: "unreachable", reason: "not-listed" },
      invocation: { status: "not-run", reason: "unsafe-invocation" },
    });

    expect(mcp103ToolNamesFromList(fixture("missing-tools.json"))).toBeUndefined();
    expect(tool(reportFor({ state: "list-unavailable" }), "ingenium_skill_list")).toMatchObject({
      visibility: { status: "unknown", reason: "list-unavailable" },
      invocation: { status: "unknown", reason: "list-unavailable" },
    });

    const unexpected = mcp103ToolNamesFromList(fixture("unexpected-tools.json"));
    expect(unexpected).toEqual(["foreign-probe", "health_check"]);
    expect(tool(reportFor({ state: "listed", transportNames: unexpected!, healthCheck: "success" }), "ingenium_health_check").visibility)
      .toEqual({ status: "reachable", reason: null });
    expect(tool(reportFor({ state: "listed", transportNames: unexpected!, healthCheck: "success" }), "ingenium_skill_list").visibility)
      .toEqual({ status: "unreachable", reason: "not-listed" });

    expect(mcp103ToolNamesFromList(fixture("duplicate-tools.json"))).toBeUndefined();
    expect(tool(reportFor({ state: "transport-unavailable" }), "ingenium_skill_list")).toMatchObject({
      visibility: { status: "unknown", reason: "transport-unavailable" },
      invocation: { status: "unknown", reason: "transport-unavailable" },
    });
  });

  it("keeps health payloads opaque and maps only valid MCP result envelopes", async () => {
    const payload = { isError: true, content: [{ type: "text", text: "Bearer fixture-secret https://private.invalid/hidden" }] };
    expect(mcp103HealthCheckOutcome(payload)).toBe("failed");
    expect(mcp103HealthCheckOutcome({ content: [{ type: "text", text: "ignored" }] })).toBe("success");
    expect(mcp103HealthCheckOutcome({ content: [{ type: "text" }] })).toBe("invalid");
    expect(mcp103HealthCheckOutcome({ content: [], isError: "false" })).toBe("invalid");
    const report = reportFor({ state: "listed", transportNames: ["health_check"], healthCheck: "failed" });
    const serialized = serializeMcp103Report(report);
    expect(tool(report, "ingenium_health_check").invocation).toEqual({ status: "failed", reason: "invocation-failed" });
    expect(serialized).not.toContain("fixture-secret");
    expect(serialized).not.toContain("private.invalid");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain(REPOSITORY_ROOT);

    const repository = createFixtureRepository({
      mcp: { ingenium: { type: "local", enabled: true, command: ["fixture-command"], environment: {}, timeout: 20 } },
    });
    const result = await collectMcp103Report({
      repositoryRoot: repository,
      provenance: "fixture",
      clock: fixedClock("2026-07-31T12:00:00.000Z", "2026-07-31T12:00:01.000Z"),
      launch: async () => ({
        listTools: async () => ({ tools: [{ name: "health_check" }] }),
        callHealthCheck: async () => ({ content: [{ type: "text" }] }),
        close: async () => undefined,
      }),
    });
    expect(tool(result.report, "ingenium_health_check").invocation)
      .toEqual({ status: "unknown", reason: "invalid-response" });
  });

  it("invokes exactly the provider-free health tool, closes the connection, and returns project metadata only outside the report", async () => {
    const repository = createFixtureRepository({
      mcp: {
        ingenium: {
          type: "local",
          enabled: true,
          command: ["fixture-command"],
          environment: { INGENIUM_PROJECT: "mcp103-fixture-project" },
          timeout: 20,
        },
      },
    });
    const calls: string[] = [];
    const result = await collectMcp103Report({
      repositoryRoot: repository,
      provenance: "fixture",
      clock: fixedClock("2026-07-31T12:00:00.000Z", "2026-07-31T12:00:01.000Z"),
      launch: async () => ({
        listTools: async () => {
          calls.push("list");
          return { tools: [{ name: "health_check" }, { name: "skill_list" }] };
        },
        callHealthCheck: async () => {
          calls.push("health");
          return { content: [{ type: "text", text: "ignored" }] };
        },
        close: async () => {
          calls.push("close");
        },
      }),
    });

    expect(calls).toEqual(["list", "health", "close"]);
    expect(result.project).toBe("mcp103-fixture-project");
    expect(JSON.stringify(result.report)).not.toContain("mcp103-fixture-project");
    expect(tool(result.report, "ingenium_health_check").invocation).toEqual({ status: "success", reason: null });
  });

  it("bounds list timeouts and cleanup failures without serializing thrown diagnostics", async () => {
    const repository = createFixtureRepository({
      mcp: { ingenium: { type: "local", enabled: true, command: ["fixture-command"], environment: {}, timeout: 1 } },
    });
    const timedOut = await collectMcp103Report({
      repositoryRoot: repository,
      provenance: "fixture",
      clock: fixedClock("2026-07-31T12:00:00.000Z", "2026-07-31T12:00:01.000Z"),
      launch: async () => ({
        listTools: () => new Promise(() => undefined),
        callHealthCheck: async () => ({ isError: false }),
        close: async () => undefined,
      }),
    });
    expect(tool(timedOut.report, "ingenium_health_check")).toMatchObject({
      visibility: { status: "unknown", reason: "list-unavailable" },
      invocation: { status: "unknown", reason: "list-unavailable" },
    });

    await expect(collectMcp103Report({
      repositoryRoot: repository,
      launch: async () => ({
        listTools: async () => ({ tools: [] }),
        callHealthCheck: async () => ({ isError: false }),
        close: async () => {
          throw new Error("Bearer fixture-secret https://private.invalid/cleanup");
        },
      }),
    })).rejects.toEqual(expect.objectContaining({ name: Mcp103CollectorError.name, message: "MCP103_COLLECTOR_FAILURE" }));
  });

  it("writes only the canonical owner-only artifact path and rejects traversal or symlink output", () => {
    const runId = `run-mcp103-test-${Date.now()}`;
    const runDirectory = join(REPOSITORY_ROOT, "tests", "artifacts", "test-runs", runId);
    artifacts.push(runDirectory);
    const report = reportFor({ state: "listed", transportNames: ["health_check"], healthCheck: "success" });

    writeMcp103Artifact(REPOSITORY_ROOT, runId, report);
    const outputPath = mcp103ArtifactPath(REPOSITORY_ROOT, runId);
    expect(outputPath).toBe(join(runDirectory, "mcp-usefulness-report.json"));
    expect(lstatSync(runDirectory).mode & 0o777).toBe(0o700);
    expect(lstatSync(outputPath).mode & 0o077).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toBe(serializeMcp103Report(report));
    expect(() => mcp103ArtifactPath(REPOSITORY_ROOT, "../escape")).toThrow(Mcp103CollectorError);
    expect(() => mcp103ArtifactPath(REPOSITORY_ROOT, ".")).toThrow(Mcp103CollectorError);
    expect(() => writeMcp103Artifact(REPOSITORY_ROOT, runId, report)).toThrow(Mcp103CollectorError);

    const linkedRunId = `run-mcp103-link-${Date.now()}`;
    const linkedPath = join(REPOSITORY_ROOT, "tests", "artifacts", "test-runs", linkedRunId);
    const target = mkdtempSync(join(tmpdir(), "ingenium-mcp-103-link-"));
    temporaryDirectories.push(target);
    mkdirSync(join(REPOSITORY_ROOT, "tests", "artifacts", "test-runs"), { recursive: true });
    symlinkSync(target, linkedPath, "dir");
    artifacts.push(linkedPath);
    expect(() => mcp103ArtifactPath(REPOSITORY_ROOT, linkedRunId)).toThrow(Mcp103CollectorError);
  });

  it("uses the configured stdio launcher without leaving its dynamic listener or child process alive", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "ingenium-mcp-103-child-"));
    temporaryDirectories.push(temporary);
    const portFile = join(temporary, "port.json");
    const connection = await launchMcp103LocalEntry({
      command: [process.execPath, join(FIXTURE_ROOT, "stdio-fixture.mjs")],
      environment: { MCP103_FIXTURE_PORT_FILE: portFile },
      timeoutMs: 2_000,
    }, REPOSITORY_ROOT);
    let closed = false;
    try {
      expect(mcp103ToolNamesFromList(await connection.listTools())).toEqual(["health_check"]);
      await connection.callHealthCheck();
      await waitFor(() => existsSync(portFile));
      const processInfo = JSON.parse(readFileSync(portFile, "utf8")) as { pid: number; port: number };
      expect(await portListening(processInfo.port)).toBe(true);
      await connection.close();
      closed = true;
      await waitForAsync(async () => !(await portListening(processInfo.port)));
      expect(() => process.kill(processInfo.pid, 0)).toThrow();
    } finally {
      if (!closed) await connection.close().catch(() => undefined);
    }
  });

  it("rejects invalid CLI gates with fixed stderr and fixtures contain no secrets", async () => {
    const messages: string[] = [];
    expect(await runMcp103Collector(["--token", "not-accepted"], {
      repositoryRoot: REPOSITORY_ROOT,
      writeStderr: (message) => messages.push(message),
    })).toBe(1);
    expect(messages).toEqual(["MCP-103 collector failed\n"]);

    const repository = createFixtureRepository({
      mcp: { ingenium: { type: "local", enabled: true, command: ["fixture-command"], environment: {}, timeout: 20 } },
    });
    const cleanupMessages: string[] = [];
    expect(await runMcp103Collector(["--run-id", "run-mcp103-cleanup-failure"], {
      repositoryRoot: repository,
      writeStderr: (message) => cleanupMessages.push(message),
      launch: async () => ({
        listTools: async () => ({ tools: [] }),
        callHealthCheck: async () => ({ isError: false }),
        close: async () => {
          throw new Error("Bearer fixture-secret https://private.invalid/cleanup");
        },
      }),
    })).toBe(1);
    expect(cleanupMessages).toEqual(["MCP-103 collector failed\n"]);
    expect(readdirSync(FIXTURE_ROOT).flatMap((name) => readFileSync(join(FIXTURE_ROOT, name), "utf8")))
      .not.toContain("INGENIUM_API_TOKEN");
  });
});
