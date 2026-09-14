import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY, COORDINATION_OUTBOX_OVERFLOW_AUTHORITY_SHA256 } from "./coordination-outbox.js";
import { runReplacementFirstRestart, stableRestartTodos } from "./replacement-first-restart.js";
import { inspectProductionRestartBinding, redactedHandoffFromExport } from "./scripts/production-restart.js";
import { managedRecoveryEnvironment } from "./scripts/managed-command-wrapper.js";

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
  it("omits empty launcher defaults without accepting nonempty binding conflicts", async () => {
    const scripts = join(root, "packages/ingenium-extension/scripts");
    mkdirSync(scripts, { recursive: true });
    const wrapper = join(scripts, "managed-command-wrapper.ts");
    writeFileSync(wrapper, "");
    const moduleUrl = pathToFileURL(wrapper);
    const inherited = Object.fromEntries([...Object.keys(environment), "INGENIUM_PROJECT_ID",
      "INGENIUM_STORAGE_MAPPING_HASH", "INGENIUM_MCP_CREDENTIAL_PURPOSE"].map((key) => [key, ""]));
    const forwarded = managedRecoveryEnvironment(inherited, moduleUrl);
    expect(forwarded).toEqual({ INGENIUM_WORKTREE: root, PATH: expect.any(String) });
    const configured = shim.recoveryConfiguredEnvironment(root, forwarded);
    expect(configured).toMatchObject(environment);
    const request = authorityRequest();
    expect(await shim.corroborateRecoveryBinding(root, configured, request)).toEqual(binding);
    expect(request).toHaveBeenCalledTimes(2);
    for (const project of ["foreign", " "]) {
      const conflicting = managedRecoveryEnvironment({ ...inherited, INGENIUM_PROJECT: project }, moduleUrl);
      expect(conflicting.INGENIUM_PROJECT).toBe(project);
      expect(() => shim.recoveryConfiguredEnvironment(root, conflicting)).toThrow("Recovery binding conflicts with configured binding");
    }
  });

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
  it.each([
    ["/auth/preflight", "1", 1_000],
    ["/projects/ingenium/detail", "0", 0],
    ["/auth/preflight", new Date(2_000_000_002_000).toUTCString(), 2_000],
  ])("retries one rate-limited %s read with bounded Retry-After %s", async (limitedPath, retryAfter, delay) => {
    const authority = authorityRequest();
    const attempts: Array<{ url: string; method: string | undefined; redirect: RequestRedirect | undefined; headers: [string, string][] }> = [];
    let limited = false;
    const request = vi.fn(async (url: string, init: RequestInit) => {
      attempts.push({ url, method: init.method, redirect: init.redirect, headers: [...new Headers(init.headers)].sort() });
      if (!limited && url.endsWith(limitedPath)) {
        limited = true;
        return new Response(null, { status: 429, headers: { "Retry-After": retryAfter } });
      }
      return authority(url, init);
    });
    const sleep = vi.fn(async () => {
      writeFileSync(join(root, ".opencode/.ingenium-mcp-credential"), "d".repeat(43), { mode: 0o600 });
    });

    await expect(shim.corroborateRecoveryBinding(root, environment, request, {
      now: () => 2_000_000_000_000,
      sleep,
    })).resolves.toEqual(binding);

    const retried = attempts.filter((attempt) => attempt.url.endsWith(limitedPath));
    expect(retried).toHaveLength(2);
    expect(retried[1]).toEqual(retried[0]);
    expect(retried[0]?.headers).toContainEqual(["authorization", `Bearer ${"c".repeat(43)}`]);
    expect(sleep.mock.calls).toEqual([[delay]]);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each([
    ["missing Retry-After", undefined, [429], 1],
    ["malformed Retry-After", "later", [429], 1],
    ["unsupported date Retry-After", new Date(2_000_000_001_000).toISOString(), [429], 1],
    ["negative Retry-After", "-1", [429], 1],
    ["excessive delta Retry-After", "3", [429], 1],
    ["excessive date Retry-After", new Date(2_000_000_003_000).toUTCString(), [429], 1],
    ["a second 429", "1", [429, 429], 2],
    ["a non-429 response", undefined, [503], 1],
  ])("fails closed without another retry for %s", async (_failure, retryAfter, statuses, expectedRequests) => {
    let attempt = 0;
    const request = vi.fn(async () => new Response(null, {
      status: statuses[Math.min(attempt++, statuses.length - 1)],
      headers: attempt === 1 && retryAfter !== undefined ? { "Retry-After": retryAfter } : undefined,
    }));
    const sleep = vi.fn(async () => undefined);

    await expect(shim.corroborateRecoveryBinding(root, environment, request, {
      now: () => 2_000_000_000_000,
      sleep,
    })).rejects.toThrow("Recovery binding authority is unavailable");
    expect(request).toHaveBeenCalledTimes(expectedRequests);
    expect(sleep.mock.calls).toEqual(expectedRequests === 2 ? [[1_000]] : []);
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

describe("recovery ancestry ownership", () => {
  function fixture() {
    const uid = process.getuid!();
    const parent = { pid: 10, parentPid: 20, startTimeTicks: 100, executableSha256: hash("parent"),
      cwd: root, commandName: "opencode", cmdlineSha256: hash("argv"), argv: ["opencode"] };
    const inspect = vi.fn((pid: number) => pid === 10 ? parent
      : pid === 30 ? { ...parent, pid: 30, parentPid: 1 } : undefined);
    const processOwner = vi.fn((pid: number) => pid === 20 ? uid + 1 : uid);
    const processStat = vi.fn((_pid: number): { parentPid: number; startTimeTicks: number } | undefined =>
      ({ parentPid: 1, startTimeTicks: 200 }));
    return { uid, inspect, processOwner, processStat, options: {
      parentPid: 10, inspect, processOwner, processStat,
      environment: () => ({ XDG_DATA_HOME: root }), listeningPorts: () => [4098],
    } };
  }

  it("follows stable foreign supervisor links without opening their executable or adopting them", () => {
    const f = fixture();
    const result = shim.inspectAncestry(root, f.options);
    expect(result).toMatchObject({ status: "exact", parent: { pid: 10, port: 4098 } });
    expect(result.members.map((member: { pid: number }) => member.pid)).toEqual([10]);
    expect(f.inspect.mock.calls).toEqual([[10]]);
    expect(f.processStat.mock.calls).toEqual([[20], [20]]);
    expect(shim.inspectAncestry(root, { ...f.options, parentPid: 20 })).toMatchObject({ status: "ambiguous", parent: null });
  });

  it.each(["second owned parent", "unreadable owned ancestor", "missing foreign link", "changed foreign link",
    "changed foreign process", "changed foreign owner", "changed owned process owner", "unreadable process owner",
    "cyclic foreign link"])("rejects %s", (failure) => {
    const f = fixture();
    if (failure === "second owned parent") f.processStat.mockReturnValue({ parentPid: 30, startTimeTicks: 200 });
    if (failure === "unreadable owned ancestor") f.processOwner.mockReturnValue(f.uid);
    if (failure === "missing foreign link") f.processStat.mockReturnValue(undefined);
    if (failure === "changed foreign link") f.processStat.mockReturnValueOnce({ parentPid: 2, startTimeTicks: 200 });
    if (failure === "changed foreign process") f.processStat.mockReturnValueOnce({ parentPid: 1, startTimeTicks: 199 });
    if (failure === "changed foreign owner") {
      let reads = 0;
      f.processOwner.mockImplementation((pid) => pid === 20 && ++reads === 1 ? f.uid + 1 : f.uid);
    }
    if (failure === "changed owned process owner") {
      f.processOwner.mockReturnValueOnce(f.uid).mockReturnValue(f.uid + 1);
    }
    if (failure === "unreadable process owner") {
      f.processOwner.mockReturnValueOnce(f.uid).mockImplementation(() => { throw new Error("process disappeared"); });
    }
    if (failure === "cyclic foreign link") f.processStat.mockReturnValue({ parentPid: 20, startTimeTicks: 200 });
    expect(shim.inspectAncestry(root, f.options)).toMatchObject({ status: "ambiguous", parent: null });
  });
});

describe("recovery preflight repository-data trust", () => {
  const acl = Buffer.alloc(4 + 5 * 8);
  acl.writeUInt32LE(2);
  // The named service user and rwx mask reproduce Linux's 0674 mode without making the Git blob executable.
  for (const [index, [tag, permissions, uid]] of [
    [1, 6, 0xffffffff], [2, 7, process.getuid!() + 10000], [4, 4, 0xffffffff],
    [16, 7, 0xffffffff], [32, 4, 0xffffffff],
  ].entries()) {
    acl.writeUInt16LE(tag!, 4 + index * 8);
    acl.writeUInt16LE(permissions!, 6 + index * 8);
    acl.writeUInt32LE(uid!, 8 + index * 8);
  }
  const sharedAcl = (path: string) => execFileSync("/usr/bin/python3", ["-c",
    "import os, sys\nos.setxattr(sys.argv[1], 'system.posix_acl_access', sys.stdin.buffer.read())", path], { input: acl });
  const readAcl = (path: string) => execFileSync("/usr/bin/python3", ["-c",
    "import os, sys\nsys.stdout.buffer.write(os.getxattr(sys.argv[1], 'system.posix_acl_access'))", path]);

  function fixture() {
    const git = (...args: string[]) => execFileSync("/usr/bin/git", ["-C", root,
      "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
      "-c", "user.name=Recovery Test", "-c", "user.email=recovery@invalid", ...args], {
      encoding: "utf8", env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
    writeFileSync(join(root, ".gitignore"), ".opencode/\n");
    git("init", "--quiet");
    git("add", "--", ".gitignore", "opencode.json");
    git("commit", "--quiet", "-m", "fixture");
    const file = join(root, "opencode.json");
    const bytes = readFileSync(file);
    sharedAcl(file);
    expect(lstatSync(file).mode & 0o7777).toBe(0o674);
    expect(readAcl(file)).toEqual(acl);
    expect(git("status", "--porcelain=v1")).toBe("");
    return { file, bytes, git, head: git("rev-parse", "HEAD").trim() };
  }

  function installedBuildFixture(source: { head: string; sha256: string }) {
    const home = join(root, ".opencode/home");
    const release = join(home, ".local/share/ingenium/host-build/releases", source.head);
    const bin = join(home, ".local/bin");
    const artifacts = {
      "dist/scripts/build-command.js": Buffer.from("build artifact\n"),
      "dist/scripts/opencode.js": Buffer.from("opencode artifact\n"),
    };
    const launcherEntries = [["ingenium-build", "dist/scripts/build-command.js"],
      ["ingenium-opencode", "dist/scripts/opencode.js"]] as const;
    const launcherBytes: Record<string, Buffer> = Object.fromEntries(launcherEntries.map(([name, path]) =>
      [name, Buffer.from(`#!/bin/sh\n# ${release}\n# ${join(release, path)}\n`)]));
    for (const path of [release, join(release, "dist/scripts"), bin]) mkdirSync(path, { recursive: true, mode: 0o700 });
    for (const [path, bytes] of Object.entries(artifacts)) writeFileSync(join(release, path), bytes, { mode: 0o400 });
    const manifestPath = join(release, "release.json");
    writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, head: source.head, repositoryRoot: root,
      owner: process.getuid!(), node: {}, sourceSha256: source.sha256,
      files: Object.fromEntries(Object.entries(artifacts).map(([path, bytes]) => [path, { sha256: hash(bytes), mode: 0o400 }])),
      launchers: Object.fromEntries(launcherEntries.map(([name, entry]) =>
        [name, { sha256: hash(launcherBytes[name]!), mode: 0o500, entry }])) }),
    { mode: 0o400 });
    for (const [name, bytes] of Object.entries(launcherBytes)) writeFileSync(join(bin, name), bytes, { mode: 0o500 });
    return { home, release, artifacts, manifestPath, bin };
  }

  afterEach(() => vi.restoreAllMocks());

  it("accepts service-user ACL mode 0674 at exact clean Git identity through both config callers without mutation", async () => {
    const f = fixture();
    const before = lstatSync(f.file);
    const index = readFileSync(join(root, ".git/index"));
    expect(() => shim.readTrustedRegularFile(f.file, "config")).toThrow("writable");
    expect(shim.readRecoveryRepositoryData(root, f.head)).toEqual(f.bytes);
    expect(shim.recoveryConfiguredEnvironment(root, {}, f.head)).toEqual(environment);
    expect(() => shim.recoveryConfiguredEnvironment(root, {}, head)).toThrow("Git drift");
    const legacy = legacyFixture();
    legacy.source.head = f.head;
    expect(await legacy.capture()).toMatchObject({ snapshot: { sourceHead: f.head, binding } });
    legacy.source.head = head;
    expect(await legacy.capture()).toBeNull();
    expect(lstatSync(f.file)).toMatchObject({ dev: before.dev, ino: before.ino, uid: before.uid, nlink: before.nlink,
      mode: before.mode, size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs });
    expect(readAcl(f.file)).toEqual(acl);
    expect(readFileSync(join(root, ".git/index"))).toEqual(index);
  });

  it("runs exact attested preflight with bounded content-free output and byte-identical protected state", async () => {
    const f = fixture();
    const source = { head: f.head, path: join(root, "packages/ingenium-extension/scripts/recovery-bootstrap.js"),
      bytes: Buffer.from("attested source"), sha256: hash("attested source") };
    const installedFixture = installedBuildFixture(source);
    const installed = shim.inspectInstalledRecoveryBuild(root, source, { HOME: installedFixture.home });
    const parent = { pid: 100, startTimeTicks: 10, executableSha256: hash("exe"), nonceSha256: "0".repeat(64),
      cwd: root, cmdlineSha256: hash("argv"), port: 4098, sessionId: null, environment: {} };
    const capture = { snapshot: { kind: "legacy-pre-admission", sessionId: "ses_exact", parent,
      marker: { sessionIdSha256: hash("ses_exact"), bindingSha256: hash("binding"), handoffSha256: hash("handoff") },
      todos: [{ idSha256: hash("private todo"), status: "in_progress" }], operational: { status: "working" } },
    summary: { status: "working" } };
    const sourceHandle = { source, revalidate: vi.fn(() => source), close: vi.fn() };
    const authority = authorityRequest();
    const request = async (url: string, init: RequestInit) => url.endsWith("/health")
      ? new Response(JSON.stringify({ status: "ok" })) : authority(url, init);
    const gitSummary = vi.fn(() => ({ status: "validated", head: f.head, clean: true, dirtyPaths: [],
      indexFlagsNormal: true, sourceMatchesHead: true }));
    const forbidden = Object.fromEntries(["mintAdmissionArtifact", "runRecoveryPreparation", "systemd", "spawn", "signal",
      "write", "rename", "unlink"].map((name) => [name, vi.fn()]));
    const before = {
      config: readFileSync(f.file),
      credential: readFileSync(join(root, ".opencode/.ingenium-mcp-credential")),
      index: readFileSync(join(root, ".git/index")),
      acl: readAcl(f.file),
      stat: lstatSync(f.file),
    };

    const result = await shim.runRecoveryPreflight(["node", source.path], {
      openSource: () => sourceHandle,
      ...forbidden,
      inputOptions: {
        request,
        gitSummary,
        inspectInstalledBuild: () => installed,
        inspectDeployment: () => ({ status: "attested", provider: "docker-local", revision: f.head }),
        ancestry: () => ({ status: "exact", parent }),
        captureLegacy: async () => capture,
      },
    });

    expect(result).toMatchObject({ action: "recovery-preflight", status: "admitted", admissible: true, mutationFree: true,
      authorizesRestart: false, session: { kind: "legacy-pre-admission", status: "working",
        sessionIdSha256: hash("ses_exact"), markerSha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      binding, source: { head: f.head, clean: true, blobMatches: true, indexFlagsNormal: true },
      deployment: { status: "attested", revision: f.head }, launcher: { status: "attested" },
      quarantine: null, admission: { decision: "admit", nextOperation: "recovery-prepare" } });
    const serialized = JSON.stringify(result);
    for (const content of ["private todo", "private transcript", "private reasoning", "credential", "p".repeat(43), "c".repeat(43)]) {
      expect(serialized.toLowerCase()).not.toContain(content.toLowerCase());
    }
    expect(Buffer.byteLength(serialized)).toBeLessThan(4096);
    expect(Object.values(forbidden).every((operation: any) => operation.mock.calls.length === 0)).toBe(true);
    expect(sourceHandle.revalidate).toHaveBeenCalledTimes(4);
    expect(sourceHandle.close).toHaveBeenCalledOnce();
    expect(readFileSync(f.file)).toEqual(before.config);
    expect(readFileSync(join(root, ".opencode/.ingenium-mcp-credential"))).toEqual(before.credential);
    expect(readFileSync(join(root, ".git/index"))).toEqual(before.index);
    expect(readAcl(f.file)).toEqual(before.acl);
    expect(lstatSync(f.file)).toMatchObject({ dev: before.stat.dev, ino: before.stat.ino, mode: before.stat.mode,
      size: before.stat.size, mtimeMs: before.stat.mtimeMs, ctimeMs: before.stat.ctimeMs });
    expect(existsSync(join(root, ".opencode/protected-runtime-index"))).toBe(false);
    const bootstrapSource = readFileSync(new URL("./scripts/recovery-bootstrap.js", import.meta.url), "utf8");
    const preflightSource = bootstrapSource.slice(bootstrapSource.indexOf("export async function runRecoveryPreflight"),
      bootstrapSource.indexOf("function validPreparationLaunch"));
    const collectorSource = bootstrapSource.slice(bootstrapSource.indexOf("export async function collectPreparationInputs"),
      bootstrapSource.indexOf("export function recoveryPreflightFailureOutput"));
    for (const forbiddenCall of ["mintRecoveryAdmissionArtifact(", "runRecoveryPreparation(", "preparationSystemd(",
      "spawn(", "process.kill(", "writeFileSync(", "renameSync(", "unlinkSync("]) {
      expect(preflightSource, forbiddenCall).not.toContain(forbiddenCall);
      expect(collectorSource, forbiddenCall).not.toContain(forbiddenCall);
    }
  });

  it.each(["dirty", "source tamper", "deployment mismatch", "hidden index flag"])(
    "rejects %s before configured ACL access",
    async (failure) => {
      const source = { head, path: join(root, "packages/ingenium-extension/scripts/recovery-bootstrap.js"),
        bytes: Buffer.from("source"), sha256: hash("source") };
      const order: string[] = [];
      const changed = { ...source, sha256: hash("changed") };
      const sourceHandle = { source, revalidate: vi.fn(() => {
        order.push("source");
        return failure === "source tamper" && order.filter((entry) => entry === "source").length === 2 ? changed : source;
      }), close: vi.fn() };
      const configuredEnvironment = vi.fn(() => { order.push("config"); return environment; });
      const summary = () => ({ status: "validated", head, clean: failure !== "dirty", dirtyPaths: failure === "dirty" ? ["changed.ts"] : [],
        indexFlagsNormal: failure !== "hidden index flag", sourceMatchesHead: true });
      const gitSummary = vi.fn(() => { order.push("git"); return summary(); });
      const inspectInstalledBuild = vi.fn(() => { order.push("installed"); return { status: "attested" }; });
      const inspectDeployment = vi.fn(() => {
        order.push("deployment");
        return failure === "deployment mismatch" ? { status: "unavailable", revision: null }
          : { status: "attested", revision: head };
      });

      await expect(shim.collectPreparationInputs(sourceHandle, { preflight: true, configuredEnvironment,
        gitSummary, inspectInstalledBuild, inspectDeployment })).rejects.toThrow("Recovery preflight");
      expect(configuredEnvironment).not.toHaveBeenCalled();
      expect(order).not.toContain("config");
      expect(sourceHandle.close).not.toHaveBeenCalled();
    },
  );

  it("rejects changed release artifacts and launchers from the installed preflight chain", () => {
    const source = { head, sha256: hash("source") };
    const installed = installedBuildFixture(source);
    expect(shim.inspectInstalledRecoveryBuild(root, source, { HOME: installed.home })).toMatchObject({
      status: "attested", release: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      launchers: { "ingenium-build": { sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        "ingenium-opencode": { artifactSha256: hash(installed.artifacts["dist/scripts/opencode.js"]) } },
    });
    const artifact = join(installed.release, "dist/scripts/build-command.js");
    chmodSync(artifact, 0o600);
    writeFileSync(artifact, "changed artifact\n");
    chmodSync(artifact, 0o400);
    expect(() => shim.inspectInstalledRecoveryBuild(root, source, { HOME: installed.home })).toThrow("launcher source");
    chmodSync(artifact, 0o600);
    writeFileSync(artifact, installed.artifacts["dist/scripts/build-command.js"]);
    chmodSync(artifact, 0o400);
    const launcher = join(installed.bin, "ingenium-build");
    chmodSync(launcher, 0o700);
    writeFileSync(launcher, "foreign launcher\n");
    chmodSync(launcher, 0o500);
    expect(() => shim.inspectInstalledRecoveryBuild(root, source, { HOME: installed.home })).toThrow("launcher source");
  });

  it.each([
    "missing expected HEAD", "foreign expected HEAD", "dirty config", "dirty tracked sibling", "untracked sibling",
    "staged-only drift", "skip-worktree blob mismatch", "assume-unchanged blob mismatch", "untracked ignored config",
    "symlink", "hardlink", "foreign owner", "executable Git blob", "owner executable", "other executable", "special mode",
    "aliased worktree", "external untracked input", "empty file", "oversized file",
  ])("rejects %s rather than admitting shared data", (failure) => {
    const f = fixture();
    let expectedHead: string | undefined = f.head;
    let worktree = root;
    const changed = f.bytes.toString().replace("ingenium", "foreignx");
    if (failure === "missing expected HEAD") expectedHead = undefined;
    if (failure === "foreign expected HEAD") expectedHead = head;
    if (failure === "dirty config") writeFileSync(f.file, changed);
    if (failure === "dirty tracked sibling") writeFileSync(join(root, ".gitignore"), ".opencode/\nchanged\n");
    if (failure === "untracked sibling") writeFileSync(join(root, "untracked.json"), "{}");
    if (failure === "staged-only drift") {
      writeFileSync(f.file, changed);
      f.git("add", "--", "opencode.json");
      writeFileSync(f.file, f.bytes);
    }
    if (failure === "skip-worktree blob mismatch" || failure === "assume-unchanged blob mismatch") {
      f.git("update-index", failure.startsWith("skip") ? "--skip-worktree" : "--assume-unchanged", "opencode.json");
      writeFileSync(f.file, changed);
      expect(f.git("status", "--porcelain=v1")).toBe("");
    }
    if (failure === "untracked ignored config") {
      f.git("rm", "--cached", "--", "opencode.json");
      writeFileSync(join(root, ".gitignore"), ".opencode/\nopencode.json\n");
      f.git("add", "--", ".gitignore");
      f.git("commit", "--quiet", "-m", "untrack config");
      expectedHead = f.git("rev-parse", "HEAD").trim();
      expect(f.git("status", "--porcelain=v1")).toBe("");
    }
    if (failure === "symlink") {
      const target = join(root, ".opencode/config.json");
      renameSync(f.file, target);
      symlinkSync(target, f.file);
    }
    if (failure === "hardlink") linkSync(f.file, join(root, ".opencode/hardlink"));
    if (failure === "foreign owner") {
      vi.spyOn(process, "getuid");
      vi.mocked(process.getuid!).mockReturnValue(process.getuid!() + 1);
    }
    if (failure === "executable Git blob") {
      f.git("update-index", "--chmod=+x", "opencode.json");
      f.git("commit", "--quiet", "-m", "executable config");
      f.git("config", "core.filemode", "false");
      expectedHead = f.git("rev-parse", "HEAD").trim();
      expect(f.git("status", "--porcelain=v1")).toBe("");
    }
    const modes: Record<string, number> = { "owner executable": 0o774, "other executable": 0o675, "special mode": 0o4674 };
    if (modes[failure] !== undefined) {
      chmodSync(f.file, modes[failure]!);
      f.git("config", "core.filemode", "false");
    }
    if (failure === "aliased worktree") {
      worktree = join(root, ".opencode/alias");
      symlinkSync(root, worktree);
    }
    if (failure === "external untracked input") {
      worktree = join(root, ".opencode/external");
      mkdirSync(worktree);
      writeFileSync(join(worktree, "opencode.json"), f.bytes);
      sharedAcl(join(worktree, "opencode.json"));
    }
    if (failure === "empty file") writeFileSync(f.file, "");
    if (failure === "oversized file") writeFileSync(f.file, Buffer.alloc(1024 * 1024 + 1));
    expect(() => shim.readRecoveryRepositoryData(worktree, expectedHead)).toThrow("Recovery preflight");
  });

  describe("tracked-index flag verification", () => {
    it("accepts clean repository data without hidden index flags", () => {
      const f = fixture();
      expect(f.git("ls-files", "-v", "-f", "-z")).toBe("H .gitignore\0H opencode.json\0");
      const index = readFileSync(join(root, ".git/index"));
      const afterOpen = vi.fn();
      expect(shim.readRecoveryRepositoryData(root, f.head, afterOpen)).toEqual(f.bytes);
      expect(afterOpen).toHaveBeenCalledOnce();
      expect(readFileSync(join(root, ".git/index"))).toEqual(index);
    });

    it.each([
      ["--assume-unchanged", "before"], ["--skip-worktree", "before"],
      ["--assume-unchanged", "during"], ["--skip-worktree", "during"],
    ])("rejects a hidden modified sibling with %s %s the read", (flag, timing) => {
      const f = fixture();
      let markedIndex: Buffer;
      const concealSibling = () => {
        f.git("update-index", flag, ".gitignore");
        writeFileSync(join(root, ".gitignore"), ".opencode/\nhidden-modification\n");
        expect(f.git("status", "--porcelain=v1")).toBe("");
        expect(readFileSync(f.file)).toEqual(f.bytes);
        markedIndex = readFileSync(join(root, ".git/index"));
      };
      if (timing === "before") concealSibling();
      const afterOpen = vi.fn(() => { if (timing === "during") concealSibling(); });
      expect(() => shim.readRecoveryRepositoryData(root, f.head, afterOpen)).toThrow("Git drift");
      expect(afterOpen).toHaveBeenCalledTimes(timing === "during" ? 1 : 0);
      expect(f.git("ls-files", "-v", "-z", "--", ".gitignore"))
        .toBe(`${flag === "--skip-worktree" ? "S" : "h"} .gitignore\0`);
      expect(readFileSync(join(root, ".git/index"))).toEqual(markedIndex!);
    });
  });

  it.each(["stable-byte rewrite", "pathname replacement", "symlink swap", "hardlink added", "mode change", "blob change",
    "HEAD change", "index change", "worktree change"])("rejects %s during the descriptor read", (race) => {
    const f = fixture();
    const afterOpen = vi.fn(() => {
      if (race === "stable-byte rewrite") {
        writeFileSync(f.file, f.bytes);
        utimesSync(f.file, new Date(1000), new Date(1000));
      }
      if (race === "pathname replacement" || race === "symlink swap") {
        const target = join(root, ".opencode/opened");
        renameSync(f.file, target);
        if (race === "symlink swap") symlinkSync(target, f.file);
        else writeFileSync(f.file, f.bytes, { mode: 0o644 });
      }
      if (race === "hardlink added") linkSync(f.file, join(root, ".opencode/hardlink"));
      if (race === "mode change") chmodSync(f.file, 0o644);
      if (race === "blob change") writeFileSync(f.file, f.bytes.toString().replace("ingenium", "foreignx"));
      if (race === "HEAD change") {
        writeFileSync(join(root, "new.json"), "{}");
        f.git("add", "--", "new.json");
        f.git("commit", "--quiet", "-m", "new HEAD");
      }
      if (race === "index change") {
        writeFileSync(join(root, ".gitignore"), ".opencode/\nchanged\n");
        f.git("add", "--", ".gitignore");
      }
      if (race === "worktree change") writeFileSync(join(root, "untracked.json"), "{}");
    });
    expect(() => shim.readRecoveryRepositoryData(root, f.head, afterOpen)).toThrow("Recovery preflight");
    expect(afterOpen).toHaveBeenCalledOnce();
  });

  it("keeps private recovery, credential, launcher and release readers strict", async () => {
    const f = fixture();
    expect(shim.readRecoveryRepositoryData(root, f.head)).toEqual(f.bytes);
    for (const options of [{ executable: true }, { expectedMode: 0o400 }, { expectedMode: 0o555 }, { expectedMode: 0o600 }, { expectedMode: 0o644 }]) {
      expect(() => shim.readTrustedRegularFile(f.file, "strict artifact", { ...options, allowWritableData: true })).toThrow("writable");
    }
    const artifact = join(root, ".opencode/admission.json");
    json(artifact, {});
    sharedAcl(artifact);
    const preflight = { admissible: true, git: { head: f.head }, source: { sha256: hash("source") }, binding,
      outbox: { status: "validated", count: 0, ambiguousCount: 0, sha256: null, quarantine: null },
      parent: { pid: 100, startTimeTicks: 10, executableSha256: hash("exe"), nonceSha256: hash("nonce"), sessionId: "ses_exact" } };
    expect(() => shim.readRecoveryAdmission(artifact, preflight, hash(shim.canonicalJson(preflight))))
      .toThrow("Recovery preflight file is unavailable");
    sharedAcl(join(root, ".opencode/.ingenium-mcp-credential"));
    const request = authorityRequest();
    await expect(shim.corroborateRecoveryBinding(root, environment, request)).rejects.toThrow("Recovery admission authentication is unavailable");
    expect(request).not.toHaveBeenCalled();
    expect(readAcl(f.file)).toEqual(acl);
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
    capture: () => shim.captureLegacyRecoveryPreAdmission(parent, binding, source, request, inspect),
    project: () => redactedHandoffFromExport({ info: payloads["/session/ses_exact"], messages: [...payloads["/session/ses_exact/message"], { parts: [
      { type: "tool", tool: "bash", state: { status: "running", input: { command: "ingenium-build deployment production-restart" } } },
    ] }] }, "ses_exact", root)!,
  };
}

function strictLegacyTodos(parent: { pid: number; startTimeTicks: number }, overrides: Record<string, string> = {}) {
  const values = {
    session: "ses_exact",
    pid: String(parent.pid),
    startTicks: String(parent.startTimeTicks),
    head,
    project: binding.project,
    projectId,
    workspace: binding.workspaceId,
    worktree: root,
    storageHash: binding.storageMappingHash,
    actions: "root-a",
    changedPaths: "packages/ingenium-extension/scripts/recovery-bootstrap.js",
    checks: "typecheck,test",
    task: "legacy-admission",
    status: "in_progress",
    nextWork: "verify",
    ...overrides,
  };
  return [
    { content: `[RECOVERY_BIND:${values.session}] pid=${values.pid} startTicks=${values.startTicks} head=${values.head} project=${values.project} projectId=${values.projectId} workspace=${values.workspace} worktree=${values.worktree} storageHash=${values.storageHash}`,
      status: "in_progress", priority: "high" },
    { content: `[RECOVERY_HANDOFF] actions=${values.actions}; changedPaths=${values.changedPaths}; checks=${values.checks}; task=${values.task}; status=${values.status}; nextWork=${values.nextWork}`,
      status: "pending", priority: "high" },
    { content: "Complete the bounded recovery implementation", status: "pending", priority: "medium" },
  ];
}

function legacyQueryRow(parent: { pid: number; startTimeTicks: number }, todos = strictLegacyTodos(parent), overrides = {}) {
  return {
    sessionId: "ses_exact",
    directory: root,
    parentId: null,
    todoPartId: "prt_todo",
    todoCompletedAt: 1_800_000_000_000,
    todoInput: JSON.stringify({ todos }),
    todoAssistantMessageId: "msg_0a010feaf001ybavkgP3zX2igj",
    todoAssistantSessionId: "ses_exact",
    todoAssistantRole: "assistant",
    assistantMessageId: "msg_0a012b71b001XbTeSPwt1svKqz",
    assistantSessionId: "ses_exact",
    assistantRole: "assistant",
    assistantAgent: "ingenium-orchestrator",
    assistantProviderId: "openai",
    assistantModelId: "gpt-5.6-sol",
    assistantStatus: "working",
    ...overrides,
  };
}

function markedLegacyCapture(capture: any, parent: any) {
  const parsed = shim.parseLegacyRecoveryTodoInput({ todos: strictLegacyTodos(parent) }, parent, binding, head, "ses_exact");
  return { ...capture, snapshot: { ...capture.snapshot, ...parsed } };
}

describe("legacy pre-admission capture", () => {
  it("captures a large legacy session with distinct Todo-owner and current assistants through bounded metadata queries", async () => {
    const f = legacyFixture();
    Object.assign(f.parent, { port: null, sessionId: null, dataHome: join(root, ".local/share/opencode"),
      environment: { HOME: root } });
    f.inspect.mockReturnValue({ ...f.parent, commandName: "opencode", ports: [], nonce: undefined });
    f.todos.splice(0, f.todos.length, ...strictLegacyTodos(f.parent));
    f.payloads["/session/ses_exact/message"][0].parts.push({ type: "tool", tool: "bash", state: {
      status: "completed", input: { command: "private export command" }, output: "private export output", metadata: { exit: 0 },
    } });
    const sessionHistoryBytes = 97_775_138;
    const row = legacyQueryRow(f.parent, f.todos);
    const raw: Buffer[] = [];
    const queryOutputBytes: number[] = [];
    let exportInvocations = 0;
    const execute = vi.fn((_command: string, args: string[], _options?: any) => {
      if (args[0] === "export") {
        exportInvocations += 1;
        return { status: 1, signal: null, error: new Error(`session export exceeded buffer at ${sessionHistoryBytes} bytes`) };
      }
      const stdout = Buffer.from(JSON.stringify([row]));
      const stderr = Buffer.alloc(1);
      queryOutputBytes.push(stdout.length);
      raw.push(stdout, stderr);
      return { status: 0, signal: null, stdout, stderr };
    });

    const result = await shim.captureLegacyRecoveryPreAdmission(f.parent, binding, f.source, f.request, f.inspect, execute);

    expect(result).toMatchObject({ snapshot: { sessionId: "ses_exact", nonceProvenance: "absent_process_environment",
      marker: { sessionIdSha256: hash("ses_exact"), bindingSha256: hash(f.todos[0]!.content),
        handoffSha256: hash(f.todos[1]!.content) },
      todos: f.todos.map((todo) => ({ idSha256: hash(`todo-${hash(`todo\0${JSON.stringify(todo.content)}`)}`), status: todo.status })),
      declaredOperational: { actionsSha256: hash("root-a"),
        checksSha256: hash(shim.canonicalJson(["typecheck", "test"])) },
      operational: { role: "ingenium-orchestrator", model: { providerId: "openai", modelId: "gpt-5.6-sol" },
        status: "working", taskHash: hash("legacy-admission"), actionsSha256: hash("root-a"),
        checksSha256: hash(shim.canonicalJson(["typecheck", "test"])),
        nextWork: { kind: "continue_task", referenceHash: hash("verify") } } } });
    expect(execute).toHaveBeenCalledWith("/proc/100/exe", ["db", shim.LEGACY_RECOVERY_SESSION_QUERY, "--format", "json"], expect.objectContaining({
      cwd: root, env: { HOME: root, XDG_DATA_HOME: join(root, ".local/share/opencode"), PATH: "/usr/local/bin:/usr/bin:/bin" },
    }));
    expect(sessionHistoryBytes).toBeGreaterThan(97_000_000);
    expect(exportInvocations).toBe(0);
    expect(execute.mock.calls.map(([, args]) => args[0])).toEqual(["db", "db"]);
    expect(execute.mock.calls.every(([command, args, options]) => command === "/proc/100/exe"
      && args[0] === "db" && args[1] === shim.LEGACY_RECOVERY_SESSION_QUERY && args[2] === "--format"
      && args[3] === "json" && options.encoding === null && options.timeout === 10_000
      && options.maxBuffer === 256 * 1024 && JSON.stringify(options.stdio) === JSON.stringify(["ignore", "pipe", "pipe"]))).toBe(true);
    expect(queryOutputBytes).toHaveLength(2);
    expect(queryOutputBytes.every((bytes) => bytes < 256 * 1024)).toBe(true);
    expect(f.inspect).toHaveBeenCalledTimes(3);
    expect(shim.LEGACY_RECOVERY_SESSION_QUERY).toMatch(/^SELECT /);
    expect(shim.LEGACY_RECOVERY_SESSION_QUERY).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|PRAGMA)\b/);
    expect(shim.LEGACY_RECOVERY_SESSION_QUERY).toContain("LIMIT 2");
    expect(shim.LEGACY_RECOVERY_SESSION_QUERY).toContain("todoAssistant.id = p.message_id");
    expect(shim.LEGACY_RECOVERY_SESSION_QUERY).not.toContain("p.message_id = a.id");
    expect(shim.LEGACY_RECOVERY_SESSION_QUERY).toContain("assistantModelId");
    expect(shim.LEGACY_RECOVERY_SESSION_QUERY).not.toMatch(/\$\.(?:text|reasoning)|\$\.state\.(?:output|error)/);
    expect(raw.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    expect(Object.keys(result.snapshot.operational).sort()).toEqual([
      "actionsSha256", "changedPathsSha256", "checksSha256", "model", "nextWork", "role", "status", "taskHash", "todos",
    ]);
    expect(JSON.stringify(result)).not.toContain("private transcript");
    expect(JSON.stringify(result)).not.toContain("private reasoning");
    expect(JSON.stringify(result)).not.toContain("private export command");
    expect(JSON.stringify(result)).not.toContain("private export output");
    expect(JSON.stringify(result)).not.toContain("Complete the bounded recovery implementation");
    expect(JSON.stringify(result)).not.toContain("root-a");
    expect(JSON.stringify(result)).not.toContain("legacy-admission");
    expect(f.request).not.toHaveBeenCalled();
  });

  it("accepts the exact marker project and rejects a wrong project", () => {
    const f = legacyFixture();
    const input = { todos: strictLegacyTodos(f.parent) };

    expect(shim.parseLegacyRecoveryTodoInput(input, f.parent, binding, head, "ses_exact")).not.toBeNull();
    expect(() => shim.parseLegacyRecoveryTodoInput(input, f.parent, { ...binding, project: "foreign" }, head, "ses_exact"))
      .toThrow("Recovery legacy binding marker does not match");
  });

  it.each(["wrong pid", "wrong start", "wrong source", "wrong project ID", "wrong workspace", "wrong worktree", "wrong storage",
    "unsafe path", "missing marker", "session mismatch", "known parent mismatch", "duplicate marker", "unexpected marker field",
    "unexpected Todo field", "zero matches", "child", "foreign directory", "multiple matches", "candidate overflow",
    "Todo part metadata", "Todo completion metadata", "Todo owner message metadata", "Todo owner session",
    "Todo owner role", "assistant message metadata", "assistant session", "assistant role", "assistant agent",
    "assistant provider", "assistant model", "assistant status", "unexpected row field"])(
    "rejects strict marker discovery for %s", (failure) => {
      const f = legacyFixture();
      Object.assign(f.parent, { port: null, sessionId: null, dataHome: join(root, ".local/share/opencode"),
        environment: { HOME: root } });
      const overrides: Record<string, string> = {};
      if (failure === "wrong pid") overrides.pid = "101";
      if (failure === "wrong start") overrides.startTicks = "11";
      if (failure === "wrong source") overrides.head = "b".repeat(40);
      if (failure === "wrong project ID") overrides.projectId = "33333333-3333-4333-8333-333333333333";
      if (failure === "wrong workspace") overrides.workspace = "foreign";
      if (failure === "wrong worktree") overrides.worktree = "/foreign";
      if (failure === "wrong storage") overrides.storageHash = hash("foreign");
      if (failure === "unsafe path") overrides.changedPaths = "../private.txt";
      if (failure === "session mismatch") overrides.session = "ses_other";
      const todos: any[] = strictLegacyTodos(f.parent, overrides);
      if (failure === "missing marker") todos.splice(0, 2);
      if (failure === "duplicate marker") todos.push({ ...todos[0] });
      if (failure === "unexpected marker field") todos[0].content += " extra=value";
      if (failure === "unexpected Todo field") todos[2] = { ...todos[2], secret: "private" };
      const row: any = legacyQueryRow(f.parent, todos, {
        directory: failure === "foreign directory" ? "/foreign" : root,
        parentId: failure === "child" ? "ses_parent" : null,
      });
      if (failure === "Todo part metadata") row.todoPartId = "";
      if (failure === "Todo completion metadata") row.todoCompletedAt = "now";
      if (failure === "Todo owner message metadata") row.todoAssistantMessageId = "";
      if (failure === "Todo owner session") row.todoAssistantSessionId = "ses_other";
      if (failure === "Todo owner role") row.todoAssistantRole = "user";
      if (failure === "assistant message metadata") row.assistantMessageId = "";
      if (failure === "assistant session") row.assistantSessionId = "ses_other";
      if (failure === "assistant role") row.assistantRole = "user";
      if (failure === "assistant agent") row.assistantAgent = "foreign agent";
      if (failure === "assistant provider") row.assistantProviderId = "private provider";
      if (failure === "assistant model") row.assistantModelId = "private model";
      if (failure === "assistant status") row.assistantStatus = "idle";
      if (failure === "known parent mismatch") f.parent.sessionId = "ses_other";
      if (failure === "unexpected row field") row.message = "private";
      const rows = failure === "zero matches" ? [] : failure === "multiple matches"
        ? [row, { ...row, sessionId: "ses_other",
          todoInput: JSON.stringify({ todos: strictLegacyTodos(f.parent, { session: "ses_other" }) }) }]
        : failure === "candidate overflow" ? Array.from({ length: 129 }, (_, index) => ({ ...row, sessionId: `ses_${index}` })) : [row];
      const stdout = Buffer.from(JSON.stringify(rows));
      const stderr = Buffer.from("private diagnostic");
      const execute = vi.fn(() => ({ status: 0, signal: null, stdout, stderr }));

      expect(shim.discoverLegacyRecoverySession(f.parent, binding, f.source, execute)).toBeNull();
      expect(stdout.every((byte) => byte === 0)).toBe(true);
      expect(stderr.every((byte) => byte === 0)).toBe(true);
    },
  );

  it.each(["session", "marker", "Todo owner", "assistant model"])("rejects changed %s metadata between bounded queries", async (change) => {
    const f = legacyFixture();
    Object.assign(f.parent, { port: null, sessionId: null, dataHome: join(root, ".local/share/opencode"),
      environment: { HOME: root } });
    f.inspect.mockReturnValue({ ...f.parent, commandName: "opencode", ports: [], nonce: undefined });
    f.todos.splice(0, f.todos.length, ...strictLegacyTodos(f.parent));
    const initial = legacyQueryRow(f.parent, f.todos);
    const changed = structuredClone(initial);
    if (change === "session") changed.sessionId = "ses_other";
    if (change === "marker") changed.todoInput = JSON.stringify({ todos: strictLegacyTodos(f.parent, { nextWork: "changed" }) });
    if (change === "Todo owner") changed.todoAssistantMessageId = "msg_changed_todo_owner";
    if (change === "assistant model") changed.assistantModelId = "gpt-5.6-luna";
    let calls = 0;
    const buffers: Buffer[] = [];
    const execute = vi.fn((_command: string, _args: string[]) => {
      const stdout = Buffer.from(JSON.stringify([calls++ === 0 ? initial : changed]));
      const stderr = Buffer.from("private diagnostic");
      buffers.push(stdout, stderr);
      return { status: 0, signal: null, stdout, stderr };
    });

    expect(await shim.captureLegacyRecoveryPreAdmission(f.parent, binding, f.source, f.request, f.inspect, execute)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.every(([, args]) => args[0] === "db")).toBe(true);
    expect(buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", { metadata: { exit: 0 } }, 0],
    ["nonzero", { metadata: { exitCode: 1 } }, 1],
    ["top-level exit", { exit_code: 0, metadata: {} }, 0],
    ["agreeing aliases", { code: 2, metadata: { exit: 2, exitCode: 2, exit_code: 2, code: 2 } }, 2],
    ["error with nonzero exit", { status: "error", metadata: { exit_code: 1 } }, 1],
    ["running", { status: "running", metadata: { exitCode: 0 } }, null],
  ] as const)("T65 F2 keeps %s shell outcomes identical to the strict handoff projection", async (_label, state, exitCode) => {
    for (const tool of ["bash", "shell"]) {
      const f = legacyFixture();
      const messages = f.payloads["/session/ses_exact/message"];
      messages[0].parts.push({ type: "tool", tool, state: { status: "completed", input: { command: "npm run test" }, ...state } });
      const result = await f.capture();
      const projected = f.project();
      expect(projected.checks).toEqual(exitCode === null ? [] : [expect.objectContaining({ exitCode,
        status: exitCode === 0 ? "completed" : "failed", result: exitCode === 0 ? "passed" : "failed" })]);
      expect(result.snapshot.operational.checks).toEqual(projected.checks);
      expect(result.snapshot.operational.actionsSha256).toBe(hash(shim.canonicalJson(projected.actions)));
      expect(result.summary.actionCount).toBe(exitCode === 0 ? 2 : 1);
      expect(result.summary.checkCount).toBe(exitCode === null ? 0 : 1);
      const nextWork = exitCode !== null && exitCode !== 0
        ? { kind: "address_failure", referenceHash: projected.checks[0]!.targetHash }
        : { kind: "continue_task", referenceHash: hash("task") };
      expect(projected.nextWork).toEqual(nextWork);
      expect(result.snapshot.operational.nextWork).toEqual(nextWork);
      expect(result.summary.nextWork).toEqual(nextWork);
    }
  });

  it("B2 preserves unknown and contradictory pre-admission outcomes", async () => {
    const input = { command: "npm run test -- private-command-canary" };
    const output = "private-output-canary";
    for (const tool of ["bash", "shell"]) for (const open of [false, true]) {
      for (const state of [{}, { metadata: { exitCode: "0" } }, { metadata: { exit: null } },
        { metadata: { exit: 256 } }, { exitCode: 0, metadata: [] }, { metadata: { exit: 0, exitCode: 1 } },
        { metadata: { exitCode: 1, code: 2 } }, { exitCode: 0, metadata: { exit: 1 } },
        { metadata: { exitCode: 0, code: null } }, { status: "error", metadata: { exitCode: 0 } }, { status: "error" }]) {
        const f = legacyFixture();
        if (!open) f.todos.splice(0);
        f.payloads["/session/ses_exact/message"][0].parts.push({ type: "tool", tool,
          state: { status: "completed", input, output, ...state } });
        const result = await f.capture();
        const projected = f.project();
        const referenceHash = hash(JSON.stringify({ kind: "unresolved_operation", result: "unknown",
          sourceTargetHash: hash(`${tool}\0${JSON.stringify(input)}`), previousHash: null }));
        expect(projected.nextWork).toEqual({ kind: "review_changes", referenceHash });
        expect(result.snapshot.operational.nextWork).toEqual(projected.nextWork);
        expect(result.summary.nextWork).toEqual(projected.nextWork);
        expect(result.snapshot.operational.checks).toEqual([]);
        expect(projected.checks).toEqual([]);
        expect(result.summary.actionCount).toBe(1);
        expect(result.snapshot.operational.actionsSha256).toBe(hash(shim.canonicalJson(projected.actions)));
        expect(projected.replay.todos).toEqual(stableRestartTodos(f.todos));
        const serialized = JSON.stringify({ result, projected });
        expect(serialized).not.toContain(input.command);
        expect(serialized).not.toContain(output);
      }
    }
  });

  it("B2 retains bounded unknown pre-admission references", async () => {
    const f = legacyFixture();
    const parts = f.payloads["/session/ses_exact/message"][0].parts;
    parts.push(
      { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "src/kept.ts" } } },
      { type: "tool", tool: "read", state: { status: "error", input: { filePath: "src/missing.ts" } } },
      ...[0, 1].map((exit) => ({ type: "tool", tool: "shell", state: { status: "completed",
        input: { command: "pwd" }, metadata: { exit } } })),
    );
    const unknown = Array.from({ length: 128 }, (_, index) => ({ type: "tool", tool: index % 2 ? "bash" : "shell",
      state: { status: "completed", input: { command: `private-command-${index}` }, output: `private-output-${index}`,
        metadata: index % 2 ? { exit: 0, exitCode: 1 } : {} } }));
    parts.push(...unknown);
    const result = await f.capture();
    const projected = f.project();
    expect(result.snapshot.operational.checks).toEqual([]);
    expect(result.summary.actionCount).toBe(3);
    const referenceHash = unknown.reduce<string | null>((previousHash, part) => hash(JSON.stringify({ kind: "unresolved_operation", result: "unknown",
      sourceTargetHash: hash(`${part.tool}\0${JSON.stringify(part.state.input)}`), previousHash })), null);
    expect(projected.nextWork).toEqual({ kind: "review_changes", referenceHash });
    expect(result.summary.nextWork).toEqual(projected.nextWork);
    expect(result.snapshot.operational.nextWork).toEqual(projected.nextWork);
    expect(JSON.stringify(projected.nextWork).length).toBeLessThan(128);
    const serialized = JSON.stringify({ result, projected });
    expect(serialized).not.toContain("private-command-");
    expect(serialized).not.toContain("private-output-");
    unknown[0]!.state.input.command = "changed-first-unresolved-command";
    const changed = await f.capture();
    expect(changed.summary.nextWork).toEqual(f.project().nextWork);
    expect(changed.summary.nextWork.referenceHash).not.toBe(referenceHash);
  });

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
  it("reads the exact prepared-owner path and schema used by the writer; preparation is not authorization", async () => {
    const f = preparationFixture();
    const contract = shim.prepareRecoveryOwnerContract(binding, head);
    expect(shim.inspectRecoveryOwnerStatus(contract, f.ownerOptions).status).toBe("unavailable");

    await f.prepare();

    expect(shim.inspectRecoveryOwnerStatus(contract, f.ownerOptions)).toMatchObject({ status: "attested", fence: 1,
      fenceState: "reserved", authorizesRestart: false, binding });
    expect(existsSync(join(f.directory, "owner-status.json"))).toBe(true);
    expect(existsSync(join(root, ".opencode/protected-runtime-index/tui-recovery/owner-status.json"))).toBe(false);
    const status = JSON.parse(readFileSync(join(f.directory, "owner-status.json"), "utf8"));
    json(join(f.directory, "owner-status.json"), { ...status, health: "unhealthy" });
    expect(shim.inspectRecoveryOwnerStatus(contract, f.ownerOptions).status).toBe("unavailable");
  });
});

function preparationFixture() {
  const f = legacyFixture();
  const script = join(root, "packages/ingenium-extension/scripts/recovery-bootstrap.js");
  mkdirSync(join(root, "packages/ingenium-extension/scripts"), { recursive: true });
  writeFileSync(script, "fixture", { mode: 0o644 });
  const source = { head, path: script, bytes: Buffer.from("fixture"), sha256: hash("fixture") };
  const sourceHandle = { source, revalidate: vi.fn(() => source), close: vi.fn() };
  const directory = join(root, ".opencode/protected-runtime-index/tui-recovery/preparation");
  const stagedSource = join(directory, "owner.mjs");
  const absent = "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nInvocationID=\nJob=\n";
  const active = "LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=101\nInvocationID=" + "a".repeat(32) + "\nJob=\n";
  let started = false;
  const owner = { pid: 101, startTimeTicks: 42, executableSha256: hash("exe"), cwd: root, commandName: "node",
    argv: ["node", stagedSource, "--recovery-preparation-owner"] };
  const run = vi.fn((command: string, args: string[], options: any) => {
    expect(options.shell).toBe(false);
    if (command === "/usr/bin/systemctl") {
      expect(args).toEqual(["--user", "show", "ingenium-recovery-owner.service", "--all", "--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Job"]);
      return started && !existsSync(join(directory, "rollback.json")) ? active : absent;
    }
    expect(command).toBe("/usr/bin/systemd-run");
    expect(args).toEqual(expect.arrayContaining(["--user", "--unit", "ingenium-recovery-owner.service", "--no-block", "--collect", "--property=Restart=no"]));
    expect(args.slice(-2)).toEqual([stagedSource, "--recovery-preparation-owner"]);
    const requestBytes = readFileSync(join(directory, "request.json"));
    const request = JSON.parse(requestBytes.toString());
    json(join(directory, "owner-status.json"), { schemaVersion: 1, requestSha256: hash(requestBytes), job: "ingenium-recovery-owner.service",
      invocationId: "a".repeat(32), owner: { pid: owner.pid, startTimeTicks: owner.startTimeTicks,
        executableSha256: owner.executableSha256, nonceSha256: hash(request.nonce) }, fence: 1, fenceState: "reserved",
      lease: { issuedAt: Date.now(), expiresAt: Date.now() + 50_000 }, health: "ready", authorizesRestart: false });
    started = true;
    return "";
  });
  const ownerOptions = { run, inspect: () => owner, environment: () => ({ INVOCATION_ID: "a".repeat(32) }) };
  const inspectOwner = vi.fn((request: any) => shim.inspectPreparedRecoveryOwner(request, ownerOptions));
  const collectInputs: any = vi.fn(async () => ({ binding, capture: await f.capture(), source, quarantine: null,
    contract: shim.prepareRecoveryOwnerContract(binding, head) }));
  const dependencies = { openSource: () => sourceHandle, collectInputs, run, inspectOwner, wait: async () => {} };
  return { ...f, directory, source, sourceHandle, run, ownerOptions, inspectOwner, collectInputs, dependencies,
    prepare: () => shim.runRecoveryPreparation(["node", script], dependencies) };
}

function managedPreparationLaunch() {
  const launcher = join(root, "ingenium-opencode");
  writeFileSync(launcher, "fixture launcher", { mode: 0o500 });
  const executable = realpathSync(process.execPath);
  const dataHome = join(root, ".local/share/opencode");
  mkdirSync(dataHome, { recursive: true, mode: 0o700 });
  return {
    schemaVersion: 1, kind: "legacy-managed-parent", sessionId: "ses_exact", dataHome,
    launcher: { path: launcher, sha256: hash(readFileSync(launcher)), releaseSha256: hash("release"), artifactSha256: hash("artifact") },
    executable: { path: executable, sha256: hash(readFileSync(executable)) },
    environment: { HOME: root, XDG_DATA_HOME: join(root, ".local/share/opencode"),
      INGENIUM_API_URL: environment.INGENIUM_API_URL, INGENIUM_PROJECT: binding.project, INGENIUM_PROJECT_ID: binding.projectId,
      INGENIUM_WORKSPACE_ID: binding.workspaceId, INGENIUM_STORAGE_MAPPING_HASH: binding.storageMappingHash,
      INGENIUM_WORKTREE: root, INGENIUM_MCP_AUDIENCE: "mcp", INGENIUM_MCP_CREDENTIAL_FILE: join(root, ".opencode/.ingenium-mcp-credential"),
      INGENIUM_MCP_CREDENTIAL_PURPOSE: "general", INGENIUM_OPENCODE_EXECUTABLE: executable },
  };
}

describe("fixed recovery preparation transaction", () => {
  it("persists the exact private recovery authentication before authenticated managed-parent health", async () => {
    const launch = managedPreparationLaunch();
    const request = { contract: shim.prepareRecoveryOwnerContract(binding, head), launch, nonce: "n".repeat(43),
      parent: { pid: 100, startTimeTicks: 10, executableSha256: launch.executable.sha256, nonceSha256: "0".repeat(64) },
      handoffSha256: hash("handoff"), issuedAt: Date.now() };
    let spawned: any;
    const child = { pid: 202, once: vi.fn(), kill: vi.fn() };
    const spawn = vi.fn((_path: string, _args: string[], options: any) => { spawned = options; return child; });
    const replacementNonce = "r".repeat(43);
    const inspect = (pid: number) => pid === 202
      ? { pid, parentPid: 101, startTimeTicks: 22, executableSha256: hash("node"), cwd: root, commandName: "node", argv: ["node"] }
      : { pid, parentPid: 202, startTimeTicks: 23, executableSha256: launch.executable.sha256, cwd: root, commandName: "opencode", argv: ["opencode"] };
    const processEnvironment = (pid: number) => pid === 202
      ? { INGENIUM_RECOVERY_PREPARATION_NONCE: request.nonce }
      : pid === 203 ? {
      INGENIUM_OPENCODE_PORT: "4099", INGENIUM_RESTART_NONCE: replacementNonce,
      OPENCODE_SERVER_PASSWORD: spawned.env.OPENCODE_SERVER_PASSWORD,
      INGENIUM_RECOVERY_PREPARATION_NONCE: request.nonce,
      INGENIUM_RECOVERY_OWNER_PID: "202", INGENIUM_RECOVERY_OWNER_START_TICKS: "22",
    } : {};
    const health = vi.fn(async (_url: string, init: RequestInit) => {
      const expected = `Basic ${Buffer.from(`opencode:${spawned.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`;
      expect(new Headers(init.headers).get("authorization") === expected).toBe(true);
      return new Response(JSON.stringify({ healthy: true, version: "1.0.0" }));
    });

    const control = await shim.startPreparedManagedParent(request, { spawn, inspect, environment: processEnvironment,
      children: () => [203], listeningPorts: () => [4099], request: health, wait: async () => {} });
    control.evidence = await control.refresh();

    expect(spawn).toHaveBeenCalledWith(launch.launcher.path, ["serve"], expect.objectContaining({ cwd: root, shell: false, stdio: "ignore" }));
    expect(control.evidence).toMatchObject({
      replacement: { pid: 203, port: 4099, dataHome: launch.dataHome }, health: { status: "healthy" },
      handoff: { sessionId: "ses_exact", sha256: request.handoffSha256, status: "captured" },
      rollback: { status: "armed", scope: "exact-owned-replacement" },
      adoption: { status: "pending", requires: "replacement-first-restart" },
      fencing: { current: 1, successorMinimum: 2, staleCalls: "reject" },
    });
    const authenticationPath = join(launch.dataHome, ".ingenium-recovery-server-auth.json");
    const authentication = JSON.parse(readFileSync(authenticationPath, "utf8"));
    const authenticationStat = lstatSync(authenticationPath);
    expect(Object.keys(authentication).sort()).toEqual(["password", "username"]);
    expect(authentication.username).toBe("opencode");
    expect(authentication.password === spawned.env.OPENCODE_SERVER_PASSWORD).toBe(true);
    expect(authenticationStat.mode & 0o777).toBe(0o600);
    expect(authenticationStat.uid).toBe(process.getuid!());
    expect(authenticationStat.nlink).toBe(1);
    expect(authenticationStat.isSymbolicLink()).toBe(false);
    expect(health).toHaveBeenCalledTimes(2);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("sends no authenticated health request when listener ownership is absent or changes", async () => {
    const launch = managedPreparationLaunch();
    const request = { contract: shim.prepareRecoveryOwnerContract(binding, head), launch, nonce: "n".repeat(43),
      parent: { pid: 100, startTimeTicks: 10, executableSha256: launch.executable.sha256, nonceSha256: "0".repeat(64) },
      handoffSha256: hash("handoff"), issuedAt: Date.now() };
    let spawned: any;
    let ownsListener = false;
    const child = { pid: 202, once: vi.fn(), kill: vi.fn() };
    const spawn = vi.fn((_path: string, _args: string[], options: any) => { spawned = options; return child; });
    const inspect = (pid: number) => pid === 202
      ? { pid, parentPid: 101, startTimeTicks: 22, executableSha256: hash("node"), cwd: root, commandName: "node", argv: ["node"] }
      : { pid, parentPid: 202, startTimeTicks: 23, executableSha256: launch.executable.sha256, cwd: root, commandName: "opencode", argv: ["opencode"] };
    const processEnvironment = (pid: number) => pid === 202
      ? { INGENIUM_RECOVERY_PREPARATION_NONCE: request.nonce }
      : { INGENIUM_OPENCODE_PORT: "4099", INGENIUM_RESTART_NONCE: "r".repeat(43),
        OPENCODE_SERVER_PASSWORD: spawned.env.OPENCODE_SERVER_PASSWORD,
        INGENIUM_RECOVERY_PREPARATION_NONCE: request.nonce,
        INGENIUM_RECOVERY_OWNER_PID: "202", INGENIUM_RECOVERY_OWNER_START_TICKS: "22" };
    const health = vi.fn(async () => new Response(JSON.stringify({ healthy: true, version: "1.0.0" })));
    const dependencies = { spawn, inspect, environment: processEnvironment, children: () => [203],
      listeningPorts: () => ownsListener ? [4099] : [], request: health, wait: async () => {} };

    await expect(shim.startPreparedManagedParent(request, dependencies)).rejects.toThrow("did not become healthy");
    expect(health).not.toHaveBeenCalled();
    expect(existsSync(join(launch.dataHome, ".ingenium-recovery-server-auth.json"))).toBe(false);

    ownsListener = true;
    const control = await shim.startPreparedManagedParent(request, dependencies);
    expect(health).toHaveBeenCalledOnce();
    ownsListener = false;
    await expect(control.refresh()).rejects.toThrow("identity changed");
    expect(health).toHaveBeenCalledOnce();
  });

  it("prepares a legacy-unenrolled managed replacement in one authorized transaction without signaling the old parent", async () => {
    const f = preparationFixture();
    const launch = managedPreparationLaunch();
    launch.executable.sha256 = f.parent.executableSha256;
    const captured = markedLegacyCapture(await f.capture(), f.parent);
    f.collectInputs.mockResolvedValue({ binding, capture: captured, source: f.source, quarantine: null, launch,
      contract: shim.prepareRecoveryOwnerContract(binding, head) });
    const normalRun = f.run.getMockImplementation()!;
    const replacementNonce = "r".repeat(43);
    f.run.mockImplementation((command, args, options) => {
      const result = normalRun(command, args, options);
      if (command === "/usr/bin/systemd-run") {
        const request = JSON.parse(readFileSync(join(f.directory, "request.json"), "utf8"));
        const statusPath = join(f.directory, "owner-status.json");
        const status = JSON.parse(readFileSync(statusPath, "utf8"));
        json(statusPath, { ...status, managed: {
          schemaVersion: 1,
          launcher: { pid: 202, startTimeTicks: 22, executableSha256: hash("node"), nonceSha256: hash(request.nonce) },
          replacement: { pid: 203, startTimeTicks: 23, executableSha256: launch.executable.sha256,
            nonceSha256: hash(replacementNonce), port: 4099, dataHome: launch.dataHome },
          health: { status: "healthy", checkedAt: Date.now(), versionSha256: hash("1.0.0") },
          handoff: { sessionId: launch.sessionId, sha256: request.handoffSha256, status: "captured" },
          ownership: { job: "ingenium-recovery-owner.service", ownerNonceSha256: hash(request.nonce), status: "external" },
          rollback: { status: "armed", scope: "exact-owned-replacement" },
          adoption: { status: "pending", requires: "replacement-first-restart" },
          fencing: { current: 1, successorMinimum: 2, staleCalls: "reject" },
        } });
      }
      return result;
    });
    const owner = { pid: 101, parentPid: 1, startTimeTicks: 42, executableSha256: hash("exe"), cwd: root,
      commandName: "node", argv: ["node", join(f.directory, "owner.mjs"), "--recovery-preparation-owner"] };
    const ownerOptions = f.ownerOptions as any;
    ownerOptions.inspect = (pid: number) => pid === 101 ? owner : pid === 202
      ? { pid, parentPid: 101, startTimeTicks: 22, executableSha256: hash("node"), cwd: root, commandName: "node", argv: ["node"] }
      : { pid, parentPid: 202, startTimeTicks: 23, executableSha256: launch.executable.sha256, cwd: root,
        commandName: "opencode", argv: ["opencode", "serve"] };
    ownerOptions.environment = (pid: number) => {
      const request = JSON.parse(readFileSync(join(f.directory, "request.json"), "utf8"));
      return pid === 101 ? { INVOCATION_ID: "a".repeat(32) }
        : pid === 202 ? { INGENIUM_RECOVERY_PREPARATION_NONCE: request.nonce }
          : { INGENIUM_RESTART_NONCE: replacementNonce, INGENIUM_OPENCODE_PORT: "4099" };
    };

    const result = await f.prepare();

    expect(result).toMatchObject({ status: "prepared", authorizesRestart: false, owner: { managed: {
      replacement: { pid: 203, port: 4099 }, health: { status: "healthy" },
      rollback: { status: "armed" }, adoption: { status: "pending" }, fencing: { staleCalls: "reject" },
    } } });
    expect(f.run.mock.calls.filter(([command]) => command === "/usr/bin/systemd-run")).toHaveLength(1);
    expect(new Set(f.run.mock.calls.map(([command]) => command))).toEqual(new Set(["/usr/bin/systemctl", "/usr/bin/systemd-run"]));
  });

  it("reconciles an absent unit exit only with complete unambiguous systemd properties", () => {
    const stdout = "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nInvocationID=\nJob=\n";
    expect(shim.inspectPreparationJob(() => { throw Object.assign(new Error("not found"), { status: 1, stdout }); }))
      .toMatchObject({ LoadState: "not-found", MainPID: "0", Job: "" });
    for (const output of [stdout.replace("MainPID=0", "MainPID=101"), stdout.replace("Job=\n", ""), `${stdout}Job=123\n`]) {
      expect(() => shim.inspectPreparationJob(() => { throw Object.assign(new Error("unavailable"), { status: 1, stdout: output }); })).toThrow();
    }
  });
  it("starts only the fixed passive owner, independently attests it, and retains protected transcript-free evidence", async () => {
    const f = preparationFixture();
    const result = await f.prepare();
    expect(result).toMatchObject({ action: "recovery-prepare", status: "prepared", authorizesRestart: false,
      owner: { status: "attested", job: "ingenium-recovery-owner.service", fence: 1, fenceState: "reserved", authorizesRestart: false } });
    expect(f.collectInputs).toHaveBeenCalledTimes(2);
    expect(f.sourceHandle.close).toHaveBeenCalledOnce();
    const retained = readFileSync(join(f.directory, "handoff.json"), "utf8");
    for (const content of ["private transcript", "private reasoning", "private tool arguments", "p".repeat(43), "c".repeat(43)]) {
      expect(retained + JSON.stringify(result)).not.toContain(content);
    }
    expect(readdirSync(join(root, ".opencode/protected-runtime-index/tui-recovery"))).toEqual(["preparation"]);
    const request = JSON.parse(readFileSync(join(f.directory, "request.json"), "utf8"));
    expect(JSON.stringify(result)).not.toContain(request.nonce);
    for (const changed of [{ ...request, sourceSha256: hash("foreign") }, { ...request, nonce: "x".repeat(43) }]) {
      expect(shim.inspectPreparedRecoveryOwner(changed, f.ownerOptions)).toBeNull();
    }
    const statusPath = join(f.directory, "owner-status.json");
    const status = JSON.parse(readFileSync(statusPath, "utf8"));
    for (const change of [{ fenceState: "active" }, { authorizesRestart: true }, { invocationId: "b".repeat(32) },
      { lease: { issuedAt: 1, expiresAt: 2 } }, { requestSha256: hash("foreign") }, { health: "unhealthy" }]) {
      json(statusPath, { ...status, ...change });
      expect(shim.inspectPreparedRecoveryOwner(request, f.ownerOptions)).toBeNull();
    }
  });

  it.each(["capture", "attestation", "final capture", "final source"])("rolls back only its preparation after %s failure", async (failure) => {
    const f = preparationFixture();
    if (failure === "capture") f.collectInputs.mockRejectedValue(new Error("private failure"));
    if (failure === "attestation") f.inspectOwner.mockReturnValue(null);
    if (failure === "final capture") f.collectInputs.mockImplementationOnce(async () => ({ binding, capture: await f.capture(), source: f.source,
      quarantine: null, contract: shim.prepareRecoveryOwnerContract(binding, head) })).mockRejectedValue(new Error("private capture failure"));
    if (failure === "final source") f.sourceHandle.revalidate.mockImplementationOnce(() => f.source).mockImplementation(() => { throw new Error("changed"); });
    await expect(f.prepare()).rejects.toMatchObject({ code: "RECOVERY_PREPARATION_ROLLED_BACK", authorizesRestart: false });
    expect(existsSync(join(root, ".opencode/protected-runtime-index"))).toBe(false);
    expect(f.sourceHandle.close).toHaveBeenCalledOnce();
  });

  it("preserves uncertain systemd start evidence and a durable rollback request without repeating or signaling", async () => {
    const f = preparationFixture();
    const normal = f.run.getMockImplementation()!;
    f.run.mockImplementation((command, args, options) => {
      const result = normal(command, args, options);
      if (command === "/usr/bin/systemd-run") throw new Error("uncertain manager transport");
      return result;
    });
    await expect(f.prepare()).rejects.toMatchObject({ code: "RECOVERY_PREPARATION_RECONCILIATION_REQUIRED", phase: "start", authorizesRestart: false });
    expect(existsSync(join(f.directory, "rollback.json"))).toBe(true);
    expect(existsSync(join(f.directory, "request.json"))).toBe(true);
    expect(f.run.mock.calls.filter(([command]) => command === "/usr/bin/systemd-run")).toHaveLength(1);
    expect(new Set(f.run.mock.calls.map(([command]) => command))).toEqual(new Set(["/usr/bin/systemctl", "/usr/bin/systemd-run"]));
  });

  it("rejects retained preparation and existing jobs without adopting or deleting them", async () => {
    const f = preparationFixture();
    mkdirSync(f.directory, { recursive: true, mode: 0o700 });
    json(join(f.directory, "foreign.json"), { preserve: true });
    await expect(f.prepare()).rejects.toMatchObject({ code: "RECOVERY_PREPARATION_ROLLED_BACK" });
    expect(readdirSync(f.directory)).toEqual(["foreign.json"]);
    expect(f.run.mock.calls.every(([command]) => command === "/usr/bin/systemctl")).toBe(true);
    await expect(shim.runRecoveryPreparation(["node", "script", "payload"], f.dependencies)).rejects.toThrow("no arguments");
  });

  it("runs the passive owner loop with a reserved fence and exits cooperatively on rollback without touching restart state", async () => {
    const f = preparationFixture();
    await f.prepare();
    rmSync(join(f.directory, "owner-status.json"));
    const owner = { pid: 101, startTimeTicks: 42, executableSha256: hash("exe") };
    let ticks = 0;
    const wait = vi.fn(async () => {
      ticks += 1;
      if (ticks === 2) json(join(f.directory, "rollback.json"), { authorizesRestart: false });
    });
    const stagedSource = join(f.directory, "owner.mjs");
    await shim.runPreparedRecoveryOwner(["node", stagedSource, "--recovery-preparation-owner"], {
      sourcePath: stagedSource, cwd: root, environment: { INVOCATION_ID: "a".repeat(32) },
      openSource: () => f.sourceHandle, inspect: (pid: number) => pid === f.parent.pid ? f.parent : owner,
      run: f.run, wait,
    });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(join(f.directory, "owner-status.json"), "utf8"))).toMatchObject({
      owner: { pid: 101 }, health: "ready", fence: 1, fenceState: "reserved", authorizesRestart: false,
    });
    expect(readdirSync(join(root, ".opencode/protected-runtime-index/tui-recovery"))).toEqual(["preparation"]);
    expect(existsSync(join(f.directory, "owner-status.next"))).toBe(false);
  });

  it("keeps the managed replacement under the external owner and stops only that owned replacement on rollback", async () => {
    const f = preparationFixture();
    const launch = managedPreparationLaunch();
    launch.executable.sha256 = f.parent.executableSha256;
    f.collectInputs.mockResolvedValue({ binding, capture: markedLegacyCapture(await f.capture(), f.parent), source: f.source, quarantine: null, launch,
      contract: shim.prepareRecoveryOwnerContract(binding, head) });
    f.inspectOwner.mockReturnValue({ status: "attested", authorizesRestart: false });
    await f.prepare();
    rmSync(join(f.directory, "owner-status.json"));
    const request = JSON.parse(readFileSync(join(f.directory, "request.json"), "utf8"));
    const owner = { pid: 101, startTimeTicks: 42, executableSha256: hash("exe") };
    const managed = {
      schemaVersion: 1,
      launcher: { pid: 202, startTimeTicks: 22, executableSha256: hash("node"), nonceSha256: hash(request.nonce) },
      replacement: { pid: 203, startTimeTicks: 23, executableSha256: launch.executable.sha256,
        nonceSha256: hash("r".repeat(43)), port: 4099, dataHome: launch.dataHome },
      health: { status: "healthy", checkedAt: Date.now(), versionSha256: hash("1.0.0") },
      handoff: { sessionId: launch.sessionId, sha256: request.handoffSha256, status: "captured" },
      ownership: { job: "ingenium-recovery-owner.service", ownerNonceSha256: hash(request.nonce), status: "external" },
      rollback: { status: "armed", scope: "exact-owned-replacement" },
      adoption: { status: "pending", requires: "replacement-first-restart" },
      fencing: { current: 1, successorMinimum: 2, staleCalls: "reject" },
    };
    const control = { refresh: vi.fn(async () => ({ ...managed, health: { ...managed.health, checkedAt: Date.now() } })) };
    const stopManagedParent = vi.fn();
    let ticks = 0;
    const wait = vi.fn(async () => { if (++ticks === 2) json(join(f.directory, "rollback.json"), { authorizesRestart: false }); });
    const stagedSource = join(f.directory, "owner.mjs");

    await shim.runPreparedRecoveryOwner(["node", stagedSource, "--recovery-preparation-owner"], {
      sourcePath: stagedSource, cwd: root, environment: { INVOCATION_ID: "a".repeat(32) },
      openSource: () => f.sourceHandle, inspect: (pid: number) => pid === f.parent.pid ? f.parent : owner,
      run: f.run, wait, startManagedParent: vi.fn(async () => control), stopManagedParent,
    });

    expect(control.refresh).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(join(f.directory, "owner-status.json"), "utf8"))).toMatchObject({
      managed: { replacement: { pid: 203 }, health: { status: "healthy" }, rollback: { status: "armed" } },
    });
    expect(stopManagedParent).toHaveBeenCalledOnce();
    expect(stopManagedParent.mock.calls[0]![0]).toMatchObject({ evidence: { replacement: { pid: 203 }, launcher: { pid: 202 } } });
  });

  it("refuses a foreign owner job and retains changed rollback evidence rather than deleting it", async () => {
    const f = preparationFixture();
    const normal = f.run.getMockImplementation()!;
    f.run.mockImplementation((command, args, options) => {
      const result = normal(command, args, options);
      if (command === "/usr/bin/systemd-run") {
        json(join(f.directory, "owner-status.json"), { owner: { nonceSha256: hash("foreign") }, requestSha256: hash("foreign") });
      }
      return result;
    });
    await expect(f.prepare()).rejects.toMatchObject({ code: "RECOVERY_PREPARATION_RECONCILIATION_REQUIRED", phase: "attest" });
    expect(JSON.parse(readFileSync(join(f.directory, "owner-status.json"), "utf8")).requestSha256).toBe(hash("foreign"));
    expect(existsSync(join(f.directory, "rollback.json"))).toBe(true);
    await expect(shim.runPreparedRecoveryOwner(["node", f.source.path, "--recovery-preparation-owner"], {
      sourcePath: f.source.path, cwd: root, environment: {},
    })).rejects.toThrow("invocation is invalid");
  });

  it("derives binding, source, active session and role from independent read-only probes before any mutation", async () => {
    const f = preparationFixture();
    const auth = authorityRequest();
    const request = async (url: string, init: RequestInit) => url.startsWith("http://127.0.0.1:4098") ? f.request(url)
      : url.endsWith("/health") ? new Response(JSON.stringify({ status: "ok" })) : auth(url, init);
    const inputs = await shim.collectPreparationInputs(f.sourceHandle, { environment: {}, request,
      ancestry: () => ({ status: "exact", parent: f.parent }), gitSummary: () => ({ status: "validated", head, sourceMatchesHead: true, dirtyPaths: [] }),
      inspectParent: f.inspect });
    expect(inputs).toMatchObject({ binding, quarantine: null, capture: { snapshot: { sessionId: "ses_exact", operational: { role: "ingenium-orchestrator" } } } });
    expect(existsSync(join(root, ".opencode/protected-runtime-index"))).toBe(false);
    f.parent.environment.INGENIUM_PROJECT = "foreign";
    await expect(shim.collectPreparationInputs(f.sourceHandle, { environment: {}, request,
      ancestry: () => ({ status: "exact", parent: f.parent }) })).rejects.toThrow("binding conflicts");
  });

  it("routes a fresh-nonce managed parent through current evidence and never legacy capture", async () => {
    const f = preparationFixture();
    const nonce = "n".repeat(43);
    f.parent.nonceSha256 = hash(nonce);
    f.parent.environment.INGENIUM_RESTART_NONCE = nonce;
    const capture = { snapshot: { parent: Object.fromEntries(["pid", "startTimeTicks", "executableSha256", "nonceSha256"]
      .map((key) => [key, f.parent[key]])) }, summary: { status: "working" } };
    const captureCurrent = vi.fn(async () => capture);
    const captureLegacy = vi.fn();
    const auth = authorityRequest();
    const request = async (url: string, init: RequestInit) => url.endsWith("/health")
      ? new Response(JSON.stringify({ status: "ok" })) : auth(url, init);

    const inputs = await shim.collectPreparationInputs(f.sourceHandle, { environment: {}, request,
      ancestry: () => ({ status: "exact", parent: f.parent }),
      gitSummary: () => ({ status: "validated", head, sourceMatchesHead: true, dirtyPaths: [] }),
      captureCurrent, captureLegacy });

    expect(inputs.capture).toBe(capture);
    expect(captureCurrent).toHaveBeenCalledOnce();
    expect(captureLegacy).not.toHaveBeenCalled();
    expect(existsSync(join(root, ".opencode/protected-runtime-index"))).toBe(false);
  });

  it("routes a legacy-unenrolled parent without a control-plane port to the attested external launcher", async () => {
    const f = preparationFixture();
    const parent = { ...f.parent, port: null, sessionId: "ses_exact", dataHome: join(root, ".local/share/opencode"),
      environment: { HOME: root } };
    const launch = managedPreparationLaunch();
    launch.executable.sha256 = parent.executableSha256;
    const capture = { snapshot: { parent: Object.fromEntries(["pid", "startTimeTicks", "executableSha256", "nonceSha256"]
      .map((key) => [key, parent[key]])) }, summary: { status: "working" } };
    const captureLegacy = vi.fn(async () => capture);
    const inspectLauncher = vi.fn(() => launch);
    const inspectDeployment = vi.fn(() => ({ status: "attested", revision: head }));
    const auth = authorityRequest();
    const request = async (url: string, init: RequestInit) => url.endsWith("/health")
      ? new Response(JSON.stringify({ status: "ok" })) : auth(url, init);

    const inputs = await shim.collectPreparationInputs(f.sourceHandle, { environment: {}, request,
      ancestry: () => ({ status: "exact", parent }), gitSummary: () => ({ status: "validated", head,
        sourceMatchesHead: true, dirtyPaths: [] }), captureLegacy, inspectLauncher, inspectDeployment });

    expect(inputs).toMatchObject({ capture, launch: { kind: "legacy-managed-parent", sessionId: "ses_exact" } });
    expect(inspectDeployment).toHaveBeenCalledOnce();
    expect(inspectLauncher).toHaveBeenCalledOnce();
    expect(captureLegacy).toHaveBeenCalledOnce();
    expect(existsSync(join(root, ".opencode/protected-runtime-index"))).toBe(false);
  });

  it("reports the exact inspect path when a fresh-nonce parent has no recovery control plane", async () => {
    const f = preparationFixture();
    const auth = authorityRequest();
    const request = async (url: string, init: RequestInit) => url.endsWith("/health")
      ? new Response(JSON.stringify({ status: "ok" })) : auth(url, init);
    const nonce = "n".repeat(43);
    const parent = { ...f.parent, port: null, nonceSha256: hash(nonce), environment: { ...f.parent.environment, INGENIUM_RESTART_NONCE: nonce } };
    const inspectFailure = await shim.collectPreparationInputs(f.sourceHandle, { environment: {}, request,
      ancestry: () => ({ status: "exact", parent }), gitSummary: () => ({ status: "validated", head,
        sourceMatchesHead: true, dirtyPaths: [] }) }).then(() => null, (error: unknown) => error);
    expect(inspectFailure).toMatchObject({ code: "RECOVERY_PREPARATION_PARENT_CONTROL_PLANE_UNAVAILABLE",
      failurePath: "inspect.parent_control_plane" });

    f.collectInputs.mockRejectedValue(inspectFailure);
    const preparationFailure = await f.prepare().then(() => null, (error: unknown) => error);
    expect(preparationFailure).toMatchObject({ code: "RECOVERY_PREPARATION_ROLLED_BACK", phase: "inspect",
      authorizesRestart: false, failure: { code: "RECOVERY_PREPARATION_PARENT_CONTROL_PLANE_UNAVAILABLE",
        path: "inspect.parent_control_plane" } });
    expect(shim.recoveryPreparationFailureOutput(preparationFailure)).toEqual({ action: "recovery-prepare",
      authorizesRestart: false, code: "RECOVERY_PREPARATION_FAILED", phase: "inspect",
      failure: { code: "RECOVERY_PREPARATION_PARENT_CONTROL_PLANE_UNAVAILABLE", path: "inspect.parent_control_plane" } });
    expect(JSON.stringify(shim.recoveryPreparationFailureOutput(Object.assign(new Error("private failure"), { phase: "inspect" }))))
      .not.toContain("private failure");
    expect(existsSync(join(root, ".opencode/protected-runtime-index"))).toBe(false);
  });
});

function recoveryAdmissionFixture(outboxQuarantine: any = null) {
  const nonce = "n".repeat(43);
  const executable = realpathSync(process.execPath);
  const parent = { pid: process.pid, startTimeTicks: 42, executableSha256: hash(readFileSync(executable)),
    nonceSha256: hash(nonce), sessionId: "ses_exact" };
  const preflight = { admissible: true, git: { head }, source: { sha256: hash("source") }, parent, binding,
    outbox: { status: "validated", count: outboxQuarantine ? 1 : 0, ambiguousCount: outboxQuarantine ? 1 : 0,
      sha256: outboxQuarantine?.recordSha256 ?? null, quarantine: outboxQuarantine },
    currentParent: { status: "validated", session: { incarnation: 2, revision: 4, fence: 3 } } };
  const digest = hash(shim.canonicalJson(preflight));
  const worktreeId = `worktree-${hash(`${binding.workspaceId}\0${binding.storageMappingHash}`)}`;
  const now = Date.now();
  const admission = {
    schema: "ingenium.recovery-admission", version: 1, action: "production-restart", preflightDigest: digest, head,
    parent: { pid: parent.pid, start: String(parent.startTimeTicks), executable, nonce, session: parent.sessionId },
    project: binding.project, projectId: binding.projectId, worktreeId, workspace: binding.workspaceId,
    storage: binding.storageMappingHash, worktree: root, issuedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(), revision: 1, fence: 7,
  };
  const calls: Array<{ path: string; body: any }> = [];
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input.toString()).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body });
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${"c".repeat(43)}`);
    if (path.endsWith("/register")) return new Response(JSON.stringify({ data: {
      session: { revision: 0, fence: 7, state: "active" }, memory: {},
    } }), { status: 201 });
    if (path.endsWith("/mint")) return new Response(JSON.stringify({ data: {
      session: { revision: 1, fence: 7, state: "active" }, admission, consumeToken: "t".repeat(43),
    } }), { status: 201 });
    if (path.endsWith("/snapshot")) return new Response(JSON.stringify({ data: {
      session: { revision: 1, fence: 7, state: "active" },
    } }), { status: 200 });
    if (path.endsWith("/close")) return new Response(JSON.stringify({ data: {
      session: { revision: 2, fence: 7, state: "closed" },
    } }), { status: 200 });
    throw new Error("unexpected request");
  });
  return { nonce, executable, parent, preflight, digest, now, admission, calls, request,
    path: join(root, "production-restart-admission.json"),
    options: { environment: { ...environment, INGENIUM_PROJECT_ID: binding.projectId,
      INGENIUM_STORAGE_MAPPING_HASH: binding.storageMappingHash }, parentEnvironment: () => ({ INGENIUM_RESTART_NONCE: nonce }),
    parentExecutable: executable, request, now } };
}

describe("secret-safe recovery admission bridge", () => {
  it("registers a fenced recovery incarnation, mints, and creates the owner-private production artifact", async () => {
    const f = recoveryAdmissionFixture();
    const created = await shim.mintRecoveryAdmissionArtifact(f.preflight, f.digest, f.path, f.options);

    expect(created).toMatchObject({ status: "created", pathSha256: hash(f.path), admissionSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(lstatSync(f.path).mode & 0o777).toBe(0o600);
    expect(shim.readRecoveryAdmission(f.path, f.preflight, f.digest, f.now)).toMatchObject({ incarnation: 3, admission: f.admission });
    const register = f.calls[0]!.body;
    const mint = f.calls[1]!.body;
    expect(f.calls.map(({ path }) => path)).toEqual(["/api/v1/coordination/register", "/api/v1/coordination/recovery-admissions/mint"]);
    expect(register).toMatchObject({ session_id: "ses_exact", incarnation: 3, ttl_ms: 900_000 });
    expect(mint).toMatchObject({ session_id: "ses_exact", incarnation: 3, expected_revision: 0, fence: 7,
      preflight_digest: f.digest, parent_nonce: f.nonce });
    const surfaced = JSON.stringify(created);
    for (const secret of [f.nonce, "c".repeat(43), register.ownership_token]) expect(surfaced).not.toContain(secret);
    expect(readFileSync(f.path, "utf8")).not.toContain(register.ownership_token);

    await created.rollback();
    expect(existsSync(f.path)).toBe(false);
    expect(f.calls.at(-1)).toMatchObject({ path: "/api/v1/coordination/close",
      body: { session_id: "ses_exact", incarnation: 3, expected_revision: 1, fence: 7, ownership_token: register.ownership_token } });
  });

  it("carries the exact overflow quarantine from preflight into the admitted restart context", async () => {
    const quarantine = Object.freeze({ schemaVersion: 1, status: "fenced", recordKey: COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY,
      recordSha256: hash("overflow record"), recordCount: 11_617 });
    const f = recoveryAdmissionFixture(quarantine);
    const sourceHandle = { source: { path: f.executable }, revalidate: vi.fn(() => ({ path: f.executable })), close: vi.fn() };
    const executeAdmitted = vi.fn(async (_argv: string[], context: any) => {
      expect(context.outboxQuarantine).toEqual(quarantine);
      expect(Object.isFrozen(context.outboxQuarantine)).toBe(true);
    });
    const consumeAdmission = vi.fn(async (record: any, expected: any) => Object.freeze({ ...expected,
      receipt: Object.freeze({ id: "22222222-2222-4222-8222-222222222222", schema: "ingenium.recovery-admission-receipt",
        version: 1, action: "production-restart", admissionDigest: hash(shim.canonicalJson(record.admission)),
        consumedAt: new Date(f.now).toISOString() }) }));

    await shim.runRecoveryBootstrapShim(["node", f.executable], { openSource: () => sourceHandle,
      collectPreflight: vi.fn(async () => f.preflight), admissionPath: f.path,
      mintAdmissionArtifact: (preflight: any, digest: string, path: string) => shim.mintRecoveryAdmissionArtifact(preflight, digest, path, f.options),
      consumeAdmission, postConsumeCheck: vi.fn(), executeAdmitted, now: () => f.now });

    expect(consumeAdmission.mock.calls[0]![1].outboxQuarantine).toEqual(quarantine);
    expect(executeAdmitted).toHaveBeenCalledOnce();
    expect(existsSync(f.path)).toBe(false);
    expect(sourceHandle.close).toHaveBeenCalledOnce();
  });

  it("closes its registered incarnation and leaves no artifact when minting fails", async () => {
    const f = recoveryAdmissionFixture();
    f.request.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(input.toString()).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      f.calls.push({ path, body });
      if (path.endsWith("/register")) return new Response(JSON.stringify({ data: {
        session: { revision: 0, fence: 7, state: "active" }, memory: {},
      } }), { status: 201 });
      if (path.endsWith("/mint")) return new Response(JSON.stringify({ error: { code: "RECOVERY_ADMISSION_CONFLICT" } }), { status: 409 });
      if (path.endsWith("/snapshot")) return new Response(JSON.stringify({ data: {
        session: { revision: 0, fence: 7, state: "active" },
      } }), { status: 200 });
      return new Response(JSON.stringify({ data: { session: { revision: 1, fence: 7, state: "closed" } } }), { status: 200 });
    });

    await expect(shim.mintRecoveryAdmissionArtifact(f.preflight, f.digest, f.path, f.options))
      .rejects.toThrow("Recovery admission creation failed");
    expect(f.calls.map(({ path }) => path)).toEqual(["/api/v1/coordination/register",
      "/api/v1/coordination/recovery-admissions/mint", "/api/v1/coordination/snapshot", "/api/v1/coordination/close"]);
    expect(existsSync(f.path)).toBe(false);
  });

  it("reconciles and closes the exact owned incarnation after an uncertain mint response", async () => {
    const f = recoveryAdmissionFixture();
    let revision = 0;
    f.request.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(input.toString()).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      f.calls.push({ path, body });
      if (path.endsWith("/register")) return new Response(JSON.stringify({ data: {
        session: { revision, fence: 7, state: "active" }, memory: {},
      } }), { status: 201 });
      if (path.endsWith("/mint")) { revision = 1; throw new Error("uncertain transport"); }
      if (path.endsWith("/snapshot")) return new Response(JSON.stringify({ data: {
        session: { revision, fence: 7, state: "active" },
      } }), { status: 200 });
      expect(body).toMatchObject({ expected_revision: 1, fence: 7 });
      return new Response(JSON.stringify({ data: { session: { revision: 2, fence: 7, state: "closed" } } }), { status: 200 });
    });

    await expect(shim.mintRecoveryAdmissionArtifact(f.preflight, f.digest, f.path, f.options))
      .rejects.toThrow("Recovery admission creation failed");
    expect(f.calls.map(({ path }) => path)).toEqual(["/api/v1/coordination/register",
      "/api/v1/coordination/recovery-admissions/mint", "/api/v1/coordination/snapshot", "/api/v1/coordination/close"]);
    expect(existsSync(f.path)).toBe(false);
  });

  it("retains the admission artifact when remote rollback cannot be reconciled", async () => {
    const f = recoveryAdmissionFixture();
    const created = await shim.mintRecoveryAdmissionArtifact(f.preflight, f.digest, f.path, f.options);
    f.request.mockRejectedValue(new Error("unavailable"));

    await expect(created.rollback()).rejects.toThrow("Recovery admission rollback requires reconciliation");
    expect(existsSync(f.path)).toBe(true);
    expect(shim.readRecoveryAdmission(f.path, f.preflight, f.digest, f.now)).toMatchObject({ admission: f.admission });
  });

  it("retains automatic rollback ownership through consume and post-consumption validation", async () => {
    for (const phase of ["consume", "post-consumption", "execution"] as const) {
      const f = recoveryAdmissionFixture();
      const events: string[] = [];
      const sourceHandle = { source: { path: f.executable }, revalidate: vi.fn(() => ({ path: f.executable })), close: vi.fn() };
      const consumeAdmission = vi.fn(async (record: any, expected: any) => {
        events.push("consume");
        if (phase === "consume") throw new Error("consume failed");
        return Object.freeze({ ...expected, receipt: Object.freeze({ id: "22222222-2222-4222-8222-222222222222",
          schema: "ingenium.recovery-admission-receipt", version: 1, action: "production-restart",
          admissionDigest: hash(shim.canonicalJson(record.admission)), consumedAt: new Date(f.now).toISOString() }) });
      });
      const postConsumeCheck = vi.fn(() => {
        events.push("post-consumption");
        expect(existsSync(f.path)).toBe(true);
        if (phase === "post-consumption") throw new Error("post-consumption failed");
      });
      const executeAdmitted = vi.fn(async () => {
        events.push("execution");
        expect(existsSync(f.path)).toBe(false);
        throw new Error("execution failed");
      });

      await expect(shim.runRecoveryBootstrapShim(["node", f.executable], { openSource: () => sourceHandle,
        collectPreflight: vi.fn(async () => f.preflight), admissionPath: f.path,
        mintAdmissionArtifact: (preflight: any, digest: string, path: string) => shim.mintRecoveryAdmissionArtifact(preflight, digest, path, f.options),
        consumeAdmission, postConsumeCheck, executeAdmitted, now: () => f.now }))
        .rejects.toThrow(`${phase} failed`);

      expect(events).toEqual(phase === "consume" ? ["consume"]
        : phase === "post-consumption" ? ["consume", "post-consumption"]
          : ["consume", "post-consumption", "execution"]);
      expect(f.calls.map(({ path }) => path)).toEqual(phase === "execution"
        ? ["/api/v1/coordination/register", "/api/v1/coordination/recovery-admissions/mint"]
        : ["/api/v1/coordination/register", "/api/v1/coordination/recovery-admissions/mint",
          "/api/v1/coordination/snapshot", "/api/v1/coordination/close"]);
      expect(existsSync(f.path)).toBe(false);
      expect(sourceHandle.close).toHaveBeenCalledOnce();
    }
  });

  it("carries one bounded prepared-parent fixture through replay acknowledgement, replacement adoption, and fencing", async () => {
    const preparation = preparationFixture();
    const f = recoveryAdmissionFixture();
    const parentIdentity = { pid: f.parent.pid, startTimeTicks: f.parent.startTimeTicks,
      executableSha256: f.parent.executableSha256, nonceSha256: f.parent.nonceSha256 };
    preparation.collectInputs.mockResolvedValue({ binding, source: preparation.source, quarantine: null,
      contract: shim.prepareRecoveryOwnerContract(binding, head), capture: { snapshot: { parent: parentIdentity } } });
    await preparation.prepare();
    expect(shim.inspectRecoveryOwnerStatus(shim.prepareRecoveryOwnerContract(binding, head), preparation.ownerOptions))
      .toMatchObject({ status: "attested", fence: 1, fenceState: "reserved", authorizesRestart: false });

    const oldDataHome = join(root, "old-data");
    mkdirSync(oldDataHome, { mode: 0o700 });
    const replacement = { pid: process.pid + 1, startTimeTicks: 84, executableSha256: f.parent.executableSha256,
      nonceSha256: hash("successor nonce") };
    const handoff = { replay: { sessionIdSha256: hash("ses_exact"), todos: [
      { id: "TODO-44", content: "Continue the admitted recovery", status: "in_progress", priority: "high" },
    ] }, status: "working", taskHash: hash("recovery task"), actions: [], changedPaths: [], checks: [],
    todos: { total: 1, pending: 0, inProgress: 1, completed: 0, cancelled: 0, state: "in_progress" },
    nextWork: { kind: "continue_task", referenceHash: hash("recovery task") } } as const;
    const request = { schemaVersion: 1, worktree: root,
      binding: { projectId: binding.projectId, workspaceId: binding.workspaceId, launcherWorktree: root,
        storageMappingHash: binding.storageMappingHash, audience: "mcp" },
      oldProcess: parentIdentity, oldPort: 4098, oldDataHome,
      replacement: { port: 4099, dataHome: join(root, "replacement-data"), expectedIdentity: {
        executableSha256: replacement.executableSha256, nonceSha256: replacement.nonceSha256 } }, handoff,
      timeouts: Object.fromEntries(["handoffMs", "launchMs", "identityMs", "healthMs", "sessionMs", "memoryAckMs",
        "terminalIdleMs", "retirementMs"].map((key) => [key, 1_000])) } as any;
    const phases: string[] = [];
    const signals: string[] = [];
    let fence = 7;
    let activeOwner = "old";
    let replacementResult: Awaited<ReturnType<typeof runReplacementFirstRestart>> | undefined;
    const executeAdmitted = vi.fn(async () => {
      replacementResult = await runReplacementFirstRestart(request, {
        revalidateBinding: async () => true,
        revalidateProcessIdentity: async () => true,
        persistHandoff: async (received) => { expect(received.replay.todos).toEqual(handoff.replay.todos); phases.push("handoff"); },
        launchReplacement: async ({ bindProvisionalIdentity }) => { bindProvisionalIdentity(replacement); phases.push("launched"); return replacement; },
        verifyReplacementHealth: async () => { expect(signals).toEqual([]); phases.push("healthy"); },
        createReplacementSession: async (_identity, _port, transactionSha256) => ({ status: "created", transactionSha256,
          session: { id: "successor" } }),
        acknowledgeTypedMemory: async (_identity, _session, handoffSha256, transactionSha256) => {
          expect(signals).toEqual([]); phases.push("memory"); return { status: "acknowledged", handoffSha256, transactionSha256 };
        },
        awaitTerminalIdleAcknowledgement: async (_identity, _session, handoffSha256, transactionSha256) => {
          expect(signals).toEqual([]); phases.push("idle");
          return { status: "idle", handoffSha256, transactionSha256, assistantResult: "completed" };
        },
        prepareRecoveryOwner: async (_identity, _session, _handoffSha256, transactionSha256) => {
          expect(signals).toEqual([]); activeOwner = "replacement"; phases.push("adopted");
          return { status: "ready", transactionSha256, replacementIdentitySha256: hash(JSON.stringify(replacement)) };
        },
        quiesceOldProcess: async () => {
          expect(signals).toEqual([]);
          expect(phases.filter((phase) => ["healthy", "memory", "idle", "adopted"].includes(phase)))
            .toEqual(["healthy", "memory", "idle", "adopted"]);
          signals.push("quiesced");
        },
        resumeOldProcess: async () => { throw new Error("old process must not resume after commit"); },
        prepareRetirement: async () => ({ rollback: async () => { throw new Error("committed retirement must not roll back"); } }),
        commitRetirement: async () => { expect(activeOwner).toBe("replacement"); expect(fence).toBe(7); fence += 1; phases.push("fenced"); },
        retireOldProcess: async () => { expect(fence).toBe(8); signals.push("retired"); },
        stopReplacement: async () => { throw new Error("healthy adopted replacement must not stop"); },
        persistEvidence: async ({ phase }) => { phases.push(phase); },
      });
    });
    const consumeAdmission = vi.fn(async (record: any, expected: any) => Object.freeze({ ...expected,
      receipt: Object.freeze({ id: "22222222-2222-4222-8222-222222222222", schema: "ingenium.recovery-admission-receipt",
        version: 1, action: "production-restart", admissionDigest: hash(shim.canonicalJson(record.admission)),
        consumedAt: new Date(f.now).toISOString() }) }));
    const sourceHandle = { source: preparation.source, revalidate: vi.fn(() => preparation.source), close: vi.fn() };

    await shim.runRecoveryBootstrapShim(["node", preparation.source.path], { openSource: () => sourceHandle,
      collectPreflight: vi.fn(async () => f.preflight), admissionPath: f.path,
      mintAdmissionArtifact: (preflight: any, digest: string, path: string) => shim.mintRecoveryAdmissionArtifact(preflight, digest, path, f.options),
      consumeAdmission, postConsumeCheck: vi.fn(), executeAdmitted, now: () => f.now });

    expect(executeAdmitted).toHaveBeenCalledOnce();
    expect(replacementResult).toMatchObject({ handoffSha256: hash(JSON.stringify(handoff)) });
    expect(replacementResult).not.toHaveProperty("recoveryState");
    expect(signals).toEqual(["quiesced", "retired"]);
    expect(activeOwner).toBe("replacement");
    expect(fence).toBe(8);
    expect(phases).toEqual(expect.arrayContaining(["memory", "idle", "adopted", "fenced", "old_parent_retired"]));
    expect(existsSync(f.path)).toBe(false);
    expect(sourceHandle.close).toHaveBeenCalledOnce();
  });
});

describe("preparation overflow quarantine", () => {
  function fixture() {
    const preparation = preparationFixture();
    const index = join(root, ".opencode/protected-runtime-index");
    mkdirSync(index, { mode: 0o700 });
    mkdirSync(join(index, "coordination-outbox"), { mode: 0o700 });
    const key = COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY;
    const record = { version: 1, key, operationId: hash("operation"), kind: "overflow", sessionHash: "0".repeat(64),
      createdAt: new Date().toISOString(), failure: "unavailable", revision: null, cursor: null, digest: hash("digest"),
      ambiguous: true, count: 11_617, mutation: null };
    const path = join(index, "coordination-outbox", `${key}.json`);
    json(path, record);
    const original = readFileSync(path);
    const quarantine = shim.planPreparationQuarantine(index);
    preparation.collectInputs.mockImplementation(async () => ({ binding, capture: await preparation.capture(),
      source: preparation.source, quarantine, contract: shim.prepareRecoveryOwnerContract(binding, head) }));
    return { preparation, index, key, record, path, original, quarantine };
  }

  it("carries exact key, hash, and count without disposition, authorization, replay, or byte changes", async () => {
    const f = fixture();

    expect(await f.preparation.prepare()).toMatchObject({ status: "prepared", authorizesRestart: false,
      quarantine: { schemaVersion: 1, status: "fenced", recordKey: f.key,
        recordSha256: hash(f.original), recordCount: 11_617 } });
    expect(readFileSync(f.path)).toEqual(f.original);
    expect(shim.summarizeCoordinationOutboxState(f.index).outbox).toMatchObject({ ambiguousCount: 1,
      quarantine: { recordKey: f.key, recordSha256: hash(f.original), recordCount: 11_617 } });
    expect(existsSync(join(f.index, "coordination-outbox-authorizations"))).toBe(false);
    expect(existsSync(join(f.index, "coordination-outbox-dispositions"))).toBe(false);
  });

  it.each(["exact", "changed"])('accepts exact retained evidence and rejects changed ambiguousCount: %s', async (state) => {
    const f = fixture();
    if (state === "changed") {
      const collect = f.preparation.collectInputs.getMockImplementation()!;
      f.preparation.collectInputs.mockImplementation(async () => {
        const inputs = await collect();
        return { ...inputs, quarantine: { ...inputs.quarantine, ambiguousCount: 0 } };
      });
    }

    const result = f.preparation.prepare();
    if (state === "exact") await expect(result).resolves.toMatchObject({ status: "prepared" });
    else await expect(result).rejects.toMatchObject({ code: "RECOVERY_PREPARATION_ROLLED_BACK", phase: "prepare" });
  });

  it.each(["count", "hash", "key"])("rejects %s drift and rolls back only owned preparation", async (drift) => {
    const f = fixture();
    const inspect = f.preparation.inspectOwner.getMockImplementation()!;
    f.preparation.inspectOwner.mockImplementation((request) => {
      const evidence = inspect(request);
      if (f.preparation.inspectOwner.mock.calls.length === 2) {
        if (drift === "count") json(f.path, { ...f.record, count: f.record.count + 1 });
        else if (drift === "hash") json(f.path, { ...f.record, digest: hash("changed") });
        else renameSync(f.path, join(f.index, "coordination-outbox", `${hash("foreign")}.json`));
      }
      return evidence;
    });

    await expect(f.preparation.prepare()).rejects.toMatchObject({ code: "RECOVERY_PREPARATION_ROLLED_BACK",
      phase: "confirm", authorizesRestart: false });
    expect(existsSync(f.preparation.directory)).toBe(false);
    expect(existsSync(join(f.index, "coordination-outbox-dispositions"))).toBe(false);
  });
});
