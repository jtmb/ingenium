import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TestRunContext } from "../test-run-context";
import {
  assertNoSecrets,
  readProtectedValue,
  type HarnessOptions,
  type ProtectedLocator,
} from "./contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^ing_[A-Za-z0-9_-]{20,}$/;

export const CREDENTIAL_LEASE_METADATA_FILE = "coordination-credential-lease.json";
export const COORDINATION_CREDENTIAL_FILE = ".ingenium-mcp-credential";
export const REPOSITORY_CREDENTIAL_FILE = ".ingenium-repository-sync-credential";

export type RunCredentialAudience = "mcp" | "repository-sync";
export type RunCredentialName = "coordination" | "repositorySync";

export type RunCredentialLeaseOptions = Pick<HarnessOptions,
  "runtimeId" | "projectId" | "workspaceId" | "worktree" | "storageMappingHash">;
export type RunCredentialLeaseTransportOptions = RunCredentialLeaseOptions & Pick<HarnessOptions, "apiUrl">;

export interface IssuedRunCredential {
  id: string;
  audience: RunCredentialAudience;
  projectId: string;
  workspaceId: string;
  launcherWorktree: string;
  storageMappingHash: string;
  expiresAt: string;
  token: string;
}

export interface IssuedRunCredentialPair {
  coordination?: IssuedRunCredential;
  repositorySync?: IssuedRunCredential;
}

export interface RunCredentialLeaseTransport {
  issue(input: {
    runtimeId: string;
    runId: string;
    runNonce: string;
    operatorToken: string;
    signal: AbortSignal;
  }): Promise<IssuedRunCredentialPair>;
  revoke(input: {
    credential: RunCredentialMetadata;
    token: string;
    signal: AbortSignal;
  }): Promise<void>;
  verifyRevoked(input: {
    credential: RunCredentialMetadata;
    token: string;
    signal: AbortSignal;
  }): Promise<void>;
}

export interface RunCredentialMetadata {
  name: RunCredentialName;
  id: string;
  audience: RunCredentialAudience;
  projectId: string;
  workspaceId: string;
  launcherWorktree: string;
  storageMappingHash: string;
  expiresAt: string;
  path: string;
  dev: number;
  ino: number;
  uid: number;
  mode: number;
  size: number;
  revokedAt?: string;
  removedAt?: string;
}

export interface RunCredentialLeaseMetadata {
  schema: "ingenium.coordination-credential-lease/v1";
  runId: string;
  runNonce: string;
  runtimeId: string;
  createdAt: string;
  credentials: RunCredentialMetadata[];
  runtimeProvider?: { providerId: string; ownership: "preexisting" | "owned" };
}

export class CoordinationLeaseRequestError extends Error {
  constructor(readonly status: number) {
    super(`/auth/coordination-lease returned ${status}`);
    this.name = "CoordinationLeaseRequestError";
  }
}

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectedCredentialPath(context: TestRunContext, name: RunCredentialName): string {
  return join(context.homeDir, name === "coordination" ? COORDINATION_CREDENTIAL_FILE : REPOSITORY_CREDENTIAL_FILE);
}

function expectedAudience(name: RunCredentialName): RunCredentialAudience {
  return name === "coordination" ? "mcp" : "repository-sync";
}

function secureCredentialDirectory(context: TestRunContext): void {
  const before = lstatSync(context.homeDir);
  const uid = typeof process.getuid === "function" ? process.getuid() : before.uid;
  required(before.isDirectory() && !before.isSymbolicLink() && before.uid === uid && before.nlink === 2,
    "Run credential directory is unsafe");
  chmodSync(context.homeDir, 0o700);
  const after = lstatSync(context.homeDir);
  required(after.isDirectory() && !after.isSymbolicLink() && after.dev === before.dev && after.ino === before.ino
    && after.uid === uid && (after.mode & 0o077) === 0,
  "Run credential directory could not be secured");
}

