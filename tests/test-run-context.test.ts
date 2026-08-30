import { describe, expect, it, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  TEST_RUN_TEMP_PREFIX,
  TEST_RUN_CREATION_FAILURE_FILENAME,
  cleanupStaleTestRuns,
  cleanupTestRun,
  createTestRunContext,
  getApprovedTempRoot,
  getPlaywrightOutputDirectory,
  getTestRunDashboardWorkspace,
  getTestRunDashboardUrl,
  getTestRunArtifactRoot,
  getTestRunPortLockPath,
  getTestRunProjectName,
  markTestRunProcessCleared,
  releaseTestRunPortReservations,
  readTestRunTelemetry,
  readTestRunManifest,
  reserveTestRunPorts,
  resetTestRunContextForTests,
  transferTestRunPortOwnership,
  updateTestRunManifest,
} from "./test-run-context";
import { acquireTestRunArtifactWriterLock, releaseTestRunArtifactLock } from "./test-run-retention-lock";

const ownedRoots: string[] = [];
const telemetryRoots: string[] = [];

afterEach(() => {
  for (const root of ownedRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const root of telemetryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  resetTestRunContextForTests();
});

function testTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ingenium-run-context-test-"));
  ownedRoots.push(root);
  return root;
}

const portEnvironmentNames = [
  "INGENIUM_E2E_API_PORT",
  "INGENIUM_E2E_DASH_PORT",
  "INGENIUM_E2E_FIXTURE_PORT",
] as const;

