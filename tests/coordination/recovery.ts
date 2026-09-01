import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
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
  workspaceId: string;
  launcherWorktree: string;
  credentials: LegacyCredentialPath[];
  signal?: AbortSignal;
  request?: typeof fetch;
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
  required(options.credentials.length > 0 && options.credentials.length <= 2, "One or two exact legacy credentials are required");
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
    const revoke = await request(`${endpoint}/auth/mcp-credentials/${encodeURIComponent(credential.id)}`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    required(revoke.status === 204, `Legacy credential self-revocation returned ${revoke.status}`);
    const verify = await request(`${endpoint}/auth/preflight`, {
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    required(verify.status === 401, "Legacy credential remained usable after revocation");
    assertUnchanged(locator);
    unlinkSync(locator.path);
    required(!existsSync(locator.path), "Legacy credential still exists after unlink");
  }
}

export function recoveryUsage(): string {
  return "Usage: npx tsx tests/coordination/recovery.ts --manifest ABSOLUTE_PATH --api-url http://127.0.0.1:4097/api/v1 [--operator-token-file ABSOLUTE_PATH]";
}

async function main(argv: readonly string[]): Promise<void> {
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
    required(["manifest", "api-url", "operator-token-file"].includes(name) && !values.has(name), `Unsupported or repeated recovery argument: ${flag}`);
    values.set(name, value);
  }
  const manifestPath = values.get("manifest");
  const endpoint = values.get("api-url");
  required(manifestPath && endpoint && isAbsolute(manifestPath) && resolve(manifestPath) === manifestPath,
    "An exact absolute manifest and API URL are required");
  const operatorPath = values.get("operator-token-file");
  await recoverCoordinationHarnessRun(manifestPath, {
    apiUrl: endpoint,
    ...(operatorPath ? { operatorToken: validateProtectedLocator(operatorPath, "operator token file") } : {}),
  });
}

if (basename(process.argv[1] ?? "") === "recovery.ts") {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
