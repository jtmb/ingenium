// Synthetic loopback API and disposable /run only. No production credentials,
// database, network, model calls or application entrypoint are involved.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, chownSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

for (const [directory, uid] of [["/run/ingenium-bootstrap", 0], ["/run/ingenium-opencode", 1105], ["/run/ingenium-runtime", 1105]]) {
  mkdirSync(directory, { mode: 0o700 });
  chownSync(directory, uid, uid);
}
const source = "/run/ingenium-bootstrap/api-token";
writeFileSync(source, "c".repeat(64), { mode: 0o600 });
chownSync(source, 1000, 1000);
const id = "11111111-1111-4111-8111-111111111111";
const token = `ing_${"a".repeat(12)}_${"b".repeat(43)}`;
const general = {
  name: "Compatibility OpenCode", kind: "service", audience: "mcp", token,
  projectName: "ingenium", workspaceId: "shared-memory-ingenium", launcherWorktree: "/home/brajam/repos/ingenium",
  scopes: ["projects:read", "repository:sync", "documentation:read", "rag:read", "memory:read", "memory:write"],
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};
const started = Date.now();
let readinessFailures = 0, generalRequests = 0, runtimeRequests = 0;
const server = createServer((request, response) => {
  if (request.url === "/api/v1/health") {
    const ready = Date.now() - started >= 75_000;
    if (!ready) readinessFailures++;
    response.writeHead(ready ? 200 : 503).end();
    return;
  }
  assert.equal(request.headers.authorization, `Bearer ${"c".repeat(64)}`);
  let data;
  if (request.url === "/api/v1/auth/bootstrap-mcp-credential") {
    // Also exercise a real transient failure after readiness succeeds.
    if (++generalRequests === 1) { response.writeHead(503).end(); return; }
    data = general;
  } else {
    assert.equal(request.url, "/api/v1/auth/bootstrap-local-runtime");
    runtimeRequests++;
    const credential = { ...general, name: `Runtime ${id}`, kind: "runtime", audience: "runtime",
      scopes: ["child-mcp:runtime", "child-mcp:execute", "mcp-servers:write", "projects:read", "documentation:read", "rag:read", "memory:write"],
      createdByUserId: id, organizationId: id, projectId: id, securityEpoch: 0, storageMappingHash: "a".repeat(64) };
    data = { credential, runtimeWorktree: "/workspace", runtime: {
      id, state: "READY", backendContainerId: null, ownerUserId: id, organizationId: id,
      projectId: id, workspaceId: general.workspaceId, securityEpoch: 0,
    } };
  }
  response.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ data }));
});
await new Promise(resolve => server.listen(4097, "127.0.0.1", resolve));
const child = spawn(process.execPath, ["/app/scripts/provision-opencode-mcp-credential.mjs"], { env: {}, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "", stderr = "";
child.stdout.on("data", chunk => { stdout += chunk; });
child.stderr.on("data", chunk => { stderr += chunk; });
const deadline = setTimeout(() => child.kill("SIGKILL"), 180_000);
try {
  const exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  assert.equal(exitCode, 0, "Installed bootstrap exited before automatic recovery");
  assert.ok(Date.now() - started >= 75_000);
  assert.ok(readinessFailures >= 5);
  assert.equal(generalRequests, 2);
  assert.equal(runtimeRequests, 1);
  assert.ok(stdout.includes("MCP_BOOTSTRAP_READY"));
  assert.ok(stdout.includes("MCP_BOOTSTRAP_WAIT stage=general"));
  assert.equal(stderr, "");
  assert.equal((stdout + stderr).includes(token), false);
  for (const path of ["/run/ingenium-opencode/.ingenium-mcp-credential", "/run/ingenium-runtime/capability", "/run/ingenium-runtime/environment"]) {
    const metadata = statSync(path);
    assert.equal(metadata.uid, 1105);
    assert.equal(metadata.gid, 1105);
    assert.equal(metadata.mode & 0o777, 0o600);
  }
  assert.equal(readFileSync("/run/ingenium-runtime/environment", "utf8").includes(token), false);
  console.log(JSON.stringify({ automaticRecovery: true, readinessDelaySeconds: 75, transientGeneralFailureRecovered: true, runtimeReady: true, elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null) child.kill("SIGKILL");
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
