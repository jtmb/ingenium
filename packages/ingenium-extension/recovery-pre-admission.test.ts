import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY, COORDINATION_OUTBOX_OVERFLOW_AUTHORITY_SHA256 } from "./coordination-outbox.js";
import { stableRestartTodos } from "./replacement-first-restart.js";
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

describe("legacy pre-admission capture", () => {
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
  const collectInputs = vi.fn(async () => ({ binding, capture: await f.capture(), source, disposition: null,
    contract: shim.prepareRecoveryOwnerContract(binding, head) }));
  const dependencies = { openSource: () => sourceHandle, collectInputs, run, inspectOwner, wait: async () => {} };
  return { ...f, directory, source, sourceHandle, run, ownerOptions, inspectOwner, collectInputs, dependencies,
    prepare: () => shim.runRecoveryPreparation(["node", script], dependencies) };
}

describe("fixed recovery preparation transaction", () => {
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
      disposition: null, contract: shim.prepareRecoveryOwnerContract(binding, head) })).mockRejectedValue(new Error("private capture failure"));
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
    expect(inputs).toMatchObject({ binding, disposition: null, capture: { snapshot: { sessionId: "ses_exact", operational: { role: "ingenium-orchestrator" } } } });
    expect(existsSync(join(root, ".opencode/protected-runtime-index"))).toBe(false);
    f.parent.environment.INGENIUM_PROJECT = "foreign";
    await expect(shim.collectPreparationInputs(f.sourceHandle, { environment: {}, request,
      ancestry: () => ({ status: "exact", parent: f.parent }) })).rejects.toThrow("binding conflicts");
  });
});

