#!/usr/bin/env node
import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, fchownSync, fchmodSync, fsyncSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

const credentialFile = "/run/ingenium-opencode/.ingenium-mcp-credential";
const api = "http://127.0.0.1:4097/api/v1";
const scopes = ["projects:read", "repository:sync", "documentation:read", "rag:read", "memory:read", "memory:write"].sort();
const runtimeScopes = ["child-mcp:runtime", "child-mcp:execute", "mcp-servers:write", "projects:read", "documentation:read", "rag:read", "memory:write"].sort();

export class BootstrapUnavailableError extends Error {}

// Wait through cold starts without a tight retry loop. Authentication, binding
// and filesystem failures are permanent and must never be retried here.
async function retryAvailability(operation, { wait, report, stage, attempts = Infinity }) {
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!(error instanceof BootstrapUnavailableError) || attempt >= attempts) throw error;
      const delay = Math.min(1_000 * 2 ** Math.min(attempt - 1, 4), 15_000);
      report(`MCP_BOOTSTRAP_WAIT stage=${stage} attempt=${attempt} retryInMs=${delay}`);
      await wait(delay);
    }
  }
}

async function bootstrapFetch(fetcher, url, options) {
  let response;
  try { response = await fetcher(url, options); }
  catch { throw new BootstrapUnavailableError("Bootstrap API unavailable"); }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    await response.body?.cancel().catch(() => {});
    throw new BootstrapUnavailableError("Bootstrap API unavailable");
  }
  return response;
}

function openPrivateDirectory(path, uid, gid) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const metadata = fstatSync(fd);
  if (metadata.uid !== uid || metadata.gid !== gid || (metadata.mode & 0o777) !== 0o700) {
    closeSync(fd);
    throw new Error("Unsafe private directory");
  }
  return fd;
}

function readPrivateFile(path, uid, gid, maxSize) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.uid !== uid || metadata.gid !== gid
      || (metadata.mode & 0o777) !== 0o600 || metadata.size > maxSize) throw new Error("Unsafe private file");
    return readFileSync(fd, "utf8").trim();
  } finally { closeSync(fd); }
}

