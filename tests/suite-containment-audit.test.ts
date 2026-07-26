import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  TEST_RUN_MANIFEST_ENV,
  TEST_RUN_TELEMETRY_ENV,
  createTestRunContext,
  cleanupTestRun,
  getTestRunArtifactRoot,
  readTestRunTelemetry,
  releaseTestRunPortReservations,
  resetTestRunContextForTests,
  updateTestRunManifest,
} from "./test-run-context";
import { recoverStoppingTestRun } from "./test-server-lifecycle";
import { auditSuiteContainment, strictFailures } from "./suite-containment-audit";

const contexts: Array<ReturnType<typeof createTestRunContext>> = [];
const servers: Server[] = [];

afterEach(async () => {
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
  resetTestRunContextForTests();
});

describe("suite containment audit", () => {
  it("detects a leaked manifest-owned dynamic port from persisted telemetry", async () => {
    const context = createTestRunContext({ ports: { api: 45301, dashboard: 45302, fixture: 45303 } });
    contexts.push(context);
    const server = createServer((_request, response) => response.end("leaked"));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(context.ports.api, "127.0.0.1", resolve));

    cleanupTestRun(context.manifestPath);
    const report = await auditSuiteContainment({ includeRepositoryTelemetry: true });

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
      const report = await auditSuiteContainment();
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
      const report = await auditSuiteContainment();
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

    for (const [index, status] of statuses.entries()) {
      const context = createTestRunContext({
        ports: { api: 45331 + index * 3, dashboard: 45332 + index * 3, fixture: 45333 + index * 3 },
      });
      contexts.push(context);
      updateTestRunManifest(context.manifestPath, { status });
      rmSync(context.manifestPath, { force: true });
      missingManifestPaths.push(context.manifestPath);
      telemetryPaths.push(context.telemetryPath!);
    }

    const report = await auditSuiteContainment({ telemetryPaths });
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

      const report = await auditSuiteContainment();
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
      const report = await auditSuiteContainment();
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
      const report = await auditSuiteContainment();
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
      auditSuiteContainment({
        manifestPath: first.manifestPath,
        telemetryPaths: [first.telemetryPath!],
        includeRepositoryTelemetry: false,
      }),
      auditSuiteContainment({
        manifestPath: second.manifestPath,
        telemetryPaths: [second.telemetryPath!],
        includeRepositoryTelemetry: false,
      }),
    ]);

    expect(firstReport.telemetry.map(({ runId }) => runId)).toEqual([first.runId]);
    expect(secondReport.telemetry.map(({ runId }) => runId)).toEqual([second.runId]);
    expect(firstReport.managedPorts).not.toContain(second.ports.api);
    expect(secondReport.managedPorts).not.toContain(first.ports.api);
  });

  it("classifies retained legacy evidence as informational and never as missing telemetry", async () => {
    const legacyDirectory = join(getTestRunArtifactRoot(process.cwd()), `legacy-phase-5aa-${randomUUID()}`);
    mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(join(legacyDirectory, "evidence.txt"), "retained legacy evidence\n");
    try {
      const report = await auditSuiteContainment({
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
});
