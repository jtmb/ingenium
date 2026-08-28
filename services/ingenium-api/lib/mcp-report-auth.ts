import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MCP_REPORT_AUDIENCE = "mcp-report";
export const MCP_REPORT_WORKTREE = "/app";
export const MCP_REPORT_CREDENTIAL_DIRECTORY = "/run/ingenium-secrets/api";
const MCP_REPORT_CREDENTIAL_TTL_MS = 60_000;
const MAX_ACTIVE_REPORT_CREDENTIALS = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PROJECT_NAME = /^(?!\.{1,2}$)[^\s/\\\u0000-\u001f\u007f][^/\\\u0000-\u001f\u007f]{0,63}$/;
const SAFE_TOOL_NAME = /^[a-z][a-z0-9_]{0,255}$/;
const REPORT_FILE_NAME = /^mcp-report-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface McpReportCredentialBinding {
  project: string;
  projectId: string;
  workspaceId: string;
  launcherWorktree: typeof MCP_REPORT_WORKTREE;
  toolNames: readonly string[];
}

interface ActiveCredential extends McpReportCredentialBinding {
  id: string;
  tokenHash: string;
  tokenFile: string;
  expiresAt: number;
}

const credentialsByHash = new Map<string, ActiveCredential>();
const credentialHashesById = new Map<string, string>();

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function pruneExpired(now = Date.now()): void {
  for (const credential of credentialsByHash.values()) {
    if (credential.expiresAt <= now) disposeMcpReportCredential(credential.id);
  }
}

function validateBinding(binding: McpReportCredentialBinding): void {
  if (!SAFE_PROJECT_NAME.test(binding.project) || !UUID.test(binding.projectId)
    || binding.workspaceId !== binding.projectId || binding.launcherWorktree !== MCP_REPORT_WORKTREE
    || binding.toolNames.length > 1_000 || new Set(binding.toolNames).size !== binding.toolNames.length
    || binding.toolNames.some((name) => !SAFE_TOOL_NAME.test(name))) {
    throw new Error("Invalid MCP report credential binding");
  }
}

function validateCredentialDirectory(): void {
  const metadata = lstatSync(MCP_REPORT_CREDENTIAL_DIRECTORY);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0
    || (process.platform !== "win32" && typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error("MCP report credential directory is unavailable");
  }
}

function removeStaleCredentialFiles(): void {
  const activePaths = new Set(Array.from(credentialsByHash.values(), ({ tokenFile }) => tokenFile));
  for (const name of readdirSync(MCP_REPORT_CREDENTIAL_DIRECTORY)) {
    if (!REPORT_FILE_NAME.test(name)) continue;
    const path = join(MCP_REPORT_CREDENTIAL_DIRECTORY, name);
    if (activePaths.has(path)) continue;
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0
      || (process.platform !== "win32" && typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
      throw new Error("Stale MCP report credential file is unsafe");
    }
    unlinkSync(path);
  }
}

export function issueMcpReportCredential(binding: McpReportCredentialBinding): { id: string; tokenFile: string } {
  validateBinding(binding);
  pruneExpired();
  if (credentialsByHash.size >= MAX_ACTIVE_REPORT_CREDENTIALS) throw new Error("MCP report credential capacity reached");
  validateCredentialDirectory();
  removeStaleCredentialFiles();

  const id = randomUUID();
  const token = `ing_${id.replaceAll("-", "").slice(0, 12)}_${randomBytes(32).toString("base64url")}`;
  const hash = tokenHash(token);
  const tokenFile = join(MCP_REPORT_CREDENTIAL_DIRECTORY, `mcp-report-${id}`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(tokenFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, `${token}\n`, "utf8");
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0
      || (process.platform !== "win32" && typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
      throw new Error("MCP report credential file is unsafe");
    }
  } catch (error) {
    try { unlinkSync(tokenFile); } catch {}
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  const credential: ActiveCredential = {
    ...binding,
    toolNames: [...binding.toolNames],
    id,
    tokenHash: hash,
    tokenFile,
    expiresAt: Date.now() + MCP_REPORT_CREDENTIAL_TTL_MS,
  };
  credentialsByHash.set(hash, credential);
  credentialHashesById.set(id, hash);
  return { id, tokenFile };
}

export function resolveMcpReportCredential(
  token: string,
  binding: Omit<McpReportCredentialBinding, "toolNames">,
): (McpReportCredentialBinding & { id: string }) | undefined {
  if (!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  pruneExpired();
  const credential = credentialsByHash.get(tokenHash(token));
  if (!credential || credential.project !== binding.project || credential.projectId !== binding.projectId
    || credential.workspaceId !== binding.workspaceId || credential.launcherWorktree !== binding.launcherWorktree) return undefined;
  return {
    id: credential.id,
    project: credential.project,
    projectId: credential.projectId,
    workspaceId: credential.workspaceId,
    launcherWorktree: credential.launcherWorktree,
    toolNames: [...credential.toolNames],
  };
}

export function disposeMcpReportCredential(id: string): void {
  const hash = credentialHashesById.get(id);
  if (!hash) return;
  const credential = credentialsByHash.get(hash);
  credentialHashesById.delete(id);
  credentialsByHash.delete(hash);
  if (credential) {
    try { unlinkSync(credential.tokenFile); } catch {}
  }
}
