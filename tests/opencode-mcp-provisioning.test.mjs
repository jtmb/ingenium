import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, symlinkSync, unlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { provisionMcpCredential, provisionStartupCredentials } from "../scripts/provision-opencode-mcp-credential.mjs";
import { projectOpenCodeGlobalConfig } from "../scripts/project-opencode-global-config.mjs";

const token = `ing_${"a".repeat(12)}_${"b".repeat(43)}`;
const binding = {
  name: "Compatibility OpenCode", kind: "service", audience: "mcp", token,
  projectName: "ingenium", workspaceId: "shared-memory-ingenium", launcherWorktree: "/home/brajam/repos/ingenium",
  scopes: ["projects:read", "repository:sync", "documentation:read", "rag:read", "memory:read", "memory:write"],
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

test("private, atomic, idempotent provisioning rejects unsafe files and mismatched bindings", async () => {
  const root = mkdtempSync(join(tmpdir(), "ingenium-mcp-provision-test-"));
  try {
    mkdirSync(join(root, "bootstrap"), { mode: 0o700 });
    mkdirSync(join(root, "runtime"), { mode: 0o700 });
    const source = join(root, "bootstrap", "token");
    const destination = join(root, "runtime", "credential");
    writeFileSync(source, "c".repeat(64), { mode: 0o600 });
    const uid = process.getuid();
    const gid = process.getgid();
    const options = { source, destination, uid, gid, sourceUid: uid, sourceGid: gid, bootstrapUid: uid, bootstrapGid: gid,
      fetcher: async (url, request) => {
        assert.equal(url, "http://127.0.0.1:4097/api/v1/auth/bootstrap-mcp-credential");
        assert.equal(request.headers.authorization, `Bearer ${"c".repeat(64)}`);
        assert.equal(request.body, "{}");
        assert.equal(request.redirect, "error");
        return Response.json({ data: binding }, { status: 201 });
      },
    };
    await provisionMcpCredential(options);
    const first = statSync(destination);
    assert.equal(first.mode & 0o777, 0o600);
    assert.equal(first.uid, uid);
    assert.equal(readFileSync(destination, "utf8").trim(), token);
    await provisionMcpCredential(options);
    assert.equal(statSync(destination).ino, first.ino);
    await assert.rejects(provisionMcpCredential({ ...options, fetcher: async () => Response.json({ data: { ...binding, launcherWorktree: "/workspace" } }, { status: 201 }) }));
    chmodSync(destination, 0o644);
    await assert.rejects(provisionMcpCredential(options));
    unlinkSync(destination);
    symlinkSync(source, destination);
    await assert.rejects(provisionMcpCredential(options));
    assert.equal(readFileSync(source, "utf8"), "c".repeat(64));
    unlinkSync(destination);
    chmodSync(join(root, "runtime"), 0o750);
    await assert.rejects(provisionMcpCredential(options));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("projected config, launcher environment and same-path mount match the issued binding", () => {
  const root = mkdtempSync(join(tmpdir(), "ingenium-mcp-binding-test-"));
  try {
    const configPath = join(root, "opencode.json");
    projectOpenCodeGlobalConfig(configPath);
    const projected = JSON.parse(readFileSync(configPath, "utf8")).mcp.ingenium.environment;
    const expected = {
      INGENIUM_PROJECT: binding.projectName, INGENIUM_WORKSPACE_ID: binding.workspaceId,
      INGENIUM_WORKTREE: binding.launcherWorktree, INGENIUM_MCP_AUDIENCE: binding.audience,
      INGENIUM_MCP_CREDENTIAL_FILE: "/run/ingenium-opencode/.ingenium-mcp-credential",
      INGENIUM_MCP_CREDENTIAL_PURPOSE: "general",
    };
    for (const [key, value] of Object.entries(expected)) assert.equal(projected[key], value);
    const readyFile = join(root, "credential");
    writeFileSync(readyFile, token, { mode: 0o600 });
    const launcher = readFileSync(new URL("../scripts/start-opencode-web.sh", import.meta.url), "utf8")
      .replaceAll("sleep 1", ":")
      .replace(". /run/ingenium-runtime/environment", ":")
      .replace("node /app/scripts/probe-api.mjs", "true")
      .replace("[ ! -s /run/ingenium-opencode/.ingenium-mcp-credential ]", `[ ! -s ${readyFile} ]`)
      .replace("opencode serve --port 4098 --hostname 127.0.0.1", "/usr/bin/env");
    const launch = spawnSync("/bin/sh", ["-c", launcher], {
      encoding: "utf8", env: { INGENIUM_PROJECT: "wrong", INGENIUM_WORKSPACE_ID: "wrong", INGENIUM_API_TOKEN: "must-not-inherit", UNRELATED_SECRET: "must-not-inherit" },
    });
    assert.equal(launch.status, 0, launch.stderr);
    for (const [key, value] of Object.entries(expected)) assert.ok(launch.stdout.split("\n").includes(`${key}=${value}`));
    assert.ok(!launch.stdout.includes("must-not-inherit"));
    const supervisor = readFileSync(new URL("../supervisord.conf", import.meta.url), "utf8");
    const priority = (name) => Number(supervisor.split(`[program:${name}]`)[1].split("[program:")[0].match(/^priority=(\d+)$/m)[1]);
    assert.ok(priority("opencode-mcp-bootstrap") < priority("opencode-web"));
    assert.ok(launcher.indexOf(`[ ! -s ${readyFile} ]`) < launcher.indexOf("exec env -i"));
    const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
    assert.ok(compose.includes('"${HOME}/repos/ingenium:/home/brajam/repos/ingenium"'));
    assert.ok(compose.includes('/repos:/workspace"'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("local capability and validated launcher identity are installed privately without changing the general credential", async () => {
  const root = mkdtempSync(join(tmpdir(), "ingenium-local-runtime-test-"));
  try {
    const uid = process.getuid(), gid = process.getgid();
    const source = join(root, "token"), destination = join(root, "capability");
    writeFileSync(source, "c".repeat(64), { mode: 0o600 });
    const id = "11111111-1111-4111-8111-111111111111";
    const credential = { ...binding, name: `Runtime ${id}`, kind: "runtime", audience: "runtime",
      scopes: ["child-mcp:runtime", "child-mcp:execute", "mcp-servers:write", "projects:read", "documentation:read", "rag:read", "memory:write"],
      createdByUserId: id, organizationId: id, projectId: id, securityEpoch: 0, storageMappingHash: "a".repeat(64) };
    const runtime = { id, state: "READY", backendContainerId: null, ownerUserId: id, organizationId: id,
      projectId: id, workspaceId: binding.workspaceId, securityEpoch: 0 };
    const options = { source, destination, uid, gid, sourceUid: uid, sourceGid: gid, bootstrapUid: uid, bootstrapGid: gid, runtime: true,
      fetcher: async (url) => {
        assert.ok(url.endsWith("/auth/bootstrap-local-runtime"));
        return Response.json({ data: { runtime, credential, runtimeWorktree: "/workspace" } }, { status: 201 });
      } };
    await provisionMcpCredential(options);
    const inode = statSync(destination).ino;
    await provisionMcpCredential(options);
    assert.equal(statSync(destination).ino, inode);
    assert.equal(statSync(destination).mode & 0o777, 0o600);
    const environment = join(root, "environment");
    assert.equal(statSync(environment).mode & 0o777, 0o600);
    assert.ok(!readFileSync(environment, "utf8").includes(token));
    const launcher = readFileSync(new URL("../scripts/start-opencode-web.sh", import.meta.url), "utf8")
      .replace("[ ! -s /run/ingenium-opencode/.ingenium-mcp-credential ]", "[ 1 = 0 ]")
      .replaceAll("/run/ingenium-runtime/environment", environment)
      .replace("[ -s /run/ingenium-runtime/capability ]", `[ -s ${destination} ]`)
      .replace("node /app/scripts/probe-api.mjs", "true")
      .replace("opencode serve --port 4098 --hostname 127.0.0.1", "/usr/bin/env");
    const launch = spawnSync("/bin/sh", ["-c", launcher], { encoding: "utf8", env: {} });
    assert.equal(launch.status, 0, launch.stderr);
    for (const value of [`INGENIUM_RUNTIME_ID=${id}`, `INGENIUM_PROJECT_ID=${id}`, "INGENIUM_MCP_AUDIENCE=runtime",
      "INGENIUM_WORKTREE=/workspace", "INGENIUM_RUNTIME_CREDENTIAL_FILE=/run/ingenium-runtime/capability",
      "INGENIUM_MCP_CREDENTIAL_FILE=/run/ingenium-opencode/.ingenium-mcp-credential"]) assert.ok(launch.stdout.split("\n").includes(value));
    const configLine = launch.stdout.split("\n").find(line => line.startsWith("OPENCODE_CONFIG_CONTENT="));
    assert.equal(JSON.parse(configLine.slice("OPENCODE_CONFIG_CONTENT=".length)).mcp.ingenium.environment.INGENIUM_WORKTREE, "/workspace");
    await assert.rejects(provisionMcpCredential({ ...options, fetcher: async () => Response.json({ data: { runtime, credential, runtimeWorktree: binding.launcherWorktree } }, { status: 201 }) }));
    await assert.rejects(provisionMcpCredential({ ...options, fetcher: async () => Response.json({ data: { runtime: { ...runtime, projectId: "wrong" }, credential, runtimeWorktree: "/workspace" } }, { status: 201 }) }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("runtime provisioning failure preserves the general credential and reports only a safe diagnostic", async () => {
  const root = mkdtempSync(join(tmpdir(), "ingenium-degraded-runtime-test-"));
  try {
  const capability = join(root, "capability"), environment = join(root, "environment");
  writeFileSync(capability, token, { mode: 0o600 });
  writeFileSync(environment, "INGENIUM_RUNTIME_ID='stale'", { mode: 0o600 });
  const calls = [], diagnostics = [];
  await provisionStartupCredentials(async options => {
    assert.equal(existsSync(capability), false);
    assert.equal(existsSync(environment), false);
    calls.push(options?.runtime ? "runtime" : "general");
    if (options?.runtime) {
      writeFileSync(capability, token, { mode: 0o600 });
      throw new Error("secret-response-body");
    }
  }, line => diagnostics.push(line), root);
  assert.equal(existsSync(capability), false);
  assert.equal(existsSync(environment), false);
  const launcher = readFileSync(new URL("../scripts/start-opencode-web.sh", import.meta.url), "utf8")
    .replaceAll("sleep 1", ":")
    .replace("[ ! -s /run/ingenium-opencode/.ingenium-mcp-credential ]", "[ 1 = 0 ]")
    .replaceAll("/run/ingenium-runtime/environment", environment)
    .replaceAll("/run/ingenium-runtime/capability", capability)
    .replace("node /app/scripts/probe-api.mjs", "true")
    .replace("opencode serve --port 4098 --hostname 127.0.0.1", "/usr/bin/env");
  const launch = spawnSync("/bin/sh", ["-c", launcher], { encoding: "utf8", env: { INGENIUM_RUNTIME_ID: "stale" } });
  assert.equal(launch.status, 0, launch.stderr);
  assert.ok(launch.stdout.includes("INGENIUM_MCP_CREDENTIAL_PURPOSE=general\n"));
  assert.ok(launch.stdout.includes("INGENIUM_MCP_AUDIENCE=mcp\n"));
  assert.ok(!launch.stdout.includes("INGENIUM_RUNTIME_ID="));
  assert.ok(!launch.stdout.includes("INGENIUM_RUNTIME_CREDENTIAL_FILE="));
  assert.deepEqual(calls, ["general", "runtime"]);
  assert.deepEqual(diagnostics, ["MCP_BOOTSTRAP_DEGRADED stage=local-runtime code=PROVISION_FAILED"]);
  diagnostics.length = 0;
  await provisionStartupCredentials(async () => {}, line => diagnostics.push(line), root);
  assert.deepEqual(diagnostics, ["MCP_BOOTSTRAP_READY"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