export async function provisionMcpCredential({
  destination = credentialFile, source = "/run/ingenium-bootstrap/api-token",
  sourceUid = 1000, sourceGid = 1000, bootstrapUid = 0, bootstrapGid = 0,
  uid = 1105, gid = 1105, fetcher = fetch, runtime = false,
} = {}) {
  const parent = openPrivateDirectory(dirname(destination), uid, gid);
  let bootstrapParent;
  let temporary;
  let descriptor;
  try {
    bootstrapParent = openPrivateDirectory(dirname(source), bootstrapUid, bootstrapGid);
    const token = readPrivateFile(`/proc/self/fd/${bootstrapParent}/${basename(source)}`, sourceUid, sourceGid, 129);
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error("Invalid installation credential");
    const response = await bootstrapFetch(fetcher, `${api}/auth/${runtime ? "bootstrap-local-runtime" : "bootstrap-mcp-credential"}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "x-ingenium-internal-service": "1", "content-type": "application/json" }, body: "{}",
    });
    if (response.status !== 201) throw new Error("Bootstrap request failed");
    const payload = (await response.json()).data;
    const data = runtime ? payload?.credential : payload;
    const instance = runtime ? payload?.runtime : undefined;
    if (runtime && (payload.runtimeWorktree !== "/workspace" || !instance || instance.state !== "READY" || instance.backendContainerId !== null
      || ![instance.id, instance.ownerUserId, instance.projectId, instance.organizationId].every(value => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value))
      || instance.workspaceId !== data?.workspaceId || instance.projectId !== data?.projectId
      || instance.organizationId !== data?.organizationId || instance.ownerUserId !== data?.createdByUserId
      || instance.securityEpoch !== data?.securityEpoch || !/^[0-9a-f]{64}$/.test(data?.storageMappingHash))) {
      throw new Error("Runtime bootstrap binding mismatch");
    }
    if (!data || !/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(data.token)
      || data.name !== (runtime ? `Runtime ${instance.id}` : "Compatibility OpenCode")
      || data.kind !== (runtime ? "runtime" : "service") || data.audience !== (runtime ? "runtime" : "mcp")
      || data.projectName !== "ingenium" || data.workspaceId !== "shared-memory-ingenium"
      || data.launcherWorktree !== "/home/brajam/repos/ingenium"
      || !Array.isArray(data.scopes) || JSON.stringify([...data.scopes].sort()) !== JSON.stringify(runtime ? runtimeScopes : scopes)
      || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) {
      throw new Error("Bootstrap binding mismatch");
    }
    const install = (name, contents) => {
    const target = `/proc/self/fd/${parent}/${name}`;
    try {
      if (readPrivateFile(target, uid, gid, 4096) === contents) return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    temporary = `/proc/self/fd/${parent}/.credential-${randomUUID()}.tmp`;
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, `${contents}\n`);
    fchownSync(descriptor, uid, gid);
    fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, target);
    temporary = undefined;
    fsyncSync(parent);
    };
    install(basename(destination), data.token);
    if (runtime) install("environment", Object.entries({
      INGENIUM_RUNTIME_ID: instance.id, INGENIUM_RUNTIME_OWNER_ID: instance.ownerUserId,
      INGENIUM_PROJECT: data.projectName, INGENIUM_PROJECT_ID: data.projectId,
      INGENIUM_ORGANIZATION_ID: data.organizationId, INGENIUM_WORKSPACE_ID: data.workspaceId,
      INGENIUM_STORAGE_MAPPING_HASH: data.storageMappingHash,
      INGENIUM_WORKTREE: payload.runtimeWorktree,
    }).map(([key, value]) => `${key}='${value}'`).join("\n"));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (temporary) unlinkSync(temporary);
    if (bootstrapParent !== undefined) closeSync(bootstrapParent);
    closeSync(parent);
  }
}

export async function provisionStartupCredentials(provision = provisionMcpCredential, report = line => process.stdout.write(`${line}\n`), runtimeDirectory = "/run/ingenium-runtime") {
  const invalidate = () => {
    for (const name of ["environment", "capability"]) {
      try { unlinkSync(`${runtimeDirectory}/${name}`); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  };
  // Invalidate before any await so startup cannot adopt a previous runtime identity.
  invalidate();
  await provision();
  try {
    await provision({ destination: `${runtimeDirectory}/capability`, runtime: true });
    report("MCP_BOOTSTRAP_READY");
  } catch {
    invalidate();
    report("MCP_BOOTSTRAP_DEGRADED stage=local-runtime code=PROVISION_FAILED");
  }
}

export async function runStartupBootstrap({
  fetcher = fetch, provision = options => provisionMcpCredential({ ...options, fetcher }),
  wait = setTimeout, report = line => process.stdout.write(`${line}\n`),
  runtimeDirectory = "/run/ingenium-runtime",
} = {}) {
  // provisionStartupCredentials invalidates stale runtime identity synchronously,
  // before even waiting for API readiness. General credentials remain required.
  await provisionStartupCredentials(async options => {
    if (!options?.runtime) {
      await retryAvailability(async () => {
        const response = await bootstrapFetch(fetcher, `${api}/health`, {
          redirect: "error", signal: AbortSignal.timeout(1_000),
        });
        if (!response.ok) throw new Error("Bootstrap API readiness rejected");
        await response.body?.cancel();
      }, { wait, report, stage: "api" });
    }
    await retryAvailability(() => provision(options), {
      wait, report, stage: options?.runtime ? "local-runtime" : "general",
      // The optional runtime retains its existing degraded fallback. A slow API
      // must not permanently strand the required general credential bootstrap.
      attempts: options?.runtime ? 3 : Infinity,
    });
  }, report, runtimeDirectory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runStartupBootstrap();
  } catch {
    process.stderr.write("MCP_BOOTSTRAP_PROVISION_FAILED\n");
    process.exitCode = 1;
  }
}
