import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  chmodSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

const API_URL = "http://localhost:4097/api/v1";
const DASHBOARD_ORIGIN = "http://localhost:3000";
const OWNER_API_URL = `${DASHBOARD_ORIGIN}/api/v1`;
const DASHBOARD_MARKER = { "x-ingenium-ui": "dashboard" } as const;
const PROJECT = "ingenium";
const WORKSPACE = "shared-memory-ingenium";
const CREDENTIAL_REFERENCE = ".opencode/.ingenium-mcp-credential";
const LEARNING_CREDENTIAL_REFERENCE = ".opencode/.ingenium-learning-credential";
const OWNER_PROVIDER_REFERENCE = ".opencode/.ingenium-coordination-owner-provider.json";
const OWNER_EMAIL = "bootstrap-admin@localhost";
const COORDINATION_SCOPES = ["coordination:read", "coordination:write", "projects:read", "repository:sync"] as const;
const LEARNING_SCOPES = [
  "projects:read", "extraction:write", "extraction:execute", "synthesis:write", "synthesis:execute",
  "pipeline:write", "observe:write",
] as const;
const TOKEN = /^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/;
const SECRET_MAX_BYTES = 4_096;
const CONFIG_MAX_BYTES = 1024 * 1024;
const PROVIDER_MAX_BYTES = 16 * 1024;
const PROVIDER_BUNDLE_PREFIX = ".ingenium-coordination-owner.";

export type CoordinationResetFailure =
  | "already_running"
  | "authentication"
  | "authorization"
  | "binding"
  | "credential_issue"
  | "credential_install"
  | "credential_revoke"
  | "source_changed"
  | "unavailable";

export class CoordinationResetError extends Error {
  constructor(readonly failure: CoordinationResetFailure) {
    super("Coordination credential reset failed");
    this.name = "CoordinationResetError";
  }
}

interface OwnerSecret {
  email: string;
  password: string;
  mfaCredential?: string;
  stepUpCredential?: string;
}

interface OwnerProviderReference {
  version: 1;
  provider: "aes-256-gcm-file";
  keyFile: string;
  bundleFile: string;
}

interface OwnerProviderEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  account: typeof OWNER_EMAIL;
  project: typeof PROJECT;
  workspaceId: typeof WORKSPACE;
  payload: string;
}

export interface PersistOwnerSecretOptions {
  keyFile: string;
  bundleDirectory: string;
}

export interface PersistOwnerSecretDependencies {
  afterBundleRename?: () => void;
}

interface CanonicalBinding {
  worktree: string;
  credentialFile: string;
}

interface CredentialProfile {
  credentialFile: string;
  name: "Ingenium coordination" | "Ingenium learning";
  scopes: readonly string[];
}

interface SessionState {
  cookie: string;
  csrfToken: string;
}

interface ProjectIdentity {
  id: string;
  organizationId: string;
}

interface IssuedCredential {
  id: string;
  token: string;
}

interface PriorCredential {
  id: string;
  servicePrincipalId: string;
  revokedAt: string | null;
  kind: string;
  audience: string;
  projectId: string;
  workspaceId: string;
  launcherWorktree: string;
  scopes: unknown;
}

export interface AtomicCredentialInstallDependencies {
  afterRename?: () => void;
}

export interface CoordinationResetDependencies {
  request?: typeof fetch;
  sourceFingerprint?: (worktree: string) => Buffer;
  installDependencies?: AtomicCredentialInstallDependencies;
  now?: () => number;
}

function fail(failure: CoordinationResetFailure): never {
  throw new CoordinationResetError(failure);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.slice().sort().every((key, index) => key === actual[index]);
}

function isContained(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

function protectedDescriptor(descriptor: number): void {
  const stat = fstatSync(descriptor);
  const owner = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || (owner !== undefined && stat.uid !== owner)
    || stat.size < 2 || stat.size > SECRET_MAX_BYTES) fail("binding");
}

