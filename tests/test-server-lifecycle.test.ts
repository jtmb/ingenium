import { describe, expect, it, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  TEST_RUN_MANIFEST_ENV,
  TEST_RUN_TELEMETRY_ENV,
  TEST_RUN_NONCE_ENV,
  TEST_RUN_TEMP_PREFIX,
  cleanupTestRun,
  createTestRunContext,
  getTestRunArtifactRoot,
  getTestRunApiTokenPath,
  getTestRunDashboardWorkspace,
  readTestRunManifest,
  readTestRunTelemetry,
  resetTestRunContextForTests,
  releaseTestRunPortReservations,
  type TestRunProcess,
  updateTestRunManifest,
} from "./test-run-context";
import globalTeardown from "./playwright-global-teardown";
import {
  TEST_API_TOKEN,
  FIXTURE_INTERNAL_SERVICE_HEADER,
  FIXTURE_API_RATE_LIMIT,
  FIXTURE_OWNER_EMAIL,
  FIXTURE_OWNER_PASSWORD,
  buildProductionArtifacts,
  captureSpawnedChildPgid,
  getServerSpecs,
  installRunSignalHandlers,
  inspectProcessIdentity,
  provisionTestRunProject,
  createTestRunBrowserStorageState,
  provisionTestRunBrowserSession,
  provisionTestRunOwner,
  recoverStoppingTestRun,
  startTestServers,
  stopRunFromManifest,
  terminateChildProcessHandle,
  validateProcessIdentity,
  waitForPortClosed,
  waitForReady,
} from "./test-server-lifecycle";
import {
  FIXTURE_PROJECT_HEADER,
  FIXTURE_RUN_NONCE_HEADER,
  directApiAuthHeaders,
} from "./fixture-api-auth";
import { getDashboardFixtureEnvironment, getDashboardStorageStatePath } from "./ingenium-dashboard/fixture-credentials";

const manifests: string[] = [];
const telemetryRoots: string[] = [];
const runDirectories: string[] = [];

function track(context: ReturnType<typeof createTestRunContext>): void {
  manifests.push(context.manifestPath);
  telemetryRoots.push(dirname(context.telemetryPath!));
  runDirectories.push(context.runDir);
}

async function waitForProcessGoneOrZombie(pid: number, timeoutMs = 1_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const closingParen = stat.lastIndexOf(")");
      const state = closingParen >= 0 ? stat.slice(closingParen + 1).trim().split(/\s+/)[0] : undefined;
      if (state === "Z") return true;
      process.kill(pid, 0);
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const manifest of manifests.splice(0)) cleanupTestRun(manifest);
  for (const root of telemetryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const directory of runDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  resetTestRunContextForTests();
});

