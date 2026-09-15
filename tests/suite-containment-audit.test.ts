import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
  chmodSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  type Dir,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  TEST_RUN_MANIFEST_ENV,
  TEST_RUN_TEMP_PREFIX,
  TEST_RUN_TELEMETRY_ENV,
  createTestRunContext,
  cleanupTestRun,
  COORDINATION_TRACE_ROOT,
  getTestRunArtifactRoot,
  readTestRunManifest,
  readTestRunTelemetry,
  readTestRunTelemetryForContainmentAudit,
  releaseTestRunPortReservations,
  resetTestRunContextForTests,
  updateTestRunManifest,
} from "./test-run-context";
import { recoverStoppingTestRun } from "./test-server-lifecycle";
import {
  capturePreexistingProcessBaseline,
  discoverRepositoryProcessCandidates,
  toPreexistingProcess,
  type RepositoryProcessCandidate,
} from "./test-run-process-discovery";
import {
  auditSuiteContainment,
  auditProcesses,
  isListening,
  inspectOwnedMisplacedTestResults,
  removeOwnedMisplacedTestResults,
  historicalOnlyListenerPorts,
  scanCoordinationTraceResiduals,
  strictFailures,
} from "./suite-containment-audit";

const contexts: Array<ReturnType<typeof createTestRunContext>> = [];
const servers: Server[] = [];
const children: ChildProcess[] = [];
const temporaryRepositories: string[] = [];
const temporaryManifestlessEvidence: string[] = [];
const coordinationTraceEntries: string[] = [];
const testComposeOwnership = {
  classification: "unverified" as const,
  hostPorts: [3000, 4097, 1455],
  reason: "unit test does not inspect Docker",
};

function auditContainment(options: Parameters<typeof auditSuiteContainment>[0] = {}) {
  return auditSuiteContainment({ ...options, composeOwnership: options.composeOwnership ?? testComposeOwnership });
}

describe("strict active-handle containment", () => {
  it("waits for successful and refused probes to close without hiding a live server", async () => {
    const server = createServer();
    // Only the outbound probe is under test; the in-process peer closes separately.
    server.on("connection", (socket) => socket.unref());
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const before = auditProcesses().activeHandles;
    expect(before).toBeGreaterThan(0);
    expect(await isListening(port)).toBe(true);
    expect(auditProcesses().activeHandles).toBe(before);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const runtime = process as NodeJS.Process & { _getActiveHandles: () => unknown[] };
    const closed = new Set(runtime._getActiveHandles());
    expect(await isListening(port)).toBe(false);
    expect(runtime._getActiveHandles().filter((handle) => !closed.has(handle))).toEqual([]);
  });

  it("excludes only auditor stdio and parent IPC, not other sockets or servers", () => {
    const runtime = process as NodeJS.Process & { _getActiveHandles: () => unknown[] };
    const handles = vi.spyOn(runtime, "_getActiveHandles");
    try {
      handles.mockReturnValue([process.stdin, process.stdout, process.stderr, process.channel]);
      expect(auditProcesses().activeHandles).toBe(0);
      handles.mockReturnValue([process.stdout, { constructor: { name: "Socket" } }, { constructor: { name: "Server" } }]);
      expect(auditProcesses().activeHandles).toBe(2);
    } finally {
      handles.mockRestore();
    }
  });

  it("fails strict evaluation for residual or unavailable handles and accepts zero", async () => {
    const report = await auditContainment({ portProbe: async () => false, telemetryPaths: [] });
    for (const count of [1, 4, -1, NaN]) {
      const failures = strictFailures({ ...report, process: { ...report.process, activeHandles: count } });
      expect(failures.some((failure) => failure.startsWith("active handles:"))).toBe(true);
    }
    expect(strictFailures({ ...report, process: { ...report.process, activeHandles: 0 } })
      .some((failure) => failure.startsWith("active handles:"))).toBe(false);
  });
});

function createContextWithReservedPortRetry(
  options: Parameters<typeof createTestRunContext>[0] = {},
): ReturnType<typeof createTestRunContext> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const configuredPorts = options.ports ?? (() => {
      const slot = Number.parseInt(randomUUID().slice(0, 6), 16) % 5_000;
      const api = 41_000 + slot * 3;
      return { api, dashboard: api + 1, fixture: api + 2 };
    })();
    try {
      return createTestRunContext({ ...options, ports: configuredPorts });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("already reserved by another runner")) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function createBaselineContext(): ReturnType<typeof createTestRunContext> {
  const context = createContextWithReservedPortRetry({ applyEnvironment: false });
  contexts.push(context);
  return context;
}

function startRepositoryListener(runNonce?: string, port = 0): ChildProcess {
  const child = spawn(process.execPath, [
    "-e",
    `require('node:net').createServer().listen(${port}, '127.0.0.1')`,
  ], {
    cwd: process.cwd(),
    detached: true,
    env: {
      PATH: process.env.PATH ?? "",
      ...(runNonce ? { INGENIUM_TEST_RUN_NONCE: runNonce } : {}),
    },
    stdio: "ignore",
  });
  if (!child.pid) throw new Error("repository listener did not expose a PID");
  children.push(child);
  return child;
}

async function waitForRepositoryListener(pid: number): Promise<RepositoryProcessCandidate> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const candidate = discoverRepositoryProcessCandidates(process.cwd())
      .find((entry) => entry.pid === pid);
    if (candidate?.listeningPorts.length) return candidate;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`repository listener ${pid} was not discovered`);
}

function hasContainmentHoldFor(report: Awaited<ReturnType<typeof auditSuiteContainment>>, pid: number): boolean {
  return strictFailures(report).some((failure) => failure.includes("containment holds")
    && failure.includes(`manifestless candidate ${pid}`));
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      setTimeout(resolve, 500);
    });
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
        setTimeout(resolve, 500);
      });
    }
  }
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const context of contexts.splice(0)) {
    delete process.env[TEST_RUN_MANIFEST_ENV];
    try {
      cleanupTestRun(context.manifestPath);
    } catch {
      try {
        releaseTestRunPortReservations(context);
      } catch {
        // Preserve the retained evidence if reservation ownership cannot be
        // proven during test cleanup.
      }
      rmSync(context.runDir, { recursive: true, force: true });
    }
    if (!existsSync(context.manifestPath)) {
      try {
        releaseTestRunPortReservations(context);
      } catch {
        // The run directory cleanup below remains scoped even if a lock is
        // already owned by another run.
      }
    }
    rmSync(dirname(context.telemetryPath!), { recursive: true, force: true });
  }
  for (const repository of temporaryRepositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
  for (const path of temporaryManifestlessEvidence.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
  for (const path of coordinationTraceEntries.splice(0)) {
    rmSync(path, { force: true });
  }
  resetTestRunContextForTests();
});