function restorePortEnvironment(previous: Record<string, string | undefined>): void {
  for (const name of portEnvironmentNames) {
    const value = previous[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

describe("test-run context", () => {
  it("creates a durable run-owned manifest and an isolated high-port block", () => {
    const context = createTestRunContext({
      repoRoot: process.cwd(),
      tempRoot: testTempRoot(),
      now: () => new Date("2026-07-25T12:00:00.000Z"),
      ports: { api: 45101, dashboard: 45102, fixture: 45103 },
    });
    telemetryRoots.push(dirname(context.telemetryPath!));

    const manifest = readTestRunManifest(context.manifestPath);
    expect(manifest.createdAt).toBe("2026-07-25T12:00:00.000Z");
    expect(manifest.runDir.split("/").pop()).toMatch(new RegExp(`^${TEST_RUN_TEMP_PREFIX}`));
    expect(manifest.manifestPath).toBe(join(manifest.runDir, "run-manifest.json"));
    expect(manifest.dbPath).toBe(join(manifest.homeDir, "data.db"));
    expect(manifest.project).toBe(getTestRunProjectName(manifest.runId));
    expect(manifest.project).toBe(`playwright-test-${manifest.runId.slice(0, 8)}`);
    expect(new Set(Object.values(manifest.ports)).size).toBe(3);
    expect(manifest.portReservations).toHaveLength(3);
    expect(existsSync(getTestRunPortLockPath(manifest.ports.api))).toBe(true);
    expect(JSON.parse(readFileSync(manifest.manifestPath, "utf8")).runId).toBe(manifest.runId);
  });

  it("builds browser URLs with the manifest-owned project and no fallback", () => {
    const context = createTestRunContext({
      tempRoot: testTempRoot(),
      ports: { api: 45171, dashboard: 45172, fixture: 45173 },
    });
    telemetryRoots.push(dirname(context.telemetryPath!));

    const route = new URL(
      getTestRunDashboardUrl(context, "/pipeline?project=global-default&source=agent"),
    );
    expect(route.origin).toBe(`http://127.0.0.1:${context.ports.dashboard}`);
    expect(route.pathname).toBe("/pipeline");
    expect(route.searchParams.get("project")).toBe(context.project);
    expect(route.searchParams.get("source")).toBe("agent");
    expect(() => getTestRunDashboardUrl(context, "https://example.test/pipeline")).toThrow(/fixture origin/);
  });

  it("resolves Playwright output only below the canonical repository artifact root", () => {
    expect(getPlaywrightOutputDirectory("default", process.cwd())).toBe(
      join(process.cwd(), "tests", "artifacts", "playwright", "default"),
    );
    expect(() => getPlaywrightOutputDirectory("tests/test-results", process.cwd()))
      .toThrow(/single safe path component/);
    expect(() => getPlaywrightOutputDirectory("..", process.cwd()))
      .toThrow(/single safe path component/);
  });

  it("uses atomic run-owned reservations for concurrent runners", () => {
    const root = testTempRoot();
    const ports = { api: 45104, dashboard: 45105, fixture: 45106 };
    const owner = {
      runId: randomUUID(),
      runNonce: randomUUID(),
      repoRoot: process.cwd(),
      runDir: join(root, "owner-a"),
      ports,
    };
    const contender = { ...owner, runId: randomUUID(), runNonce: randomUUID(), runDir: join(root, "owner-b") };

    const reservations = reserveTestRunPorts(owner);
    expect(() => reserveTestRunPorts(contender)).toThrow(/already reserved/);

    releaseTestRunPortReservations({ ...owner, portReservations: reservations });
    expect(existsSync(getTestRunPortLockPath(ports.api))).toBe(false);
    const contenderReservations = reserveTestRunPorts(contender);
    expect(contenderReservations).toHaveLength(3);
    releaseTestRunPortReservations({ ...contender, portReservations: contenderReservations });
  });

  it("serializes reservations across truly simultaneous runner processes", async () => {
    const ports = { api: 45174, dashboard: 45175, fixture: 45176 };
    const processOwnerRoot = testTempRoot();
    const barrierRoot = testTempRoot();
    const startPath = join(barrierRoot, "start");
    const modulePath = join(process.cwd(), "tests", "test-run-context.ts");
    mkdirSync(join(processOwnerRoot, "owner-a"), { recursive: true });
    mkdirSync(join(processOwnerRoot, "owner-b"), { recursive: true });
    const makeScript = (owner: object, readyPath: string) => `(async () => {
       const fs = await import("node:fs");
       const loaded = await import(${JSON.stringify(modulePath)});
       const context = loaded.default ?? loaded;
       const owner = ${JSON.stringify(owner)};
       fs.writeFileSync(${JSON.stringify(readyPath)}, "ready");
       const deadline = Date.now() + 5000;
       while (!fs.existsSync(${JSON.stringify(startPath)})) {
         if (Date.now() > deadline) throw new Error("reservation barrier timed out");
         await new Promise((resolve) => setTimeout(resolve, 10));
       }
       try {
         const reservations = context.reserveTestRunPorts(owner);
         process.stdout.write("acquired\\n");
         await new Promise((resolve) => setTimeout(resolve, 750));
         context.releaseTestRunPortReservations({ ...owner, portReservations: reservations });
         process.exit(0);
       } catch (error) {
          process.stdout.write(error instanceof Error && /already reserved/.test(error.message) ? "blocked\\n" : "error:" + String(error) + "\\n");
         process.exit(2);
       }
     })().catch((error) => { process.stderr.write(String(error)); process.exit(3); });`;
    const owners = [
      {
        runId: randomUUID(),
        runNonce: randomUUID(),
        repoRoot: process.cwd(),
        runDir: join(processOwnerRoot, "owner-a"),
        ports,
      },
      {
        runId: randomUUID(),
        runNonce: randomUUID(),
        repoRoot: process.cwd(),
        runDir: join(processOwnerRoot, "owner-b"),
        ports,
      },
    ];
    const childEnvironment = {
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
    };
    const children = owners.map((owner, index) => spawn(
      process.execPath,
      ["--import", "tsx", "--eval", makeScript(owner, join(barrierRoot, `ready-${index}`))],
      { cwd: process.cwd(), env: childEnvironment, stdio: ["ignore", "pipe", "pipe"] },
    ));
    const results = children.map((child) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk) => { output += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    }));

    try {
      const deadline = Date.now() + 5000;
      while (!owners.every((_owner, index) => existsSync(join(barrierRoot, `ready-${index}`)))) {
        if (Date.now() > deadline) throw new Error("parent reservation barrier timed out");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      writeFileSync(startPath, "go");

      const settled = await Promise.all(results);
      expect(
        settled.map(({ code, output }) => `${code}:${output.includes("acquired") ? "acquired" : output.includes("blocked") ? "blocked" : "other"}`).sort(),
        JSON.stringify(settled),
      )
        .toEqual(["0:acquired", "2:blocked"]);
    } finally {
      writeFileSync(startPath, "go");
      for (const child of children) {
        if (!child.killed && child.exitCode === null) child.kill("SIGTERM");
      }
      await Promise.allSettled(results);
    }
  });

  it("releases each reservation only after explicit child ownership transfer", () => {
    const context = createTestRunContext({ tempRoot: testTempRoot(), ports: { api: 45107, dashboard: 45108, fixture: 45109 } });
    telemetryRoots.push(dirname(context.telemetryPath!));

    transferTestRunPortOwnership(context.manifestPath, context.ports.api);

    const manifest = readTestRunManifest(context.manifestPath);
    expect(manifest.portReservations?.find(({ port }) => port === context.ports.api)?.state).toBe("transferred");
    expect(existsSync(getTestRunPortLockPath(context.ports.api))).toBe(false);
    expect(existsSync(getTestRunPortLockPath(context.ports.dashboard))).toBe(true);
  });

  it("serializes canonical manifest and telemetry writers with retention", () => {
    const context = createTestRunContext({
      tempRoot: testTempRoot(),
      ports: { api: 45177, dashboard: 45178, fixture: 45179 },
    });
    telemetryRoots.push(dirname(context.telemetryPath!));
    const lock = acquireTestRunArtifactWriterLock({
      artifactRoot: getTestRunArtifactRoot(context.repoRoot),
      repoRoot: context.repoRoot,
      runId: context.runId,
      runNonce: context.runNonce,
    });
    try {
      expect(() => updateTestRunManifest(context.manifestPath, { status: "starting" }))
        .toThrow(/RUN_ARTIFACT_LOCKED/);
      expect(readTestRunManifest(context.manifestPath).status).toBe("created");
    } finally {
      releaseTestRunArtifactLock(lock);
    }
    expect(updateTestRunManifest(context.manifestPath, { status: "created" }).status).toBe("created");
  });

  it("removes only the exact manifest-owned run directory", () => {
    const root = testTempRoot();
    const context = createTestRunContext({ tempRoot: root, ports: { api: 45111, dashboard: 45112, fixture: 45113 } });
    telemetryRoots.push(dirname(context.telemetryPath!));
    const sibling = join(root, "do-not-delete.txt");
    writeFileSync(sibling, "keep me");
    const dashboardWorkspace = getTestRunDashboardWorkspace(context);
    mkdirSync(dashboardWorkspace, { recursive: true });
    writeFileSync(join(dashboardWorkspace, "BUILD_ID"), context.runId);

    cleanupTestRun(context.manifestPath);

    expect(() => readTestRunManifest(context.manifestPath)).toThrow();
    expect(existsSync(dashboardWorkspace)).toBe(false);
    expect(existsSync(getTestRunPortLockPath(context.ports.api))).toBe(false);
    expect(readFileSync(sibling, "utf8")).toBe("keep me");
  });

  it("resolves created telemetry before deleting its manifest", () => {
    const context = createTestRunContext({ tempRoot: testTempRoot(), ports: { api: 45116, dashboard: 45117, fixture: 45118 } });
    telemetryRoots.push(dirname(context.telemetryPath!));

    cleanupTestRun(context.manifestPath);

    const telemetry = readTestRunTelemetry(context.telemetryPath!);
    expect(telemetry.status).toBe("complete");
    expect(telemetry.activeProcesses).toEqual([]);
    expect(telemetry.resolution?.status).toBe("resolved");
    expect(() => readTestRunManifest(context.manifestPath)).toThrow();
  });

  it("refuses to resolve created telemetry with a mismatched run identity", () => {
    const context = createTestRunContext({ tempRoot: testTempRoot(), ports: { api: 45119, dashboard: 45120, fixture: 45124 } });
    telemetryRoots.push(dirname(context.telemetryPath!));
    const telemetry = JSON.parse(readFileSync(context.telemetryPath!, "utf8")) as { runId: string };
    telemetry.runId = randomUUID();
    writeFileSync(context.telemetryPath!, JSON.stringify(telemetry));

    expect(() => cleanupTestRun(context.manifestPath)).toThrow(/unresolved telemetry/);
    expect(() => readTestRunManifest(context.manifestPath)).not.toThrow();
  });

  it("fails closed when a manifest points outside its run directory", () => {
    const root = testTempRoot();
    const context = createTestRunContext({ tempRoot: root, ports: { api: 45121, dashboard: 45122, fixture: 45123 } });
    telemetryRoots.push(dirname(context.telemetryPath!));
    const manifest = readTestRunManifest(context.manifestPath);
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "keep me");
    writeFileSync(context.manifestPath, JSON.stringify({ ...manifest, dbPath: outside }));

    expect(() => cleanupTestRun(context.manifestPath)).toThrow(/unexpected test-run data paths|unowned path/);
    expect(readFileSync(outside, "utf8")).toBe("keep me");
    expect(() => readTestRunManifest(context.manifestPath)).toThrow(/unexpected test-run data paths|unowned path/);
  });

  it("rejects a shared project identity instead of allowing a fixture fallback", () => {
    const context = createTestRunContext({ tempRoot: testTempRoot(), ports: { api: 45125, dashboard: 45126, fixture: 45127 } });
    telemetryRoots.push(dirname(context.telemetryPath!));
    const original = readFileSync(context.manifestPath, "utf8");

    try {
      writeFileSync(context.manifestPath, JSON.stringify({ ...JSON.parse(original), project: "global-default" }));
      expect(() => readTestRunManifest(context.manifestPath)).toThrow(/not run-owned/);
    } finally {
      writeFileSync(context.manifestPath, original);
    }
  });

  it("rejects a relocated run directory even when its name has the safe prefix", () => {
    const root = testTempRoot();
    const context = createTestRunContext({ tempRoot: root, ports: { api: 45131, dashboard: 45132, fixture: 45133 } });
    telemetryRoots.push(dirname(context.telemetryPath!));
    const manifest = readTestRunManifest(context.manifestPath);
    const relocated = join(tmpdir(), `${TEST_RUN_TEMP_PREFIX}not-owned`);
    rmSync(relocated, { recursive: true, force: true });

    // The manifest still lives in the original run, but the recorded directory
    // is no longer its real parent. Cleanup must refuse rather than follow it.
    writeFileSync(context.manifestPath, JSON.stringify({ ...manifest, runDir: relocated }));
    expect(() => cleanupTestRun(context.manifestPath)).toThrow();
  });

  it("rejects a temp root outside the canonical approved OS temp root", () => {
    expect(getApprovedTempRoot()).toBeTruthy();
    expect(() => createTestRunContext({ tempRoot: "/home/attacker/ingenium-playwright" })).toThrow(/approved root/);
  });

  it("rejects invalid requested ports before allocating any run-owned artifacts", () => {
    const root = testTempRoot();
    expect(readdirSync(root)).toEqual([]);

    expect(() => createTestRunContext({
      tempRoot: root,
      ports: { api: 45181, dashboard: 45181, fixture: 45183 },
    })).toThrow(/distinct ports/);

    // A run directory would contain the manifest and the home/database path;
    // no directory means the failed validation owned no run artifacts.
    expect(readdirSync(root)).toEqual([]);
  });

  it("rejects a development port before allocating manifest or telemetry artifacts", () => {
    const root = testTempRoot();
    expect(readdirSync(root)).toEqual([]);

    expect(() => createTestRunContext({
      tempRoot: root,
      ports: { api: 3000, dashboard: 45184, fixture: 45185 },
    })).toThrow(/development or Docker port/);

    expect(readdirSync(root)).toEqual([]);
  });

  it.each([
    ["not-a-port", "malformed"],
    ["45181.5", "decimal"],
    [" 45181 ", "whitespace-padded"],
    ["1023", "below-range"],
    ["65536", "above-range"],
    ["999999999999999999999999", "unsafe integer"],
    ["", "empty"],
  ])("rejects %s port environment values before allocation (%s)", (value) => {
    const root = testTempRoot();
    const previous = Object.fromEntries(portEnvironmentNames.map((name) => [name, process.env[name]]));
    process.env.INGENIUM_E2E_API_PORT = value;
    try {
      expect(() => createTestRunContext({
        tempRoot: root,
        ports: { api: 45186, dashboard: 45187, fixture: 45188 },
      })).toThrow(/INGENIUM_E2E_API_PORT must be an integer between 1024 and 65535/);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      restorePortEnvironment(previous);
    }
  });

  it("rolls back an allocated run directory after a filesystem bootstrap failure and retains a safe diagnostic", () => {
    const root = testTempRoot();
    const telemetryRoot = getTestRunArtifactRoot(process.cwd());
    let allocatedRunDir = "";

    expect(() => createTestRunContext({
      tempRoot: root,
      ports: { api: 45191, dashboard: 45192, fixture: 45193 },
      afterRunDirectoryCreated: (runDir) => {
        allocatedRunDir = runDir;
        chmodSync(runDir, 0o500);
      },
    })).toThrow(/home directory|EACCES|permission denied/i);

    expect(readdirSync(root)).toEqual([]);
    const diagnosticDirectories = existsSync(telemetryRoot)
      ? readdirSync(telemetryRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(telemetryRoot, entry.name))
        .filter((directory) => {
          const path = join(directory, TEST_RUN_CREATION_FAILURE_FILENAME);
          if (!existsSync(path)) return false;
          try {
            const diagnostic = JSON.parse(readFileSync(path, "utf8")) as { runDir?: string; error?: string };
            return diagnostic.runDir === allocatedRunDir
              && /home directory|EACCES|permission denied/i.test(diagnostic.error ?? "");
          } catch {
            return false;
          }
        })
      : [];
    expect(diagnosticDirectories.length).toBeGreaterThan(0);
    const diagnosticDirectory = diagnosticDirectories[0]!;
    const diagnostic = JSON.parse(readFileSync(join(diagnosticDirectory, TEST_RUN_CREATION_FAILURE_FILENAME), "utf8")) as {
      version: number;
      error: string;
      cleanup: string;
    };
    expect(diagnostic).toMatchObject({ version: 1, cleanup: "removed" });
    expect(diagnostic.error).toMatch(/home directory|EACCES|permission denied/i);
    telemetryRoots.push(diagnosticDirectory);
  });

  it("retains diagnostics without deleting a replacement at the allocated path", () => {
    const root = testTempRoot();
    const telemetryRoot = getTestRunArtifactRoot(process.cwd());
    let movedRunDir = "";
    let replacedRunDir = "";

    expect(() => createTestRunContext({
      tempRoot: root,
      ports: { api: 45196, dashboard: 45197, fixture: 45198 },
      afterRunDirectoryCreated: (runDir) => {
        movedRunDir = `${runDir}-moved`;
        replacedRunDir = runDir;
        renameSync(runDir, movedRunDir);
        mkdirSync(runDir);
      },
    })).toThrow(/relocated allocated test-run directory/);

    expect(existsSync(movedRunDir)).toBe(true);
    expect(existsSync(replacedRunDir)).toBe(true);
    const diagnosticDirectories = existsSync(telemetryRoot)
      ? readdirSync(telemetryRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(telemetryRoot, entry.name))
        .filter((directory) => {
          const path = join(directory, TEST_RUN_CREATION_FAILURE_FILENAME);
          if (!existsSync(path)) return false;
          try {
            const diagnostic = JSON.parse(readFileSync(path, "utf8")) as { runDir?: string; cleanupError?: string };
            return diagnostic.runDir === replacedRunDir
              && /relocated allocated test-run directory/i.test(diagnostic.cleanupError ?? "");
          } catch {
            return false;
          }
        })
      : [];
    expect(diagnosticDirectories.length).toBeGreaterThan(0);
    const diagnosticDirectory = diagnosticDirectories[0]!;
    const diagnostic = JSON.parse(readFileSync(join(diagnosticDirectory, TEST_RUN_CREATION_FAILURE_FILENAME), "utf8")) as {
      cleanup: string;
      cleanupError?: string;
    };
    expect(diagnostic.cleanup).toBe("retained");
    expect(diagnostic.cleanupError).toMatch(/relocated allocated test-run directory/);
    telemetryRoots.push(diagnosticDirectory);
  });

  it("cleans only old, empty, schema-valid owned manifests", () => {
    const root = testTempRoot();
    const context = createTestRunContext({
      tempRoot: root,
      now: () => new Date("2020-01-01T00:00:00.000Z"),
      ports: { api: 45141, dashboard: 45142, fixture: 45143 },
    });
    telemetryRoots.push(dirname(context.telemetryPath!));
    const unowned = join(root, `${TEST_RUN_TEMP_PREFIX}unowned`);
    const missingManifest = join(root, `${TEST_RUN_TEMP_PREFIX}missing-manifest`);
    writeFileSync(join(root, "keep.txt"), "keep");
    mkdirSync(unowned, { recursive: true });
    mkdirSync(missingManifest, { recursive: true });

    const result = cleanupStaleTestRuns({ root, now: Date.parse("2026-01-01T00:00:00.000Z"), staleAfterMs: 0 });

    expect(result.cleaned).toEqual([context.runDir]);
    expect(() => readTestRunManifest(context.manifestPath)).toThrow();
    expect(() => readFileSync(join(unowned, "run-manifest.json"))).toThrow();
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("keep");
    expect(result.skipped.some(({ path }) => path === missingManifest)).toBe(true);
  });

  it("rejects a temp root whose parent is a symlink", () => {
    const root = testTempRoot();
    const real = join(root, "real-temp");
    const linked = join(root, "linked-temp");
    mkdirSync(real);
    symlinkSync(real, linked);

    expect(() => createTestRunContext({ tempRoot: linked })).toThrow(/symlinked temp root|symlinked ancestor/);
  });

  it("rejects malformed telemetry instead of accepting a partial shape", () => {
    const context = createTestRunContext({ tempRoot: testTempRoot(), ports: { api: 45151, dashboard: 45152, fixture: 45153 } });
    telemetryRoots.push(dirname(context.telemetryPath!));
    writeFileSync(context.telemetryPath!, JSON.stringify({ version: 1, runId: context.runId }));

    expect(() => readTestRunTelemetry(context.telemetryPath!)).toThrow(/telemetry|Invalid/);
  });

  it("keeps cleared process history but removes it from the active telemetry index", () => {
    const context = createTestRunContext({ tempRoot: testTempRoot(), ports: { api: 45161, dashboard: 45162, fixture: 45163 } });
    telemetryRoots.push(dirname(context.telemetryPath!));
    const identity = {
      pidStartTime: "1",
      pgid: 2,
      executable: "/usr/bin/node",
      groupIdentity: "2:3",
    };
    const record = {
      name: "api" as const,
      pid: 2,
      port: context.ports.api,
      startedAt: new Date().toISOString(),
      runNonce: context.runNonce,
      ...identity,
    };
    updateTestRunManifest(context.manifestPath, { status: "running", processes: [record] });
    markTestRunProcessCleared(context.manifestPath, record);
    updateTestRunManifest(context.manifestPath, { status: "complete", processes: [] });

    const telemetry = readTestRunTelemetry(context.telemetryPath!);
    expect(telemetry.activeProcesses).toEqual([]);
    expect(telemetry.processes).toHaveLength(1);
    expect(telemetry.processes[0]?.state).toBe("cleared");
  });

  it("persists a safe provisional process until identity binding completes", () => {
    const context = createTestRunContext({ tempRoot: testTempRoot(), ports: { api: 45171, dashboard: 45172, fixture: 45173 } });
    telemetryRoots.push(dirname(context.telemetryPath!));
    const provisional = {
      name: "api" as const,
      pid: 2001,
      port: context.ports.api,
      startedAt: new Date().toISOString(),
      runNonce: context.runNonce,
      pidStartTime: "pending",
      pgid: 0,
      executable: "",
      groupIdentity: "pending",
      identityState: "provisional" as const,
    };

    updateTestRunManifest(context.manifestPath, { status: "starting", processes: [provisional] });

    const manifest = readTestRunManifest(context.manifestPath);
    const telemetry = readTestRunTelemetry(context.telemetryPath!);
    expect(manifest.processes[0]).toMatchObject({ identityState: "provisional", pid: provisional.pid });
    expect(telemetry.activeProcesses[0]).toMatchObject({ identityState: "provisional", pid: provisional.pid });

    const bound = {
      ...provisional,
      pidStartTime: "42",
      pgid: provisional.pid,
      executable: "/usr/bin/node",
      groupIdentity: `${provisional.pid}:43`,
      identityState: "bound" as const,
    };
    updateTestRunManifest(context.manifestPath, { processes: [bound] });
    const reboundTelemetry = readTestRunTelemetry(context.telemetryPath!);
    expect(reboundTelemetry.processes[0]?.record).toMatchObject({ identityState: "bound", pidStartTime: "42" });

    markTestRunProcessCleared(context.manifestPath, provisional);
    updateTestRunManifest(context.manifestPath, { status: "created", processes: [] });
  });
});