describe("test server lifecycle contracts", () => {
  it("provisions the manifest-owned project idempotently through the fixture API", async () => {
    const context = createTestRunContext({ ports: { api: 45190, dashboard: 45191, fixture: 45192 } });
    track(context);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { name: context.project } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { name: context.project } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await provisionTestRunProject(context);
    const firstManifest = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
    expect(firstManifest.project).toBe(context.project);
    expect(firstManifest.projectProvisionedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await provisionTestRunProject(context);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, request] of fetchMock.mock.calls) {
      expect(url).toBe(`http://127.0.0.1:${context.ports.api}/api/v1/auth/fixture-bootstrap`);
      expect(request).toMatchObject({
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_API_TOKEN}`,
          [FIXTURE_INTERNAL_SERVICE_HEADER]: "1",
          [FIXTURE_RUN_NONCE_HEADER]: context.runNonce,
          [FIXTURE_PROJECT_HEADER]: context.project,
        },
      });
      expect(request.body).toBeUndefined();
    }
  });

  it("does not mark a fixture project as provisioned when the API rejects it", async () => {
    const context = createTestRunContext({ ports: { api: 45193, dashboard: 45194, fixture: 45195 } });
    track(context);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("failure", { status: 500 })));

    await expect(provisionTestRunProject(context)).rejects.toThrow(/API returned 500/);

    const manifest = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
    expect(manifest.projectProvisionedAt).toBeUndefined();
  });

  it("claims an isolated owner and creates a fresh browser session", async () => {
    const context = createTestRunContext({ ports: { api: 45196, dashboard: 45197, fixture: 45198 } });
    track(context);
    const sessionToken = "s".repeat(43);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 201 }))
      .mockResolvedValueOnce(new Response("{}", {
        status: 200,
        headers: { "Set-Cookie": `__Host-ingenium_session=${sessionToken}; Path=/; Secure; HttpOnly` },
      }))
      .mockResolvedValueOnce(new Response("{}", {
        status: 200,
        headers: { "Set-Cookie": `__Host-ingenium_session=${"t".repeat(43)}; Path=/; Secure; HttpOnly` },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await provisionTestRunOwner(context);
    const storageState = await createTestRunBrowserStorageState(context);
    const renewedStorageState = await createTestRunBrowserStorageState(context);

    expect(storageState.cookies).toEqual([expect.objectContaining({
      name: "__Host-ingenium_session",
      value: sessionToken,
      secure: true,
      httpOnly: true,
    })]);
    expect(storageState.origins).toEqual([
      {
        origin: `http://127.0.0.1:${context.ports.dashboard}`,
        localStorage: [{ name: "ingenium_global_project", value: context.project }],
      },
      {
        origin: `http://localhost:${context.ports.dashboard}`,
        localStorage: [{ name: "ingenium_global_project", value: context.project }],
      },
    ]);
    expect(renewedStorageState.cookies).toEqual([
      expect.objectContaining({ value: "t".repeat(43) }),
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_TOKEN}`,
        [FIXTURE_INTERNAL_SERVICE_HEADER]: "1",
        [FIXTURE_RUN_NONCE_HEADER]: context.runNonce,
        [FIXTURE_PROJECT_HEADER]: context.project,
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: FIXTURE_OWNER_EMAIL,
      displayName: "Playwright Owner",
      password: FIXTURE_OWNER_PASSWORD,
    });
    expect(fetchMock.mock.calls[1]).toEqual([
      `http://127.0.0.1:${context.ports.api}/api/v1/auth/fixture-session`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          [FIXTURE_RUN_NONCE_HEADER]: context.runNonce,
          [FIXTURE_PROJECT_HEADER]: context.project,
        }),
      }),
    ]);
  });

  it("persists the fixture browser session inside the run directory", async () => {
    const context = createTestRunContext({ ports: { api: 45199, dashboard: 45200, fixture: 45210 } });
    track(context);
    const sessionToken = "s".repeat(43);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", {
        status: 200,
        headers: { "Set-Cookie": `__Host-ingenium_session=${sessionToken}; Path=/; Secure; HttpOnly` },
      })));

    expect(await provisionTestRunBrowserSession(context)).toBe(getDashboardStorageStatePath(context));
    expect(readFileSync(getDashboardStorageStatePath(context), "utf8")).toContain(sessionToken);
  });

  it("uses production dashboard startup and explicitly isolates all services", () => {
    const context = createTestRunContext({ ports: { api: 45201, dashboard: 45202, fixture: 45203 } });
    track(context);
    const dashboardEnvironment = getDashboardFixtureEnvironment(context, TEST_API_TOKEN);
    const specs = getServerSpecs(context, true, dashboardEnvironment);

    expect(specs.map((spec) => spec.port)).toEqual([45201, 45202, 45203]);
    expect(specs[1]!.args[0]).toBe("start");
    expect(specs[1]!.cwd).toBe(getTestRunDashboardWorkspace(context));
    expect(specs[1]!.args).not.toContain("dev");
    expect(specs[2]!.env.CHAT_FIXTURE_PORT).toBe("45203");
    expect(specs[0]!.env.INGENIUM_API_TOKEN).toBe(TEST_API_TOKEN);
    expect(specs[1]!.env.INGENIUM_API_TOKEN).toBeUndefined();
    expect(specs[1]!.env.INGENIUM_API_TEST_MODE).toBe("1");
    expect(specs[1]!.env.INGENIUM_API_TOKEN_FILE).toBe(getTestRunApiTokenPath(context));
    expect(specs[0]!.env.INGENIUM_API_TEST_MODE).toBe("1");
    expect(specs[0]!.env.INGENIUM_API_DISABLE_BACKGROUND_SCHEDULERS).toBe("1");
    expect(specs[0]!.env.INGENIUM_API_DISABLE_SCHEDULERS).toBe("1");
    expect(specs[0]!.env.INGENIUM_API_DISABLE_MAIL_MAINTENANCE).toBe("1");
    expect(specs[0]!.env.INGENIUM_API_DISABLE_MAIL).toBe("1");
    expect(specs[0]!.env.INGENIUM_API_RATE_LIMIT).toBe(String(FIXTURE_API_RATE_LIMIT));
    expect(specs[0]!.env.DASHBOARD_ALLOWED_ORIGINS).toBe(
      "http://127.0.0.1:45202,http://localhost:45202",
    );
    expect(specs[0]!.env.INGENIUM_TEST_RUN_NONCE).toBe(context.runNonce);
    for (const spec of specs) {
      expect(spec.env.INGENIUM_PROJECT).toBe(context.project);
      expect(spec.env.INGENIUM_PROJECT).not.toBe("global-default");
    }
    expect(specs[1]!.readinessHeaders).toBeUndefined();
    expect(specs[2]!.readinessHeaders).toBeUndefined();
    expect(specs[0]!.readinessHeaders?.Authorization).toBe(`Bearer ${TEST_API_TOKEN}`);
    expect(specs[0]!.readinessHeaders?.[FIXTURE_INTERNAL_SERVICE_HEADER]).toBe("1");
    expect(specs[0]!.readinessHeaders?.[FIXTURE_RUN_NONCE_HEADER]).toBe(context.runNonce);
    expect(specs[0]!.readinessHeaders?.[FIXTURE_PROJECT_HEADER]).toBe(context.project);
    expect(specs[1]!.env.SOME_SECRET).toBeUndefined();
    expect(specs[2]!.env.INGENIUM_API_TOKEN).toBeUndefined();
  });

  it("adds the internal marker only to explicitly bound fixture API calls", () => {
    expect(directApiAuthHeaders(TEST_API_TOKEN)).toEqual({
      Authorization: `Bearer ${TEST_API_TOKEN}`,
    });
    expect(directApiAuthHeaders(TEST_API_TOKEN)).not.toHaveProperty(FIXTURE_INTERNAL_SERVICE_HEADER);
    expect(() => directApiAuthHeaders(TEST_API_TOKEN, {
      mode: "fixture",
      runNonce: "not-a-run-nonce",
      project: "global-default",
    })).toThrow(/run-owned nonce and project/);
  });

  it("captures the pre-existing process baseline before a fixture child can launch", async () => {
    const context = createTestRunContext({ ports: { api: 45204, dashboard: 45205, fixture: 45206 } });
    track(context);
    let baselineAtSpawn: ReturnType<typeof readTestRunManifest>["preexistingProcessBaseline"];

    try {
      await expect(startTestServers(context, {
        production: false,
        build: false,
        spawnServer: () => {
          baselineAtSpawn = readTestRunManifest(context.manifestPath).preexistingProcessBaseline;
          throw new Error("baseline capture probe");
        },
      })).rejects.toThrow("baseline capture probe");

      expect(baselineAtSpawn).toBeDefined();
      expect(readTestRunManifest(context.manifestPath).preexistingProcessBaseline).toEqual(baselineAtSpawn);
      expect(readTestRunTelemetry(context.telemetryPath!).preexistingProcessBaseline).toEqual(baselineAtSpawn);
    } finally {
      updateTestRunManifest(context.manifestPath, { status: "created", processes: [] });
      cleanupTestRun(context.manifestPath);
    }
  });

  it("never forwards parent secrets to child environments", () => {
    const previousToken = process.env.INGENIUM_API_TOKEN;
    const previousSecret = process.env.PHASE5C_SECRET;
    process.env.INGENIUM_API_TOKEN = "real-parent-secret";
    process.env.PHASE5C_SECRET = "must-not-cross-process-boundary";
    try {
      const context = createTestRunContext({ ports: { api: 45211, dashboard: 45212, fixture: 45213 } });
      track(context);
      const specs = getServerSpecs(context, true, getDashboardFixtureEnvironment(context, TEST_API_TOKEN));
      for (const spec of specs) {
        expect(spec.env.PHASE5C_SECRET).toBeUndefined();
        expect(spec.env.INGENIUM_API_TOKEN).not.toBe("real-parent-secret");
        if (spec.name === "dashboard") {
          expect(spec.env.INGENIUM_API_TOKEN).toBeUndefined();
          expect(spec.env.INGENIUM_API_TOKEN_FILE).toBe(getTestRunApiTokenPath(context));
        } else {
          expect(spec.env.INGENIUM_API_TOKEN_FILE).toBeUndefined();
        }
      }
    } finally {
      if (previousToken === undefined) delete process.env.INGENIUM_API_TOKEN;
      else process.env.INGENIUM_API_TOKEN = previousToken;
      if (previousSecret === undefined) delete process.env.PHASE5C_SECRET;
      else process.env.PHASE5C_SECRET = previousSecret;
    }
  });

  it("runs a signal cleanup handler once and preserves signal-specific exit codes", async () => {
    const signalSource = new EventEmitter();
    const stop = vi.fn(async () => undefined);
    const exit = vi.fn();
    const remove = installRunSignalHandlers("/tmp/run-manifest.json", {
      signalSource,
      stop,
      exit,
    });

    signalSource.emit("SIGTERM");
    signalSource.emit("SIGINT");
    await new Promise((resolve) => setImmediate(resolve));

    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(143);
    remove();
  });

  it("requires the original manifest instead of creating a replacement during global teardown", async () => {
    const previousManifest = process.env[TEST_RUN_MANIFEST_ENV];
    delete process.env[TEST_RUN_MANIFEST_ENV];
    try {
      await expect(globalTeardown()).rejects.toThrow(/original test-run manifest path/);
    } finally {
      if (previousManifest === undefined) delete process.env[TEST_RUN_MANIFEST_ENV];
      else process.env[TEST_RUN_MANIFEST_ENV] = previousManifest;
    }
  });

  it("retains the original manifest between setup cleanup and global teardown", async () => {
    const context = createTestRunContext({ ports: { api: 45217, dashboard: 45218, fixture: 45219 } });
    track(context);
    updateTestRunManifest(context.manifestPath, { status: "running", processes: [] });

    await stopRunFromManifest(context.manifestPath, { cleanup: false, stopTimeoutMs: 25 });

    expect(existsSync(context.manifestPath)).toBe(true);
    expect(readTestRunManifest(context.manifestPath).status).toBe("complete");
    await globalTeardown();
    expect(existsSync(context.manifestPath)).toBe(false);
  });

  it("fails global teardown and retains telemetry when the original manifest is missing", async () => {
    const context = createTestRunContext({ ports: { api: 45214, dashboard: 45215, fixture: 45216 } });
    track(context);
    const previousManifest = process.env[TEST_RUN_MANIFEST_ENV];
    rmSync(context.manifestPath, { force: true });
    try {
      await expect(globalTeardown()).rejects.toThrow(/original test-run manifest.*retained/);
      expect(existsSync(context.telemetryPath!)).toBe(true);
    } finally {
      if (previousManifest === undefined) delete process.env[TEST_RUN_MANIFEST_ENV];
      else process.env[TEST_RUN_MANIFEST_ENV] = previousManifest;
    }
  });

  it("validates process identity before signaling and rejects PID reuse", () => {
    const context = createTestRunContext({ ports: { api: 45221, dashboard: 45222, fixture: 45223 } });
    track(context);
    const identity = inspectProcessIdentity(process.pid);
    expect(identity).toBeDefined();
    const record: TestRunProcess = {
      name: "api",
      pid: process.pid + 10_000,
      port: context.ports.api,
      startedAt: new Date().toISOString(),
      runNonce: context.runNonce,
      pidStartTime: identity!.pidStartTime,
      pgid: identity!.pgid,
      executable: identity!.executable,
      groupIdentity: identity!.groupIdentity,
    };
    expect(validateProcessIdentity(context, record)).toMatchObject({ valid: false });
  });

  it("rejects a forged manifest before attempting any signal", async () => {
    const context = createTestRunContext({ ports: { api: 45225, dashboard: 45226, fixture: 45227 } });
    track(context);
    const original = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
    writeFileSync(context.manifestPath, JSON.stringify({ ...original, runNonce: "forged" }));
    const kill = vi.spyOn(process, "kill");
    try {
      await expect(stopRunFromManifest(context.manifestPath)).rejects.toThrow(/manifest|nonce|UUID/i);
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
       releaseTestRunPortReservations(context);
       rmSync(context.runDir, { recursive: true, force: true });
    }
  });

  it("retains a stale PID record and never signals the reused process", async () => {
    const context = createTestRunContext({ ports: { api: 45226, dashboard: 45227, fixture: 45228 } });
    track(context);
    const identity = inspectProcessIdentity(process.pid);
    if (!identity) throw new Error("test process identity unavailable");
    const original = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
    const staleRecord: TestRunProcess = {
      name: "api",
      pid: process.pid,
      port: context.ports.api,
      startedAt: new Date().toISOString(),
      runNonce: context.runNonce,
      pidStartTime: "1",
      pgid: identity.pgid,
      executable: identity.executable,
      groupIdentity: identity.groupIdentity,
    };
    writeFileSync(context.manifestPath, JSON.stringify({ ...original, status: "running", processes: [staleRecord] }));
    const kill = vi.spyOn(process, "kill");
    try {
      await expect(stopRunFromManifest(context.manifestPath, { stopTimeoutMs: 20, cleanup: false })).rejects.toThrow(/identity|stale|signal/i);
      const signalCalls = kill.mock.calls.filter(([, signal]) => signal === "SIGTERM" || signal === "SIGKILL");
      expect(signalCalls).toHaveLength(0);
      const retained = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
      expect(retained.status).toBe("stopping");
      expect(retained.processes).toHaveLength(1);
    } finally {
      kill.mockRestore();
       releaseTestRunPortReservations(context);
       rmSync(context.runDir, { recursive: true, force: true });
    }
  });

  it("keeps startup process records when teardown signaling fails", async () => {
    const context = createTestRunContext({ ports: { api: 45236, dashboard: 45237, fixture: 45238 } });
    track(context);
    const children: ReturnType<typeof spawn>[] = [];
    const originalKill = process.kill.bind(process);
    const kill = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid < 0 && signal !== 0) {
        const error = new Error("synthetic signaling failure") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return originalKill(pid, signal as never);
    }) as typeof process.kill);
    try {
      await expect(startTestServers(context, {
        production: false,
        build: false,
        startTimeoutMs: 25,
        stopTimeoutMs: 25,
        spawnServer: (spec) => {
          const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            cwd: spec.cwd,
            env: spec.env,
            detached: true,
            stdio: "ignore",
          });
          children.push(child);
          return child;
        },
      })).rejects.toThrow();

      const retained = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
      expect(retained.status).toBe("stopping");
      expect(retained.processes).toHaveLength(1);
    } finally {
      kill.mockRestore();
      try {
        await stopRunFromManifest(context.manifestPath, { stopTimeoutMs: 250, cleanup: false });
      } catch {
        // The assertions above verify the failed startup hand-off. A final
        // best-effort recovery keeps this test from leaving a child behind.
      }
      for (const child of children) child.unref();
    }
  });

  it("kills and awaits the exact child when provisional record persistence fails", async () => {
    const context = createTestRunContext({ ports: { api: 45234, dashboard: 45235, fixture: 45245 } });
    track(context);
    let child: ReturnType<typeof spawn> | undefined;
    const listenerSource = [
      "const http = require('node:http');",
      "const server = http.createServer((_request, response) => response.end('ready'));",
      "server.listen(Number(process.env.TEST_SERVER_PORT), '127.0.0.1');",
      // Ignore SIGTERM so the regression exercises bounded SIGKILL escalation.
      "process.on('SIGTERM', () => {});",
    ].join("\n");

    try {
      await expect(startTestServers(context, {
        production: false,
        build: false,
        startTimeoutMs: 1_000,
        stopTimeoutMs: 500,
        spawnServer: (spec) => {
          const spawned = spawn(process.execPath, ["-e", listenerSource], {
            cwd: spec.cwd,
            env: { ...spec.env, TEST_SERVER_PORT: String(spec.port) },
            detached: true,
            stdio: "ignore",
          });
          child = spawned;
          return spawned;
        },
        beforeInitialProcessRecordPersist: async ({ spec }) => {
          // Make the failure deterministic after the child has demonstrably
          // acquired its listener, rather than racing startup against fs I/O.
          await waitForReady(spec, 1_000, 100);
        },
        updateManifest: (manifestPath, update) => {
          if (update.processes?.length) {
            // Remove the recovery record before throwing to prove cleanup does
            // not depend on a readable manifest.
            rmSync(manifestPath, { force: true });
            throw new Error("synthetic provisional record persistence failure");
          }
          return updateTestRunManifest(manifestPath, update);
        },
      })).rejects.toThrow(/synthetic provisional record persistence failure/);

      expect(child).toBeDefined();
      expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true);
      await expect(waitForPortClosed(context.ports.api, 500)).resolves.toBeUndefined();
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        await terminateChildProcessHandle(child, 500);
      }
    }
  });

  it("terminates and awaits a validated detached group for a portless provisional rollback", async () => {
    const context = createTestRunContext({ ports: { api: 45246, dashboard: 45247, fixture: 45248 } });
    track(context);
    const grandchildPidFile = join(context.runDir, "grandchild.pid");
    const parentSource = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const grandchild = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\"], { stdio: 'ignore' });",
      "writeFileSync(process.env.GRANDCHILD_PID_FILE, String(grandchild.pid));",
      "process.on('SIGTERM', () => {});",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const child = spawn(process.execPath, ["-e", parentSource], {
      cwd: context.repoRoot,
      env: {
        PATH: process.env.PATH ?? "",
        INGENIUM_TEST_RUN_NONCE: context.runNonce,
        GRANDCHILD_PID_FILE: grandchildPidFile,
      },
      detached: true,
      stdio: "ignore",
    });
    if (!child.pid) throw new Error("detached parent did not expose a PID");

    let grandchildPid: number | undefined;
    try {
      const deadline = Date.now() + 1_000;
      while (Date.now() < deadline && grandchildPid === undefined) {
        if (existsSync(grandchildPidFile)) {
          const parsed = Number.parseInt(readFileSync(grandchildPidFile, "utf8"), 10);
          if (Number.isSafeInteger(parsed) && parsed > 1) grandchildPid = parsed;
        }
        if (grandchildPid === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(grandchildPid).toBeDefined();

      await terminateChildProcessHandle(child, 1_000, context.runNonce);

      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      if (grandchildPid !== undefined) await expect(waitForProcessGoneOrZombie(grandchildPid)).resolves.toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          await terminateChildProcessHandle(child, 500, context.runNonce);
        } catch {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      }
    }
  });

  it("retains evidence and refuses to signal descendants after an early detached leader exit", async () => {
    const context = createTestRunContext({ ports: { api: 45266, dashboard: 45267, fixture: 45268 } });
    track(context);
    const grandchildPidFile = join(context.runDir, "early-exit-grandchild.pid");
    const parentSource = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const grandchild = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\"], { stdio: 'ignore' });",
      "writeFileSync(process.env.GRANDCHILD_PID_FILE, String(grandchild.pid));",
      "setTimeout(() => process.exit(0), 100);",
    ].join("\n");
    const child = spawn(process.execPath, ["-e", parentSource], {
      cwd: context.repoRoot,
      env: {
        PATH: process.env.PATH ?? "",
        INGENIUM_TEST_RUN_NONCE: context.runNonce,
        GRANDCHILD_PID_FILE: grandchildPidFile,
      },
      detached: true,
      stdio: "ignore",
    });
    if (!child.pid) throw new Error("early-exit parent did not expose a PID");
    captureSpawnedChildPgid(child);

    let grandchildPid: number | undefined;
    try {
      const deadline = Date.now() + 1_000;
      while (Date.now() < deadline && grandchildPid === undefined) {
        if (existsSync(grandchildPidFile)) {
          const parsed = Number.parseInt(readFileSync(grandchildPidFile, "utf8"), 10);
          if (Number.isSafeInteger(parsed) && parsed > 1) grandchildPid = parsed;
        }
        if (grandchildPid === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(grandchildPid).toBeDefined();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once("close", () => resolve());
        setTimeout(resolve, 500);
      });

      const kill = vi.spyOn(process, "kill");
      try {
        await expect(terminateChildProcessHandle(child, 1_000, context.runNonce))
          .rejects.toThrow(/could not be validated|refusing to signal|leader association|no longer validated/i);
        const negativeSignalCalls = kill.mock.calls.filter(([target, signal]) =>
          typeof target === "number" && target < 0 && signal !== 0,
        );
        expect(negativeSignalCalls).toHaveLength(0);
        expect(() => process.kill(grandchildPid!, 0)).not.toThrow();
      } finally {
        kill.mockRestore();
      }

      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      if (grandchildPid !== undefined) {
        process.kill(grandchildPid, "SIGKILL");
        await expect(waitForProcessGoneOrZombie(grandchildPid)).resolves.toBe(true);
      }
    } finally {
      if (grandchildPid !== undefined) {
        try {
          process.kill(grandchildPid, "SIGKILL");
        } catch {
          // The validated group cleanup may already have removed it.
        }
      }
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      child.unref();
    }
  });

  it("refuses to signal a pre-existing same-nonce group when an early child PGID was never observed", async () => {
    const context = createTestRunContext({ ports: { api: 45269, dashboard: 45270, fixture: 45271 } });
    track(context);
    const existingGroup = spawn(process.execPath, [
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    ], {
      cwd: context.repoRoot,
      env: {
        PATH: process.env.PATH ?? "",
        INGENIUM_TEST_RUN_NONCE: context.runNonce,
      },
      detached: true,
      stdio: "ignore",
    });
    const immediatelyExitingChild = spawn(process.execPath, ["-e", "process.exit(0)"], {
      cwd: context.repoRoot,
      env: {
        PATH: process.env.PATH ?? "",
        INGENIUM_TEST_RUN_NONCE: context.runNonce,
      },
      detached: true,
      stdio: "ignore",
    });
    if (!existingGroup.pid || !immediatelyExitingChild.pid) throw new Error("regression child did not expose a PID");

    try {
      await new Promise<void>((resolve) => {
        const deadline = Date.now() + 1_000;
        const poll = () => {
          if (inspectProcessIdentity(existingGroup.pid!)?.runNonce === context.runNonce || Date.now() >= deadline) {
            resolve();
            return;
          }
          setTimeout(poll, 25);
        };
        poll();
      });
      expect(inspectProcessIdentity(existingGroup.pid)?.runNonce).toBe(context.runNonce);
      await new Promise<void>((resolve) => {
        if (immediatelyExitingChild.exitCode !== null || immediatelyExitingChild.signalCode !== null) {
          resolve();
          return;
        }
        immediatelyExitingChild.once("close", () => resolve());
      });

      await expect(terminateChildProcessHandle(immediatelyExitingChild, 250, context.runNonce))
        .rejects.toThrow(/PGID was never observed|refusing to signal/i);
      expect(() => process.kill(existingGroup.pid!, 0)).not.toThrow();
    } finally {
      if (existingGroup.pid && existingGroup.exitCode === null && existingGroup.signalCode === null) {
        try {
          process.kill(existingGroup.pid, "SIGKILL");
        } catch {
          existingGroup.kill("SIGKILL");
        }
      }
      await waitForProcessGoneOrZombie(existingGroup.pid, 1_000);
      immediatelyExitingChild.unref();
      existingGroup.unref();
    }
  });

  it("does not signal a same-nonce pre-existing non-leader group", async () => {
    const context = createTestRunContext({ ports: { api: 45272, dashboard: 45273, fixture: 45274 } });
    track(context);
    const memberPidFile = join(context.runDir, "pre-existing-group-member.pid");
    const groupLeaderSource = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const member = spawn(process.execPath, ['-e', \"setInterval(() => {}, 1000);\"], { stdio: 'ignore' });",
      "writeFileSync(process.env.MEMBER_PID_FILE, String(member.pid));",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const groupLeader = spawn(process.execPath, ["-e", groupLeaderSource], {
      cwd: context.repoRoot,
      env: {
        PATH: process.env.PATH ?? "",
        INGENIUM_TEST_RUN_NONCE: context.runNonce,
        MEMBER_PID_FILE: memberPidFile,
      },
      detached: true,
      stdio: "ignore",
    });
    if (!groupLeader.pid) throw new Error("pre-existing group leader did not expose a PID");

    let memberPid: number | undefined;
    try {
      const deadline = Date.now() + 1_000;
      while (Date.now() < deadline && memberPid === undefined) {
        if (existsSync(memberPidFile)) {
          const parsed = Number.parseInt(readFileSync(memberPidFile, "utf8"), 10);
          if (Number.isSafeInteger(parsed) && parsed > 1) memberPid = parsed;
        }
        if (memberPid === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(memberPid).toBeDefined();
      const memberIdentity = memberPid === undefined ? undefined : inspectProcessIdentity(memberPid);
      expect(memberIdentity).toMatchObject({ pgid: groupLeader.pid, runNonce: context.runNonce });
      expect(memberIdentity?.pgid).not.toBe(memberPid);

      const startedAt = new Date().toISOString();
      const record: TestRunProcess = {
        name: "api",
        pid: memberPid!,
        port: context.ports.api,
        startedAt,
        runNonce: context.runNonce,
        pidStartTime: memberIdentity!.pidStartTime,
        pgid: memberIdentity!.pgid,
        executable: memberIdentity!.executable,
        groupIdentity: memberIdentity!.groupIdentity,
      };
      updateTestRunManifest(context.manifestPath, { status: "running", processes: [record] });

      const kill = vi.spyOn(process, "kill");
      try {
        await expect(stopRunFromManifest(context.manifestPath, { stopTimeoutMs: 100, cleanup: false }))
          .rejects.toThrow(/leader association|identity|signal/i);
        const negativeSignalCalls = kill.mock.calls.filter(([target, signal]) =>
          typeof target === "number" && target < 0 && signal !== 0,
        );
        expect(negativeSignalCalls).toHaveLength(0);
        expect(() => process.kill(memberPid!, 0)).not.toThrow();
        const retained = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
        expect(retained.status).toBe("stopping");
        expect(retained.processes).toHaveLength(1);
      } finally {
        kill.mockRestore();
      }
    } finally {
      if (memberPid !== undefined) {
        try {
          process.kill(memberPid, "SIGKILL");
        } catch {
          // The member may have exited with its detached parent.
        }
        await waitForProcessGoneOrZombie(memberPid, 1_000);
      }
      try {
        process.kill(groupLeader.pid, "SIGKILL");
      } catch {
        // The leader may have exited while the group was being inspected.
      }
      await waitForProcessGoneOrZombie(groupLeader.pid, 1_000);
       releaseTestRunPortReservations(context);
       rmSync(context.runDir, { recursive: true, force: true });
      groupLeader.unref();
    }
  });

  it("retains bound evidence when a spawned server reports another run nonce", async () => {
    const context = createTestRunContext({ ports: { api: 45239, dashboard: 45240, fixture: 45244 } });
    track(context);
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await expect(startTestServers(context, {
        production: false,
        build: false,
        startTimeoutMs: 25,
        stopTimeoutMs: 25,
        spawnServer: (spec) => {
          const spawned = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            cwd: spec.cwd,
            env: { ...spec.env, INGENIUM_TEST_RUN_NONCE: "wrong-run-nonce" },
            detached: true,
            stdio: "ignore",
          });
          child = spawned;
          return spawned;
        },
      })).rejects.toThrow(/identity could not be bound/);

      const retained = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
      expect(retained.status).toBe("stopping");
      expect(retained.processes).toHaveLength(1);
      expect(retained.processes[0]).toMatchObject({ identityState: "bound", runNonce: context.runNonce });
    } finally {
      if (child?.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // The child may have exited while startup was reporting the mismatch.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await stopRunFromManifest(context.manifestPath, { stopTimeoutMs: 250, cleanup: false });
      } catch {
        // The assertions focus on retaining the mismatched identity evidence.
      }
      child?.unref();
    }
  });

  it("persists a detached build group before timeout cleanup can signal it", async () => {
    const context = createTestRunContext({ ports: { api: 45241, dashboard: 45242, fixture: 45243 } });
    track(context);
    const binRoot = mkdtempSync(join(tmpdir(), "ingenium-build-bin-"));
    const npmPath = join(binRoot, "npm");
    writeFileSync(npmPath, "#!/bin/sh\nwhile :; do :; done\n", { mode: 0o700 });
    chmodSync(npmPath, 0o700);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binRoot}:${previousPath ?? ""}`;
    try {
      await expect(buildProductionArtifacts(context, 50)).rejects.toThrow(/Timed out running/);
      const retained = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
      expect(retained.status).toBe("stopping");
      expect(retained.processes).toHaveLength(1);
      expect(retained.processes[0]).toMatchObject({ name: "build", port: 0, runNonce: context.runNonce });
      const telemetry = JSON.parse(readFileSync(context.telemetryPath!, "utf8")) as {
        activeProcesses: Array<{ name: string }>;
        processes: Array<{ state: string; record: { name: string } }>;
      };
      expect(telemetry.activeProcesses).toHaveLength(1);
      expect(telemetry.processes.some(({ state, record }) => state === "retained" && record.name === "build")).toBe(true);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      try {
        await stopRunFromManifest(context.manifestPath, { stopTimeoutMs: 250, cleanup: false });
      } catch {
        // Keep the test focused on persistence; final cleanup below is scoped.
      }
      rmSync(binRoot, { recursive: true, force: true });
    }
  });

  it("awaits parent and grandchild cleanup for a portless timed-out build", async () => {
    const context = createTestRunContext({ ports: { api: 45255, dashboard: 45256, fixture: 45257 } });
    track(context);
    const binRoot = mkdtempSync(join(tmpdir(), "ingenium-build-group-bin-"));
    const npmPath = join(binRoot, "npm");
    const grandchildPidFile = join(context.runDir, "build-grandchild.pid");
    writeFileSync(npmPath, [
      "#!/usr/bin/env node",
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const grandchild = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\"], { stdio: 'ignore' });",
      `writeFileSync(${JSON.stringify(grandchildPidFile)}, String(grandchild.pid));`,
      "process.on('SIGTERM', () => {});",
      "setInterval(() => {}, 1000);",
    ].join("\n"), { mode: 0o700 });
    chmodSync(npmPath, 0o700);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binRoot}:${previousPath ?? ""}`;
    try {
      await expect(buildProductionArtifacts(context, 100)).rejects.toThrow(/Timed out running/);
      expect(existsSync(grandchildPidFile)).toBe(true);
      const grandchildPid = Number.parseInt(readFileSync(grandchildPidFile, "utf8"), 10);
      expect(Number.isSafeInteger(grandchildPid)).toBe(true);
      await expect(waitForProcessGoneOrZombie(grandchildPid)).resolves.toBe(true);

      const telemetry = JSON.parse(readFileSync(context.telemetryPath!, "utf8")) as {
        activeProcesses: Array<{ name: string }>;
        processes: Array<{ state: string; record: { name: string } }>;
      };
      expect(telemetry.activeProcesses).toHaveLength(1);
      expect(telemetry.processes.some(({ state, record }) => state === "retained" && record.name === "build")).toBe(true);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      try {
        await stopRunFromManifest(context.manifestPath, { stopTimeoutMs: 250, cleanup: false });
      } catch {
        // Keep the test focused on bounded group cleanup; final directory
        // cleanup remains scoped to this test run.
      }
      rmSync(binRoot, { recursive: true, force: true });
    }
  });

  it("resolves a stopping manifest only after exited identities and closed ports", async () => {
    const context = createTestRunContext({ ports: { api: 45251, dashboard: 45252, fixture: 45253 } });
    track(context);
    const identity = {
      pidStartTime: "1",
      pgid: 999999,
      executable: "/usr/bin/node",
      groupIdentity: "999999:3",
    };
    const record: TestRunProcess = {
      name: "api",
      pid: 999999,
      port: context.ports.api,
      startedAt: new Date().toISOString(),
      runNonce: context.runNonce,
      ...identity,
    };
    const manifest = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
    writeFileSync(context.manifestPath, JSON.stringify({ ...manifest, status: "stopping", processes: [record] }));
    // The synthetic PID is already gone, and all owned ports are unused.
    await recoverStoppingTestRun(context.manifestPath, { portTimeoutMs: 50 });
    await recoverStoppingTestRun(context.manifestPath, { portTimeoutMs: 50 });

    const resolved = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
    expect(resolved.status).toBe("complete");
    expect(resolved.processes).toEqual([]);
    const telemetry = JSON.parse(readFileSync(context.telemetryPath!, "utf8")) as {
      resolution?: { status: string };
      activeProcesses: unknown[];
      processes: Array<{ state: string; reason?: string }>;
    };
    expect(telemetry.resolution?.status).toBe("resolved");
    expect(telemetry.activeProcesses).toEqual([]);
    expect(telemetry.processes[0]?.state).toBe("cleared");
  });

  it("repairs an interrupted completion promotion without deleting recovery evidence", async () => {
    const context = createTestRunContext({ ports: { api: 45261, dashboard: 45262, fixture: 45263 } });
    track(context);
    // Simulate the only unsafe intermediate state a prior runner could leave:
    // a complete manifest whose telemetry was written without resolution.
    updateTestRunManifest(context.manifestPath, { status: "complete", processes: [] });

    await recoverStoppingTestRun(context.manifestPath, { portTimeoutMs: 50 });

    const resolved = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
    const telemetry = JSON.parse(readFileSync(context.telemetryPath!, "utf8")) as {
      status: string;
      resolution?: { status: string };
    };
    expect(resolved.status).toBe("complete");
    expect(telemetry.status).toBe("complete");
    expect(telemetry.resolution?.status).toBe("resolved");
  });

  it("bounds each readiness request instead of letting one hung request consume the run", async () => {
    const server = createServer((_request, _response) => {
      // Deliberately keep the request open. The readiness helper must abort it.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("readiness test did not bind");
    const started = Date.now();
    try {
      await expect(waitForReady(
        {
          name: "api",
          port: address.port,
          command: "node",
          args: [],
          cwd: process.cwd(),
          env: {},
          readinessUrl: `http://127.0.0.1:${address.port}/hung`,
        },
        120,
        25,
      )).rejects.toThrow(/did not become ready/);
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("requires an authenticated health response instead of accepting a 4xx", async () => {
    const server = createServer((request, response) => {
      if (request.headers.authorization !== `Bearer ${TEST_API_TOKEN}`) {
        response.statusCode = 401;
        response.end("unauthorized");
        return;
      }
      response.statusCode = 204;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("authenticated readiness test did not bind");
    const spec = {
      name: "api" as const,
      port: address.port,
      command: "node",
      args: [],
      cwd: process.cwd(),
      env: {},
      readinessUrl: `http://127.0.0.1:${address.port}/api/v1/health`,
    };

    try {
      await expect(waitForReady(spec, 120, 25)).rejects.toThrow(/did not become ready/);
      await expect(waitForReady({
        ...spec,
        readinessHeaders: { Authorization: `Bearer ${TEST_API_TOKEN}` },
      }, 500, 25)).resolves.toBeUndefined();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects invalid config before allocating a run", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "ingenium-phase-5u-config-"));
    const artifactRoot = getTestRunArtifactRoot(process.cwd());
    const runIdsBefore = existsSync(artifactRoot)
      ? readdirSync(artifactRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
      : [];
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      TMPDIR: tempRoot,
      INGENIUM_E2E_API_PORT: "3000",
      INGENIUM_E2E_DASH_PORT: "45582",
      INGENIUM_E2E_FIXTURE_PORT: "45583",
    };
    delete childEnvironment[TEST_RUN_MANIFEST_ENV];
    delete childEnvironment[TEST_RUN_NONCE_ENV];
    delete childEnvironment[TEST_RUN_TELEMETRY_ENV];

    try {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "--eval", "import('./tests/playwright.config.ts')"],
        { cwd: process.cwd(), env: childEnvironment, encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/development or Docker port/);

      const remainingRunDirectories = readdirSync(tempRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEST_RUN_TEMP_PREFIX));
      expect(remainingRunDirectories).toHaveLength(0);

      const runIdsAfter = existsSync(artifactRoot)
        ? readdirSync(artifactRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          : [];
      const createdRunIds = runIdsAfter.filter((runId) => !runIdsBefore.includes(runId));
      expect(createdRunIds).toHaveLength(0);
    } finally {
      const runIdsAfter = existsSync(artifactRoot)
        ? readdirSync(artifactRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
        : [];
      for (const runId of runIdsAfter.filter((candidate) => !runIdsBefore.includes(candidate))) {
        rmSync(join(artifactRoot, runId), { recursive: true, force: true });
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("cleans the run in finally when a port refuses to close and retains diagnostics", async () => {
    const context = createTestRunContext({ ports: { api: 45231, dashboard: 45232, fixture: 45233 } });
    track(context);
    const server = createServer((_request, response) => response.end("held"));
    await new Promise<void>((resolve) => server.listen(context.ports.api, "127.0.0.1", resolve));
    const identity = inspectProcessIdentity(process.pid);
    if (!identity) throw new Error("test process identity unavailable");
    const record: TestRunProcess = {
      name: "api",
      pid: process.pid,
      port: context.ports.api,
      startedAt: new Date().toISOString(),
      runNonce: context.runNonce,
      pidStartTime: identity.pidStartTime,
      pgid: identity.pgid,
      executable: identity.executable,
      groupIdentity: identity.groupIdentity,
    };
    const manifest = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
    writeFileSync(context.manifestPath, JSON.stringify({ ...manifest, processes: [record] }));
    try {
      await expect(stopRunFromManifest(context.manifestPath, { stopTimeoutMs: 25 })).rejects.toThrow(/did not close/);
      const retained = JSON.parse(readFileSync(context.manifestPath, "utf8")) as typeof context;
      expect(retained.status).toBe("stopping");
      expect(retained.processes).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
       releaseTestRunPortReservations(context);
       rmSync(context.runDir, { recursive: true, force: true });
    }
  });
});