function validateIssuedCredential(
  name: RunCredentialName,
  value: IssuedRunCredential,
  options: RunCredentialLeaseOptions,
): void {
  required(UUID.test(value.id), `${name} lease identity is invalid`);
  required(value.audience === expectedAudience(name), `${name} lease audience is invalid`);
  required(value.projectId === options.projectId && value.workspaceId === options.workspaceId
    && value.launcherWorktree === options.worktree && value.storageMappingHash === options.storageMappingHash,
  `${name} lease binding is invalid`);
  required(Number.isFinite(Date.parse(value.expiresAt)) && Date.parse(value.expiresAt) > Date.now(), `${name} lease expiry is invalid`);
  required(TOKEN.test(value.token), `${name} lease token is invalid`);
}

function createProtectedCredential(path: string, token: string): ProtectedLocator {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, `${token}\n`, "utf8");
    const stat = fstatSync(descriptor);
    const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
    required(stat.isFile() && stat.uid === uid && stat.nlink === 1 && (stat.mode & 0o077) === 0,
      "Run credential file is not an owner-only, single-link regular file");
    return { path, dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode, size: stat.size };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertCredentialIdentity(credential: RunCredentialMetadata): void {
  const stat = lstatSync(credential.path);
  required(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
    && stat.dev === credential.dev && stat.ino === credential.ino && stat.uid === credential.uid
    && stat.mode === credential.mode && stat.size === credential.size,
  `Run credential identity changed: ${credential.name}`);
}

function unlinkCredential(credential: RunCredentialMetadata): void {
  assertCredentialIdentity(credential);
  unlinkSync(credential.path);
  required(!existsSync(credential.path), `Run credential still exists after unlink: ${credential.name}`);
}

function writeLeaseMetadata(path: string, metadata: RunCredentialLeaseMetadata, secrets: readonly string[]): void {
  assertNoSecrets(metadata, secrets);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}

function metadataFor(
  name: RunCredentialName,
  issued: IssuedRunCredential,
  locator: ProtectedLocator,
): RunCredentialMetadata {
  return {
    name,
    id: issued.id,
    audience: issued.audience,
    projectId: issued.projectId,
    workspaceId: issued.workspaceId,
    launcherWorktree: issued.launcherWorktree,
    storageMappingHash: issued.storageMappingHash,
    expiresAt: issued.expiresAt,
    path: locator.path,
    dev: locator.dev,
    ino: locator.ino,
    uid: locator.uid,
    mode: locator.mode,
    size: locator.size,
  };
}

function parseLeaseMetadata(value: unknown, context: TestRunContext): RunCredentialLeaseMetadata {
  required(value !== null && typeof value === "object" && !Array.isArray(value), "Credential lease metadata is invalid");
  const metadata = value as RunCredentialLeaseMetadata;
  required(metadata.schema === "ingenium.coordination-credential-lease/v1"
    && metadata.runId === context.runId && metadata.runNonce === context.runNonce
    && UUID.test(metadata.runtimeId) && Number.isFinite(Date.parse(metadata.createdAt))
    && Array.isArray(metadata.credentials) && metadata.credentials.length <= 2,
  "Credential lease metadata identity is invalid");
  required(metadata.runtimeProvider === undefined
    || (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(metadata.runtimeProvider.providerId)
      && (metadata.runtimeProvider.ownership === "preexisting" || metadata.runtimeProvider.ownership === "owned")),
  "Credential lease runtime provider metadata is invalid");
  const names = new Set<RunCredentialName>();
  for (const credential of metadata.credentials) {
    required((credential.name === "coordination" || credential.name === "repositorySync")
      && !names.has(credential.name), "Credential lease metadata contains duplicate names");
    names.add(credential.name);
    required(credential.audience === expectedAudience(credential.name)
      && credential.path === expectedCredentialPath(context, credential.name)
      && UUID.test(credential.id) && UUID.test(credential.projectId)
      && credential.workspaceId.length > 0 && credential.launcherWorktree.length > 0
      && /^[0-9a-f]{64}$/.test(credential.storageMappingHash)
      && Number.isFinite(Date.parse(credential.expiresAt))
      && [credential.dev, credential.ino, credential.uid, credential.mode, credential.size]
        .every((entry) => Number.isSafeInteger(entry) && entry >= 0)
      && (credential.revokedAt === undefined || Number.isFinite(Date.parse(credential.revokedAt)))
      && (credential.removedAt === undefined || Number.isFinite(Date.parse(credential.removedAt)))
      && (credential.removedAt === undefined || credential.revokedAt !== undefined),
    `Credential lease metadata is invalid: ${credential.name}`);
  }
  return metadata;
}