describe("preparation disposition authorization", () => {
  it.each(["concurrent authorized overflow", "final disposition mismatch"])(
    "rejects final outbox drift and rolls back owned preparation: %s", async (change) => {
      const f = preparationFixture();
      const index = join(root, ".opencode/protected-runtime-index");
      for (const path of [index, ...["coordination-outbox", "coordination-outbox-authorizations", "coordination-outbox-dispositions"]
        .map((name) => join(index, name))]) mkdirSync(path, { mode: 0o700 });
      const key = COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY;
      const now = Date.now();
      const original = Buffer.from(JSON.stringify({ version: 1, key, operationId: hash("concurrent operation"), kind: "overflow",
        sessionHash: "0".repeat(64), createdAt: new Date(now).toISOString(), failure: "unavailable", revision: null,
        cursor: null, digest: hash("digest"), ambiguous: true, count: 4, mutation: null }));
      const recordPath = join(index, "coordination-outbox", `${key}.json`);
      const authPath = join(index, "coordination-outbox-authorizations", `${key}.json`);
      json(authPath, { schemaVersion: 1, authorizationId: COORDINATION_OUTBOX_OVERFLOW_AUTHORITY_SHA256, recordKey: key,
        mode: "abandon_identityless_overflow", authority: "explicit_user_authorization", scope: "exact_key_same_record_family",
        reason: "nonrecoverable_identityless_overflow", issuedAt: new Date(now - 1_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString() });
      const originalAuth = readFileSync(authPath);
      if (change === "concurrent authorized overflow") {
        const collect = f.collectInputs.getMockImplementation()!;
        f.collectInputs.mockImplementation(async () => {
          const inputs = await collect();
          if (f.collectInputs.mock.calls.length === 2) writeFileSync(recordPath, original, { mode: 0o600 });
          return { ...inputs, disposition: shim.planPreparationDisposition(index) };
        });
      } else {
        writeFileSync(recordPath, original, { mode: 0o600 });
        const plan = shim.planPreparationDisposition(index);
        json(plan.destination, plan.disposition);
        const inspect = f.inspectOwner.getMockImplementation()!;
        f.inspectOwner.mockImplementation((request) => {
          const evidence = inspect(request);
          if (f.inspectOwner.mock.calls.length === 2) {
            json(plan.destination, { ...plan.disposition, createdAt: new Date(Date.parse(plan.disposition.createdAt) + 1).toISOString() });
          }
          return evidence;
        });
      }
      expect(shim.summarizeCoordinationOutboxState(index).outbox.ambiguousCount).toBe(0);
      await expect(f.prepare()).rejects.toMatchObject({ code: "RECOVERY_PREPARATION_ROLLED_BACK", phase: "confirm", authorizesRestart: false });
      expect(existsSync(f.directory)).toBe(false);
      expect(existsSync(join(index, "tui-recovery"))).toBe(false);
      expect(readFileSync(recordPath)).toEqual(original);
      expect(readFileSync(authPath)).toEqual(originalAuth);
      expect(shim.summarizeCoordinationOutboxState(index).outbox.ambiguousCount).toBe(change === "concurrent authorized overflow" ? 1 : 0);
      expect(f.sourceHandle.close).toHaveBeenCalledOnce();
    },
  );

  it.each(["success", "attestation", "uncertain start", "changed count", "changed operation"])(
    "pins existing authorization and immutable original bytes through %s", async (outcome) => {
    const f = preparationFixture();
    const index = join(root, ".opencode/protected-runtime-index");
    for (const path of [index, join(index, "coordination-outbox"), join(index, "coordination-outbox-authorizations")]) mkdirSync(path, { mode: 0o700 });
    const key = COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY;
    const record = { version: 1, key, operationId: hash("operation"), kind: "overflow", sessionHash: "0".repeat(64),
      createdAt: new Date().toISOString(), failure: "unavailable", revision: null, cursor: null, digest: hash("digest"), ambiguous: true, count: 4, mutation: null };
    const path = join(index, "coordination-outbox", `${key}.json`);
    json(path, record);
    const original = readFileSync(path);
    expect(() => shim.planPreparationDisposition(index)).toThrow();
    const authPath = join(index, "coordination-outbox-authorizations", `${key}.json`);
    const authorization = { schemaVersion: 1, authorizationId: COORDINATION_OUTBOX_OVERFLOW_AUTHORITY_SHA256, recordKey: key,
      mode: "abandon_identityless_overflow", authority: "explicit_user_authorization", scope: "exact_key_same_record_family",
      reason: "nonrecoverable_identityless_overflow", issuedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    json(authPath, authorization);
    const originalAuth = readFileSync(authPath);
    const plan = shim.planPreparationDisposition(index);
    expect(plan.disposition).toMatchObject({ schemaVersion: 2, recordSha256: hash(original), recordCount: 4, operationId: record.operationId,
      authorizationSha256: hash(originalAuth) });
    for (const change of [{ expiresAt: new Date(1).toISOString() }, { recordKey: hash("foreign") }, { scope: "arbitrary" }, { authorizationId: hash("foreign") }]) {
      json(authPath, { ...authorization, ...change });
      expect(() => shim.planPreparationDisposition(index)).toThrow();
    }
    writeFileSync(authPath, originalAuth);
    f.collectInputs.mockImplementation(async () => ({ binding, capture: await f.capture(), source: f.source,
      disposition: plan, contract: shim.prepareRecoveryOwnerContract(binding, head) }));
    if (outcome === "attestation") f.inspectOwner.mockReturnValue(null);
    if (outcome === "uncertain start") {
      const normal = f.run.getMockImplementation()!;
      f.run.mockImplementation((command, args, options) => {
        const result = normal(command, args, options);
        if (command === "/usr/bin/systemd-run") throw new Error("uncertain start");
        return result;
      });
    }
    if (outcome === "changed count") json(path, { ...record, count: 5 });
    if (outcome === "changed operation") json(path, { ...record, operationId: hash("changed") });
    const expectedOriginal = readFileSync(path);
    if (outcome === "success") {
      expect(await f.prepare()).toMatchObject({ status: "prepared", authorizesRestart: false,
        disposition: { recordSha256: hash(original), recordCount: 4 } });
      expect(shim.summarizeCoordinationOutboxState(index).outbox.ambiguousCount).toBe(0);
    } else {
      await expect(f.prepare()).rejects.toMatchObject({ code: outcome === "uncertain start"
        ? "RECOVERY_PREPARATION_RECONCILIATION_REQUIRED" : "RECOVERY_PREPARATION_ROLLED_BACK" });
      expect(existsSync(plan.destination)).toBe(false);
      expect(existsSync(f.directory)).toBe(outcome === "uncertain start");
    }
    expect(readFileSync(path)).toEqual(expectedOriginal);
    expect(readFileSync(authPath)).toEqual(originalAuth);
  });
});
