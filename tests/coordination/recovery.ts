import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  readTestRunManifest,
  updateTestRunManifest,
  type TestRunContext,
} from "../test-run-context";
import { stopRunFromManifest } from "../test-server-lifecycle";
import { readProtectedValue, validateProtectedLocator, type ProtectedLocator } from "./contracts";
import {
  RunCredentialLease,
  createRunCredentialLeaseTransport,
  readRunCredentialLeaseMetadata,
  type RunCredentialAudience,
} from "./credential-lease";
import { finalizeCoordinationTestRun } from "./harness";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const REQUEST_ID = /^req_[0-9a-f]{8}$/;

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function apiUrl(value: string): string {
  const parsed = new URL(value);
  required(parsed.protocol === "http:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
    && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)
    && /^\/api\/v1\/?$/.test(parsed.pathname), "Recovery API URL must be a loopback HTTP /api/v1 endpoint");
  return parsed.toString().replace(/\/$/, "");
}

function controlHeaders(token: string, runtimeId: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-ingenium-internal-service": "1",
    "x-ingenium-runtime-id": runtimeId,
  };
}

async function disconnectOwnedRuntimeProvider(
  context: TestRunContext,
  endpoint: string,
  operatorToken: ProtectedLocator,
  signal: AbortSignal,
): Promise<void> {
  const metadata = readRunCredentialLeaseMetadata(context);
  if (metadata.runtimeProvider?.ownership !== "owned") return;
  const token = readProtectedValue(operatorToken);
  const response = await fetch(`${endpoint}/opencode/auth/${encodeURIComponent(metadata.runtimeProvider.providerId)}`, {
    method: "DELETE",
    headers: controlHeaders(token, metadata.runtimeId),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  required(response.status === 200, `Runtime provider disconnect returned ${response.status}`);
}

export interface CoordinationRecoveryOptions {
  apiUrl: string;
  operatorToken?: ProtectedLocator;
  signal?: AbortSignal;
}

export async function recoverCoordinationHarnessRun(
  manifestPath: string,
  options: CoordinationRecoveryOptions,
): Promise<void> {
  if (!existsSync(manifestPath)) return;
  const endpoint = apiUrl(options.apiUrl);
  const signal = options.signal ?? AbortSignal.timeout(120_000);
  const context = readTestRunManifest(manifestPath);
  const metadata = readRunCredentialLeaseMetadata(context);
  const first = metadata.credentials[0];
  required(first, "Credential lease metadata contains no credentials");
  const transport = createRunCredentialLeaseTransport({
    apiUrl: endpoint,
    runtimeId: metadata.runtimeId,
    projectId: first.projectId,
    workspaceId: first.workspaceId,
    worktree: first.launcherWorktree,
    storageMappingHash: first.storageMappingHash,
  });
  const lease = RunCredentialLease.load(context, transport);
  try {
    updateTestRunManifest(manifestPath, { status: "stopping" });
    await stopRunFromManifest(manifestPath, { cleanup: false });
    updateTestRunManifest(manifestPath, { status: "stopping" });
    if (metadata.runtimeProvider?.ownership === "owned") {
      required(options.operatorToken, "Protected operator token is required to recover an owned runtime provider");
      await disconnectOwnedRuntimeProvider(context, endpoint, options.operatorToken, signal);
      lease.setRuntimeProvider(metadata.runtimeProvider.providerId, "none");
    }
    await lease.revokeAndRemove(signal);
    await finalizeCoordinationTestRun(context);
  } catch (error) {
    if (existsSync(manifestPath)) updateTestRunManifest(manifestPath, { status: "stopping" });
    throw error;
  }
}

export interface LegacyCredentialPath {
  id: string;
  path: string;
  audience: RunCredentialAudience;
}

export interface LegacyCredentialRecoveryOptions {
  apiUrl: string;
  organizationId: string;
  projectId: string;
  workspaceId: string;
  launcherWorktree: string;
  storageMappingHash: string;
  credentials: LegacyCredentialPath[];
  credentialDirectory: string;
  removeEmptyDirectory?: boolean;
  signal?: AbortSignal;
  request?: typeof fetch;
}

interface DirectoryIdentity {
  path: string;
  dev: number;
  ino: number;
  uid: number;
  mode: number;
  nlink: number;
}

function exactRecord(value: unknown, keys: readonly string[], message: string): Record<string, unknown> {
  required(value !== null && typeof value === "object" && !Array.isArray(value), message);
  const record = value as Record<string, unknown>;
  required(Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key)), message);
  return record;
}

async function responseJson(response: Response, message: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(message);
  }
}

async function assertInactiveProof(response: Response): Promise<void> {
  required(response.status === 401, `Legacy credential inactive proof returned ${response.status}`);
  const envelope = exactRecord(await responseJson(response, "Legacy credential inactive proof is not valid JSON"),
    ["error"], "Legacy credential inactive proof is invalid");
  const error = exactRecord(envelope.error, ["code", "message", "details", "requestId"],
    "Legacy credential inactive proof is invalid");
  required(error.code === "INVALID_TOKEN" && error.message === "Invalid bearer token" && error.details === null
    && typeof error.requestId === "string" && REQUEST_ID.test(error.requestId),
  "Legacy credential inactive proof is invalid");
}