function parseOwnerSecret(source: string): OwnerSecret {
  let value: unknown;
  try { value = JSON.parse(source); } catch { return fail("binding"); }
  if (!isRecord(value)) return fail("binding");
  const allowed = ["email", "mfaCredential", "password", "stepUpCredential"];
  if (Object.keys(value).some((key) => !allowed.includes(key))
    || typeof value.email !== "string" || value.email.length < 3 || value.email.length > 320
    || typeof value.password !== "string" || value.password.length < 6 || value.password.length > 1024
    || (value.mfaCredential !== undefined && (typeof value.mfaCredential !== "string" || value.mfaCredential.length > 128))
    || (value.stepUpCredential !== undefined && (typeof value.stepUpCredential !== "string" || value.stepUpCredential.length > 1024))) {
    return fail("binding");
  }
  return value as unknown as OwnerSecret;
}

function readExplicitProtectedOwnerSecret(environment: NodeJS.ProcessEnv): OwnerSecret {
  const path = environment.INGENIUM_COORDINATION_OWNER_SECRET_FILE;
  const rawFd = environment.INGENIUM_COORDINATION_OWNER_SECRET_FD;
  if ((path === undefined) === (rawFd === undefined)) return fail("binding");
  let descriptor: number | undefined;
  let close = false;
  try {
    if (path !== undefined) {
      if (!isAbsolute(path) || resolve(path) !== path) return fail("binding");
      const parent = lstatSync(dirname(path));
      const owner = typeof process.getuid === "function" ? process.getuid() : undefined;
      if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0
        || (owner !== undefined && parent.uid !== owner)) return fail("binding");
      descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      close = true;
    } else {
      if (!/^[3-9][0-9]*$/.test(rawFd!)) return fail("binding");
      descriptor = Number(rawFd);
    }
    protectedDescriptor(descriptor);
    return parseOwnerSecret(readFileSync(descriptor, "utf8"));
  } catch (error) {
    if (error instanceof CoordinationResetError) throw error;
    return fail("binding");
  } finally {
    if (close && descriptor !== undefined) closeSync(descriptor);
  }
}

function protectedDirectory(path: string): void {
  const metadata = lstatSync(path);
  const owner = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700
    || (owner !== undefined && metadata.uid !== owner)) return fail("binding");
}

function readProtectedFile(path: string, maximumBytes: number): Buffer {
  if (!isAbsolute(path) || resolve(path) !== path) return fail("binding");
  let descriptor: number | undefined;
  try {
    protectedDirectory(dirname(path));
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    const owner = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.size < 1 || metadata.size > maximumBytes
      || (owner !== undefined && metadata.uid !== owner)) return fail("binding");
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof CoordinationResetError) throw error;
    return fail("binding");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readProviderReferenceFile(path: string): Buffer {
  if (!isAbsolute(path) || resolve(path) !== path) return fail("binding");
  let descriptor: number | undefined;
  try {
    const parent = lstatSync(dirname(path));
    const owner = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o022) !== 0
      || (owner !== undefined && parent.uid !== owner)) return fail("binding");
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.size < 1 || metadata.size > PROVIDER_MAX_BYTES
      || (owner !== undefined && metadata.uid !== owner)) return fail("binding");
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof CoordinationResetError) throw error;
    return fail("binding");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function providerKey(path: string): Buffer {
  const source = readProtectedFile(path, 65);
  try {
    const value = source.toString("utf8").replace(/\n$/, "");
    if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
    if (/^[A-Za-z0-9_-]{64}$/.test(value)) return createHash("sha256").update(value, "utf8").digest();
    return fail("binding");
  } finally {
    source.fill(0);
  }
}

function providerMetadata(): Omit<OwnerProviderEnvelope, "payload"> {
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    account: OWNER_EMAIL,
    project: PROJECT,
    workspaceId: WORKSPACE,
  };
}

function providerAssociatedData(): Buffer {
  return Buffer.from(JSON.stringify(providerMetadata()), "utf8");
}