function coordinationTraceEntry(name: string): string {
  mkdirSync(COORDINATION_TRACE_ROOT, { recursive: true, mode: 0o700 });
  const path = join(COORDINATION_TRACE_ROOT, name);
  coordinationTraceEntries.push(path);
  return path;
}

function temporaryCoordinationTraceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ingenium-coordination-trace-audit-"));
  temporaryRepositories.push(root);
  chmodSync(root, 0o700);
  return root;
}

function temporaryRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), "ingenium-containment-audit-"));
  temporaryRepositories.push(repository);
  mkdirSync(join(repository, "tests", "test-results"), { recursive: true });
  writeFileSync(join(repository, "package.json"), "{}\n");
  execFileSync("git", ["init", "--quiet", repository], { encoding: "utf8" });
  return repository;
}

describe("suite containment audit", () => {
  it("separates unrelated historical port reuse from current or repository-owned listeners", () => {
    expect([...historicalOnlyListenerPorts(
      [41345, 45000, 46000],
      [45000],
      [46000],
    )]).toEqual([41345]);
  });

  it("detects a leaked manifest-owned dynamic port from persisted telemetry", { timeout: 15_000 }, async () => {
    const context = createTestRunContext({ ports: { api: 45301, dashboard: 45302, fixture: 45303 } });
    contexts.push(context);
    const server = createServer((_request, response) => response.end("leaked"));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(context.ports.api, "127.0.0.1", resolve));

    cleanupTestRun(context.manifestPath);
    const report = await auditContainment({ includeRepositoryTelemetry: true });

    expect(report.managedPorts).toContain(context.ports.api);
    expect(report.ports.find(({ port }) => port === context.ports.api)).toMatchObject({
      listening: true,
      owned: true,
    });
    expect(strictFailures(report).some((failure) => failure.includes(`listening ports:`)
      && failure.includes(String(context.ports.api)))).toBe(true);
  });

  it("discovers a manifestless repository process on a dynamic listener without signaling it", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "require('node:net').createServer().listen(0, '127.0.0.1')",
    ], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
    });
    if (!child.pid) throw new Error("dynamic listener child did not expose a PID");
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const report = await auditContainment();
      const candidate = report.discoveredProcesses.find(({ pid }) => pid === child.pid);

      expect(candidate).toBeDefined();
      expect(candidate?.listeningPorts.length).toBeGreaterThan(0);
      expect(strictFailures(report).some((failure) => failure.includes("containment holds"))).toBe(true);
      expect(() => process.kill(child.pid!, 0)).not.toThrow();
    } finally {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The child may have exited between discovery and cleanup.
      }
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
        setTimeout(resolve, 500);
      });
    }
  });

  it("persists an unchanged pre-existing listener through normal cleanup without failing strict containment", async () => {
    const context = createBaselineContext();
    const child = startRepositoryListener();
    const candidate = await waitForRepositoryListener(child.pid!);
    const baseline = capturePreexistingProcessBaseline(context);

    expect(baseline.candidates).toContainEqual(toPreexistingProcess(candidate));
    expect(readTestRunManifest(context.manifestPath).preexistingProcessBaseline).toEqual(baseline);
    expect(readTestRunTelemetry(context.telemetryPath!).preexistingProcessBaseline).toEqual(baseline);

    cleanupTestRun(context.manifestPath);
    expect(existsSync(context.manifestPath)).toBe(false);
    expect(readTestRunTelemetry(context.telemetryPath!).preexistingProcessBaseline).toEqual(baseline);

    const report = await auditContainment({
      manifestPath: "",
      telemetryPaths: [context.telemetryPath!],
      includeRepositoryTelemetry: false,
    });
    const port = candidate.listeningPorts[0]!;

    expect(report.preexistingUnownedProcesses).toContainEqual(expect.objectContaining({
      pid: child.pid,
      listeningPorts: candidate.listeningPorts,
    }));
    expect(report.discoveredProcesses.some(({ pid }) => pid === child.pid)).toBe(false);
    expect(report.ports.find(({ port: current }) => current === port)).toMatchObject({
      listening: true,
      ownership: "pre-existing-unowned",
    });
    expect(hasContainmentHoldFor(report, child.pid!)).toBe(false);
    expect(strictFailures(report).some((failure) => failure.includes("listening ports:")
      && failure.includes(String(port)))).toBe(false);
  });

  it("rejects a reused PID whose stable baseline identity changed", async () => {
    const context = createBaselineContext();
    const child = startRepositoryListener();
    const candidate = await waitForRepositoryListener(child.pid!);
    const baseline = capturePreexistingProcessBaseline(context);
    const changedBaseline = {
      ...baseline,
      candidates: baseline.candidates.map((record) => record.pid === child.pid
        ? { ...record, pidStartTime: `${record.pidStartTime}0` }
        : record),
    };

    updateTestRunManifest(context.manifestPath, { preexistingProcessBaseline: changedBaseline });
    cleanupTestRun(context.manifestPath);

    const report = await auditContainment({
      manifestPath: "",
      telemetryPaths: [context.telemetryPath!],
      includeRepositoryTelemetry: false,
    });

    expect(report.preexistingUnownedProcesses.some(({ pid }) => pid === child.pid)).toBe(false);
    expect(report.discoveredProcesses.some(({ pid }) => pid === child.pid)).toBe(true);
    expect(hasContainmentHoldFor(report, child.pid!)).toBe(true);
    expect(candidate.pidStartTime).not.toBe(`${candidate.pidStartTime}0`);
  });

  it("rejects a new manifestless listener absent from the startup baseline", async () => {
    const context = createBaselineContext();
    capturePreexistingProcessBaseline(context);
    const child = startRepositoryListener();
    const candidate = await waitForRepositoryListener(child.pid!);

    cleanupTestRun(context.manifestPath);
    const report = await auditContainment({
      manifestPath: "",
      telemetryPaths: [context.telemetryPath!],
      includeRepositoryTelemetry: false,
    });

    expect(report.preexistingUnownedProcesses.some(({ pid }) => pid === child.pid)).toBe(false);
    expect(report.discoveredProcesses.some(({ pid }) => pid === child.pid)).toBe(true);
    expect(hasContainmentHoldFor(report, child.pid!)).toBe(true);
    expect(candidate.listeningPorts).toHaveLength(1);
  });

  it("rejects a pre-existing listener on a run-owned port", async () => {
    const context = createBaselineContext();
    const child = startRepositoryListener(undefined, context.ports.fixture);
    const candidate = await waitForRepositoryListener(child.pid!);
    const baseline = capturePreexistingProcessBaseline(context);

    expect(baseline.candidates.some(({ pid }) => pid === child.pid)).toBe(false);
    cleanupTestRun(context.manifestPath);

    const report = await auditContainment({
      manifestPath: "",
      telemetryPaths: [context.telemetryPath!],
      includeRepositoryTelemetry: false,
    });

    expect(candidate.listeningPorts).toEqual([context.ports.fixture]);
    expect(report.ports.find(({ port }) => port === context.ports.fixture)).toMatchObject({
      ownership: "unverified",
    });
    expect(hasContainmentHoldFor(report, child.pid!)).toBe(true);
  });

  it("rejects a run-owned descendant even when its stable identity is forged into the baseline", async () => {
    const context = createBaselineContext();
    const baseline = capturePreexistingProcessBaseline(context);
    const child = startRepositoryListener(context.runNonce);
    const candidate = await waitForRepositoryListener(child.pid!);
    const forgedBaseline = {
      ...baseline,
      candidates: [...baseline.candidates, toPreexistingProcess(candidate)]
        .sort((left, right) => left.pid - right.pid),
    };

    updateTestRunManifest(context.manifestPath, { preexistingProcessBaseline: forgedBaseline });
    cleanupTestRun(context.manifestPath);

    const report = await auditContainment({
      manifestPath: "",
      telemetryPaths: [context.telemetryPath!],
      includeRepositoryTelemetry: false,
    });

    expect(candidate.runNonce).toBe(context.runNonce);
    expect(report.preexistingUnownedProcesses.some(({ pid }) => pid === child.pid)).toBe(false);
    expect(report.discoveredProcesses.some(({ pid, runNonce }) => pid === child.pid
      && runNonce === context.runNonce)).toBe(true);
    expect(hasContainmentHoldFor(report, child.pid!)).toBe(true);
  });

  it("rejects missing and malformed pre-existing process baselines", async () => {
    const missingChild = startRepositoryListener();
    await waitForRepositoryListener(missingChild.pid!);
    const olderBaselineContext = createBaselineContext();
    capturePreexistingProcessBaseline(olderBaselineContext);
    cleanupTestRun(olderBaselineContext.manifestPath);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const missingContext = createBaselineContext();
    cleanupTestRun(missingContext.manifestPath);

    const missingReport = await auditContainment({
      manifestPath: "",
      telemetryPaths: [olderBaselineContext.telemetryPath!, missingContext.telemetryPath!],
      includeRepositoryTelemetry: false,
    });

    expect(missingReport.preexistingUnownedProcesses.some(({ pid }) => pid === missingChild.pid)).toBe(false);
    expect(hasContainmentHoldFor(missingReport, missingChild.pid!)).toBe(true);

    const malformedContext = createBaselineContext();
    const malformedChild = startRepositoryListener();
    const malformedCandidate = await waitForRepositoryListener(malformedChild.pid!);
    capturePreexistingProcessBaseline(malformedContext);
    cleanupTestRun(malformedContext.manifestPath);
    const malformedTelemetry = JSON.parse(readFileSync(malformedContext.telemetryPath!, "utf8")) as {
      preexistingProcessBaseline: { candidates: Array<{ pid: number; commandHash: string }> };
    };
    const baselineCandidate = malformedTelemetry.preexistingProcessBaseline.candidates
      .find(({ pid }) => pid === malformedChild.pid);
    if (!baselineCandidate) throw new Error("listener was not persisted in the baseline");
    baselineCandidate.commandHash = "malformed";
    writeFileSync(malformedContext.telemetryPath!, JSON.stringify(malformedTelemetry));

    const malformedReport = await auditContainment({
      manifestPath: "",
      telemetryPaths: [malformedContext.telemetryPath!],
      includeRepositoryTelemetry: false,
    });

    expect(malformedReport.telemetryErrors.some((error) => error.includes(malformedContext.telemetryPath!))).toBe(true);
    expect(malformedReport.discoveredProcesses.some(({ pid }) => pid === malformedChild.pid)).toBe(true);
    expect(hasContainmentHoldFor(malformedReport, malformedChild.pid!)).toBe(true);
    expect(malformedCandidate.listeningPorts).toHaveLength(1);
  });

  it("does not trust a baseline while its manifest is active or malformed", async () => {
    const context = createBaselineContext();
    const child = startRepositoryListener();
    await waitForRepositoryListener(child.pid!);
    capturePreexistingProcessBaseline(context);
    updateTestRunManifest(context.manifestPath, { status: "running" });

    const activeReport = await auditContainment({
      manifestPath: context.manifestPath,
      telemetryPaths: [context.telemetryPath!],
      includeRepositoryTelemetry: false,
    });

    expect(activeReport.preexistingUnownedProcesses.some(({ pid }) => pid === child.pid)).toBe(false);
    expect(hasContainmentHoldFor(activeReport, child.pid!)).toBe(true);

    writeFileSync(context.manifestPath, "not valid JSON\n");
    const malformedReport = await auditContainment({
      manifestPath: context.manifestPath,
      telemetryPaths: [context.telemetryPath!],
      includeRepositoryTelemetry: false,
    });

    expect(malformedReport.telemetry.find(({ runId }) => runId === context.runId)).toMatchObject({
      manifestState: "invalid",
    });
    expect(malformedReport.preexistingUnownedProcesses.some(({ pid }) => pid === child.pid)).toBe(false);
    expect(hasContainmentHoldFor(malformedReport, child.pid!)).toBe(true);
  });

  it("allows strict audit after explicit recovery while retaining resolved telemetry", async () => {
    const context = createTestRunContext({ ports: { api: 45311, dashboard: 45312, fixture: 45313 } });
    contexts.push(context);
    const record = {
      name: "api" as const,
      pid: 999999,
      port: context.ports.api,
      startedAt: new Date().toISOString(),
      runNonce: context.runNonce,
      pidStartTime: "1",
      pgid: 999999,
      executable: "/usr/bin/node",
      groupIdentity: "999999:3",
    };
    const manifest = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
    writeFileSync(context.manifestPath, JSON.stringify({ ...manifest, status: "stopping", processes: [record] }));
    const previousPrefix = process.env.INGENIUM_AUDIT_TEMP_PREFIX;
    process.env.INGENIUM_AUDIT_TEMP_PREFIX = "ingenium-phase-5g-no-other-temp-";
    try {
      await recoverStoppingTestRun(context.manifestPath, { portTimeoutMs: 50 });
      const report = await auditContainment();
      expect(report.telemetry.find(({ runId }) => runId === context.runId)?.resolution?.status).toBe("resolved");
      expect(strictFailures(report).some((failure) => failure.includes(context.runId))).toBe(false);
    } finally {
      if (previousPrefix === undefined) delete process.env.INGENIUM_AUDIT_TEMP_PREFIX;
      else process.env.INGENIUM_AUDIT_TEMP_PREFIX = previousPrefix;
    }
  });

  it("fails every telemetry status whose manifest is missing unless it is explicitly resolved", async () => {
    const statuses = ["created", "starting", "running", "stopping", "complete"] as const;
    const missingManifestPaths: string[] = [];
    const telemetryPaths: string[] = [];

    for (const status of statuses) {
      const context = createContextWithReservedPortRetry({ applyEnvironment: false });
      contexts.push(context);
      updateTestRunManifest(context.manifestPath, { status });
      rmSync(context.manifestPath, { force: true });
      missingManifestPaths.push(context.manifestPath);
      telemetryPaths.push(context.telemetryPath!);
    }

    const report = await auditContainment({ telemetryPaths });
    const failures = strictFailures(report);
    for (const manifestPath of missingManifestPaths) {
      const telemetryPath = report.telemetry.find((entry) => entry.manifestPath === manifestPath)?.path;
      expect(telemetryPath).toBeDefined();
      expect(failures.some((failure) => failure.includes("no matching valid manifest") && failure.includes(telemetryPath!))).toBe(true);
    }
  });

  it.each(["created", "starting", "running"] as const)(
    "fails a valid-manifest telemetry record that remains in %s state",
    async (status) => {
      const context = createTestRunContext({
        ports: { api: status === "created" ? 45351 : status === "starting" ? 45354 : 45357, dashboard: status === "created" ? 45352 : status === "starting" ? 45355 : 45358, fixture: status === "created" ? 45353 : status === "starting" ? 45356 : 45359 },
      });
      contexts.push(context);
      updateTestRunManifest(context.manifestPath, { status });

      const report = await auditContainment();
      const telemetry = report.telemetry.find(({ runId }) => runId === context.runId);
      expect(telemetry).toMatchObject({ status, manifestState: "valid", activeProcessCount: 0 });
      expect(strictFailures(report).some((failure) => failure.includes("not terminally resolved")
        && failure.includes(context.telemetryPath!))).toBe(true);
    },
  );

  it("strictly fails when the configured telemetry hand-off is missing", async () => {
    const context = createTestRunContext({ ports: { api: 45341, dashboard: 45342, fixture: 45343 } });
    contexts.push(context);
    const previousManifest = process.env[TEST_RUN_MANIFEST_ENV];
    const previousTelemetry = process.env[TEST_RUN_TELEMETRY_ENV];
    rmSync(context.telemetryPath!, { force: true });
    process.env[TEST_RUN_MANIFEST_ENV] = context.manifestPath;
    process.env[TEST_RUN_TELEMETRY_ENV] = context.telemetryPath!;
    try {
      const report = await auditContainment();
      expect(report.telemetryErrors.some((error) => error.includes(context.telemetryPath!))).toBe(true);
      expect(strictFailures(report).some((failure) => failure.startsWith("telemetry:")
        && failure.includes(context.telemetryPath!))).toBe(true);
    } finally {
      if (previousManifest === undefined) delete process.env[TEST_RUN_MANIFEST_ENV];
      else process.env[TEST_RUN_MANIFEST_ENV] = previousManifest;
      if (previousTelemetry === undefined) delete process.env[TEST_RUN_TELEMETRY_ENV];
      else process.env[TEST_RUN_TELEMETRY_ENV] = previousTelemetry;
    }
  });

  it("accepts a missing manifest only when its configured path matches resolved telemetry", async () => {
    const context = createTestRunContext({ ports: { api: 45321, dashboard: 45322, fixture: 45323 } });
    contexts.push(context);
    updateTestRunManifest(context.manifestPath, { status: "stopping" });
    await recoverStoppingTestRun(context.manifestPath, { portTimeoutMs: 50 });
    const telemetry = readTestRunTelemetry(context.telemetryPath!);
    cleanupTestRun(context.manifestPath);

    const previousManifest = process.env[TEST_RUN_MANIFEST_ENV];
    const previousTelemetry = process.env[TEST_RUN_TELEMETRY_ENV];
    process.env[TEST_RUN_MANIFEST_ENV] = context.manifestPath;
    process.env[TEST_RUN_TELEMETRY_ENV] = context.telemetryPath!;
    try {
      const report = await auditContainment();
      const cleanReport = {
        ...report,
        ports: [],
        tempEntries: [],
        managedProcesses: [],
        discoveredProcesses: [],
        holds: [],
        telemetry: report.telemetry.filter((entry) => entry.runId === telemetry.runId),
      };
      expect(strictFailures(cleanReport, `manifest is missing: ${context.manifestPath}`)).not.toContain("manifest:");

      const unrelatedReport = {
        ...cleanReport,
        telemetry: cleanReport.telemetry.map((entry) => ({
          ...entry,
          manifestPath: "/tmp/ingenium-unrelated/run-manifest.json",
        })),
      };
      expect(strictFailures(unrelatedReport, `manifest is missing: ${context.manifestPath}`)).toContain(
        `manifest: manifest is missing: ${context.manifestPath}`,
      );
    } finally {
      if (previousManifest === undefined) delete process.env[TEST_RUN_MANIFEST_ENV];
      else process.env[TEST_RUN_MANIFEST_ENV] = previousManifest;
      if (previousTelemetry === undefined) delete process.env[TEST_RUN_TELEMETRY_ENV];
      else process.env[TEST_RUN_TELEMETRY_ENV] = previousTelemetry;
    }
  });

  it("keeps concurrent audits scoped to their own run telemetry", async () => {
    const first = createTestRunContext({
      applyEnvironment: false,
      ports: { api: 45361, dashboard: 45362, fixture: 45363 },
    });
    const second = createTestRunContext({
      applyEnvironment: false,
      ports: { api: 45364, dashboard: 45365, fixture: 45366 },
    });
    contexts.push(first, second);

    const [firstReport, secondReport] = await Promise.all([
      auditContainment({
        manifestPath: first.manifestPath,
        telemetryPaths: [first.telemetryPath!],
        includeRepositoryTelemetry: false,
      }),
      auditContainment({
        manifestPath: second.manifestPath,
        telemetryPaths: [second.telemetryPath!],
        includeRepositoryTelemetry: false,
      }),
    ]);

    expect(firstReport.telemetry.map(({ runId }) => runId)).toEqual([first.runId]);
    expect(secondReport.telemetry.map(({ runId }) => runId)).toEqual([second.runId]);
    expect(firstReport.managedPorts).not.toContain(second.ports.api);
    expect(secondReport.managedPorts).not.toContain(first.ports.api);
    expect(firstReport.tempEntries).toContain(first.runDir);
    expect(firstReport.tempEntries).not.toContain(second.runDir);
    expect(secondReport.tempEntries).toContain(second.runDir);
    expect(secondReport.tempEntries).not.toContain(first.runDir);
  });

  it("classifies retained legacy evidence as informational and never as missing telemetry", async () => {
    const legacyDirectory = join(getTestRunArtifactRoot(process.cwd()), `legacy-manual-capture-${randomUUID()}`);
    mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(join(legacyDirectory, "evidence.txt"), "retained legacy evidence\n");
    try {
      const report = await auditContainment({
        manifestPath: "",
        telemetryPaths: [],
        includeRepositoryTelemetry: false,
      });

      expect(report.legacyEvidence).toContain(legacyDirectory);
      expect(report.telemetryErrors.some((error) => error.includes(legacyDirectory))).toBe(false);
      expect(report.informational).toContain(`legacy evidence retained (non-runnable): ${legacyDirectory}`);
      expect(report.artifactClassifications).toContainEqual({
        path: legacyDirectory,
        classification: "legacy-test-run",
        disposition: "informational",
      });
      expect(strictFailures(report).some((failure) => failure.includes(legacyDirectory))).toBe(false);
    } finally {
      rmSync(legacyDirectory, { recursive: true, force: true });
    }
  });

  it("retains validated aged telemetry as inert history only after its process and ports are gone", async () => {
    const context = createContextWithReservedPortRetry({
      applyEnvironment: false,
      now: () => new Date("2020-01-01T00:00:00.000Z"),
    });
    contexts.push(context);
    updateTestRunManifest(context.manifestPath, {
      status: "stopping",
      processes: [{
        name: "api",
        pid: 2_147_483_647,
        port: context.ports.api,
        startedAt: "2020-01-01T00:00:00.000Z",
        runNonce: context.runNonce,
        pidStartTime: "1",
        pgid: 2_147_483_647,
        executable: "/usr/bin/node",
        groupIdentity: "2147483647:1",
      }],
    });
    const historicalTelemetry = JSON.parse(readFileSync(context.telemetryPath!, "utf8")) as {
      updatedAt: string;
      processes: Array<{ updatedAt: string }>;
    };
    historicalTelemetry.updatedAt = "2020-01-01T00:00:00.000Z";
    for (const process of historicalTelemetry.processes) process.updatedAt = historicalTelemetry.updatedAt;
    writeFileSync(context.telemetryPath!, JSON.stringify(historicalTelemetry));
    rmSync(context.manifestPath, { force: true });

    const report = await auditContainment({ includeRepositoryTelemetry: true });
    const entry = report.telemetry.find(({ runId }) => runId === context.runId);

    expect(entry).toMatchObject({
      manifestState: "missing",
      activeProcessCount: 1,
      evidenceDisposition: "historical-inert",
    });
    expect(report.informational).toContain(
      `validated inert historical telemetry retained (non-runnable): ${context.telemetryPath}`,
    );
    expect(strictFailures(report).some((failure) => failure.includes(context.telemetryPath!))).toBe(false);
  });

  it("inspects canonical historical temp roots when the current TMPDIR differs", async () => {
    if (process.platform === "win32" || !existsSync("/tmp") || !existsSync("/var/tmp")) return;
    const originalTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = "/tmp";
    resetTestRunContextForTests();
    const context = createContextWithReservedPortRetry({
      applyEnvironment: false,
      tempRoot: "/tmp",
      now: () => new Date("2020-01-01T00:00:00.000Z"),
    });
    contexts.push(context);
    rmSync(context.manifestPath, { force: true });

    try {
      process.env.TMPDIR = "/var/tmp";
      resetTestRunContextForTests();
      const report = await auditContainment({ includeRepositoryTelemetry: true });

      expect(report.telemetryErrors.some((error) => error.includes(context.telemetryPath!))).toBe(false);
      expect(report.telemetry.find(({ runId }) => runId === context.runId)).toMatchObject({
        manifestState: "missing",
        evidenceDisposition: "historical-inert",
      });
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpdir;
      resetTestRunContextForTests();
    }
  });

  it("reads retained telemetry from the retired repository temp root only during containment audit", async () => {
    const context = createContextWithReservedPortRetry({ applyEnvironment: false });
    contexts.push(context);
    updateTestRunManifest(context.manifestPath, { status: "stopping" });
    await recoverStoppingTestRun(context.manifestPath, { portTimeoutMs: 50 });
    cleanupTestRun(context.manifestPath);

    const telemetry = JSON.parse(readFileSync(context.telemetryPath!, "utf8")) as { manifestPath: string };
    telemetry.manifestPath = join(context.repoRoot, ".tmp", `ingenium-playwright-run-${context.runId}`, "run-manifest.json");
    writeFileSync(context.telemetryPath!, JSON.stringify(telemetry));

    expect(() => readTestRunTelemetry(context.telemetryPath!)).toThrow("outside the approved temp root");
    expect(readTestRunTelemetryForContainmentAudit(context.telemetryPath!)).toMatchObject({
      runId: context.runId,
      manifestPath: telemetry.manifestPath,
      status: "complete",
      resolution: { status: "resolved" },
    });
  });

  it("does not suppress fresh missing-manifest telemetry or malformed retained evidence", async () => {
    const repoRoot = temporaryRepository();
    const context = createContextWithReservedPortRetry({
      applyEnvironment: false,
      repoRoot,
    });
    contexts.push(context);
    rmSync(context.manifestPath, { force: true });
    const malformedDirectory = join(getTestRunArtifactRoot(repoRoot), randomUUID());
    const malformedTelemetryPath = join(malformedDirectory, "runner-telemetry.json");
    mkdirSync(malformedDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(malformedTelemetryPath, "not valid telemetry\n");
    vi.stubEnv("INGENIUM_PLAYWRIGHT_REPO_ROOT", repoRoot);
    try {
      const report = await auditContainment({ includeRepositoryTelemetry: true });
      const current = report.telemetry.find(({ runId }) => runId === context.runId);

      expect(current).toMatchObject({ manifestState: "missing", evidenceDisposition: "current" });
      expect(strictFailures(report).some((failure) => failure.includes(context.telemetryPath!))).toBe(true);
      expect(report.telemetryErrors.some((error) => error.includes(malformedTelemetryPath))).toBe(true);
      expect(strictFailures(report).some((failure) => failure.includes(malformedTelemetryPath))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      rmSync(malformedDirectory, { recursive: true, force: true });
    }
  });

  it("retains old unparseable telemetry without trusting it, but fails explicit scope and symlinks", async () => {
    const repoRoot = temporaryRepository();
    const directory = join(getTestRunArtifactRoot(repoRoot), randomUUID());
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "runner-telemetry.json");
    writeFileSync(path, "not valid telemetry\n", { mode: 0o600 });
    chmodSync(path, 0o670);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(path, old, old);
    vi.stubEnv("INGENIUM_PLAYWRIGHT_REPO_ROOT", repoRoot);
    try {
      const options = { includeRepositoryTelemetry: true, portProbe: async () => false };
      const report = await auditContainment(options);
      expect(report.telemetryErrors).toEqual([]);
      expect(report.telemetry).toEqual([]);
      expect(report.informational).toContain(
        `unparseable historical telemetry retained (untrusted, not ownership evidence): ${path}`,
      );
      const scoped = await auditContainment({ ...options, telemetryPaths: [path] });
      expect(scoped.telemetryErrors).toEqual([`${path}: Runner telemetry is not valid JSON`]);
      renameSync(path, join(directory, "original.json"));
      symlinkSync(join(directory, "original.json"), path);
      const unsafe = await auditContainment(options);
      expect(unsafe.telemetryErrors).toEqual([`${path}: Refusing to read symlinked runner telemetry`]);
      expect(readFileSync(path, "utf8")).toBe("not valid telemetry\n");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the strict fixture audit fail-closed for active unowned declared ports", async () => {
    const previousExpectedPorts = process.env.INGENIUM_AUDIT_EXPECT_PORTS;
    process.env.INGENIUM_AUDIT_EXPECT_PORTS = "3000";
    try {
      const report = await auditContainment({
        manifestPath: "",
        telemetryPaths: [],
        includeRepositoryTelemetry: false,
        composeOwnership: {
          classification: "unverified",
          hostPorts: [3000, 4097, 1455],
          reason: "rogue listener has no verified Compose owner",
        },
        portProbe: async (port) => port === 3000 || port === 4999,
      });

      expect(report.ports.find(({ port }) => port === 3000)).toMatchObject({
        listening: true,
        ownership: "unverified",
      });
      expect(report.ports.find(({ port }) => port === 4999)).toMatchObject({
        listening: true,
        ownership: "unowned",
      });
      const failures = strictFailures(report);
      expect(failures.some((failure) => failure.includes("listening ports:") && failure.includes("3000"))).toBe(true);
      expect(failures.some((failure) => failure.includes("listening ports:") && failure.includes("4999"))).toBe(true);
    } finally {
      if (previousExpectedPorts === undefined) delete process.env.INGENIUM_AUDIT_EXPECT_PORTS;
      else process.env.INGENIUM_AUDIT_EXPECT_PORTS = previousExpectedPorts;
    }
  });

  it("retains manifestless temporary evidence as informational instead of deleting or misclassifying it", async () => {
    const evidence = mkdtempSync(join(tmpdir(), `${TEST_RUN_TEMP_PREFIX}unowned-`));
    temporaryManifestlessEvidence.push(evidence);
    mkdirSync(join(evidence, ".ingenium"));

    const report = await auditContainment({
      manifestPath: "",
      telemetryPaths: [],
      includeRepositoryTelemetry: false,
    });

    expect(report.unownedTempEntries).toContain(evidence);
    expect(report.tempEntries).not.toContain(evidence);
    expect(report.informational).toContain(
      `manifestless temp evidence retained (unowned, not deleted): ${evidence}`,
    );
    expect(existsSync(evidence)).toBe(true);
  });

  describe.runIf(process.platform === "linux")("coordination trace residual scanner", () => {
    it("stops at a low entry cap and makes overflow fail strict containment", async () => {
      const rootPath = temporaryCoordinationTraceRoot();
      for (let index = 0; index < 3; index += 1) {
        writeFileSync(join(rootPath, `unmatched-${index}.txt`), "untouched\n");
      }

      const report = await auditContainment({
        manifestPath: "",
        telemetryPaths: [],
        includeRepositoryTelemetry: false,
        portProbe: async () => false,
        coordinationTraceScan: { rootPath, maxEntries: 2 },
      });

      expect(report.coordinationTraceScan).toMatchObject({
        inspectedEntries: 2,
        entryOverflow: true,
      });
      expect(strictFailures(report)).toContain("coordination trace scan: entry inspection limit exceeded");
    });

    it("caps retained matching names and residuals while making report overflow fail strict containment", async () => {
      const rootPath = temporaryCoordinationTraceRoot();
      for (let index = 0; index < 4; index += 1) {
        writeFileSync(join(rootPath, `coordination-audit-${randomUUID()}.json`), `untouched-${index}\n`);
      }

      const report = await auditContainment({
        manifestPath: "",
        telemetryPaths: [],
        includeRepositoryTelemetry: false,
        portProbe: async () => false,
        coordinationTraceScan: { rootPath, maxEntries: 8, maxMatches: 2 },
      });

      expect(report.coordinationTraceScan?.matchingNames).toHaveLength(2);
      expect(report.coordinationTraceScan?.residuals).toHaveLength(2);
      expect(report.coordinationTraceScan?.matchingOverflow).toBe(true);
      expect(strictFailures(report)).toContain("coordination trace scan: matching-name report limit exceeded");
    });

    it("caps retained scanner errors and makes error overflow fail strict containment", async () => {
      const rootPath = temporaryCoordinationTraceRoot();
      for (let index = 0; index < 3; index += 1) {
        mkdirSync(join(rootPath, `coordination-audit-${randomUUID()}.json`));
      }

      const report = await auditContainment({
        manifestPath: "",
        telemetryPaths: [],
        includeRepositoryTelemetry: false,
        portProbe: async () => false,
        coordinationTraceScan: { rootPath, maxEntries: 8, maxMatches: 8, maxErrors: 1 },
      });

      expect(report.coordinationTraceScan?.errors).toHaveLength(1);
      expect(report.coordinationTraceScan?.errorOverflow).toBe(true);
      expect(strictFailures(report)).toContain("coordination trace scan: error report limit exceeded");
    });

    it("keeps enumeration on the opened directory when the root is replaced", () => {
      const parent = temporaryCoordinationTraceRoot();
      const rootPath = join(parent, "opencode");
      const openedPath = join(parent, "opened-root");
      const replacementPath = join(parent, "replacement-root");
      const openedName = `coordination-audit-${randomUUID()}.json`;
      const replacementName = `coordination-audit-${randomUUID()}.json`;
      mkdirSync(rootPath, { mode: 0o700 });
      mkdirSync(replacementPath, { mode: 0o700 });
      writeFileSync(join(rootPath, openedName), "opened root\n", { mode: 0o600 });
      writeFileSync(join(replacementPath, replacementName), "replacement root\n", { mode: 0o600 });

      const scan = scanCoordinationTraceResiduals({
        rootPath,
        afterRootOpened: () => {
          renameSync(rootPath, openedPath);
          symlinkSync(replacementPath, rootPath);
        },
      });

      expect(scan.matchingNames).toContain(openedName);
      expect(scan.matchingNames).not.toContain(replacementName);
      expect(scan.rootChanged).toBe(true);
      expect(scan.errors).toContainEqual({ kind: "root-validation-failed" });
      expect(readFileSync(join(openedPath, openedName), "utf8")).toBe("opened root\n");
      expect(readFileSync(join(replacementPath, replacementName), "utf8")).toBe("replacement root\n");
    });

    it("rejects a symlink root and reports a matching symlink child without following it", () => {
      const parent = temporaryCoordinationTraceRoot();
      const targetRoot = join(parent, "target-root");
      const symlinkRoot = join(parent, "symlink-root");
      mkdirSync(targetRoot, { mode: 0o700 });
      symlinkSync(targetRoot, symlinkRoot);

      const unsafeRootScan = scanCoordinationTraceResiduals({ rootPath: symlinkRoot });
      expect(unsafeRootScan).toMatchObject({ rootUnsafe: true, rootPresent: false });
      expect(unsafeRootScan.errors).toEqual([{ kind: "root-open-failed" }]);

      const rootPath = join(parent, "real-root");
      const childName = `coordination-audit-${randomUUID()}.json`;
      mkdirSync(rootPath, { mode: 0o700 });
      symlinkSync(targetRoot, join(rootPath, childName));

      const childScan = scanCoordinationTraceResiduals({ rootPath });
      expect(childScan.residuals).toEqual([join(rootPath, childName)]);
      expect(childScan.errors).toEqual([]);
      expect(lstatSync(join(rootPath, childName)).isSymbolicLink()).toBe(true);
    });

    it("accepts matching regular files, ignores malformed names, and rejects a regular root", () => {
      const parent = temporaryCoordinationTraceRoot();
      const rootPath = join(parent, "real-root");
      const matchingName = `coordination-audit-${randomUUID()}.json`;
      const malformedName = `coordination-audit-${randomUUID().replaceAll("-", "")}.json`;
      mkdirSync(rootPath, { mode: 0o700 });
      writeFileSync(join(rootPath, matchingName), "matching\n", { mode: 0o600 });
      writeFileSync(join(rootPath, malformedName), "malformed\n", { mode: 0o600 });

      const scan = scanCoordinationTraceResiduals({ rootPath });
      expect(scan.residuals).toEqual([join(rootPath, matchingName)]);
      expect(scan.matchingNames).toEqual([matchingName]);

      chmodSync(rootPath, 0o755);
      const searchableRootScan = scanCoordinationTraceResiduals({ rootPath });
      expect(searchableRootScan.rootUnsafe).toBe(false);
      expect(searchableRootScan.residuals).toEqual([join(rootPath, matchingName)]);
      chmodSync(rootPath, 0o775);
      const permissiveRootScan = scanCoordinationTraceResiduals({ rootPath });
      expect(permissiveRootScan.rootUnsafe).toBe(true);
      expect(permissiveRootScan.errors).toEqual([{ kind: "root-metadata-invalid" }]);

      const regularRoot = join(parent, "regular-root");
      writeFileSync(regularRoot, "not a directory\n", { mode: 0o600 });
      const regularRootScan = scanCoordinationTraceResiduals({ rootPath: regularRoot });
      expect(regularRootScan.rootUnsafe).toBe(true);
      expect(regularRootScan.errors).toEqual([{ kind: "root-open-failed" }]);
    });

    it("closes the directory and descriptor on success, error, root replacement, and overflow", () => {
      for (const scenario of ["success", "error", "root-swap", "overflow"] as const) {
        const parent = temporaryCoordinationTraceRoot();
        const rootPath = join(parent, "opencode");
        const openedPath = join(parent, "opened-root");
        const replacementPath = join(parent, "replacement-root");
        mkdirSync(rootPath, { mode: 0o700 });
        if (scenario === "root-swap") mkdirSync(replacementPath, { mode: 0o700 });
        if (scenario === "overflow") {
          writeFileSync(join(rootPath, "first.txt"), "first\n");
          writeFileSync(join(rootPath, "second.txt"), "second\n");
        }
        let directory: Dir | undefined;
        let descriptor: number | undefined;

        const scan = scanCoordinationTraceResiduals({
          rootPath,
          ...(scenario === "overflow" ? { maxEntries: 1 } : {}),
          ...(scenario === "root-swap" ? {
            afterRootOpened: () => {
              renameSync(rootPath, openedPath);
              symlinkSync(replacementPath, rootPath);
            },
          } : {}),
          afterDirectoryOpened: (openedDirectory, openedDescriptor) => {
            directory = openedDirectory;
            descriptor = openedDescriptor;
            if (scenario === "error") throw new Error("sensitive scanner seam detail");
          },
        });

        expect(() => directory?.readSync(), scenario).toThrow();
        expect(() => fstatSync(descriptor!), scenario).toThrow(expect.objectContaining({ code: "EBADF" }));
        if (scenario === "success") expect(scan.errors).toEqual([]);
        if (scenario === "error") {
          expect(scan.errors).toEqual([{ kind: "scan-hook-failed" }]);
          expect(JSON.stringify(scan)).not.toContain("sensitive scanner seam detail");
        }
        if (scenario === "root-swap") expect(scan.rootChanged).toBe(true);
        if (scenario === "overflow") expect(scan.entryOverflow).toBe(true);
      }
    });
  });

  it("reports matching regular coordination trace files as untouched unowned temp evidence", async () => {
    const path = coordinationTraceEntry(`coordination-audit-${randomUUID()}.json`);
    writeFileSync(path, "coordination audit payload\n", { mode: 0o600 });

    const report = await auditContainment({
      manifestPath: "",
      telemetryPaths: [],
      includeRepositoryTelemetry: false,
    });

    expect(report.unownedTempEntries).toContain(path);
    expect(report.informational).toContain(
      `coordination trace residual retained as unowned temp (not read, followed, moved, or deleted): ${path}`,
    );
    expect(readFileSync(path, "utf8")).toBe("coordination audit payload\n");
  });

  it("reports matching coordination trace symlinks with lstat semantics without following them", async () => {
    const path = coordinationTraceEntry(`coordination-audit-${randomUUID()}.json`);
    symlinkSync(join(COORDINATION_TRACE_ROOT, `missing-${randomUUID()}.json`), path);

    const report = await auditContainment({
      manifestPath: "",
      telemetryPaths: [],
      includeRepositoryTelemetry: false,
    });

    expect(report.unownedTempEntries).toContain(path);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
  });

  it("ignores malformed and nonmatching coordination trace names", async () => {
    const malformed = coordinationTraceEntry(`coordination-audit-${randomUUID().replaceAll("-", "")}.json`);
    const nonmatching = coordinationTraceEntry(`coordination-audit-${randomUUID()}.txt`);
    writeFileSync(malformed, "malformed name\n", { mode: 0o600 });
    writeFileSync(nonmatching, "nonmatching name\n", { mode: 0o600 });

    const report = await auditContainment({
      manifestPath: "",
      telemetryPaths: [],
      includeRepositoryTelemetry: false,
    });

    expect(report.unownedTempEntries).not.toContain(malformed);
    expect(report.unownedTempEntries).not.toContain(nonmatching);
  });

  it("fails strict containment for matching coordination trace residuals", async () => {
    const path = coordinationTraceEntry(`coordination-audit-${randomUUID()}.json`);
    writeFileSync(path, "strict residual\n", { mode: 0o600 });

    const report = await auditContainment({
      manifestPath: "",
      telemetryPaths: [],
      includeRepositoryTelemetry: false,
    });

    expect(strictFailures(report).some((failure) => failure.startsWith("unowned temp residuals")
      && failure.includes(path))).toBe(true);
    expect(lstatSync(path).isFile()).toBe(true);
  });

  it("preserves unowned evidence in a historical temp root when TMPDIR changes", async () => {
    if (process.platform === "win32" || !existsSync("/tmp") || !existsSync("/var/tmp")) return;
    const originalTmpdir = process.env.TMPDIR;
    const evidence = mkdtempSync(join("/tmp", `${TEST_RUN_TEMP_PREFIX}unowned-historical-`));
    temporaryManifestlessEvidence.push(evidence);
    try {
      process.env.TMPDIR = "/var/tmp";
      resetTestRunContextForTests();
      const report = await auditContainment({
        manifestPath: "",
        telemetryPaths: [],
        includeRepositoryTelemetry: false,
      });

      expect(report.unownedTempEntries).toContain(evidence);
      expect(report.informational).toContain(
        `manifestless temp evidence retained (unowned, not deleted): ${evidence}`,
      );
      expect(existsSync(evidence)).toBe(true);
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpdir;
      resetTestRunContextForTests();
    }
  });

  it("removes only the exact symlink-free nested test-results residual after stable inventory proof", () => {
    const repository = temporaryRepository();
    const canonicalResults = join(repository, "tests", "test-results", "keep.txt");
    const misplaced = join(repository, "tests", "tests", "test-results");
    writeFileSync(canonicalResults, "keep");
    mkdirSync(join(misplaced, "case"), { recursive: true });
    writeFileSync(join(misplaced, "case", "test-failed-1.png"), "owned residual");

    const inspected = inspectOwnedMisplacedTestResults(repository);
    const removed = removeOwnedMisplacedTestResults(repository);

    expect(inspected?.inventory).toEqual([
      { relativePath: "case", type: "directory" },
      { relativePath: "case/test-failed-1.png", type: "file" },
    ]);
    expect(removed).toEqual(inspected);
    expect(existsSync(misplaced)).toBe(false);
    expect(readFileSync(canonicalResults, "utf8")).toBe("keep");
  });

  it("refuses to delete a nested test-results symlink and preserves its target evidence", () => {
    const repository = temporaryRepository();
    const nestedTests = join(repository, "tests", "tests");
    const externalEvidence = join(repository, "preserve-me");
    mkdirSync(nestedTests, { recursive: true });
    mkdirSync(externalEvidence);
    writeFileSync(join(externalEvidence, "evidence.txt"), "keep");
    symlinkSync(externalEvidence, join(nestedTests, "test-results"));

    expect(() => removeOwnedMisplacedTestResults(repository)).toThrow(/canonical owned directory/);
    expect(readFileSync(join(externalEvidence, "evidence.txt"), "utf8")).toBe("keep");
  });
});