async function assertActiveProof(
  response: Response,
  options: LegacyCredentialRecoveryOptions,
  credential: LegacyCredentialPath,
): Promise<void> {
  required(response.status === 200, `Legacy credential active proof returned ${response.status}`);
  const envelope = exactRecord(await responseJson(response, "Legacy credential active proof is not valid JSON"),
    ["data"], "Legacy credential active proof is invalid");
  const data = exactRecord(envelope.data, [
    "authenticated", "principal", "scopes", "organizationId", "projectId", "projectIds", "audience",
    "workspaceId", "launcherWorktree", "storageMappingHash", "restartRequiredOnCredentialChange",
    "credentialChangeMode",
  ], "Legacy credential active proof is invalid");
  const principal = exactRecord(data.principal, ["type", "id"], "Legacy credential active principal is invalid");
  required(data.authenticated === true && principal.type === "service" && typeof principal.id === "string"
    && UUID.test(principal.id) && Array.isArray(data.scopes) && data.scopes.every((scope) => typeof scope === "string")
    && data.organizationId === options.organizationId && data.projectId === options.projectId
    && Array.isArray(data.projectIds) && data.projectIds.length === 1 && data.projectIds[0] === options.projectId
    && data.audience === credential.audience && data.workspaceId === options.workspaceId
    && data.launcherWorktree === options.launcherWorktree && data.storageMappingHash === options.storageMappingHash
    && data.restartRequiredOnCredentialChange === true
    && data.credentialChangeMode === (credential.audience === "mcp" ? "live-mcp-reload" : "restart"),
  "Legacy credential active binding is invalid");
}