function parseProviderReference(source: Buffer, worktree: string): OwnerProviderReference {
  let value: unknown;
  try { value = JSON.parse(source.toString("utf8")); } catch { return fail("binding"); }
  if (!isRecord(value) || !hasExactKeys(value, ["bundleFile", "keyFile", "provider", "version"])
    || value.version !== 1 || value.provider !== "aes-256-gcm-file"
    || typeof value.keyFile !== "string" || typeof value.bundleFile !== "string"
    || !isAbsolute(value.keyFile) || resolve(value.keyFile) !== value.keyFile
    || !isAbsolute(value.bundleFile) || resolve(value.bundleFile) !== value.bundleFile
    || dirname(value.keyFile) === dirname(value.bundleFile)
    || isContained(worktree, value.keyFile) || isContained(worktree, value.bundleFile)) return fail("binding");
  return value as unknown as OwnerProviderReference;
}

function readProviderReference(worktree: string): OwnerProviderReference {
  const referencePath = resolve(worktree, OWNER_PROVIDER_REFERENCE);
  const source = readProviderReferenceFile(referencePath);
  try { return parseProviderReference(source, worktree); } finally { source.fill(0); }
}

function optionalProviderReference(worktree: string): OwnerProviderReference | undefined {
  try {
    lstatSync(resolve(worktree, OWNER_PROVIDER_REFERENCE));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return fail("binding");
  }
  return readProviderReference(worktree);
}

function parseProviderEnvelope(source: Buffer): OwnerProviderEnvelope {
  let value: unknown;
  try { value = JSON.parse(source.toString("utf8")); } catch { return fail("binding"); }
  const metadata = providerMetadata();
  if (!isRecord(value) || !hasExactKeys(value, ["account", "algorithm", "payload", "project", "version", "workspaceId"])
    || value.version !== metadata.version || value.algorithm !== metadata.algorithm || value.account !== metadata.account
    || value.project !== metadata.project || value.workspaceId !== metadata.workspaceId
    || typeof value.payload !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.payload)) return fail("binding");
  return value as unknown as OwnerProviderEnvelope;
}

function decryptProviderSecret(reference: OwnerProviderReference): OwnerSecret {
  const source = readProtectedFile(reference.bundleFile, PROVIDER_MAX_BYTES);
  const key = providerKey(reference.keyFile);
  let plaintext: Buffer | undefined;
  try {
    const envelope = parseProviderEnvelope(source);
    const encrypted = Buffer.from(envelope.payload, "base64url");
    if (encrypted.length < 29 || encrypted.toString("base64url") !== envelope.payload) return fail("binding");
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12));
    decipher.setAAD(providerAssociatedData());
    decipher.setAuthTag(encrypted.subarray(-16));
    plaintext = Buffer.concat([decipher.update(encrypted.subarray(12, -16)), decipher.final()]);
    const secret = parseOwnerSecret(plaintext.toString("utf8"));
    if (secret.email !== OWNER_EMAIL) return fail("binding");
    return secret;
  } catch (error) {
    if (error instanceof CoordinationResetError) throw error;
    return fail("binding");
  } finally {
    source.fill(0);
    key.fill(0);
    plaintext?.fill(0);
  }
}

export function readProtectedOwnerSecret(
  worktree = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): OwnerSecret {
  const hasFile = environment.INGENIUM_COORDINATION_OWNER_SECRET_FILE !== undefined;
  const hasDescriptor = environment.INGENIUM_COORDINATION_OWNER_SECRET_FD !== undefined;
  if (hasFile || hasDescriptor) return readExplicitProtectedOwnerSecret(environment);
  return decryptProviderSecret(readProviderReference(worktree));
}