function bindingHeaders(credential: Pick<RunCredentialMetadata, "audience" | "workspaceId" | "launcherWorktree">, token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-ingenium-audience": credential.audience,
    "x-ingenium-workspace": credential.workspaceId,
    "x-ingenium-launcher-worktree": credential.launcherWorktree,
  };
}

function exactRecord(value: unknown, keys: readonly string[], message: string): Record<string, unknown> {
  required(value !== null && typeof value === "object" && !Array.isArray(value), message);
  const record = value as Record<string, unknown>;
  required(Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key)), message);
  return record;
}

async function boundedFetch(
  request: typeof fetch,
  input: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  return request(input, {
    ...init,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
}

export function createRunCredentialLeaseTransport(
  options: RunCredentialLeaseTransportOptions,
  request: typeof fetch = fetch,
): RunCredentialLeaseTransport {
  return {
    async issue({ runtimeId, operatorToken, signal }) {
      const response = await boundedFetch(request, `${options.apiUrl}/auth/coordination-lease`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${operatorToken}`,
          "content-type": "application/json",
          "x-ingenium-internal-service": "1",
          "x-ingenium-runtime-id": runtimeId,
        },
        body: JSON.stringify({ runtimeId }),
      }, signal);
      if (response.status !== 201) throw new CoordinationLeaseRequestError(response.status);
      const envelope = exactRecord(await response.json(), ["data"], "Coordination lease response is invalid");
      const data = exactRecord(envelope.data,
        ["runtimeId", "expiresAt", "coordinationCredential", "repositorySyncCredential"],
        "Coordination lease response data is invalid");
      required(data.runtimeId === runtimeId && typeof data.expiresAt === "string", "Coordination lease runtime response is invalid");
      const coordination = exactRecord(data.coordinationCredential, ["id", "token"], "Coordination credential response is invalid");
      const repositorySync = exactRecord(data.repositorySyncCredential, ["id", "token"], "Repository credential response is invalid");
      required(typeof coordination.id === "string" && typeof coordination.token === "string"
        && typeof repositorySync.id === "string" && typeof repositorySync.token === "string",
      "Coordination lease credential response is invalid");
      const binding = {
        projectId: options.projectId,
        workspaceId: options.workspaceId,
        launcherWorktree: options.worktree,
        storageMappingHash: options.storageMappingHash,
        expiresAt: data.expiresAt,
      };
      return {
        coordination: { ...binding, id: coordination.id, token: coordination.token, audience: "mcp" },
        repositorySync: { ...binding, id: repositorySync.id, token: repositorySync.token, audience: "repository-sync" },
      };
    },
    async revoke({ credential, token, signal }) {
      const response = await boundedFetch(request,
        `${options.apiUrl}/auth/mcp-credentials/${encodeURIComponent(credential.id)}`,
        { method: "DELETE", headers: bindingHeaders(credential, token) }, signal);
      required(response.status === 204, `Credential self-revocation returned ${response.status}: ${credential.name}`);
    },
    async verifyRevoked({ credential, token, signal }) {
      const response = await boundedFetch(request, `${options.apiUrl}/auth/preflight`, {
        method: "GET",
        headers: bindingHeaders(credential, token),
      }, signal);
      required(response.status === 401, `Credential remained usable after revocation: ${credential.name}`);
    },
  };
}

export class RunCredentialLease {
  readonly metadataPath: string;
  private metadata: RunCredentialLeaseMetadata;

  constructor(
    private readonly context: TestRunContext,
    private readonly options: RunCredentialLeaseOptions,
    private readonly transport: RunCredentialLeaseTransport,
    metadata?: RunCredentialLeaseMetadata,
  ) {
    secureCredentialDirectory(context);
    this.metadataPath = join(context.runDir, CREDENTIAL_LEASE_METADATA_FILE);
    this.metadata = metadata ?? {
      schema: "ingenium.coordination-credential-lease/v1",
      runId: context.runId,
      runNonce: context.runNonce,
      runtimeId: options.runtimeId,
      createdAt: new Date().toISOString(),
      credentials: [],
    };
  }

  get coordinationLocator(): ProtectedLocator | undefined {
    const value = this.metadata.credentials.find((credential) => credential.name === "coordination");
    return value && { path: value.path, dev: value.dev, ino: value.ino, uid: value.uid, mode: value.mode, size: value.size };
  }

  get repositoryLocator(): ProtectedLocator | undefined {
    const value = this.metadata.credentials.find((credential) => credential.name === "repositorySync");
    return value && { path: value.path, dev: value.dev, ino: value.ino, uid: value.uid, mode: value.mode, size: value.size };
  }

  snapshot(): RunCredentialLeaseMetadata {
    return structuredClone(this.metadata);
  }

  setRuntimeProvider(providerId: string, ownership: "none" | "preexisting" | "owned"): void {
    required(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(providerId), "Runtime provider ID is invalid");
    this.metadata.runtimeProvider = ownership === "none" ? undefined : { providerId, ownership };
    this.persist();
  }

  private persist(secrets: readonly string[] = []): void {
    writeLeaseMetadata(this.metadataPath, this.metadata, secrets);
  }

  async issue(operatorToken: string, signal: AbortSignal): Promise<void> {
    required(this.metadata.credentials.length === 0 && !existsSync(this.metadataPath), "Run credential lease was already issued");
    const issued = await this.transport.issue({
      runtimeId: this.options.runtimeId,
      runId: this.context.runId,
      runNonce: this.context.runNonce,
      operatorToken,
      signal,
    });
    const secrets: string[] = [];
    let issueError: unknown;
    for (const name of ["coordination", "repositorySync"] as const) {
      const credential = issued[name];
      if (!credential) continue;
      try {
        validateIssuedCredential(name, credential, this.options);
        secrets.push(credential.token);
        const locator = createProtectedCredential(expectedCredentialPath(this.context, name), credential.token);
        this.metadata.credentials.push(metadataFor(name, credential, locator));
        this.persist(secrets);
      } catch (error) {
        issueError = error;
        break;
      }
    }
    if (!existsSync(this.metadataPath)) this.persist(secrets);
    if (issueError !== undefined) throw issueError;
    const issuedCount: number = this.metadata.credentials.length;
    required(issuedCount === 2, "Coordination lease issue response was partial");
  }

  async revokeAndRemove(signal: AbortSignal): Promise<void> {
    const errors: unknown[] = [];
    for (const credential of [...this.metadata.credentials].reverse()) {
      try {
        if (credential.removedAt) {
          required(!existsSync(credential.path), `Removed run credential reappeared: ${credential.name}`);
          continue;
        }
        const locator = {
          path: credential.path,
          dev: credential.dev,
          ino: credential.ino,
          uid: credential.uid,
          mode: credential.mode,
          size: credential.size,
        };
        if (!credential.revokedAt) {
          const token = readProtectedValue(locator);
          await this.transport.revoke({ credential, token, signal });
          await this.transport.verifyRevoked({ credential, token, signal });
          credential.revokedAt = new Date().toISOString();
          this.persist();
        }
        unlinkCredential(credential);
        credential.removedAt = new Date().toISOString();
        this.persist();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Run credential cleanup failed");
  }

  static load(
    context: TestRunContext,
    transport: RunCredentialLeaseTransport,
  ): RunCredentialLease {
    const metadata = readRunCredentialLeaseMetadata(context);
    const first = metadata.credentials[0];
    required(first, "Credential lease metadata contains no credentials");
    return new RunCredentialLease(context, {
      runtimeId: metadata.runtimeId,
      projectId: first.projectId,
      workspaceId: first.workspaceId,
      worktree: first.launcherWorktree,
      storageMappingHash: first.storageMappingHash,
    }, transport, metadata);
  }
}

export function readRunCredentialLeaseMetadata(context: TestRunContext): RunCredentialLeaseMetadata {
  const path = join(context.runDir, CREDENTIAL_LEASE_METADATA_FILE);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parseLeaseMetadata(parsed, context);
}
