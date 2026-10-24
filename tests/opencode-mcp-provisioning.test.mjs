import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, symlinkSync, unlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { BootstrapUnavailableError, provisionMcpCredential, provisionStartupCredentials, runStartupBootstrap } from "../scripts/provision-opencode-mcp-credential.mjs";
import { projectOpenCodeGlobalConfig } from "../scripts/project-opencode-global-config.mjs";

const token = `ing_${"a".repeat(12)}_${"b".repeat(43)}`;
const binding = {
  name: "Compatibility OpenCode", kind: "service", audience: "mcp", token,
  projectName: "ingenium", workspaceId: "shared-memory-ingenium", launcherWorktree: "/home/brajam/repos/ingenium",
  scopes: ["projects:read", "repository:sync", "documentation:read", "rag:read", "memory:read", "memory:write"],
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

test("cold bootstrap survives the former readiness deadline and a transient provisioning failure automatically", async () => {
  const root = mkdtempSync(join(tmpdir(), "ingenium-cold-bootstrap-test-"));
  const runtimeDirectory = join(root, "runtime");
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  mkdirSync(join(root, "bootstrap"), { mode: 0o700 });
  mkdirSync(join(root, "general"), { mode: 0o700 });
  const source = join(root, "bootstrap", "token"), destination = join(root, "general", "credential");
  writeFileSync(source, "c".repeat(64), { mode: 0o600 });
  for (const name of ["environment", "capability"]) writeFileSync(join(runtimeDirectory, name), "stale", { mode: 0o600 });
  let healthRequests = 0, generalRequests = 0;
  const delays = [], diagnostics = [];
  const server = createServer((request, response) => {
    assert.equal(existsSync(join(runtimeDirectory, "environment")), false);
    if (request.url === "/api/v1/health") {
      response.writeHead(++healthRequests <= 65 ? 503 : 200).end();
    } else {
      assert.equal(request.url, "/api/v1/auth/bootstrap-mcp-credential");
      assert.equal(request.headers.authorization, `Bearer ${"c".repeat(64)}`);
      response.writeHead(++generalRequests === 1 ? 503 : 201, { "content-type": "application/json" })
        .end(JSON.stringify({ data: binding }));
    }
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const fetcher = (url, options) => fetch(url.replace("127.0.0.1:4097", `127.0.0.1:${server.address().port}`), options);
    const uid = process.getuid(), gid = process.getgid();
    await runStartupBootstrap({
      runtimeDirectory, fetcher, wait: async delay => { delays.push(delay); }, report: line => diagnostics.push(line),
      provision: options => {
        if (options?.runtime) throw new Error("secret-runtime-response");
        return provisionMcpCredential({ source, destination, uid, gid, sourceUid: uid, sourceGid: gid, bootstrapUid: uid, bootstrapGid: gid, fetcher });
      },
    });
    assert.equal(healthRequests, 66);
    assert.equal(generalRequests, 2);
    assert.equal(readFileSync(destination, "utf8").trim(), token);
    assert.equal(statSync(destination).mode & 0o777, 0o600);
    assert.deepEqual(delays.slice(0, 6), [1000, 2000, 4000, 8000, 15000, 15000]);
    assert.equal(Math.max(...delays), 15000);
    assert.equal(diagnostics.some(line => line.includes("secret")), false);
    assert.equal(diagnostics.at(-1), "MCP_BOOTSTRAP_DEGRADED stage=local-runtime code=PROVISION_FAILED");
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    rmSync(root, { recursive: true, force: true });
  }
});

test("bootstrap retries network errors but stops on readiness authorization failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "ingenium-bootstrap-auth-test-"));
  try {
    let probes = 0, provisions = 0;
    const delays = [], diagnostics = [];
    await assert.rejects(runStartupBootstrap({
      runtimeDirectory: root,
      fetcher: async () => { if (++probes === 1) throw new Error("secret-network-detail"); return new Response(null, { status: 403 }); },
      provision: async () => { provisions++; }, wait: async delay => { delays.push(delay); }, report: line => diagnostics.push(line),
    }), /readiness rejected/);
    assert.equal(probes, 2);
    assert.equal(provisions, 0);
    assert.deepEqual(delays, [1000]);
    assert.deepEqual(diagnostics, ["MCP_BOOTSTRAP_WAIT stage=api attempt=1 retryInMs=1000"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("permanent general failures are not retried and optional runtime availability has a bounded fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "ingenium-bootstrap-retry-test-"));
  try {
    let calls = 0;
    const options = { runtimeDirectory: root, fetcher: async () => new Response(null, { status: 200 }), wait: async () => { throw new Error("Unexpected retry"); }, report: () => {} };
    await assert.rejects(runStartupBootstrap({ ...options, provision: async () => { calls++; throw new Error("Binding mismatch"); } }), /Binding mismatch/);
    assert.equal(calls, 1);
    const delays = [], diagnostics = [];
    calls = 0;
    await runStartupBootstrap({ ...options,
      wait: async delay => { delays.push(delay); }, report: line => diagnostics.push(line),
      provision: async value => {
        calls++;
        if (value?.runtime) {
          writeFileSync(join(root, "capability"), token, { mode: 0o600 });
          throw new BootstrapUnavailableError("secret-upstream-detail");
        }
      },
    });
    assert.equal(calls, 4);
    assert.deepEqual(delays, [1000, 2000]);
    assert.equal(existsSync(join(root, "capability")), false);
    assert.equal(existsSync(join(root, "environment")), false);
    assert.equal(diagnostics.at(-1), "MCP_BOOTSTRAP_DEGRADED stage=local-runtime code=PROVISION_FAILED");
    assert.equal(diagnostics.some(line => line.includes("secret")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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
    for (const status of [408, 429, 500, 503]) {
      await assert.rejects(provisionMcpCredential({ ...options, fetcher: async () => new Response(null, { status }) }), BootstrapUnavailableError);
    }
    for (const status of [400, 401, 403, 404]) {
      await assert.rejects(provisionMcpCredential({ ...options, fetcher: async () => new Response(null, { status }) }), error => !(error instanceof BootstrapUnavailableError));
    }
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
    const projected = JSON.parse(readFileSync(configPath, "utf8")).mcp.servers.ingenium.environment;
    const expected = {
      INGENIUM_PROJECT: binding.projectName, INGENIUM_WORKSPACE_ID: binding.workspaceId,
      INGENIUM_WORKTREE: binding.launcherWorktree, INGENIUM_MCP_AUDIENCE: binding.audience,
      INGENIUM_MCP_CREDENTIAL_FILE: "/run/ingenium-opencode/.ingenium-mcp-credential",
      INGENIUM_MCP_CREDENTIAL_PURPOSE: "general",
    };
    for (const [key, value] of Object.entries(expected)) assert.equal(projected[key], value);
    const readyFile = join(root, "credential");
    writeFileSync(readyFile, token, { mode: 0o600 });
    const environment = join(root, "environment");
    const capability = join(root, "capability");
    const launcher = readFileSync(new URL("../scripts/start-opencode-web.sh", import.meta.url), "utf8")
      .replace('opencode_server_password="$(cat /run/ingenium-secrets/opencode/opencode-server-password)"', 'opencode_server_password="test-password"')
      .replaceAll("sleep 1", ":")
      .replaceAll("/run/ingenium-runtime/environment", environment)
      .replaceAll("/run/ingenium-runtime/capability", capability)
      .replace("node /app/scripts/probe-api.mjs", "true")
      .replace("[ ! -s /run/ingenium-opencode/.ingenium-mcp-credential ]", `[ ! -s ${readyFile} ]`)
      .replace("opencode serve --port 4098 --hostname 127.0.0.1", "/usr/bin/env");
    assert.ok(!launcher.includes("$(cat /run/ingenium-secrets/opencode/opencode-server-password)"));
    assert.ok(!launcher.includes("/run/ingenium-runtime/environment"));
    assert.ok(!launcher.includes("[ -s /run/ingenium-runtime/capability ]"));
    const launch = spawnSync("/bin/sh", ["-c", launcher], {
      encoding: "utf8", env: { INGENIUM_PROJECT: "wrong", INGENIUM_WORKSPACE_ID: "wrong", INGENIUM_API_TOKEN: "must-not-inherit", UNRELATED_SECRET: "must-not-inherit" },
    });
    assert.equal(launch.status, 0, launch.stderr);
    for (const [key, value] of Object.entries(expected)) assert.ok(launch.stdout.split("\n").includes(`${key}=${value}`));
    assert.ok(launch.stdout.split("\n").includes("OPENCODE_CONFIG_DIR=/home/ingenium-opencode/.config/opencode"));
    assert.ok(launch.stdout.split("\n").includes("OPENCODE_CONFIG=/usr/local/share/ingenium/opencode-managed/opencode.json"));
    assert.ok(!launch.stdout.includes("must-not-inherit"));
    const supervisor = readFileSync(new URL("../supervisord.conf", import.meta.url), "utf8");
    const priority = (name) => Number(supervisor.split(`[program:${name}]`)[1].split("[program:")[0].match(/^priority=(\d+)$/m)[1]);
    assert.ok(priority("opencode-mcp-bootstrap") < priority("opencode-web"));
    assert.ok(launcher.indexOf(`[ ! -s ${readyFile} ]`) < launcher.indexOf("exec env -i"));
    const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
    assert.ok(compose.includes('"${HOME}/repos/ingenium:/home/brajam/repos/ingenium"'));
    assert.ok(compose.includes('/repos:/workspace"'));
    assert.ok(compose.includes("INGENIUM_LEARNING_CREDENTIAL_FILE=/run/ingenium-bootstrap/learning-credential"));
    assert.ok(compose.includes("/run/ingenium-bootstrap/learning-credential:ro"));
    const entrypoint = readFileSync(new URL("../scripts/docker-entrypoint.sh", import.meta.url), "utf8");
    assert.ok(entrypoint.includes('RUNTIME_LEARNING_CREDENTIAL_FILE="/run/ingenium-opencode/.ingenium-learning-credential"'));
    assert.ok(entrypoint.includes('"${INGENIUM_LEARNING_CREDENTIAL_FILE:?INGENIUM_LEARNING_CREDENTIAL_FILE is required}"'));
    assert.ok(entrypoint.includes('"$RUNTIME_LEARNING_CREDENTIAL_FILE" mcp-learning'));
    assert.ok(entrypoint.includes('export INGENIUM_LEARNING_CREDENTIAL_FILE="$RUNTIME_LEARNING_CREDENTIAL_FILE"'));
    assert.ok(launcher.indexOf('INGENIUM_LEARNING_CREDENTIAL_FILE="/run/ingenium-opencode/.ingenium-learning-credential"') > launcher.indexOf("exec env -i"));
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
      .replace('opencode_server_password="$(cat /run/ingenium-secrets/opencode/opencode-server-password)"', 'opencode_server_password="test-password"')
      .replace("[ ! -s /run/ingenium-opencode/.ingenium-mcp-credential ]", "[ 1 = 0 ]")
      .replaceAll("/run/ingenium-runtime/environment", environment)
      .replace("[ -s /run/ingenium-runtime/capability ]", `[ -s ${destination} ]`)
      .replace("node /app/scripts/probe-api.mjs", "true")
      .replace("opencode serve --port 4098 --hostname 127.0.0.1", "/usr/bin/env");
    assert.ok(!launcher.includes("$(cat /run/ingenium-secrets/opencode/opencode-server-password)"));
    const launch = spawnSync("/bin/sh", ["-c", launcher], { encoding: "utf8", env: {} });
    assert.equal(launch.status, 0, launch.stderr);
    for (const value of [`INGENIUM_RUNTIME_ID=${id}`, `INGENIUM_PROJECT_ID=${id}`, "INGENIUM_MCP_AUDIENCE=runtime",
      "INGENIUM_WORKTREE=/workspace", "INGENIUM_RUNTIME_CREDENTIAL_FILE=/run/ingenium-runtime/capability",
      "INGENIUM_MCP_CREDENTIAL_FILE=/run/ingenium-opencode/.ingenium-mcp-credential"]) assert.ok(launch.stdout.split("\n").includes(value));
    const configLine = launch.stdout.split("\n").find(line => line.startsWith("OPENCODE_CONFIG_CONTENT="));
    assert.equal(JSON.parse(configLine.slice("OPENCODE_CONFIG_CONTENT=".length)).mcp.servers.ingenium.environment.INGENIUM_WORKTREE, "/workspace");
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
    .replace('opencode_server_password="$(cat /run/ingenium-secrets/opencode/opencode-server-password)"', 'opencode_server_password="test-password"')
    .replaceAll("sleep 1", ":")
    .replace("[ ! -s /run/ingenium-opencode/.ingenium-mcp-credential ]", "[ 1 = 0 ]")
    .replaceAll("/run/ingenium-runtime/environment", environment)
    .replaceAll("/run/ingenium-runtime/capability", capability)
    .replace("node /app/scripts/probe-api.mjs", "true")
    .replace("opencode serve --port 4098 --hostname 127.0.0.1", "/usr/bin/env");
  assert.ok(!launcher.includes("$(cat /run/ingenium-secrets/opencode/opencode-server-password)"));
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