function canonicalBinding(worktree: string): CanonicalBinding {
  let root: string;
  try {
    root = realpathSync(resolve(worktree));
    if (!statSync(root).isDirectory()) return fail("binding");
  } catch { return fail("binding"); }
  const configPath = resolve(root, "opencode.json");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > CONFIG_MAX_BYTES) return fail("binding");
    const config: unknown = JSON.parse(readFileSync(descriptor, "utf8"));
    if (!isRecord(config) || !isRecord(config.mcp) || !isRecord(config.mcp.ingenium)
      || !isRecord(config.mcp.ingenium.environment)) return fail("binding");
    const environment = config.mcp.ingenium.environment;
    if (environment.INGENIUM_API_URL !== API_URL || environment.INGENIUM_PROJECT !== PROJECT
      || environment.INGENIUM_WORKSPACE_ID !== WORKSPACE || environment.INGENIUM_WORKTREE !== root
      || environment.INGENIUM_MCP_AUDIENCE !== "mcp"
      || environment.INGENIUM_MCP_CREDENTIAL_FILE !== CREDENTIAL_REFERENCE) return fail("binding");
  } catch (error) {
    if (error instanceof CoordinationResetError) throw error;
    return fail("binding");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const credentialFile = resolve(root, CREDENTIAL_REFERENCE);
  if (basename(credentialFile) !== ".ingenium-mcp-credential"
    || !isContained(resolve(root, ".opencode"), credentialFile)) return fail("binding");
  return { worktree: root, credentialFile };
}