function captureDirectoryIdentity(path: string, name: string, ownerOnly: boolean): DirectoryIdentity {
  required(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path, `${name} is invalid`);
  const stat = lstatSync(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  required(stat.isDirectory() && !stat.isSymbolicLink()
    && (!ownerOnly || (stat.uid === uid && (stat.mode & 0o077) === 0)),
    `${name} is invalid`);
  return { path, dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode, nlink: stat.nlink };
}

function assertDirectoryIdentity(identity: DirectoryIdentity, name: string): void {
  const stat = lstatSync(identity.path);
  required(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(identity.path) === identity.path
    && stat.dev === identity.dev && stat.ino === identity.ino && stat.uid === identity.uid
    && stat.mode === identity.mode && stat.nlink === identity.nlink,
  `${name} identity changed`);
}

function assertUnchanged(locator: ProtectedLocator): void {
  const stat = lstatSync(locator.path);
  required(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
    && stat.dev === locator.dev && stat.ino === locator.ino && stat.uid === locator.uid
    && stat.mode === locator.mode && stat.size === locator.size,
  "Legacy credential identity changed before unlink");
}

export async function recoverExactLegacyCredentials(options: LegacyCredentialRecoveryOptions): Promise<void> {
  const endpoint = apiUrl(options.apiUrl);
  const signal = options.signal ?? AbortSignal.timeout(60_000);
  const request = options.request ?? fetch;
  required(UUID.test(options.organizationId) && UUID.test(options.projectId) && SHA256.test(options.storageMappingHash)
    && options.workspaceId.length > 0 && options.launcherWorktree.length > 0
    && options.credentials.length > 0 && options.credentials.length <= 2,
  "Legacy credential recovery binding is invalid");
  const directoryIdentity = captureDirectoryIdentity(options.credentialDirectory, "Legacy credential directory", true);
  const parentIdentity = captureDirectoryIdentity(dirname(options.credentialDirectory), "Legacy credential parent directory", false);
  required(options.credentials.every((credential) => dirname(credential.path) === options.credentialDirectory),
    "Legacy credential directory is invalid");
  for (const credential of options.credentials) {
    required(UUID.test(credential.id) && isAbsolute(credential.path) && resolve(credential.path) === credential.path
      && !credential.path.includes("*") && !credential.path.includes("?")
      && basename(credential.path) === (credential.audience === "mcp"
        ? ".ingenium-mcp-credential" : ".ingenium-repository-sync-credential"),
    "Legacy credential path or identity is invalid");
    if (!existsSync(credential.path)) continue;
    const locator = validateProtectedLocator(credential.path, "legacy credential file");
    const token = readProtectedValue(locator);
    const headers = {
      authorization: `Bearer ${token}`,
      "x-ingenium-audience": credential.audience,
      "x-ingenium-workspace": options.workspaceId,
      "x-ingenium-launcher-worktree": options.launcherWorktree,
    };
    const preflight = async () => request(`${endpoint}/auth/preflight`, {
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    const initial = await preflight();
    if (initial.status === 200) {
      await assertActiveProof(initial, options, credential);
      const revoke = await request(`${endpoint}/auth/mcp-credentials/${encodeURIComponent(credential.id)}`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      required(revoke.status === 204, `Legacy credential self-revocation returned ${revoke.status}`);
      await assertInactiveProof(await preflight());
    } else await assertInactiveProof(initial);
    assertDirectoryIdentity(parentIdentity, "Legacy credential parent directory");
    assertDirectoryIdentity(directoryIdentity, "Legacy credential directory");
    assertUnchanged(locator);
    unlinkSync(locator.path);
    required(!existsSync(locator.path), "Legacy credential still exists after unlink");
  }
  if (options.removeEmptyDirectory) {
    assertDirectoryIdentity(parentIdentity, "Legacy credential parent directory");
    assertDirectoryIdentity(directoryIdentity, "Legacy credential directory");
    required(readdirSync(options.credentialDirectory).length === 0, "Legacy credential directory is not empty");
    rmdirSync(options.credentialDirectory);
    required(!existsSync(options.credentialDirectory), "Legacy credential directory still exists after removal");
  }
}

export function recoveryUsage(): string {
  return [
    "Usage: npx tsx tests/coordination/recovery.ts --manifest ABSOLUTE_PATH --api-url http://127.0.0.1:4097/api/v1 [--operator-token-file ABSOLUTE_PATH]",
    "   or: npx tsx tests/coordination/recovery.ts --legacy-credential-dir ABSOLUTE_PATH --coordination-credential-id UUID --repository-sync-credential-id UUID --organization-id UUID --project-id UUID --workspace ID --launcher-worktree ABSOLUTE_PATH --storage-mapping-hash SHA256 --api-url http://127.0.0.1:4097/api/v1",
  ].join("\n");
}

export interface RecoveryMainDependencies {
  recoverRun?: typeof recoverCoordinationHarnessRun;
  recoverLegacy?: typeof recoverExactLegacyCredentials;
}

export async function runRecoveryMain(
  argv: readonly string[],
  dependencies: RecoveryMainDependencies = {},
): Promise<void> {
  if (argv.includes("--help")) {
    process.stdout.write(`${recoveryUsage()}\n`);
    return;
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    required(typeof flag === "string" && flag.startsWith("--") && value !== undefined && !value.startsWith("--"), "Recovery arguments must be --name value pairs");
    const name = flag.slice(2);
    required([
      "manifest", "api-url", "operator-token-file", "legacy-credential-dir",
      "coordination-credential-id", "repository-sync-credential-id", "organization-id", "project-id",
      "workspace", "launcher-worktree", "storage-mapping-hash",
    ].includes(name) && !values.has(name), `Unsupported or repeated recovery argument: ${flag}`);
    values.set(name, value);
  }
  const endpoint = values.get("api-url");
  const legacyDirectory = values.get("legacy-credential-dir");
  if (legacyDirectory !== undefined) {
    const coordinationId = values.get("coordination-credential-id");
    const repositorySyncId = values.get("repository-sync-credential-id");
    const organizationId = values.get("organization-id");
    const projectId = values.get("project-id");
    const workspaceId = values.get("workspace");
    const launcherWorktree = values.get("launcher-worktree");
    const storageMappingHash = values.get("storage-mapping-hash");
    required(endpoint && coordinationId && repositorySyncId && organizationId && projectId
      && workspaceId && launcherWorktree && storageMappingHash
      && values.get("manifest") === undefined && values.get("operator-token-file") === undefined
      && isAbsolute(legacyDirectory) && resolve(legacyDirectory) === legacyDirectory
      && isAbsolute(launcherWorktree) && resolve(launcherWorktree) === launcherWorktree,
    "Exact legacy credential directory, IDs, workspace, worktree, and API URL are required");
    await (dependencies.recoverLegacy ?? recoverExactLegacyCredentials)({
      apiUrl: endpoint,
      organizationId,
      projectId,
      workspaceId,
      launcherWorktree,
      storageMappingHash,
      credentialDirectory: legacyDirectory,
      removeEmptyDirectory: true,
      credentials: [
        { id: coordinationId, path: join(legacyDirectory, ".ingenium-mcp-credential"), audience: "mcp" },
        { id: repositorySyncId, path: join(legacyDirectory, ".ingenium-repository-sync-credential"), audience: "repository-sync" },
      ],
    });
    return;
  }
  const manifestPath = values.get("manifest");
  required(manifestPath && endpoint && isAbsolute(manifestPath) && resolve(manifestPath) === manifestPath,
    "An exact absolute manifest and API URL are required");
  const operatorPath = values.get("operator-token-file");
  await (dependencies.recoverRun ?? recoverCoordinationHarnessRun)(manifestPath, {
    apiUrl: endpoint,
    ...(operatorPath ? { operatorToken: validateProtectedLocator(operatorPath, "operator token file") } : {}),
  });
}

if (basename(process.argv[1] ?? "") === "recovery.ts") {
  runRecoveryMain(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