function writeAtomicFile(target: string, contents: Buffer, label: string): void {
  const temporary = resolve(dirname(target), `.${label}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, contents);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, target);
    const parent = openSync(dirname(target), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { /* renamed or already removed */ }
  }
}

function encryptProviderSecret(secret: OwnerSecret, keyFile: string): OwnerProviderEnvelope {
  const key = providerKey(keyFile);
  const plaintext = Buffer.from(JSON.stringify(secret), "utf8");
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(providerAssociatedData());
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      ...providerMetadata(),
      payload: Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url"),
    };
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

export function persistEncryptedOwnerSecret(
  worktree: string,
  options: PersistOwnerSecretOptions,
  dependencies: PersistOwnerSecretDependencies = {},
): void {
  const binding = canonicalBinding(worktree);
  if (!isAbsolute(options.keyFile) || resolve(options.keyFile) !== options.keyFile
    || !isAbsolute(options.bundleDirectory) || resolve(options.bundleDirectory) !== options.bundleDirectory
    || isContained(binding.worktree, options.keyFile) || isContained(binding.worktree, options.bundleDirectory)
    || dirname(options.keyFile) === options.bundleDirectory) return fail("binding");
  try {
    mkdirSync(options.bundleDirectory, { recursive: true, mode: 0o700 });
    chmodSync(options.bundleDirectory, 0o700);
    protectedDirectory(options.bundleDirectory);
  } catch (error) {
    if (error instanceof CoordinationResetError) throw error;
    return fail("binding");
  }
  const secret = readExplicitProtectedOwnerSecret(process.env);
  if (secret.email !== OWNER_EMAIL) return fail("binding");
  const envelope = encryptProviderSecret(secret, options.keyFile);
  const bundleFile = resolve(options.bundleDirectory, `${PROVIDER_BUNDLE_PREFIX}${randomUUID()}.credential`);
  const previous = optionalProviderReference(binding.worktree);
  const referenceFile = resolve(binding.worktree, OWNER_PROVIDER_REFERENCE);
  const reference: OwnerProviderReference = {
    version: 1,
    provider: "aes-256-gcm-file",
    keyFile: options.keyFile,
    bundleFile,
  };
  let bundleInstalled = false;
  let referenceInstalled = false;
  try {
    writeAtomicFile(bundleFile, Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8"), "ingenium-owner-bundle");
    bundleInstalled = true;
    dependencies.afterBundleRename?.();
    writeAtomicFile(
      referenceFile,
      Buffer.from(`${JSON.stringify(reference)}\n`, "utf8"),
      "ingenium-owner-provider",
    );
    referenceInstalled = true;
    decryptProviderSecret(readProviderReference(binding.worktree));
    bundleInstalled = false;
  } catch (error) {
    if (referenceInstalled) {
      try {
        if (previous) {
          writeAtomicFile(referenceFile, Buffer.from(`${JSON.stringify(previous)}\n`, "utf8"), "ingenium-owner-provider-rollback");
        } else {
          unlinkSync(referenceFile);
          const parent = openSync(dirname(referenceFile), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          try { fsyncSync(parent); } finally { closeSync(parent); }
        }
      } catch { return fail("binding"); }
    }
    if (bundleInstalled) {
      try { unlinkSync(bundleFile); } catch { /* retain fail-closed ciphertext if cleanup itself fails */ }
    }
    throw error instanceof CoordinationResetError ? error : new CoordinationResetError("binding");
  }
  if (previous && previous.bundleFile !== bundleFile) {
    try { unlinkSync(previous.bundleFile); } catch { return fail("binding"); }
  }
}

function readExistingCredential(target: string): Buffer | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    const owner = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || (owner !== undefined && stat.uid !== owner)) return fail("credential_install");
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof CoordinationResetError) throw error;
    try {
      lstatSync(target);
      return fail("credential_install");
    } catch (nested) {
      if (nested instanceof CoordinationResetError) throw nested;
      return undefined;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function installCoordinationCredentialAtomically(
  worktree: string,
  token: string,
  dependencies: AtomicCredentialInstallDependencies = {},
): void {
  installCredentialAtomically(canonicalBinding(worktree).credentialFile, token, dependencies);
}

function installCredentialAtomically(
  credentialFile: string,
  token: string,
  dependencies: AtomicCredentialInstallDependencies = {},
): void {
  if (!TOKEN.test(token)) return fail("credential_install");
  const previous = readExistingCredential(credentialFile);
  let replaced = false;
  try {
    writeAtomicFile(credentialFile, Buffer.from(`${token}\n`, "utf8"), "ingenium-mcp-credential");
    replaced = true;
    dependencies.afterRename?.();
    const installed = readExistingCredential(credentialFile);
    if (!installed?.equals(Buffer.from(`${token}\n`, "utf8"))) return fail("credential_install");
  } catch (error) {
    if (replaced) {
      try {
        if (previous) writeAtomicFile(credentialFile, previous, "ingenium-mcp-credential-rollback");
        else {
          unlinkSync(credentialFile);
          const parent = openSync(dirname(credentialFile), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          try { fsyncSync(parent); } finally { closeSync(parent); }
        }
      } catch { return fail("credential_install"); }
    }
    throw error instanceof CoordinationResetError ? error : new CoordinationResetError("credential_install");
  }
}

function cookie(response: Response, name: string): string | undefined {
  const value = response.headers.get("set-cookie")?.split(";")[0];
  return value?.startsWith(`${name}=`) ? value : undefined;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null);
  return isRecord(value) ? value : fail("unavailable");
}

function data(value: Record<string, unknown>): Record<string, unknown> {
  return isRecord(value.data) ? value.data : fail("unavailable");
}

async function ownerSession(request: typeof fetch, secret: OwnerSecret): Promise<SessionState> {
  let response: Response;
  try { response = await request(`${OWNER_API_URL}/auth/csrf`, { signal: AbortSignal.timeout(5_000) }); }
  catch { return fail("unavailable"); }
  if (response.status !== 200) return fail("unavailable");
  const preAuth = data(await json(response));
  const preAuthCookie = cookie(response, "__Host-ingenium_pre_auth");
  if (typeof preAuth.csrfToken !== "string" || !preAuthCookie) return fail("unavailable");
  try {
    response = await request(`${OWNER_API_URL}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: DASHBOARD_ORIGIN, cookie: preAuthCookie, "x-csrf-token": preAuth.csrfToken, ...DASHBOARD_MARKER },
      body: JSON.stringify({ email: secret.email, password: secret.password, deviceLabel: "Coordination reset" }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { return fail("unavailable"); }
  if (response.status !== 200 && response.status !== 202) return fail("authentication");
  let body = data(await json(response));
  if (response.status === 202) {
    if (typeof body.challengeToken !== "string" || !secret.mfaCredential) return fail("authentication");
    try {
      response = await request(`${OWNER_API_URL}/auth/mfa/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: DASHBOARD_ORIGIN, cookie: preAuthCookie, "x-csrf-token": preAuth.csrfToken, ...DASHBOARD_MARKER },
        body: JSON.stringify({ challengeToken: body.challengeToken, code: secret.mfaCredential }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch { return fail("unavailable"); }
    if (response.status !== 200) return fail("authentication");
    body = data(await json(response));
  }
  let sessionCookie = cookie(response, "__Host-ingenium_session");
  if (!sessionCookie || typeof body.csrfToken !== "string") return fail("authentication");
  try {
    response = await request(`${OWNER_API_URL}/auth/step-up`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: DASHBOARD_ORIGIN, cookie: sessionCookie, "x-csrf-token": body.csrfToken, ...DASHBOARD_MARKER },
      body: JSON.stringify({ credential: secret.stepUpCredential ?? secret.password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { return fail("unavailable"); }
  if (response.status !== 200) return fail(response.status === 403 ? "authorization" : "authentication");
  body = data(await json(response));
  sessionCookie = cookie(response, "__Host-ingenium_session");
  if (body.recentStepUp !== true || typeof body.csrfToken !== "string" || !sessionCookie) return fail("authentication");
  return { cookie: sessionCookie, csrfToken: body.csrfToken };
}

function sessionHeaders(session: SessionState, unsafe = false): HeadersInit {
  return {
    cookie: session.cookie,
    ...(unsafe ? { "content-type": "application/json", origin: DASHBOARD_ORIGIN, "x-csrf-token": session.csrfToken, ...DASHBOARD_MARKER } : {}),
  };
}

async function projectIdentity(request: typeof fetch, session: SessionState): Promise<ProjectIdentity> {
  let response: Response;
  try { response = await request(`${OWNER_API_URL}/projects/${PROJECT}/detail`, { headers: sessionHeaders(session), signal: AbortSignal.timeout(5_000) }); }
  catch { return fail("unavailable"); }
  if (response.status !== 200) return fail(response.status === 403 || response.status === 404 ? "authorization" : "unavailable");
  const project = data(await json(response)).project;
  if (!isRecord(project) || typeof project.id !== "string" || typeof project.organization_id !== "string"
    || project.name !== PROJECT) return fail("binding");
  return { id: project.id, organizationId: project.organization_id };
}

function exactScopes(value: unknown, scopes: readonly string[]): boolean {
  return Array.isArray(value) && value.length === scopes.length
    && [...value].sort().every((scope, index) => scope === [...scopes].sort()[index]);
}

async function issueCredential(
  request: typeof fetch,
  session: SessionState,
  identity: ProjectIdentity,
  binding: CanonicalBinding,
  profile: CredentialProfile,
  now: number,
  servicePrincipalId?: string,
): Promise<IssuedCredential> {
  let response: Response;
  try {
    response = await request(`${OWNER_API_URL}/auth/mcp-credentials`, {
      method: "POST",
      headers: sessionHeaders(session, true),
      body: JSON.stringify({
        ...(servicePrincipalId ? { servicePrincipalId } : {}),
        kind: "service",
        audience: "mcp",
        name: profile.name,
        scopes: profile.scopes,
        organizationId: identity.organizationId,
        projectId: identity.id,
        projectIds: [identity.id],
        workspaceId: WORKSPACE,
        launcherWorktree: binding.worktree,
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1_000).toISOString(),
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch { return fail("unavailable"); }
  if (response.status !== 201) return fail(response.status === 403 || response.status === 404 ? "authorization" : "credential_issue");
  const credential = data(await json(response));
  if (typeof credential.id !== "string" || typeof credential.token !== "string" || !TOKEN.test(credential.token)
    || credential.kind !== "service" || credential.audience !== "mcp" || credential.projectId !== identity.id
    || !Array.isArray(credential.projectIds) || credential.projectIds.length !== 1 || credential.projectIds[0] !== identity.id
    || credential.workspaceId !== WORKSPACE || credential.launcherWorktree !== binding.worktree
    || !exactScopes(credential.scopes, profile.scopes)) return fail("credential_issue");
  return { id: credential.id, token: credential.token };
}

async function priorCredentials(request: typeof fetch, session: SessionState): Promise<PriorCredential[]> {
  let response: Response;
  try { response = await request(`${OWNER_API_URL}/auth/mcp-credentials`, { headers: sessionHeaders(session), signal: AbortSignal.timeout(5_000) }); }
  catch { return fail("unavailable"); }
  if (response.status !== 200) return fail("credential_revoke");
  const listed = (await json(response)).data;
  if (!Array.isArray(listed)) return fail("credential_revoke");
  return listed.filter((entry): entry is PriorCredential => isRecord(entry)
    && typeof entry.id === "string" && typeof entry.servicePrincipalId === "string"
    && (entry.revokedAt === null || typeof entry.revokedAt === "string")
    && typeof entry.kind === "string" && typeof entry.audience === "string"
    && typeof entry.projectId === "string" && typeof entry.workspaceId === "string"
    && typeof entry.launcherWorktree === "string");
}

function matchesBinding(
  entry: PriorCredential,
  identity: ProjectIdentity,
  binding: CanonicalBinding,
  profile: CredentialProfile,
): boolean {
  return entry.revokedAt === null && entry.kind === "service" && entry.audience === "mcp"
    && entry.projectId === identity.id && entry.workspaceId === WORKSPACE
    && entry.launcherWorktree === binding.worktree && exactScopes(entry.scopes, profile.scopes);
}

async function verifyCredential(
  request: typeof fetch,
  token: string,
  binding: CanonicalBinding,
  identity: ProjectIdentity,
  profile: CredentialProfile,
): Promise<void> {
  let response: Response;
  try {
    response = await request(`${API_URL}/auth/preflight`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-ingenium-audience": "mcp",
        "x-ingenium-workspace": WORKSPACE,
        "x-ingenium-launcher-worktree": binding.worktree,
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch { return fail("unavailable"); }
  const result = response.status === 200 ? data(await json(response)) : {};
  if (response.status !== 200 || result.audience !== "mcp" || result.projectId !== identity.id
    || !Array.isArray(result.projectIds) || result.projectIds.length !== 1 || result.projectIds[0] !== identity.id
    || result.workspaceId !== WORKSPACE || result.launcherWorktree !== binding.worktree
    || !exactScopes(result.scopes, profile.scopes)) {
    return fail("binding");
  }
}

async function revokePriorCredentials(
  request: typeof fetch,
  session: SessionState,
  issuedId: string,
  identity: ProjectIdentity,
  binding: CanonicalBinding,
  profile: CredentialProfile,
  listed: PriorCredential[],
): Promise<void> {
  let response: Response;
  const ids = listed.filter((entry) => entry.id !== issuedId && matchesBinding(entry, identity, binding, profile)).map((entry) => entry.id);
  for (const id of ids) {
    try {
      response = await request(`${OWNER_API_URL}/auth/mcp-credentials/${encodeURIComponent(id)}`, {
        method: "DELETE", headers: sessionHeaders(session, true), signal: AbortSignal.timeout(5_000),
      });
    } catch { return fail("unavailable"); }
    if (response.status !== 204) return fail("credential_revoke");
  }
}

function defaultSourceFingerprint(worktree: string): Buffer {
  return execFileSync("/usr/bin/git", ["-C", worktree, "status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    encoding: "buffer", timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
  });
}

function acquireResetLock(credentialFile: string): { close(): void } {
  const lock = resolve(dirname(credentialFile), `${basename(credentialFile)}.reset-lock`);
  let descriptor: number;
  try {
    descriptor = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
  } catch { return fail("already_running"); }
  let closed = false;
  return { close() {
    if (closed) return;
    closed = true;
    closeSync(descriptor);
    try { unlinkSync(lock); } catch { /* a failed cleanup remains fail-closed for the next reset */ }
  } };
}

export async function resetCoordinationCredential(
  worktree = process.cwd(),
  dependencies: CoordinationResetDependencies = {},
): Promise<{ status: "completed" }> {
  return resetCredential(worktree, "coordination", dependencies);
}

export async function resetLearningCredential(
  worktree = process.cwd(),
  dependencies: CoordinationResetDependencies = {},
): Promise<{ status: "completed" }> {
  return resetCredential(worktree, "learning", dependencies);
}

async function resetCredential(
  worktree: string,
  purpose: "coordination" | "learning",
  dependencies: CoordinationResetDependencies,
): Promise<{ status: "completed" }> {
  const binding = canonicalBinding(worktree);
  const profile: CredentialProfile = purpose === "coordination"
    ? { credentialFile: binding.credentialFile, name: "Ingenium coordination", scopes: COORDINATION_SCOPES }
    : {
      credentialFile: resolve(binding.worktree, LEARNING_CREDENTIAL_REFERENCE),
      name: "Ingenium learning",
      scopes: LEARNING_SCOPES,
    };
  if (!isContained(resolve(binding.worktree, ".opencode"), profile.credentialFile)) return fail("binding");
  const lock = acquireResetLock(profile.credentialFile);
  const fingerprint = dependencies.sourceFingerprint ?? defaultSourceFingerprint;
  const before = fingerprint(binding.worktree);
  try {
    const secret = readProtectedOwnerSecret(binding.worktree);
    const request = dependencies.request ?? fetch;
    const session = await ownerSession(request, secret);
    const identity = await projectIdentity(request, session);
    const prior = await priorCredentials(request, session);
    const servicePrincipalId = prior.find((entry) => matchesBinding(entry, identity, binding, profile))?.servicePrincipalId;
    const issued = await issueCredential(
      request, session, identity, binding, profile, (dependencies.now ?? Date.now)(), servicePrincipalId,
    );
    installCredentialAtomically(profile.credentialFile, issued.token, dependencies.installDependencies);
    await verifyCredential(request, issued.token, binding, identity, profile);
    await revokePriorCredentials(request, session, issued.id, identity, binding, profile, prior);
    if (!fingerprint(binding.worktree).equals(before)) return fail("source_changed");
    return { status: "completed" };
  } finally {
    lock.close();
  }
}

export function parseCoordinationResetArgs(args: readonly string[]): "reset" | "reset-learning" | PersistOwnerSecretOptions {
  if (args.length === 1 && args[0] === "reset") return "reset";
  if (args.length === 1 && args[0] === "reset-learning") return "reset-learning";
  if (args.length === 5 && args[0] === "store" && args[1] === "--key-file" && args[3] === "--bundle-directory") {
    return { keyFile: args[2]!, bundleDirectory: args[4]! };
  }
  return fail("binding");
}

export async function runCoordinationResetCli(args = process.argv.slice(2)): Promise<number> {
  try {
    const operation = parseCoordinationResetArgs(args);
    if (operation === "reset" || operation === "reset-learning") {
      if (operation === "reset") await resetCoordinationCredential();
      else await resetLearningCredential();
      process.stdout.write("coordination reset: completed\n");
    } else {
      persistEncryptedOwnerSecret(process.cwd(), operation);
      process.stdout.write("coordination owner credential: stored\n");
    }
    return 0;
  } catch (error) {
    const failure = error instanceof CoordinationResetError ? error.failure : "unavailable";
    process.stderr.write(`coordination reset: failed (${failure})\n`);
    return 1;
  }
}
